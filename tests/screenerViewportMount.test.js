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

// Paso 5 (rediseño 2026-11): la barra de filtros viaja como `filterSlot` a
// ResultPagerTable y el popover recibe `children` (modo de la ficha, desglose)
// y `families`; los stubs dejan pasar esos huecos para poder inspeccionarlos.
vi.mock("@/app/components/screener/ResultFilterBar", () => ({
  default: ({ children, families }) => React.createElement("div", { "data-stub": "ResultFilterBar" }, children, families),
}));
vi.mock("@/app/components/screener/ResultPagerTable", () => ({
  default: ({ filterSlot }) => React.createElement("div", { "data-stub": "ResultPagerTable" }, filterSlot),
}));
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

  it("móvil: monta mobileResearchHome y MobileResultList sin desktopResultsSection ni MarketMiniTape", () => {
    mockIsMobileViewport.mockReturnValue(true);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toContain("mobileResearchHome");
    expect(html).toContain("data-stub=\"MobileResultList\"");
    expect(html).not.toContain("desktopResultsSection");
    expect(html).not.toContain("data-stub=\"ResultPagerTable\"");
    expect(html).not.toContain("data-stub=\"MarketMiniTape\"");
  });
});

describe("ScreenerShell · SHELL-D laboratorio fuera del aside", () => {
  // Paso 5 (rediseño 2026-11): en escritorio no hay aside (las familias van en
  // el popover «+ Filtro»). Estudio móvil 2026-11 (paso 9): en móvil tampoco;
  // las familias viven en la hoja inferior de filtros (MobileFilterSheet).
  function mobileFilterSheetHtml(props) {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    return html.match(/<section[^>]*class="mobileSheet mobileFilterSheet"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "";
  }

  it("hoja de filtros móvil: sin Diagnóstico ni paneles de laboratorio; sin aside en ningún ancho", () => {
    mockIsMobileViewport.mockReturnValue(false);
    expect(renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()))).not.toMatch(/<aside/);
    mockIsMobileViewport.mockReturnValue(true);
    const closed = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(closed).not.toMatch(/<aside/);
    expect(closed).not.toContain("mobileFilterSheet");
    const props = makeProps();
    props.chrome.showMobileFilters = true;
    const sheet = mobileFilterSheetHtml(props);
    expect(sheet).toContain("data-stub=\"FilterArchitecturePanel\"");
    expect(sheet).not.toContain("screenerDiagnosticsDisclosure");
    expect(sheet).not.toContain("Auditoría de filtros");
    expect(sheet).not.toContain("Cobertura internacional por mercado");
  });

  it("menú ⋯ escritorio: Diagnóstico agrupa auditoría y cobertura (cobertura lazy)", () => {
    mockIsMobileViewport.mockReturnValue(false);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toContain("resultsMoreMenuLaboratory");
    expect(html).toMatch(/screenerDiagnosticsDisclosure[\s\S]*?<span>Diagnóstico<\/span>[\s\S]*?scanDiagnosticsDisclosure[\s\S]*?Auditoría de filtros[\s\S]*?globalCoverageDisclosure[\s\S]*?Cobertura internacional por mercado/);
    expect(html).not.toMatch(/<details class="disclosurePanel screenerDiagnosticsDisclosure"[^>]*open=/);
    expect(html).toContain("data-stub=\"FilterDiagnosticsPanel\"");
    // T9: GlobalCoveragePanel solo monta al abrir el disclosure (no fetch en cold).
    expect(html).not.toContain("data-stub=\"GlobalCoveragePanel\"");
  });

  it("familias de ficha en la hoja móvil sin Configuración avanzada ni diagnóstico", () => {
    mockIsMobileViewport.mockReturnValue(true);
    const props = makeProps();
    props.chrome.showMobileFilters = true;
    const sheet = mobileFilterSheetHtml(props);
    expect(sheet).toContain("data-stub=\"FilterArchitecturePanel\"");
    expect(sheet).not.toContain("advancedConfigPanel");
    expect(sheet).not.toContain("screenerDiagnosticsDisclosure");
    // Mercados antes que las familias, y «Ver N valores» como salida.
    expect(sheet.indexOf("marketPresetBar")).toBeGreaterThan(-1);
    expect(sheet.indexOf("marketPresetBar")).toBeLessThan(sheet.indexOf("data-stub=\"FilterArchitecturePanel\""));
    expect(sheet).toMatch(/Ver \d[\d.]* valor/);
  });
});

describe("ScreenerShell · SHELL-A un solo editor", () => {
  it("popover de familias (escritorio): sin árbol legado ni resets que compitan con Resetear criterios", () => {
    mockIsMobileViewport.mockReturnValue(false);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    const aside = html.match(/<div data-stub="ResultFilterBar">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
    expect(aside).not.toContain("Ajustes finos");
    expect(aside).not.toContain("Resetear condiciones");
    expect(aside).not.toContain("Base preset");
    expect(aside).not.toContain("Todo activo");
    expect(aside).not.toContain("Media rápida semanal");
    expect(aside).not.toContain("advancedFiltersDetails");
    expect(aside).not.toContain("Volumen en vela alcista");
    expect(aside).toContain("data-stub=\"FilterArchitecturePanel\"");
    expect(html).toContain("Resetear criterios");
    expect(html.match(/Resetear criterios/g)).toHaveLength(1);
  });
});

describe("ScreenerShell · SHELL-C familias de ficha", () => {
  // Pasos 4-5 (rediseño 2026-11): en escritorio los mercados están en el chip
  // del ticket y las familias en el popover «+ Filtro» de la barra de la mesa.
  it("escritorio: Mercados en el ticket antes que las familias del popover; sin contadores duplicados de avanzado", () => {
    mockIsMobileViewport.mockReturnValue(false);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    const aside = html.match(/<div data-stub="ResultFilterBar">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
    const marketsIdx = html.indexOf("marketCompactChip");
    const archIdx = html.indexOf("data-stub=\"FilterArchitecturePanel\"");
    expect(marketsIdx).toBeGreaterThan(-1);
    expect(archIdx).toBeGreaterThan(marketsIdx);
    expect(html).not.toMatch(/<aside/);
    expect(aside).not.toContain("Configuración avanzada");
    expect(aside).not.toContain("Avanzado ·");
    expect(aside).not.toContain("Filtro activo");
  });
});
