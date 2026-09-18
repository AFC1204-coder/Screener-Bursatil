import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/screenerPanels", () => ({
  FilterArchitecturePanel: () => React.createElement("div", { "data-stub": "FilterArchitecturePanel" }),
}));

import ScreenerSidebar from "@/app/components/screener/ScreenerSidebar";

const baseProps = {
  mobileFiltersRef: { current: null },
  showMobileFilters: false,
  onCloseMobileFilters: () => {},
  markets: ["US"],
  marketsStale: false,
  isMarketPresetActive: (key) => key === "us",
  marketPreset: () => {},
  setMarketsAndInvalidate: () => {},
  filterLayers: {},
  useRegimeFilter: false,
  toggleFilterLayer: () => {},
  setActiveFilterFamily: () => {},
  setUseRegimeFilter: () => {},
  sheetFamilyKeys: [],
  cardLabel: "Líderes",
  settings: {},
  fieldRules: {},
  familyIntensity: {},
  familyIntensityCustom: {},
  familyCoverage: {},
  familyImpact: {},
  previewFamilyIntensity: () => {},
  commitFamilyIntensity: () => {},
};

describe("ScreenerSidebar chrome Diario/Expert", () => {
  it("Diario: chip de mercados + Ajustar ficha; familias no a la vista", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScreenerSidebar, { ...baseProps, chromeMode: "diario" }),
    );
    expect(html).toContain("sidebar--diario");
    expect(html).toContain("Mercados: EE. UU.");
    expect(html).toContain("Ajustar ficha");
    expect(html).toContain("marketCompactChip");
    expect(html).not.toContain("marketPanelHead");
    // Familias viven dentro del disclosure cerrado (markup presente pero colapsado)
    expect(html).toContain("FilterArchitecturePanel");
  });

  it("Expert: barra de presets abierta + familias visibles sin Ajustar ficha", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScreenerSidebar, { ...baseProps, chromeMode: "expert" }),
    );
    expect(html).toContain("sidebar--expert");
    expect(html).toContain("marketPanelHead");
    expect(html).toContain("Mercados");
    expect(html).not.toContain("Ajustar ficha");
    expect(html).not.toContain("marketCompactChip");
  });
});
