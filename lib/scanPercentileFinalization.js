// lib/scanPercentileFinalization.js — paso de finalización de percentiles RS.
//
// Contexto: serverScanRunner procesa el universo de símbolos en batches de 50
// y calcula rsGlobalPct/rsCountryPct/rsSectorPct como percentil DENTRO de cada
// batch (vía enrichRelativePercentiles en lib/researchRow.js durante el scoring).
// Eso es correcto para el render progresivo, pero el percentil almacenado es
// batch-local. Este módulo recalcula los 3 percentiles como percentil sobre el
// rsRawComposite de TODAS las filas del scan completo, una vez completado el
// último batch de scoring, y los reescribe en DB marcándolos como "final".
//
// Atomicidad: cada fila se actualiza con sus 3 percentiles nuevos Y
// percentileScope: "final" en el mismo PATCH. Si el sweep se interrumpe a
// mitad, status queda no-terminal ("running"/"finalizing") y una retoma
// (dead-link) re-ejecuta el flujo completo; es idempotente.
//
// NO se toca coveragePct, rsRawComposite (ya está por fila desde su batch
// original, solo se recalcula el percentil). SÍ se evalúan contradicciones de
// señales (C1-C6) en este paso: se ejecutan DESPUÉS de que los percentiles sean
// finales para esa fila, usando el rsGlobalPct ya recalculado (regla C3 lee
// rsGlobalPct). El resultado (signalContradictions/contradictionsSkipped) se
// escribe en el mismo PATCH que percentileScope:"final" — atomicidad por fila.

import { enrichRelativePercentiles } from "@/lib/relativeStrength";
import { evaluateContradictions } from "@/lib/signalContradictions";
import { supabaseRequestAll, supabaseRpc } from "@/lib/supabaseServer";

// Tope de filas cargadas por scan; los jobs reales son 20-100 filas, este es un
// margen holgado. supabaseRequestAll pagina internamente.
export const FINALIZE_MAX_ROWS = 50000;

/**
 * Recalcula los 3 percentiles RS sobre el universo completo del scan y evalúa
 * las contradicciones de señales C1-C6.
 *
 * PURE: sin Supabase, sin IO. Toma filas DB crudas ({id, metrics, raw, ...}),
 * deserializa `raw` para extraer los campos que rsRawComposite/enrichRelativePercentiles
 * consumen (perf3m, rs3m, distance52w, country, theme, sector, etc.), ejecuta el
 * recompute y devuelve un patch por fila: {id, metrics_patch} con los 3 percentiles
 * reescritos + percentileScope: "final" + signalContradictions +
 * contradictionsSkipped (juntos, para atomicidad por fila).
 *
 * Contradicciones: se evalúan sobre la fila enriquecida (con rsGlobalPct FINAL),
 * usando los scores planos que viven en `raw` y signalCoverage que también vive
 * en `raw` (poblado por los 3 pipelines durante el scoring batch). Reglas C1-C6
 * declaradas en lib/signalContradictions.js. Si una señal implicada está
 * partial:true (vía signalCoverage), la regla va a contradictionsSkipped con
 * reason "partial:<key>".
 *
 * Idempotente: llamarlo dos veces sobre el mismo set produce el mismo resultado
 * (las contradicciones son determinísticas dada la misma fila).
 *
 * @param {Array<{id: string, metrics?: object, raw?: object}[]>} dbRows - filas de scan_results.
 * @param {{minGlobalSample?: number, minScopedSample?: number}} [options] - umbrales (pasados a enrichRelativePercentiles).
 * @returns {Array<{id: string, metrics_patch: object}>} - patch por fila para escribir con PATCH.
 */
