// lib/marketHealthSeries.js — serie semanal del régimen US (MH-FILL-6).
//
// Ring buffer en app_settings: merge por weekKey ISO, cap 13, última gana.

import { weekKey } from "@/lib/chartDataModel";

export const MARKET_HEALTH_SERIES_TYPE = "market_health_series";
export const MARKET_HEALTH_SERIES_KEY = "default";
export const MARKET_HEALTH_SERIES_MAX_POINTS = 13;

function sortPoints(points = []) {
  return [...points].sort((a, b) => {
    const aKey = a?.weekKey || "";
    const bKey = b?.weekKey || "";
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;
    const aTime = Date.parse(a?.asOf || "");
    const bTime = Date.parse(b?.asOf || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    return 0;
  });
}

/** Extrae el punto semanal US desde un payload de market-health ya calculado. */
export function buildRegimePointFromPayload(payload = {}) {
  const asOf = payload.generatedAt || new Date().toISOString();
  const datePart = String(asOf).slice(0, 10);
  const usAbove30w = payload.regimes?.US?.breadth?.above30w || null;
  const above30wPct = usAbove30w?.available
    ? usAbove30w.pct
    : (Number.isFinite(payload.breadthProxy?.pctAbove30w) ? payload.breadthProxy.pctAbove30w : null);
  const point = {
    weekKey: weekKey(datePart),
    asOf,
    marketScore: Number.isFinite(payload.marketScore) ? payload.marketScore : null,
    above30wPct: Number.isFinite(above30wPct) ? above30wPct : null,
    regimeLabel: payload.regime?.label || "",
  };
  if (usAbove30w?.available) {
    point.above30w = {
      count: usAbove30w.count ?? null,
      measured: usAbove30w.measured ?? null,
    };
  }
  return point;
}

/** Merge deduplicado por weekKey; conserva los últimos `maxPoints` en orden cronológico. */
export function mergeRegimeSeries(existingPoints = [], incomingPoint = null, maxPoints = MARKET_HEALTH_SERIES_MAX_POINTS) {
  const cap = Math.max(1, Number(maxPoints) || MARKET_HEALTH_SERIES_MAX_POINTS);
  const byWeek = new Map();
  for (const point of existingPoints) {
    if (!point?.weekKey) continue;
    byWeek.set(point.weekKey, point);
  }
  if (incomingPoint?.weekKey) {
    byWeek.set(incomingPoint.weekKey, incomingPoint);
  }
  return sortPoints([...byWeek.values()]).slice(-cap);
}

export function normalizeRegimeSeries(points = [], maxPoints = MARKET_HEALTH_SERIES_MAX_POINTS) {
  return mergeRegimeSeries(points, null, maxPoints);
}

/** Δ vs semana previa; null si hay menos de 2 puntos o faltan métricas comparables. */
export function regimeSeriesDelta(points = []) {
  const sorted = sortPoints(points);
  if (sorted.length < 2) return null;
  const previous = sorted[sorted.length - 2];
  const current = sorted[sorted.length - 1];
  const marketScoreDelta = Number.isFinite(current.marketScore) && Number.isFinite(previous.marketScore)
    ? current.marketScore - previous.marketScore
    : null;
  const above30wPctDelta = Number.isFinite(current.above30wPct) && Number.isFinite(previous.above30wPct)
    ? current.above30wPct - previous.above30wPct
    : null;
  return {
    previous,
    current,
    marketScoreDelta,
    above30wPctDelta,
  };
}
