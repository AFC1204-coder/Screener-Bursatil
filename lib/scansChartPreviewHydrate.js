// lib/scansChartPreviewHydrate.js — hidratación cliente de chartPreview diferido.

import { postJson } from "@/lib/clientApi";
import {
  mergeChartPreviewsIntoRows,
  rowHasChartPreview,
  symbolsMissingChartPreview,
} from "@/lib/scansChartPreviewTransport";

export const MAX_SYMBOLS_PER_REQUEST = 80;
/** Tope de filas Caza/Hunt a hidratar por pasada (no toda la cola filtrada). */
export const MAX_HUNT_CHART_PREVIEW_HYDRATE = 80;
/** Altura mínima de `.huntTapeRow` (styles/screener.css) — estimación para scroll→índice. */
export const HUNT_TAPE_ROW_HEIGHT_PX = 56;
/** Filas extra hacia arriba del primer índice visible al calcular la ventana. */
export const HUNT_CHART_PREVIEW_OVERSCAN = 8;
/** Evento ventana Caza → page.jsx (mismo patrón que resultViewMode). */
export const HUNT_CHART_PREVIEW_VIEWPORT_EVENT = "statsedge:huntChartPreviewViewport";

const inFlightByScan = new Map();
const cacheByScan = new Map();
/** Símbolos ya pedídos a /chart-preview (con o sin barras) — vacío real ≠ pending. */
const resolvedByScan = new Map();

/**
 * Índice de inicio de la ventana de hidratación a partir del scroll de la cinta.
 * Mantiene el cap de 80 filas pero la desplaza cuando el usuario pasa del top N.
 */
export function computeHuntChartPreviewHydrateStart(
  scrollTop = 0,
  {
    rowHeight = HUNT_TAPE_ROW_HEIGHT_PX,
    overscan = HUNT_CHART_PREVIEW_OVERSCAN,
    rowCount = Number.POSITIVE_INFINITY,
    limit = MAX_HUNT_CHART_PREVIEW_HYDRATE,
  } = {},
) {
  const safeHeight = Math.max(1, Number(rowHeight) || HUNT_TAPE_ROW_HEIGHT_PX);
  const safeOverscan = Math.max(0, Number(overscan) || 0);
  const safeLimit = Math.max(1, Number(limit) || MAX_HUNT_CHART_PREVIEW_HYDRATE);
  const firstVisible = Math.floor(Math.max(0, Number(scrollTop) || 0) / safeHeight);
  const start = Math.max(0, firstVisible - safeOverscan);
  const count = Number(rowCount);
  if (!Number.isFinite(count) || count <= 0) return start;
  const maxStart = Math.max(0, Math.floor(count) - safeLimit);
  return Math.min(start, maxStart);
}

export function emitHuntChartPreviewViewport(start = 0) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const safeStart = Math.max(0, Math.floor(Number(start) || 0));
  window.dispatchEvent(new CustomEvent(HUNT_CHART_PREVIEW_VIEWPORT_EVENT, {
    detail: { start: safeStart },
  }));
}

function scanCacheKey(scanId = "") {
  return String(scanId || "").trim();
}

function rememberPreviews(scanId, previews = {}) {
  const key = scanCacheKey(scanId);
  if (!key) return new Map();
  let map = cacheByScan.get(key);
  if (!map) {
    map = new Map();
    cacheByScan.set(key, map);
  }
  for (const [symbol, chartPreview] of Object.entries(previews || {})) {
    const normalized = String(symbol || "").trim().toUpperCase();
    if (!normalized || !Array.isArray(chartPreview) || chartPreview.length < 2) continue;
    map.set(normalized, chartPreview);
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
    const symbol = String(raw || "").trim().toUpperCase();
    if (symbol) set.add(symbol);
  }
}

export function isChartPreviewSymbolResolved(scanId, symbol = "") {
  const key = scanCacheKey(scanId);
  const normalized = String(symbol || "").trim().toUpperCase();
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
    symbols.map((symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean),
  );
  if (!wanted.size) return rows;
  let changed = false;
  const next = rows.map((row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol || !wanted.has(symbol)) return row;
    if (row?.chartPreviewAttempted === true) return row;
    changed = true;
    return { ...row, chartPreviewAttempted: true };
  });
  return changed ? next : rows;
}

/** Solo tests — limpia caches de preview / resolved / in-flight. */
export function resetChartPreviewHydrateCachesForTests() {
  inFlightByScan.clear();
  cacheByScan.clear();
  resolvedByScan.clear();
}

async function postChartPreviewChunk(scanId, symbols, retriesLeft = 1) {
  try {
    return await postJson("/api/scans/chart-preview", { scanId, symbols });
  } catch (error) {
    if (retriesLeft > 0) {
      return postChartPreviewChunk(scanId, symbols, retriesLeft - 1);
    }
    console.warn("[chartPreview] chunk fallido:", error);
    return { previews: {} };
  }
}

export function buildChartPreviewHydrateSignature(symbols = []) {
  return [...new Set(
    symbols.map((symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean),
  )].sort().join(",");
}

export async function fetchChartPreviewsForSymbols(scanId, symbols = [], { onChunk } = {}) {
  const key = scanCacheKey(scanId);
  const unique = [...new Set(symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  if (!key || !unique.length) return {};

  const cached = cacheByScan.get(key) || new Map();
  const resolved = resolvedSetFor(key);
  const missing = unique.filter((symbol) => !cached.has(symbol) && !resolved?.has(symbol));
  if (!missing.length) {
    return Object.fromEntries(unique.map((symbol) => [symbol, cached.get(symbol)]).filter(([, preview]) => preview));
  }

  const pendingKey = `${key}:${missing.sort().join(",")}`;
  if (inFlightByScan.has(pendingKey)) return inFlightByScan.get(pendingKey);

  const promise = (async () => {
    const previews = {};
    for (let index = 0; index < missing.length; index += MAX_SYMBOLS_PER_REQUEST) {
      const chunk = missing.slice(index, index + MAX_SYMBOLS_PER_REQUEST);
      const payload = await postChartPreviewChunk(key, chunk);
      const chunkPreviews = payload?.previews && typeof payload.previews === "object"
        ? payload.previews
        : {};
      if (Object.keys(chunkPreviews).length) {
        Object.assign(previews, chunkPreviews);
        rememberPreviews(key, chunkPreviews);
        onChunk?.(chunkPreviews);
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
      String(symbol || "").trim().toUpperCase(),
      chartPreview,
    ]),
  );
  return mergeChartPreviewsIntoRows(rows, previewBySymbol);
}

export function patchRowsChartPreviews(rows = [], previews = {}) {
  return applyChartPreviewsToRows(rows, previews);
}

/** Filas de cinta Caza/Hunt que pintan sparks (ventana viewport-cap, no la cola entera). */
export function huntRowsForChartPreviewHydrate(
  filteredRows = [],
  cazaMode = false,
  { start = 0, limit = MAX_HUNT_CHART_PREVIEW_HYDRATE } = {},
) {
  if (!cazaMode || !Array.isArray(filteredRows) || !filteredRows.length) return [];
  const safeLimit = Math.max(1, Number(limit) || MAX_HUNT_CHART_PREVIEW_HYDRATE);
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

export { rowHasChartPreview };
