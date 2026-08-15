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
// ESCRITURA EN TANDAS (docs/finalizacion-percentiles-2026-08-11.md,
// docs/finalizacion-percentiles-tandas-2026-08-11.md): hasta aquí, un scan de
// 9.920 filas moría con "canceling statement due to statement timeout" (límite
// de 8s del rol authenticator) porque finalize_scan_results aplicaba las
// 9.920 filas en un ÚNICO UPDATE — cada fila obliga a Postgres a descomprimir
// el `metrics` viejo (27,5 KB de texto de media), fusionarlo con el patch y
// recomprimirlo; 9.920 filas son ~272 MB de ese trabajo en una sola sentencia,
// sin poder pararse a mitad.
//
// finalizeResultsInBatches trocea SOLO la ESCRITURA (ver FINALIZE_PATCH_BATCH_SIZE
// más abajo): sigue habiendo una única llamada a finalize_scan_results por
// tanda, pero varias tandas en vez de una. Esto SACRIFICA la atomicidad
// "todo o nada" que tenía el diseño anterior (documentado más abajo en el
// JSDoc de finalizeScanResultsInDb) a cambio de terminar sin cruzar el límite
// de 8s: es la decisión explícita de esta tarea, no un descuido.
//
// LECTURA EN TANDAS (cierra el riesgo que quedó abierto al trocear solo la
// escritura): la fila del escaneo de 9.920 filas registró
// finalizationBatchesDone/Total en NULL — murió ANTES de contar las tandas de
// escritura, así que el que se agotaba era el paso de LECTURA:
// scan_finalize_inputs leía `raw` + `metrics` de las 9.920 filas de golpe
// (19.928 + 27.473 = 47.401 B de texto por fila ≈ 470 MB) contra un
// statement_timeout de 8 s.
//
// La RPC solo aceptaba `p_max_rows` (un TOPE desde el principio, no un rango),
// así que trocear la lectura exigía una migración:
// supabase/migrations/20260811150000_scan_finalize_inputs_read_pagination.sql
// añade `p_offset integer default 0` (+ desempate por id en el ORDER BY, para
// que el orden sea total y la paginación determinista). Con el default, una
// llamada de 3 argumentos sigue devolviendo exactamente lo de antes.
// readFinalizeInputsInBatches (más abajo) pagina con FINALIZE_READ_BATCH_SIZE.
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

// Tamaño de tanda para la ESCRITURA (finalize_scan_results). 100 filas, no 50
// (RESULT_BATCH_SIZE de lib/serverScanRunner.js) ni 500.
//
// Por qué 100 y no menos: `metrics` pesa 27,5 KB de texto de media (medido
// sobre el scan real que falló, docs/finalizacion-percentiles-2026-08-11.md
// Parte C.1) y el UPDATE de finalize_scan_results tiene que descomprimirlo,
// fusionarlo y recomprimirlo por fila — SIN escribir índices nuevos (ningún
// índice de scan_results cubre `metrics`, y ninguna columna indexada cambia,
// así que aplica HOT-update). Es más barato por fila que un INSERT de fila
// completa, que sí toca 9 índices. Con eso como referencia: un lote de 100
// filas son ~2,75 MB de texto — bien por debajo del lote de 50 filas de fila
// COMPLETA (raw+metrics+escalares, ~48 KB/fila = 2,4 MB) que ya se probó
// seguro (máximo medido 4.070 ms, muy por debajo del límite de 8s;
// docs/medicion-scan-timing-98pct-2026-08-10.txt).
//
// Por qué 100 y no más: no hay medición directa del coste de ESTE UPDATE en
// concreto (es la limitación documentada en "LO QUE NO HE VERIFICADO" de
// docs/finalizacion-percentiles-2026-08-11.md). Ante esa incertidumbre, un
// lote más grande (p.ej. 500 filas ≈ 13,75 MB) reduciría las llamadas RPC
// pero perdería el margen amplio pedido; 100 deja de sobra sitio para que el
// coste real por fila resulte peor que el de un INSERT sin perder por eso el
// margen de seguridad frente al límite de 8s.
export const FINALIZE_PATCH_BATCH_SIZE = 100;

