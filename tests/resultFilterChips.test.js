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
  const baseFilterBarProps = {
    optionLabel: (prefix, value) => `${prefix}: ${value}`,
    decisionResolutionFilter: "all",
    decisionResolutionOptions: [{ key: "all", displayLabel: "Resolución: Todas" }],
    onDecisionResolutionFilter: () => {},
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
    chips: [],
    hiddenCount: 0,
    visibleCount: 10,
    totalCount: 10,
    onClearAll: () => {},
  };

  // Rediseño 2026-11 (paso 5): sin Diario/Expert. «+ Filtro» es un único
  // popover con Resolución, capas de vista, lo que aplica la ficha (children)
  // y las familias (families). Nada de eso ocupa la fila.
  it("+ Filtro abre un popover con Resolución y capas de vista habilitadas", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterBar, {
      ...baseFilterBarProps,
    }));

    expect(html).toContain("screenerFilterPopover");
    expect(html).toContain(">Filtro<");
    expect(html).toMatch(/<details class="screenerFilterPopover">[\s\S]*Filtrar por resolución de decisión[\s\S]*Filtrar por país/);
    expect(html).not.toContain("resultFilterMore");
    expect(html).not.toContain("resultFilterBar--diario");
    expect(html).not.toContain(">Más filtros<");
    expect(html).not.toContain("Filtrar por IPO");
  });

  it("el popover aloja lo que aplica la ficha y las familias; sesiones con chromeMode antiguo no cambian nada", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterBar, {
      ...baseFilterBarProps,
      chromeMode: "expert",
      families: React.createElement("section", { className: "filterArchitecture" }, "familias"),
    }, React.createElement("div", { className: "huntCardModeStrip" }, "modo")));
    const panel = html.match(/<div class="screenerFilterPopoverPanel">[\s\S]*$/)?.[0] ?? "";
    expect(panel).toContain("huntCardModeStrip");
    expect(panel).toContain("filterArchitecture");
    expect(panel.indexOf("huntCardModeStrip")).toBeLessThan(panel.indexOf("filterArchitecture"));
    const legacy = renderToStaticMarkup(React.createElement(ResultFilterBar, { ...baseFilterBarProps, chromeMode: "diario" }));
    expect(legacy).toBe(renderToStaticMarkup(React.createElement(ResultFilterBar, { ...baseFilterBarProps })));
  });

  // viewFiltersActive (useResultViewModel) ya incluye Resolución; el resumen
  // no la suma dos veces (antes: 3 fichas → «4 activos»).
  it("el resumen del popover cuenta los filtros de vista activos una sola vez", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterBar, {
      ...baseFilterBarProps,
      decisionResolutionFilter: "candidate",
      viewFiltersActive: 3,
    }));
    expect(html).toContain("<em>3 activos</em>");
    expect(renderToStaticMarkup(React.createElement(ResultFilterBar, { ...baseFilterBarProps }))).not.toContain("activo");
  });

  it("no expone select de orden en escritorio (orden vía cabeceras de columna)", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterBar, {
      optionLabel: (prefix, value) => `${prefix}: ${value}`,
      decisionResolutionFilter: "all",
      decisionResolutionOptions: [{ key: "all", displayLabel: "Resolución: Todas" }],
      onDecisionResolutionFilter: () => {},
      viewLayers: { country: false, theme: false, sector: false, industry: false, sectorStrength: false, ipo: false },
      viewFiltersActive: 0,
      countryFilter: "Todos",
      countryOptions: ["Todos"],
      countryCounts: new Map(),
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
      chips: [],
      hiddenCount: 0,
      visibleCount: 10,
      totalCount: 10,
      onClearAll: () => {},
      chromeMode: "expert",
    }));

    expect(html).not.toContain("resultSortSelect");
    expect(html).not.toContain("Ordenar resultados");
  });

  it("no expone select de categoría IPO aunque viewLayers.ipo venga true (sesión vieja)", () => {
    const html = renderToStaticMarkup(React.createElement(ResultFilterBar, {
      optionLabel: (prefix, value) => `${prefix}: ${value}`,
      decisionResolutionFilter: "all",
      decisionResolutionOptions: [{ key: "all", displayLabel: "Resolución: Todas" }],
      onDecisionResolutionFilter: () => {},
      viewLayers: { country: false, theme: false, sector: false, industry: false, sectorStrength: false, ipo: true },
      viewFiltersActive: 0,
      countryFilter: "Todos",
      countryOptions: ["Todos"],
      countryCounts: new Map(),
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
      chips: [],
      hiddenCount: 0,
      visibleCount: 10,
      totalCount: 10,
      onClearAll: () => {},
      chromeMode: "expert",
    }));

    expect(html).not.toContain("Filtrar por IPO");
    expect(html).not.toContain("Filtrar por país");
  });
});
