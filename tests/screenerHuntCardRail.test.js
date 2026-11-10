import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { buildScreenerTruthLine, resolveScreenerTruthCounts } from "@/lib/screenerTruthLine";
import { FilterTemplatePanel, OptionalBasePresetsPanel, SessionPlumbingPanel } from "@/lib/screenerFiltersView";
import {
  HUNT_CARDS,
  favoritesQueueView,
  huntQueueRows,
  normalizeHuntQueue,
  weeklyQueueViews,
} from "@/lib/screenerHuntCards";

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
    expect(html).toContain("screenerViewRail");
    for (const card of HUNT_CARDS) {
      expect(html).toContain(card.label);
    }
    expect(html).toMatch(/aria-current="true"[^>]*>[\s\S]*?<span>Líderes Etapa 2<\/span>/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("Del análisis nocturno");
    // D2 (auditoría 2026-11): el grupo semanal ya no se llama «Esta noche»;
    // sin payload, rótulo neutro.
    expect(html).not.toContain("Esta noche");
    expect(html).toContain("Cambios de la semana");
    expect(html).toContain("Mis vistas");
    expect(html).not.toContain("Aplicando ficha");
  });

  it("en pending muestra feedback humano y aria-busy", () => {
    const html = renderToStaticMarkup(React.createElement(HuntCardRail, {
      presetKey: "balanced",
      markets: ["US"],
      pending: true,
      onSelect: () => {},
    }));
    expect(html).toContain("screenerViewRailPending");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Aplicando ficha…");
    expect(html).toContain("screenerViewRailPendingLabel");
    expect(html).toContain("disabled");
  });
});

describe("HuntCardModeStrip", () => {
  it("muestra badge de lente y panel Qué aplica para la ficha activa", () => {
    const html = renderToStaticMarkup(React.createElement(HuntCardModeStrip, {
      presetKey: "ipoDiscovery",
      markets: ["US"],
    }));
    expect(html).toContain("huntCardModeStrip");
    expect(html).toContain("huntCardModeBadge--lente");
    expect(html).toContain("Lente");
    expect(html).toContain("Qué aplica esta ficha");
    expect(html).toMatch(/Salida ≤ 24m/);
    expect(html).toMatch(/sin puertas de tendencia/);
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
    expect(html).toContain("screenerViewRail");
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
    expect(html).toMatch(/aria-current="true"[^>]*>[\s\S]*?<span>Líderes intl<\/span>/);
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
    expect(html).toContain("resultsMoreMenu");
    expect(html).toContain("sessionPlumbingBlock");
    expect(html).toContain("Plantillas");
    expect(html).toContain("Más bases de filtro");
    expect(html).toContain("Guardar nube");
    expect(html).toContain("Traer datos frescos");
    // Pasos 4-5 (rediseño 2026-11): el selector de mercados vive en el chip del
    // ticket y las familias en «+ Filtro»; en escritorio no hay aside.
    expect(html).toMatch(/<div class="screenerTicket">[\s\S]*marketCompactChip/);
    expect(html).not.toMatch(/<aside/);
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
    expect(html).toContain("1045 de 1045 pasan «Deterioro»");
    expect(html).not.toContain("en lista");
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
    expect(line).toContain("1045 de 3321 pasan «Deterioro»");
    expect(line).toContain("120 en lista");
  });
});

