import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { buildScreenerTruthLine, resolveScreenerTruthCounts } from "@/lib/screenerTruthLine";
import { FilterTemplatePanel, OptionalBasePresetsPanel, SessionPlumbingPanel } from "@/lib/screenerFiltersView";
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
let HuntCardModeStrip;

beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
  ({ default: HuntCardRail } = await import("@/app/components/screener/HuntCardRail"));
  ({ default: HuntCardModeStrip } = await import("@/app/components/screener/HuntCardModeStrip"));
});

function templateButtonNames(html) {
  return [...html.matchAll(/class="filterTemplateBtn[^"]*"[^>]*>[\s\S]*?<b>([^<]+)<\/b>/g)].map((match) => match[1]);
}

function makeProps({
  presetKey = "balanced",
  markets = ["US"],
  analyzedRows = null,
  scannedMarkets = null,
  huntTruthOverride = null,
  isHuntTransitionPending = false,
  rowsDeferredStale = false,
  viewFiltersActive = 0,
  filteredVisibleCount = null,
} = {}) {
  const resultsRows = analyzedRows || [{ symbol: "AAPL", country: "US" }];
  const resultsFilteredCount = filteredVisibleCount ?? resultsRows.length;
  const resultsFiltered = Array.from({ length: resultsFilteredCount }, (_, index) => (
    resultsRows[index] || { symbol: `ROW${index}`, country: "US" }
  ));
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
      huntTruthOverride,
      isHuntTransitionPending,
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
      viewFiltersActive,
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
      filtered: resultsFiltered,
      pagedRows: resultsFiltered,
      rowsDeferredStale,
    },
    results: {
      filtered: resultsFiltered,
      rows: resultsRows,
      pagedRows: resultsFiltered,
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
      scanStale: false,
      marketsStale: false,
      scannedAt: "2026-08-27T14:07:00.000Z",
      scannedMarkets: scannedMarkets ?? markets,
    },
  };
}

describe("FilterTemplatePanel bases opcionales", () => {
  it("no expone bases opcionales ni cabecera de sesión", () => {
    const html = renderToStaticMarkup(React.createElement(FilterTemplatePanel, {}));
    expect(html).toContain("Plantillas");
    expect(html).not.toContain("Ajustes de sesión");
    expect(html).not.toContain("Mercados y afinado");
    expect(html).not.toContain("Bases opcionales");
    expect(html).not.toContain("Líderes estrictos");
    expect(templateButtonNames(html)).toEqual([]);
  });
});

describe("SessionPlumbingPanel", () => {
  it("junta plantillas, nube y más bases en una superficie secundaria", () => {
    const html = renderToStaticMarkup(React.createElement(SessionPlumbingPanel, { presetKey: "balanced" }));
    expect(html).toContain("sessionPlumbingBlock");
    expect(html).toContain("Plantillas");
    expect(html).toContain("Guardar nube");
    expect(html).toContain("Cargar nube");
    expect(html).toContain("Más bases de filtro");
    expect(html).not.toContain("Ajustes de sesión");
  });
});

describe("OptionalBasePresetsPanel", () => {
  it("lista solo los presets fuera del rail diario dentro de advanced", () => {
    const html = renderToStaticMarkup(React.createElement(OptionalBasePresetsPanel, { presetKey: "balanced" }));
    expect(html).toContain("Más bases de filtro");
    expect(html).toContain("No sustituyen las fichas del centro");
    expect(templateButtonNames(html)).toEqual(["Líderes estrictos", "Etapa 2 temprana", "Exploratorio amplio", "IPO / nuevos líderes"]);
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
    expect(html).toContain("huntCardRailScroll");
    for (const card of HUNT_CARDS) {
      expect(html).toContain(card.label);
    }
    expect(html).toMatch(/aria-selected="true"[^>]*>Líderes Etapa 2/);
  });
});

describe("HuntCardModeStrip", () => {
  it("muestra badge de modo y panel Qué aplica para la ficha activa", () => {
    const html = renderToStaticMarkup(React.createElement(HuntCardModeStrip, {
      presetKey: "ipoDiscovery",
      markets: ["US"],
    }));
    expect(html).toContain("huntCardModeStrip");
    expect(html).toContain("huntCardModeBadge--discovery");
    expect(html).toContain("Discovery");
    expect(html).toContain("Qué aplica esta ficha");
    expect(html).toMatch(/IPO reciente ≤ 72m/);
  });

  it("marca Deterioro como strict", () => {
    const html = renderToStaticMarkup(React.createElement(HuntCardModeStrip, {
      presetKey: "weakness",
      markets: ["US"],
    }));
    expect(html).toContain("huntCardModeBadge--strict");
    expect(html).toContain("Strict");
    expect(html).toMatch(/Deterioro ≥/);
  });

  it("muestra chip RS N/M en Líderes Etapa 2 sobre filas que pasan", () => {
    const html = renderToStaticMarkup(React.createElement(HuntCardModeStrip, {
      presetKey: "balanced",
      markets: ["US"],
      passedRows: [
        { symbol: "AAA", weeklyRsAvailable: true, weeklyRsRating: 80 },
        { symbol: "BBB", weeklyRsAvailable: true, weeklyRsRating: 70 },
        { symbol: "CCC", weeklyRsAvailable: false },
      ],
    }));
    expect(html).toContain("huntCardRsChip");
    expect(html).toContain("RS 2/3");
    expect(html).toContain("ranking semanal del universo privado");
  });
});

