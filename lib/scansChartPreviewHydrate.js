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

const inFlightByScan = new Map();
const cacheByScan = new Map();

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
  const missing = unique.filter((symbol) => !cached.has(symbol));
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

/** Filas de cinta Caza/Hunt que pintan sparks (viewport/top N, no la cola entera). */
export function huntRowsForChartPreviewHydrate(
  filteredRows = [],
  cazaMode = false,
  { start = 0, limit = MAX_HUNT_CHART_PREVIEW_HYDRATE } = {},
) {
  if (!cazaMode || !Array.isArray(filteredRows) || !filteredRows.length) return [];
  const safeStart = Math.max(0, Number(start) || 0);
  const safeLimit = Math.max(1, Number(limit) || MAX_HUNT_CHART_PREVIEW_HYDRATE);
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
