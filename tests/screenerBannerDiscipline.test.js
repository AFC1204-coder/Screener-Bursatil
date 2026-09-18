// tests/screenerBannerDiscipline.test.js — P2: shell no pinta muro de banners.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { buildMergedSnapshotNotice } from "@/lib/marketAvailability";
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

function makeProps({
  marketsStale = false,
  scanStale = false,
  scannedMarkets = ["US"],
  selectedMarkets = ["US"],
  snapshotNotice = null,
  restoringScan = false,
  marketsLoadFailed = false,
  marketsLoadFailedDetail = "",
  marketsSelectionLoadSettled = false,
  err = null,
  status = "idle",
  analyzedExtra = null,
} = {}) {
  const resultsRows = analyzedExtra || [{ symbol: "AAPL", country: "US" }];
  return {
    chrome: {
      presetKey: "balanced",
      markets: selectedMarkets,
      filtered: resultsRows,
      filteredCount: resultsRows.length,
      err,
      status,
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
      filterLayers: {},
      viewLayers: {},
      useRegimeFilter: false,
      setUseRegimeFilter: () => {},
      toggleFilterLayer: () => {},
      setActiveFilterFamily: () => {},
      viewFiltersActive: false,
      settings: {},
      fieldRules: {},
      diagnostics: null,
      familyIntensity: {},
      familyIntensityCustom: {},
      familyCoverage: {},
      familyImpact: {},
      previewFamilyIntensity: () => {},
      commitFamilyIntensity: () => {},
      updateSetting: () => {},
    },
    search: {
      searchSymbol: "",
      updateSearchSymbol: () => {},
      searchCandidates: [],
      searchResult: null,
      searchScopeItems: [],
      searchLoading: false,
      searchError: "",
      runSearch: (e) => e?.preventDefault?.(),
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
      sort: "score",
      setSort: () => {},
      sortAsc: false,
      toggleSortColumn: () => {},
      perfPeriod: "6m",
      setPerfPeriod: () => {},
      updateSetting: () => {},
      filtered: resultsRows,
      pagedRows: resultsRows,
      visibleResultPage: 1,
      resultPageSize: 50,
      updateResultPageSize: () => {},
      totalResultPages: 1,
      setResultPageClamped: () => {},
      resultPageStart: 0,
      resultPageEnd: resultsRows.length,
      optionLabel: () => "",
      decisionResolutionFilter: "all",
      setDecisionResolutionFilter: () => {},
      decisionResolutionOptions: [],
      countryFilter: "all",
      setCountryFilter: () => {},
      countryOptions: [],
      countryCounts: {},
      themeFilter: "all",
      setThemeFilter: () => {},
      setSectorFilter: () => {},
      setIndustryFilter: () => {},
      themeOptions: [],
      themeCounts: {},
      sectorFilter: "all",
      sectorOptions: [],
      sectorCounts: {},
      industryFilter: "all",
      industryOptions: [],
      industryCounts: {},
      sectorStrength: "all",
      setSectorStrength: () => {},
      sectorStrengthCounts: {},
      resultFilterChips: [],
      hiddenByView: 0,
      clearResultView: () => {},
      openResultViewReview: () => {},
    },
    results: {
      filtered: resultsRows,
      rows: resultsRows,
      pagedRows: resultsRows,
      activeSettings: {},
      analyzedRows: resultsRows,
      favoriteSymbols: new Set(),
      screenerDecisionResolutions: {},
      emptyLabel: "Sin resultados",
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
      selectedResultSymbol: null,
      onSelectResultRow: () => {},
      openResultReview: () => {},
    },
    staleness: {
      scanStale,
      marketsStale,
      scannedAt: "2026-09-17T12:00:00Z",
      scannedMarkets,
      marketsLoadFailed,
      marketsLoadFailedDetail,
      marketsSelectionLoadSettled,
    },
  };
}

describe("P2 banner discipline · ScreenerShell", () => {
  it("con markets-error + snapshot-warn + status: 1 hard + 1 soft; warn en Estado de datos", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: {
        tone: "warn",
        label: "Sin actualizar hoy",
        detail: "La última sincronización no llegó a tiempo.",
        stale: true,
        source: "supabase",
      },
      scannedMarkets: ["US"],
      selectedMarkets: ["US", "CA", "HK"],
      marketsStale: true,
      marketsSelectionLoadSettled: true,
      marketsLoadFailed: true,
      marketsLoadFailedDetail: "No se pudo cargar la selección.",
      status: "Cargando datos de la selección…",
      err: null,
    })));

    expect(html).toContain("screenerDataStateDrawer");
    expect(html).toContain("Estado de datos");
    expect(html).toContain("scanStaleNotice--error");
    expect(html).toContain("scanStatusBar");
    expect((html.match(/snapshotFreshnessNotice/g) || []).length).toBe(0);
    expect(html).toContain("Sin actualizar hoy");
  });

  it("fusión info (soft) puede convivir con markets-error (hard) sin drawer", () => {
    const fusion = buildMergedSnapshotNotice({
      merged: true,
      partial: false,
      source: "merged-nightly-materialized",
    });
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: fusion,
      scannedMarkets: ["US"],
      selectedMarkets: ["US", "CA"],
      marketsStale: true,
      marketsSelectionLoadSettled: true,
      marketsLoadFailed: true,
      marketsLoadFailedDetail: "No se pudo cargar la selección.",
      status: "idle",
    })));

    expect(html).toContain("scanStaleNotice--error");
    expect(html).toContain("snapshotFreshnessNotice");
    expect(html).toContain("Fusión");
    expect(html).not.toContain("screenerDataStateDrawer");
  });

  it("nocturno warn + cobertura stale: solo un hard primario y el otro en Estado de datos", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: {
        tone: "warn",
        label: "Sin actualizar hoy",
        detail: "La última sincronización no llegó a tiempo.",
        stale: true,
        source: "supabase",
      },
      scanStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
      analyzedExtra: [{ symbol: "AAPL", country: "US" }],
    })));

    expect(html).toContain("screenerDataStateDrawer");
    expect(html).toContain("Cobertura");
    expect(html).toContain("Sin actualizar hoy");
    expect((html.match(/snapshotFreshnessNotice/g) || []).length).toBe(0);
  });

  it("mesa vacía P1 sigue sin snapshot nocturno en cabecera (folded)", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: nightlyAbsenceNotice({ reason: "no-nightly-scan" }),
      analyzedExtra: [],
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })));
    expect(html).toContain("mesaEmptyCard");
    expect(html).not.toContain("snapshotFreshnessNotice");
  });
});
