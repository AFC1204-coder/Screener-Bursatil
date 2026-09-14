// lib/scansChartPreviewHydrate.js — hidratación cliente de chartPreview diferido.

import { postJson } from "@/lib/clientApi";
import {
  mergeChartPreviewsIntoRows,
  rowHasChartPreview,
  symbolsMissingChartPreview,
} from "@/lib/scansChartPreviewTransport";

const MAX_SYMBOLS_PER_REQUEST = 80;
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

export async function fetchChartPreviewsForSymbols(scanId, symbols = []) {
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
      const payload = await postJson("/api/scans/chart-preview", { scanId: key, symbols: chunk });
      if (payload?.previews && typeof payload.previews === "object") {
        Object.assign(previews, payload.previews);
      }
    }
    const map = rememberPreviews(key, previews);
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

export function collectSymbolsForChartPreviewHydrate({
  rows = [],
  pagedRows = [],
  quickReviewRows = [],
  extraSymbols = [],
} = {}) {
  return symbolsMissingChartPreview(
    [...rows, ...pagedRows, ...quickReviewRows],
    extraSymbols,
  );
}

export function chartPreviewDeferredFromScan(scan = {}) {
  return scan?.chartPreviewTransport === "deferred";
}

export { rowHasChartPreview };