// Tamaño de tanda para la LECTURA (scan_finalize_inputs). 50 filas — la MITAD
// del lote de escritura, deliberadamente.
//
// Por qué la mitad y no lo mismo: la escritura se troceó a 100 filas porque
// finalize_scan_results solo toca `metrics` (27.473 B de texto/fila → ~2,75 MB
// por lote de 100). La lectura mueve `raw` Y `metrics` de cada fila para
// extraer 25 valores: 19.928 + 27.473 = 47.401 B/fila, casi el DOBLE por fila
// (docs/finalizacion-percentiles-2026-08-11.md Parte C.1). A 50 filas, un lote
// de lectura son ~2,37 MB de texto JSON a descomprimir y parsear — el MISMO
// orden de magnitud de bytes por llamada que el lote de escritura ya elegido, e
// igual al único lote de ~2,4 MB que está MEDIDO como seguro en este proyecto
// (los lotes de 50 filas COMPLETAS del scoring, ~48 KB/fila: máximo medido
// 4.070 ms, muy por debajo del límite de 8 s;
// docs/medicion-scan-timing-98pct-2026-08-10.txt).
//
// Contra el único dato directo que hay del coste de ESTA lectura: la entrada de
// pg_stat_statements de scan_finalize_inputs marca 298 ms para un escaneo
// pequeño de 50-99 filas (docs/finalizacion-percentiles-2026-08-11.md Parte
// A.4) — ese tiempo incluye el coste fijo de la llamada, así que 50 filas por
// tanda quedan en ese mismo orden (~0,3 s), ~25× por debajo del límite de 8 s.
//
// Por qué no menos: 9.920 filas / 50 = 199 llamadas RPC secuenciales. Bajar a
// 25 duplicaría las idas y vueltas de red sin necesidad — el margen a 50 ya es
// amplio. Por qué no más: el coste real por fila de la lectura no está medido a
// esta escala (lo único medido es un escaneo de dos órdenes de magnitud menos
// filas), y el fallo que se está arreglando es precisamente haber supuesto que
// una lectura "solo lee" y por tanto cabía.
export const FINALIZE_READ_BATCH_SIZE = 50;

// Normaliza la respuesta de scan_finalize_inputs: PostgREST devuelve el jsonb
// suelto o envuelto en un array de una fila según el prefer header.
function unwrapReadPayload(payload) {
  const record = Array.isArray(payload) ? (payload[0] || {}) : (payload || {});
  const inputs = Array.isArray(record.inputs) ? record.inputs : [];
  const rowsRead = Number(record.rowsRead);
  return { inputs, rowsRead: Number.isFinite(rowsRead) ? rowsRead : inputs.length };
}

/**
 * Lee los inputs de la finalización EN TANDAS de `readBatchSize` filas, vía
 * scan_finalize_inputs con `p_offset` (migración 20260811150000).
 *
 * Corte del bucle: una página que devuelve MENOS filas de las pedidas es la
 * última (LIMIT/OFFSET sobre un orden total: si no llenó la página, no queda
 * nada detrás). `maxRows` sigue siendo el tope GLOBAL del scan, no el de una
 * página: se reparte entre páginas y detiene el bucle al alcanzarlo.
 *
 * Fallo a mitad: propaga un Error con `.finalizationPhase = "read"`,
 * `.readBatchesDone` y `.rowsRead` (cuánto se había leído), y `.cause`. No se
 * escribe NADA en ese caso — la escritura empieza después de leerlo todo, así
 * que un fallo de lectura deja la base intacta y el scan en failed.
 *
 * @returns {Promise<{rows: Array<{id: string, raw: object}>, rowsRead: number, readBatchesDone: number}>}
 */