describe("ScreenerShell hunt rail", () => {
  it("título y línea de verdad usan el nombre de la ficha, no Balanceado", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    expect(html).toContain("huntCardRail");
    expect(html).toContain("huntCardRailScroll");
    expect(html).toContain("huntCardModeStrip");
    expect(html).toContain("Qué aplica esta ficha");
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

  it("monta el desglose colapsable bajo la línea de verdad", () => {
    const props = makeProps();
    props.sidebar.diagnostics = {
      analyzed: 3321,
      finalCount: 47,
      blocks: [{ label: "Etapa mínima", count: 2100 }],
    };
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).toContain("screenerFilterBreakdown");
    expect(html).toContain("¿Qué recorta?");
    expect(html).toContain("Ficha «Líderes Etapa 2» deja 47 de 3321");
  });

  it("SHELL-B: plomería de sesión vive en el menú ⋯, no en el primer paint del aside", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps()));
    const moreMenu = html.match(/<details class="resultsMoreMenu">[\s\S]*?<\/details>/);
    expect(moreMenu?.[0]).toContain("sessionPlumbingBlock");
    expect(moreMenu?.[0]).toContain("Plantillas");
    expect(moreMenu?.[0]).toContain("Más bases de filtro");
    expect(moreMenu?.[0]).toContain("Guardar nube");
    expect(moreMenu?.[0]).toContain("Traer datos frescos");
    const aside = html.match(/<aside[\s\S]*?<\/aside>/);
    expect(aside?.[0]).toContain("marketPanel");
    expect(aside?.[0]).not.toContain("sessionPlumbingBlock");
    expect(aside?.[0]).not.toContain("Más bases de filtro");
    expect(aside?.[0]).not.toContain("Ajustes de sesión");
    expect(aside?.[0]).not.toContain("Plantillas");
    expect(html).not.toContain("Ajustes de sesión");
  });

  it("UX-16: avisa en rail cuando Líderes intl y datos solo US", () => {
    const usRows = Array.from({ length: 50 }, (_, index) => ({ symbol: `U${index}`, country: "US" }));
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      presetKey: "intl",
      markets: ["US", "HK", "CA"],
      analyzedRows: usRows,
      scannedMarkets: ["US"],
    })));
    expect(html).toContain("lideresIntlGuardrail");
    expect(html).toContain("Datos cargados: US (50)");
    expect(html).toContain("Cargar Core intl");
    expect(html).toContain("Quitar US");
    expect(html).toContain("Cambiar a Líderes E2");
    expect(html).toContain("pasan «Líderes intl»");
  });

  it("UX-16: no avisa en Líderes Etapa 2 con solo US", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      presetKey: "balanced",
      markets: ["US"],
    })));
    expect(html).not.toContain("lideresIntlGuardrail");
  });

  it("UX-22: no mezcla pasan de ficha nueva con en lista de la anterior bajo override", () => {
    const analyzedRows = Array.from({ length: 1045 }, (_, index) => ({ symbol: `S${index}`, country: "US" }));
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      presetKey: "weakness",
      markets: ["US"],
      analyzedRows,
      huntTruthOverride: { passCount: 1045, presetName: "Deterioro" },
      filteredVisibleCount: 290,
      rowsDeferredStale: true,
    })));
    expect(html).toContain("1045 pasan «Deterioro»");
    expect(html).toContain("1045 en lista");
    expect(html).not.toContain("290 en lista");
  });

  it("UX-22: con filtros de vista activos permite en lista menor que pasan", () => {
    const { passCount, visibleCount } = resolveScreenerTruthCounts({
      eagerPassCount: 1045,
      filteredVisibleCount: 120,
      rowsDeferredStale: true,
      huntTruthOverride: { passCount: 1045, presetName: "Deterioro" },
      viewFiltersActive: 1,
    });
    const line = buildScreenerTruthLine({
      analyzedRows: Array.from({ length: 3321 }),
      passCount,
      visibleCount,
      presetName: "Deterioro",
      sort: "perf3m",
      sortAsc: false,
    });
    expect(line).toContain("1045 pasan «Deterioro»");
    expect(line).toContain("120 en lista");
  });
});
