import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";

// ScreenerShell arrastra un barrel grande de paneles (screenerPanels) y varios
// sub-componentes de decisión/tabla. Para aislar la franja P3 mockeamos esos
// nodos como stubs y dejamos que el resto (lib de formato/config puras) corra
// real. Esto sigue el patrón del repo: renderToStaticMarkup + aserciones sobre
// el HTML emitido, sin montar un DOM de navegador.

const Stub = ({ marker }) => React.createElement("div", { "data-stub": marker });

vi.mock("@/app/screenerPanels", () => ({
  FilterArchitecturePanel: () => Stub({ marker: "FilterArchitecturePanel" }),
  FilterDiagnosticsPanel: () => Stub({ marker: "FilterDiagnosticsPanel" }),
  FilterNumber: () => Stub({ marker: "FilterNumber" }),
  FilterTemplatePanel: () => Stub({ marker: "FilterTemplatePanel" }),
  FilterToggle: () => Stub({ marker: "FilterToggle" }),
  MarketMiniTape: () => Stub({ marker: "MarketMiniTape" }),
  MobileResultList: () => Stub({ marker: "MobileResultList" }),
  PreviewCard: () => Stub({ marker: "PreviewCard" }),
  SearchCandidateList: () => Stub({ marker: "SearchCandidateList" }),
  SearchScopeList: () => Stub({ marker: "SearchScopeList" }),
  SetupChipRail: () => Stub({ marker: "SetupChipRail" }),
}));

vi.mock("@/app/components/screener/ResultFilterBar", () => ({ default: () => Stub({ marker: "ResultFilterBar" }) }));
vi.mock("@/app/components/screener/ResultPagerTable", () => ({ default: () => Stub({ marker: "ResultPagerTable" }) }));

let ScreenerShell;
beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
});

// Construye un prop-bag mínimo pero coherente. `results` es un OBJETO (prop-bag),
// no un array: las filas están en resultsRows. Esta es la regresión central.
function makeProps({ resultsRows = [] } = {}) {
  return {
    chrome: {
      presetKey: "global",
      markets: [["US", "EE. UU."]],
      filtered: [],
      filteredCount: 0,
      err: null,
      status: "idle",
      snapshotNotice: null,
      showMobileFilters: false,
      sidebarCollapsed: false,
      setShowMobileFilters: () => {},
      setSidebarCollapsed: () => {},
      kpiUniverseCount: 0,
      marketHealth: null,
      rows: resultsRows,
    },
    sidebar: {
      savedFilterTemplates: [],
      selectedFilterTemplateId: null,
      filterTemplateName: "",
      setPreset: () => {},
      applySavedFilterTemplate: () => {},
      setFilterTemplateName: () => {},
      saveCurrentFilterTemplate: () => {},
      deleteSavedFilterTemplate: () => {},
      saveFilterConfigToCloud: () => {},
      loadFilterConfigFromCloud: () => {},
      isMarketPresetActive: () => false,
      marketPreset: () => {},
      setMarketsAndInvalidate: () => {},
      advancedOpen: false,
      persistAdvancedOpen: () => {},
      advancedChangeCount: 0,
      filterLayers: {},
      viewLayers: {},
      useRegimeFilter: false,
      setUseRegimeFilter: () => {},
      toggleFilterLayer: () => {},
      setActiveFilterFamily: () => {},
      toggleViewLayer: () => {},
      executionRuleActive: 0,
      executionRuleTotal: 0,
      viewFiltersActive: false,
      setFilterLayers: () => {},
      settings: {},
      updateSetting: () => {},
      settingApplies: () => false,
      inactiveSettingReason: () => "",
      toggleLayeredSetting: () => {},
      fieldRules: {},
      isFieldRuleActive: () => false,
      inactiveFieldReason: () => "",
      toggleFieldRule: () => {},
      fineRuleActive: 0,
      fineRuleTotal: 0,
      setSettings: () => {},
      setFieldRules: () => {},
      diagnostics: null,
    },
    search: {
      searchSymbol: "",
      updateSearchSymbol: () => {},
      searchCandidates: [],
      searchResult: null,
      searchScopeItems: [],
      searchLoading: false,
      searchError: null,
      runSearch: () => {},
      clearSearch: () => {},
      applySearchScope: () => {},
      setSearchSymbol: () => {},
      loadSearchResult: () => {},
      favoriteSymbols: new Set(),
      screenerDecisionResolutions: {},
      addFavorite: () => {},
      saveSessionBeforeStockOpen: () => {},
    },
    resultView: {},
    results: {
      filtered: resultsRows,
      rows: resultsRows,
      pagedRows: resultsRows,
      activeSettings: {},
      analyzedRows: [],
      universe: [],
      favoriteSymbols: new Set(),
      screenerDecisionResolutions: {},
    },
    actions: {
      openReview: () => {},
      saveSnapshot: () => {},
      csv: () => {},
      decisionAuditJson: () => {},
      resetScreenerSession: () => {},
      addFavorite: () => {},
      saveSessionBeforeStockOpen: () => {},
    },
    staleness: { scanStale: false },
  };
}

const FINAL_ROW = { symbol: "FIN", percentileScope: "final" };
const BATCH_ROW = { symbol: "BAT", percentileScope: "batch" };
const UNSCOPED_ROW = { symbol: "OLD" }; // percentileScope ausente ⇒ tratado como batch

// La VARIANTE PENDIENTE de la franja ("Actualización preparada · percentil por
// lote", pegada a PendingResultsBar) se retiró el 2026-08-16 junto con la lista
// congelada y el botón Ejecutar: sin actualización pendiente no hay nada que
// anunciar. La franja de la LISTA VISIBLE sigue vigente y aquí fijada.
describe("ScreenerShell · franja P3 (percentil por lote)", () => {
  it("mantiene la franja visible cuando resultsRows contiene filas batch", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({ resultsRows: [FINAL_ROW, BATCH_ROW] })));
    expect(html).toContain("Muestra parcial · percentil por lote");
    expect(html).toContain("percentileScopeNotice");
  });

  it("trata percentileScope ausente como batch en la lista visible", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({ resultsRows: [UNSCOPED_ROW] })));
    expect(html).toContain("Muestra parcial · percentil por lote");
  });

  it("no muestra la franja cuando la lista visible es exclusivamente final", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({ resultsRows: [FINAL_ROW] })));
    expect(html).not.toContain("Muestra parcial · percentil por lote");
  });

  it("no llama .some sobre el prop-bag results: usa resultsRows", () => {
    // `results` es un objeto (prop-bag), no un array. Si el código volviera a
    // hacer results.some(...) esto lanzaría en runtime. Renderiza sin error.
    const props = makeProps({ resultsRows: [FINAL_ROW] });
    expect(() => renderToStaticMarkup(React.createElement(ScreenerShell, props))).not.toThrow();
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).not.toContain("percentil por lote");
  });

  it("REGRESIÓN 2026-08-16: la lista congelada no vuelve a la superficie", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({ resultsRows: [FINAL_ROW, BATCH_ROW] })));
    expect(html).not.toContain("percentileScopeNoticePending");
    expect(html).not.toContain("Actualización preparada");
    expect(html).not.toContain("pendingResultsBar");
    expect(html).not.toContain(">Ejecutar<");
    expect(html).not.toContain(">Detener<");
  });
});
