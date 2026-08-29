// tests/screenerViewportMount.test.js — CLEAN-2: un solo árbol de resultados por viewport.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";
import {
  SCREENER_MOBILE_MAX_PX,
  SCREENER_MOBILE_MEDIA_QUERY,
} from "@/lib/useScreenerMobileViewport";

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
vi.mock("@/app/components/screener/WeeklyChangesLine", () => ({ default: () => Stub({ marker: "WeeklyChangesLine" }) }));
vi.mock("@/app/components/screener/GlobalCoveragePanel", () => ({ default: () => Stub({ marker: "GlobalCoveragePanel" }) }));
vi.mock("@/app/components/screener/HuntCardRail", () => ({ default: () => Stub({ marker: "HuntCardRail" }) }));
vi.mock("@/app/components/screener/HuntCardModeStrip", () => ({ default: () => Stub({ marker: "HuntCardModeStrip" }) }));

let ScreenerShell;

beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
});

function makeProps() {
  const resultsRows = [{ symbol: "AAPL", country: "US" }];
  const resultsFiltered = resultsRows;
  return {
    chrome: {
      presetKey: "balanced",
      markets: ["US"],
      filtered: resultsRows,
      filteredCount: 1,
      err: null,
      status: "idle",
      snapshotNotice: null,
      restoringScan: false,
      showMobileFilters: false,
      sidebarCollapsed: false,
      setShowMobileFilters: () => {},
      setSidebarCollapsed: () => {},
      marketHealth: null,
      rows: resultsRows,
      huntTruthOverride: null,
      isHuntTransitionPending: false,
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
      viewFiltersActive: 0,
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
      markAdvancedBaseline: () => {},
      familyIntensity: {},
      familyIntensityCustom: {},
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
      sortAsc: false,
      filtered: resultsFiltered,
      pagedRows: resultsFiltered,
      perfPeriod: "6m",
      decisionResolutionFilter: "",
      decisionResolutionOptions: [],
      setDecisionResolutionFilter: () => {},
      setSort: () => {},
      setPerfPeriod: () => {},
      viewLayers: {},
      viewFiltersActive: 0,
      countryFilter: "",
      countryOptions: [],
      countryCounts: {},
      setCountryFilter: () => {},
      themeFilter: "",
      themeOptions: [],
      themeCounts: {},
      setThemeFilter: () => {},
      setSectorFilter: () => {},
      setIndustryFilter: () => {},
      sectorFilter: "",
      sectorOptions: [],
      sectorCounts: {},
      industryFilter: "",
      industryOptions: [],
      industryCounts: {},
      sectorStrength: "",
      sectorStrengthCounts: {},
      setSectorStrength: () => {},
      ipo: "",
      ipos: [],
      ipoCounts: {},
      setIpo: () => {},
      resultFilterChips: [],
      hiddenByView: 0,
      clearResultView: () => {},
      openResultViewReview: () => {},
      resultPageSize: 50,
      updateResultPageSize: () => {},
      visibleResultPage: 1,
      totalResultPages: 1,
      setResultPageClamped: () => {},
      resultPageStart: 1,
      resultPageEnd: 1,
      toggleSortColumn: () => {},
      optionLabel: () => "",
      resultsEmptyLabel: "",
      resultsDecisionResolutions: {},
    },
    results: {
      filtered: resultsFiltered,
      rows: resultsRows,
      pagedRows: resultsFiltered,
      activeSettings: { setupMode: "" },
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
      openResultViewReview: () => {},
      setResultPageClamped: () => {},
    },
    staleness: {
      scanStale: false,
      marketsStale: false,
      scannedAt: "2026-08-27T14:07:00.000Z",
      scannedMarkets: ["US"],
    },
  };
}

describe("screener viewport constants", () => {
  it("usa breakpoint canónico 760px", () => {
    expect(SCREENER_MOBILE_MAX_PX).toBe(760);
    expect(SCREENER_MOBILE_MEDIA_QUERY).toBe("(max-width: 760px)");
  });
});

describe("useScreenerMobileViewport hidratación", () => {
  it("estado inicial desktop (false) en SSR antes del sync con matchMedia", async () => {
    const { useScreenerMobileViewport: realUseScreenerMobileViewport } = await vi.importActual("@/lib/useScreenerMobileViewport");
    function Probe() {
      const isMobile = realUseScreenerMobileViewport();
      return React.createElement("span", { "data-is-mobile": String(isMobile) });
    }
    const html = renderToStaticMarkup(React.createElement(Probe));
    expect(html).toContain("data-is-mobile=\"false\"");
  });
});

describe("ScreenerShell viewport mount", () => {
  it("desktop: monta desktopResultsSection sin mobileResearchHome ni MobileResultList", () => {
    mockIsMobileViewport.mockReturnValue(false);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toContain("desktopResultsSection");
    expect(html).toContain("data-stub=\"ResultPagerTable\"");
    expect(html).not.toContain("mobileResearchHome");
    expect(html).not.toContain("data-stub=\"MobileResultList\"");
  });

  it("móvil: monta mobileResearchHome y MobileResultList sin desktopResultsSection", () => {
    mockIsMobileViewport.mockReturnValue(true);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toContain("mobileResearchHome");
    expect(html).toContain("data-stub=\"MobileResultList\"");
    expect(html).not.toContain("desktopResultsSection");
    expect(html).not.toContain("data-stub=\"ResultPagerTable\"");
  });
});
