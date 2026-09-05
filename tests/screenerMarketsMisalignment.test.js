import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { MARKETS_MISALIGNMENT_CTA, MARKETS_AUTO_LOAD_LOADING_LABEL } from "@/lib/marketAvailability";
import { buildFilterLayersUpgradeNotice } from "@/lib/screenerFilterLayers";
import { buildSnapshotFreshnessNotice } from "@/lib/snapshotFreshness";
import { DEFAULT_MARKETS } from "@/lib/screenerConfig";
import { compactMobileScanStatus } from "@/lib/screenerFormat";

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
  onDismissFilterLayersUpgradeNotice = null,
  onDismissSnapshotSampleNotice = null,
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
      onDismissFilterLayersUpgradeNotice,
      onDismissSnapshotSampleNotice,
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

  it("TRUTH-LOAD-1: con restoringScan no afirma 0 analizadas si hay filas en memoria", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      restoringScan: true,
    })));
    expect(html).toContain("1 analizadas");
    expect(html).not.toContain("0 analizadas");
    expect(html).not.toContain("AAPL");
    expect(html).toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
  });

  it("TRUTH-LOAD-1: restoringScan sin filas muestra cargando… en la verdad", () => {
    const props = makeProps({
      marketsStale: false,
      scanStale: false,
      scannedMarkets: ["HK"],
      selectedMarkets: ["HK"],
      restoringScan: true,
    });
    props.results.analyzedRows = [];
    props.results.rows = [];
    props.results.filtered = [];
    props.results.pagedRows = [];
    props.chrome.rows = [];
    props.resultView.filtered = [];
    props.resultView.pagedRows = [];
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).toContain("cargando…");
    expect(html).not.toContain("0 analizadas");
    expect(html).toContain("mesa: HK");
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

  it("móvil: peek de carga multi-mercado sin cadena de códigos en summary", () => {
    mockIsMobileViewport.mockReturnValue(true);
    const many = DEFAULT_MARKETS.slice(0, 10);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: many,
    })));
    expect(html).toContain("Cargando 10 mercados…");
    expect(html).not.toMatch(/screenerMobileNoticePeek[^<]*AT\+AU/);
    expect(html).toContain("1 mercado en mesa");
    expect(html).toContain("selección ≠ mesa");
    expect(html).not.toMatch(/\d+ mercados en selección/);
    mockIsMobileViewport.mockReturnValue(false);
  });

  it("móvil: fusión parcial en snapshotNotice usa peek corto sin países", () => {
    mockIsMobileViewport.mockReturnValue(true);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: {
        tone: "warn",
        label: "Fusión parcial",
        detail: "Falta materializado: Austria · Bélgica. Mesa con mercados disponibles; percentiles RS del lote de origen.",
        peekDetail: "Faltan 2 mercados",
        bodyDetail: "Falta materializado: Austria · Bélgica. Mesa con mercados disponibles; percentiles RS del lote de origen.",
        source: "merged-materialized-partial",
      },
    })));
    expect(html).toContain("Fusión parcial");
    expect(html).toContain("Faltan 2 mercados");
    expect(html).not.toMatch(/screenerMobileNoticePeek[^<]*Austria/);
    expect(html).toContain("Falta materializado: Austria");
    mockIsMobileViewport.mockReturnValue(false);
  });
});

describe("ScreenerShell filter-layers-upgrade notice", () => {
  it("muestra botón Entendido y copy sin Más filtros", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: buildFilterLayersUpgradeNotice(),
      onDismissFilterLayersUpgradeNotice: () => {},
    })));
    expect(html).toContain("Filtros actualizados");
    expect(html).toContain("Entendido");
    expect(html).not.toContain("Más filtros");
    expect(html).toContain("Abrir");
  });
});

describe("ScreenerShell sample-truncation notice", () => {
  it("muestra Entendido y Traer datos frescos para truncado supabase sin stale", () => {
    const notice = buildSnapshotFreshnessNotice({ stale: false }, {
      rowsAvailable: 204,
      rowsReturned: 157,
      rowsTruncated: true,
    });
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: notice,
      onDismissSnapshotSampleNotice: () => {},
    })));
    expect(html).toContain("Universo parcial");
    expect(html).not.toContain("Datos incompletos");
    expect(html).toContain("Entendido");
    expect(html).toContain("Traer datos frescos");
    expect(html).toContain("snapshotFreshnessNotice info");
  });

  it("móvil: muestra dismiss para muestra repartida", () => {
    mockIsMobileViewport.mockReturnValue(true);
    const notice = buildSnapshotFreshnessNotice({ stale: false }, {
      rowsAvailable: 204,
      rowsReturned: 157,
      rowsTruncated: true,
      rowsSampled: true,
    });
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: notice,
      onDismissSnapshotSampleNotice: () => {},
    })));
    expect(html).toContain("Muestra");
    expect(html).toContain("Entendido");
    expect(html).toContain("Traer datos frescos");
    mockIsMobileViewport.mockReturnValue(false);
  });
});

describe("compactMobileScanStatus", () => {
  it("resume materializados multi-mercado en una línea", () => {
    const long = "Cargando materializados (Estados Unidos + España + Francia + Alemania + Italia + Reino Unido + Canadá + Australia)…";
    expect(compactMobileScanStatus(long)).toBe("Cargando 8 materializados…");
  });

  it("deja intacto un mercado único", () => {
    expect(compactMobileScanStatus("Cargando materializado Estados Unidos…")).toBe("Cargando materializado Estados Unidos…");
  });
});
