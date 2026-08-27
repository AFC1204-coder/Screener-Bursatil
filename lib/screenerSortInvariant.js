// lib/screenerSortInvariant.js — invariante sort ↔ periodo de rendimiento visible.
// Principio 7.5: no ordenar por un periodo distinto al de la columna Rend.

import {
  DEFAULT_PERFORMANCE_PERIOD,
  normalizePerformancePeriod,
  PERFORMANCE_PERIODS,
} from "@/lib/screenerPeriods";

const PERFORMANCE_SORT_KEYS = new Set(PERFORMANCE_PERIODS.map((item) => item.key));

export function isPerformanceSortKey(sort = "") {
  return PERFORMANCE_SORT_KEYS.has(String(sort || "").trim());
}

/** Alinea sort y perfPeriod cuando el orden activo es un periodo de rendimiento. */
export function alignSortPerfPeriod({
  sort = "",
  perfPeriod = "",
} = {}) {
  const sortKey = String(sort || "").trim();
  const perf = normalizePerformancePeriod(perfPeriod);

  if (isPerformanceSortKey(sortKey)) {
    const aligned = normalizePerformancePeriod(sortKey);
    return { sort: aligned, perfPeriod: aligned };
  }

  return {
    sort: sortKey || DEFAULT_PERFORMANCE_PERIOD,
    perfPeriod: perf,
  };
}

/** Camino select «Ordenar»: elegir perf3m|perf6m|perf12m actualiza la columna visible. */
export function applySortSelection(nextSort = "", { perfPeriod = "" } = {}) {
  const sortKey = String(nextSort || "").trim();
  if (isPerformanceSortKey(sortKey)) {
    const aligned = normalizePerformancePeriod(sortKey);
    return { sort: aligned, perfPeriod: aligned };
  }
  return {
    sort: sortKey,
    perfPeriod: normalizePerformancePeriod(perfPeriod),
  };
}

/** Camino period picker: el orden sigue al periodo elegido. */
export function applyPerfPeriodSelection(nextPerf = "") {
  const aligned = normalizePerformancePeriod(nextPerf);
  return { sort: aligned, perfPeriod: aligned };
}

/** Hidratar sesión: nunca dejar sort de rendimiento y periodo desalineados. */
export function alignRestoredSortSession({
  sort = "",
  perfPeriod = "",
  fallbackSort = DEFAULT_PERFORMANCE_PERIOD,
} = {}) {
  const sortKey = String(sort || "").trim();
  if (sortKey) {
    return alignSortPerfPeriod({ sort: sortKey, perfPeriod });
  }

  const perf = normalizePerformancePeriod(perfPeriod);
  const fallback = String(fallbackSort || "").trim();
  if (isPerformanceSortKey(fallback) || !fallback) {
    return { sort: perf, perfPeriod: perf };
  }
  return alignSortPerfPeriod({ sort: fallback, perfPeriod });
}
