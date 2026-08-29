"use client";

// ResultFilterBar — slice presentacional de ScreenerShell.
// Contiene el select de resolución, el
// CTA «+ Filtro» (view-layers) y los ResultFilterChips.
// Recibe SOLO los slices que consume este bloque (no el prop-bag completo).

import { ResultFilterChips } from "@/app/screenerPanels";
import { SECTOR_STRENGTH_LABELS, SECTOR_STRENGTH_OPTIONS, marketName } from "@/lib/screenerConfig";

export default function ResultFilterBar({
  optionLabel,
  // Filter selects
  decisionResolutionFilter,
  decisionResolutionOptions,
  onDecisionResolutionFilter,
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
  onClearAll,
  onReview,
}) {
  return (
    <>
      <div className="controls resultFilterBar">
        {/* «Resolución» filtra por lo que el usuario ha marcado en Review/Ficha,
            no por un juicio del sistema. Los filtros fantasma de auditoría/decisión
            se retiraron de la vista (UX-4): ya no ocultan filas en silencio. */}
        <select className="select resultFilterSelect" value={decisionResolutionFilter} onChange={(e) => onDecisionResolutionFilter(e.target.value)} aria-label="Filtrar por resolución de decisión" data-active={decisionResolutionFilter !== "all" ? "true" : "false"}>
          {decisionResolutionOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
        </select>
        {/* Orden en escritorio: cabeceras de columna (CompactResultsTable). Móvil: select en MobileResultList. */}
        {/* View-layers: CTA compacto; el prefijo «+» lo aporta el CSS del summary. */}
        {(viewLayers.country || viewLayers.theme || viewLayers.sector || viewLayers.industry || viewLayers.sectorStrength || viewLayers.ipo) ? (
          <details className="disclosurePanel compactDisclosure viewLayerFilters">
            <summary aria-label="Añadir filtro de vista"><span>Filtro</span>{viewFiltersActive ? <em>{viewFiltersActive} activo{viewFiltersActive === 1 ? "" : "s"}</em> : null}</summary>
            <div className="controls resultFilterBar viewLayerFilterGrid">
              {viewLayers.country ? <select className="select resultFilterSelect" value={countryFilter} onChange={(e) => onCountryFilter(e.target.value)} aria-label="Filtrar por país" data-active={countryFilter !== "Todos" ? "true" : "false"}>
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
      <ResultFilterChips chips={chips} hiddenCount={hiddenCount} visibleCount={visibleCount} totalCount={totalCount} onClearAll={onClearAll} onReview={onReview} />
    </>
  );
}
