import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/screenerPanels", () => ({
  FilterArchitecturePanel: () => React.createElement("div", { "data-stub": "FilterArchitecturePanel" }),
}));

import { MarketScopeChip } from "@/app/components/screener/ScreenerSidebar";
import MobileFilterSheet from "@/app/components/screener/MobileFilterSheet";

// El cajón lateral móvil (ScreenerSidebar Diario/Expert) se retiró con el
// estudio móvil 2026-11 (paso 9). Quedan el chip de ámbito del ticket de
// escritorio y la hoja inferior de filtros, que monta las mismas piezas.

const marketProps = {
  markets: ["US"],
  marketsStale: false,
  isMarketPresetActive: (key) => key === "us",
  marketPreset: () => {},
  setMarketsAndInvalidate: () => {},
};

describe("selector de mercados", () => {
  it("chip de ámbito: «EE. UU.» con presets y rejilla plegada", () => {
    const html = renderToStaticMarkup(React.createElement(MarketScopeChip, marketProps));
    expect(html).toContain("Mercados: EE. UU.");
    expect(html).toContain("marketCompactChip");
    expect(html).toContain("marketPresetBar");
    expect(html).toContain("marketCustomizeDisclosure");
  });
});

describe("hoja de filtros móvil", () => {
  const sheetProps = {
    ...marketProps,
    open: true,
    onClose: () => {},
    title: "Líderes Etapa 2",
    families: React.createElement("div", { "data-stub": "FilterArchitecturePanel" }),
    analyzedCount: 3287,
    passCount: 937,
    visibleCount: 937,
    decisionResolutionFilter: "all",
    decisionResolutionOptions: [
      { key: "all", displayLabel: "Resolución: Todas" },
      { key: "candidate", displayLabel: "Resolución: Candidata (2)" },
    ],
    viewSelects: {
      optionLabel: (label, value) => `${label}: ${value}`,
      decisionResolutionFilter: "all",
      decisionResolutionOptions: [],
      viewLayers: { country: true },
      countryFilter: "Todos",
      countryOptions: ["Todos", "US"],
      countryCounts: {},
      onCountryFilter: () => {},
    },
  };

  it("cerrada no pinta nada", () => {
    expect(renderToStaticMarkup(React.createElement(MobileFilterSheet, { ...sheetProps, open: false }))).toBe("");
  });

  it("abierta: diálogo con mercados, familias, embudo, tu clasificación, capas de vista y «Ver N valores»", () => {
    const html = renderToStaticMarkup(React.createElement(MobileFilterSheet, sheetProps));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Filtros · Líderes Etapa 2");
    const order = ["marketPresetBar", "data-stub=\"FilterArchitecturePanel\"", "analizadas → 937 pasan", "Filtrar por tu clasificación", "Filtrar por país", "Rendimiento"];
    let last = -1;
    for (const marker of order) {
      const at = html.indexOf(marker);
      expect(at, marker).toBeGreaterThan(last);
      last = at;
    }
    // «Resolución:» es el prefijo del select de escritorio; aquí sobra.
    expect(html).toContain(">Candidata (2)<");
    expect(html).not.toContain("Resolución: Todas");
    expect(html).toContain("Ver 937 valores");
    expect(html).toContain("Restablecer");
  });
});
