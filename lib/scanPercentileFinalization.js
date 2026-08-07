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
//
// sectorScore final-time (fase 1 del ADR de consolidación, audit 2026-07-10
// hallazgo C2): sectorScore también se calcula en este paso, sobre la
// población completa del scan (mismo tratamiento que RS), no por lote local.
// El bonus temático hardcodeado +20/+10 eliminado — la señal es 100%
// basada en datos reales del grupo (ver lib/screenerComposite.js). Como
// sectorScore alimenta objectiveScore/compositeScore y estos se calcularon
// en batch con el sectorScore LOCAL, también los recalculamos aquí con el
// sectorScore FINAL — cierra el sub-caso C3 del audit para esta señal.
// Se añaden al mismo patch atómico: sectorScore, objectiveScore,
// compositeScore + alias groupStrengthScore.
//
// READ thin: finalizeScanResultsInDb carga las filas vía la RPC
// scan_finalize_inputs (supabase/migrations/*_scan_finalize_inputs.sql) que
// proyecta SOLO los campos que el pure helper consume (inputs de
// rsRawComposite, grouping keys, scores planos para contradicciones y para
// recomputar el composite, signalCoverage), dropeando
// chartPreview/growthMetrics/decisionTrace. El patch ya NO incluye el echo
// `...row.metrics`: la RPC finalize_scan_results mergea en Postgres
// (sr.metrics || src.metrics_patch), así que el echo era redundante.

import { enrichRelativePercentiles } from "@/lib/relativeStrength";
import { scoreCompositeValue } from "@/lib/scoring";
import { applySectorScores, computeSectorScoresForRows } from "@/lib/screenerComposite";
import { evaluateContradictions } from "@/lib/signalContradictions";
import { supabaseRpc } from "@/lib/supabaseServer";

// Tope de filas cargadas por scan; los jobs reales son 20-100 filas, este es un
// margen holgado. La RPC scan_finalize_inputs aplica el limit en Postgres.
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
 *   `raw` lleva los inputs (rsRawComposite + grouping + scores + signalCoverage).
 *   `metrics` es opcional: si se incluye, su contenido se mergea en el patch
 *   (echo). En el path en caliente (scan_finalize_inputs) NO se incluye — la RPC
 *   finalize_scan_results ya mergea en Postgres y el echo sería redundante. Los
 *   fixtures de test pueden incluirlo para verificar el merge explícito.
 * @param {{minGlobalSample?: number, minScopedSample?: number}} [options] - umbrales (pasados a enrichRelativePercentiles).
 * @returns {Array<{id: string, metrics_patch: object}>} - patch por fila para escribir con PATCH.
 */
