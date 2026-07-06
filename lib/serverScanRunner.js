// lib/serverScanRunner.js — runner por eslabones del scan en servidor.
// Cada invocación (eslabón) procesa como máximo progress.chunkSize símbolos desde
// progress.cursor, con concurrencia 5 y la caché de Yahoo (lib/marketData), persiste
// en scan_results por lotes de 50 y, si quedan pendientes, se auto-reencadena con un
// fetch interno a POST /api/scan/continue autenticado con el token del proxy.
// El estado vive en la fila de scans: settings.scanSymbols (lista completa) y
// settings.progress { status, cursor, chunkSize, completed, total, saved, errors,
// nextLinkToken, ... }. updated_at hace de heartbeat: si un eslabón muere, pasado
// DEAD_LINK_MS /api/scan/continue puede retomar desde el último cursor persistido.
import { internalFetchHeaders } from "@/lib/internalAuth";
import { fetchYahooChart, fetchYahooProfile } from "@/lib/marketData";
import { BENCHMARK_SYMBOLS, buildResearchRow } from "@/lib/researchRow";
import { clearScansApiCache } from "@/lib/scansApiCache";
import { prepareScanDecisionRow, scanDecisionMetrics } from "@/lib/scanDecisionProjection";
import { finalizeScanResultsInDb } from "@/lib/scanPercentileFinalization";
import { sectorize } from "@/lib/screenerPipeline";
import { finiteOrNull, supabaseRequest, textOrNull } from "@/lib/supabaseServer";

export const SCAN_CONCURRENCY = 5;
export const RESULT_BATCH_SIZE = 50;
export const MAX_SYMBOLS = 10000;
export const MAX_STORED_ERRORS = 300;
export const FLUSH_INTERVAL_MS = 1500;
// ~3-4 min por eslabón con concurrencia 5 y caché caliente. Override por scan
// vía body.chunkSize en POST /api/scan (se persiste en progress.chunkSize).
export const DEFAULT_SCAN_CHUNK_SIZE = 300;
export const MIN_SCAN_CHUNK_SIZE = 10;
export const MAX_SCAN_CHUNK_SIZE = 1000;
export const DEAD_LINK_MS = 10 * 60 * 1000;

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
    raw: preparedRow,
  };
}

export function scoreRowsForServerScan(rows = []) {
  return sectorize(Array.isArray(rows) ? rows : []);
}

async function patchScan(scanId, ownerId, body) {
  await supabaseRequest("scans", {
    method: "PATCH",
    query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
    prefer: "return=minimal",
    body: { ...body, updated_at: new Date().toISOString() },
  });
  clearScansApiCache();
}

async function readCancelRequested(scanId, ownerId) {
  const [scan] = await supabaseRequest("scans", {
    query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=settings&limit=1`,
  });
  return Boolean(scan?.settings?.progress?.cancelRequested);
}

async function loadBenchmarks() {
  const entries = await Promise.all(BENCHMARK_SYMBOLS.map(async (symbol) => {
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
  } catch {
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
    errors: Array.isArray(progress.errors) ? [...progress.errors] : [],
    buffer: [],
    workersDone: false,
    cancelRequested: Boolean(progress.cancelRequested),
  };
  const progressPayload = (status, extra = {}) => ({
    ...settings,
    progress: {
      status,
      cursor: state.completed,
      chunkSize,
      link: linkIndex,
      completed: state.completed,
      total: symbols.length,
      saved: state.insertedCount,
      currentSymbol: state.currentSymbol,
      cancelRequested: state.cancelRequested,
      errors: state.errors.slice(0, MAX_STORED_ERRORS),
      startedAt,
      updatedAt: new Date().toISOString(),
      nextLinkToken: null,
      ...extra,
    },
  });
  try {
    // Sanea restos de un eslabón muerto: filas insertadas después del último
    // row_count persistido se repetirían al retomar desde el cursor.
    await supabaseRequest("scan_results", {
      method: "DELETE",
      query: `scan_id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}&rank_index=gt.${state.insertedCount}`,
    });
    const benchmarks = await loadBenchmarks();
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
          const [chart, profile] = await Promise.all([
            fetchYahooChart(symbol),
            fetchYahooProfile(symbol).catch(() => ({})),
          ]);
          state.buffer.push(buildResearchRow(symbol, chart, profile, rowOptions, benchmarks));
        } catch (error) {
          state.errors.push({ symbol, reason: error.message || "Proveedor no disponible" });
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
      state.cancelRequested = state.cancelRequested || await readCancelRequested(scanId, ownerId);
      if (state.cancelRequested) break;
      await patchScan(scanId, ownerId, { row_count: state.insertedCount, settings: progressPayload("running") });
      await sleep(FLUSH_INTERVAL_MS);
    }
    await workers;
    await flushBatches(true);
    if (state.cancelRequested) {
      await patchScan(scanId, ownerId, {
        row_count: state.insertedCount,
        settings: progressPayload("cancelled", { finishedAt: new Date().toISOString() }),
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
        row_count: state.insertedCount,
        settings: progressPayload("finalizing", {
          percentilesFinalized: false,
          finalizationStatus: "pending",
        }),
      });
      try {
        const result = await finalizeScanResultsInDb(scanId, ownerId);
        await patchScan(scanId, ownerId, {
          row_count: state.insertedCount,
          settings: progressPayload("done", {
            finishedAt: new Date().toISOString(),
            percentilesFinalized: true,
            finalizationStatus: "succeeded",
            finalizationRowsPatched: result.rowsPatched,
          }),
        });
      } catch (finalizeError) {
        // La finalización falló: la RPC PL/pgSQL revierte (ninguna fila tocada),
        // así que NO hay estado mixto. Marcamos error + finalizationStatus="failed"
        // para que un retry futuro distinga "finalización falló" (re-finalizable)
        // de "error de scoring antes de finalizar" (status="error" sin finalización
        // intentada). El status no-terminal previo ("finalizing") permite a
        // /api/scan/continue retomar tras DEAD_LINK_MS.
        await patchScan(scanId, ownerId, {
          row_count: state.insertedCount,
          settings: progressPayload("error", {
            error: `percentile finalization failed: ${finalizeError.message || "desconocido"}`,
            finishedAt: new Date().toISOString(),
            percentilesFinalized: false,
            finalizationStatus: "failed",
            finalizationError: finalizeError.message || "desconocido",
          }),
        });
      }
      return;
    }
    // Quedan símbolos: persistir cursor + token de eslabón y re-encadenar.
    const linkToken = crypto.randomUUID();
    await patchScan(scanId, ownerId, {
      row_count: state.insertedCount,
      settings: progressPayload("running", { nextLinkToken: linkToken }),
    });
    await chainNextLink({ baseUrl, scanId, linkToken });
  } catch (error) {
    try {
      await patchScan(scanId, ownerId, {
        row_count: state.insertedCount,
        settings: progressPayload("error", { error: error.message || "Scan fallido", finishedAt: new Date().toISOString() }),
      });
    } catch {
      // Sin acceso a Supabase no hay dónde registrar el fallo; el GET devolverá el último estado.
    }
  }
}
