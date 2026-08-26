// tests/_percentile_banner_visual.test.js
//
// VISUAL LOCAL / FIXTURE — NO es un flujo productivo ni una aserción de
// comportamiento. Genera, bajo demanda (TEST_BANNER_HTML=1), un único HTML en
// /tmp con los 4 escenarios de la franja P3 para inspección ocular local.
// No lanza scans, no toca Supabase. Por defecto (sin la env var) es un no-op.
//
// Uso: TEST_BANNER_HTML=1 npx vitest run tests/_percentile_banner_visual.test.js
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const Stub = ({ marker }) => React.createElement("div", { "data-stub": marker });

vi.mock("@/app/screenerPanels", () => ({
  FilterArchitecturePanel: () => Stub({ marker: "FilterArchitecturePanel" }),
  FilterDiagnosticsPanel: () => Stub({ marker: "FilterDiagnosticsPanel" }),
  FilterNumber: () => Stub({ marker: "FilterNumber" }),
  FilterTemplatePanel: () => Stub({ marker: "FilterTemplatePanel" }),
  FilterToggle: () => Stub({ marker: "FilterToggle" }),
  MarketMiniTape: () => Stub({ marker: "MarketMiniTape" }),
  MobileResultList: () => Stub({ marker: "MobileResultList" }),
  PendingResultsBar: (props) => React.createElement("div", { className: "pendingResultsBar", "data-pending": props.pending ? "set" : "null" }),
  PreviewCard: () => Stub({ marker: "PreviewCard" }),
  SearchCandidateList: () => Stub({ marker: "SearchCandidateList" }),
  SearchScopeList: () => Stub({ marker: "SearchScopeList" }),
  SetupChipRail: () => Stub({ marker: "SetupChipRail" }),
}));

vi.mock("@/app/components/screener/ResultFilterBar", () => ({ default: () => Stub({ marker: "ResultFilterBar" }) }));
vi.mock("@/app/components/screener/ResultPagerTable", () => ({ default: () => Stub({ marker: "ResultPagerTable" }) }));

let ScreenerShell;
beforeAll(async () => {
  ({ default: ScreenerShell } = await import("@/app/components/screener/ScreenerShell"));
});

function baseBag(resultsRows, pendingResults) {
  return {
    chrome: { presetKey: "global", markets: [["US", "EE. UU."]], filtered: [], filteredCount: 0, running: false, err: null, status: "idle", snapshotNotice: null, restoringScan: false, showMobileFilters: false, sidebarCollapsed: false, setShowMobileFilters: () => {}, setSidebarCollapsed: () => {}, stopScan: () => {}, run: () => {}, kpiUniverseCount: 0, marketHealth: null, rows: resultsRows },
    sidebar: { savedFilterTemplates: [], selectedFilterTemplateId: null, filterTemplateName: "", setPreset: () => {}, applySavedFilterTemplate: () => {}, setFilterTemplateName: () => {}, saveCurrentFilterTemplate: () => {}, deleteSavedFilterTemplate: () => {}, saveFilterConfigToCloud: () => {}, loadFilterConfigFromCloud: () => {}, isMarketPresetActive: () => false, marketPreset: () => {}, loadUniverse: () => {}, setMarketsAndInvalidate: () => {}, advancedOpen: false, persistAdvancedOpen: () => {}, advancedChangeCount: 0, filterLayers: {}, viewLayers: {}, useRegimeFilter: false, setUseRegimeFilter: () => {}, toggleFilterLayer: () => {}, setActiveFilterFamily: () => {}, toggleViewLayer: () => {}, executionRuleActive: 0, executionRuleTotal: 0, viewFiltersActive: false, setFilterLayers: () => {}, settings: {}, updateSetting: () => {}, settingApplies: () => false, inactiveSettingReason: () => "", toggleLayeredSetting: () => {}, fieldRules: {}, isFieldRuleActive: () => false, inactiveFieldReason: () => "", toggleFieldRule: () => {}, fineRuleActive: 0, fineRuleTotal: 0, setSettings: () => {}, setFieldRules: () => {}, scanMode: "batch", setScanMode: () => {}, scanBatchSize: 50, setScanBatchSize: () => {}, batchStart: 0, setBatchStart: () => {}, nextBatch: () => {}, universe: [], diagnostics: null },
    search: { searchSymbol: "", updateSearchSymbol: () => {}, searchCandidates: [], searchResult: null, searchScopeItems: [], searchLoading: false, searchError: null, runSearch: () => {}, clearSearch: () => {}, applySearchScope: () => {}, setSearchSymbol: () => {}, loadSearchResult: () => {}, favoriteSymbols: new Set(), screenerDecisionResolutions: {}, addFavorite: () => {}, saveSessionBeforeStockOpen: () => {} },
    resultView: {},
    results: { filtered: resultsRows, rows: resultsRows, pagedRows: resultsRows, activeSettings: {}, analyzedRows: [], universe: [], pendingResults, pendingFilteredCount: pendingResults?.rows?.length ?? 0, favoriteSymbols: new Set(), screenerDecisionResolutions: {}, restoringScan: false },
    actions: { openReview: () => {}, saveSnapshot: () => {}, csv: () => {}, decisionAuditJson: () => {}, commitPendingResults: () => {}, resetScreenerSession: () => {}, refreshScreenerSnapshotData: () => {}, addFavorite: () => {}, saveSessionBeforeStockOpen: () => {} },
    staleness: { scanStale: false },
  };
}

