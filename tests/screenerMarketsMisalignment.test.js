import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import { MARKETS_MISALIGNMENT_CTA, MARKETS_AUTO_LOAD_LOADING_LABEL } from "@/lib/marketAvailability";
import { buildFilterLayersUpgradeNotice } from "@/lib/screenerFilterLayers";
import { buildSnapshotFreshnessNotice } from "@/lib/snapshotFreshness";
import { ALL_SELECTABLE_MARKETS } from "@/lib/screenerConfig";
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
  scanStale = marketsStale,
  scannedMarkets = ["US"],
  selectedMarkets = ["US", "CA"],
  snapshotNotice = null,
  onDismissFilterLayersUpgradeNotice = null,
  onDismissSnapshotSampleNotice = null,
  restoringScan = false,
  marketsLoadFailed = false,
  marketsLoadFailedDetail = "",
  marketsSelectionLoadSettled = false,
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
      marketsSelectionLoadSettled,
    },
  };
}

describe("ScreenerShell markets misalignment", () => {
  it("pinta la línea de verdad y un solo banner de carga (sin CTA) por viewport", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      restoringScan: true,
    })));
    expect(html).toContain("screenerTruthLine");
    expect(html).toContain("1 de 1 pasan");
    expect(html).not.toContain("analizadas");
    expect(html).toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
    expect(html).not.toContain(MARKETS_MISALIGNMENT_CTA);
    expect((html.match(/scanStaleNotice--loading/g) || []).length).toBe(1);
    expect(html).not.toContain("resultados visibles");
    expect(html).not.toContain('class="kpi"');
  });

  it("no duplica el aviso markets-stale en snapshotNotice", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      snapshotNotice: {
        tone: "warn",
        label: "Mercados",
        detail: "Datos cargados: US. La selección actual (HK) no coincide.",
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
    expect(html).toContain("Sin escaneo en mesa");
    expect(html).not.toContain("0 de 0 pasan");
    expect(html).toContain("mesa: US");
    expect(html).not.toContain("selección ≠ mesa");
    expect(html).not.toContain("en lista");
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
    expect(html).toContain("1 de 1 pasan");
    expect(html).not.toContain("0 de 0 pasan");
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
    expect(html).not.toContain("0 de 0 pasan");
    expect(html).toContain("mesa: HK");
  });

  it("T9: cold con status primario — una historia (bar sí; truth/empty/weekly no compiten)", () => {
    const props = makeProps({
      marketsStale: false,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
      restoringScan: true,
    });
    props.chrome.status = "Cargando el escaneo nocturno...";
    props.results.analyzedRows = [];
    props.results.rows = [];
    props.results.filtered = [];
    props.results.pagedRows = [];
    props.results.emptyLabel = "Cargando los últimos datos guardados...";
    props.chrome.rows = [];
    props.resultView.filtered = [];
    props.resultView.pagedRows = [];
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).toContain("Cargando el escaneo nocturno");
    expect(html).toContain("scanStatusBar");
    expect(html).not.toContain("cargando…");
    expect(html).not.toContain("últimos datos guardados");
    expect(html).not.toContain("0 de 0 pasan");
    expect(html).not.toContain("data-stub=\"WeeklyChangesLine\"");
    expect(html).toContain("mesa: US");
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

  it("Retención #4: mesa US alineada no muestra banner de cobertura fantasma", () => {
    // El shell solo pinta el banner si scanStale=true; page.jsx ya no debe
    // pasar scanStale tras Global→US con mesa limpia (ver isScanSettingsStale).
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: false,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })));
    expect(html).not.toContain("Los criterios de cobertura cambiaron");
    expect(html).not.toContain("scanStaleNotice");
    expect(html).toContain("mesa: US");
  });

  it("muestra CTA solo si falló la carga de mercados", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: ["HK"],
      marketsLoadFailed: true,
      marketsLoadFailedDetail: "No se pudo cargar Hong Kong.",
    })));
    expect(html).toContain("Cargar Hong Kong");
    expect(html).toContain("Quedarme en EE. UU.");
    expect(html).toContain("No se pudo cargar Hong Kong.");
    expect(html).not.toContain("selección ≠ mesa");
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

  it("cobertura parcial: aviso estable y filas visibles (no loading eterno)", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scannedMarkets: ["US", "HK", "CA"],
      selectedMarkets: ALL_SELECTABLE_MARKETS,
      marketsSelectionLoadSettled: true,
    })));
    expect(html).toContain("Cobertura parcial");
    expect(html).not.toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
    expect(html).toContain("1 de 1 pasan");
    expect(html).toContain("ResultPagerTable");
    expect(html).toContain(MARKETS_MISALIGNMENT_CTA);
  });

  it("móvil: cobertura parcial multi-mercado sin loading eterno ni cadena de códigos", () => {
    mockIsMobileViewport.mockReturnValue(true);
    const many = ALL_SELECTABLE_MARKETS.slice(0, 10);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: true,
      scannedMarkets: ["US"],
      selectedMarkets: many,
      marketsSelectionLoadSettled: true,
    })));
    expect(html).toContain("Cobertura parcial");
    expect(html).not.toContain(MARKETS_AUTO_LOAD_LOADING_LABEL);
    expect(html).not.toMatch(/screenerMobileNoticePeek[^<]*AT\+AU/);
    expect(html).toContain("1 mercado en mesa");
    expect(html).toContain("Mostrando EE. UU. · selección 10 mercados");
    expect(html).not.toContain("selección ≠ mesa");
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
    expect(html).not.toMatch(/screenerMobileStatusFoldPeek[^<]*Austria/);
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

  it("T3: oculta el aviso de capas mientras restoringScan (cold load)", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: buildFilterLayersUpgradeNotice(),
      onDismissFilterLayersUpgradeNotice: () => {},
      restoringScan: true,
    })));
    expect(html).not.toContain("Filtros actualizados");
    expect(html).not.toContain("formato antiguo de filtros");
    expect(html).not.toContain("Entendido");
  });

  it("T3: muestra el aviso de capas cuando la mesa ya no hidrata", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      snapshotNotice: buildFilterLayersUpgradeNotice(),
      onDismissFilterLayersUpgradeNotice: () => {},
      restoringScan: false,
    })));
    expect(html).toContain("Filtros actualizados");
    expect(html).toContain("formato antiguo de filtros");
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
      // P2: mercados alineados para que el soft de muestra no pierda el slot
      // frente a markets-loading por US vs US+CA del default del harness.
      selectedMarkets: ["US"],
      scannedMarkets: ["US"],
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
      selectedMarkets: ["US"],
      scannedMarkets: ["US"],
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

  it("resume carga de selección multi-mercado en una línea", () => {
    const long = "Cargando datos de la selección (AT+AU+BE+CA+CH+DE)…";
    expect(compactMobileScanStatus(long)).toBe("Cargando 6 mercados…");
  });

  it("deja intacto un mercado único", () => {
    expect(compactMobileScanStatus("Cargando materializado Estados Unidos…")).toBe("Cargando materializado Estados Unidos…");
  });
});

