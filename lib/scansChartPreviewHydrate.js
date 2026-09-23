// lib/scansChartPreviewHydrate.js — hidratación cliente de chartPreview diferido.
// Combina #30 (pending ≠ vacío real vía resolved/attempted) + #32 (re-hydrate
// tras cambio de cola: queue signature, peek cache, AbortSignal, join/onChunk).

import { postJson } from "@/lib/clientApi";
import {
  mergeChartPreviewsIntoRows,
  rowHasChartPreview,
  symbolsMissingChartPreview,
} from "@/lib/scansChartPreviewTransport";
import {
  DEFAULT_HUNT_TAPE_DENSITY,
  HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX,
  huntTapeRowHeightPx,
} from "@/lib/screenerHuntTapeDensity";

export const MAX_SYMBOLS_PER_REQUEST = 80;
/**
 * Techo duro de seguridad (API batch / no cola entera).
 * La ventana efectiva de Caza es viewport visible + buffer (ver
 * `computeHuntChartPreviewHydrateLimit`), acotada por este techo.
 */
export const MAX_HUNT_CHART_PREVIEW_HYDRATE = 80;
/** Altura de `.huntTapeRow` compacta (P4) — estimación para scroll→índice. */
export const HUNT_TAPE_ROW_HEIGHT_PX = huntTapeRowHeightPx(DEFAULT_HUNT_TAPE_DENSITY);
/** Filas extra arriba y abajo del viewport visible al calcular la ventana. */
export const HUNT_CHART_PREVIEW_OVERSCAN = 8;
/** Evento ventana Caza → page.jsx (mismo patrón que resultViewMode). */
export const HUNT_CHART_PREVIEW_VIEWPORT_EVENT = "statsedge:huntChartPreviewViewport";

const inFlightByScan = new Map();
const cacheByScan = new Map();
/** Símbolos ya pedídos a /chart-preview (con o sin barras) — vacío real ≠ pending. */
const resolvedByScan = new Map();
/** Símbolos cuyo POST agotó reintentos sin preview usable (por scan). */
const failedByScan = new Map();

/**
 * Tamaño de ventana de hydrate Caza: filas visibles en la cinta + overscan
 * arriba y abajo. `listHeightPx` 0 / ausente → estimación desktop 1080p.
 */
export function computeHuntChartPreviewHydrateLimit(
  listHeightPx = HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX,
  {
    rowHeight = HUNT_TAPE_ROW_HEIGHT_PX,
    overscan = HUNT_CHART_PREVIEW_OVERSCAN,
    maxLimit = MAX_HUNT_CHART_PREVIEW_HYDRATE,
  } = {},
) {
  const safeRow = Math.max(1, Number(rowHeight) || HUNT_TAPE_ROW_HEIGHT_PX);
  const safeOverscan = Math.max(0, Number(overscan) || 0);
  const measured = Math.max(0, Number(listHeightPx) || 0);
  const effectiveHeight = measured > 0 ? measured : HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX;
  const visible = Math.max(1, Math.ceil(effectiveHeight / safeRow));
  const limit = visible + 2 * safeOverscan;
  const ceiling = Math.max(1, Number(maxLimit) || MAX_HUNT_CHART_PREVIEW_HYDRATE);
  return Math.min(limit, ceiling);
}

/**
 * Índice de inicio de la ventana de hidratación a partir del scroll de la cinta.
 * Desplaza la ventana (viewport + buffer) cuando el usuario pasa del top.
 */
export function computeHuntChartPreviewHydrateStart(
  scrollTop = 0,
  {
    rowHeight = HUNT_TAPE_ROW_HEIGHT_PX,
    overscan = HUNT_CHART_PREVIEW_OVERSCAN,
    rowCount = Number.POSITIVE_INFINITY,
    limit = computeHuntChartPreviewHydrateLimit(),
  } = {},
) {
  const safeHeight = Math.max(1, Number(rowHeight) || HUNT_TAPE_ROW_HEIGHT_PX);
  const safeOverscan = Math.max(0, Number(overscan) || 0);
  const safeLimit = Math.max(1, Number(limit) || computeHuntChartPreviewHydrateLimit());
  const firstVisible = Math.floor(Math.max(0, Number(scrollTop) || 0) / safeHeight);
  const start = Math.max(0, firstVisible - safeOverscan);
  const count = Number(rowCount);
  if (!Number.isFinite(count) || count <= 0) return start;
  const maxStart = Math.max(0, Math.floor(count) - safeLimit);
  return Math.min(start, maxStart);
}