async function readFinalizeInputsInBatches(scanId, ownerId, {
  maxRows,
  readBatchSize,
  onReadProgress,
}) {
  const rows = [];
  let rowsRead = 0;
  let readBatchesDone = 0;
  while (rows.length < maxRows) {
    const pageSize = Math.min(readBatchSize, maxRows - rows.length);
    let page;
    try {
      page = unwrapReadPayload(await supabaseRpc("scan_finalize_inputs", {
        p_owner_id: ownerId,
        p_scan_id: scanId,
        p_max_rows: pageSize,
        p_offset: rows.length,
      }));
    } catch (readError) {
      const partialError = new Error(
        `percentile finalization failed reading inputs at batch ${readBatchesDone + 1} `
        + `(${rows.length} filas leídas): ${readError.message || "desconocido"}`,
      );
      partialError.finalizationPhase = "read";
      partialError.readBatchesDone = readBatchesDone;
      partialError.rowsRead = rows.length;
      partialError.cause = readError;
      throw partialError;
    }
    readBatchesDone += 1;
    rowsRead += page.rowsRead;
    rows.push(...page.inputs);
    if (onReadProgress) {
      onReadProgress({ readBatchesDone, rowsRead: rows.length, readBatchSize: pageSize });
    }
    // Página incompleta = última página. También corta si la RPC devolviera 0
    // filas (scan vacío o offset más allá del final), evitando un bucle infinito.
    if (page.inputs.length < pageSize) break;
  }
  return { rows, rowsRead, readBatchesDone };
}

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
    // (riskScore, growthScore, demandScore, epsGrowthProxyScore además de los
    // ya existentes setupQualityScore, rsQualityScore, adProxyScore,
    // riskRewardScore, momentumScore). La RPC sigue proyectando también
    // `ipoScore` —no hace falta migrarla— pero ya no es término del composite.
    // objectiveScore vs compositeScore: en lib/screenerPipeline.js:335-336 el
    // composite objetivo recibe objectiveSetupScore (setup SIN bonus de
    // patrón) y el composite legacy recibe setupQualityScore (setup CON
    // bonus de patrón) — son dos llamadas con un input distinto, no la misma.
    // La RPC scan_finalize_inputs (supabase/migrations/20260710184308_*.sql)
    // todavía NO proyecta objectiveSetupScore en el thin-raw, así que hasta
    // que se extienda esa proyección, degradamos a setupQualityScore (mismo
    // valor que se usaba antes de este fix) — no es un default nuevo, es el
    // mismo fallback que ya existía para el campo ausente.
    // Términos ausentes ya NO se sustituyen por una constante: se pasa `null`
    // a scoreCompositeValue (= computeComposite = computeCompositeDetailed,
    // lib/scoringEngine.js), que los excluye del composite y redistribuye su
    // peso entre los presentes — la misma renormalización que ya usa el resto
    // del motor. Justificación completa:
    // docs/constantes-finalizacion-2026-08-07.md.
    // El caso que obligaba a pasar `null` en vez de `undefined` era ipoScore,
    // el único término con default de parámetro `= 0`. Desde el 2026-08-15 ese
    // término ya no existe en el composite y el default está eliminado, así
    // que la distinción null/undefined dejó de tener consecuencias.
    const setupQualityScore = Number.isFinite(row.setupQualityScore) ? row.setupQualityScore : null;
    const objectiveSetupScore = Number.isFinite(row.objectiveSetupScore)
      ? row.objectiveSetupScore
      : setupQualityScore;
    // EXCEPCIÓN deliberada, sin tocar: rsAnchor conserva su cadena de tres
    // niveles (rsGlobalPct -> rsRating -> 50). El nivel intermedio (rsRating)
    // es un dato real, no un relleno neutro, y hoy activa en 36 de 86 filas
    // reales (docs/constantes-finalizacion-2026-08-07.md, Parte B.4/B.6) —
    // quitarlo cambiaría el score de esas 36 filas.
    const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (Number.isFinite(row.rsRating) ? row.rsRating : 50);
    const rsQualityScore = Number.isFinite(row.rsQualityScore) ? row.rsQualityScore : rsAnchor;
    const demandScore = Number.isFinite(row.demandScore) ? row.demandScore : null;
    const adProxyScore = Number.isFinite(row.adProxyScore) ? row.adProxyScore : null;
    const growthScore = Number.isFinite(row.growthScore) ? row.growthScore : null;
    // epsAnchor hereda la ausencia de growthScore automáticamente: si ambos
    // faltan, esta línea ya no necesita cambiar — antes degradaba a
    // growthScore(0) (fabricado), ahora degrada a growthScore(null)
    // (excluido), porque growthScore ya no fabrica 0 arriba.
    const epsAnchor = Number.isFinite(row.epsGrowthProxyScore)
      ? row.epsGrowthProxyScore
      : growthScore;
    const sectorScore = Number.isFinite(row.sectorScore) ? row.sectorScore : null;
    const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : null;
    const riskScore = Number.isFinite(row.riskScore) ? row.riskScore : null;
    const momentumScore = Number.isFinite(row.momentumScore) ? row.momentumScore : null;
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
 * Orquesta la finalización: carga todas las filas del scan, recalcula
 * percentiles sobre el universo completo (en memoria, una vez), y aplica los
 * patches contra Supabase EN TANDAS de FINALIZE_PATCH_BATCH_SIZE filas,
 * secuenciales, cada una en su propia llamada RPC a `finalize_scan_results`.
 *
 * ATOMICIDAD: cada tanda es atómica en sí misma (la función Postgres la
 * envuelve en su propia transacción — o las filas de ESA tanda quedan
 * tocadas, o ninguna de ellas). Lo que YA NO es atómico es el conjunto
 * completo: si la tanda k de N falla, las tandas 1..k-1 quedan comprometidas
 * en la base y las k..N no. Es un cambio deliberado frente al diseño anterior
 * (un único UPDATE para las 9.920 filas) — ver la cabecera del archivo y
 * docs/finalizacion-percentiles-tandas-2026-08-11.md. Por eso el error que se
 * lanza en un fallo a mitad lleva `rowsPatched`/`batchesDone`/`batchesTotal`:
 * el caller (runScanChunk) los usa para persistir CUÁNTO quedó sin finalizar,
 * no solo que falló.
 *
 * LECTURA TAMBIÉN EN TANDAS: `scan_finalize_inputs` se llama una vez por página
 * de FINALIZE_READ_BATCH_SIZE filas (`p_offset`, migración 20260811150000).
 * ORDEN OBLIGATORIO: leer TODAS las páginas → juntarlas → calcular → escribir
 * en tandas. El cálculo no se puede trocear: un percentil necesita conocer el
 * rsRawComposite de TODAS las filas del scan antes de poder escribir la
 * primera (finalizeScanPercentiles llama a computeSectorScoresForRows y
 * enrichRelativePercentiles sobre el array completo, y ambos son agregados
 * sobre la población). Un fallo durante la lectura ocurre por tanto ANTES de
 * cualquier escritura: la base queda intacta y el error lleva
 * `.finalizationPhase = "read"`, `.readBatchesDone` y `.rowsRead`.
 *
 * CONTRATO:
 *  - Éxito: TODAS las tandas de escritura terminaron. Devuelve
 *    {rowsProcessed, rowsPatched, batchesTotal, batchesDone} con
 *    batchesDone === batchesTotal y rowsPatched === el total de patches.
 *  - Fallo a mitad: lanza (reject) un Error con `.rowsProcessed`,
 *    `.rowsPatched`, `.rowsTotal`, `.batchesDone`, `.batchesTotal` y `.cause`
 *    (el error original de la tanda que falló). El caller decide el status;
 *    NUNCA debe interpretarse un throw como éxito parcial válido para marcar
 *    percentilesFinalized=true.
 *  - Idempotente: re-llamar sobre un scan ya finalizado (o parcialmente
 *    finalizado) produce los mismos valores — cada tanda vuelve a calcularse
 *    desde el mismo `raw` thin (que no cambia) y sobrescribe con valores
 *    idénticos a los que ya estuvieran, incluidas las filas que ya se habían
 *    escrito en un intento anterior.
 *  - Filas con sample insuficiente quedan con percentile=null pero scope="final":
 *    la finalización se ejecutó; el null es por sample, no por falta de finalize.
 *
 * @param {string} scanId
 * @param {string} ownerId
 * @param {{maxRows?: number, minGlobalSample?: number, minScopedSample?: number,
 *   patchBatchSize?: number, readBatchSize?: number,
 *   onReadProgress?: (info: {readBatchesDone: number, rowsRead: number,
 *   readBatchSize: number}) => void,
 *   onBatchProgress?: (info: {batchesDone: number,
 *   batchesTotal: number, rowsPatched: number, rowsTotal: number}) => void}} [options]
 *   `maxRows` es el tope GLOBAL de filas del scan (se reparte entre páginas de
 *   `readBatchSize`), no el tamaño de una página.
 * @returns {Promise<{rowsProcessed: number, rowsPatched: number, batchesTotal: number, batchesDone: number}>}
 */
