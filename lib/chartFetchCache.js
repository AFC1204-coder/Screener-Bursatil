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

function settleRsWeekly(url, payload) {
  RS_WEEKLY_CACHE.set(url, { status: "ok", payload, fetchedAt: Date.now() });
  RS_WEEKLY_INFLIGHT.delete(url);
  return payload;
}

function chartAbortError() {
  try {
    return new DOMException("Petición de gráfico cancelada", "AbortError");
  } catch {
    const error = new Error("Petición de gráfico cancelada");
    error.name = "AbortError";
    return error;
  }
}

// Un consumidor deja de esperar la petición compartida. Si era el último y
// nadie la ha «fijado» (prefetch o consumidor sin signal), se cancela la
// descarga de verdad: antes la petición vieja de 5A terminaba igual tras volver
// a 1A (auditoría 2026-11, H21: 200 KB descargados para nada).
function releaseChartWaiter(key, entry) {
  entry.waiters = Math.max(0, entry.waiters - 1);
  if (entry.waiters > 0 || entry.pinned || entry.settled) return;
  if (CHART_INFLIGHT.get(key) === entry) CHART_INFLIGHT.delete(key);
  try { entry.controller?.abort(); } catch { /* noop */ }
}

/**
 * Fetch de /api/chart con hit de caché y dedupe de peticiones en vuelo.
 *
 * Cancelación con recuento: cada llamada con `signal` cuenta como un
 * interesado; al abortar su signal deja de esperar (rechaza con AbortError) y,
 * si era el último interesado, la petición de red se cancela. Una llamada SIN
 * signal (prefetch de Review, consumidores antiguos) fija la petición: llega
 * hasta el final y puebla la caché.
 */
export async function fetchChartCached({
  symbol,
  dataRange,
  interval,
  timeoutMs = 15000,
  signal = null,
  getJsonImpl = getJson,
} = {}) {
  const key = buildChartRequestKey({ symbol, dataRange, interval });
  const cached = peekChartCache(key);
  if (cached) return cached;
  if (signal?.aborted) throw chartAbortError();

  let entry = CHART_INFLIGHT.get(key);
  if (!entry) {
    const url = buildChartUrl({ symbol, dataRange, interval });
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    entry = { promise: null, controller, waiters: 0, pinned: false, settled: false };
    const created = entry;
    created.promise = getJsonImpl(url, { timeoutMs, ...(controller ? { signal: controller.signal } : {}) })
      .then((payload) => {
        created.settled = true;
        if (CHART_INFLIGHT.get(key) === created) CHART_INFLIGHT.delete(key);
        CHART_CACHE.set(key, { status: "ok", payload, fetchedAt: Date.now() });
        return payload;
      })
      .catch((error) => {
        created.settled = true;
        if (CHART_INFLIGHT.get(key) === created) CHART_INFLIGHT.delete(key);
        throw error;
      });
    // Nadie puede quedarse sin manejar el rechazo de la petición compartida.
    created.promise.catch(() => {});
    CHART_INFLIGHT.set(key, created);
  }

  if (!signal) {
    entry.pinned = true;
    return entry.promise;
  }

  const current = entry;
  current.waiters += 1;
  return new Promise((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      if (done) return;
      done = true;
      releaseChartWaiter(key, current);
      reject(chartAbortError());
    };
    signal.addEventListener?.("abort", onAbort, { once: true });
    current.promise.then(
      (payload) => {
        if (done) return;
        done = true;
        signal.removeEventListener?.("abort", onAbort);
        current.waiters = Math.max(0, current.waiters - 1);
        resolve(payload);
      },
      (error) => {
        if (done) return;
        done = true;
        signal.removeEventListener?.("abort", onAbort);
        current.waiters = Math.max(0, current.waiters - 1);
        reject(error);
      },
    );
  });
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
