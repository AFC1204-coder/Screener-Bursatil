import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeAll } from "vitest";

// ScreenerShell arrastra un barrel grande de paneles (screenerPanels) y varios
// sub-componentes de decisión/tabla. Para aislar la franja P3 mockeamos esos
// nodos como stubs y dejamos que el resto (lib de formato/config puras) corra
// real. Esto sigue el patrón del repo: renderToStaticMarkup + aserciones sobre
// el HTML emitido, sin montar un DOM de navegador.

const Stub = ({ marker }) => React.createElement("div", { "data-stub": marker });

vi.mock("@/app/screenerPanels", () => ({
  CompactResultsTable: () => Stub({ marker: "CompactResultsTable" }),
  DecisionEvidenceSummaryRail: () => Stub({ marker: "DecisionEvidenceSummaryRail" }),
  DecisionOperatingBrief: () => Stub({ marker: "DecisionOperatingBrief" }),
  DecisionQualityStrip: () => Stub({ marker: "DecisionQualityStrip" }),
  DecisionSummaryRail: () => Stub({ marker: "DecisionSummaryRail" }),
  DataHealthSummaryRail: () => Stub({ marker: "DataHealthSummaryRail" }),
  AuditabilitySummaryRail: () => Stub({ marker: "AuditabilitySummaryRail" }),
  FilterArchitecturePanel: () => Stub({ marker: "FilterArchitecturePanel" }),
  FilterDiagnosticsPanel: () => Stub({ marker: "FilterDiagnosticsPanel" }),
  FilterNumber: () => Stub({ marker: "FilterNumber" }),
  FilterTemplatePanel: () => Stub({ marker: "FilterTemplatePanel" }),
  FilterToggle: () => Stub({ marker: "FilterToggle" }),
  MarketMiniTape: () => Stub({ marker: "MarketMiniTape" }),
  MobileResultList: () => Stub({ marker: "MobileResultList" }),
  PendingDecisionWorkRail: () => Stub({ marker: "PendingDecisionWorkRail" }),
  PendingResultsBar: (props) => React.createElement("div", { className: "pendingResultsBar", "data-pending": props.pending ? "set" : "null" }),
  PreviewCard: () => Stub({ marker: "PreviewCard" }),
  ResultFilterChips: () => Stub({ marker: "ResultFilterChips" }),
  SearchCandidateList: () => Stub({ marker: "SearchCandidateList" }),
  SearchScopeList: () => Stub({ marker: "SearchScopeList" }),
  ScoreAuditSummaryRail: () => Stub({ marker: "ScoreAuditSummaryRail" }),
  SetupChipRail: () => Stub({ marker: "SetupChipRail" }),
}));

vi.mock("@/app/components/screener/ReviewWidgets", () => ({
  ReviewPriorityResultRail: () => Stub({ marker: "ReviewPriorityResultRail" }),
}));
vi.mock("@/app/components/screener/DecisionGroups", () => ({ default: () => Stub({ marker: "DecisionGroups" }) }));
vi.mock("@/app/components/screener/ResultFilterBar", () => ({ default: () => Stub({ marker: "ResultFilterBar" }) }));
vi.mock("@/app/components/screener/ResultPagerTable", () => ({ default: () => Stub({ marker: "ResultPagerTable" }) }));

let ScreenerShell;
beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
});

