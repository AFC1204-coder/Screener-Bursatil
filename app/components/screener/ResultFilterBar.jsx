"use client";

// ResultFilterBar — slice presentacional de ScreenerShell.
// Rediseño 2026-11 (paso 5): vive dentro de la barra de 40 px sobre la tabla.
// En la fila solo van las fichas del filtro vivo (ResultFilterChips) y «+ Filtro»;
// «+ Filtro» abre un popover con todo lo que antes ocupaba la página: lo que
// aplica la ficha y lo que recorta (children), Resolución y las capas de vista,
// y las familias del filtro (FilterArchitecturePanel, prop `families`).
// Recibe SOLO los slices que consume este bloque (no el prop-bag completo).
// IPO categoría retirada de la UI (IPO-UX-C); verifiedIpoCategory queda para CSV.

import { useEffect, useRef } from "react";
import { ResultFilterChips } from "@/app/screenerPanels";
import ResultViewSelects from "@/app/components/screener/ResultViewSelects";
import { OPEN_FILTER_POPOVER_EVENT } from "@/lib/screenerHuntTapeEmpty";

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
  // ResultFilterChips
  chips,
  hiddenCount,
  visibleCount,
  totalCount,
  onClearAll,
  onReview,
  // Popover «+ Filtro»: familias del filtro (FilterArchitecturePanel) y, arriba,
  // lo que aplica la ficha / lo que recorta (children).
  families = null,
  children = null,
}) {
  const popoverRef = useRef(null);
  // viewFiltersActive (useResultViewModel) ya incluye Resolución: sumarla otra
  // vez contaba «4 activos» con 3 fichas.
  const moreActiveCount = Number(viewFiltersActive) || 0;

  // Popover: se cierra con Escape o con un clic fuera (incluida la propia barra).
  useEffect(() => {
    function close(event) {
      const node = popoverRef.current;
      if (!node?.open) return;
      if (event.type === "keydown") {
        if (event.key === "Escape") {
          node.open = false;
          // Paso 7: este Esc es del popover; el panel lateral no se cierra con él.
          event.preventDefault();
        }
        return;
      }
      if (!node.contains(event.target)) node.open = false;
    }
    // Paso 8: «Ajustar filtro» del estado vacío abre este mismo popover.
    function open() {
      if (popoverRef.current) popoverRef.current.open = true;
    }
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", close);
    window.addEventListener(OPEN_FILTER_POPOVER_EVENT, open);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
      window.removeEventListener(OPEN_FILTER_POPOVER_EVENT, open);
    };
  }, []);

  return (
    <div className="resultFilterStrip">
      <ResultFilterChips chips={chips} hiddenCount={hiddenCount} visibleCount={visibleCount} totalCount={totalCount} onClearAll={onClearAll} onReview={onReview} />
      <details ref={popoverRef} className="screenerFilterPopover">
        <summary aria-label="Añadir o ajustar filtros">
          <span>Filtro</span>
          {moreActiveCount ? <em>{moreActiveCount} activo{moreActiveCount === 1 ? "" : "s"}</em> : null}
        </summary>
        <div className="screenerFilterPopoverPanel">
          {children}
          <div className="controls resultFilterBar">
            <ResultViewSelects
              optionLabel={optionLabel}
              decisionResolutionFilter={decisionResolutionFilter}
              decisionResolutionOptions={decisionResolutionOptions}
              onDecisionResolutionFilter={onDecisionResolutionFilter}
              viewLayers={viewLayers}
              countryFilter={countryFilter}
              countryOptions={countryOptions}
              countryCounts={countryCounts}
              onCountryFilter={onCountryFilter}
              themeFilter={themeFilter}
              themeOptions={themeOptions}
              themeCounts={themeCounts}
              onThemeFilter={onThemeFilter}
              onSectorFilter={onSectorFilter}
              onIndustryFilter={onIndustryFilter}
              sectorFilter={sectorFilter}
              sectorOptions={sectorOptions}
              sectorCounts={sectorCounts}
              industryFilter={industryFilter}
              industryOptions={industryOptions}
              industryCounts={industryCounts}
              sectorStrength={sectorStrength}
              sectorStrengthCounts={sectorStrengthCounts}
              onSectorStrength={onSectorStrength}
            />
          </div>
          {families}
        </div>
      </details>
    </div>
  );
}
