import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { FilterTemplatePanel, OptionalBasePresetsPanel } from "@/lib/screenerFiltersView";
import { HUNT_CARDS } from "@/lib/screenerHuntCards";

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
let HuntCardRail;

beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
  ({ default: HuntCardRail } = await import("@/app/components/screener/HuntCardRail"));
});

function templateButtonNames(html) {
  return [...html.matchAll(/class="filterTemplateBtn[^"]*"[^>]*>[\s\S]*?<b>([^<]+)<\/b>/g)].map((match) => match[1]);
}

function makeProps({ presetKey = "balanced", markets = ["US"] } = {}) {
  const resultsRows = [{ symbol: "AAPL", country: "US" }];
  return {
    chrome: {
      presetKey,
      markets,
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
      scannedAt: "2026-08-27T14:07:00.000Z",
      scannedMarkets: markets,
    },
  };
}

describe("FilterTemplatePanel bases opcionales", () => {
  it("no expone bases opcionales en el primer viewport del panel", () => {
    const html = renderToStaticMarkup(React.createElement(FilterTemplatePanel, { presetKey: "balanced" }));
    expect(html).toContain("Ajustes de sesión");
    expect(html).toContain("Mercados y afinado");
    expect(html).not.toContain("Bases opcionales");
    expect(html).not.toContain("Líderes estrictos");
    expect(templateButtonNames(html)).toEqual([]);
  });

  it("muestra el nombre interno solo fuera del rail diario", () => {
    const html = renderToStaticMarkup(React.createElement(FilterTemplatePanel, { presetKey: "strict" }));
    expect(html).toContain("Base Líderes estrictos");
    expect(html).not.toContain("Mercados y afinado");
  });
});

describe("OptionalBasePresetsPanel", () => {
  it("lista solo los presets fuera del rail diario dentro de advanced", () => {
    const html = renderToStaticMarkup(React.createElement(OptionalBasePresetsPanel, { presetKey: "balanced" }));
    expect(html).toContain("Más bases de filtro");
    expect(html).toContain("No sustituyen las fichas del centro");
    expect(templateButtonNames(html)).toEqual(["Líderes estrictos", "Etapa 2 temprana", "Exploratorio amplio"]);
  });
});

describe("HuntCardRail", () => {
  it("pinta las 5 fichas y marca una activa", () => {
    const html = renderToStaticMarkup(React.createElement(HuntCardRail, {
      presetKey: "balanced",
      markets: ["US"],
      onSelect: () => {},
    }));
    expect(html).toContain("huntCardRail");
    for (const card of HUNT_CARDS) {
      expect(html).toContain(card.label);
    }
    expect(html).toMatch(/aria-selected="true"[^>]*>Líderes Etapa 2/);
  });
});

describe("ScreenerShell hunt rail", () => {
  it("título y línea de verdad usan el nombre de la ficha, no Balanceado", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toContain("huntCardRail");
    expect(html).toContain('class="title">Líderes Etapa 2</h1>');
    expect(html).toContain("pasan «Líderes Etapa 2»");
    expect(html).not.toContain("pasan «Balanceado»");
  });

  it("sin US refleja Líderes intl aunque el preset interno sea balanced", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      presetKey: "balanced",
      markets: ["CA"],
    })));
    expect(html).toContain("pasan «Líderes intl»");
    expect(html).toMatch(/aria-selected="true"[^>]*>Líderes intl/);
  });

  it("mantiene presets regionales visibles y la rejilla de banderas colapsada", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toContain("marketPresetBar");
    expect(html).toContain("Core intl");
    expect(html).toContain("marketCustomizeDisclosure");
    expect(html).toContain("Personalizar mercados");
    expect(html).toMatch(/<details class="marketCustomizeDisclosure">[\s\S]*?marketGrid/);
    expect(html).not.toMatch(/<details class="marketCustomizeDisclosure"[^>]*open=/);
  });

  it("anida bases opcionales dentro de configuración avanzada", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toMatch(/<details class="disclosurePanel advancedConfigPanel"[\s\S]*?Más bases de filtro/);
    expect(html).not.toMatch(/filterTemplatePanel[\s\S]*?Líderes estrictos/);
  });
});
