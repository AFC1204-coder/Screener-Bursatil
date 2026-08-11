// lib/serverScanRunner.js — runner por eslabones del scan en servidor.
// Cada invocación (eslabón) procesa como máximo progress.chunkSize símbolos desde
// progress.cursor, con concurrencia 5, y persiste en scan_results por lotes de 50;
// si quedan pendientes, se auto-reencadena con un fetch interno a POST
// /api/scan/continue autenticado con el token del proxy.
// Barras y perfil por símbolo: se LEEN de daily_bars/fundamental_snapshots
// (withDailyBarsCache/withProfileCache, el mismo patrón que ya usa el cron en
// lib/materializedScanner.js) — Yahoo solo se pide cuando el dato falta o está
// caducado más allá de PRICE_CACHE_MAX_AGE_DAYS/PROFILE_CACHE_MAX_AGE_DAYS (ver
// esas constantes más abajo). docs/adr-scan-desde-base.md y
// docs/cobertura-base-2026-08-09.md documentan por qué y con qué cobertura.
// El estado vive en la fila de scans: settings.scanSymbols (lista completa) y
// settings.progress { status, cursor, chunkSize, completed, total, saved, errors,
// errorsTotal, nextLinkToken, ... }. `errors` son GRUPOS por motivo
// ({ reason, kind, status, count, symbols }), no una entrada por símbolo — ver
// lib/scanErrorGroups.js; `errorsTotal` conserva el recuento entero aunque los
// grupos estén topados. updated_at hace de heartbeat: si un eslabón muere, pasado
// DEAD_LINK_MS /api/scan/continue puede retomar desde el último cursor persistido.
// Cada latido del bucle de progreso persiste vía patchScan(), que solo transmite
// settings.progress (RPC scan_progress_patch, jsonb_set en Postgres) — nunca
// settings.scanSymbols, que no cambia durante la corrida (ver comentario en
// patchScan más abajo y docs/timeout-scan-universo-2026-08-09.md).
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { withProfileCache } from "@/lib/fundamentalsCache";
import { internalFetchHeaders } from "@/lib/internalAuth";
import { fetchYahooChart, fetchYahooProfile } from "@/lib/marketData";
import { benchmarkSymbolForRow } from "@/lib/relativeStrength";
import { BENCHMARK_SYMBOLS, buildResearchRow } from "@/lib/researchRow";
import { clearScansApiCache } from "@/lib/scansApiCache";
import { createScanErrorAggregator } from "@/lib/scanErrorGroups";
import { classifyProviderError } from "@/lib/scanErrors";
import { computeTerminalCompleteness } from "@/lib/scanStatus";
import { prepareScanDecisionRow, scanDecisionMetrics, scanDecisionRaw } from "@/lib/scanDecisionProjection";
import { finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";
import { sectorize } from "@/lib/screenerPipeline";
import { finiteOrNull, supabaseRequest, supabaseRpc, textOrNull } from "@/lib/supabaseServer";

export const SCAN_CONCURRENCY = 5;
export const RESULT_BATCH_SIZE = 50;
export const MAX_SYMBOLS = 10000;
// El tope de errores persistidos ya no cuenta entradas individuales: vive en
// lib/scanErrorGroups.js como MAX_STORED_ERROR_GROUPS (25 grupos por motivo,
// 20 símbolos de ejemplo cada uno). Sustituye al viejo MAX_STORED_ERRORS = 300,
// que reescribía ~48 KiB de texto repetido en cada latido de progreso.
export const FLUSH_INTERVAL_MS = 1500;
// Cada cuántas tandas de escritura de la finalización de percentiles se
// persiste un PATCH de progreso intermedio (ver onFinalizeBatchProgress más
// abajo). Con FINALIZE_PATCH_BATCH_SIZE=100 (lib/scanPercentileFinalization.js)
// un scan de ~10.000 filas son ~100 tandas de escritura; reportar cada una
// añadiría ~100 idas y vueltas de red solo para progreso. Cada 10 tandas
// (~1.000 filas) da visibilidad real sin ese coste.
export const FINALIZE_PROGRESS_PATCH_EVERY = 10;
// ~3-4 min por eslabón con concurrencia 5 y caché caliente. Override por scan
// vía body.chunkSize en POST /api/scan (se persiste en progress.chunkSize).
export const DEFAULT_SCAN_CHUNK_SIZE = 300;
export const MIN_SCAN_CHUNK_SIZE = 10;
export const MAX_SCAN_CHUNK_SIZE = 1000;
export const DEAD_LINK_MS = 10 * 60 * 1000;

// Caducidad de la caché al leer barras/perfil (docs/adr-scan-desde-base.md,
// Parte B.6): el escaneo interactivo debe aceptar el cierre anterior, no exigir
// el precio del momento — usamos los mismos umbrales que el cron aplica
// hoy (lib/materializedScanner.js), no un valor inventado para esta tarea.
//   - Barras: 5 días. Coincide con DEFAULT_MAX_AGE_DAYS de
//     lib/dailyBarsCache.js y con DEFAULT_PRICE_FRESHNESS_DAYS de
//     lib/screenerFilterCatalog.js (el mismo umbral que ya gobierna en el
//     resto del producto qué cuenta como "precio fresco") — tolera un fin
//     de semana normal (barra del viernes leída el lunes = 3 días) sin
//     caer a descarga en vivo.
//   - Perfil: 14 días. El cron NO usa el default del propio módulo de
//     perfil (7 días, lib/fundamentalsCache.js) — lo amplía a 14
//     (DEFAULT_FUNDAMENTALS_AGE_DAYS, lib/materializedScanner.js) porque
//     sector/industria/fundamentales no cambian en un par de semanas.
//     docs/cobertura-base-2026-08-09.md midió perfiles reales con 1,5-2,5
//     meses de antigüedad y todos los campos seguían completos y
//     utilizables — consistente con un umbral más laxo que el de barras.
export const PRICE_CACHE_MAX_AGE_DAYS = 5;
export const PROFILE_CACHE_MAX_AGE_DAYS = 14;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeSymbols(symbols = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(symbols) ? symbols : []) {
    const symbol = String(item?.symbol || item || "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

export function clampChunkSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SCAN_CHUNK_SIZE;
  return Math.min(Math.max(Math.round(n), MIN_SCAN_CHUNK_SIZE), MAX_SCAN_CHUNK_SIZE);
}

export function resultPayload(row = {}, scanId, ownerId, rankIndex, settingsOrExplanation = {}) {
  const preparedRow = prepareScanDecisionRow(row, settingsOrExplanation);
  return {
    owner_id: ownerId,
    scan_id: scanId,
    symbol: textOrNull(preparedRow.symbol) || "-",
    company_name: textOrNull(preparedRow.companyName || preparedRow.symbol),
    country: textOrNull(preparedRow.country),
    sector: textOrNull(preparedRow.sector),
    industry: textOrNull(preparedRow.industry),
    theme: textOrNull(preparedRow.theme),
    rank_index: rankIndex,
    total_score: finiteOrNull(preparedRow.totalScore),
    weinstein_score: finiteOrNull(preparedRow.weinsteinScore),
    minervini_score: finiteOrNull(preparedRow.minerviniScore),
    risk_score: finiteOrNull(preparedRow.riskScore),
    rs_rating: finiteOrNull(preparedRow.rsGlobalPct ?? preparedRow.rsRating),
    metrics: scanDecisionMetrics(preparedRow),
    // scanDecisionRaw, no preparedRow: poda de escritura (chartPreview compacto
    // y sin las copias de objectiveMetricAudit/decisionTrace que ya van en
    // metrics). Ver el comentario de scanDecisionRaw en
    // lib/scanDecisionProjection.js y docs/flushbatches-timeout-2026-08-10.md.
    raw: scanDecisionRaw(preparedRow),
  };
}

export function scoreRowsForServerScan(rows = []) {
  return sectorize(Array.isArray(rows) ? rows : []);
}

// Persiste SOLO settings.progress + row_count — nunca la fila `scans` entera.
// Antes, cada latido del bucle de progreso (cada ~1,5-3s durante todo el
// eslabón) hacía un PATCH con body `{...settings, progress: {...}}`, que
// PostgREST traduce en un UPDATE que reemplaza la columna `settings` COMPLETA
// — incluida settings.scanSymbols, la lista de símbolos del universo pedido,
// que no cambia durante la corrida. Medido contra un scan real de 5.864
// símbolos: settings completo pesaba 59.688 bytes, 44.575 (75%) solo
// scanSymbols (docs/timeout-scan-universo-2026-08-09.md). Con "todo el
// universo" (~10.000 símbolos) ese payload se re-serializaba y retransmitía
// entero varias veces por minuto durante toda la corrida.
//
// La RPC scan_progress_patch (supabase/migrations/20260809160000_scan_progress_patch.sql)
// hace el merge del lado de Postgres via jsonb_set: el cliente solo transmite
// `progress` (unos pocos KB), scanSymbols nunca vuelve a viajar por red tras
// la creación del scan. Si esa migración aún no está desplegada (PostgREST
// responde 404, "could not find the function"), se degrada al PATCH completo
// de antes — el scan sigue funcionando, solo pierde la optimización.
// Cualquier otro error (incluido un timeout real) se propaga tal cual:
// reintentar con un PATCH todavía más pesado no tiene sentido si la RPC ya
// falló por otra razón.
async function patchScan(scanId, ownerId, { rowCount, progress, fallbackSettings } = {}) {
  const rowCountValue = Number.isFinite(rowCount) ? rowCount : null;
  try {
    await supabaseRpc("scan_progress_patch", {
      p_id: scanId,
      p_owner_id: ownerId,
      p_progress: progress,
      p_row_count: rowCountValue,
    });
  } catch (error) {
    if (error?.status !== 404) throw error;
    await supabaseRequest("scans", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
      prefer: "return=minimal",
      body: {
        row_count: rowCountValue,
        settings: { ...fallbackSettings, progress },
        updated_at: new Date().toISOString(),
      },
    });
  }
  clearScansApiCache();
}

// Lee SOLO settings.progress.cancelRequested — un booleano — con una ruta JSON
// en el select de PostgREST, no la columna `settings` entera.
//
// Antes pedía `select=settings`, que trae el JSON completo con
// settings.scanSymbols dentro: los 10.000 símbolos del universo (~84 KB
// medidos, ver docs/timeout-tres-minutos-2026-08-10.md) para leer un booleano.
// Y se llama DOS veces por vuelta del bucle de progreso, unas 170 veces por
// corrida del universo completo: ~14 MB serializados por PostgREST,
// transmitidos y parseados por Node que no servían para nada.
//
// `settings->progress->cancelRequested` (flecha simple, no `->>`) devuelve el
// valor JSON nativo: true, false o null si el campo no existe. Con `->>`
// llegaría el string "false", y `Boolean("false")` es true — de ahí la
// comparación estricta de abajo en vez de un Boolean() genérico.
//
// AVISO sobre el alcance de esta mejora: Postgres sigue teniendo que leer y
// descomprimir la columna `settings` completa para poder aplicar el operador
// `->` (jsonb no admite lectura parcial). Lo que este cambio elimina es la
// serialización en PostgREST, el tráfico de red y el parseo en Node — no el
// coste de leer el TOAST del lado del servidor. Ver la sección de medición del
// documento citado.
async function readCancelRequested(scanId, ownerId) {
  const [scan] = await supabaseRequest("scans", {
    query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=cancelRequested:settings->progress->cancelRequested&limit=1`,
  });
  // Tolera el flag escrito como string por si alguna vía externa lo pusiera
  // así; el código propio (app/api/scan/cancel/route.js) siempre escribe un
  // booleano.
  return scan?.cancelRequested === true || scan?.cancelRequested === "true";
}

// Hidrata los benchmarks de precio que el scan necesita para calcular
// rsRating (RS vs benchmark local). SPY/QQQ/ACWI son los globales que ya se
// hidrataban antes. Además, recorre los símbolos del eslabón actual, calcula
// benchmarkSymbolForRow para cada uno (ej. ^IBEX para una fila española,
// ^GDAXI para alemana, ^N225 para japonesa), deduplica y los añade. Sin esto,
// cualquier fila de un mercado no-US cae en rsBenchmarkIssue:"benchmark
// insuficiente" y rsRating:null aunque el proveedor tuviera la serie.
// Si un benchmark local falla al hidratarse (proveedor caído), NO tumba el
// scan: degrada a bars:[] igual que antes — scoreRelativeStrength ya emite
// rsRating:null con rsBenchmarkIssue para esa fila, y el contrato de
// completitud (scanStatus.js) clasifica la fila como parcial, no como error
// del scan. No se hidratan benchmarks que ningún símbolo del batch necesite.
// Deliberadamente SIN pasar por withDailyBarsCache: son ~1-10 símbolos por
// tramo (SPY/QQQ/ACWI + benchmarks locales), no miles — fuera del alcance de
// docs/adr-scan-desde-base.md, que acota el cambio al punto que sí escala con
// el tamaño del universo (el bucle principal de abajo).
async function loadBenchmarks(symbols = []) {
  const localNeeded = new Set();
  for (const symbol of symbols) {
    const bench = benchmarkSymbolForRow({ symbol });
    if (!BENCHMARK_SYMBOLS.includes(bench)) localNeeded.add(bench);
  }
  const all = [...BENCHMARK_SYMBOLS, ...localNeeded];
  const entries = await Promise.all(all.map(async (symbol) => {
    try {
      return [symbol, await fetchYahooChart(symbol)];
    } catch {
      return [symbol, { bars: [] }];
    }
  }));
  return Object.fromEntries(entries);
}

// Lanza el siguiente eslabón. El route /api/scan/continue responde 202 y procesa en
// after(), así que este await es corto y no encadena la vida de las lambdas.
async function chainNextLink({ baseUrl, scanId, linkToken }) {
  const res = await fetch(`${baseUrl}/api/scan/continue`, {
    method: "POST",
    headers: internalFetchHeaders(),
    body: JSON.stringify({ scanId, linkToken }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `continue HTTP ${res.status}`);
  }
}

// Procesa UN eslabón del scan: lee el estado de la fila, avanza el cursor hasta
// chunkSize símbolos y termina marcando done/cancelled, o re-encadenando.
export async function runScanChunk({ scanId, ownerId, baseUrl }) {
  let snapshot = null;
  try {
    [snapshot] = await supabaseRequest("scans", {
      query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=settings,row_count&limit=1`,
    });
  } catch (error) {
    console.error("[scan-runner] no se pudo leer el estado inicial", {
      scanId,
      ownerId,
      error: error.message || String(error),
    });
    return;
  }
  if (!snapshot) return;
  const settings = snapshot.settings || {};
  const progress = settings.progress || {};
  const symbols = Array.isArray(settings.scanSymbols) ? settings.scanSymbols : [];
  const startCursor = Math.min(Math.max(0, Math.round(Number(progress.cursor) || 0)), symbols.length);
  const chunkSize = clampChunkSize(progress.chunkSize);
  const chunkEnd = Math.min(startCursor + chunkSize, symbols.length);
  const startedAt = progress.startedAt || new Date().toISOString();
  const linkIndex = (Number(progress.link) || 0) + 1;
  const state = {
    completed: startCursor,
    insertedCount: Number(snapshot.row_count || 0),
    currentSymbol: progress.currentSymbol || "",
    // Errores AGRUPADOS POR MOTIVO (lib/scanErrorGroups.js), no una entrada por
    // símbolo: `progress.errors` viaja entero en cada latido y el texto del
    // motivo se repetía idéntico en cientos de entradas. Se siembra con lo que
    // dejó el eslabón anterior (grupos + total) para no perder el recuento al
    // reencadenar; acepta también el formato plano antiguo de un scan que
    // empezó antes de este cambio.
    errors: createScanErrorAggregator(progress.errors, progress.errorsTotal),
    kindBreakdown: { retryable: 0, terminal: 0, unknown: 0 },
    buffer: [],
    workersDone: false,
    cancelRequested: Boolean(progress.cancelRequested),
  };
  // Devuelve SOLO el objeto progress (no `{...settings, progress}`) — patchScan
  // ya no necesita la fila entera, ver su comentario arriba.
  const progressPayload = (status, extra = {}) => ({
    status,
    cursor: state.completed,
    chunkSize,
    link: linkIndex,
    completed: state.completed,
    total: symbols.length,
    saved: state.insertedCount,
    currentSymbol: state.currentSymbol,
    cancelRequested: state.cancelRequested,
    errors: state.errors.groups(),
    // Recuento entero de símbolos fallidos: los grupos y sus listas de símbolos
    // están topados, este número no. Es lo que leen el contrato de completitud
    // y la UI para decir "errores N".
    errorsTotal: state.errors.total,
    startedAt,
    updatedAt: new Date().toISOString(),
    nextLinkToken: null,
    ...extra,
  });
  try {
    // Sanea restos de un eslabón muerto: filas insertadas después del último
    // row_count persistido se repetirían al retomar desde el cursor.
    await supabaseRequest("scan_results", {
      method: "DELETE",
      query: `scan_id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&rank_index=gt.${state.insertedCount}`,
    });
    const benchmarks = await loadBenchmarks(symbols.slice(startCursor, chunkEnd));
    const rowOptions = {
      requireLongHistory: false,
      stageFastWeeks: settings.stageFastWeeks,
      stageSlowWeeks: settings.stageSlowWeeks,
      stageSlopeWeeks: settings.stageSlopeWeeks,
    };
    let cursor = startCursor;
    const workers = Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, Math.max(chunkEnd - startCursor, 1)) }, async () => {
      while (!state.cancelRequested && cursor < chunkEnd) {
        const symbol = symbols[cursor];
        cursor += 1;
        try {
          // Lee de daily_bars/fundamental_snapshots primero; Yahoo solo se pide
          // si el dato falta o está más caducado que *_CACHE_MAX_AGE_DAYS (ver
          // constantes arriba) — mismo patrón que fetchChartForScan/
          // fetchProfileForScan en el cron (lib/materializedScanner.js).
          // withDailyBarsCache YA persiste en daily_bars cuando cae a Yahoo
          // (antes había aquí una escritura explícita adicional,
          // writeDailyBarsCache — quedó redundante con este cambio y se
          // retiró para no escribir la misma fila dos veces; ver
          // docs/adr-scan-desde-base.md).
          const [chart, profile] = await Promise.all([
            withDailyBarsCache(symbol, { range: "2A", interval: "D", maxAgeDays: PRICE_CACHE_MAX_AGE_DAYS }, fetchYahooChart),
            withProfileCache(symbol, { maxAgeDays: PROFILE_CACHE_MAX_AGE_DAYS }, fetchYahooProfile).catch(() => ({})),
          ]);
          state.buffer.push(buildResearchRow(symbol, chart, profile, rowOptions, benchmarks));
        } catch (error) {
          const classified = classifyProviderError(error);
          state.kindBreakdown[classified.kind] = (state.kindBreakdown[classified.kind] || 0) + 1;
          state.errors.add({ symbol, reason: classified.reason, kind: classified.kind, status: classified.status });
        }
        state.completed += 1;
        state.currentSymbol = symbol;
      }
    })).then(() => { state.workersDone = true; });

    // Escritor único: lotes de 50 a scan_results + progreso/cursor en scans.settings.progress.
    const flushBatches = async (force = false) => {
      while (state.buffer.length >= RESULT_BATCH_SIZE || (force && state.buffer.length)) {
        const batch = scoreRowsForServerScan(state.buffer.splice(0, RESULT_BATCH_SIZE));
        await supabaseRequest("scan_results", {
          method: "POST",
          prefer: "return=minimal",
          body: batch.map((row, index) => resultPayload(row, scanId, ownerId, state.insertedCount + index + 1, settings)),
        });
        state.insertedCount += batch.length;
      }
    };
    while (!state.workersDone) {
      // Cancelación: el flag se relee de Supabase al inicio de cada ciclo de
      // persistencia (no por símbolo). Si está activo, los workers dejan de tomar
      // símbolos nuevos, se persiste lo pendiente y se marca cancelled sin reencolar.
      state.cancelRequested = state.cancelRequested || await readCancelRequested(scanId, ownerId);
      if (state.cancelRequested) break;
      await flushBatches(false);
      // Segunda lectura antes de sobrescribir settings.progress: evita pisar un
      // cancelRequested que haya llegado mientras se persistía el lote.
      //
      // Las DOS lecturas se conservan a propósito, y no son la misma cosa:
      //   · esta segunda es de CORRECCIÓN. progressPayload() incluye
      //     `cancelRequested: state.cancelRequested`, así que el patchScan de
      //     la línea siguiente reescribe el flag; sin releerlo aquí, una
      //     cancelación llegada durante flushBatches() se sobrescribiría con
      //     false y el botón "Detener" no haría nada.
      //   · la primera es de LATENCIA: adelanta la detección en el tiempo que
      //     dure el flush del lote, en vez de obligar al usuario a esperar a
      //     que termine de escribirse.
      // Con el select reducido a un booleano cada lectura cuesta ~40 bytes en
      // vez de ~90 KB, así que ahorrarse una de las dos ya no compra nada
      // medible y sí perdería una de esas dos propiedades.
      state.cancelRequested = state.cancelRequested || await readCancelRequested(scanId, ownerId);
      if (state.cancelRequested) break;
      await patchScan(scanId, ownerId, { rowCount: state.insertedCount, progress: progressPayload("running"), fallbackSettings: settings });
      await sleep(FLUSH_INTERVAL_MS);
    }
    await workers;
    await flushBatches(true);
    if (state.cancelRequested) {
      await patchScan(scanId, ownerId, {
        rowCount: state.insertedCount,
        progress: progressPayload("cancelled", { finishedAt: new Date().toISOString() }),
        fallbackSettings: settings,
      });
      return;
    }
    if (state.completed >= symbols.length) {
      // Último eslabón: ejecutar el paso de finalización de percentiles RS.
      // 1. Marcar "finalizing" (estado NO-terminal → continue/polling siguen).
      //    finalizationStatus: "pending" indica "a punto de intentar finalizar".
      //    Si la RPC falla o el proceso muere aquí, un mecanismo de retry futuro
      //    puede buscar scans con status="error" AND finalizationStatus!="succeeded"
      //    para saber que requieren re-finalización (no re-scoring).
      await patchScan(scanId, ownerId, {
        rowCount: state.insertedCount,
        progress: progressPayload("finalizing", {
          percentilesFinalized: false,
          finalizationStatus: "pending",
        }),
        fallbackSettings: settings,
      });
      try {
        // La escritura de la finalización va en tandas (FINALIZE_PATCH_BATCH_SIZE,
        // lib/scanPercentileFinalization.js) — puede haber decenas de llamadas
        // RPC en secuencia para un scan grande. onFinalizeBatchProgress persiste
        // "cuántas van" SIN marcar terminal ni percentilesFinalized:true — sigue
        // siendo el mismo estado no-terminal "finalizing" de siempre, solo con
        // más detalle. Va TROTTLED (cada FINALIZE_PROGRESS_PATCH_EVERY tandas, y
        // siempre en la última): un PATCH por tanda para un scan de ~100 tandas
        // añadiría ~100 idas y vueltas de red solo para reportar progreso.
        let lastReportedBatch = 0;
        const onFinalizeBatchProgress = (info) => {
          const isLast = info.batchesDone >= info.batchesTotal;
          if (!isLast && info.batchesDone - lastReportedBatch < FINALIZE_PROGRESS_PATCH_EVERY) return;
          lastReportedBatch = info.batchesDone;
          // Fire-and-forget deliberado: si este PATCH intermedio falla, no debe
          // tumbar la finalización — es solo visibilidad, no la fuente de verdad
          // (esa la escribe el PATCH terminal de abajo, éxito o fallo).
          patchScan(scanId, ownerId, {
            rowCount: state.insertedCount,
            progress: progressPayload("finalizing", {
              percentilesFinalized: false,
              finalizationStatus: "in_progress",
              finalizationBatchesDone: info.batchesDone,
              finalizationBatchesTotal: info.batchesTotal,
              finalizationRowsPatched: info.rowsPatched,
            }),
            fallbackSettings: settings,
          }).catch((patchError) => {
            console.error("[scan-runner] no se pudo persistir el progreso de finalización", {
              scanId, ownerId, error: patchError.message || String(patchError),
            });
          });
        };
        // La LECTURA de la finalización también va en tandas
        // (FINALIZE_READ_BATCH_SIZE, vía p_offset de scan_finalize_inputs) —
        // ~199 llamadas para un scan de 9.920 filas. Se reporta igual que la
        // escritura: mismo estado no-terminal "finalizing", mismo throttling
        // (FINALIZE_PROGRESS_PATCH_EVERY tandas), mismo fire-and-forget. Aquí
        // NO se sabe el total de tandas de lectura por adelantado (el bucle
        // para cuando una página vuelve incompleta), así que se persiste
        // "cuántas van" y las filas leídas, sin un total.
        let lastReportedReadBatch = 0;
        const onFinalizeReadProgress = (info) => {
          if (info.readBatchesDone - lastReportedReadBatch < FINALIZE_PROGRESS_PATCH_EVERY) return;
          lastReportedReadBatch = info.readBatchesDone;
          patchScan(scanId, ownerId, {
            rowCount: state.insertedCount,
            progress: progressPayload("finalizing", {
              percentilesFinalized: false,
              finalizationStatus: "reading_inputs",
              finalizationReadBatchesDone: info.readBatchesDone,
              finalizationRowsRead: info.rowsRead,
            }),
            fallbackSettings: settings,
          }).catch((patchError) => {
            console.error("[scan-runner] no se pudo persistir el progreso de lectura de finalización", {
              scanId, ownerId, error: patchError.message || String(patchError),
            });
          });
        };
        const result = await finalizeScanResultsInDb(scanId, ownerId, {
          onReadProgress: onFinalizeReadProgress,
          onBatchProgress: onFinalizeBatchProgress,
        });
        // Finalización OK: aplicar contrato de completitud. ratio = saved/(saved+errors)
        //   errors == 0               → "complete" (único sin marca de degradación)
        //   0 < ratio < 1             → "partial"  (publicable con degraded=true)
        //   ratio == 0 (o 0/0)        → "failed"   (no publicable)
        const completeness = computeTerminalCompleteness({
          saved: state.insertedCount,
          errors: state.errors.total,
        });
        await patchScan(scanId, ownerId, {
          rowCount: state.insertedCount,
          progress: progressPayload(completeness.status, {
            finishedAt: new Date().toISOString(),
            percentilesFinalized: true,
            finalizationStatus: "succeeded",
            finalizationRowsPatched: result.rowsPatched,
            finalizationBatchesDone: result.batchesDone,
            finalizationBatchesTotal: result.batchesTotal,
            completeness: {
              saved: completeness.saved,
              errors: completeness.errors,
              ratio: completeness.ratio,
              kindBreakdown: { ...state.kindBreakdown },
            },
          }),
          fallbackSettings: settings,
        });
      } catch (finalizeError) {
        // La finalización falló. Con la escritura en tandas esto YA NO implica
        // "ninguna fila tocada" — finalizeScanResultsInDb adjunta al error
        // cuántas tandas/filas quedaron comprometidas antes del fallo
        // (rowsPatched/batchesDone/batchesTotal), y aquí se persisten en vez de
        // perderse. percentilesFinalized queda en false y finalizationStatus en
        // "failed" SIEMPRE que se llegue a este catch, sin importar cuánto haya
        // avanzado — nunca "succeeded" con tandas pendientes (ver PARTE C del
        // encargo). El status no-terminal previo ("finalizing") permite a
        // /api/scan/continue retomar tras DEAD_LINK_MS; un reintento vuelve a
        // escribir TODAS las tandas (incluidas las ya comprometidas) porque el
        // recompute es idempotente — no hay estado mixto que reconciliar a mano.
        await patchScan(scanId, ownerId, {
          rowCount: state.insertedCount,
          progress: progressPayload("error", {
            error: `percentile finalization failed: ${finalizeError.message || "desconocido"}`,
            finishedAt: new Date().toISOString(),
            percentilesFinalized: false,
            finalizationStatus: "failed",
            finalizationError: finalizeError.message || "desconocido",
            finalizationRowsPatched: Number.isFinite(finalizeError.rowsPatched) ? finalizeError.rowsPatched : null,
            finalizationRowsTotal: Number.isFinite(finalizeError.rowsTotal) ? finalizeError.rowsTotal : null,
            finalizationBatchesDone: Number.isFinite(finalizeError.batchesDone) ? finalizeError.batchesDone : null,
            finalizationBatchesTotal: Number.isFinite(finalizeError.batchesTotal) ? finalizeError.batchesTotal : null,
            // Fase en la que murió: "read" si se agotó leyendo los inputs (en
            // ese caso NO hay ninguna escritura comprometida — la escritura
            // empieza cuando la lectura ya terminó entera), null si el error no
            // la declara. Sin esto, un fallo de lectura vuelve a ser
            // indistinguible de un fallo de escritura con 0 tandas hechas —
            // exactamente la ambigüedad que costó una medición entera.
            finalizationPhase: finalizeError.finalizationPhase || null,
            finalizationReadBatchesDone: Number.isFinite(finalizeError.readBatchesDone) ? finalizeError.readBatchesDone : null,
            finalizationRowsRead: Number.isFinite(finalizeError.rowsRead) ? finalizeError.rowsRead : null,
          }),
          fallbackSettings: settings,
        });
      }
      return;
    }
    // Quedan símbolos: persistir cursor + token de eslabón y re-encadenar.
    const linkToken = crypto.randomUUID();
    await patchScan(scanId, ownerId, {
      rowCount: state.insertedCount,
      progress: progressPayload("running", { nextLinkToken: linkToken }),
      fallbackSettings: settings,
    });
    await chainNextLink({ baseUrl, scanId, linkToken });
  } catch (error) {
    console.error("[scan-runner] eslabón fallido", {
      scanId,
      ownerId,
      error: error.message || String(error),
    });
    try {
      await patchScan(scanId, ownerId, {
        rowCount: state.insertedCount,
        progress: progressPayload("error", { error: error.message || "Scan fallido", finishedAt: new Date().toISOString() }),
        fallbackSettings: settings,
      });
    } catch (patchError) {
      // Sin acceso a Supabase no hay dónde registrar el fallo; el GET devolverá el último estado.
      console.error("[scan-runner] no se pudo persistir el fallo", {
        scanId,
        ownerId,
        error: patchError.message || String(patchError),
      });
    }
  }
}
