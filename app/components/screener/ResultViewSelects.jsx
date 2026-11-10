"use client";

import { SECTOR_STRENGTH_LABELS, SECTOR_STRENGTH_OPTIONS, marketName } from "@/lib/screenerConfig";

/**
 * Resolución + capas de vista (país, tema, sector, subsector, fuerza de
 * grupo). Mismos selects en el popover «+ Filtro» de escritorio y en la hoja
 * de filtros móvil: un solo sitio que los define.
 */
export default function ResultViewSelects({
  optionLabel,
  decisionResolutionFilter,
  decisionResolutionOptions,
  onDecisionResolutionFilter,
  showResolution = true,
  viewLayers,
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
}) {
  const hasViewLayers = Boolean(
    viewLayers.country || viewLayers.theme || viewLayers.sector || viewLayers.industry || viewLayers.sectorStrength,
  );
  const resolutionActive = decisionResolutionFilter !== "all";
  return <>
    {/* «Resolución» filtra por lo que el usuario ha marcado en Review/Ficha,
        no por un juicio del sistema. Los filtros fantasma de auditoría/decisión
        se retiraron de la vista (UX-4): ya no ocultan filas en silencio. */}
    {showResolution ? <select className="select resultFilterSelect" value={decisionResolutionFilter} onChange={(e) => onDecisionResolutionFilter(e.target.value)} aria-label="Filtrar por resolución de decisión" data-active={resolutionActive ? "true" : "false"}>
      {decisionResolutionOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
    </select> : null}
    {/* Orden en escritorio: cabeceras de columna. Móvil: `MobileSortSelect`. */}
    {hasViewLayers ? <>
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
    </> : null}
  </>;
}
