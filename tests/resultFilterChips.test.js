import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ResultFilterBar from "@/app/components/screener/ResultFilterBar";
import { ResultFilterChips } from "@/app/screenerPanels";

describe("ResultFilterChips", () => {
  it("resume la vista activa en una línea corta con impacto por chip", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterChips, {
      chips: [
        { key: "country", label: "País: Estados Unidos", impact: 42, onClear: () => {} },
      ],
      hiddenCount: 12,
      visibleCount: 42,
      totalCount: 54,
      onClearAll: () => {},
    }));

    expect(html).toContain("Vista: 42/54");
    expect(html).toContain("1 filtro");
    expect(html).toContain("−12 ocultas");
    expect(html).toContain("País: Estados Unidos");
    expect(html).toContain("resultFilterChipImpact");
    expect(html).toContain(">42<");
    expect(html).toContain("×");
  });

  it("no renderiza nada sin chips ni filas ocultas", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterChips, {
      chips: [],
      hiddenCount: 0,
      visibleCount: 10,
      totalCount: 10,
      onClearAll: () => {},
    }));
    expect(html).toBe("");
  });
});

describe("ResultFilterBar view-layer CTA", () => {
  it("expone el CTA + Filtro cuando hay capas de vista habilitadas", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterBar, {
      optionLabel: (prefix, value) => `${prefix}: ${value}`,
      decisionResolutionFilter: "all",
      decisionResolutionOptions: [{ key: "all", displayLabel: "Resolución: Todas" }],
      onDecisionResolutionFilter: () => {},
      sort: "perf3m",
      onSort: () => {},
      perfPeriod: "perf3m",
      viewLayers: { country: true, theme: false, sector: false, industry: false, sectorStrength: false, ipo: false },
      viewFiltersActive: 0,
      countryFilter: "Todos",
      countryOptions: ["Todos", "US"],
      countryCounts: new Map([["US", 10]]),
      onCountryFilter: () => {},
      themeFilter: "Todos",
      themeOptions: ["Todos"],
      themeCounts: new Map(),
      onThemeFilter: () => {},
      onSectorFilter: () => {},
      onIndustryFilter: () => {},
      sectorFilter: "Todos",
      sectorOptions: ["Todos"],
      sectorCounts: new Map(),
      industryFilter: "Todos",
      industryOptions: ["Todos"],
      industryCounts: new Map(),
      sectorStrength: "Todos",
      sectorStrengthCounts: new Map(),
      onSectorStrength: () => {},
      ipo: "Todos",
      ipos: ["Todos"],
      ipoCounts: new Map(),
      onIpo: () => {},
      chips: [],
      hiddenCount: 0,
      visibleCount: 10,
      totalCount: 10,
      onClearAll: () => {},
    }));

    expect(html).toContain("viewLayerFilters");
    expect(html).toContain(">Filtro<");
    expect(html).not.toContain("Más filtros");
  });
});