describe("ScreenerShell dataset ausente vs cero matches", () => {
  it("dataset ausente no afirma 0 de 0 pasan", () => {
    const props = makeProps({
      marketsStale: false,
      scanStale: false,
      scannedMarkets: [],
      selectedMarkets: ["US"],
    });
    props.results.analyzedRows = [];
    props.results.rows = [];
    props.results.filtered = [];
    props.results.pagedRows = [];
    props.chrome.rows = [];
    props.resultView.filtered = [];
    props.resultView.pagedRows = [];
    props.staleness.scannedAt = null;
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).toContain("Sin escaneo en mesa");
    expect(html).not.toContain("0 de 0 pasan");
    expect(html).not.toContain("cargando…");
  });

  it("dataset cargado con cero matches conserva 0 de N pasan", () => {
    const analyzed = Array.from({ length: 12 }, (_, i) => ({ symbol: `S${i}`, country: "US" }));
    const props = makeProps({
      marketsStale: false,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    });
    props.results.analyzedRows = analyzed;
    props.results.rows = [];
    props.results.filtered = [];
    props.results.pagedRows = [];
    props.chrome.rows = [];
    props.resultView.filtered = [];
    props.resultView.pagedRows = [];
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).toContain("0 de 12 pasan «Líderes Etapa 2»");
    expect(html).not.toContain("Sin escaneo en mesa");
    expect(html).not.toContain("0 de 0 pasan");
  });

  it("dataset cargado con matches conserva N de M", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({
      marketsStale: false,
      scanStale: false,
      scannedMarkets: ["US"],
      selectedMarkets: ["US"],
    })));
    expect(html).toContain("1 de 1 pasan «Líderes Etapa 2»");
    expect(html).not.toContain("Sin escaneo en mesa");
    expect(html).not.toContain("0 de 0 pasan");
  });
});
