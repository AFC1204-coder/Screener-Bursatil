"use client";

// ResultFilterBar — slice presentacional de ScreenerShell.
// Contiene los selects de orden/acción/confianza/resolución/fiabilidad, el
// disclosure "Más filtros" (view-layers) y los ResultFilterChips.
// Recibe SOLO los slices que consume este bloque (no el prop-bag completo).

import { ResultFilterChips } from "@/app/screenerPanels";
import { SECTOR_STRENGTH_LABELS, SECTOR_STRENGTH_OPTIONS, SORT_LABELS, marketName } from "@/lib/screenerConfig";
import { RELIABILITY_FILTER_ALL } from "@/lib/screenerReliability";
import { screenerSortOptions } from "@/lib/screenerColumns";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";
import { rankActionLabel } from "@/lib/screenerExplainability";
import { decisionConfidenceLabel } from "@/lib/decisionAudit";

export default function ResultFilterBar({
  optionLabel,
  // Sort/control selects
  decisionResolutionFilter,
  decisionResolutionOptions,
  onDecisionResolutionFilter,
  reliabilityFilter,
  reliabilityOptions,
  onReliabilityFilter,
  confidenceFilter,
  confidenceOptions,
  confidenceCounts,
  onConfidenceFilter,
  actionFilter,
  actionOptions,
  actionCounts,
  onActionFilter,
  sort,
  onSort,
  perfPeriod,
  // View-layer selects
  viewLayers,
  viewFiltersActive,
  countryFilter,
  countryOptions,
  countryCounts,
  onCountryFilter,
  themeFilter,
  themeOptions,
  themeCounts,
  onThemeFilter,
  onSectorFilter,
  onIndustryFilter,
  sectorFilter,
  sectorOptions,
  sectorCounts,
  industryFilter,
  industryOptions,
  industryCounts,
  sectorStrength,
  sectorStrengthCounts,
  onSectorStrength,
  ipo,
  ipos,
  ipoCounts,
  onIpo,
  // ResultFilterChips
  chips,
  hiddenCount,
  visibleCount,
  totalCount,
  brief,
  onClearAll,
  onReview,
}) {
  const sortOptions = screenerSortOptions({ perfPeriod });
  const legacySort = sort && !sortOptions.some((item) => item.value === sort)
    ? { value: sort, label: SORT_LABELS[sort] || sort }
    : null;
  return (
    <>
      <div className="controls resultFilterBar">
        {/* No redundantes: resolución/fiabilidad/acción no tienen rail equivalente. */}
        <select className="select resultFilterSelect" value={decisionResolutionFilter} onChange={(e) => onDecisionResolutionFilter(e.target.value)} aria-label="Filtrar por resolución de decision" data-active={decisionResolutionFilter !== "all" ? "true" : "false"}>
          {decisionResolutionOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
        </select>
        <select className="select resultFilterSelect" value={reliabilityFilter} onChange={(e) => onReliabilityFilter(e.target.value)} aria-label="Filtrar por fiabilidad de observacion" data-active={reliabilityFilter !== RELIABILITY_FILTER_ALL ? "true" : "false"}>
          {reliabilityOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
        </select>
        {/* NO borrar: DecisionOperatingBrief solo emite onConfidenceFilter("high"); este select
            es el único acceso a medium/low/very-low confidence. */}
        <select className="select resultFilterSelect" value={confidenceFilter} onChange={(e) => onConfidenceFilter(e.target.value)} aria-label="Filtrar por confianza de decision" data-active={confidenceFilter !== "Todos" ? "true" : "false"}>
          {confidenceOptions.map((x) => <option key={x} value={x}>{optionLabel("Confianza", x, confidenceCounts, decisionConfidenceLabel)}</option>)}
        </select>
        <select className="select resultFilterSelect" value={actionFilter} onChange={(e) => onActionFilter(e.target.value)} aria-label="Filtrar por accion sugerida" data-active={actionFilter !== "Todos" ? "true" : "false"}>
          {actionOptions.map((x) => <option key={x} value={x}>{optionLabel("Acción", x, actionCounts, rankActionLabel)}</option>)}
        </select>
        {/* Ordenar solo por lo que la tabla muestra (lib/screenerColumns.jsx).
            Un criterio antiguo restaurado de sesión se conserva visible para no
            reordenar a espaldas del usuario, pero deja de poder elegirse. */}
        <select className="select resultFilterSelect resultSortSelect" value={sort} onChange={(e) => onSort(e.target.value)} aria-label="Ordenar resultados" data-active={sort !== DEFAULT_PERFORMANCE_PERIOD ? "true" : "false"}>
          {legacySort ? <option value={legacySort.value}>Ordenar: {legacySort.label}</option> : null}
          {sortOptions.map((item) => <option key={item.value} value={item.value}>Ordenar: {item.label}</option>)}
        </select>
        {/* View-layers: colapsados para reducir saturación de la barra de filtros. */}
        {(viewLayers.country || viewLayers.theme || viewLayers.sector || viewLayers.industry || viewLayers.sectorStrength || viewLayers.ipo) ? (
          <details className="disclosurePanel compactDisclosure viewLayerFilters">
            <summary><span>Más filtros</span><em>{viewFiltersActive} activos</em></summary>
            <div className="controls resultFilterBar viewLayerFilterGrid">
              {viewLayers.country ? <select className="select resultFilterSelect" value={countryFilter} onChange={(e) => onCountryFilter(e.target.value)} aria-label="Filtrar por pais" data-active={countryFilter !== "Todos" ? "true" : "false"}>
                {countryOptions.map((x) => <option key={x} value={x}>{optionLabel("País", x, countryCounts, (code) => `${code} · ${marketName(code)}`)}</option>)}
              </select> : null}
              {viewLayers.theme ? <select className="select resultFilterSelect" value={themeFilter} onChange={(e) => { onThemeFilter(e.target.value); onSectorFilter("Todos"); onIndustryFilter("Todos"); }} aria-label="Filtrar por tema" data-active={themeFilter !== "Todos" ? "true" : "false"}>
                {themeOptions.map((x) => <option key={x} value={x}>{optionLabel("Tema", x, themeCounts)}</option>)}
              </select> : null}
              {viewLayers.sector ? <select className="select resultFilterSelect" value={sectorFilter} onChange={(e) => { onSectorFilter(e.target.value); onIndustryFilter("Todos"); }} aria-label="Filtrar por sector" data-active={sectorFilter !== "Todos" ? "true" : "false"}>
                {sectorOptions.map((x) => <option key={x} value={x}>{optionLabel("Sector", x, sectorCounts)}</option>)}
              </select> : null}
              {viewLayers.industry ? <select className="select resultFilterSelect" value={industryFilter} onChange={(e) => onIndustryFilter(e.target.value)} aria-label="Filtrar por subsector" data-active={industryFilter !== "Todos" ? "true" : "false"}>
                {industryOptions.map((x) => <option key={x} value={x}>{optionLabel("Subsector", x, industryCounts)}</option>)}
              </select> : null}
              {viewLayers.sectorStrength ? <select className="select resultFilterSelect" value={sectorStrength} onChange={(e) => onSectorStrength(e.target.value)} aria-label="Filtrar por fuerza de grupo" data-active={sectorStrength !== "Todos" ? "true" : "false"}>
                {SECTOR_STRENGTH_OPTIONS.map((x) => <option key={x} value={x}>{optionLabel("Fuerza grupo", x, sectorStrengthCounts, (item) => SECTOR_STRENGTH_LABELS[item] || item)}</option>)}
              </select> : null}
              {viewLayers.ipo ? <select className="select resultFilterSelect" value={ipo} onChange={(e) => onIpo(e.target.value)} aria-label="Filtrar por IPO" data-active={ipo !== "Todos" ? "true" : "false"}>
                {ipos.map((x) => <option key={x} value={x}>{optionLabel("IPO", x, ipoCounts)}</option>)}
              </select> : null}
            </div>
          </details>
        ) : null}
      </div>
      <ResultFilterChips chips={chips} hiddenCount={hiddenCount} visibleCount={visibleCount} totalCount={totalCount} brief={brief} onClearAll={onClearAll} onReview={onReview} />
    </>
  );
}
