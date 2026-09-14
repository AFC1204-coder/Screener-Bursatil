// lib/chartFetchCache.js — caché en memoria + dedupe in-flight para /api/chart
// y /api/rs-weekly. Compartida entre useChartDataModel, RowPriceChart y el
// prefetch de Review (REVIEW-CHART-PREFETCH-N1).

import { getJson } from "@/lib/clientApi";

const CHART_CACHE = new Map();
const CHART_INFLIGHT = new Map();
const RS_WEEKLY_CACHE = new Map();
const RS_WEEKLY_INFLIGHT = new Map();

export function buildChartRequestKey({ symbol = "", dataRange = "", interval = "" } = {}) {
  return `${symbol || ""}|${dataRange || ""}|${interval || ""}`;
}

export function buildChartUrl({ symbol, dataRange, interval }) {
  const params = new URLSearchParams({
    symbol: String(symbol || "").trim(),
    range: String(dataRange || "1A"),
    interval: String(interval || "D"),
  });
  return `/api/chart?${params.toString()}`;
}

export function peekChartCache(key) {
  const entry = CHART_CACHE.get(key);
  return entry?.status === "ok" ? entry.payload : null;
}

export function peekRsWeeklyCache(url) {
  const entry = RS_WEEKLY_CACHE.get(url);
  return entry?.status === "ok" ? entry.payload : null;
}

function settleChart(key, payload) {
  CHART_CACHE.set(key, { status: "ok", payload, fetchedAt: Date.now() });
  CHART_INFLIGHT.delete(key);
  return payload;
}

function settleRsWeekly(url, payload) {
  RS_WEEKLY_CACHE.set(url, { status: "ok", payload, fetchedAt: Date.now() });
  RS_WEEKLY_INFLIGHT.delete(url);
  return payload;
}

/**
 * Fetch de /api/chart con hit de caché y dedupe de peticiones en vuelo.
 * El AbortSignal del caller solo cancela la espera local; la petición
 * compartida sigue hasta poblar la caché (prefetch + consumo activo).
 */
export async function fetchChartCached({
  symbol,
  dataRange,
  interval,
  timeoutMs = 15000,
  getJsonImpl = getJson,
} = {}) {
  const key = buildChartRequestKey({ symbol, dataRange, interval });
  const cached = peekChartCache(key);
  if (cached) return cached;

  let promise = CHART_INFLIGHT.get(key);
  if (!promise) {
    const url = buildChartUrl({ symbol, dataRange, interval });
    promise = getJsonImpl(url, { timeoutMs })
      .then((payload) => settleChart(key, payload))
      .catch((error) => {
        CHART_INFLIGHT.delete(key);
        throw error;
      });
    CHART_INFLIGHT.set(key, promise);
  }
  return promise;
}

/** Prefetch fire-and-forget; errores se ignoran. */
export function prefetchChart(args = {}) {
  return fetchChartCached(args).catch(() => {});
}

/**
 * Fetch de /api/rs-weekly con la misma política de caché/dedupe.
 */
export async function fetchRsWeeklyCached(url, { getJsonImpl = getJson, timeoutMs = 12000 } = {}) {
  const key = String(url || "").trim();
  if (!key) return null;

  const cached = peekRsWeeklyCache(key);
  if (cached) return cached;

  let promise = RS_WEEKLY_INFLIGHT.get(key);
  if (!promise) {
    promise = getJsonImpl(key, { timeoutMs })
      .then((payload) => settleRsWeekly(key, payload))
      .catch((error) => {
        RS_WEEKLY_INFLIGHT.delete(key);
        throw error;
      });
    RS_WEEKLY_INFLIGHT.set(key, promise);
  }
  return promise;
}

export function prefetchRsWeekly(url, options = {}) {
  return fetchRsWeeklyCached(url, options).catch(() => {});
}

export function resetChartFetchCache() {
  CHART_CACHE.clear();
  CHART_INFLIGHT.clear();
  RS_WEEKLY_CACHE.clear();
  RS_WEEKLY_INFLIGHT.clear();
}

export const __test__ = {
  CHART_CACHE,
  CHART_INFLIGHT,
  RS_WEEKLY_CACHE,
  RS_WEEKLY_INFLIGHT,
  resetChartFetchCache,
};