describe("banner P3 · captura visual local (fixture)", () => {
  it("genera /tmp/percentile-banner-scenarios.html solo con TEST_BANNER_HTML=1", () => {
    if (process.env.TEST_BANNER_HTML !== "1") return; // no-op por defecto

    const FIN = { symbol: "FIN", percentileScope: "final" };
    const BAT = { symbol: "BAT", percentileScope: "batch" };
    const scenarios = [
      ["1 · visible batch (Muestra parcial)", baseBag([FIN, BAT], null)],
      ["2 · solo pending batch (Actualización preparada)", baseBag([FIN], { rows: [FIN, BAT] })],
      ["3 · ambos batch (prevalece visible)", baseBag([BAT], { rows: [BAT] })],
      ["4 · ambos final (sin franja)", baseBag([FIN], { rows: [FIN] })],
    ];

    const body = scenarios.map(([title, props], i) => {
      const html = renderToStaticMarkup(React.createElement(ScreenerShell, props));
      return `<section style="margin-bottom:32px;border:1px solid #444;padding:16px;border-radius:8px;background:#0b0e14;color:#e5e7eb;font-family:ui-sans-serif,system-ui">
        <h2 style="color:#a1a1aa;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px">${title}</h2>
        <div style="max-height:320px;overflow:auto;font-size:12px">${html}</div>
      </section>`;
    }).join("\n");

    const css = `<style>
      body{background:#0b0e14;margin:0;padding:24px}
      .percentileScopeNotice,.percentileScopeNoticePending{margin:8px 0;padding:9px 12px;border:1px solid #6b7280;border-radius:6px;background:rgba(107,114,128,.12)}
      .pendingResultsBar{display:flex;gap:10px;align-items:center;min-height:38px;margin:0 0 8px;padding:7px 12px;border:1px solid #3b82f6;border-radius:8px;background:#111827}
      [data-stub]{opacity:.3;font-size:11px}
    </style>`;

    const out = join(tmpdir(), "percentile-banner-scenarios.html");
    writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8">${css}</head><body>${body}</body></html>`);
    // eslint-disable-next-line no-console
    console.log(`\n[visual local] fixture escrito en: ${out}\n`);
    expect(out).toMatch(/percentile-banner-scenarios\.html$/);
  });
});