// Paso 6 (rediseño 2026-11): raíl de vistas vertical con colas externas.
describe("raíl de vistas · colas externas", () => {
  const payload = {
    state: "ok",
    window: { from: "2026-10-09", to: "2026-10-13" },
    stage2: {
      entries: { count: 2, rows: [{ symbol: "DOCN" }, { symbol: "AAA" }] },
      exits: { count: 1, rows: [{ symbol: "KOPN" }] },
    },
    highs: { newThisWindow: { count: 0, rows: [] }, alreadyNear: { count: 1, rows: [{ symbol: "BBB" }] } },
  };

  it("weeklyQueueViews convierte las cuatro cifras en colas con símbolos y ventana", () => {
    const views = weeklyQueueViews(payload);
    expect(views.map((v) => v.label)).toEqual([
      "Entradas en Etapa 2", "Salidas de Etapa 2", "Nuevos máximos 52s", "A <5 % del máximo",
    ]);
    expect(views[0]).toMatchObject({ count: 2, symbols: ["DOCN", "AAA"], since: "2026-10-09" });
    expect(views[2].count).toBe(0);
  });

  it("sin payload comparable el grupo no desaparece: count null («—»)", () => {
    for (const p of [null, { state: "not-comparable" }]) {
      const views = weeklyQueueViews(p);
      expect(views).toHaveLength(4);
      expect(views.every((v) => v.count === null && v.symbols.length === 0)).toBe(true);
    }
  });

  it("huntQueueRows busca en analyzedRows sin filtro de ficha y conserva el orden", () => {
    const queue = normalizeHuntQueue(weeklyQueueViews(payload)[0]);
    const rows = huntQueueRows(queue, [{ symbol: "AAA" }, { symbol: "ZZZ" }, { symbol: "docn" }]);
    expect(rows.map((r) => r.symbol)).toEqual(["AAA", "docn"]);
    expect(normalizeHuntQueue(null)).toBeNull();
  });

  it("favoritesQueueView cuenta favoritos", () => {
    expect(favoritesQueueView(new Set(["AAA", "BBB"]))).toMatchObject({ id: "favoritos", count: 2 });
    expect(favoritesQueueView(null).count).toBe(0);
  });

  it("el raíl pinta conteos, «—» sin dato y marca la cola activa en lugar de la ficha", () => {
    const html = renderToStaticMarkup(React.createElement(HuntCardRail, {
      presetKey: "balanced",
      markets: ["US"],
      cardCounts: { "cerca-pivot": 64 },
      activeQueueId: "entradas-e2",
      weeklyViews: weeklyQueueViews(payload),
      weeklySinceLabel: "vie 9 oct",
      weeklyHeading: "Semana 9 → 16 oct",
      favoritesView: favoritesQueueView(new Set()),
      savedTemplates: [{ id: "t1", name: "Semis Europa estricta" }],
      onSaveView: () => {},
    }));
    expect(html).toMatch(/<span>Cerca de pivot<\/span><em class="screenerViewRailCount">64<\/em>/);
    expect(html).toMatch(/<span>Deterioro<\/span><em class="screenerViewRailCount isGhost">—<\/em>/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-view="entradas-e2" aria-current="true"/);
    expect(html).toContain(">Semana 9 → 16 oct</h3>");
    expect(html).toContain("Semis Europa estricta");
    expect(html).toContain("Guardar vista actual");
    // Nuevos máximos = 0 → deshabilitada; Favoritos vacío → deshabilitada.
    expect(html).toMatch(/data-view="nuevos-maximos" disabled=""/);
    expect(html).toMatch(/data-view="favoritos" disabled=""/);
  });

  it("ScreenerShell con cola: el título es la cola y la verdad dice cuántos están en la mesa", () => {
    const props = makeProps({ analyzedRows: [{ symbol: "DOCN", country: "US" }] });
    props.chrome.huntQueue = normalizeHuntQueue(weeklyQueueViews(payload)[0]);
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).toContain('class="title">Entradas en Etapa 2</h1>');
    expect(html).toMatch(/1 de 2 en la mesa · desde el [^<]*9 oct/);
    expect(html).toContain("resultQueueChip");
  });
});

// D2 (auditoría de producto 2026-11): sin par válido el grupo dice «Sin
// comparación esta semana» y no enseña cifras (todas «—»).
describe("raíl · grupo semanal sin par (D2)", () => {
  it("not-comparable ⇒ rótulo «Sin comparación esta semana» y ninguna cifra", async () => {
    const { weeklyHeadingFromPayload } = await import("@/lib/weeklyChanges");
    const payload = { ok: true, state: "not-comparable", reason: "no-weekly-anchor" };
    const views = weeklyQueueViews(payload);
    const html = renderToStaticMarkup(React.createElement(HuntCardRail, {
      presetKey: "balanced",
      markets: ["US"],
      weeklyViews: views,
      weeklyHeading: weeklyHeadingFromPayload(payload),
      onOpenWeeklyDetail: () => {},
    }));
    expect(html).toContain("Sin comparación esta semana");
    for (const id of ["entradas-e2", "salidas-e2", "nuevos-maximos", "cerca-maximo"]) {
      expect(html).toMatch(new RegExp(`data-view="${id}" disabled=""[^>]*>[\\s\\S]*?screenerViewRailCount isGhost">—<`));
    }
    // Sin «detalle»: no hay panel que abrir.
    expect(html).not.toContain(">detalle<");
    const tabs = renderToStaticMarkup(React.createElement(HuntCardRail, {
      presetKey: "balanced", markets: ["US"], weeklyViews: views, weeklyHeading: weeklyHeadingFromPayload(payload), layout: "tabs",
    }));
    expect(tabs).toContain('<em class="mobileViewTabGroupLabel">Sin comparación esta semana</em>');
  });
});
