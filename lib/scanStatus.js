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
//   - "partial"     Final OK con degradación: ratio >= 0.5 (mayoría simple de
//                   filas guardadas). Se publica en leaderboards pero lleva
//                   degraded=true en la respuesta de API y debe ser pintado en
//                   el cliente con franja de fiabilidad.
//   - "failed"      Final OK pero ratio < 0.5 (incluye 0/0 y cualquier caso
//                   donde los errores son mayoría). NUNCA se publica en
//                   leaderboards/scoring.
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

// Umbral de mayoría simple: a partir de este ratio el scan se publica como
// "partial" (degraded=true); por debajo se bloquea como "failed".
export const COMPLETENESS_PARTIAL_MIN_RATIO = 0.5;

/**
 * Contrato puro: aplica la tabla de completitud a partir de saved/errors.
 *
 *   - errors === 0                 → "complete"
 *   - saved === 0 && errors === 0  → "failed" (caso degenerado)
 *   - ratio >= 0.5                  → "partial"  (degraded=true, publicable)
 *   - ratio < 0.5 (incluye 0)      → "failed"   (nunca publicable)
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
  } else {
    ratio = saved / total;
    // Umbral de mayoría simple: ratio >= 0.5 es partial (publicable con
    // degraded=true); por debajo (errores mayoría) se bloquea como failed.
    status = ratio >= COMPLETENESS_PARTIAL_MIN_RATIO ? "partial" : "failed";
  }
  return { status, ratio, saved, errors, total };
}

// classifyScanOutcome: la etiqueta de 4 estados que ve el usuario al terminar
// un escaneo interactivo (app/page.jsx). Distinto de `progress.status` (el
// contrato de arriba, "complete"/"partial"/"failed"/"error"/"cancelled"):
// aquel vive en el servidor y es puramente aritmético sobre saved/errors DEL
// TRAMO — no sabe nada de cuántos símbolos pidió originalmente el cliente
// (`requestedTotal`, ej. el universo completo cargado en el navegador, que
// puede ser mayor que lo que el servidor llegó a guardar en
// settings.scanSymbols por el tope MAX_SYMBOLS).
//
// Motivación (docs/limite-600-scan-2026-08-09.md): un escaneo con
// progress.status:"error" y 299 filas ya guardadas se mostraba como
// "Completado" porque el cliente solo distinguía "cancelado por el usuario"
// de "todo lo demás". Esta función junta las dos señales que YA calcula
// GET /api/scan (`degraded`, `publishable`, ver app/api/scan/route.js) con la
// cobertura real (completed vs. lo pedido) para dar una sola etiqueta que no
// afirme más de lo que se sabe:
//
//   - "cancelled": el usuario pidió cancelar (o el servidor confirma
//     progress.status:"cancelled"). Prioridad sobre todo lo demás.
//   - "failed": el estado del servidor no es publicable (`publishable:false`
//     — cubre progress.status "error" Y "failed"; el primero es un fallo de
//     runtime, el segundo es "terminó sin crash pero la mayoría de los
//     símbolos no dieron resultado utilizable" — ninguno de los dos es un
//     resultado en el que se pueda confiar).
//   - "partial": el estado SÍ es publicable, pero o bien viene marcado
//     `degraded:true` (progress.status:"partial" — algunos símbolos del
//     tramo fallaron) o bien no cubrió todo lo pedido (`completed <
//     requestedTotal`, ej. el tope MAX_SYMBOLS del servidor, o un fallo que
//     interrumpió el encadenamiento con filas ya guardadas — ver la nota de
//     "failed" arriba, ese caso ya cae en "failed" por `publishable:false`
//     antes de llegar aquí).
//   - "complete": publicable, sin degradación, y cubrió como mínimo lo
//     pedido.
//
// Pura, sin IO — fácil de testear con los cuatro casos por separado.
export function classifyScanOutcome(input = {}) {
  const cancelled = Boolean(input?.cancelled) || String(input?.status || "").trim().toLowerCase() === "cancelled";
  if (cancelled) return "cancelled";
  if (!input?.publishable) return "failed";
  const requestedTotal = Number.isFinite(input?.requestedTotal) ? input.requestedTotal : null;
  const completed = Number.isFinite(input?.completed) ? input.completed : 0;
  const coverageGap = requestedTotal !== null && requestedTotal > 0 && completed < requestedTotal;
  if (input?.degraded || coverageGap) return "partial";
  return "complete";
}

// Texto literal del "finishLabel" que app/page.jsx antepone al resumen final
// del escaneo. Extraído a función pura para poder testear el texto exacto sin
// montar el componente (mismo criterio que analyzedCountForDisplay/
// userFacingScanError en lib/screenerFormat.js).
export function scanOutcomeLabel(outcome, { rawRowsCount = 0 } = {}) {
  switch (outcome) {
    case "cancelled":
      return `Cancelado · ${rawRowsCount} filas conservadas`;
    case "failed":
      return `Fallido · ${rawRowsCount} filas conservadas`;
    case "partial":
      return "Parcial · muestra, no el universo completo";
    case "complete":
    default:
      return "Completado";
  }
}
