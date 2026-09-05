// lib/screenerTruthLine.js — una sola frase de verdad para el screener
// (pasan / en lista si difiere / mesa / corte).

import { dateTime } from "@/lib/formatters";
import { buildScreenerTruthMarketSegments } from "@/lib/marketAvailability";
import { analyzedCountForDisplay } from "@/lib/screenerFormat";

function formatPassSegment(passCount, analyzed, presetName) {
  return `${passCount} de ${analyzed} pasan «${presetName}»`;
}

function formatListCountSegment(visibleCount, passCount) {
  if (visibleCount === passCount) return null;
  return `${visibleCount} en lista`;
}

/**
 * Construye la línea de verdad del screener.
 * @param {object} params
 * @param {Array} params.analyzedRows
 * @param {number} params.passCount — filas que pasan el preset (rows.length)
 * @param {number} params.visibleCount — filas en lista tras filtros de vista (filtered.length)
 * @param {number} [params.pageSize] — tamaño de página del pager (legacy; ya no se muestra)
 * @param {number} [params.totalPages] — páginas totales del pager (legacy; ya no se muestra)
 * @param {string} params.presetName — nombre del preset activo
 * @param {string} params.sort — legacy; el orden vive en la cabecera de columna
 * @param {boolean} params.sortAsc — legacy; el orden vive en la cabecera de columna
 * @param {string|Date|null} params.scannedAt
 * @param {string[]} [params.scannedMarkets] — mercados del scan cargado
 * @param {string[]} [params.selectedMarkets] — selección UI actual
 * @param {boolean} [params.marketsMisaligned] — selección ≠ datos de mesa
 * @param {boolean} [params.loading] — carga en curso; no afirmar 0·0·0 estables
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
  suppressMisalignmentAlarm = false,
  compactMarketSegments = false,
  loading = false,
} = {}) {
  const analyzed = analyzedCountForDisplay(analyzedRows);
  const misaligned = !suppressMisalignmentAlarm && marketsMisaligned;
  const marketSegments = misaligned
    ? []
    : buildScreenerTruthMarketSegments({
      scannedMarkets,
      selectedMarkets,
      marketsMisaligned,
      suppressMisalignmentAlarm,
      compact: compactMarketSegments,
    });
  const countsUnknown = loading && analyzed === 0 && passCount === 0 && visibleCount === 0;
  const parts = countsUnknown
    ? ["cargando…", ...marketSegments]
    : [
      formatPassSegment(passCount, analyzed, presetName),
      formatListCountSegment(visibleCount, passCount),
      ...marketSegments,
    ].filter(Boolean);
  if (!compactMarketSegments && scannedAt) {
    parts.push(`corte ${dateTime(scannedAt)}`);
  }
  return parts.join(" · ");
}

export function marketCountLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? "1 mercado" : `${n} mercados`;
}
