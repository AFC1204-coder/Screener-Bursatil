// lib/reviewChartPrefetch.js — plan de prefetch N+1 / N-1 para Rapid Review.
// Solo /api/chart (+ rs-weekly si el overlay lo necesita). 0 company-brief.

import { prefetchChart, prefetchRsWeekly } from "@/lib/chartFetchCache";
import { rowHasChartRsSeries, rsWeeklyChartQuery } from "@/lib/chartRsRowProps";
import { resolveRowChartSource } from "@/app/RowPriceChart";
import { __test__ as chartDataModelTest } from "@/app/useChartDataModel";

const { shouldFetch } = chartDataModelTest;

export const REVIEW_PREFETCH_MAX_TARGETS = 2;

export function reviewQueueNeighbors(visibleRows = [], currentIndex = 0) {
  if (!Array.isArray(visibleRows) || visibleRows.length < 2) {
    return { next: null, prev: null };
  }
  const len = visibleRows.length;
  const safeIndex = Number.isFinite(currentIndex) ? currentIndex : 0;
  const nextIndex = (safeIndex + 1) % len;
  const prevIndex = (safeIndex - 1 + len) % len;
  return {
    next: visibleRows[nextIndex] || null,
    prev: visibleRows[prevIndex] || null,
  };
}

export function shouldPrefetchChartForRow(row = null, chartSettings = {}) {
  if (!row?.symbol) return false;
  const { bars, preferredStyle } = resolveRowChartSource(row, chartSettings);
  const dataRange = chartSettings?.range || chartSettings?.dataRange || "1A";
  const interval = chartSettings?.interval || "D";
  return shouldFetch({
    symbol: row.symbol,
    localSource: { bars },
    dataRange,
    interval,
    preferredStyle,
  });
}

export function buildReviewChartPrefetchPlan({
  focusSymbol = "",
  visibleRows = [],
  currentIndex = 0,
  chartSettings = {},
  includePrev = true,
} = {}) {
  if (!focusSymbol || visibleRows.length < 2) return [];

  const { next, prev } = reviewQueueNeighbors(visibleRows, currentIndex);
  const targets = [];

  if (next?.symbol) {
    targets.push({ row: next, role: "next" });
  }
  if (includePrev && prev?.symbol && prev.symbol !== next?.symbol) {
    targets.push({ row: prev, role: "prev" });
  }

  const dataRange = chartSettings?.range || chartSettings?.dataRange || "1A";
  const interval = chartSettings?.interval || "D";

  return targets
    .filter((target) => target.row?.symbol && target.row.symbol !== focusSymbol)
    .slice(0, REVIEW_PREFETCH_MAX_TARGETS)
    .map(({ row, role }) => ({
      role,
      symbol: row.symbol,
      prefetchChart: shouldPrefetchChartForRow(row, chartSettings),
      prefetchRsWeekly: !rowHasChartRsSeries(row),
      rsWeeklyUrl: rsWeeklyChartQuery(row.symbol, row),
      chartRequest: { symbol: row.symbol, dataRange, interval },
    }));
}

export function runReviewChartPrefetchPlan(plan = [], { prefetchChartImpl = prefetchChart, prefetchRsWeeklyImpl = prefetchRsWeekly } = {}) {
  const started = [];
  for (const item of plan) {
    if (item.prefetchChart) {
      prefetchChartImpl(item.chartRequest);
      started.push({ kind: "chart", symbol: item.symbol, role: item.role });
    }
    if (item.prefetchRsWeekly && item.rsWeeklyUrl) {
      prefetchRsWeeklyImpl(item.rsWeeklyUrl);
      started.push({ kind: "rs-weekly", symbol: item.symbol, role: item.role });
    }
  }
  return started;
}
