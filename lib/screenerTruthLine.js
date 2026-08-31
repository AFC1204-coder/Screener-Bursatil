// lib/screenerTruthLine.js — una sola frase de verdad para el screener
// (analizadas / pasan / en lista / orden / fecha de corte).

import { dateTime } from "@/lib/formatters";
import { buildScreenerTruthMarketSegments } from "@/lib/marketAvailability";
import { analyzedCountForDisplay } from "@/lib/screenerFormat";
import { SORT_LABELS } from "@/lib/screenerConfig";

function sortDirectionLabel(sortAsc) {
  return sortAsc ? "↑" : "↓";
}

function formatSortLabel(sort, sortAsc) {
  const base = SORT_LABELS[sort] || sort || "—";
  return `${base} ${sortDirectionLabel(sortAsc)}`;
}

function formatListCountSegment(visibleCount, pageSize, totalPages) {
  let segment = `${visibleCount} en lista`;
  const size = Number(pageSize);
  if (size > 0) {
    const pages = Number(totalPages);
    const showPageHint = (pages > 1) || (visibleCount > size);
    if (showPageHint) {
      segment += ` · ${size}/página`;
    }
  }
  return segment;
}

/**
 * Construye la línea de verdad del screener.
 * @param {object} params
 * @param {Array} params.analyzedRows
 * @param {number} params.passCount — filas que pasan el preset (rows.length)
 * @param {number} params.visibleCount — filas en lista tras filtros de vista (filtered.length)
 * @param {number} [params.pageSize] — tamaño de página del pager (opcional)
 * @param {number} [params.totalPages] — páginas totales del pager (opcional)
 * @param {string} params.presetName — nombre del preset activo
 * @param {string} params.sort
 * @param {boolean} params.sortAsc
 * @param {string|Date|null} params.scannedAt
 * @param {string[]} [params.scannedMarkets] — mercados del scan cargado
 * @param {string[]} [params.selectedMarkets] — selección UI actual
 * @param {boolean} [params.marketsMisaligned] — selección ≠ datos de mesa
 */
/**
 * Alinea passCount / visibleCount para la línea de verdad sin mezclar filas
 * eager (rows) con la lista diferida (filtered) durante transiciones hunt.
 */
export function resolveScreenerTruthCounts({
  eagerPassCount = 0,
  filteredVisibleCount = 0,
  huntTruthOverride = null,
  isHuntTransitionPending = false,
  rowsDeferredStale = false,
  viewFiltersActive = 0,
} = {}) {
  const passCount = huntTruthOverride?.passCount ?? eagerPassCount;
  const hasActiveViewFilters = Number(viewFiltersActive) > 0;
  const hasHuntTruthOverride = huntTruthOverride != null;
  const listSyncPending = (
    isHuntTransitionPending
    || rowsDeferredStale
    || hasHuntTruthOverride
  );
  const visibleCount = (listSyncPending && !hasActiveViewFilters)
    ? passCount
    : filteredVisibleCount;
  return { passCount, visibleCount };
}

export function buildScreenerTruthLine({
  analyzedRows = [],
  passCount = 0,
  visibleCount = 0,
  pageSize,
  totalPages,
  presetName = "Filtro",
  sort = "",
  sortAsc = false,
  scannedAt = null,
  scannedMarkets = [],
  selectedMarkets = [],
  marketsMisaligned = false,
} = {}) {
  const analyzed = analyzedCountForDisplay(analyzedRows);
  const marketSegments = buildScreenerTruthMarketSegments({
    scannedMarkets,
    selectedMarkets,
    marketsMisaligned,
  });
  const parts = [
    `${analyzed} analizadas`,
    `${passCount} pasan «${presetName}»`,
    formatListCountSegment(visibleCount, pageSize, totalPages),
    ...marketSegments,
    `orden: ${formatSortLabel(sort, sortAsc)}`,
  ];
  if (scannedAt) {
    parts.push(`corte ${dateTime(scannedAt)}`);
  }
  return parts.join(" · ");
}

export function marketCountLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? "1 mercado" : `${n} mercados`;
}