// Construye un prop-bag mínimo pero coherente. `results` es un OBJETO (prop-bag),
// no un array: las filas están en resultsRows. Esta es la regresión central.
function makeProps({ resultsRows = [], pendingResults = null } = {}) {
  return {
    chrome: {
      presetKey: "global",
      markets: [["US", "EE. UU."]],
      filtered: [],
      filteredCount: 0,
      running: false,
      err: null,
      status: "idle",
      snapshotNotice: null,
      showMobileFilters: false,
      sidebarCollapsed: false,
      setShowMobileFilters: () => {},
      setSidebarCollapsed: () => {},
      stopScan: () => {},
      run: () => {},
      kpiUniverseCount: 0,
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
      loadUniverse: () => {},
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
      scanMode: "batch",
      setScanMode: () => {},
      scanBatchSize: 50,
      setScanBatchSize: () => {},
      batchStart: 0,
      setBatchStart: () => {},
      nextBatch: () => {},
      universe: [],
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
    resultView: {},
    results: {
      filtered: resultsRows,
      rows: resultsRows,
      pagedRows: resultsRows,
      activeSettings: {},
      analyzedRows: [],
      universe: [],
      pendingResults,
      pendingFilteredCount: pendingResults?.rows?.length ?? 0,
      favoriteSymbols: new Set(),
      screenerDecisionResolutions: {},
      restoringScan: false,
    },
    actions: {
      openReview: () => {},
      saveSnapshot: () => {},
      csv: () => {},
      decisionAuditJson: () => {},
      commitPendingResults: () => {},
      resetScreenerSession: () => {},
      addFavorite: () => {},
      saveSessionBeforeStockOpen: () => {},
    },
    staleness: { scanStale: false },
  };
}

const FINAL_ROW = { symbol: "FIN", percentileScope: "final" };
const BATCH_ROW = { symbol: "BAT", percentileScope: "batch" };
const UNSCOPED_ROW = { symbol: "OLD" }; // percentileScope ausente ⇒ tratado como batch

describe("ScreenerShell · franja P3 (percentil por lote)", () => {
  it("mantiene la franja visible cuando resultsRows contiene filas batch", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({ resultsRows: [FINAL_ROW, BATCH_ROW] })));
    expect(html).toContain("Muestra parcial · percentil por lote");
    expect(html).toContain("percentileScopeNotice");
    // La franja de pendiente no debe aparecer si la visible ya cubre batch.
    expect(html).not.toContain("Actualización preparada · percentil por lote");
    expect(html).not.toContain("percentileScopeNoticePending");
  });

  it("trata percentileScope ausente como batch en la lista visible", () => {
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, makeProps({ resultsRows: [UNSCOPED_ROW] })));
    expect(html).toContain("Muestra parcial · percentil por lote");
  });

  it("muestra la franja de actualización pendiente cuando solo pendingResults tiene batch", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ScreenerShell,
        makeProps({ resultsRows: [FINAL_ROW], pendingResults: { rows: [FINAL_ROW, BATCH_ROW] } }),
      ),
    );
    expect(html).toContain("Actualización preparada · percentil por lote");
    expect(html).toContain("percentileScopeNoticePending");
    expect(html).toContain("La actualización preparada contiene filas");
    // La franja visible no debe duplicarse.
    expect(html).not.toContain("Muestra parcial · percentil por lote");
  });

  it("trata percentileScope ausente como batch en la actualización pendiente", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ScreenerShell,
        makeProps({ resultsRows: [FINAL_ROW], pendingResults: { rows: [UNSCOPED_ROW] } }),
      ),
    );
    expect(html).toContain("Actualización preparada · percentil por lote");
  });

  it("no duplica franjas cuando ambos conjuntos tienen batch: prevalece la visible", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ScreenerShell,
        makeProps({ resultsRows: [BATCH_ROW], pendingResults: { rows: [BATCH_ROW] } }),
      ),
    );
    expect(html).toContain("Muestra parcial · percentil por lote");
    expect(html).not.toContain("Actualización preparada · percentil por lote");
  });

  it("no muestra ninguna franja cuando ambos conjuntos son exclusivamente final", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ScreenerShell,
        makeProps({ resultsRows: [FINAL_ROW], pendingResults: { rows: [FINAL_ROW] } }),
      ),
    );
    expect(html).not.toContain("Muestra parcial · percentil por lote");
    expect(html).not.toContain("Actualización preparada · percentil por lote");
    expect(html).not.toContain("percentileScopeNoticePending");
  });

  it("no llama .some sobre el prop-bag results: usa resultsRows aunque pending venga vacío", () => {
    // `results` es un objeto (prop-bag), no un array. Si el código volviera a
    // hacer results.some(...) esto lanzaría en runtime. Renderiza sin error.
    const props = makeProps({ resultsRows: [FINAL_ROW], pendingResults: null });
    expect(() => renderToStaticMarkup(React.createElement(ScreenerShell, props))).not.toThrow();
    const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
    expect(html).not.toContain("percentil por lote");
  });

  it("sitúa la franja pendiente junto a PendingResultsBar (contexto inequívoco)", () => {
    // Verificación visual local (markup estático): la franja de actualización
    // pendiente debe quedar inmediatamente después del PendingResultsBar, no en
    // la cabecera, para que el usuario la asocie con la actualización preparada.
    const html = renderToStaticMarkup(
      React.createElement(
        ScreenerShell,
        makeProps({ resultsRows: [FINAL_ROW], pendingResults: { rows: [BATCH_ROW] } }),
      ),
    );
    const barIdx = html.indexOf("pendingResultsBar");
    const pendingNoticeIdx = html.indexOf("percentileScopeNoticePending");
    const headerNoticeIdx = html.indexOf("Actualización preparada · percentil por lote");
    expect(barIdx).toBeGreaterThan(-1);
    expect(pendingNoticeIdx).toBeGreaterThan(barIdx);
    // La franja pendiente aparece dos veces (mobile + desktop), ambas tras su bar.
    expect(html.match(/percentileScopeNoticePending/g).length).toBe(2);
    // Y ambas tras la primera barra, antes del final.
    expect(headerNoticeIdx).toBeGreaterThan(barIdx);
  });
});