/**
 * Publica la ventana de hydrate Caza. Acepta `start` numérico (legacy) o
 * `{ start, limit }` — el limit es filas = viewport + buffer.
 */
export function emitHuntChartPreviewViewport(startOrDetail = 0, maybeOpts = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const detail = typeof startOrDetail === "object" && startOrDetail !== null
    ? startOrDetail
    : { start: startOrDetail, ...maybeOpts };
  const safeStart = Math.max(0, Math.floor(Number(detail.start) || 0));
  const rawLimit = Number(detail.limit);
  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.max(1, Math.floor(rawLimit))
    : computeHuntChartPreviewHydrateLimit();
  window.dispatchEvent(new CustomEvent(HUNT_CHART_PREVIEW_VIEWPORT_EVENT, {
    detail: { start: safeStart, limit: safeLimit },
  }));
}

function scanCacheKey(scanId = "") {
  return String(scanId || "").trim();
}

function normalizeSymbol(symbol = "") {
  return String(symbol || "").trim().toUpperCase();
}

function rememberPreviews(scanId, previews = {}) {
  const key = scanCacheKey(scanId);
  if (!key) return new Map();
  let map = cacheByScan.get(key);
  if (!map) {
    map = new Map();
    cacheByScan.set(key, map);
  }
  let failed = failedByScan.get(key);
  for (const [symbol, chartPreview] of Object.entries(previews || {})) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized || !Array.isArray(chartPreview) || chartPreview.length < 2) continue;
    map.set(normalized, chartPreview);
    failed?.delete(normalized);
  }
  return map;
}

function resolvedSetFor(scanId) {
  const key = scanCacheKey(scanId);
  if (!key) return null;
  let set = resolvedByScan.get(key);
  if (!set) {
    set = new Set();
    resolvedByScan.set(key, set);
  }
  return set;
}

/** Marca símbolos como resueltos tras un intento de hydrate (haya o no preview). */
export function markChartPreviewSymbolsResolved(scanId, symbols = []) {
  const set = resolvedSetFor(scanId);
  if (!set) return;
  for (const raw of symbols) {
    const symbol = normalizeSymbol(raw);
    if (symbol) set.add(symbol);
  }
}

export function isChartPreviewSymbolResolved(scanId, symbol = "") {
  const key = scanCacheKey(scanId);
  const normalized = normalizeSymbol(symbol);
  if (!key || !normalized) return false;
  return Boolean(resolvedByScan.get(key)?.has(normalized));
}

/**
 * Estado de la miniatura SEMANAL en Caza.
 * `chartPreviewAttempted` lo marca page.jsx al cerrar el fetch (haya o no barras).
 * @returns {"ready"|"pending"|"empty"}
 */
export function resolveHuntTapeSparkStatus(row = {}, { deferred = false } = {}) {
  if (rowHasChartPreview(row)) return "ready";
  if (!deferred) return "empty";
  if (row?.chartPreviewAttempted === true) return "empty";
  return "pending";
}

/** Marca filas cuyo chart-preview ya se intentó hidratar (vacío real o con barras). */
export function markChartPreviewAttemptedOnRows(rows = [], symbols = []) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const wanted = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  if (!wanted.size) return rows;
  let changed = false;
  const next = rows.map((row) => {
    const symbol = normalizeSymbol(row?.symbol);
    if (!symbol || !wanted.has(symbol)) return row;
    if (row?.chartPreviewAttempted === true) return row;
    changed = true;
    return { ...row, chartPreviewAttempted: true };
  });
  return changed ? next : rows;
}

function markFailedSymbols(scanId, symbols = []) {
  const key = scanCacheKey(scanId);
  if (!key || !symbols.length) return;
  let failed = failedByScan.get(key);
  if (!failed) {
    failed = new Set();
    failedByScan.set(key, failed);
  }
  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol);
    if (normalized) failed.add(normalized);
  }
}

function previewsFromCache(scanId, symbols = []) {
  const key = scanCacheKey(scanId);
  const map = cacheByScan.get(key) || new Map();
  const out = {};
  for (const raw of symbols) {
    const symbol = normalizeSymbol(raw);
    if (!symbol) continue;
    const chartPreview = map.get(symbol);
    if (chartPreview) out[symbol] = chartPreview;
  }
  return out;
}

