"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ChartPreferences from "@/app/ChartPreferences";
import ScreenerOriginPanel from "@/app/ScreenerOriginPanel";
import {
  activeLayerCount,
  amount,
  applyResultViewFilters,
  CompactResultsTable,
  CompanyMark,
  FilterArchitecturePanel,
  FilterDiagnosticsPanel,
  FilterFamilyModal,
  FilterNumber,
  FilterTemplatePanel,
  FilterToggle,
  investorStatusLabel,
  layerStatusText,
  MarketMiniTape,
  MobileResultList,
  money,
  opportunityBuckets,
  passesSectorStrength,
  PendingResultsBar,
  PreviewCard,
  quickBusinessDescription,
  quickBusinessMarket,
  ratioLabel,
  ResultFilterChips,
  SearchCandidateList,
  SearchScopeList,
  SetupChipRail,
  shortBusiness,
  sleep,
  searchText,
  TradingViewPreviewChart,
  verifiedIpoCategory,
} from "@/app/screenerPanels";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { getJson, postJson } from "@/lib/clientApi";
import { getLatestScanFromCloud, getSettingFromCloud, syncAlertsToCloud, syncFavoriteToCloud, syncScanToCloud, syncSettingToCloud } from "@/lib/cloudSyncClient";
import { pct } from "@/lib/formatters";
import { avg, avgVolume } from "@/lib/indicators";
import { safeRead, safeRemove, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { alertsFromScan, mergeAlerts } from "@/lib/methodologyAlerts";
import { enrichRowsWithMethodology, findCompatiblePreviousScan, snapshotCompatibilityKey, summarizeMethodology } from "@/lib/methodologyEngine";
import { rowPassesListContract } from "@/lib/listRationale";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { benchmarkSymbolForRow } from "@/lib/relativeStrength";
import { applyRelativeStrength, buildResearchRow, dataCoverageForRow } from "@/lib/researchRow";
import { isTerminalScanStatus } from "@/lib/scanStatus";
import { compositeLabel, volumeEvidence } from "@/lib/scoring";
import { ASIA, DEFAULT_MARKETS, DEFAULT_RESULT_PAGE_SIZE, DEFAULT_SCAN_BATCH_SIZE, DEFAULT_STATUS, DEFAULT_VIEW_LAYERS, EUROPE, FULL_SCAN_PARTIAL_EVERY, MARKET_META, MARKET_ORDER, MARKETS, marketExchange, marketName, normalizeSectorStrength, RESULT_PAGE_SIZES, SCAN_BATCH_SIZES, SCREENER_FILTER_SETTING, SCREENER_SESSION_VERSION, SECTOR_STRENGTH_LABELS, SECTOR_STRENGTH_OPTIONS, SERVER_SCAN_POLL_MS, USER_TEMPLATE_LIMIT, VIEW_LAYERS } from "@/lib/screenerConfig";
import { cachedScreenerQuery, cachedScreenerRow, compactRowForSession, compactRowsForSession, failureKind, fastFilterSignature, filterAnalyzedRows, ipoRadarUniverseRows, manualUniverseRows, normalizeFilterTemplates, perfNow, secondsLabel, sectorize, setupModeLabel, shuffle, sortMetric, spreadByInitial, uid, universeScopeKey } from "@/lib/screenerPipeline";
import {
  ALL_FILTER_LAYERS,
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  EXECUTION_LAYERS,
  FILTER_FIELDS,
  FILTER_GROUPS,
  REGIME_LAYER,
  SCREENER_ALL_SYMBOLS_LIMIT as ALL_SYMBOLS_LIMIT,
  SCREENER_FILTER_PRESETS as PRESETS,
  filterLayersForPreset,
  filterStrictnessForPreset,
  settingsForPreset,
  setupModeDefaults,
  setupModeLayerRequirements,
} from "@/lib/screenerFilterCatalog";
import {
  effectiveSettingsFromLayers,
  fieldLayerKeys,
  inactiveFieldReason,
  inactiveSettingReason,
  isFieldRuleActive,
  settingApplies,
  settingLayerDependency,
} from "@/lib/screenerFilterLayers";
import { buildScreenerContract, buildScreenerStockContext } from "@/lib/screenerContracts";
import { createFavoriteFromRow } from "@/lib/stockRows";
import { countryCode, externalLinks, marketFlag, stockUrl } from "@/lib/symbols";



export default function Page() {
  const [markets, setMarkets] = useState(DEFAULT_MARKETS);
  const [manual, setManual] = useState("");
  const [settings, setSettings] = useState(settingsForPreset("balanced"));
  const [presetKey, setPresetKey] = useState("balanced");
  const [universe, setUniverse] = useState([]);
  const [universeScope, setUniverseScope] = useState("");
  const [rows, setRows] = useState([]);
  const [pendingResults, setPendingResults] = useState(null);
  const [analyzedRows, setAnalyzedRows] = useState([]);
  const [scanContext, setScanContext] = useState(null);
  const [scanPerf, setScanPerf] = useState(null);
  const [fail, setFail] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [running, setRunning] = useState(false);
  const [themeFilter, setThemeFilter] = useState("Todos");
  const [sectorFilter, setSectorFilter] = useState("Todos");
  const [industryFilter, setIndustryFilter] = useState("Todos");
  const [countryFilter, setCountryFilter] = useState("Todos");
  const [sectorStrength, setSectorStrength] = useState("Todos");
  const [ipo, setIpo] = useState("Todos");
  const [sort, setSort] = useState("totalScore");
  const [err, setErr] = useState("");
  const [scanMode, setScanMode] = useState("all");
  const [batchStart, setBatchStart] = useState(0);
  const [scanBatchSize, setScanBatchSize] = useState(DEFAULT_SCAN_BATCH_SIZE);
  const [resultPageSize, setResultPageSize] = useState(DEFAULT_RESULT_PAGE_SIZE);
  const [resultPage, setResultPage] = useState(1);
  const [marketHealth, setMarketHealth] = useState(null);
  const [useRegimeFilter, setUseRegimeFilter] = useState(true);
  const [filterLayers, setFilterLayers] = useState(DEFAULT_FILTER_LAYERS);
  const [fieldRules, setFieldRules] = useState(DEFAULT_FIELD_RULES);
  const [viewLayers, setViewLayers] = useState(DEFAULT_VIEW_LAYERS);
  const [favoriteSymbols, setFavoriteSymbols] = useState(new Set());
  const [searchSymbol, setSearchSymbol] = useState("");
  const [searchCandidates, setSearchCandidates] = useState([]);
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [activePreviewRow, setActivePreviewRow] = useState(null);
  const [activeModalRow, setActiveModalRow] = useState(null);
  const [quickReviewRows, setQuickReviewRows] = useState([]);
  const [quickReviewIndex, setQuickReviewIndex] = useState(0);
  const [chartSettings, setChartSettings] = useState(DEFAULT_CHART_SETTINGS);
  const [chartScope, setChartScope] = useState("global");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Panel "Configuración avanzada": cerrado por defecto, colapso persistido en localStorage.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    setAdvancedOpen(Boolean(safeRead("statsedge.screenerAdvancedOpen.v1", false)));
  }, []);
  function persistAdvancedOpen(open) {
    setAdvancedOpen(open);
    safeWrite("statsedge.screenerAdvancedOpen.v1", open);
  }
  // Badge del panel avanzado: nº de ajustes (umbrales + capas) que difieren del preset activo.
  const advancedChangeCount = useMemo(() => {
    const baseSettings = settingsForPreset(presetKey);
    let count = 0;
    for (const key of new Set([...Object.keys(baseSettings), ...Object.keys(settings)])) {
      if ((settings[key] ?? null) !== (baseSettings[key] ?? null)) count += 1;
    }
    const baseLayers = filterLayersForPreset(presetKey);
    for (const key of new Set([...Object.keys(baseLayers), ...Object.keys(filterLayers)])) {
      if (Boolean(filterLayers[key]) !== Boolean(baseLayers[key])) count += 1;
    }
    return count;
  }, [settings, filterLayers, presetKey]);
  const [sessionReady, setSessionReady] = useState(false);
  const [savedFilterTemplates, setSavedFilterTemplates] = useState([]);
  const [selectedFilterTemplateId, setSelectedFilterTemplateId] = useState("");
  const [filterTemplateName, setFilterTemplateName] = useState("");
  const [activeFilterFamily, setActiveFilterFamily] = useState(null);
  const fastFilterSignatureRef = useRef("");
  const scanAbortRef = useRef(false);
  const serverScanIdRef = useRef("");
  const restoreScrollRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    let restoredRowsCount = 0;
    setFavoriteSymbols(new Set(safeRead(STORAGE_KEYS.favorites, []).map((x) => x.symbol)));
    setChartSettings(readChartSettings());
    setSavedFilterTemplates(normalizeFilterTemplates(safeRead(STORAGE_KEYS.screenerFilterTemplates, [])));
    const session = safeRead(STORAGE_KEYS.screenerSession, null);
    if (session?.version === SCREENER_SESSION_VERSION) {
      const restoredPresetKey = PRESETS[session.presetKey] ? session.presetKey : "balanced";
      const restoredMarkets = Array.isArray(session.markets) && session.markets.length ? session.markets : DEFAULT_MARKETS;
      const restoredManual = session.manual || "";
      const restoredUniverse = Array.isArray(session.universe) ? session.universe : [];
      const restoredRows = Array.isArray(session.rows) ? session.rows : [];
      const restoredAnalyzedRows = Array.isArray(session.analyzedRows) ? session.analyzedRows : [];
      const restoredSettings = settingsForPreset(restoredPresetKey, session.settings || {});
      const restoredFilterLayers = { ...filterLayersForPreset(restoredPresetKey), ...(session.filterLayers || {}) };
      const restoredFieldRules = { ...DEFAULT_FIELD_RULES, ...(session.fieldRules || {}) };
      const restoredMarketHealth = session.marketHealth || null;
      const restoredUseRegimeFilter = session.useRegimeFilter !== false;
      const restoredScrollY = Number(session.scrollY);
      restoredRowsCount = restoredRows.length;
      if (Number.isFinite(restoredScrollY) && restoredScrollY > 0) restoreScrollRef.current = restoredScrollY;
      setMarkets(restoredMarkets);
      setManual(restoredManual);
      setSettings(restoredSettings);
      setPresetKey(restoredPresetKey);
      setUniverse(restoredUniverse);
      setUniverseScope(session.universeScope || (restoredUniverse.length ? universeScopeKey(restoredMarkets, restoredManual) : ""));
      setRows(restoredRows);
      setAnalyzedRows(restoredAnalyzedRows);
      setScanContext(session.scanContext || null);
      setScanPerf(session.scanPerf || null);
      setFail(Array.isArray(session.fail) ? session.fail : []);
      setDiagnostics(session.diagnostics || null);
      setThemeFilter(session.themeFilter || "Todos");
      setSectorFilter(session.sectorFilter || "Todos");
      setIndustryFilter(session.industryFilter || "Todos");
      setCountryFilter(session.countryFilter || "Todos");
      setSectorStrength(normalizeSectorStrength(session.sectorStrength));
      setIpo(session.ipo || "Todos");
      setSort(session.sort || "totalScore");
      setScanMode(session.scanMode || "all");
      setBatchStart(Number.isFinite(session.batchStart) ? session.batchStart : 0);
      setScanBatchSize(SCAN_BATCH_SIZES.includes(session.scanBatchSize) ? session.scanBatchSize : DEFAULT_SCAN_BATCH_SIZE);
      setResultPageSize(RESULT_PAGE_SIZES.includes(session.resultPageSize) ? session.resultPageSize : DEFAULT_RESULT_PAGE_SIZE);
      setResultPage(Number.isFinite(session.resultPage) && session.resultPage > 0 ? session.resultPage : 1);
      setMarketHealth(restoredMarketHealth);
      setUseRegimeFilter(restoredUseRegimeFilter);
      setFilterLayers(restoredFilterLayers);
      setFieldRules(restoredFieldRules);
      setViewLayers(session.viewLayers || DEFAULT_VIEW_LAYERS);
      setSearchSymbol(session.searchSymbol || "");
      setSearchCandidates(Array.isArray(session.searchCandidates) ? session.searchCandidates : []);
      setSearchResult(session.searchResult || null);
      setQuickReviewRows(Array.isArray(session.quickReviewRows) ? session.quickReviewRows : []);
      setQuickReviewIndex(Number.isFinite(session.quickReviewIndex) ? session.quickReviewIndex : 0);
      if (restoredRows.length && restoredAnalyzedRows.length && session.scanContext) {
        fastFilterSignatureRef.current = fastFilterSignature(
          restoredAnalyzedRows,
          effectiveSettingsFromLayers(restoredSettings, restoredFilterLayers, restoredFieldRules),
          { ...session.scanContext, marketHealth: restoredMarketHealth, useRegimeFilter: restoredUseRegimeFilter },
        );
      }
      setStatus(session.rows?.length ? `Sesión restaurada: ${session.rows.length} acciones en el screener.` : (session.status || DEFAULT_STATUS));
    }
    if (!restoredRowsCount) {
      getLatestScanFromCloud().then((result) => {
        if (cancelled || !result.ok || result.configured === false) return;
        const scan = result.data?.scans?.find((item) => Array.isArray(item.rows) && item.rows.length);
        if (!scan) return;
        const restoredPresetKey = PRESETS[scan.preset] ? scan.preset : "balanced";
        const restoredSettings = settingsForPreset(restoredPresetKey, scan.settings || {});
        const restoredFilterLayers = { ...filterLayersForPreset(restoredPresetKey), ...(scan.filterLayers || {}) };
        const restoredFieldRules = { ...DEFAULT_FIELD_RULES, ...(scan.fieldRules || {}) };
        const restoredViewLayers = scan.viewLayers || DEFAULT_VIEW_LAYERS;
        const restoredUseRegimeFilter = scan.useRegimeFilter !== false;
        const restoredActiveSettings = scan.activeSettings || effectiveSettingsFromLayers(restoredSettings, restoredFilterLayers, restoredFieldRules);
        const nextScanContext = {
          id: scan.id || uid(),
          symbolsCount: scan.rows.length,
          baseCount: scan.rows.length,
          providerErrors: [],
          scannedAt: scan.updatedAt || scan.createdAt || new Date().toISOString(),
          snapshotSource: "supabase",
          snapshotRowsAreFiltered: scan.rowsAreFilteredSnapshot !== false,
        };
        const storedScans = safeRead(STORAGE_KEYS.scans, []);
        safeWrite(STORAGE_KEYS.scans, [scan, ...(Array.isArray(storedScans) ? storedScans.filter((item) => item?.id !== scan.id) : [])].slice(0, 50));
        fastFilterSignatureRef.current = fastFilterSignature(scan.rows, restoredActiveSettings, {
          ...nextScanContext,
          marketHealth,
          useRegimeFilter: restoredUseRegimeFilter,
        });
        setPresetKey(restoredPresetKey);
        setSettings(restoredSettings);
        setFilterLayers(restoredFilterLayers);
        setFieldRules(restoredFieldRules);
        setViewLayers(restoredViewLayers);
        setUseRegimeFilter(restoredUseRegimeFilter);
        setRows(scan.rows);
        setAnalyzedRows(scan.rows);
        setScanContext(nextScanContext);
        setScanPerf({
          fullScanMs: null,
          lastFilterMs: 0,
          lastFastFilterMs: null,
          estimatedSavedMs: null,
          analyzedRows: scan.rows.length,
          scannedSymbols: scan.rows.length,
          fastRefilters: 0,
        });
        setStatus(`Último snapshot Supabase cargado: ${scan.rows.length} acciones. Los filtros se aplican sobre este universo estable.`);
      });
    }
    setSessionReady(true);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const targetY = restoreScrollRef.current;
    if (!Number.isFinite(targetY) || targetY <= 0) return;
    restoreScrollRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, targetY));
    });
  }, [sessionReady, rows.length]);

  useEffect(() => {
    function restorePersistedScroll() {
      const session = safeRead(STORAGE_KEYS.screenerSession, null);
      const targetY = Number(session?.scrollY);
      if (!Number.isFinite(targetY) || targetY <= 0) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.scrollTo(0, targetY));
      });
      window.setTimeout(() => window.scrollTo(0, targetY), 150);
      window.setTimeout(() => window.scrollTo(0, targetY), 500);
    }
    window.addEventListener("popstate", restorePersistedScroll);
    window.addEventListener("pageshow", restorePersistedScroll);
    return () => {
      window.removeEventListener("popstate", restorePersistedScroll);
      window.removeEventListener("pageshow", restorePersistedScroll);
    };
  }, []);

  function buildScreenerSessionPayload(overrides = {}) {
    const previousSession = safeRead(STORAGE_KEYS.screenerSession, {});
    return {
      version: SCREENER_SESSION_VERSION,
      updatedAt: new Date().toISOString(),
      markets,
      manual,
      settings,
      presetKey,
      universe,
      universeScope,
      rows,
      analyzedRows: compactRowsForSession(analyzedRows),
      scanContext,
      scanPerf,
      fail,
      diagnostics,
      status,
      themeFilter,
      sectorFilter,
      industryFilter,
      countryFilter,
      sectorStrength,
      ipo,
      sort,
      scanMode,
      batchStart,
      scanBatchSize,
      resultPageSize,
      resultPage,
      marketHealth,
      useRegimeFilter,
      filterLayers,
      fieldRules,
      viewLayers,
      searchSymbol,
      searchCandidates,
      searchResult,
      quickReviewRows,
      quickReviewIndex,
      scrollY: previousSession?.scrollY ?? null,
      lastOpenedStockSymbol: previousSession?.lastOpenedStockSymbol || "",
      lastOpenedStockAt: previousSession?.lastOpenedStockAt || null,
      lastOpenedStockContext: previousSession?.lastOpenedStockContext || null,
      ...overrides,
    };
  }

  function persistScreenerSession(overrides = {}) {
    const sessionPayload = buildScreenerSessionPayload(overrides);
    const saved = safeWrite(STORAGE_KEYS.screenerSession, sessionPayload);
    if (!saved) {
      return safeWrite(STORAGE_KEYS.screenerSession, {
        ...sessionPayload,
        universe: [],
        fail: [],
        diagnostics: null,
        searchCandidates: [],
        searchResult: compactRowForSession(sessionPayload.searchResult),
        quickReviewRows: compactRowsForSession(sessionPayload.quickReviewRows),
        rows: compactRowsForSession(sessionPayload.rows),
        analyzedRows: compactRowsForSession(sessionPayload.analyzedRows),
        storageNote: "Sesión compactada por límite de localStorage.",
      });
    }
    return saved;
  }

  function saveSessionBeforeStockOpen(rowOrSymbol = null) {
    const row = rowOrSymbol && typeof rowOrSymbol === "object" ? rowOrSymbol : null;
    const symbol = typeof rowOrSymbol === "string" ? rowOrSymbol : row?.symbol;
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    persistScreenerSession({
      lastOpenedStockSymbol: symbol || "",
      lastOpenedStockAt: new Date().toISOString(),
      lastOpenedStockContext: buildScreenerStockOpenContext(rowOrSymbol),
      scrollY,
      searchResult: compactRowForSession(searchResult),
      quickReviewRows: compactRowsForSession(quickReviewRows),
      rows: compactRowsForSession(rows),
      analyzedRows: compactRowsForSession(analyzedRows),
    });
  }

  useEffect(() => {
    if (!sessionReady) return;
    persistScreenerSession();
  }, [sessionReady, markets, manual, settings, presetKey, universe, universeScope, rows, analyzedRows, scanContext, scanPerf, fail, diagnostics, status, themeFilter, sectorFilter, industryFilter, countryFilter, sectorStrength, ipo, sort, scanMode, batchStart, scanBatchSize, resultPageSize, resultPage, marketHealth, useRegimeFilter, filterLayers, fieldRules, viewLayers, searchSymbol, searchCandidates, searchResult, quickReviewRows, quickReviewIndex]);

  const chartListId = useMemo(() => `screener:${presetKey}:${markets.join(",")}`, [presetKey, markets]);

  function updateChartSettings(nextSettings) {
    setChartSettings(writeChartSettings(nextSettings, { scope: chartScope, symbol: activeModalRow?.symbol, listId: chartListId }));
  }

  function updateChartScope(nextScope) {
    setChartScope(nextScope);
    setChartSettings(readChartSettings({ scope: nextScope, symbol: activeModalRow?.symbol, listId: chartListId }));
  }

  useEffect(() => {
    if (chartScope !== "global") setChartSettings(readChartSettings({ scope: chartScope, symbol: activeModalRow?.symbol, listId: chartListId }));
  }, [chartScope, activeModalRow?.symbol, chartListId]);

  const activeSettings = useMemo(() => effectiveSettingsFromLayers(settings, filterLayers, fieldRules), [settings, filterLayers, fieldRules]);
  const activeLayerLabel = useMemo(() => layerStatusText(filterLayers, useRegimeFilter), [filterLayers, useRegimeFilter]);
  useEffect(() => {
    if (!sessionReady || running || !analyzedRows.length || !scanContext) return;
    const context = { ...scanContext, marketHealth, useRegimeFilter };
    const signature = fastFilterSignature(analyzedRows, activeSettings, context);
    if (fastFilterSignatureRef.current === signature) return;
    const filteredView = filterAnalyzedRows(analyzedRows, activeSettings, context);
    const savedMs = Number.isFinite(scanPerf?.fullScanMs) ? Math.max(0, scanPerf.fullScanMs - filteredView.filterMs) : null;
    fastFilterSignatureRef.current = signature;
    setRows(filteredView.rows);
    setDiagnostics(filteredView.diagnostics);
    setPendingResults(null);
    setResultPage(1);
    setScanPerf((prev) => ({
      ...(prev || {}),
      lastFilterMs: filteredView.filterMs,
      lastFastFilterMs: filteredView.filterMs,
      estimatedSavedMs: savedMs,
      analyzedRows: analyzedRows.length,
      fastRefilters: (prev?.fastRefilters || 0) + 1,
    }));
    setStatus(`Filtros recalculados sobre ${analyzedRows.length} acciones ya analizadas en ${secondsLabel(filteredView.filterMs)} · ahorro aprox ${Number.isFinite(savedMs) ? secondsLabel(savedMs) : "sin referencia"} frente a re-scan.`);
  }, [sessionReady, running, analyzedRows, scanContext, activeSettings, marketHealth, useRegimeFilter, scanPerf?.fullScanMs]);
  const executionLayerTotal = EXECUTION_LAYERS.length + 1;
  const executionLayerActive = activeLayerCount(filterLayers) + (useRegimeFilter ? 1 : 0);
  const executionRuleTotal = REGIME_LAYER.count + EXECUTION_LAYERS.reduce((sum, layer) => sum + layer.count, 0);
  const executionRuleActive = (useRegimeFilter ? REGIME_LAYER.count : 0) + EXECUTION_LAYERS.reduce((sum, layer) => sum + (filterLayers[layer.key] ? layer.count : 0), 0);
  const fineRuleTotal = FILTER_FIELDS.length;
  const fineRuleActive = FILTER_FIELDS.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length;
  const viewFilterCounts = {
    country: countryFilter !== "Todos" ? 1 : 0,
    theme: themeFilter !== "Todos" ? 1 : 0,
    sector: sectorFilter !== "Todos" ? 1 : 0,
    industry: industryFilter !== "Todos" ? 1 : 0,
    sectorStrength: sectorStrength !== "Todos" ? 1 : 0,
    ipo: ipo !== "Todos" ? 1 : 0,
  };
  const viewFiltersActive = VIEW_LAYERS.reduce((sum, layer) => sum + (viewLayers[layer.key] ? viewFilterCounts[layer.key] : 0), 0);
  const kpiUniverseCount = universe.length || scanContext?.baseCount || analyzedRows.length || rows.length;
  function commitPendingResults() {
    if (!pendingResults) return;
    setRows(pendingResults.rows || []);
    setDiagnostics(pendingResults.diagnostics || null);
    setPendingResults(null);
    setStatus(`Resultados actualizados: ${pendingResults.rows?.length || 0} acciones calculadas.`);
  }
  const clear = () => {
    setRows([]);
    setPendingResults(null);
    setAnalyzedRows([]);
    setScanContext(null);
    setScanPerf(null);
    fastFilterSignatureRef.current = "";
    setFail([]);
    setDiagnostics(null);
    setErr("");
    setResultPage(1);
  };
  function setMarketsAndInvalidate(nextMarkets, label = "Mercados actualizados.") {
    const normalized = (Array.isArray(nextMarkets) ? nextMarkets : [])
      .filter((code, index, list) => MARKET_META[code] && list.indexOf(code) === index);
    setMarkets(normalized);
    setUniverse([]);
    setUniverseScope("");
    setBatchStart(0);
    clear();
    setStatus(`${label} Pulsa Cargar o Ejecutar.`);
  }
  function resetScreenerSession() {
    safeRemove(STORAGE_KEYS.screenerSession);
    setMarkets(DEFAULT_MARKETS);
    setManual("");
    setSettings(settingsForPreset("balanced"));
    setPresetKey("balanced");
    setUniverse([]);
    setUniverseScope("");
    setRows([]);
    setPendingResults(null);
    setAnalyzedRows([]);
    setScanContext(null);
    setScanPerf(null);
    fastFilterSignatureRef.current = "";
    setFail([]);
    setDiagnostics(null);
    setStatus("Sesión reiniciada. Carga universo o ejecuta el screener cuando quieras.");
    setRunning(false);
    setThemeFilter("Todos");
    setSectorFilter("Todos");
    setIndustryFilter("Todos");
    setCountryFilter("Todos");
    setSectorStrength("Todos");
    setIpo("Todos");
    setSort("totalScore");
    setErr("");
    setScanMode("all");
    setBatchStart(0);
    setScanBatchSize(DEFAULT_SCAN_BATCH_SIZE);
    setResultPageSize(DEFAULT_RESULT_PAGE_SIZE);
    setResultPage(1);
    setMarketHealth(null);
    setUseRegimeFilter(true);
    setFilterLayers(filterLayersForPreset("balanced"));
    setFieldRules(DEFAULT_FIELD_RULES);
    setViewLayers(DEFAULT_VIEW_LAYERS);
    setSearchSymbol("");
    setSearchCandidates([]);
    setSearchResult(null);
    setSearchError("");
    setSearchLoading(false);
    setActivePreviewRow(null);
    setActiveModalRow(null);
    setQuickReviewRows([]);
    setQuickReviewIndex(0);
    setShowMobileFilters(false);
    setSelectedFilterTemplateId("");
    setFilterTemplateName("");
    setActiveFilterFamily(null);
  }
  function applySetupMode(mode) {
    const defaults = setupModeDefaults(mode);
    const nextMode = defaults.setupMode || "leader";
    const strictnessPatch = nextMode === "any" || nextMode === "weakness" ? {} : { filterStrictness: filterStrictnessForPreset(presetKey) };
    setFilterLayers((prev) => ({ ...prev, ...setupModeLayerRequirements(nextMode) }));
    setSettings((prev) => {
      if (nextMode === "weakness") return { ...prev, ...settingsForPreset("weakness"), maxSymbols: prev.maxSymbols || PRESETS.weakness.v.maxSymbols };
      return { ...prev, ...strictnessPatch, ...defaults };
    });
    setSort(nextMode === "weakness" ? "weaknessScore" : "totalScore");
    setResultPage(1);
    setSelectedFilterTemplateId("");
    setFilterTemplateName("");
    setStatus(`Patrón aplicado: ${setupModeLabel(nextMode)}. Pulsa Ejecutar.`);
  }
  const updateSetting = (key, value) => {
    if (key === "setupMode") {
      applySetupMode(value);
      return;
    }
    setSettings((prev) => ({ ...prev, [key]: value }));
  };
  const toggleFilterLayer = (key) => setFilterLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleLayeredSetting = (key) => {
    const dependency = settingLayerDependency(key);
    if (dependency && filterLayers[dependency.layer] === false) {
      setFilterLayers((prev) => ({ ...prev, [dependency.layer]: true }));
      setSettings((prev) => ({ ...prev, [key]: true }));
      return;
    }
    updateSetting(key, !settings[key]);
  };
  const applyLayerAction = (layerKey, action = {}) => {
    const actionSettings = action.settings || {};
    const fieldLayerUpdates = Object.fromEntries(Object.keys(actionSettings)
      .flatMap((key) => fieldLayerKeys(key))
      .map((key) => [key, true]));
    const settingLayerUpdates = Object.fromEntries(Object.keys(actionSettings)
      .map((key) => settingLayerDependency(key)?.layer)
      .filter(Boolean)
      .map((key) => [key, true]));
    const nextLayers = { [layerKey]: true, ...fieldLayerUpdates, ...settingLayerUpdates, ...setupModeLayerRequirements(actionSettings.setupMode), ...(action.filterLayers || {}) };
    const ruleUpdates = Object.fromEntries(Object.keys(actionSettings)
      .filter((key) => DEFAULT_FIELD_RULES[key] !== undefined)
      .map((key) => [key, true]));
    setFilterLayers((prev) => ({ ...prev, ...nextLayers }));
    if (action.settings) setSettings((prev) => ({ ...prev, ...action.settings }));
    if (Object.keys(ruleUpdates).length || action.fieldRules) setFieldRules((prev) => ({ ...prev, ...ruleUpdates, ...(action.fieldRules || {}) }));
    if (action.sort) setSort(action.sort);
    setSelectedFilterTemplateId("");
    setStatus(`Ajuste aplicado: ${action.label || layerKey}.`);
  };
  const toggleFieldRule = (field) => {
    const currentlyActive = isFieldRuleActive(field, fieldRules, filterLayers);
    if (currentlyActive) {
      setFieldRules((prev) => ({ ...prev, [field.key]: false }));
      return;
    }
    setFieldRules((prev) => ({ ...prev, [field.key]: true }));
    const neededLayers = fieldLayerKeys(field);
    if (neededLayers.length) setFilterLayers((prev) => ({ ...prev, ...Object.fromEntries(neededLayers.map((key) => [key, true])) }));
  };
  const toggleViewLayer = (key) => {
    const willDisable = viewLayers[key] !== false;
    if (willDisable) clearResultViewLayer(key);
    setViewLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  function currentFilterConfig() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      markets,
      manual,
      presetKey,
      settings,
      useRegimeFilter,
      filterLayers,
      fieldRules,
      viewLayers,
      themeFilter,
      sectorFilter,
      industryFilter,
      countryFilter,
      sectorStrength,
      ipo,
      sort,
      scanMode,
      batchStart,
      scanBatchSize,
      resultPageSize,
    };
  }
  function writeSavedFilterTemplates(nextTemplates = []) {
    const normalized = normalizeFilterTemplates(nextTemplates);
    setSavedFilterTemplates(normalized);
    safeWrite(STORAGE_KEYS.screenerFilterTemplates, normalized);
    return normalized;
  }
  function saveCurrentFilterTemplate(forceNew = false) {
    const name = filterTemplateName.trim() || `Mi filtro ${savedFilterTemplates.length + 1}`;
    const matchingTemplate = savedFilterTemplates.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const targetId = forceNew ? uid() : (selectedFilterTemplateId || matchingTemplate?.id || uid());
    const template = {
      id: targetId,
      name,
      updatedAt: new Date().toISOString(),
      config: currentFilterConfig(),
    };
    const next = [template, ...savedFilterTemplates.filter((item) => item.id !== targetId)].slice(0, USER_TEMPLATE_LIMIT);
    writeSavedFilterTemplates(next);
    setSelectedFilterTemplateId(targetId);
    setFilterTemplateName(name);
    setStatus(`Plantilla guardada: ${name}.`);
  }
  function applySavedFilterTemplate(id) {
    setSelectedFilterTemplateId(id);
    const template = savedFilterTemplates.find((item) => item.id === id);
    if (!template) {
      setFilterTemplateName("");
      return;
    }
    setFilterTemplateName(template.name);
    applyFilterConfig(template.config);
    setStatus(`Plantilla aplicada: ${template.name}. Pulsa Ejecutar.`);
  }
  function deleteSavedFilterTemplate() {
    const template = savedFilterTemplates.find((item) => item.id === selectedFilterTemplateId);
    if (!template) return;
    const next = savedFilterTemplates.filter((item) => item.id !== selectedFilterTemplateId);
    writeSavedFilterTemplates(next);
    setSelectedFilterTemplateId("");
    setFilterTemplateName("");
    setStatus(`Plantilla borrada: ${template.name}.`);
  }
  function applyFilterConfig(config = {}) {
    const nextPresetKey = PRESETS[config.presetKey] ? config.presetKey : "balanced";
    const nextPreset = PRESETS[nextPresetKey] || PRESETS.balanced;
    setMarkets(Array.isArray(config.markets) && config.markets.length ? config.markets : DEFAULT_MARKETS);
    setManual(config.manual || "");
    setPresetKey(nextPresetKey);
    setSettings(settingsForPreset(nextPresetKey, config.settings || {}));
    setUseRegimeFilter(config.useRegimeFilter !== false);
    setFilterLayers({ ...filterLayersForPreset(nextPresetKey), ...(config.filterLayers || {}) });
    setFieldRules({ ...DEFAULT_FIELD_RULES, ...(config.fieldRules || {}) });
    setViewLayers({ ...DEFAULT_VIEW_LAYERS, ...(config.viewLayers || {}) });
    setThemeFilter(config.themeFilter || "Todos");
    setSectorFilter(config.sectorFilter || "Todos");
    setIndustryFilter(config.industryFilter || "Todos");
    setCountryFilter(config.countryFilter || "Todos");
    setSectorStrength(normalizeSectorStrength(config.sectorStrength));
    setIpo(config.ipo || "Todos");
    setSort(config.sort || (nextPreset.v.setupMode === "weakness" ? "weaknessScore" : "totalScore"));
    setScanMode(config.scanMode || "all");
    setBatchStart(Number.isFinite(config.batchStart) ? config.batchStart : 0);
    setScanBatchSize(SCAN_BATCH_SIZES.includes(config.scanBatchSize) ? config.scanBatchSize : DEFAULT_SCAN_BATCH_SIZE);
    setResultPageSize(RESULT_PAGE_SIZES.includes(config.resultPageSize) ? config.resultPageSize : DEFAULT_RESULT_PAGE_SIZE);
    setResultPage(1);
    setUniverse([]);
    setUniverseScope("");
    clear();
  }
  async function saveFilterConfigToCloud() {
    setStatus("Guardando filtros en Supabase...");
    const result = await syncSettingToCloud({ ...SCREENER_FILTER_SETTING, value: currentFilterConfig() });
    if (result.configured === false) setStatus("Filtros guardados en local. Supabase no configurado.");
    else if (result.ok) setStatus("Filtros guardados en Supabase.");
    else setStatus(`No se pudieron guardar filtros en Supabase: ${result.message}`);
  }
  async function loadFilterConfigFromCloud() {
    setStatus("Cargando filtros desde Supabase...");
    const result = await getSettingFromCloud(SCREENER_FILTER_SETTING.type, SCREENER_FILTER_SETTING.key);
    if (result.configured === false) {
      setStatus("Supabase no configurado. Se mantienen los filtros locales.");
      return;
    }
    if (!result.ok) {
      setStatus(`No se pudieron cargar filtros de Supabase: ${result.message}`);
      return;
    }
    const value = result.data?.setting?.value;
    if (!value) {
      setStatus("No hay filtros guardados en Supabase todavia.");
      return;
    }
    applyFilterConfig(value);
    setStatus("Filtros cargados desde Supabase. Pulsa Cargar universo o Ejecutar.");
  }
  async function loadMarketHealth() {
    setStatus("Actualizando salud de mercado...");
    try {
      const d = await getJson("/api/market-health");
      setMarketHealth(d);
      setStatus(`Salud de mercado: ${d.regime?.label || "sin regimen"} · Score ${Math.round(d.marketScore || 0)}`);
      return d;
    } catch (e) {
      setErr(e.message);
      setStatus("Proveedor no disponible para salud de mercado");
      return null;
    }
  }
  async function loadSearchResult(symbol, candidate = null) {
    const normalized = String(symbol || "").trim().toUpperCase();
    if (!normalized) {
      setSearchError("Introduce un ticker o el nombre de una empresa.");
      return;
    }
    setSearchLoading(true);
    setSearchError("");
    try {
      const [chart, profile] = await Promise.all([
        getJson(`/api/chart?symbol=${encodeURIComponent(normalized)}`),
        getJson(`/api/profile?symbol=${encodeURIComponent(normalized)}`).catch(() => ({})),
      ]);
      const baseRow = buildResearchRow(normalized, chart, profile, false);
      const benchmark = baseRow.benchmarkSymbol || benchmarkSymbolForRow(baseRow);
      const benchmarkChart = await getJson(`/api/chart?symbol=${encodeURIComponent(benchmark)}`).catch(() => ({ bars: [] }));
      const withBenchmark = applyRelativeStrength(baseRow, { [benchmark]: benchmarkChart });
      const row = sectorize([{ ...withBenchmark, ...dataCoverageForRow(withBenchmark, profile) }])[0];
      setSearchResult(row);
      setStatus(`Vista rapida cargada para ${row.companyName || candidate?.name || normalized} (${normalized}).`);
    } catch (e) {
      setSearchResult(null);
      setSearchError(e.message || "Proveedor no disponible");
      setStatus(`No se pudo cargar la vista rapida de ${normalized}.`);
    } finally {
      setSearchLoading(false);
    }
  }
  function resetSearchScopeState() {
    setSearchCandidates([]);
    setSearchResult(null);
    setSearchError("");
  }
  function clearSearch() {
    setSearchSymbol("");
    setSearchCandidates([]);
    setSearchResult(null);
    setSearchError("");
    setSearchLoading(false);
    setStatus("Buscador limpio.");
  }
  function updateSearchSymbol(value) {
    setSearchSymbol(value);
    if (!String(value || "").trim()) {
      setSearchCandidates([]);
      setSearchResult(null);
      setSearchError("");
    }
  }
  async function applySearchScope(item) {
    if (!item) return;
    if (item.type === "stock") {
      setSearchSymbol(item.value);
      loadSearchResult(item.value, { symbol: item.value, name: item.name || item.label });
      return;
    }
    resetSearchScopeState();
    if (item.type === "country") {
      setViewLayers((prev) => ({ ...prev, country: true, theme: true, sector: true, industry: true }));
      setCountryFilter(item.value);
      setThemeFilter("Todos");
      setSectorFilter("Todos");
      setIndustryFilter("Todos");
      const hasCountryRows = rows.some((row) => (row.country || countryCode(row.symbol)) === item.value);
      if (!hasCountryRows) {
        setMarkets([item.value]);
        setUniverse([]);
        setUniverseScope("");
        clear();
        setStatus(`Cargando universo de ${marketName(item.value)}...`);
        await loadUniverse([item.value]);
      } else {
        setStatus(`Vista por pais: ${marketName(item.value)}.`);
      }
      return;
    }
    if (item.type === "theme") {
      setViewLayers((prev) => ({ ...prev, theme: true, sector: true, industry: true }));
      setCountryFilter("Todos");
      setThemeFilter(item.value);
      setSectorFilter("Todos");
      setIndustryFilter("Todos");
      setStatus(`Vista por tematica: ${item.value}.`);
      return;
    }
    if (item.type === "sector") {
      setViewLayers((prev) => ({ ...prev, sector: true, theme: true, industry: true }));
      setCountryFilter("Todos");
      setThemeFilter("Todos");
      setSectorFilter(item.value);
      setIndustryFilter("Todos");
      setStatus(`Vista por sector: ${item.value}.`);
      return;
    }
    if (item.type === "industry") {
      setViewLayers((prev) => ({ ...prev, industry: true, theme: true, sector: true }));
      setCountryFilter("Todos");
      setThemeFilter("Todos");
      setSectorFilter("Todos");
      setIndustryFilter(item.value);
      setStatus(`Vista por subsector: ${item.value}.`);
    }
  }
  async function runSearch(event) {
    event?.preventDefault?.();
    const query = searchSymbol.trim();
    if (!query) {
      clearSearch();
      return;
    }
    const tickerish = /^[A-Z0-9.^=-]{1,18}$/i.test(query) && !/\s/.test(query);
    setSearchLoading(true);
    setSearchError("");
    try {
      const data = await getJson(`/api/search?q=${encodeURIComponent(query)}`).catch(() => ({ results: [] }));
      const candidates = data.results || [];
      setSearchCandidates(candidates);
      const upper = query.toUpperCase();
      const exact = candidates.find((item) => item.symbol === upper);
      const picked = exact || candidates[0] || (tickerish ? { symbol: upper, name: upper } : null);
      if (!picked) {
        if (searchScopeItems.length) {
          await applySearchScope(searchScopeItems[0]);
          return;
        }
        setSearchResult(null);
        setSearchError("No encontre candidatos. Prueba con nombre, ticker, sector, subsector, pais o sufijo de mercado.");
        setStatus(`Sin coincidencias para ${query}.`);
        return;
      }
      await loadSearchResult(picked.symbol, picked);
      if (!exact && candidates.length > 1) setStatus(`Cargado ${picked.symbol}. Hay ${candidates.length} coincidencias; puedes elegir otra debajo del buscador.`);
    } catch (e) {
      setSearchResult(null);
      setSearchError(e.message || "Proveedor no disponible");
      setStatus(`No se pudo buscar ${query}.`);
    } finally {
      setSearchLoading(false);
    }
  }
  async function loadCachedScreenerPreview(set = activeSettings) {
    try {
      const params = cachedScreenerQuery(set, markets);
      const data = await getJson(`/api/leaderboards?${params.toString()}`);
      const marketSet = new Set(markets);
      const items = data.leaderboard?.items || [];
      const cachedRows = items
        .map(cachedScreenerRow)
        .filter((row) => row.symbol && (!marketSet.size || marketSet.has(row.country || countryCode(row.symbol))));
      return {
        rows: cachedRows,
        generatedAt: data.leaderboard?.generatedAt || "",
        configured: data.configured !== false,
      };
    } catch {
      return { rows: [], generatedAt: "", configured: false };
    }
  }
  function setPreset(k) {
    setPresetKey(k);
    setSettings(settingsForPreset(k));
    setSort(PRESETS[k].v.setupMode === "weakness" ? "weaknessScore" : "totalScore");
    setFieldRules(DEFAULT_FIELD_RULES);
    setFilterLayers(filterLayersForPreset(k));
    setUseRegimeFilter(true);
    setSelectedFilterTemplateId("");
    setFilterTemplateName("");
    clear();
    setStatus(`Filtro activo: ${PRESETS[k].name}. Capas del preset aplicadas. Pulsa Ejecutar.`);
  }
  async function loadUniverse(marketsOverride = null, options = {}) {
    const preserveResults = Boolean(options.preserveResults);
    setErr("");
    setFail([]);
    if (!preserveResults) {
      setRows([]);
      setDiagnostics(null);
      setResultPage(1);
    }
    setPendingResults(null);
    setStatus(preserveResults ? "Actualizando universo en segundo plano..." : "Descargando universos completos...");
    try {
      const targetMarkets = Array.isArray(marketsOverride) && marketsOverride.length ? marketsOverride : markets;
      const d = await getJson(`/api/universe?markets=${encodeURIComponent(targetMarkets.join(","))}`);
      const all = d.universe || [];
      const man = manualUniverseRows(manual);
      const ipoRadar = ipoRadarUniverseRows();
      const u = Array.from(new Map([...all, ...man, ...ipoRadar].map((x) => [x.symbol, x])).values());
      setUniverse(u);
      setUniverseScope(universeScopeKey(targetMarkets, manual));
      const marketLabel = targetMarkets.length === 1 ? ` · ${marketName(targetMarkets[0])}` : "";
      const scopeLabel = scanMode === "all" ? "todo el universo" : `lote de ${scanBatchSize}`;
      setStatus(`Universo cargado${marketLabel}: ${u.length} tickers${ipoRadar.length ? ` · IPO Radar ${ipoRadar.length}` : ""}. Filtro: ${PRESETS[presetKey].name}. Alcance inicial: ${scopeLabel}.`);
      return u;
    } catch (e) {
      setErr(e.message);
      setStatus("Proveedor no disponible al cargar universo");
      return [];
    }
  }
  function selected(u) {
    const list = [...u];
    if (scanMode === "random") return shuffle(list).slice(0, scanBatchSize);
    const spread = spreadByInitial(list);
    const start = Math.max(0, Math.min(batchStart, Math.max(0, spread.length - 1)));
    if (scanMode === "all") return spread;
    return spread.slice(start, start + scanBatchSize);
  }
  async function run() {
    const scanStartedAt = perfNow();
    const hadVisibleRows = rows.length > 0;
    scanAbortRef.current = false;
    setRunning(true);
    setPendingResults(null);
    setAnalyzedRows([]);
    setScanContext(null);
    setScanPerf(null);
    fastFilterSignatureRef.current = "";
    setFail([]);
    setErr("");
    if (!hadVisibleRows) {
      setRows([]);
      setDiagnostics(null);
      setResultPage(1);
    } else {
      setStatus("Actualizando en segundo plano. La tabla visible se mantiene hasta que confirmes los nuevos resultados.");
    }
    try {
      const mh = marketHealth || (useRegimeFilter ? await loadMarketHealth() : null);
      const currentUniverseScope = universeScopeKey(markets, manual);
      const base = universe.length && universeScope === currentUniverseScope ? universe : await loadUniverse(null, { preserveResults: hadVisibleRows });
      setStatus("Preparando cache...");
      // Los benchmarks los carga el servidor en /api/scan; aquí solo hace falta la preview cacheada.
      const cachePreview = await loadCachedScreenerPreview(activeSettings);
      const symbols = selected(base);
      const fullUniverseScan = scanMode === "all";
      let stableResultsPublished = hadVisibleRows;
      if (cachePreview.rows.length) {
        stableResultsPublished = true;
        if (hadVisibleRows) {
          setPendingResults({
            rows: cachePreview.rows,
            diagnostics,
            completed: 0,
            total: symbols.length,
            done: false,
            updatedAt: new Date().toISOString(),
          });
          setStatus(`Cache precalculada lista (${cachePreview.rows.length}). La tabla visible queda congelada mientras se refina el scan actual.`);
        } else {
          setRows(cachePreview.rows);
          setStatus(`Cache: ${cachePreview.rows.length} resultados precalculados. Refinando con scan actual.`);
        }
      } else if (fullUniverseScan) {
        setStatus(hadVisibleRows
          ? `Escaneando todo el universo: ${symbols.length}/${base.length} acciones. Tabla visible congelada.`
          : `Escaneando todo el universo: ${symbols.length}/${base.length} acciones. Puedes detenerlo si tarda demasiado.`);
      }
      let rawRows = [], bad = [];
      let completed = 0;
      let lastPartialAt = 0;
      const partialContext = () => ({ marketHealth: mh, useRegimeFilter, symbolsCount: symbols.length, baseCount: base.length, providerErrors: bad });
      const publishPartial = (force = false, currentSymbol = "") => {
        const now = perfNow();
        if (!force && completed % FULL_SCAN_PARTIAL_EVERY !== 0 && now - lastPartialAt < 800) return;
        lastPartialAt = now;
        const partialView = filterAnalyzedRows(rawRows, activeSettings, partialContext());
        const payload = {
          rows: partialView.rows,
          diagnostics: partialView.diagnostics,
          completed,
          total: symbols.length,
          done: false,
          updatedAt: new Date().toISOString(),
        };
        if (!stableResultsPublished && (partialView.rows.length || force)) {
          stableResultsPublished = true;
          setRows(partialView.rows);
          setDiagnostics(partialView.diagnostics);
          setPendingResults(null);
        } else if (stableResultsPublished) {
          setPendingResults(payload);
        } else {
          setDiagnostics(partialView.diagnostics);
        }
        const verb = scanAbortRef.current ? "Deteniendo" : "Analizando";
        const frozenNote = stableResultsPublished ? " · tabla estable" : "";
        setStatus(`${verb} ${completed}/${symbols.length}${currentSymbol ? `: ${currentSymbol}` : ""} · pasan ${partialView.rows.length} · errores ${bad.length}${frozenNote}`);
      };
      // Scan en servidor: POST /api/scan lanza el proceso (concurrencia 5 en backend,
      // caché de Yahoo compartida) y el cliente hace polling cada 2s recogiendo los
      // resultados incrementales de scan_results. La UI de progreso se conserva.
      const symbolList = symbols.map((item) => item?.symbol || item).filter(Boolean);
      const launched = await postJson("/api/scan", {
        symbols: symbolList,
        name: `Scan servidor ${new Date().toISOString()}`,
        preset: presetKey,
        settings: activeSettings,
      });
      if (!launched?.scanId) throw new Error(launched?.error || "No se pudo lanzar el scan en servidor");
      serverScanIdRef.current = launched.scanId;
      let serverStatus = "running";
      let serverError = "";
      let resultOffset = 0;
      while (!scanAbortRef.current) {
        let state = null;
        try {
          state = await getJson(`/api/scan?id=${encodeURIComponent(launched.scanId)}&offset=${resultOffset}`);
        } catch {
          await sleep(SERVER_SCAN_POLL_MS);
          continue;
        }
        const newRows = Array.isArray(state.rows) ? state.rows : [];
        for (const row of newRows) {
          rawRows.push({ ...row, qualityGate: qualityGateForResearchRow(row, activeSettings) });
        }
        resultOffset = Number.isFinite(state.nextOffset) ? state.nextOffset : resultOffset + newRows.length;
        if (Array.isArray(state.progress?.errors)) bad = state.progress.errors;
        if (Number.isFinite(state.progress?.completed)) completed = state.progress.completed;
        serverStatus = state.status || "running";
        serverError = state.progress?.error || "";
        publishPartial(true, state.progress?.currentSymbol || "");
        if (isTerminalScanStatus(serverStatus)) break;
        await sleep(SERVER_SCAN_POLL_MS);
      }
      if (serverStatus === "error" && !rawRows.length) throw new Error(serverError || "El scan en servidor falló");
      publishPartial(true);
      const filterContext = { marketHealth: mh, useRegimeFilter, symbolsCount: completed, baseCount: base.length, providerErrors: bad };
      const filteredView = filterAnalyzedRows(rawRows, activeSettings, filterContext);
      const final = filteredView.rows;
      const fullScanMs = perfNow() - scanStartedAt;
      const aborted = scanAbortRef.current;
      const nextScanContext = {
        id: uid(),
        symbolsCount: completed,
        baseCount: base.length,
        providerErrors: bad,
        scannedAt: new Date().toISOString(),
        aborted,
      };
      fastFilterSignatureRef.current = fastFilterSignature(rawRows, activeSettings, { ...nextScanContext, marketHealth: mh, useRegimeFilter });
      setAnalyzedRows(rawRows);
      setScanContext(nextScanContext);
      setScanPerf({
        fullScanMs,
        lastFilterMs: filteredView.filterMs,
        lastFastFilterMs: null,
        estimatedSavedMs: null,
        analyzedRows: rawRows.length,
        scannedSymbols: completed,
        fastRefilters: 0,
      });
      if (stableResultsPublished) {
        setPendingResults({
          rows: final,
          diagnostics: filteredView.diagnostics,
          completed,
          total: symbols.length,
          done: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        setRows(final);
        setDiagnostics(filteredView.diagnostics);
      }
      setFail(bad);
      const samplePct = base.length ? (completed / base.length) * 100 : 100;
      const cancelled = aborted || serverStatus === "cancelled";
      const finishLabel = cancelled ? `Cancelado · ${rawRows.length} filas conservadas` : "Completado";
      const stableNote = stableResultsPublished ? " · resultados nuevos listos para mostrar" : "";
      setStatus(`${finishLabel}: ${final.length} pasan ${PRESETS[presetKey].name} · muestra ${completed}/${base.length} (${samplePct < 10 ? samplePct.toFixed(1) : samplePct.toFixed(0)}%) · RS calculado sobre ${filteredView.sectorized.length} acciones con datos · ${setupModeLabel(activeSettings.setupMode)} · ${activeLayerLabel}. Scan ${secondsLabel(fullScanMs)} · filtro ${secondsLabel(filteredView.filterMs)}${stableNote}.`);
    } catch (e) {
      setErr(e.message);
      setStatus("Error");
    } finally {
      setRunning(false);
      scanAbortRef.current = false;
      serverScanIdRef.current = "";
    }
  }
  function stopScan() {
    scanAbortRef.current = true;
    // Cancelación real en servidor: el runner relee el flag por lote, persiste lo
    // pendiente y marca el scan como cancelled; aquí solo cortamos el polling.
    if (serverScanIdRef.current) {
      postJson("/api/scan/cancel", { scanId: serverScanIdRef.current }).catch(() => {});
    }
    setStatus("Cancelando scan en servidor... se conservara lo ya analizado.");
  }
  function nextBatch() {
    const total = universe.length || 1;
    if (scanMode === "all") {
      setBatchStart(0);
      setStatus("Modo Todo el universo seleccionado: Ejecutar analizara todos los tickers cargados.");
      return;
    }
    const step = scanBatchSize;
    let n = batchStart + step;
    if (n >= total) n = 0;
    setBatchStart(n);
    setStatus(`Lote seleccionado: ${n + 1}-${Math.min(n + step, total)} de ${total}`);
  }
  function marketPreset(t) {
    setBatchStart(0);
    setMarketsAndInvalidate(marketPresetMarkets(t), "Preset cambiado.");
  }
  function marketPresetMarkets(t) {
    if (t === "us") return ["US"];
    if (t === "europe") return EUROPE;
    if (t === "asia") return ASIA;
    if (t === "hk") return ["HK"];
    return DEFAULT_MARKETS;
  }
  function isMarketPresetActive(t) {
    const next = marketPresetMarkets(t);
    return markets.length === next.length && next.every((code) => markets.includes(code));
  }
  function addFavorite(row) {
    const favs = safeRead(STORAGE_KEYS.favorites, []);
    if (favs.some((f) => f.symbol === row.symbol)) {
      setStatus(`${row.symbol} ya estaba en favoritos.`);
      return;
    }
    const favorite = createFavoriteFromRow(row, { source: "screener", marketHealth });
    const next = [favorite, ...favs].slice(0, 250);
    safeWrite(STORAGE_KEYS.favorites, next);
    setFavoriteSymbols(new Set(next.map((x) => x.symbol)));
    setStatus(`${row.symbol} guardado en favoritos locales. Sincronizando Supabase...`);
    syncFavoriteToCloud(favorite).then((result) => {
      if (result.configured === false) setStatus(`${row.symbol} guardado localmente. Supabase no configurado.`);
      else if (result.ok) setStatus(`${row.symbol} guardado en favoritos y Supabase.`);
      else setStatus(`${row.symbol} guardado localmente. Supabase: ${result.message}`);
    });
  }
  function saveSnapshot(currentRows) {
    if (running) {
      setStatus("Espera a que termine el scan antes de guardar el snapshot.");
      return;
    }
    if (!currentRows.length) {
      setStatus("Sin filas actuales para guardar snapshot.");
      return;
    }
    const scans = safeRead(STORAGE_KEYS.scans, []);
    const compatibilityContext = {
      preset: presetKey,
      settings,
      activeSettings,
      filterLayers: { ...filterLayers, marketRegime: useRegimeFilter },
      fieldRules,
      markets,
      scanMode,
    };
    const compatibilityKey = snapshotCompatibilityKey(compatibilityContext);
    const previousScan = findCompatiblePreviousScan(scans, compatibilityContext);
    const enrichedRows = enrichRowsWithMethodology(currentRows, previousScan?.rows || []);
    const methodologySummary = summarizeMethodology(enrichedRows, previousScan);
    const eventTotal = Object.values(methodologySummary.eventCounts || {}).reduce((sum, value) => sum + value, 0);
    const scan = {
      id: uid(),
      createdAt: new Date().toISOString(),
      name: `${PRESETS[presetKey].name} · ${enrichedRows.length} acciones · ${new Date().toLocaleString()}`,
      preset: presetKey,
      settings,
      activeSettings,
      filterLayers,
      fieldRules,
      viewLayers,
      useRegimeFilter,
      rowsAreFilteredSnapshot: true,
      marketScore: marketHealth?.marketScore ?? null,
      marketRegime: marketHealth?.regime?.label || "sin dato",
      snapshotCompatibilityKey: compatibilityKey,
      comparison: {
        compatiblePrevious: Boolean(previousScan),
        previousScanId: previousScan?.id || null,
        previousScanDate: previousScan?.createdAt || null,
      },
      methodologySummary,
      rows: enrichedRows,
    };
    safeWrite(STORAGE_KEYS.scans, [scan, ...scans].slice(0, 50));
    const generatedAlerts = alertsFromScan(scan);
    const nextAlerts = mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), generatedAlerts).slice(0, 500);
    safeWrite(STORAGE_KEYS.alerts, nextAlerts);
    setStatus(`Snapshot guardado localmente: ${enrichedRows.length} acciones · ${eventTotal} eventos · ${generatedAlerts.length} alertas. Sincronizando Supabase...`);
    syncScanToCloud(scan).then((result) => {
      if (result.configured === false) setStatus(`Snapshot guardado localmente: ${enrichedRows.length} acciones · ${generatedAlerts.length} alertas. Supabase no configurado.`);
      else if (result.ok) setStatus(`Snapshot guardado: ${enrichedRows.length} acciones · ${generatedAlerts.length} alertas. Disponible en local y Supabase.`);
      else setStatus(`Snapshot local guardado. Supabase: ${result.message}`);
    });
    syncAlertsToCloud(generatedAlerts).then((result) => {
      if (result.configured !== false && !result.ok) setStatus(`Snapshot guardado. Alertas solo locales: ${result.message}`);
      else if (result.ok && result.data?.alerts?.length) safeWrite(STORAGE_KEYS.alerts, mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), result.data.alerts).slice(0, 500));
    });
  }
  function openReview(currentRows, startSymbol = "") {
    const reviewRows = Array.isArray(currentRows) ? currentRows.filter(Boolean) : [];
    if (!reviewRows.length) {
      setStatus("Sin filas actuales para abrir vista rapida.");
      return;
    }
    const currentIndex = Math.max(0, reviewRows.findIndex((row) => row.symbol === startSymbol));
    setQuickReviewRows(reviewRows);
    setQuickReviewIndex(currentIndex);
    setActiveModalRow(reviewRows[currentIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: "current",
      rows: reviewRows,
      currentIndex,
      contractContext: buildScreenerStockOpenContext(reviewRows[currentIndex], { rank: currentIndex + 1, queueSize: reviewRows.length, sourceLabel: "Revisión Screener" }),
      reviewedSymbols: [],
      hiddenSymbols: [],
      selectedSymbol: startSymbol || reviewRows[0]?.symbol || "",
      updatedAt: new Date().toISOString(),
    });
    setStatus(`Vista rapida: ${reviewRows.length} acciones en cola.`);
  }
  function selectQuickReview(index, list = quickReviewRows) {
    if (!list.length) return;
    const nextIndex = ((index % list.length) + list.length) % list.length;
    setQuickReviewIndex(nextIndex);
    setActiveModalRow(list[nextIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: "current",
      rows: list,
      currentIndex: nextIndex,
      contractContext: buildScreenerStockOpenContext(list[nextIndex], { rank: nextIndex + 1, queueSize: list.length, sourceLabel: "Revisión Screener" }),
      reviewedSymbols: [],
      hiddenSymbols: [],
      selectedSymbol: list[nextIndex]?.symbol || "",
      updatedAt: new Date().toISOString(),
    });
  }
  function moveQuickReview(delta) {
    selectQuickReview(quickReviewIndex + delta);
  }
  function closeQuickReview() {
    setActiveModalRow(null);
  }
  function csv(filteredRows) {
    const h = ["Rank", "Ticker", "Empresa", "Actividad ES", "Tema", "Pais", "Sector", "Industria", "IPO", "IPO Date", "IPO Age Months", "Benchmark", "Last Price Date", "Price Freshness Days", "Price Freshness Label", "Price Freshness Issue", "Data Coverage", "Technical Coverage", "Fundamental Coverage", "Data Issues", "RS Benchmark", "RS", "RS Pais", "RS Grupo", "RS Quality", "RS Stability", "Speculation Risk", "RS Quality Label", "Weakness Score", "Weakness Label", "Weakness Reasons", "RS Sample", "RS Pais Sample", "RS Grupo Sample", "RS 3M", "RS 6M", "RS 12M", "Dist 20d", "Dist 50d", "Dist 52w", "Dist ATH", "Highs Spread", "3M", "6M", "12M", "SMA50", "Avg Volume 20d", "Latest Volume", "Avg Turnover 20d", "Latest Turnover", "UD Vol", "Rel Volume", "Volume Surge %", "Volume Effect Score", "A/D Proxy", "EPS/Growth Proxy", "Volume Evidence", "Short Float %", "Short Ratio", "Shares Short", "Float Shares", "Up Volume", "Max Daily Move 20d", "Max Daily Range 20d", "Avg Daily Range 20d", "Price Range 63d", "Volatility 63d", "Downside Vol 63d", "Max Drawdown 63d", "Return/Vol 3M", "Return/Drawdown 3M", "Risk/Reward Score", "Weinstein", "Minervini", "Momentum", "Risk", "Volume", "Liquidity", "Sector Score", "Setup Quality", "Demand", "Growth", "IPO Score", "Composite", "Legacy Total", "Composite Label", "Reasons", "Risks"];
    const lines = filteredRows.map((r, i) => [i + 1, r.symbol, r.companyName, r.businessEs, r.theme, r.country, r.sector, r.industry, r.ipoCategory, r.ipoDate, r.ipoAgeMonths, r.benchmarkSymbol, r.lastDate, r.priceFreshnessDays, r.priceFreshnessLabel, r.priceFreshnessIssue, r.dataCoverageScore, r.technicalCoverageScore, r.fundamentalCoverageScore, (r.dataCoverageIssues || []).join(" | "), r.rsRating, r.rsGlobalPct, r.rsCountryPct, r.rsSectorPct, r.rsQualityScore, r.rsStabilityScore, r.speculationRiskScore, r.rsQualityLabel, r.weaknessScore, r.weaknessLabel, (r.weaknessReasons || []).join(" | "), r.rsGlobalSample, r.rsCountrySample, r.rsSectorSample, r.rs3m, r.rs6m, r.rs12m, r.distance20d, r.distance50d, r.distance52w, r.distanceATH, r.highsSpreadPct, r.perf3m, r.perf6m, r.perf12m, r.extSma50, r.avgVolume, r.latestVolume, r.avgTurnover, r.latestTurnover, r.upDownVolRatio, r.relativeVolume, r.volumeSurgePct, r.volumeEffectScore, r.adProxyScore, r.epsGrowthProxyScore, r.volumeEvidence, r.shortPercentOfFloat, r.shortRatio, r.sharesShort, r.floatShares, r.upVolume, r.maxDailyMove20dPct, r.maxDailyRange20dPct, r.avgDailyRange20dPct, r.range63dPct, r.volatility63d, r.downsideVolatility63d, r.maxDrawdown63d, r.returnToVol3m, r.returnToDrawdown3m, r.riskRewardScore, r.weinsteinScore, r.minerviniScore, r.momentumScore, r.riskScore, r.volumeScore, r.liquidityScore, r.sectorScore, r.setupQualityScore, r.demandScore, r.growthScore, r.ipoScore, r.totalScore, r.legacyTotalScore, r.compositeLabel, (r.compositeReasons || []).join(" | "), (r.compositeRisks || []).join(" | ")].map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","));
    const blob = new Blob([[h.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "stageradar-screener.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const viewFilterState = { viewLayers, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo };
  const filtered = useMemo(() => {
    const list = applyResultViewFilters(rows, viewFilterState);
    return [...list].sort((a, b) => sortMetric(b, sort) - sortMetric(a, sort));
  }, [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, sort, viewLayers]);
  const pendingFilteredCount = useMemo(() => {
    if (!pendingResults) return 0;
    return applyResultViewFilters(pendingResults.rows || [], viewFilterState).length;
  }, [pendingResults, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, viewLayers]);
  const totalResultPages = Math.max(1, Math.ceil(filtered.length / resultPageSize));
  const visibleResultPage = Math.min(resultPage, totalResultPages);
  const resultPageStart = (visibleResultPage - 1) * resultPageSize;
  const resultPageEnd = Math.min(resultPageStart + resultPageSize, filtered.length);
  const pagedRows = filtered.slice(resultPageStart, resultPageEnd);
  const setResultPageClamped = (page) => setResultPage(Math.max(1, Math.min(page, totalResultPages)));
  function updateResultPageSize(size) {
    const nextSize = RESULT_PAGE_SIZES.includes(size) ? size : DEFAULT_RESULT_PAGE_SIZE;
    setResultPageSize(nextSize);
    setResultPage(1);
  }
  const opportunities = useMemo(() => opportunityBuckets(filtered), [filtered]);
  useEffect(() => {
    setResultPage(1);
  }, [countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, sort, resultPageSize]);
  useEffect(() => {
    if (resultPage > totalResultPages) setResultPage(totalResultPages);
  }, [resultPage, totalResultPages]);
  useEffect(() => {
    if (!filtered.length) {
      if (activePreviewRow) setActivePreviewRow(null);
      return;
    }
    if (!activePreviewRow || !filtered.some((r) => r.symbol === activePreviewRow.symbol)) {
      setActivePreviewRow(filtered[0]);
    }
  }, [filtered, activePreviewRow]);
  const cleanOption = (value, emptyLabel) => value && value !== emptyLabel ? value : "";
  const countByOption = (list, picker) => {
    const counts = new Map();
    list.forEach((row) => {
      const value = picker(row);
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return counts;
  };
  const optionLabel = (prefix, value, counts, formatter = (item) => item) => {
    if (value === "Todos") return `${prefix}: Todos`;
    const count = counts?.get(value) || 0;
    return `${formatter(value)}${count ? ` (${count})` : ""}`;
  };
  const countryCounts = useMemo(() => countByOption(rows, (r) => r.country || countryCode(r.symbol)), [rows]);
  const themeCounts = useMemo(() => countByOption(rows, (r) => cleanOption(r.theme, "General")), [rows]);
  const sectorCounts = useMemo(() => countByOption(rows.filter((r) => themeFilter === "Todos" || r.theme === themeFilter), (r) => cleanOption(r.sector, "Sin sector")), [rows, themeFilter]);
  const industryCounts = useMemo(() => countByOption(rows.filter((r) => themeFilter === "Todos" || r.theme === themeFilter).filter((r) => sectorFilter === "Todos" || r.sector === sectorFilter), (r) => cleanOption(r.industry, "Sin industria")), [rows, themeFilter, sectorFilter]);
  const sectorStrengthCounts = useMemo(() => {
    const counts = new Map(SECTOR_STRENGTH_OPTIONS.map((key) => [key, 0]));
    rows.forEach((row) => {
      SECTOR_STRENGTH_OPTIONS.slice(1).forEach((key) => {
        if (passesSectorStrength(row, key)) counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    counts.set("Todos", rows.length);
    return counts;
  }, [rows]);
  const themeOptions = useMemo(() => ["Todos", ...Array.from(new Set(rows.map((r) => cleanOption(r.theme, "General")).filter(Boolean))).sort()], [rows]);
  const sectorOptions = useMemo(() => ["Todos", ...Array.from(new Set(rows
    .filter((r) => themeFilter === "Todos" || r.theme === themeFilter)
    .map((r) => cleanOption(r.sector, "Sin sector"))
    .filter(Boolean))).sort()], [rows, themeFilter]);
  const industryOptions = useMemo(() => ["Todos", ...Array.from(new Set(rows
    .filter((r) => themeFilter === "Todos" || r.theme === themeFilter)
    .filter((r) => sectorFilter === "Todos" || r.sector === sectorFilter)
    .map((r) => cleanOption(r.industry, "Sin industria"))
    .filter(Boolean))).sort()], [rows, themeFilter, sectorFilter]);
  const countryOptions = useMemo(() => {
    const codes = Array.from(new Set(rows.map((r) => r.country || countryCode(r.symbol)).filter(Boolean)));
    codes.sort((a, b) => {
      const ai = MARKET_ORDER.indexOf(a), bi = MARKET_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return marketName(a).localeCompare(marketName(b));
    });
    return ["Todos", ...codes];
  }, [rows]);
  const searchScopeItems = useMemo(() => {
    const q = searchText(searchSymbol);
    if (q.length < 2) return [];
    const score = (text = "") => {
      const value = searchText(text);
      if (!value) return 0;
      if (value === q) return 120;
      if (value.startsWith(q)) return 90;
      if (value.includes(q)) return 55;
      return 0;
    };
    const byField = (field) => {
      const map = new Map();
      rows.forEach((row) => {
        const value = row[field];
        if (!value || value === "General" || value === "Sin sector" || value === "Sin industria") return;
        const bucket = map.get(value) || { value, count: 0, top: null };
        bucket.count += 1;
        if (!bucket.top || (row.totalScore || 0) > (bucket.top.totalScore || 0)) bucket.top = row;
        map.set(value, bucket);
      });
      return [...map.values()];
    };
    const countryCounts = new Map();
    rows.forEach((row) => {
      const code = row.country || countryCode(row.symbol);
      countryCounts.set(code, (countryCounts.get(code) || 0) + 1);
    });
    const items = [];
    MARKETS.forEach(([code, name]) => {
      const haystack = `${code} ${name} ${MARKET_META[code]?.exchange || ""} ${MARKET_META[code]?.region || ""}`;
      const s = score(haystack);
      if (!s) return;
      const count = countryCounts.get(code) || 0;
      items.push({
        type: "country",
        value: code,
        label: name,
        icon: marketFlag(code),
        detail: count ? `${count} acciones analizadas` : `${MARKET_META[code]?.exchange || "mercado"} · cargar universo`,
        score: s + (count ? 8 : 0),
      });
    });
    const groups = [
      ["theme", "theme", "Tema", "Tema"],
      ["sector", "sector", "Sector", "Sector"],
      ["industry", "industry", "Subsector", "Sub"],
    ];
    groups.forEach(([type, field, detailLabel, icon]) => {
      byField(field).forEach((bucket) => {
        const s = score(`${bucket.value} ${detailLabel}`);
        if (!s) return;
        items.push({
          type,
          value: bucket.value,
          label: bucket.value,
          icon,
          detail: `${detailLabel} · ${bucket.count} resultados${bucket.top?.symbol ? ` · lider ${bucket.top.symbol}` : ""}`,
          score: s + Math.min(bucket.count, 20),
        });
      });
    });
    rows.slice(0, 500).forEach((row) => {
      const s = score(`${row.symbol} ${row.companyName || ""} ${row.theme || ""} ${row.sector || ""} ${row.industry || ""}`);
      if (!s) return;
      items.push({
        type: "stock",
        value: row.symbol,
        name: row.companyName,
        label: `${row.symbol} · ${row.companyName || row.symbol}`,
        icon: "Accion",
        detail: [row.country || countryCode(row.symbol), row.theme || row.sector, row.industry].filter(Boolean).join(" · "),
        score: s + 10,
      });
    });
    return items
      .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label))
      .filter((item, index, array) => array.findIndex((other) => other.type === item.type && other.value === item.value) === index)
      .slice(0, 10);
  }, [searchSymbol, rows]);
  const recentIpoRows = useMemo(() => rows.filter((r) => rowPassesListContract(r, "ipo")), [rows]);
  const ipos = useMemo(() => ["Todos", ...Array.from(new Set(recentIpoRows.map(verifiedIpoCategory).filter(Boolean))).sort()], [recentIpoRows]);
  const ipoCounts = useMemo(() => countByOption(recentIpoRows, verifiedIpoCategory), [recentIpoRows]);
  const hiddenByView = Math.max(0, rows.length - filtered.length);
  const screenerContract = useMemo(() => buildScreenerContract({
    settings: activeSettings,
    presetKey,
    presetName: PRESETS[presetKey]?.name || "Personal",
    setupName: setupModeLabel(activeSettings.setupMode),
    filterLayers,
    useRegimeFilter,
    executionRuleActive,
    executionRuleTotal,
    fineRuleActive,
    fineRuleTotal,
    rowsCount: rows.length,
    filteredCount: filtered.length,
    analyzedCount: analyzedRows.length,
    diagnostics,
    pendingCount: pendingResults ? pendingFilteredCount : 0,
    hiddenByView,
    viewFiltersActive,
  }), [activeSettings, presetKey, filterLayers, useRegimeFilter, executionRuleActive, executionRuleTotal, fineRuleActive, fineRuleTotal, rows.length, filtered.length, analyzedRows.length, diagnostics, pendingResults, pendingFilteredCount, hiddenByView, viewFiltersActive]);
  function buildScreenerStockOpenContext(rowOrSymbol = null, extras = {}) {
    const row = rowOrSymbol && typeof rowOrSymbol === "object" ? rowOrSymbol : null;
    const symbol = typeof rowOrSymbol === "string" ? rowOrSymbol : row?.symbol;
    const foundIndex = symbol ? filtered.findIndex((item) => item.symbol === symbol) : -1;
    return buildScreenerStockContext(screenerContract, {
      symbol,
      row,
      rank: Number.isFinite(extras.rank) ? extras.rank : (foundIndex >= 0 ? foundIndex + 1 : null),
      queueSize: Number.isFinite(extras.queueSize) ? extras.queueSize : filtered.length,
      sourceLabel: extras.sourceLabel || "Screener",
      openedAt: extras.openedAt || new Date().toISOString(),
    });
  }
  const resultFilterChips = [
    viewLayers.country && countryFilter !== "Todos" ? { key: "country", label: `País: ${marketName(countryFilter)}`, onClear: () => setCountryFilter("Todos") } : null,
    viewLayers.theme && themeFilter !== "Todos" ? { key: "theme", label: `Tema: ${themeFilter}`, onClear: () => setThemeFilter("Todos") } : null,
    viewLayers.sector && sectorFilter !== "Todos" ? { key: "sector", label: `Sector: ${sectorFilter}`, onClear: () => setSectorFilter("Todos") } : null,
    viewLayers.industry && industryFilter !== "Todos" ? { key: "industry", label: `Subsector: ${industryFilter}`, onClear: () => setIndustryFilter("Todos") } : null,
    viewLayers.sectorStrength && sectorStrength !== "Todos" ? { key: "sectorStrength", label: `Fuerza: ${SECTOR_STRENGTH_LABELS[sectorStrength] || sectorStrength}`, onClear: () => setSectorStrength("Todos") } : null,
    viewLayers.ipo && ipo !== "Todos" ? { key: "ipo", label: `IPO: ${ipo}`, onClear: () => setIpo("Todos") } : null,
  ].filter(Boolean);
  function clearResultViewLayer(key) {
    if (key === "country") setCountryFilter("Todos");
    if (key === "theme") {
      setThemeFilter("Todos");
      setSectorFilter("Todos");
      setIndustryFilter("Todos");
    }
    if (key === "sector") {
      setSectorFilter("Todos");
      setIndustryFilter("Todos");
    }
    if (key === "industry") setIndustryFilter("Todos");
    if (key === "sectorStrength") setSectorStrength("Todos");
    if (key === "ipo") setIpo("Todos");
  }
  const clearResultView = () => {
    setCountryFilter("Todos");
    setThemeFilter("Todos");
    setSectorFilter("Todos");
    setIndustryFilter("Todos");
    setSectorStrength("Todos");
    setIpo("Todos");
  };
  const secSum = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { const x = m.get(r.theme) || { theme: r.theme, count: 0, avg: 0, p3: 0 }; x.count++; x.avg += r.totalScore; x.p3 += r.perf3m || 0; m.set(r.theme, x); });
    return [...m.values()].map((x) => ({ ...x, avg: x.avg / x.count, p3: x.p3 / x.count })).sort((a, b) => b.avg - a.avg);
  }, [rows]);
  const ipoSum = useMemo(() => {
    const m = new Map();
    recentIpoRows.forEach((r) => {
      const category = verifiedIpoCategory(r);
      if (!category) return;
      const x = m.get(category) || { cat: category, count: 0, avg: 0 };
      x.count++;
      x.avg += r.totalScore;
      m.set(category, x);
    });
    return [...m.values()].map((x) => ({ ...x, avg: x.avg / x.count })).sort((a, b) => b.avg - a.avg);
  }, [recentIpoRows]);
  useEffect(() => {
    if (countryFilter !== "Todos" && !countryOptions.includes(countryFilter)) setCountryFilter("Todos");
    if (themeFilter !== "Todos" && !themeOptions.includes(themeFilter)) setThemeFilter("Todos");
    if (sectorFilter !== "Todos" && !sectorOptions.includes(sectorFilter)) setSectorFilter("Todos");
    if (industryFilter !== "Todos" && !industryOptions.includes(industryFilter)) setIndustryFilter("Todos");
    if (ipo !== "Todos" && !ipos.includes(ipo)) setIpo("Todos");
  }, [countryFilter, countryOptions, themeFilter, themeOptions, sectorFilter, sectorOptions, industryFilter, industryOptions, ipo, ipos]);
  const failSummary = useMemo(() => {
    const map = new Map();
    fail.forEach((item) => {
      const kind = failureKind(item.reason);
      const bucket = map.get(kind.key) || { ...kind, count: 0, examples: [] };
      bucket.count += 1;
      if (bucket.examples.length < 8) bucket.examples.push(item.symbol);
      map.set(kind.key, bucket);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [fail]);
  const analysisSize = universe.length ? selected(universe).length : 0;
  const batchLabel = universe.length ? scanMode === "all" ? `1-${analysisSize} / ${universe.length}` : `${batchStart + 1}-${Math.min(batchStart + scanBatchSize, universe.length)} / ${universe.length}` : "-";
  const modalReviewRows = quickReviewRows.length ? quickReviewRows : (activeModalRow ? [activeModalRow] : []);
  const modalReviewIndex = activeModalRow ? modalReviewRows.findIndex((row) => row.symbol === activeModalRow.symbol) : -1;
  const modalReviewPosition = modalReviewIndex >= 0 ? modalReviewIndex : quickReviewIndex;
  const quickReviewOrigin = useMemo(() => activeModalRow ? buildScreenerStockContext(screenerContract, {
    symbol: activeModalRow.symbol,
    row: activeModalRow,
    rank: modalReviewPosition + 1,
    queueSize: modalReviewRows.length,
    sourceLabel: "Revisión Screener",
  }) : null, [activeModalRow, screenerContract, modalReviewPosition, modalReviewRows.length]);

  useEffect(() => {
    if (!activeModalRow) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeQuickReview();
      if (event.key === "ArrowRight" || event.key === "ArrowDown") moveQuickReview(1);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") moveQuickReview(-1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeModalRow, quickReviewIndex, quickReviewRows]);

  useEffect(() => {
    if (!activeFilterFamily) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setActiveFilterFamily(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFilterFamily]);

  return <main className="page">
    <div className="topbar">
      <h1 className="title">Screener</h1>
      <div className="actions">
        <button className="btn btnMobileOnly" onClick={() => setShowMobileFilters(!showMobileFilters)}>Filtros</button>
        <button className={`btn ${running ? "btnGhost" : "btnPrimary"}`} onClick={() => { if (running) stopScan(); else { setShowMobileFilters(false); run(); } }}>{running ? "Detener" : "Ejecutar"}</button>
      </div>
    </div>
    {err && <div className="error">{err}</div>}
    
    <div className={`dashboardContainer ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}>
      <button
        type="button"
        className="sidebarCollapseBtn"
        onClick={() => setSidebarCollapsed((value) => !value)}
        aria-label={sidebarCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
        aria-expanded={!sidebarCollapsed}
      >
        {sidebarCollapsed ? "Filtros" : "‹"}
      </button>
      <aside className={`sidebar ${showMobileFilters ? "mobileOpen" : ""}`}>
        <div className="mobileSidebarHeader">
          <h2>Filtros</h2>
          <button className={`btn ${running ? "btnGhost" : "btnPrimary"}`} onClick={() => { if (running) stopScan(); else { setShowMobileFilters(false); run(); } }}>{running ? "Detener" : "Aplicar"}</button>
        </div>
        <div className="kpis" style={{ marginBottom: 20 }}>
          <div className="kpi"><b>{kpiUniverseCount}</b><span>universo</span></div>
          <div className="kpi"><b>{rows.length}</b><span>pasan</span></div>
          <div className="kpi"><b>{marketHealth ? Math.round(marketHealth.marketScore) : "-"}</b><span>{marketHealth?.regime?.label || "score"}</span></div>
        </div>
        <FilterTemplatePanel
          presetKey={presetKey}
          savedTemplates={savedFilterTemplates}
          selectedTemplateId={selectedFilterTemplateId}
          templateName={filterTemplateName}
          running={running}
          onPreset={setPreset}
          onApplySaved={applySavedFilterTemplate}
          onTemplateName={setFilterTemplateName}
          onSave={saveCurrentFilterTemplate}
          onDelete={deleteSavedFilterTemplate}
          onSaveCloud={saveFilterConfigToCloud}
          onLoadCloud={loadFilterConfigFromCloud}
        />

        <div className="sidebarGroup marketPanel" style={{ marginBottom: 24 }}>
          <div className="marketPanelHead">
            <span>Mercados</span>
            <em>{markets.length}/{MARKETS.length}</em>
          </div>
          <div className="marketPresetBar">
            {[
              ["global", "Global"],
              ["us", "EE. UU."],
              ["europe", "Europa"],
              ["asia", "Asia"],
              ["hk", "HK"],
            ].map(([key, label]) => <button key={key} className={`btn btnGhost btnSmall ${isMarketPresetActive(key) ? "btnActive" : ""}`} onClick={() => marketPreset(key)}>{label}</button>)}
            <button className="btn btnSmall btnPrimary marketUniverseBtn" onClick={loadUniverse} disabled={running || !markets.length} title="Prepara la lista de tickers de los mercados seleccionados">
              Cargar universo
            </button>
          </div>
          <div className="marketSelector marketGrid">
            {MARKETS.map(([c, n]) => {
              const active = markets.includes(c);
              return <button key={c} className={`marketChip countryMarketChip ${active ? "active" : ""}`} title={`${n} · ${marketExchange(c)}`} aria-pressed={active} onClick={() => {
                const selectedMarkets = active ? markets.filter((x) => x !== c) : [...markets, c];
                const nextMarkets = MARKET_ORDER.filter((code) => selectedMarkets.includes(code));
                setMarketsAndInvalidate(nextMarkets, `Mercados actualizados: ${nextMarkets.length}`);
              }}>
                <span className="marketChipFlag">{marketFlag(c)}</span>
                <span className="marketChipCode">{c}</span>
              </button>;
            })}
          </div>
        </div>

        {/* Configuración avanzada: agrupa capas, umbrales, reglas de campo, alcance de
            lote y diagnóstico. Cerrada por defecto; el colapso persiste en localStorage. */}
        <details className="disclosurePanel advancedConfigPanel" open={advancedOpen} onToggle={(event) => persistAdvancedOpen(event.currentTarget.open)}>
          <summary>
            <span>Configuración avanzada</span>
            <em>{advancedChangeCount > 0 ? `Avanzado · ${advancedChangeCount} ${advancedChangeCount === 1 ? "cambio" : "cambios"}` : "Sin cambios sobre el preset"}</em>
          </summary>

        <FilterArchitecturePanel
          filterLayers={filterLayers}
          viewLayers={viewLayers}
          useRegimeFilter={useRegimeFilter}
          onToggleLayer={toggleFilterLayer}
          onOpenLayer={setActiveFilterFamily}
          onToggleViewLayer={toggleViewLayer}
          onToggleRegime={() => setUseRegimeFilter((prev) => !prev)}
          executionRuleActive={executionRuleActive}
          executionRuleTotal={executionRuleTotal}
          viewFiltersActive={viewFiltersActive}
        />
        <div className="controls filterLayerActions">
          <button className="btn btnSmall btnGhost" onClick={() => { setFilterLayers(filterLayersForPreset(presetKey)); setUseRegimeFilter(true); }}>Base preset</button>
          <button className="btn btnSmall btnGhost" onClick={() => { setFilterLayers(ALL_FILTER_LAYERS); setUseRegimeFilter(true); }}>Todo activo</button>
        </div>

        <div className="sidebarGroup" style={{ marginBottom: 24 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Condiciones</span>
          <div className={`weeklyStageControls ${filterLayers.trend ? "" : "isMuted"}`}>
            <label><span>Media rapida semanal</span><input className="input" type="number" min="2" max="80" step="1" value={settings.stageFastWeeks || 10} onChange={(event) => updateSetting("stageFastWeeks", Number(event.target.value) || 10)} /></label>
            <label><span>Media lenta semanal</span><input className="input" type="number" min="3" max="120" step="1" value={settings.stageSlowWeeks || 30} onChange={(event) => updateSetting("stageSlowWeeks", Number(event.target.value) || 30)} /></label>
            <label><span>Pendiente semanas</span><input className="input" type="number" min="2" max="40" step="1" value={settings.stageSlopeWeeks || 10} onChange={(event) => updateSetting("stageSlopeWeeks", Number(event.target.value) || 10)} /></label>
          </div>
          <div className="filterSwitches">
            <FilterToggle active={settings.requireStage2} applies={settingApplies("requireStage2", filterLayers)} detail={inactiveSettingReason("requireStage2", filterLayers)} onClick={() => toggleLayeredSetting("requireStage2")}>Stage 2</FilterToggle>
            <FilterToggle active={settings.requireUpVolume} applies={settingApplies("requireUpVolume", filterLayers)} detail={inactiveSettingReason("requireUpVolume", filterLayers)} onClick={() => toggleLayeredSetting("requireUpVolume")}>Volumen en vela alcista</FilterToggle>
            <FilterToggle active={settings.requireRecentIpo} applies={settingApplies("requireRecentIpo", filterLayers)} detail={inactiveSettingReason("requireRecentIpo", filterLayers)} onClick={() => toggleLayeredSetting("requireRecentIpo")}>IPO real reciente</FilterToggle>
          </div>
          
          <details className="advancedFiltersDetails" style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: '#a1a1aa', fontSize: 12, fontWeight: 500, display: 'inline-block', borderBottom: '1px dashed rgba(255,255,255,.2)', paddingBottom: 2 }}>Ajustes finos ({fineRuleActive}/{fineRuleTotal})</summary>
            <div className="filterGroups" style={{ marginTop: 16 }}>
              {FILTER_GROUPS.map((group) => {
                const activeInGroup = group.fields.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length;
                return <details className="filterGroup" key={group.title}>
                  <summary className="filterGroupHead"><h3>{group.title}</h3><span>{activeInGroup}/{group.fields.length}</span></summary>
                  <div className="filterFields">{group.fields.map((field) => <FilterNumber key={field.key} field={field} value={settings[field.key]} onChange={updateSetting} active={isFieldRuleActive(field, fieldRules, filterLayers)} inactiveReason={inactiveFieldReason(field, fieldRules, filterLayers)} onToggle={() => toggleFieldRule(field)} />)}</div>
                </details>;
              })}
            </div>
            <div className="controls filterFooter" style={{ marginTop: 12 }}>
              <button className="btn btnGhost btnSmall" style={{ width: "100%" }} onClick={() => { setSettings(settingsForPreset(presetKey)); setFieldRules(DEFAULT_FIELD_RULES); setFilterLayers(filterLayersForPreset(presetKey)); setUseRegimeFilter(true); }}>Resetear condiciones</button>
            </div>
          </details>
        </div>

        <details className="disclosurePanel compactDisclosure" style={{ marginBottom: 20 }}>
          <summary><span>Cobertura y alcance</span></summary>
          <div className="grid" style={{ gap: 8 }}>
            <select className="select" value={scanMode} onChange={(e) => { setScanMode(e.target.value); setBatchStart(0); }}><option value="batch">Por lote</option><option value="random">Aleatorio</option><option value="all">Todo el universo</option></select>
            <select className="select" value={scanBatchSize} onChange={(e) => { setScanBatchSize(Number(e.target.value)); setBatchStart(0); }} aria-label="Tickers por lote">
              {SCAN_BATCH_SIZES.map((size) => <option key={size} value={size}>{size} tickers por lote</option>)}
            </select>
            <input className="input" type="number" value={batchStart} placeholder="Inicio" onChange={(e) => setBatchStart(Number(e.target.value) || 0)} />
            <button className="btn btnGhost" onClick={nextBatch} disabled={running || !universe.length || scanMode === "all"}>Siguiente lote</button>
          </div>
        </details>

        <details className="scanDiagnosticsDisclosure">
          <summary>
            <span>Auditoria de filtros</span>
            <em>{running ? "analizando" : diagnostics ? `${diagnostics.finalCount}/${diagnostics.analyzed} pasan` : "sin scan"}</em>
          </summary>
          <FilterDiagnosticsPanel diagnostics={diagnostics} rowsCount={rows.length} filteredCount={filtered.length} running={running} />
        </details>
        </details>
      </aside>

      <main className="mainContent">
        <section className="searchCard" style={{ marginBottom: 20 }}>
          <div className="commandSearchPanel searchPanelBare">
              <form className="searchBar" onSubmit={runSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input searchInput" value={searchSymbol} onChange={(e) => updateSearchSymbol(e.target.value)} placeholder="Ticker, nombre, sector, subsector o pais..." />
                {(searchSymbol || searchCandidates.length || searchResult) && <button type="button" className="btn btnGhost" onClick={clearSearch}>Limpiar</button>}
                <button className="btn btnPrimary" disabled={searchLoading}>{searchLoading ? "Buscando..." : "Buscar"}</button>
              </form>
              <SearchScopeList items={searchScopeItems} onPick={applySearchScope} />
              {searchError && <div className="dataNote error" style={{ marginTop: 12 }}>{investorStatusLabel(searchError)}</div>}
              {searchResult ? <div className="searchResult searchResultPrimary">
                <PreviewCard row={searchResult} variant="search" onFavorite={addFavorite} onOpenStock={saveSessionBeforeStockOpen} isFavorite={favoriteSymbols.has(searchResult.symbol)} />
              </div> : null}
              <SearchCandidateList candidates={searchCandidates} activeSymbol={searchResult?.symbol} onPick={(item) => { setSearchSymbol(item.symbol); loadSearchResult(item.symbol, item); }} />
          </div>
        </section>

        <section className="mobileResearchHome">
          <MarketMiniTape marketHealth={marketHealth} />
          <SetupChipRail
            rows={filtered}
            presetKey={presetKey}
            setupMode={activeSettings.setupMode}
            sort={sort}
            onPreset={setPreset}
            onMode={(mode) => { updateSetting("setupMode", mode); if (mode === "weakness") setSort("weaknessScore"); }}
            onSort={setSort}
          />
          <PendingResultsBar pending={pendingResults ? { ...pendingResults, filteredCount: pendingFilteredCount } : null} visibleCount={rows.length} filteredCount={filtered.length} onCommit={commitPendingResults} />
          <MobileResultList
            rows={pagedRows}
            settings={activeSettings}
            totalRows={filtered.length}
            sort={sort}
            onSort={setSort}
            onReview={(symbol) => openReview(filtered, symbol)}
            onFavorite={addFavorite}
            favoriteSymbols={favoriteSymbols}
            onSave={() => saveSnapshot(filtered)}
            onCsv={() => csv(filtered)}
            onOpenStock={saveSessionBeforeStockOpen}
            savingDisabled={running}
            page={visibleResultPage}
            pageSize={resultPageSize}
            totalPages={totalResultPages}
            onPage={setResultPageClamped}
            onPageSize={updateResultPageSize}
          />
        </section>

        <section className="desktopResultsSection" style={{ marginBottom: 20 }}>
          <PendingResultsBar pending={pendingResults ? { ...pendingResults, filteredCount: pendingFilteredCount } : null} visibleCount={rows.length} filteredCount={filtered.length} onCommit={commitPendingResults} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, margin: 0, fontWeight: 600, letterSpacing: 0 }}>{filtered.length} resultados</h2>
            <div className="controls">
              {(rows.length > 0 || pendingResults?.rows?.length || diagnostics) ? <button className="btn btnSmall btnGhost" onClick={resetScreenerSession}>Reset sesión</button> : null}
              {filtered.length ? <>
                <button className="btn btnSmall btnGhost" onClick={() => csv(filtered)}>↓ CSV</button>
                <button className="btn btnSmall btnPrimary" onClick={() => openReview(filtered)}>Revisar</button>
                <button className="btn btnSmall" onClick={() => saveSnapshot(filtered)} disabled={running} aria-label="Guardar snapshot de resultados">Guardar</button>
              </> : null}
            </div>
          </div>
          <div className="controls resultFilterBar" style={{ marginBottom: 12 }}>
            {viewLayers.country ? <select className="select resultFilterSelect" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Filtrar por pais">
              {countryOptions.map((x) => <option key={x} value={x}>{optionLabel("País", x, countryCounts, (code) => `${code} · ${marketName(code)}`)}</option>)}
            </select> : null}
            {viewLayers.theme ? <select className="select resultFilterSelect" value={themeFilter} onChange={(e) => { setThemeFilter(e.target.value); setSectorFilter("Todos"); setIndustryFilter("Todos"); }} aria-label="Filtrar por tema">
              {themeOptions.map((x) => <option key={x} value={x}>{optionLabel("Tema", x, themeCounts)}</option>)}
            </select> : null}
            {viewLayers.sector ? <select className="select resultFilterSelect" value={sectorFilter} onChange={(e) => { setSectorFilter(e.target.value); setIndustryFilter("Todos"); }} aria-label="Filtrar por sector">
              {sectorOptions.map((x) => <option key={x} value={x}>{optionLabel("Sector", x, sectorCounts)}</option>)}
            </select> : null}
            {viewLayers.industry ? <select className="select resultFilterSelect" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} aria-label="Filtrar por subsector">
              {industryOptions.map((x) => <option key={x} value={x}>{optionLabel("Subsector", x, industryCounts)}</option>)}
            </select> : null}
            {viewLayers.sectorStrength ? <select className="select resultFilterSelect" value={sectorStrength} onChange={(e) => setSectorStrength(e.target.value)} aria-label="Filtrar por fuerza de grupo">
              {SECTOR_STRENGTH_OPTIONS.map((x) => <option key={x} value={x}>{optionLabel("Fuerza grupo", x, sectorStrengthCounts, (item) => SECTOR_STRENGTH_LABELS[item] || item)}</option>)}
            </select> : null}
            {viewLayers.ipo ? <select className="select resultFilterSelect" value={ipo} onChange={(e) => setIpo(e.target.value)} aria-label="Filtrar por IPO">
              {ipos.map((x) => <option key={x} value={x}>{optionLabel("IPO", x, ipoCounts)}</option>)}
            </select> : null}
            <select className="select resultFilterSelect resultSortSelect" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar resultados">
              <option value="totalScore">Ordenar: Composite</option>
              <option value="rsGlobalPct">Ordenar: {metricShortLabel("rsGlobalPct")}</option>
              <option value="rsRating">Ordenar: {metricShortLabel("rsRating")}</option>
              <option value="adProxyScore">Ordenar: {metricShortLabel("adProxyScore")}</option>
              <option value="epsGrowthProxyScore">Ordenar: {metricShortLabel("epsGrowthProxyScore")}</option>
              <option value="volumeEffectScore">Ordenar: Volume Effect</option>
              <option value="avgTurnover">Ordenar: Importe 20d</option>
              <option value="shortPercentOfFloat">Ordenar: {metricShortLabel("shortPercentOfFloat")}</option>
              <option value="dataCoverageScore">Ordenar: Cobertura datos</option>
              <option value="weaknessScore">Ordenar: Deterioro</option>
            </select>
          </div>
          <ResultFilterChips chips={resultFilterChips} hiddenCount={hiddenByView} onClearAll={clearResultView} />
          {filtered.length ? <div className="controls" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="fine">
              Mostrando {filtered.length ? resultPageStart + 1 : 0}-{resultPageEnd} de {filtered.length}
            </span>
            <div className="controls">
              <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={resultPageSize} onChange={(e) => updateResultPageSize(Number(e.target.value))} aria-label="Acciones por página">
                {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}
              </select>
              <button className="btn btnSmall btnGhost" onClick={() => setResultPageClamped(visibleResultPage - 1)} disabled={visibleResultPage <= 1}>Anterior</button>
              <span className="fine">Página {visibleResultPage}/{totalResultPages}</span>
              <button className="btn btnSmall btnGhost" onClick={() => setResultPageClamped(visibleResultPage + 1)} disabled={visibleResultPage >= totalResultPages}>Siguiente</button>
            </div>
          </div> : null}
      <CompactResultsTable rows={pagedRows} settings={activeSettings} favoriteSymbols={favoriteSymbols} onFavorite={addFavorite} onReview={(symbol) => openReview(filtered, symbol)} onOpenStock={saveSessionBeforeStockOpen} rankOffset={resultPageStart} />
        </section>
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StageRadar · Datos orientativos · {investorStatusLabel(status)}</footer>

    {activeFilterFamily && <FilterFamilyModal
      layerKey={activeFilterFamily}
      settings={settings}
      filterLayers={filterLayers}
      fieldRules={fieldRules}
      onClose={() => setActiveFilterFamily(null)}
      onToggleLayer={toggleFilterLayer}
      onApplyAction={applyLayerAction}
      onUpdateSetting={updateSetting}
      onToggleFieldRule={toggleFieldRule}
      onToggleLayeredSetting={toggleLayeredSetting}
    />}
    
    {activeModalRow && (
      <dialog className="stockModal quickReviewModal" open onClick={(e) => { if (e.target === e.currentTarget) closeQuickReview(); }}>
        <div className="stockModalInner quickReviewInner">
          <div className="profileHeader quickReviewHeader">
            <div className="profileHeaderLeft quickReviewTitleBlock">
              <CompanyMark row={activeModalRow} size="lg" />
              <div>
                <div className="profileHeaderBreadcrumb">
                  Screener <span>/</span> Vista rapida <span>/</span> {modalReviewPosition + 1} de {modalReviewRows.length}
                </div>
                <div className="profileTitle">
                  <h2>{activeModalRow.symbol}</h2>
                  <span>{activeModalRow.companyName}</span>
                </div>
                <div className="profilePrice">
                  <span className="price">{money(activeModalRow.price, activeModalRow.currency)}</span>
                  {Number.isFinite(activeModalRow.perf3m) && (
                    <span className={`change ${activeModalRow.perf3m >= 0 ? "up" : "down"}`}>
                      {activeModalRow.perf3m >= 0 ? "+" : ""}{activeModalRow.perf3m.toFixed(2)}% 3M
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="profileHeaderRight quickReviewActions">
              <button className="btn" onClick={() => moveQuickReview(-1)} disabled={modalReviewRows.length < 2}>Anterior</button>
              <span className="quickReviewCounter">{modalReviewPosition + 1}/{modalReviewRows.length}</span>
              <button className="btn btnPrimary" onClick={() => moveQuickReview(1)} disabled={modalReviewRows.length < 2}>Siguiente</button>
              <Link className="btn" href={stockUrl(activeModalRow.symbol)} onPointerDown={() => saveSessionBeforeStockOpen(activeModalRow)} onClick={() => saveSessionBeforeStockOpen(activeModalRow)}>Ficha</Link>
              <a className="btn" href={externalLinks(activeModalRow.symbol, activeModalRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
              <button className="btn" onClick={closeQuickReview}>Cerrar</button>
            </div>
          </div>

          <ScreenerOriginPanel origin={quickReviewOrigin} variant="review" />

          <div className="screenerReviewLayout">
            <aside className="reviewQueue screenerReviewQueue" aria-label="Cola de acciones del screener">
              <div className="reviewQueueHead">
                <h2>Cola</h2>
                <span>{modalReviewRows.length}</span>
              </div>
              <div className="reviewQueueList">
                {modalReviewRows.map((row, index) => (
                  <Link
                    key={`${row.symbol}-${index}`}
                    href={stockUrl(row.symbol)}
                    onPointerDown={() => saveSessionBeforeStockOpen(row)}
                    onClick={() => saveSessionBeforeStockOpen(row)}
                    className={`reviewQueueItem ${index === modalReviewPosition ? "active" : ""}`}
                    aria-current={index === modalReviewPosition ? "true" : undefined}
                    title={`Abrir ficha de ${row.symbol}`}
                  >
                    <CompanyMark row={row} size="sm" />
                    <span>
                      <b>{row.symbol}</b>
                      <em>{row.companyName || row.name || row.symbol}</em>
                    </span>
                    <i>{Number.isFinite(row.totalScore) ? Math.round(row.totalScore) : "-"}</i>
                  </Link>
                ))}
              </div>
            </aside>

            <div className="screenerReviewMain">
              <div className="profileGrid quickReviewGrid">
                <div className="profileChartArea">
                  <ChartPreferences settings={chartSettings} onChange={updateChartSettings} symbol={activeModalRow.symbol} listId={chartListId} scope={chartScope} onScopeChange={updateChartScope} compact />
                  <div className="quickReviewChart">
                    <TradingViewPreviewChart row={activeModalRow} chartSettings={chartSettings} />
                  </div>
                  <div className="perfStrip">
                    <div className="perfBox"><span>1S</span><b className={(activeModalRow.perf1w || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf1w || 0)}</b></div>
                    <div className="perfBox"><span>1M</span><b className={(activeModalRow.perf1m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf1m || 0)}</b></div>
                    <div className="perfBox"><span>3M</span><b className={(activeModalRow.perf3m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf3m || 0)}</b></div>
                    <div className="perfBox"><span>6M</span><b className={(activeModalRow.perf6m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf6m || 0)}</b></div>
                    <div className="perfBox"><span>YTD</span><b className={(activeModalRow.perfYtd || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perfYtd || 0)}</b></div>
                    <div className="perfBox"><span>1A</span><b className={(activeModalRow.perf12m || 0) >= 0 ? "up" : "down"}>{pct(activeModalRow.perf12m || 0)}</b></div>
                  </div>
                </div>

                <div className="profileSide">
                  <div className="profileCard quickBusinessCard">
                    <div className="profileCardHeader">
                      <h3>Negocio</h3>
                      <span>Resumen</span>
                    </div>
                    <div className="quickBusinessBody">
                      <p>{quickBusinessDescription(activeModalRow)}</p>
                    </div>
                    <div className="profileRow"><span>Actividad</span><b>{shortBusiness(activeModalRow) || "-"}</b></div>
                    <div className="profileRow"><span>Mercado</span><b>{quickBusinessMarket(activeModalRow)}</b></div>
                  </div>

                  <div className="profileCard">
                    <div className="profileCardHeader">
                      <h3>Métricas técnicas</h3>
                      <span>Score</span>
                    </div>
                    <div className="profileRow"><span>Capitalización</span><b>{amount(activeModalRow.marketCap, activeModalRow.currency) || "-"}</b></div>
                    <div className="profileRow"><span>{metricShortLabel("totalScore")}</span><b className="up">{activeModalRow.totalScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>{metricShortLabel("rsGlobalPct")}</span><b>{activeModalRow.rsGlobalPct?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>{metricShortLabel("rsQualityScore")}</span><b>{activeModalRow.rsQualityScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>{metricShortLabel("adProxyScore")}</span><b>{activeModalRow.adProxyScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>{metricShortLabel("epsGrowthProxyScore")}</span><b>{activeModalRow.epsGrowthProxyScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>Setup quality</span><b>{activeModalRow.setupQualityScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>Growth</span><b>{activeModalRow.growthScore?.toFixed(0) || "-"}</b></div>
                    <div className="profileRow"><span>Rentabilidad/riesgo</span><b>{activeModalRow.riskRewardScore?.toFixed(0) || "-"}</b></div>
                  </div>

                  <div className="profileCard">
                    <div className="profileCardHeader">
                      <h3>Volumen y riesgo</h3>
                      <span>Datos</span>
                    </div>
                    <div className="profileRow"><span>Volumen sesión</span><b>{amount(activeModalRow.latestTurnover, activeModalRow.currency)}</b></div>
                    <div className="profileRow"><span>Volumen 5d</span><b className={(activeModalRow.volumeSurgePct || 0) > 0 ? "up" : ""}>{pct(activeModalRow.volumeSurgePct)}</b></div>
                    <div className="profileRow"><span>Up/down ratio</span><b>{ratioLabel(activeModalRow.upDownVolRatio)}</b></div>
                    <div className="profileRow"><span>{metricShortLabel("shortPercentOfFloat")}</span><b>{pct(activeModalRow.shortPercentOfFloat)}</b></div>
                    <div className="profileRow"><span>Drawdown 3M</span><b className="down">{Number.isFinite(activeModalRow.maxDrawdown63d) ? `${activeModalRow.maxDrawdown63d.toFixed(1)}%` : "-"}</b></div>
                    <div className="profileRow"><span>Volatilidad</span><b>{Number.isFinite(activeModalRow.volatility63d) ? `${activeModalRow.volatility63d.toFixed(1)}%` : "-"}</b></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </dialog>
    )}
  </main>;
}
