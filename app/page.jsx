"use client";
import "../styles/screener.css";
import { useEffect, useMemo, useRef, useState } from "react";
import QuickReviewModal from "@/app/components/screener/QuickReviewModal";
import ScreenerShell from "@/app/components/screener/ScreenerShell";
import { useQuickReviewSession } from "@/app/components/screener/useQuickReviewSession";
import { useResultViewModel } from "@/app/components/screener/useResultViewModel";
import { metricTruthMetaForRow, rowTrustSignatureForRow } from "@/app/components/ui/TrustSignals";
import {
  activeLayerCount,
  buildReviewProfileSummary,
  decisionProfileForRow,
  FilterFamilyModal,
  layerStatusText,
  sleep,
  searchText,
  reviewProfileMeta,
} from "@/app/screenerPanels";
import { verifiedIpoCategory } from "@/lib/screenerResultView";
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { getJson, postJson } from "@/lib/clientApi";
import { getLatestScanFromCloud, getSettingFromCloud, syncAlertsToCloud, syncFavoriteToCloud, syncScanToCloud, syncSettingToCloud } from "@/lib/cloudSyncClient";
import { pct } from "@/lib/formatters";
import { avg, avgVolume } from "@/lib/indicators";
import { safeRead, safeRemove, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { alertsFromScan, mergeAlerts } from "@/lib/methodologyAlerts";
import { enrichRowsWithMethodology, findCompatiblePreviousScan, snapshotCompatibilityKey, summarizeMethodology } from "@/lib/methodologyEngine";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { benchmarkSymbolForRow } from "@/lib/relativeStrength";
import { applyRelativeStrength, buildResearchRow, dataCoverageForRow } from "@/lib/researchRow";
import { isTerminalScanStatus } from "@/lib/scanStatus";
import { compositeLabel, volumeEvidence } from "@/lib/scoring";
import { ASIA, DEFAULT_MARKETS, DEFAULT_SCAN_BATCH_SIZE, DEFAULT_STATUS, DEFAULT_VIEW_LAYERS, EUROPE, FULL_SCAN_PARTIAL_EVERY, MARKET_META, MARKETS, marketName, SCAN_BATCH_SIZES, SCREENER_FILTER_SETTING, SCREENER_SESSION_VERSION, SERVER_SCAN_POLL_MS, USER_TEMPLATE_LIMIT } from "@/lib/screenerConfig";
import { buildDecisionBrief, buildDecisionEvidenceChecklist, buildDecisionQueueItem, buildDecisionQueueSummary, decisionReadinessLabel, explainScreenerRank, rankActionLabel } from "@/lib/screenerExplainability";
import { attachDecisionTrace, auditDecisionRowIssues, buildDecisionAuditExportPayload, buildDecisionTrace, decisionConfidenceLabel, decisionTraceForRow } from "@/lib/decisionAudit";
import { buildReviewPrioritySummary, decisionProfileStateForStock, reviewPriorityForRow } from "@/lib/decisionProfile";
import { buildScreenerDataHealth, dataHealthFilterLabel } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit, scoreAuditFilterLabel, scoreAuditReviewReasons, scoreAuditStatusForRow } from "@/lib/screenerScoreAudit";
import { decisionResolutionForSymbol } from "@/lib/stockDecisionResolution";
import { cachedScreenerQuery, cachedScreenerRow, compactRowForSession, compactRowsForSession, defaultSortForSettings, failureKind, fastFilterSignature, filterAnalyzedRows, ipoRadarUniverseRows, manualUniverseRows, normalizeFilterTemplates, perfNow, secondsLabel, sectorize, setupModeLabel, shuffle, sortMetric, spreadByInitial, uid, universeScopeKey } from "@/lib/screenerPipeline";
import { buildSnapshotFreshnessNotice } from "@/lib/snapshotFreshness";
import { pickBestRestorableScan, restoredSnapshotView, snapshotRowsAreFiltered } from "@/lib/snapshotRestore";
import { vcpReliabilityAudit } from "@/lib/vcpDiagnostics";
import {
  ALL_FILTER_LAYERS,
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  EXECUTION_LAYERS,
  FILTER_FIELDS,
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
import { countryCode, marketFlag, stockUrl } from "@/lib/symbols";

const CACHE_PREVIEW_TIMEOUT_MS = 3500;
const MARKET_HEALTH_TIMEOUT_MS = 5000;

function reviewQueueScoreAuditMeta(row = {}) {
  const status = scoreAuditStatusForRow(row);
  const key = status.mismatch ? "mismatch" : status.missing ? "missing" : status.clean ? "clean" : "attention";
  const reasons = scoreAuditReviewReasons(status.audit);
  const detail = reasons.map((item) => [item.label, item.value, item.detail].filter(Boolean).join(": ")).join(" · ");
  return {
    key,
    label: scoreAuditFilterLabel(key, { compact: true }),
    tone: key === "clean" ? "good" : reasons[0]?.tone || "warn",
    detail,
  };
}

function reviewQueueDataHealthMeta(row = {}, settings = {}) {
  const health = buildScreenerDataHealth(row, settings);
  const key = health.status?.key || "unknown";
  const issues = Array.isArray(health.issues) ? health.issues : [];
  const detail = [
    health.status?.detail,
    health.topLine,
    ...issues.slice(0, 2).map((item) => [item.label, item.detail].filter(Boolean).join(": ")),
  ].filter(Boolean).join(" · ");
  return {
    key,
    label: dataHealthFilterLabel(key, { compact: true }),
    tone: health.status?.tone || "neutral",
    detail,
  };
}

function reviewQueueFocusMeta({ dataHealth = null, metricTruth = null, scoreAudit = null, evidence = null, methodologyFocus = null, vcp = null } = {}) {
  const candidates = [];
  const add = (item) => { if (item?.key && item?.label) candidates.push(item); };
  if (dataHealth?.key === "blocked") add({ priority: 100, key: "data", label: "Datos", tone: "bad", detail: dataHealth.detail });
  if (metricTruth?.key === "blocked") add({ priority: 95, key: "metrics", label: "Metr.", tone: "bad", detail: metricTruth.detail });
  if (scoreAudit?.key === "mismatch") add({ priority: 86, key: "score", label: "Score", tone: "warn", detail: scoreAudit.detail });
  if (["review", "missing"].includes(metricTruth?.key)) add({ priority: 82, key: "metrics", label: "Metr.", tone: "warn", detail: metricTruth.detail });
  if (["blocked", "inconsistent", "needs-data"].includes(vcp?.key)) add({ priority: vcp.key === "blocked" ? 80 : 70, key: "vcp", label: "VCP", tone: vcp.tone || "warn", detail: vcp.summary || vcp.note });
  if (dataHealth?.key && dataHealth.key !== "ready") add({ priority: 72, key: "data", label: "Datos", tone: dataHealth.tone || "warn", detail: dataHealth.detail });
  if (scoreAudit?.key === "missing") add({ priority: 70, key: "score", label: "Score", tone: "warn", detail: scoreAudit.detail });
  if (evidence?.status === "blocked") add({ priority: 68, key: "evidence", label: "Pruebas", tone: "bad", detail: evidence.summary });
  if (methodologyFocus?.tone === "bad" || methodologyFocus?.tone === "warn") add({ priority: methodologyFocus.tone === "bad" ? 66 : 54, key: "method", label: "Método", tone: methodologyFocus.tone, detail: methodologyFocus.detail || methodologyFocus.label });
  if (evidence?.status === "needs-work") add({ priority: 62, key: "evidence", label: "Pruebas", tone: evidence.tone || "warn", detail: evidence.pending?.[0]?.detail || evidence.pending?.[0]?.label || evidence.summary });
  if (scoreAudit?.key === "attention") add({ priority: 50, key: "score", label: "Score", tone: "warn", detail: scoreAudit.detail });
  return candidates.sort((a, b) => b.priority - a.priority)[0] || null;
}

function buildReviewQueueAuditSummary(items = [], activeIndex = 0) {
  const firstIndex = (predicate) => {
    const index = items.findIndex(predicate);
    return index >= 0 ? index : 0;
  };
  const dataCount = items.filter((item) => item.dataHealth?.key && item.dataHealth.key !== "ready").length;
  const dataBlocked = items.filter((item) => item.dataHealth?.key === "blocked").length;
  const scoreCount = items.filter((item) => item.scoreAudit?.key && item.scoreAudit.key !== "clean").length;
  const scoreMismatch = items.filter((item) => item.scoreAudit?.key === "mismatch").length;
  const evidenceCount = items.filter((item) => item.evidence?.status && item.evidence.status !== "ready").length;
  const evidenceBlocked = items.filter((item) => item.evidence?.status === "blocked").length;
  const activeItem = items[activeIndex] || null;
  return [
    {
      key: "data",
      label: dataCount ? (dataBlocked ? "Datos bloqueados" : "Datos revisar") : "Datos OK",
      count: dataCount,
      tone: dataBlocked ? "bad" : dataCount ? "warn" : "good",
      firstIndex: firstIndex((item) => item.dataHealth?.key && item.dataHealth.key !== "ready"),
      active: Boolean(activeItem?.dataHealth?.key && activeItem.dataHealth.key !== "ready"),
      detail: dataBlocked ? `${dataBlocked} bloqueadas · ${dataCount} a revisar` : `${dataCount} con datos a revisar`,
    },
    {
      key: "score",
      label: scoreCount ? (scoreMismatch ? "Score descuadre" : "Score revisar") : "Score OK",
      count: scoreCount,
      tone: scoreCount ? "warn" : "good",
      firstIndex: firstIndex((item) => item.scoreAudit?.key && item.scoreAudit.key !== "clean"),
      active: Boolean(activeItem?.scoreAudit?.key && activeItem.scoreAudit.key !== "clean"),
      detail: scoreMismatch ? `${scoreMismatch} con descuadre · ${scoreCount} a revisar` : `${scoreCount} con score a revisar`,
    },
    {
      key: "evidence",
      label: evidenceCount ? (evidenceBlocked ? "Pruebas bloqueadas" : "Pruebas validar") : "Pruebas OK",
      count: evidenceCount,
      tone: evidenceBlocked ? "bad" : evidenceCount ? "warn" : "good",
      firstIndex: firstIndex((item) => item.evidence?.status && item.evidence.status !== "ready"),
      active: Boolean(activeItem?.evidence?.status && activeItem.evidence.status !== "ready"),
      detail: evidenceBlocked ? `${evidenceBlocked} bloqueadas · ${evidenceCount} a validar` : `${evidenceCount} con pruebas pendientes`,
    },
  ];
}

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
  const [snapshotNotice, setSnapshotNotice] = useState(null);
  const [restoringScan, setRestoringScan] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [scanMode, setScanMode] = useState("all");
  const [batchStart, setBatchStart] = useState(0);
  const [scanBatchSize, setScanBatchSize] = useState(DEFAULT_SCAN_BATCH_SIZE);
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
  const activeSettings = useMemo(() => effectiveSettingsFromLayers(settings, filterLayers, fieldRules), [settings, filterLayers, fieldRules]);
  const quickReview = useQuickReviewSession({
    activeSettings,
    presetKey,
    searchResult,
    rows,
    analyzedRows,
    setStatus,
    persistScreenerSession,
    buildScreenerStockOpenContext,
    saveSessionBeforeStockOpen,
  });
  const {
    activeModalRow,
    quickReviewRows,
    quickReviewIndex,
    quickReviewResolutionRevision,
    modalReviewRows,
    modalReviewPosition,
    restoreQuickReviewSession,
    resetQuickReview,
    openReview,
    selectQuickReview,
    moveQuickReview,
    closeQuickReview,
    saveQuickReviewStockOpen,
    resolveQuickReviewDecision,
    reopenQuickReviewDecision,
  } = quickReview;
  const [screenerDecisionRevision, setScreenerDecisionRevision] = useState(0);
  const screenerDecisionResolutions = useMemo(() => safeRead(STORAGE_KEYS.review, {})?.decisionResolutions || {}, [screenerDecisionRevision, quickReviewResolutionRevision]);
  const resultView = useResultViewModel({
    rows,
    pendingResults,
    activeSettings,
    viewLayers,
    screenerDecisionResolutions,
    openReview,
    setStatus,
  });
  const {
    themeFilter,
    setThemeFilter,
    sectorFilter,
    setSectorFilter,
    industryFilter,
    setIndustryFilter,
    countryFilter,
    setCountryFilter,
    sectorStrength,
    setSectorStrength,
    ipo,
    setIpo,
    actionFilter,
    setActionFilter,
    readinessFilter,
    setReadinessFilter,
    decisionProfileFilter,
    setDecisionProfileFilter,
    reviewPriorityFilter,
    setReviewPriorityFilter,
    reliabilityFilter,
    setReliabilityFilter,
    decisionEvidenceFilter,
    setDecisionEvidenceFilter,
    confidenceFilter,
    setConfidenceFilter,
    dataHealthFilter,
    setDataHealthFilter,
    scoreAuditFilter,
    setScoreAuditFilter,
    decisionIssueFilter,
    setDecisionIssueFilter,
    decisionResolutionFilter,
    setDecisionResolutionFilter,
    sort,
    setSort,
    resultPageSize,
    resultPage,
    setResultPage,
    restoreResultViewSession,
    resetResultView,
    filtered,
    pendingDecisionWorkSummary,
    pendingDecisionWorkActive,
    applyPendingDecisionWorkFocus,
    clearPendingDecisionWorkFocus,
    reviewPendingDecisionWork,
    pendingFilteredCount,
    totalResultPages,
    visibleResultPage,
    resultPageStart,
    resultPageEnd,
    pagedRows,
    visibleDecisionAudit,
    setResultPageClamped,
    updateResultPageSize,
    opportunities,
    optionLabel,
    actionCounts,
    actionOptions,
    readinessCounts,
    readinessOptions,
    readinessSummary,
    decisionProfileCounts,
    decisionProfileOptions,
    confidenceCounts,
    confidenceOptions,
    dataHealthSummary,
    dataHealthOptions,
    reviewPrioritySummary,
    reviewPriorityOptions,
    reliabilitySummary,
    reliabilityOptions,
    decisionEvidenceSummary,
    decisionEvidenceOptions,
    openReviewPriorityQueue,
    openReviewDecisionEvidenceQueue,
    openReviewScoreAuditQueue,
    openReviewMethodologyFocusQueue,
    scoreAuditOptions,
    scoreAuditSummary,
    visibleDecisionBrief,
    visibleDataHealthSummary,
    visibleDecisionEvidenceSummary,
    visibleScoreAuditSummary,
    visibleAuditabilitySummary,
    decisionResolutionOptions,
    countryCounts,
    themeCounts,
    sectorCounts,
    industryCounts,
    sectorStrengthCounts,
    themeOptions,
    sectorOptions,
    industryOptions,
    countryOptions,
    recentIpoRows,
    ipos,
    ipoCounts,
    hiddenByView,
    viewFiltersActive,
    resultFilterChips,
    resultViewBrief,
    openResultViewReview,
    clearResultViewLayer,
    clearResultView,
  } = resultView;
  const [chartSettings, setChartSettings] = useState(DEFAULT_CHART_SETTINGS);
  const [chartScope, setChartScope] = useState("global");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    const refreshDecisionState = () => setScreenerDecisionRevision((value) => value + 1);
    window.addEventListener("pageshow", refreshDecisionState);
    window.addEventListener("focus", refreshDecisionState);
    window.addEventListener("storage", refreshDecisionState);
    return () => {
      window.removeEventListener("pageshow", refreshDecisionState);
      window.removeEventListener("focus", refreshDecisionState);
      window.removeEventListener("storage", refreshDecisionState);
    };
  }, []);
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
  // Propiedad de los resultados visibles: "none" | "session" | "cloud" | "local" | "scan".
  // La restauración asíncrona desde Supabase SOLO aplica si nadie produjo
  // resultados mientras resolvía (evita que un snapshot viejo pise un scan).
  const resultsOwnerRef = useRef("none");
  function restoreSnapshot(scan, { source = "local", notice = null } = {}) {
    if (!scan || !Array.isArray(scan.rows) || !scan.rows.length) return false;
    resultsOwnerRef.current = source;
    const restoredPresetKey = PRESETS[scan.preset] ? scan.preset : "balanced";
    const restoredSettings = settingsForPreset(restoredPresetKey, scan.settings || {});
    const restoredFilterLayers = { ...filterLayersForPreset(restoredPresetKey), ...(scan.filterLayers || {}) };
    const restoredFieldRules = { ...DEFAULT_FIELD_RULES, ...(scan.fieldRules || {}) };
    const restoredViewLayers = scan.viewLayers || DEFAULT_VIEW_LAYERS;
    const restoredUseRegimeFilter = scan.useRegimeFilter !== false;
    const restoredActiveSettings = scan.activeSettings || effectiveSettingsFromLayers(restoredSettings, restoredFilterLayers, restoredFieldRules);
    const restoredRowsAreFiltered = snapshotRowsAreFiltered(scan);
    const nextScanContext = {
      id: scan.id || uid(),
      symbolsCount: scan.rows.length,
      baseCount: scan.rows.length,
      providerErrors: [],
      scannedAt: scan.updatedAt || scan.createdAt || new Date().toISOString(),
      snapshotSource: source === "cloud" ? "supabase" : "local",
      snapshotRowsAreFiltered: restoredRowsAreFiltered,
    };
    const restoreFilterContext = {
      ...nextScanContext,
      marketHealth,
      useRegimeFilter: restoredUseRegimeFilter,
    };
    const restoredFilterView = restoredSnapshotView(scan, restoredActiveSettings, restoreFilterContext, filterAnalyzedRows);
    fastFilterSignatureRef.current = fastFilterSignature(scan.rows, restoredActiveSettings, restoreFilterContext);
    setPresetKey(restoredPresetKey);
    setSettings(restoredSettings);
    setFilterLayers(restoredFilterLayers);
    setFieldRules(restoredFieldRules);
    setViewLayers(restoredViewLayers);
    setUseRegimeFilter(restoredUseRegimeFilter);
    setSort(scan.sort || scan.settings?.sort || defaultSortForSettings(restoredActiveSettings));
    setRows(restoredFilterView.rows);
    setAnalyzedRows(scan.rows);
    setScanContext(nextScanContext);
    setDiagnostics(restoredFilterView.diagnostics);
    setSnapshotNotice(notice);
    setScanPerf({
      fullScanMs: null,
      lastFilterMs: restoredFilterView.filterMs,
      lastFastFilterMs: null,
      estimatedSavedMs: null,
      analyzedRows: scan.rows.length,
      scannedSymbols: scan.rows.length,
      fastRefilters: 0,
    });
    return true;
  }
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
      const restoredActiveSettings = session.activeSettings || effectiveSettingsFromLayers(restoredSettings, restoredFilterLayers, restoredFieldRules);
      const restoredScrollY = Number(session.scrollY);
      restoredRowsCount = restoredRows.length || restoredAnalyzedRows.length;
      if (restoredRowsCount) resultsOwnerRef.current = "session";
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
      setSnapshotNotice(session.snapshotNotice || null);
      setFail(Array.isArray(session.fail) ? session.fail : []);
      setDiagnostics(session.diagnostics || null);
      restoreResultViewSession(session, restoredActiveSettings);
      setScanMode(session.scanMode || "all");
      setBatchStart(Number.isFinite(session.batchStart) ? session.batchStart : 0);
      setScanBatchSize(SCAN_BATCH_SIZES.includes(session.scanBatchSize) ? session.scanBatchSize : DEFAULT_SCAN_BATCH_SIZE);
      setMarketHealth(restoredMarketHealth);
      setUseRegimeFilter(restoredUseRegimeFilter);
      setFilterLayers(restoredFilterLayers);
      setFieldRules(restoredFieldRules);
      setViewLayers(session.viewLayers || DEFAULT_VIEW_LAYERS);
      setSearchSymbol(session.searchSymbol || "");
      setSearchCandidates(Array.isArray(session.searchCandidates) ? session.searchCandidates : []);
      setSearchResult(session.searchResult || null);
      restoreQuickReviewSession(
        Array.isArray(session.quickReviewRows) ? session.quickReviewRows : [],
        Number.isFinite(session.quickReviewIndex) ? session.quickReviewIndex : 0,
      );
      if (restoredRows.length && restoredAnalyzedRows.length && session.scanContext) {
        fastFilterSignatureRef.current = fastFilterSignature(
          restoredAnalyzedRows,
          restoredActiveSettings,
          { ...session.scanContext, marketHealth: restoredMarketHealth, useRegimeFilter: restoredUseRegimeFilter },
        );
      }
      setStatus(
        restoredRows.length
          ? `Sesión restaurada: ${restoredRows.length} acciones en el screener.`
          : restoredAnalyzedRows.length
            ? `Sesión restaurada: ${restoredAnalyzedRows.length} acciones analizadas; recalculando filtros.`
            : DEFAULT_STATUS
      );
    }
    if (!restoredRowsCount) {
      setRestoringScan(true);
      setStatus("Cargando último snapshot guardado...");
      const restoreLocalSnapshot = (reason = "") => {
        if (cancelled || resultsOwnerRef.current !== "none") return false;
        const localScan = pickBestRestorableScan(safeRead(STORAGE_KEYS.scans, []));
        if (!localScan) return false;
        const notice = reason ? {
          tone: "info",
          label: "Snapshot local",
          detail: `${reason} Se restaura la última copia local disponible.`,
          source: "local",
        } : null;
        const restored = restoreSnapshot(localScan, { source: "local", notice });
        if (restored) setStatus(`Último snapshot local cargado: ${localScan.rows.length} acciones. Puedes ejecutar para refrescar datos.`);
        return restored;
      };
      getLatestScanFromCloud().then((result) => {
        // Si mientras resolvía el fetch arrancó un scan (o llegaron resultados por
        // otra vía), el snapshot remoto NO debe pisarlos.
        if (cancelled || resultsOwnerRef.current !== "none") return;
        if (!result.ok || result.configured === false) {
          if (!restoreLocalSnapshot(result.message ? `Supabase: ${result.message}.` : "Supabase no disponible.")) setStatus(DEFAULT_STATUS);
          return;
        }
        const scan = pickBestRestorableScan(result.data?.scans || []);
        if (!scan) {
          if (!restoreLocalSnapshot("Supabase no devolvió snapshots con filas.")) setStatus(DEFAULT_STATUS);
          return;
        }
        const notice = buildSnapshotFreshnessNotice(result.data, scan);
        const storedScans = safeRead(STORAGE_KEYS.scans, []);
        safeWrite(STORAGE_KEYS.scans, [scan, ...(Array.isArray(storedScans) ? storedScans.filter((item) => item?.id !== scan.id) : [])].slice(0, 50));
        restoreSnapshot(scan, { source: "cloud", notice });
        setStatus(notice?.stale
          ? `Último snapshot cacheado cargado: ${scan.rows.length} acciones. Supabase no respondió al refrescar.`
          : `Último snapshot Supabase cargado: ${scan.rows.length} acciones. Los filtros se aplican sobre este universo estable.`);
      }).catch(() => {
        if (!cancelled && !restoreLocalSnapshot("Supabase no respondió.")) setStatus(DEFAULT_STATUS);
      }).finally(() => {
        if (!cancelled) setRestoringScan(false);
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
      snapshotNotice,
      fail,
      diagnostics,
      status,
      themeFilter,
      sectorFilter,
      industryFilter,
      countryFilter,
      sectorStrength,
      ipo,
      actionFilter,
      readinessFilter,
      decisionProfileFilter,
      reviewPriorityFilter,
      reliabilityFilter,
      decisionEvidenceFilter,
      confidenceFilter,
      dataHealthFilter,
      scoreAuditFilter,
      decisionIssueFilter,
      decisionResolutionFilter,
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
    if (restoringScan && !rows.length) return;
    persistScreenerSession();
  }, [sessionReady, markets, manual, settings, presetKey, universe, universeScope, rows, analyzedRows, scanContext, scanPerf, snapshotNotice, fail, diagnostics, status, themeFilter, sectorFilter, industryFilter, countryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, sort, scanMode, batchStart, scanBatchSize, resultPageSize, resultPage, marketHealth, restoringScan, useRegimeFilter, filterLayers, fieldRules, viewLayers, searchSymbol, searchCandidates, searchResult, quickReviewRows, quickReviewIndex]);

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
  const kpiUniverseCount = universe.length || scanContext?.baseCount || analyzedRows.length || rows.length;
  function commitPendingResults() {
    if (!pendingResults) return;
    setRows(pendingResults.rows || []);
    setDiagnostics(pendingResults.diagnostics || null);
    setSnapshotNotice(null);
    setPendingResults(null);
    setStatus(`Resultados actualizados: ${pendingResults.rows?.length || 0} acciones calculadas.`);
  }
  const clear = () => {
    resultsOwnerRef.current = "none";
    setRows([]);
    setPendingResults(null);
    setAnalyzedRows([]);
    setScanContext(null);
    setScanPerf(null);
    fastFilterSignatureRef.current = "";
    setFail([]);
    setDiagnostics(null);
    setSnapshotNotice(null);
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
    resultsOwnerRef.current = "none";
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
    resetResultView(defaultSortForSettings(settingsForPreset("balanced")));
    setErr("");
    setScanMode("all");
    setBatchStart(0);
    setScanBatchSize(DEFAULT_SCAN_BATCH_SIZE);
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
    resetQuickReview();
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
    setSort(defaultSortForSettings({ setupMode: nextMode }));
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
      actionFilter,
      readinessFilter,
      decisionProfileFilter,
      reviewPriorityFilter,
      reliabilityFilter,
      decisionEvidenceFilter,
      confidenceFilter,
      dataHealthFilter,
      scoreAuditFilter,
      decisionIssueFilter,
      decisionResolutionFilter,
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
    restoreResultViewSession(config, nextPreset.v, { resetPage: true });
    setScanMode(config.scanMode || "all");
    setBatchStart(Number.isFinite(config.batchStart) ? config.batchStart : 0);
    setScanBatchSize(SCAN_BATCH_SIZES.includes(config.scanBatchSize) ? config.scanBatchSize : DEFAULT_SCAN_BATCH_SIZE);
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
      const d = await getJson("/api/market-health", { timeoutMs: MARKET_HEALTH_TIMEOUT_MS });
      setMarketHealth(d);
      setStatus(`Salud de mercado: ${d.regime?.label || "sin regimen"} · Score ${Math.round(d.marketScore || 0)}`);
      return d;
    } catch (e) {
      setStatus("Salud de mercado no disponible; el scan continua sin filtro de regimen.");
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
      const data = await getJson(`/api/leaderboards?${params.toString()}`, { timeoutMs: CACHE_PREVIEW_TIMEOUT_MS });
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
    setSort(defaultSortForSettings(PRESETS[k].v));
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
    resultsOwnerRef.current = "scan";
    setRunning(true);
    setPendingResults(null);
    setAnalyzedRows([]);
    setScanContext(null);
    setScanPerf(null);
    fastFilterSignatureRef.current = "";
    setFail([]);
    setErr("");
    if (!hadVisibleRows) {
      setSnapshotNotice(null);
      setRows([]);
      setDiagnostics(null);
      setResultPage(1);
    } else {
      setStatus("Actualizando en segundo plano. La tabla visible se mantiene hasta que confirmes los nuevos resultados.");
    }
    try {
      setStatus("Preparando scan...");
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
          setSnapshotNotice(null);
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
        setSnapshotNotice(null);
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
    const decisionRows = enrichedRows.map((row) => attachDecisionTrace(row, activeSettings));
    const methodologySummary = summarizeMethodology(decisionRows, previousScan);
    const eventTotal = Object.values(methodologySummary.eventCounts || {}).reduce((sum, value) => sum + value, 0);
    const scan = {
      id: uid(),
      createdAt: new Date().toISOString(),
      name: `${PRESETS[presetKey].name} · ${decisionRows.length} acciones · ${new Date().toLocaleString()}`,
      preset: presetKey,
      settings,
      activeSettings,
      filterLayers,
      fieldRules,
      viewLayers,
      useRegimeFilter,
      sort,
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
      rows: decisionRows,
    };
    safeWrite(STORAGE_KEYS.scans, [scan, ...scans].slice(0, 50));
    const generatedAlerts = alertsFromScan(scan);
    const nextAlerts = mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), generatedAlerts).slice(0, 500);
    safeWrite(STORAGE_KEYS.alerts, nextAlerts);
    setStatus(`Snapshot guardado localmente: ${decisionRows.length} acciones · ${eventTotal} eventos · ${generatedAlerts.length} alertas. Sincronizando Supabase...`);
    setSnapshotNotice(null);
    syncScanToCloud(scan).then((result) => {
      if (result.configured === false) setStatus(`Snapshot guardado localmente: ${decisionRows.length} acciones · ${generatedAlerts.length} alertas. Supabase no configurado.`);
      else if (result.ok) setStatus(`Snapshot guardado: ${decisionRows.length} acciones · ${generatedAlerts.length} alertas. Disponible en local y Supabase.`);
      else setStatus(`Snapshot local guardado. Supabase: ${result.message}`);
    });
    syncAlertsToCloud(generatedAlerts).then((result) => {
      if (result.configured !== false && !result.ok) setStatus(`Snapshot guardado. Alertas solo locales: ${result.message}`);
      else if (result.ok && result.data?.alerts?.length) safeWrite(STORAGE_KEYS.alerts, mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), result.data.alerts).slice(0, 500));
    });
  }
  function csv(filteredRows) {
    const h = ["Rank", "Ticker", "Empresa", "Actividad ES", "Tema", "Pais", "Sector", "Industria", "IPO", "IPO Date", "IPO Age Months", "Benchmark", "Last Price Date", "Price Freshness Days", "Price Freshness Label", "Price Freshness Issue", "Data Coverage", "Technical Coverage", "Fundamental Coverage", "Data Issues", "Data Health", "Data Health Key", "Data Health Detail", "Data Health Topline", "Data Health Issues", "RS Benchmark", "RS", "RS Pais", "RS Grupo", "RS Quality", "RS Stability", "Speculation Risk", "RS Quality Label", "Weakness Score", "Weakness Label", "Weakness Reasons", "RS Sample", "RS Pais Sample", "RS Grupo Sample", "RS 3M", "RS 6M", "RS 12M", "Dist 20d", "Dist 50d", "Dist 52w", "Dist ATH", "Highs Spread", "3M", "6M", "12M", "SMA50", "Avg Volume 20d", "Latest Volume", "Avg Turnover 20d", "Latest Turnover", "UD Vol", "Rel Volume", "Volume Surge %", "Volume Effect Score", "A/D Proxy", "EPS/Growth Proxy", "Volume Evidence", "Short Float %", "Short Ratio", "Shares Short", "Float Shares", "Up Volume", "Max Daily Move 20d", "Max Daily Range 20d", "Avg Daily Range 20d", "Price Range 63d", "Volatility 63d", "Downside Vol 63d", "Max Drawdown 63d", "Return/Vol 3M", "Return/Drawdown 3M", "Risk/Reward Score", "Weinstein", "Minervini", "Momentum", "Risk", "Volume", "Liquidity", "Sector Score", "Objective Setup", "Pattern Score", "Pattern Contribution", "Setup Quality", "Demand", "Growth", "IPO Score", "Objective Score", "Composite", "Legacy Total", "Objective Label", "Composite Label", "Reasons", "Risks", "Decision Priority", "Decision Confidence", "Decision Confidence Score", "Decision Issues", "Decision Drivers", "Decision Watch", "Decision", "Decision Detail", "Action", "Action Detail"];
    const lines = filteredRows.map((r, i) => {
      const explanation = explainScreenerRank(r, activeSettings);
      const trace = buildDecisionTrace(r, explanation);
      const dataHealth = buildScreenerDataHealth(r, activeSettings);
      return [i + 1, r.symbol, r.companyName, r.businessEs, r.theme, r.country, r.sector, r.industry, r.ipoCategory, r.ipoDate, r.ipoAgeMonths, r.benchmarkSymbol, r.lastDate, r.priceFreshnessDays, r.priceFreshnessLabel, r.priceFreshnessIssue, r.dataCoverageScore, r.technicalCoverageScore, r.fundamentalCoverageScore, (r.dataCoverageIssues || []).join(" | "), dataHealth.status?.label, dataHealth.status?.key, dataHealth.status?.detail, dataHealth.topLine, dataHealth.issues.map((item) => item.label).join(" | "), r.rsRating, r.rsGlobalPct, r.rsCountryPct, r.rsSectorPct, r.rsQualityScore, r.rsStabilityScore, r.speculationRiskScore, r.rsQualityLabel, r.weaknessScore, r.weaknessLabel, (r.weaknessReasons || []).join(" | "), r.rsGlobalSample, r.rsCountrySample, r.rsSectorSample, r.rs3m, r.rs6m, r.rs12m, r.distance20d, r.distance50d, r.distance52w, r.distanceATH, r.highsSpreadPct, r.perf3m, r.perf6m, r.perf12m, r.extSma50, r.avgVolume, r.latestVolume, r.avgTurnover, r.latestTurnover, r.upDownVolRatio, r.relativeVolume, r.volumeSurgePct, r.volumeEffectScore, r.adProxyScore, r.epsGrowthProxyScore, r.volumeEvidence, r.shortPercentOfFloat, r.shortRatio, r.sharesShort, r.floatShares, r.upVolume, r.maxDailyMove20dPct, r.maxDailyRange20dPct, r.avgDailyRange20dPct, r.range63dPct, r.volatility63d, r.downsideVolatility63d, r.maxDrawdown63d, r.returnToVol3m, r.returnToDrawdown3m, r.riskRewardScore, r.weinsteinScore, r.minerviniScore, r.momentumScore, r.riskScore, r.volumeScore, r.liquidityScore, r.sectorScore, r.objectiveSetupScore, r.patternScore, r.patternContributionScore, r.setupQualityScore, r.demandScore, r.growthScore, r.ipoScore, r.objectiveScore, r.totalScore, r.legacyTotalScore, r.objectiveLabel, r.compositeLabel, (r.compositeReasons || []).join(" | "), (r.compositeRisks || []).join(" | "), trace.priorityScore, trace.confidence?.label, trace.confidence?.score, trace.issues.map((item) => item.label).join(" | "), trace.drivers.map((item) => item.value ? `${item.label} ${item.value}` : item.label).join(" | "), trace.watch.map((item) => item.value ? `${item.label}: ${item.value}` : item.label).join(" | "), explanation.readiness.label, explanation.readiness.detail, explanation.action.label, explanation.action.detail].map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",");
    });
    const blob = new Blob([[h.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "stageradar-screener.csv"; a.click(); URL.revokeObjectURL(url);
  }
  function decisionAuditJson(filteredRows) {
    const exportRows = compactRowsForSession(filteredRows);
    const payload = buildDecisionAuditExportPayload({
      rows: exportRows,
      name: `${PRESETS[presetKey]?.name || "Screener"} · ${exportRows.length} visibles`,
      preset: presetKey,
      settings,
      activeSettings,
      filterLayers: { ...filterLayers, marketRegime: useRegimeFilter },
      fieldRules,
      viewLayers,
      viewFilters: { countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, sort },
      marketScore: marketHealth?.marketScore ?? null,
      marketRegime: marketHealth?.regime?.label || "sin dato",
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `stageradar-decision-audit-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
    setStatus(`JSON audit exportado: ${exportRows.length} resultados visibles listos para npm run audit:decisions.`);
  }

  useEffect(() => {
    if (running || filtered.length || !pendingResults?.rows?.length || pendingFilteredCount <= 0) return;
    setRows(pendingResults.rows || []);
    setDiagnostics(pendingResults.diagnostics || null);
    setSnapshotNotice(null);
    setPendingResults(null);
    setResultPage(1);
    setStatus(`Resultados actualizados automaticamente: ${pendingResults.rows?.length || 0} acciones calculadas.`);
  }, [running, filtered.length, pendingFilteredCount, pendingResults]);

  // Preview is container-owned because it coordinates page-level UI state, even though it follows filtered rows.
  useEffect(() => {
    if (!filtered.length) {
      if (activePreviewRow) setActivePreviewRow(null);
      return;
    }
    if (!activePreviewRow || !filtered.some((r) => r.symbol === activePreviewRow.symbol)) {
      setActivePreviewRow(filtered[0]);
    }
  }, [filtered, activePreviewRow]);

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
        if (!bucket.top || (row.objectiveScore ?? row.totalScore ?? 0) > (bucket.top.objectiveScore ?? bucket.top.totalScore ?? 0)) bucket.top = row;
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
    const rankExplain = row ? explainScreenerRank(row, activeSettings) : null;
    const decisionIssues = row ? auditDecisionRowIssues(row, rankExplain || activeSettings) : [];
    const decisionTrace = row ? decisionTraceForRow(row, rankExplain || activeSettings) : null;
    const decisionBrief = row ? (decisionTrace?.brief || buildDecisionBrief(row, rankExplain || activeSettings)) : null;
    const decisionEvidence = row ? buildDecisionEvidenceChecklist(row, rankExplain || activeSettings) : null;
    const dataHealth = row ? buildScreenerDataHealth(row, activeSettings) : null;
    const scoreAudit = row ? buildScreenerScoreAudit(row) : null;
    const metricTruth = row ? metricTruthMetaForRow(row, { includeIssueDetail: true }) : null;
    const reviewFocus = row ? reviewQueueFocusMeta({
      dataHealth: reviewQueueDataHealthMeta(row, activeSettings),
      metricTruth,
      scoreAudit: reviewQueueScoreAuditMeta(row),
      evidence: decisionEvidence,
      vcp: vcpReliabilityAudit(row),
    }) : null;
    return buildScreenerStockContext(screenerContract, {
      symbol,
      row,
      rank: Number.isFinite(extras.rank) ? extras.rank : (foundIndex >= 0 ? foundIndex + 1 : null),
      queueSize: Number.isFinite(extras.queueSize) ? extras.queueSize : filtered.length,
      sourceLabel: extras.sourceLabel || "Screener",
      openedAt: extras.openedAt || new Date().toISOString(),
      action: rankExplain?.action,
      readiness: rankExplain?.readiness,
      decisionProfile: decisionProfileStateForStock(row, rankExplain || activeSettings),
      decisionIssues,
      decisionTrace,
      decisionBrief,
      decisionEvidence,
      reviewFocus,
      dataHealth,
      scoreAudit,
    });
  }

  const secSum = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { const x = m.get(r.theme) || { theme: r.theme, count: 0, avg: 0, p3: 0 }; x.count++; x.avg += r.objectiveScore ?? r.totalScore ?? 0; x.p3 += r.perf3m || 0; m.set(r.theme, x); });
    return [...m.values()].map((x) => ({ ...x, avg: x.avg / x.count, p3: x.p3 / x.count })).sort((a, b) => b.avg - a.avg);
  }, [rows]);
  const ipoSum = useMemo(() => {
    const m = new Map();
    recentIpoRows.forEach((r) => {
      const category = verifiedIpoCategory(r);
      if (!category) return;
      const x = m.get(category) || { cat: category, count: 0, avg: 0 };
      x.count++;
      x.avg += r.objectiveScore ?? r.totalScore ?? 0;
      m.set(category, x);
    });
    return [...m.values()].map((x) => ({ ...x, avg: x.avg / x.count })).sort((a, b) => b.avg - a.avg);
  }, [recentIpoRows]);
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
  const modalActiveResolution = useMemo(() => activeModalRow
    ? decisionResolutionForSymbol({ decisionResolutions: screenerDecisionResolutions }, activeModalRow.symbol)
    : null,
  [activeModalRow?.symbol, screenerDecisionResolutions]);
  const modalDecisionResolutions = screenerDecisionResolutions;
  const modalReviewQueueItems = useMemo(() => modalReviewRows.map((row) => {
    const item = buildDecisionQueueItem(row, activeSettings);
    const profileKey = decisionProfileForRow(row, activeSettings);
    const profile = reviewProfileMeta(profileKey);
    const reviewPriority = reviewPriorityForRow(row, activeSettings);
    const scoreAudit = reviewQueueScoreAuditMeta(row);
    const dataHealth = reviewQueueDataHealthMeta(row, activeSettings);
    const metricTruth = metricTruthMetaForRow(row, { includeIssueDetail: true });
    const vcp = vcpReliabilityAudit(row);
    const focus = reviewQueueFocusMeta({ dataHealth, metricTruth, scoreAudit, evidence: item.evidence, methodologyFocus: item.methodologyFocus, vcp });
    const trustSignature = rowTrustSignatureForRow(row, { dataHealth, metricTruth, scoreAudit, evidence: item.evidence, vcpReliability: vcp });
    return {
      ...item,
      profileKey,
      profileLabel: profile.label,
      profileTone: profile.tone,
      reviewPriority,
      scoreAudit,
      dataHealth,
      metricTruth,
      focus,
      trustSignature,
    };
  }), [modalReviewRows, activeSettings]);
  const modalReviewAuditSummary = useMemo(() => buildReviewQueueAuditSummary(modalReviewQueueItems, modalReviewPosition), [modalReviewQueueItems, modalReviewPosition]);
  const modalReviewPrioritySummary = useMemo(() => buildReviewPrioritySummary(modalReviewQueueItems), [modalReviewQueueItems]);
  const modalReviewQueueSummary = useMemo(() => buildDecisionQueueSummary(modalReviewQueueItems), [modalReviewQueueItems]);
  const modalReviewProfileSummary = useMemo(() => buildReviewProfileSummary(modalReviewQueueItems), [modalReviewQueueItems]);
  const modalActiveReviewPriority = modalReviewQueueItems[modalReviewPosition]?.reviewPriority || (activeModalRow ? reviewPriorityForRow(activeModalRow, activeSettings) : null);
  const modalRankExplain = useMemo(() => activeModalRow ? explainScreenerRank(activeModalRow, activeSettings) : null, [activeModalRow, activeSettings]);
  const modalDecisionIssues = useMemo(() => activeModalRow ? auditDecisionRowIssues(activeModalRow, modalRankExplain || activeSettings) : [], [activeModalRow, modalRankExplain, activeSettings]);
  const modalDecisionEvidence = useMemo(() => activeModalRow ? buildDecisionEvidenceChecklist(activeModalRow, modalRankExplain || activeSettings) : null, [activeModalRow, modalRankExplain, activeSettings]);
  const modalDecisionTrace = useMemo(() => activeModalRow ? decisionTraceForRow(activeModalRow, modalRankExplain || activeSettings) : null, [activeModalRow, modalRankExplain, activeSettings]);
  const modalDecisionBrief = useMemo(() => activeModalRow ? (modalDecisionTrace?.brief || buildDecisionBrief(activeModalRow, modalRankExplain || activeSettings)) : null, [activeModalRow, modalRankExplain, activeSettings, modalDecisionTrace]);
  const modalDataHealth = useMemo(() => activeModalRow ? buildScreenerDataHealth(activeModalRow, activeSettings) : null, [activeModalRow, activeSettings]);
  const modalScoreAudit = useMemo(() => activeModalRow ? buildScreenerScoreAudit(activeModalRow) : null, [activeModalRow]);
  const modalReviewSourceMeta = activeModalRow ? safeRead(STORAGE_KEYS.review, {}) : {};
  const modalReviewSourceLabel = String(modalReviewSourceMeta.sourceLabel || "Screener actual").trim() || "Screener actual";
  const modalReviewSourceDetail = String(modalReviewSourceMeta.sourceDetail || "").trim();
  const modalReviewQueueMode = String(modalReviewSourceMeta.queueMode || "screener-review").trim() || "screener-review";
  const modalOriginLabel = modalReviewSourceLabel === "Screener actual" ? "Revisión Screener" : modalReviewSourceLabel;
  const quickReviewOrigin = useMemo(() => activeModalRow ? buildScreenerStockContext(screenerContract, {
    symbol: activeModalRow.symbol,
    row: activeModalRow,
    rank: modalReviewPosition + 1,
    queueSize: modalReviewRows.length,
    sourceLabel: modalOriginLabel,
    action: modalRankExplain?.action,
    readiness: modalRankExplain?.readiness,
    decisionProfile: decisionProfileStateForStock(activeModalRow, modalRankExplain || activeSettings),
    decisionIssues: modalDecisionIssues,
    decisionEvidence: modalDecisionEvidence,
    decisionTrace: modalDecisionTrace,
    decisionBrief: modalDecisionBrief,
    dataHealth: modalDataHealth,
    scoreAudit: modalScoreAudit,
  }) : null, [activeModalRow, screenerContract, modalReviewPosition, modalReviewRows.length, modalOriginLabel, modalRankExplain, modalDecisionIssues, modalDecisionEvidence, modalDecisionTrace, modalDecisionBrief, modalDataHealth, modalScoreAudit, activeSettings]);

  useEffect(() => {
    if (!activeFilterFamily) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setActiveFilterFamily(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFilterFamily]);

  return <>
  <ScreenerShell
    chrome={{
      presetKey,
      markets,
      filtered,
      filteredCount: filtered.length,
      running,
      err,
      status,
      snapshotNotice,
      showMobileFilters,
      sidebarCollapsed,
      setShowMobileFilters,
      setSidebarCollapsed,
      stopScan,
      run,
      kpiUniverseCount,
      marketHealth,
      rows,
    }}
    sidebar={{
      presetKey,
      savedFilterTemplates,
      selectedFilterTemplateId,
      filterTemplateName,
      running,
      setPreset,
      applySavedFilterTemplate,
      setFilterTemplateName,
      saveCurrentFilterTemplate,
      deleteSavedFilterTemplate,
      saveFilterConfigToCloud,
      loadFilterConfigFromCloud,
      markets,
      isMarketPresetActive,
      marketPreset,
      loadUniverse,
      setMarketsAndInvalidate,
      advancedOpen,
      persistAdvancedOpen,
      advancedChangeCount,
      filterLayers,
      viewLayers,
      useRegimeFilter,
      setUseRegimeFilter,
      toggleFilterLayer,
      setActiveFilterFamily,
      toggleViewLayer,
      executionRuleActive,
      executionRuleTotal,
      viewFiltersActive,
      setFilterLayers,
      settings,
      updateSetting,
      settingApplies,
      inactiveSettingReason,
      toggleLayeredSetting,
      fieldRules,
      isFieldRuleActive,
      inactiveFieldReason,
      toggleFieldRule,
      fineRuleActive,
      fineRuleTotal,
      setSettings,
      setFieldRules,
      scanMode,
      setScanMode,
      scanBatchSize,
      setScanBatchSize,
      batchStart,
      setBatchStart,
      nextBatch,
      universe,
      diagnostics,
    }}
    search={{
      searchSymbol,
      updateSearchSymbol,
      searchCandidates,
      searchResult,
      searchScopeItems,
      searchLoading,
      searchError,
      runSearch,
      clearSearch,
      applySearchScope,
      setSearchSymbol,
      loadSearchResult,
      favoriteSymbols,
      screenerDecisionResolutions,
      addFavorite,
      saveSessionBeforeStockOpen,
    }}
    resultView={resultView}
    results={{
      rows,
      filtered,
      pagedRows,
      activeSettings,
      analyzedRows,
      universe,
      pendingResults,
      pendingFilteredCount,
      favoriteSymbols,
      screenerDecisionResolutions,
      restoringScan,
    }}
    actions={{
      openReview,
      addFavorite,
      saveSnapshot,
      csv,
      decisionAuditJson,
      commitPendingResults,
      resetScreenerSession,
      saveSessionBeforeStockOpen,
    }}
  />

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

    <QuickReviewModal
      activeModalRow={activeModalRow}
      activeSettings={activeSettings}
      chartListId={chartListId}
      chartScope={chartScope}
      chartSettings={chartSettings}
      modalActiveResolution={modalActiveResolution}
      modalActiveReviewPriority={modalActiveReviewPriority}
      modalDecisionEvidence={modalDecisionEvidence}
      modalDecisionResolutions={modalDecisionResolutions}
      modalRankExplain={modalRankExplain}
      modalReviewAuditSummary={modalReviewAuditSummary}
      modalReviewPosition={modalReviewPosition}
      modalReviewPrioritySummary={modalReviewPrioritySummary}
      modalReviewProfileSummary={modalReviewProfileSummary}
      modalReviewQueueItems={modalReviewQueueItems}
      modalReviewQueueMode={modalReviewQueueMode}
      modalReviewQueueSummary={modalReviewQueueSummary}
      modalReviewRows={modalReviewRows}
      modalReviewSourceDetail={modalReviewSourceDetail}
      modalOriginLabel={modalOriginLabel}
      modalScoreAudit={modalScoreAudit}
      quickReviewOrigin={quickReviewOrigin}
      closeQuickReview={closeQuickReview}
      moveQuickReview={moveQuickReview}
      reopenQuickReviewDecision={reopenQuickReviewDecision}
      resolveQuickReviewDecision={resolveQuickReviewDecision}
      saveQuickReviewStockOpen={saveQuickReviewStockOpen}
      selectQuickReview={selectQuickReview}
      updateChartScope={updateChartScope}
      updateChartSettings={updateChartSettings}
    />
  </>;
}