/** Lectura síncrona del cache de módulo (re-aplicar tras cambio de cola / mesa→review). */
export function peekCachedChartPreviews(scanId, symbols = []) {
  return previewsFromCache(scanId, symbols);
}

/**
 * Estado de celda spark (API T11): ready | pending | failed | empty.
 * UI Caza usa resolveHuntTapeSparkStatus (#30); esta API cubre tests / callers T11.
 */
export function chartPreviewHydrateCellState(row = {}, {
  pendingSymbols = null,
  scanId = "",
} = {}) {
  if (rowHasChartPreview(row)) return "ready";
  const symbol = normalizeSymbol(row?.symbol);
  if (!symbol) return "empty";
  const failed = failedByScan.get(scanCacheKey(scanId));
  if (failed?.has(symbol)) return "failed";
  if (pendingSymbols?.has?.(symbol) || pendingSymbols?.includes?.(symbol)) return "pending";
  return "empty";
}

async function postChartPreviewChunk(scanId, symbols, {
  retriesLeft = 2,
  signal,
  scanIds = null,
} = {}) {
  const body = { scanId, symbols };
  if (Array.isArray(scanIds) && scanIds.length) body.scanIds = scanIds;
  try {
    return await postJson("/api/scans/chart-preview", body, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (retriesLeft > 0) {
      return postChartPreviewChunk(scanId, symbols, {
        retriesLeft: retriesLeft - 1,
        signal,
        scanIds,
      });
    }
    console.warn("[chartPreview] chunk fallido:", error);
    return { previews: {}, failed: true };
  }
}

export function buildChartPreviewHydrateSignature(symbols = []) {
  return [...new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  )].sort().join(",");
}

/**
 * Firma de cola visible: al cambiar ficha/filtro re-dispara hydrate aunque el
 * set de missing coincida o el cache de módulo ya tenga barras.
 */
export function buildChartPreviewQueueSignature({
  presetKey = "",
  rowCount = 0,
  headSymbol = "",
  tailSymbol = "",
  hydrateStart = 0,
} = {}) {
  return [
    String(presetKey || "").trim(),
    Math.max(0, Math.floor(Number(rowCount) || 0)),
    normalizeSymbol(headSymbol),
    normalizeSymbol(tailSymbol),
    Math.max(0, Math.floor(Number(hydrateStart) || 0)),
  ].join("|");
}

export async function fetchChartPreviewsForSymbols(scanId, symbols = [], {
  onChunk,
  signal,
  scanIds = null,
} = {}) {
  const key = scanCacheKey(scanId);
  const unique = [...new Set(symbols.map((s) => normalizeSymbol(s)).filter(Boolean))];
  if (!key || !unique.length) return {};
  const persistenceScanIds = Array.isArray(scanIds) && scanIds.length ? scanIds : null;

  const emitCachedForCaller = () => {
    const cachedPreviews = previewsFromCache(key, unique);
    if (Object.keys(cachedPreviews).length) onChunk?.(cachedPreviews);
    return cachedPreviews;
  };

  if (signal?.aborted) return {};

  const cached = cacheByScan.get(key) || new Map();
  const resolved = resolvedSetFor(key);
  const missing = unique.filter((symbol) => !cached.has(symbol) && !resolved?.has(symbol));
  if (!missing.length) {
    // Cache hit: hay que re-aplicar a React (p. ej. cola nueva con refs viejas).
    return emitCachedForCaller();
  }

  const pendingKey = `${key}:${missing.slice().sort().join(",")}`;
  if (inFlightByScan.has(pendingKey)) {
    // Join: el onChunk del primer caller puede estar cancelled; re-aplicar al resolver.
    try {
      await inFlightByScan.get(pendingKey);
    } catch {
      /* el primer caller ya logueó / abortó; re-leemos cache y reintentamos missing */
    }
    if (signal?.aborted) return {};
    const afterJoin = emitCachedForCaller();
    const stillMissing = unique.filter((symbol) => {
      if (cacheByScan.get(key)?.has(symbol)) return false;
      if (resolvedByScan.get(key)?.has(symbol)) return false;
      return true;
    });
    if (!stillMissing.length) return afterJoin;
    const rest = await fetchChartPreviewsForSymbols(scanId, stillMissing, {
      onChunk,
      signal,
      scanIds: persistenceScanIds,
    });
    return { ...afterJoin, ...rest };
  }

  const promise = (async () => {
    const previews = {};
    for (let index = 0; index < missing.length; index += MAX_SYMBOLS_PER_REQUEST) {
      if (signal?.aborted) break;
      const chunk = missing.slice(index, index + MAX_SYMBOLS_PER_REQUEST);
      const payload = await postChartPreviewChunk(key, chunk, {
        signal,
        scanIds: persistenceScanIds,
      });
      if (signal?.aborted) break;
      const chunkPreviews = payload?.previews && typeof payload.previews === "object"
        ? payload.previews
        : {};
      const received = Object.keys(chunkPreviews).filter((symbol) => {
        const bars = chunkPreviews[symbol];
        return Array.isArray(bars) && bars.length >= 2;
      });
      if (received.length) {
        const usable = Object.fromEntries(received.map((symbol) => [normalizeSymbol(symbol), chunkPreviews[symbol]]));
        Object.assign(previews, usable);
        rememberPreviews(key, usable);
        onChunk?.(usable);
      }
      const unresolved = chunk
        .map((symbol) => normalizeSymbol(symbol))
        .filter((symbol) => !previews[symbol] && !(cacheByScan.get(key)?.has(symbol)));
      if (payload?.failed || unresolved.length) {
        markFailedSymbols(key, unresolved.length ? unresolved : chunk);
      }
      // Resuelto aunque el API no devuelva barras: UI puede pintar vacío real.
      markChartPreviewSymbolsResolved(key, chunk);
    }
    const map = cacheByScan.get(key) || new Map();
    return Object.fromEntries(unique.map((symbol) => [symbol, map.get(symbol)]).filter(([, preview]) => preview));
  })().finally(() => {
    inFlightByScan.delete(pendingKey);
  });

  inFlightByScan.set(pendingKey, promise);
  return promise;
}