export function finalizeScanPercentiles(dbRows = [], options = {}) {
  if (!Array.isArray(dbRows) || !dbRows.length) return [];
  // Deserializa `raw` para que enrichRelativePercentiles/rsRawComposite lean los
  // campos del preparedRow. Mantenemos id y referencias a la fila original.
  // signalCoverage + scores planos viajan dentro de `raw`, así que sobreviven al
  // spread: la fila enriquecida los conserva para evaluateContradictions.
  const enriched = enrichRelativePercentiles(
    dbRows.map((row) => ({ id: row.id, ...(row.raw || {}), metrics: row.metrics || {} })),
    options,
  );
  return enriched.map((row) => {
    // percentileScope del patch es "final" (la finalización se ejecutó, incluso
    // si rsGlobalPct quedó null por sample insuficiente). Las contradicciones
    // heredan este scope: reflejan el estado post-finalización de la fila.
    const patchScope = "final";
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions({
      ...row,
      percentileScope: patchScope,
    });
    return {
      id: row.id,
      metrics_patch: {
        // Conservamos el resto de metrics (scanDecisionMetrics, decisionTrace, etc.)
        // y sobreescribimos SOLO los 3 percentiles + samples + scope + contradicciones.
        // Atomicidad por fila: percentiles nuevos, scope "final" y contradicciones
        // en el mismo PATCH.
        ...row.metrics,
        rsGlobalPct: row.rsGlobalPct,
        rsGlobalSample: row.rsGlobalSample,
        rsCountryPct: row.rsCountryPct,
        rsCountrySample: row.rsCountrySample,
        rsSectorPct: row.rsSectorPct,
        rsSectorSample: row.rsSectorSample,
        percentileScope: patchScope,
        signalContradictions,
        contradictionsSkipped,
      },
    };
  });
}

/**
 * Orquesta la finalización ATÓMICA: carga todas las filas del scan, recalcula
 * percentiles sobre el universo completo, y aplica TODOS los patches en una
 * sola llamada RPC a la función PL/pgSQL `finalize_scan_results`.
 *
 * ATOMICIDAD: la función Postgres hace un único UPDATE masivo dentro de una
 * transacción. Si algo falla (timeout, error SQL, payload inválido), la
 * transacción revierte y NINGUNA fila queda tocada — estado mixto imposible.
 * El caller (runScanChunk) recibe el throw y marca el scan como error.
 *
 * CONTRATO:
 *  - Lanza (reject) si cualquier paso falla. El caller decide el status:
 *    status="done" si OK (rowsPatched > 0), status="error" si lanza.
 *  - Idempotente: re-llamar sobre un scan ya finalizado produce los mismos
 *    valores (el UPDATE sobreescribe con idénticos).
 *  - Filas con sample insuficiente quedan con percentile=null pero scope="final":
 *    la finalización se ejecutó; el null es por sample, no por falta de finalize.
 *
 * @param {string} scanId
 * @param {string} ownerId
 * @param {{maxRows?: number, minGlobalSample?: number, minScopedSample?: number}} [options]
 * @returns {Promise<{rowsProcessed: number, rowsPatched: number}>}
 */
export async function finalizeScanResultsInDb(scanId, ownerId, options = {}) {
  if (!scanId || !ownerId) {
    throw new Error("finalizeScanResultsInDb: scanId y ownerId son requeridos");
  }
  const maxRows = Number.isFinite(options.maxRows) ? options.maxRows : FINALIZE_MAX_ROWS;

  // 1. Carga todas las filas del scan con su id (PK) + metrics + raw.
  //    supabaseRequestAll pagina internamente hasta maxRows.
  const rows = await supabaseRequestAll(
    "scan_results",
    {
      query: `scan_id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id,metrics,raw&order=rank_index.asc`,
    },
    { maxRows },
  );
  if (!Array.isArray(rows) || !rows.length) {
    return { rowsProcessed: 0, rowsPatched: 0 };
  }

  // 2. Recomputa percentiles en memoria (pure).
  const patches = finalizeScanPercentiles(rows, {
    minGlobalSample: options.minGlobalSample,
    minScopedSample: options.minScopedSample,
  });
  if (!patches.length) {
    return { rowsProcessed: rows.length, rowsPatched: 0 };
  }

  // 3. Aplicación ATÓMICA: una sola RPC a finalize_scan_results (PL/pgSQL).
  //    La función Postgres envuelve el UPDATE masivo en una transacción; si
  //    revierte, ninguna fila queda tocada. Esto elimina el riesgo de estado
  //    mixto "final"/"batch" que tenía el patrón anterior de PATCHes individuales.
  const rpcResult = await supabaseRpc(
    "finalize_scan_results",
    {
      p_owner_id: ownerId,
      p_scan_id: scanId,
      p_patches: patches.map(({ id, metrics_patch }) => ({ id, metrics_patch })),
    },
    { prefer: "return=representation" },
  );

  // La función retorna { updated_count } o un array PostgREST con ese campo.
  const updatedCount = Array.isArray(rpcResult) && rpcResult.length
    ? Number(rpcResult[0].updated_count || 0)
    : Number((rpcResult && rpcResult.updated_count) || 0);

  return { rowsProcessed: rows.length, rowsPatched: Number.isFinite(updatedCount) ? updatedCount : patches.length };
}