export function finalizeScanPercentiles(dbRows = [], options = {}) {
  if (!Array.isArray(dbRows) || !dbRows.length) return [];
  // 1. sectorScore sobre la POBLACIÓN COMPLETA del scan (audit C2 + ADR fase 1).
  //    Se calcula ANTES de enrichRelativePercentiles: las filas que entran al
  //    sectorize ya tienen theme/perf3m/perf6m/weinsteinScore/minerviniScore
  //    desde el spread de `raw` (ver scan_finalize_inputs RPC). Esto cierra
  //    el sub-punto C2(a) del audit: la señal deja de medirse sobre el lote
  //    local del scoring.
  const sectorScoresByKey = computeSectorScoresForRows(
    dbRows.map((row) => ({ id: row.id, ...(row.raw || {}) })),
  );
  // 2. Aplicar sectorScore (groupStrengthScore se mantiene como alias histórico).
  //    El orden importa: primero sectorScore (porque objectiveScore depende
  //    de él), luego enrichRelativePercentiles (que añade los percentiles RS
  //    finales a la misma fila). Sobre la fila resultante ya podemos
  //    recomputar objectiveScore/compositeScore en el callback final.
  const rowsWithSector = applySectorScores(
    dbRows.map((row) => ({ id: row.id, ...(row.raw || {}), metrics: row.metrics || {} })),
    sectorScoresByKey,
  );
  const enriched = enrichRelativePercentiles(rowsWithSector, options);
  return enriched.map((row) => {
    // percentileScope del patch es "final" (la finalización se ejecutó, incluso
    // si rsGlobalPct quedó null por sample insuficiente). Las contradicciones
    // heredan este scope: reflejan el estado post-finalización de la fila.
    const patchScope = "final";
    const { signalContradictions, contradictionsSkipped } = evaluateContradictions({
      ...row,
      percentileScope: patchScope,
    });
    // Recompute del composite con sectorScore final + rsGlobalPct final.
    // Los inputs vienen del thin-raw extendido por la RPC scan_finalize_inputs
    // (riskScore, growthScore, demandScore, epsGrowthProxyScore, ipoScore
    // además de los ya existentes setupQualityScore, rsQualityScore,
    // adProxyScore, riskRewardScore, momentumScore).
    // objectiveScore vs compositeScore: en lib/screenerPipeline.js:335-336 el
    // composite objetivo recibe objectiveSetupScore (setup SIN bonus de
    // patrón) y el composite legacy recibe setupQualityScore (setup CON
    // bonus de patrón) — son dos llamadas con un input distinto, no la misma.
    // La RPC scan_finalize_inputs (supabase/migrations/20260710184308_*.sql)
    // todavía NO proyecta objectiveSetupScore en el thin-raw, así que hasta
    // que se extienda esa proyección, degradamos a setupQualityScore (mismo
    // valor que se usaba antes de este fix) — no es un default nuevo, es el
    // mismo fallback que ya existía para el campo ausente.
    const setupQualityScore = Number.isFinite(row.setupQualityScore) ? row.setupQualityScore : 0;
    const objectiveSetupScore = Number.isFinite(row.objectiveSetupScore)
      ? row.objectiveSetupScore
      : setupQualityScore;
    const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (Number.isFinite(row.rsRating) ? row.rsRating : 50);
    const rsQualityScore = Number.isFinite(row.rsQualityScore) ? row.rsQualityScore : rsAnchor;
    const demandScore = Number.isFinite(row.demandScore) ? row.demandScore : 0;
    const adProxyScore = Number.isFinite(row.adProxyScore) ? row.adProxyScore : 0;
    const growthScore = Number.isFinite(row.growthScore) ? row.growthScore : 0;
    const epsAnchor = Number.isFinite(row.epsGrowthProxyScore)
      ? row.epsGrowthProxyScore
      : growthScore;
    const sectorScore = Number.isFinite(row.sectorScore) ? row.sectorScore : 40;
    const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;
    const riskScore = Number.isFinite(row.riskScore) ? row.riskScore : 0;
    const momentumScore = Number.isFinite(row.momentumScore) ? row.momentumScore : 0;
    const ipoScore = Number.isFinite(row.ipoScore) ? row.ipoScore : 0;
    const objectiveScore = scoreCompositeValue({
      setupQualityScore: objectiveSetupScore,
      rsAnchor,
      rsQualityScore,
      demandScore,
      adProxyScore,
      growthScore,
      epsAnchor,
      sectorScore,
      riskRewardScore,
      riskScore,
      momentumScore,
      ipoScore,
    });
    const compositeScore = scoreCompositeValue({
      setupQualityScore,
      rsAnchor,
      rsQualityScore,
      demandScore,
      adProxyScore,
      growthScore,
      epsAnchor,
      sectorScore,
      riskRewardScore,
      riskScore,
      momentumScore,
      ipoScore,
    });
    return {
      id: row.id,
      metrics_patch: {
        // El echo `...row.metrics` solo aporta cuando la fila trajo metrics
        // explícitos (fixtures de test). En el path en caliente scan_finalize_inputs
        // NO transfiere metrics (la RPC finalize_scan_results ya mergea en Postgres
        // con sr.metrics || src.metrics_patch), así que row.metrics es {} y el
        // patch lleva solo los overrides. Atomicidad por fila: percentiles nuevos,
        // sectorScore final + composite recalculado, scope "final" y
        // contradicciones en el mismo PATCH.
        ...row.metrics,
        rsGlobalPct: row.rsGlobalPct,
        rsGlobalSample: row.rsGlobalSample,
        rsCountryPct: row.rsCountryPct,
        rsCountrySample: row.rsCountrySample,
        rsSectorPct: row.rsSectorPct,
        rsSectorSample: row.rsSectorSample,
        sectorScore,
        groupStrengthScore: sectorScore,
        objectiveScore,
        compositeScore,
        totalScore: compositeScore,
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

  // 1. Carga las filas del scan vía la RPC scan_finalize_inputs (thin-raw
  //    projection) en vez de transferir metrics/raw completos. La RPC proyecta
  //    SOLO los campos que finalizeScanPercentiles consume (inputs de
  //    rsRawComposite, grouping keys, scores planos para contradicciones,
  //    signalCoverage) y devuelve {inputs:[{id,raw},...], rowsRead}.
  const rpcPayload = await supabaseRpc("scan_finalize_inputs", {
    p_owner_id: ownerId,
    p_scan_id: scanId,
    p_max_rows: maxRows,
  });
  const rows = Array.isArray(rpcPayload)
    ? (rpcPayload[0]?.inputs || [])
    : (rpcPayload?.inputs || []);
  if (!Array.isArray(rows) || !rows.length) {
    const rowsRead = Array.isArray(rpcPayload) ? (rpcPayload[0]?.rowsRead || 0) : (rpcPayload?.rowsRead || 0);
    return { rowsProcessed: rowsRead, rowsPatched: 0 };
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