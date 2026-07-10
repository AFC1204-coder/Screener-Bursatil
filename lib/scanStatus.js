// lib/scanStatus.js — estados del scan en servidor (scans.settings.progress.status).
// Compartido por /api/scan, /api/scan/cancel y el polling del cliente.
//
// Contrato de completitud (introducido tras el audit 2026-07-10 §"Terminal done
// can mean zero successful scan rows"):
//
//   - "done"        LEGACY: ya no se escribe. El runner nunca debe producirlo.
//                   Se mantiene en TERMINAL_SCAN_STATUSES solo para tolerar
//                   filas históricas mientras se migra el inventario.
//   - "complete"    Final OK: ratio saved/(saved+errors) == 1.0 (errors==0).
//                   Único estado terminal sin marca de degradación.
//   - "partial"     Final OK con degradación: 0 < ratio < 1.0. Se publica en
//                   leaderboards pero lleva degraded=true en la respuesta de API
//                   y debe ser pintado en el cliente con franja de fiabilidad.
//   - "failed"      Final OK pero ratio == 0 (caso degenerado 0/0 incluido).
//                   NUNCA se publica en leaderboards/scoring.
//   - "error"       Fallo de runtime (scoring threw, RPC finalize falló, etc.).
//                   Distinto de "failed": aquí no hubo finalización exitosa.
//                   NUNCA se publica. Re-finalizable si finalizationStatus="failed".
//   - "cancelled"   El usuario pidió cancelar. NUNCA se publica.
//
// saved+errors==0 (caso degenerado) se trata como "failed" por decisión
// del enunciado: cero trabajo, no se expone como completo. Mantiene el
// invariante "complete ⟹ saved>0 && errors==0".

// Históricamente, los runners podían escribir "done" si la RPC de percentiles
// resolvía. El ratio se ignora en ese caso ("done" siempre se trataba como
// éxito de cara al cliente). Mantenemos "done" como terminal histórico
// para tolerar snapshots legacy en cache de /api/scans y leaderboards ya
// materializados. NO es un valor que el runner actual pueda escribir.
export const TERMINAL_SCAN_STATUSES = ["complete", "partial", "failed", "error", "cancelled", "done"];

// Estados cuyos scan_results se consideran publicables en leaderboards/scoring.
// "partial" es público (con degraded=true); "failed", "error", "cancelled" y
// el legacy "done" no aparecen en el filtro aplicado por readScanRows.
export const PUBLIC_SCAN_STATUSES = ["complete", "partial", "done"];

// Decide si un estado de scan es terminal: no habrá más filas ni cambios de progreso,
// el polling puede parar y una cancelación ya no procede.
export function isTerminalScanStatus(status) {
  return TERMINAL_SCAN_STATUSES.includes(String(status || "").trim().toLowerCase());
}

// Decide si un estado de scan es publicable en leaderboards/scoring.
export function isPublicScanStatus(status) {
  return PUBLIC_SCAN_STATUSES.includes(String(status || "").trim().toLowerCase());
}

/**
 * Contrato puro: aplica la tabla de completitud a partir de saved/errors.
 *
 *   - errors === 0                  → "complete"
 *   - saved === 0 && errors === 0  → "failed" (caso degenerado)
 *   - 0 < ratio < 1                 → "partial"
 *   - ratio === 0                   → "failed"
 *
 * @param {{saved?: number, errors?: number}} input
 * @returns {{ status: "complete"|"partial"|"failed", ratio: number, saved: number, errors: number, total: number }}
 */
export function computeTerminalCompleteness(input = {}) {
  const saved = Math.max(0, Math.round(Number(input?.saved) || 0));
  const errors = Math.max(0, Math.round(Number(input?.errors) || 0));
  const total = saved + errors;
  let status;
  let ratio;
  if (total === 0) {
    // Sin intentos: degenerado, tratar como failed.
    status = "failed";
    ratio = 0;
  } else if (errors === 0) {
    status = "complete";
    ratio = 1;
  } else if (saved === 0) {
    status = "failed";
    ratio = 0;
  } else {
    status = "partial";
    ratio = saved / total;
  }
  return { status, ratio, saved, errors, total };
}
