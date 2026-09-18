import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { nightlyAbsenceNotice } from "@/lib/nightlyAbsence";

const Stub = ({ marker }) => React.createElement("div", { "data-stub": marker });

const { mockIsMobileViewport } = vi.hoisted(() => ({
  mockIsMobileViewport: vi.fn(() => false),
}));

vi.mock("@/lib/useScreenerMobileViewport", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useScreenerMobileViewport: () => mockIsMobileViewport(),
  };
});

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
vi.mock("@/app/components/screener/WeeklyChangesLine", () => ({
  default: ({ defer = false } = {}) => (defer ? null : Stub({ marker: "WeeklyChangesLine" })),
}));
vi.mock("@/app/components/screener/GlobalCoveragePanel", () => ({ default: () => Stub({ marker: "GlobalCoveragePanel" }) }));

let ScreenerShell;

beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
});

afterEach(() => {
  mockIsMobileViewport.mockReturnValue(false);
});

function makeEmptyMesaProps({
  snapshotNotice = nightlyAbsenceNotice({ reason: "no-nightly-scan" }),
  restoringScan = false,
  analyzedRows = [],
  err = null,
} = {}) {
  return {
    chrome: {
      presetKey: "balanced",
      markets: ["US"],
      filtered: [],
      filteredCount: 0,
      err,
      status: "Sin datos que mostrar.",
      snapshotNotice,
      restoringScan,
      showMobileFilters: false,
      sidebarCollapsed: false,
      setShowMobileFilters: () => {},
      setSidebarCollapsed: () => {},
      marketHealth: null,
      rows: [],
    },
    sidebar: {
      savedFilterTemplates: [],
      selectedFilterTemplateId: null,
      filterTemplateName: "",
      setPreset: () => {},
      applyHuntCard: () => {},
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
      familyIntensity: {},
      familyIntensityCustom: false,
      familyCoverage: {},
      familyImpact: {},
      previewFamilyIntensity: () => {},
      commitFamilyIntensity: () => {},
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
      setSort: () => {},
      sortAsc: false,
      toggleSortColumn: () => {},
      perfPeriod: "perf6m",
      setPerfPeriod: () => {},
      updateSetting: () => {},
      filtered: [],
      pagedRows: [],
      resultPageSize: 50,
      visibleResultPage: 1,
      totalResultPages: 1,
      resultPageStart: 0,
      resultPageEnd: 0,
      setResultPageClamped: () => {},
      updateResultPageSize: () => {},
      decisionResolutionFilter: "all",
      setDecisionResolutionFilter: () => {},
      decisionResolutionOptions: [{ key: "all", displayLabel: "Resolución: Todas" }],
      countryFilter: "",
      setCountryFilter: () => {},
      countryOptions: [],
      countryCounts: {},
      themeFilter: "",
      setThemeFilter: () => {},
      themeOptions: [],
      themeCounts: {},
      sectorFilter: "",
      setSectorFilter: () => {},
      sectorOptions: [],
      sectorCounts: {},
      industryFilter: "",
      setIndustryFilter: () => {},
      industryOptions: [],
      industryCounts: {},
      sectorStrength: "",
      setSectorStrength: () => {},
      sectorStrengthCounts: {},
      resultFilterChips: [],
      hiddenByView: 0,
      clearResultView: () => {},
      openResultViewReview: () => {},
      optionLabel: () => "",
      visibleBatchRows: false,
    },
    results: {
      filtered: [],
      rows: [],
      pagedRows: [],
      activeSettings: { setupMode: "leader" },
      analyzedRows,
      favoriteSymbols: new Set(),
      screenerDecisionResolutions: {},
      emptyLabel: "No hay datos cargados todavía.",
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
      scanStale: false,
      marketsStale: false,
      scannedAt: null,
      scannedMarkets: [],
      marketsLoadFailed: false,
      marketsLoadFailedDetail: "",
      marketsSelectionLoadSettled: true,
    },
  };
}

describe("ScreenerShell · P1 empty mesa humano", () => {
  it("con 0 analizadas y nocturno ausente muestra tarjeta humana, no banner rojo dominante", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeEmptyMesaProps()));
    expect(html).toContain("mesaEmptyCard");
    expect(html).toContain("Sin escaneo de anoche para EE. UU.");
    expect(html).toContain("Reintentar");
    expect(html).toContain("Buscar ticker");
    expect(html).toContain("Detalle técnico");
    expect(html).toContain("dashboardContainer--mesaEmpty");
    expect(html).not.toContain("snapshotFreshnessNotice");
    expect(html).not.toContain('data-stub="ResultPagerTable"');
    expect(html).not.toContain('data-stub="ResultFilterBar"');
  });

  it("con mesa hidratada no pinta la tarjeta empty", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeEmptyMesaProps({
      analyzedRows: [{ symbol: "AAPL" }],
      snapshotNotice: null,
    })));
    expect(html).not.toContain("mesaEmptyCard");
    expect(html).toContain('data-stub="ResultPagerTable"');
    expect(html).not.toContain("dashboardContainer--mesaEmpty");
  });

  it("en cold restore no pinta la tarjeta (T9 quiet)", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeEmptyMesaProps({
      restoringScan: true,
      snapshotNotice: null,
    })));
    expect(html).not.toContain("mesaEmptyCard");
  });
});