export function applyChartPreviewsToRows(rows = [], previews = {}) {
  const previewBySymbol = new Map(
    Object.entries(previews || {}).map(([symbol, chartPreview]) => [
      normalizeSymbol(symbol),
      chartPreview,
    ]),
  );
  return mergeChartPreviewsIntoRows(rows, previewBySymbol);
}

export function patchRowsChartPreviews(rows = [], previews = {}) {
  return applyChartPreviewsToRows(rows, previews);
}

/** Filas de cinta Caza/Hunt que pintan sparks (viewport + buffer, no la cola entera). */
export function huntRowsForChartPreviewHydrate(
  filteredRows = [],
  cazaMode = false,
  { start = 0, limit = computeHuntChartPreviewHydrateLimit() } = {},
) {
  if (!cazaMode || !Array.isArray(filteredRows) || !filteredRows.length) return [];
  const safeLimit = Math.max(1, Number(limit) || computeHuntChartPreviewHydrateLimit());
  const rawStart = Math.max(0, Math.floor(Number(start) || 0));
  const maxStart = Math.max(0, filteredRows.length - safeLimit);
  const safeStart = Math.min(rawStart, maxStart);
  return filteredRows.slice(safeStart, safeStart + safeLimit);
}

export function collectSymbolsForChartPreviewHydrate({
  pagedRows = [],
  quickReviewRows = [],
  huntRows = [],
  extraSymbols = [],
} = {}) {
  return symbolsMissingChartPreview(
    [...pagedRows, ...quickReviewRows, ...huntRows],
    extraSymbols,
  );
}

export function chartPreviewDeferredFromScan(scan = {}) {
  return scan?.chartPreviewTransport === "deferred";
}

/** Solo tests — limpia caches de preview / resolved / failed / in-flight (#30). */
export function resetChartPreviewHydrateCachesForTests() {
  inFlightByScan.clear();
  cacheByScan.clear();
  resolvedByScan.clear();
  failedByScan.clear();
}

/** Alias T11 / Review tests. */
export function resetChartPreviewHydrateStateForTests() {
  resetChartPreviewHydrateCachesForTests();
}

/** Alias Review (#31). */
export function resetChartPreviewHydrateCacheForTests() {
  resetChartPreviewHydrateCachesForTests();
}

/** Solo tests: siembra miniaturas como si la mesa las hubiera hidratado. */
export function rememberPreviewsForTests(scanId, previews = {}) {
  return rememberPreviews(scanId, previews);
}

export { rowHasChartPreview };
