import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { MARKETS_MISALIGNMENT_CTA, MARKETS_AUTO_LOAD_LOADING_LABEL } from "@/lib/marketAvailability";

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
vi.mock("@/app/components/screener/WeeklyChangesLine", () => ({ default: () => Stub({ marker: "WeeklyChangesLine" }) }));
vi.mock("@/app/components/screener/GlobalCoveragePanel", () => ({ default: () => Stub({ marker: "GlobalCoveragePanel" }) }));

let ScreenerShell;

beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
});

function makeProps({
  marketsStale = false,
  scanStale = marketsStale,
  scannedMarkets = ["US"],
  selectedMarkets = ["US", "CA"],
  snapshotNotice = null,
  restoringScan = false,
  marketsLoadFailed = false,
  marketsLoadFailedDetail = "",
} = {}) {
  const resultsRows = [{ symbol: "AAPL", country: "US" }];
  return {
    chrome: {
      presetKey: "balanced",
      markets: selectedMarkets,
      filtered: resultsRows,
      filteredCount: 1,
      err: null,
      status: "idle",
      snapshotNotice,
      restoringScan,
      showMobileFilters: false,
      sidebarCollapsed: false,
      setShowMobileFilters: () => {},
      setSidebarCollapsed: () => {},
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
    resultView: {
      sort: "perf6m",
      sortAsc: false,
      filtered: resultsRows,
      pagedRows: resultsRows,
    },
    results: {
      filtered: resultsRows,
      rows: resultsRows,
      pagedRows: resultsRows,
      activeSettings: {},
      analyzedRows: resultsRows,
      favoriteSymbols: new Set(),
      screenerDecisionResolutions: {},
    },
    actions: {
      openReview: () => {},
      openPrimaryReview: () => {},
      saveSnapshot: () => {},
      csv: () => {},
      decisionAuditJson: () => {},
      resetScreenerSession: () => {},
      refreshScreenerSnapshotData: () => {},
      loadScanForMarketSelection: () => {},
      addFavorite: () => {},
      saveSessionBeforeStockOpen: () => {},
      selectedResultSymbol: "",
      onSelectResultRow: () => {},
      openResultReview: () => {},
    },
    staleness: {
      scanStale,
      marketsStale,
      scannedAt: "2026-08-27T14:07:00.000Z",
      scannedMarkets,
      marketsLoadFailed,
      marketsLoadFailedDetail,
    },
  };
}

describe("ScreenerShell markets misalignment", () => {
  it("pinta la línea de verdad y un solo banner de carga (sin CTA) por viewport", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({ marketsStale: true })));
    expect(html).toContain("screenerTruthLine");
    expect(html).toContain("analizadas");
    expect(html).toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
    expect(html).not.toContain(MARKETS_MISALIGNMENT_CTA);
    expect((html.match(/scanStaleNotice--loading/g) || []).length).toBe(1);
    expect(html).not.toContain("resultados visibles");
    expect(html).not.toContain('class="kpi"');
  });

  it("no duplica el aviso markets-stale en snapshotNotice", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      snapshotNotice: {
        tone: "warn",
        label: "Mercados",
        detail: "Datos cargados: US. La selección actual (US, CA) no coincide.",
        source: "markets-stale",
      },
    })));
    expect(html.match(/snapshotFreshnessNotice/g) || []).toHaveLength(0);
    expect(html).not.toContain(MARKETS_MISALIGNMENT_CTA);
    expect(html).toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
  });

  it("muestra aviso de carga aunque scanStale sea false (firma alineada, datos US)", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["CA"],
    })));
    expect(html).not.toContain(MARKETS_MISALIGNMENT_CTA);
    expect(html).toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
    expect(html).not.toContain("Los criterios de cobertura cambiaron");
    expect((html.match(/scanStaleNotice--loading/g) || []).length).toBe(1);
  });

  it("HK seleccionado + scan US no muestra filas US como caza usable", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
    })));
    expect(html).not.toContain(MARKETS_MISALIGNMENT_CTA);
    expect(html).toContain("0 analizadas");
    expect(html).toContain("0 en lista");
    expect(html).toContain("mesa: US");
    expect(html).not.toContain("selección ≠ mesa");
    expect(html).not.toContain("AAPL");
    expect(html).not.toContain(">Revisar<");
    expect(html).not.toContain("1 en lista");
  });

  it("con mercados alineados la verdad incluye mesa sin aviso de desalineación", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: false,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })));
    expect(html).toContain("mesa: US");
    expect(html).not.toContain("selección ≠ mesa");
  });

  it("muestra Traer datos frescos solo cuando mercados coinciden pero scanStale", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: false,
      scanStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })));
    expect(html).not.toContain(MARKETS_MISALIGNMENT_CTA);
    expect(html).toContain("Los criterios de cobertura cambiaron");
    expect((html.match(/Los criterios de cobertura cambiaron/g) || []).length).toBe(1);
  });

  it("muestra CTA solo si falló la carga de mercados", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      marketsLoadFailed: true,
      marketsLoadFailedDetail: "No se pudo cargar Hong Kong.",
    })));
    expect(html).toContain(MARKETS_MISALIGNMENT_CTA);
    expect(html).toContain("No se pudo cargar Hong Kong.");
    expect(html).toContain("selección ≠ mesa");
  });

  it("no muestra aviso de mercados si solo cambian filtros (mercados alineados)", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: false,
      scanStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })));
    expect(html).not.toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
    expect(html).not.toContain(MARKETS_MISALIGNMENT_CTA);
  });
});
