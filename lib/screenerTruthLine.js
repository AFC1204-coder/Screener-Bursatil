// lib/screenerTruthLine.js — una sola frase de verdad para el screener
// (pasan / en lista si difiere / mesa / corte).

import { dateTime } from "@/lib/formatters";
import {
  buildScreenerTruthMarketSegments,
  describeCuratedPopulationGap,
  describeEuropeCoverageGap,
} from "@/lib/marketAvailability";
import { analyzedCountForDisplay } from "@/lib/screenerFormat";

export const SCREENER_TRUTH_LOADING_SEGMENT = "cargando…";
export const SCREENER_TRUTH_UNAVAILABLE_SEGMENT = "Sin datos para evaluar esta ficha";

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
 * @param {boolean} [params.loading] — carga en curso; no afirmar 0·0·0 estables. Sin universo evaluable asentado se usa SCREENER_TRUTH_UNAVAILABLE_SEGMENT.
 * @param {boolean} [params.quietProgress] — T9: otro status primario ya cuenta la carga; no pintar «cargando…» ni «Sin datos…» con universo vacío.
 * @param {object|null} [params.universeCache] — cache.status curated-fallback (FIRDS-CURATED-AVISO-1)
 * @param {object|null} [params.providerDiagnostics] — runtime por mercado (esma/fca not_configured)
 * @param {boolean|null} [params.esmaFirdsEnabled] — señal explícita; null = leer env en servidor
 * @param {boolean|null} [params.fcaFirdsEnabled]
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
  quietProgress = false,
  universeCache = null,
  providerDiagnostics = null,
  esmaFirdsEnabled = null,
  fcaFirdsEnabled = null,
} = {}) {
  const analyzed = analyzedCountForDisplay(analyzedRows);
  const misaligned = !suppressMisalignmentAlarm && marketsMisaligned;
  // EUROPA-COVERAGE-TRUTH-1: con hueco de secundarios, la verdad no omite el aviso
  // (banner P9 sigue siendo la superficie principal; aquí va un segmento corto).
  const europeCoverageHonesty = Boolean(
    misaligned
    && describeEuropeCoverageGap({ scannedMarkets, selectedMarkets }),
  );
  const curatedPopulationHonesty = Boolean(
    describeCuratedPopulationGap({
      scannedMarkets,
      selectedMarkets,
      universeCache,
      providerDiagnostics,
      esmaFirdsEnabled,
      fcaFirdsEnabled,
    }),
  );
  const marketSegments = misaligned && !europeCoverageHonesty && !curatedPopulationHonesty
    ? []
    : buildScreenerTruthMarketSegments({
      analyzedRows,
      scannedMarkets,
      selectedMarkets,
      marketsMisaligned,
      suppressMisalignmentAlarm,
      compact: compactMarketSegments,
      europeCoverageHonesty,
      curatedPopulationHonesty,
      universeCache,
      providerDiagnostics,
      esmaFirdsEnabled,
      fcaFirdsEnabled,
    });
  const countsUnknown = loading && analyzed === 0 && passCount === 0 && visibleCount === 0;
  // T9: con status primario (scan bar) la truth no compite ni miente «Sin datos».
  if (quietProgress && analyzed === 0 && passCount === 0 && visibleCount === 0) {
    const quietParts = [...marketSegments];
    if (!compactMarketSegments && scannedAt) {
      quietParts.push(`corte ${dateTime(scannedAt)}`);
    }
    return quietParts.join(" · ");
  }
  // Mismo contrato que resultsEmptyLabel: analyzed=0 asentado no es un
  // universo evaluado. "0 de 0 pasan" solo nacería de confundir ausencia
  // de dataset con cero candidatos.
  const universeUnevaluable = !loading && analyzed === 0 && passCount === 0;
  const passSegment = countsUnknown
    ? SCREENER_TRUTH_LOADING_SEGMENT
    : universeUnevaluable
      ? SCREENER_TRUTH_UNAVAILABLE_SEGMENT
      : formatPassSegment(passCount, analyzed, presetName);
  const parts = (countsUnknown || universeUnevaluable)
    ? [passSegment, ...marketSegments]
    : [
      passSegment,
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