export async function finalizeScanResultsInDb(scanId, ownerId, options = {}) {
  if (!scanId || !ownerId) {
    throw new Error("finalizeScanResultsInDb: scanId y ownerId son requeridos");
  }
  const maxRows = Number.isFinite(options.maxRows) ? options.maxRows : FINALIZE_MAX_ROWS;
  const patchBatchSize = Number.isFinite(options.patchBatchSize) && options.patchBatchSize > 0
    ? Math.floor(options.patchBatchSize)
    : FINALIZE_PATCH_BATCH_SIZE;
  const readBatchSize = Number.isFinite(options.readBatchSize) && options.readBatchSize > 0
    ? Math.floor(options.readBatchSize)
    : FINALIZE_READ_BATCH_SIZE;
  const onBatchProgress = typeof options.onBatchProgress === "function" ? options.onBatchProgress : null;
  const onReadProgress = typeof options.onReadProgress === "function" ? options.onReadProgress : null;

  // 1. Carga las filas del scan vía la RPC scan_finalize_inputs (thin-raw
  //    projection) en vez de transferir metrics/raw completos. La RPC proyecta
  //    SOLO los campos que finalizeScanPercentiles consume (inputs de
  //    rsRawComposite, grouping keys, scores planos para contradicciones,
  //    signalCoverage) y devuelve {inputs:[{id,raw},...], rowsRead}.
  //    EN TANDAS de readBatchSize filas (p_offset) — ver
  //    readFinalizeInputsInBatches y el comentario de cabecera del archivo.
  //    Todas las páginas se juntan ANTES de calcular: el percentil necesita la
  //    población completa (ver paso 2).
  const { rows, rowsRead } = await readFinalizeInputsInBatches(scanId, ownerId, {
    maxRows,
    readBatchSize,
    onReadProgress,
  });
  if (!rows.length) {
    return { rowsProcessed: rowsRead, rowsPatched: 0, batchesTotal: 0, batchesDone: 0 };
  }

  // 2. Recomputa percentiles en memoria (pure). Necesita ver las `rows.length`
  //    filas TODAS JUNTAS para poder calcular percentiles sobre la población
  //    completa — por eso esto no se trocea: el troceo aplica solo a la
  //    escritura del resultado ya calculado, en el paso 3.
  const patches = finalizeScanPercentiles(rows, {
    minGlobalSample: options.minGlobalSample,
    minScopedSample: options.minScopedSample,
  });
  if (!patches.length) {
    return { rowsProcessed: rows.length, rowsPatched: 0, batchesTotal: 0, batchesDone: 0 };
  }

  // 3. Aplicación EN TANDAS: una llamada a finalize_scan_results por tanda de
  //    patchBatchSize filas, en orden, una detrás de otra (no en paralelo —
  //    así una tanda fallida deja claro exactamente cuántas tandas anteriores
  //    ya se comprometieron, sin ambigüedad de qué terminó antes que qué).
  const batches = [];
  for (let i = 0; i < patches.length; i += patchBatchSize) {
    batches.push(patches.slice(i, i + patchBatchSize));
  }

  let rowsPatched = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    let rpcResult;
    try {
      rpcResult = await supabaseRpc(
        "finalize_scan_results",
        {
          p_owner_id: ownerId,
          p_scan_id: scanId,
          p_patches: batch.map(({ id, metrics_patch }) => ({ id, metrics_patch })),
        },
        { prefer: "return=representation" },
      );
    } catch (batchError) {
      // Tandas 0..batchIndex-1 ya están comprometidas en la base; esta y las
      // siguientes, no. Se adjuntan al error para que el caller (runScanChunk)
      // pueda persistir el progreso real en vez de un "falló" opaco.
      const partialError = new Error(
        `percentile finalization failed at batch ${batchIndex + 1}/${batches.length} `
        + `(${rowsPatched}/${patches.length} filas ya finalizadas): ${batchError.message || "desconocido"}`,
      );
      partialError.rowsProcessed = rows.length;
      partialError.rowsPatched = rowsPatched;
      partialError.rowsTotal = patches.length;
      partialError.batchesDone = batchIndex;
      partialError.batchesTotal = batches.length;
      partialError.cause = batchError;
      throw partialError;
    }
    // La función retorna { updated_count } o un array PostgREST con ese campo.
    const updatedCount = Array.isArray(rpcResult) && rpcResult.length
      ? Number(rpcResult[0].updated_count || 0)
      : Number((rpcResult && rpcResult.updated_count) || 0);
    rowsPatched += Number.isFinite(updatedCount) ? updatedCount : batch.length;
    if (onBatchProgress) {
      onBatchProgress({
        batchesDone: batchIndex + 1,
        batchesTotal: batches.length,
        rowsPatched,
        rowsTotal: patches.length,
      });
    }
  }

  return { rowsProcessed: rows.length, rowsPatched, batchesTotal: batches.length, batchesDone: batches.length };
}
