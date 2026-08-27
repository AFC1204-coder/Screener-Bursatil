"use client";
// tokens-v2.css se importa globalmente desde app/layout.jsx.
import "../styles/screener.css";
import { useEffect, useMemo, useRef, useState } from "react";
import QuickReviewModal from "@/app/components/screener/QuickReviewModal";
import ScreenerShell from "@/app/components/screener/ScreenerShell";
import { useQuickReviewSession } from "@/app/components/screener/useQuickReviewSession";
import { useResultViewModel } from "@/app/components/screener/useResultViewModel";
import { normalizeMarketList } from "@/lib/markets";
import { FilterFamilyModal } from "@/app/screenerPanels";
import { activeLayerCount, layerStatusText, scanFailureExplanation, searchText, userFacingServiceError } from "@/lib/screenerFormat";
import { verifiedIpoCategory } from "@/lib/screenerResultView";
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { getJson } from "@/lib/clientApi";
import { getLatestScanFromCloud, getLatestScanFromCloudForMarkets, getSettingFromCloud, syncAlertsToCloud, syncFavoriteToCloud, syncScanToCloud, syncSettingToCloud } from "@/lib/cloudSyncClient";
import { dateTime, pct } from "@/lib/formatters";
import { avg, avgVolume } from "@/lib/indicators";
import StorageAlert from "@/app/components/StorageAlert";
import { budgetFor, payloadChars, safeRead, safeRemove, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { alertsFromScan, mergeAlerts } from "@/lib/methodologyAlerts";
import { enrichRowsWithMethodology, findCompatiblePreviousScan, snapshotCompatibilityKey, summarizeMethodology } from "@/lib/methodologyEngine";
import { benchmarkSymbolForRow } from "@/lib/relativeStrength";
import { applyRelativeStrength, buildResearchRow, dataCoverageForRow } from "@/lib/researchRow";
import { normalizeScanErrorGroups } from "@/lib/scanErrorGroups";
import { compositeLabel, volumeEvidence } from "@/lib/scoring";
import { DEFAULT_MARKETS, DEFAULT_SCAN_BATCH_SIZE, DEFAULT_STATUS, DEFAULT_VIEW_LAYERS, MARKET_META, MARKETS, marketName, SCAN_BATCH_SIZES, SCREENER_FILTER_SETTING, SCREENER_SESSION_VERSION, USER_TEMPLATE_LIMIT } from "@/lib/screenerConfig";
import { buildMarketsStaleNotice, filterSelectableMarkets, marketPresetMarkets, scannedMarketsFromScan } from "@/lib/marketAvailability";
import { buildDecisionBrief, buildDecisionEvidenceChecklist, decisionReadinessLabel, explainScreenerRank, rankActionLabel } from "@/lib/screenerExplainability";
import { attachDecisionTrace, auditDecisionRowIssues, buildDecisionAuditExportPayload, buildDecisionTrace, decisionConfidenceLabel, decisionTraceForRow } from "@/lib/decisionAudit";
import { decisionProfileStateForStock } from "@/lib/decisionProfile";
import { buildScreenerDataHealth, dataHealthFilterLabel } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit, scoreAuditFilterLabel, scoreAuditReviewReasons, scoreAuditStatusForRow } from "@/lib/screenerScoreAudit";
import { decisionResolutionForSymbol } from "@/lib/stockDecisionResolution";
import { compactRowsForSession, defaultSortForSettings, failureKind, fastFilterSignature, filterAnalyzedRows, fitScansForBrowser, ipoRadarUniverseRows, manualUniverseRows, normalizeFilterTemplates, perfNow, persistRowForBrowser, scanSettingsSignature, secondsLabel, sectorize, setupModeLabel, sortMetric, uid, universeScopeKey } from "@/lib/screenerPipeline";
import { createDebouncedSessionSaver, screenerFiltersFromScan, withScanScreenerFilters } from "@/lib/screenerFilterFastPath";
import { snapshotCoverageGaps, templateSnapshotAssessment } from "@/lib/templateApplication";
import { buildSessionKeepNotice, buildSnapshotFreshnessNotice, localScanIsSampled, localSampleDetail, manualDataRefreshStatus, screenerSessionRefreshReason, sessionAutoRefreshStatus } from "@/lib/snapshotFreshness";
import { dropForeignMarketSnapshots, pickNightlyUsRestorableScan, restoredSnapshotView, snapshotRowsAreFiltered } from "@/lib/snapshotRestore";
import { nightlyAbsenceNotice, nightlyAbsenceReasonText, nightlyAbsenceStatus } from "@/lib/nightlyAbsence";
import { screenerSessionDataExpired } from "@/lib/nightlyBoundary";
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
  FILTER_LAYERS_CONTRACT_VERSION,
  effectiveSettingsFromLayers,
  fieldLayerKeys,
  inactiveFieldReason,
  inactiveSettingReason,
  isFieldRuleActive,
  layerToggleImpact,
  restoreFilterLayers,
  settingApplies,
  settingLayerDependency,
} from "@/lib/screenerFilterLayers";
import { buildScreenerContract, buildScreenerStockContext } from "@/lib/screenerContracts";
import { createFavoriteFromRow } from "@/lib/stockRows";
import { countryCode, marketFlag, stockUrl } from "@/lib/symbols";


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

export default function Page() {
  const [markets, setMarkets] = useState(DEFAULT_MARKETS);
  const [manual, setManual] = useState("");
  const [settings, setSettings] = useState(settingsForPreset("balanced"));
  const [presetKey, setPresetKey] = useState("balanced");
  const [universe, setUniverse] = useState([]);
  const [universeScope, setUniverseScope] = useState("");
  const [rows, setRows] = useState([]);
  const [analyzedRows, setAnalyzedRows] = useState([]);
  const [scanContext, setScanContext] = useState(null);
  const [scanPerf, setScanPerf] = useState(null);
  const [fail, setFail] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [snapshotNotice, setSnapshotNotice] = useState(null);
  const [restoringScan, setRestoringScan] = useState(false);
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
    perfPeriod,
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
  const advancedBaselineRef = useRef(null);
  const [advancedBaselineVersion, setAdvancedBaselineVersion] = useState(0);
  function syncAdvancedBaseline(nextSettings, nextFilterLayers) {
    advancedBaselineRef.current = {
      settings: { ...nextSettings },
      filterLayers: { ...nextFilterLayers },
    };
    setAdvancedBaselineVersion((value) => value + 1);
  }
  function markAdvancedBaseline(nextSettings, nextFilterLayers) {
    syncAdvancedBaseline(nextSettings, nextFilterLayers);
  }
  // Badge del panel avanzado: ajustes que el usuario ha cambiado respecto al
  // preset/base aplicado al arranque (o al último reset explícito de preset).
  const advancedChangeCount = useMemo(() => {
    const baseline = advancedBaselineRef.current;
    if (!baseline) return 0;
    let count = 0;
    for (const key of new Set([...Object.keys(baseline.settings), ...Object.keys(settings)])) {
      if ((settings[key] ?? null) !== (baseline.settings[key] ?? null)) count += 1;
    }
    for (const key of new Set([...Object.keys(baseline.filterLayers), ...Object.keys(filterLayers)])) {
      if (Boolean(filterLayers[key]) !== Boolean(baseline.filterLayers[key])) count += 1;
    }
    return count;
  }, [settings, filterLayers, advancedBaselineVersion]);
  const [selectedResultSymbol, setSelectedResultSymbol] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [savedFilterTemplates, setSavedFilterTemplates] = useState([]);
  const [selectedFilterTemplateId, setSelectedFilterTemplateId] = useState("");
  const [filterTemplateName, setFilterTemplateName] = useState("");
  const [activeFilterFamily, setActiveFilterFamily] = useState(null);
  const fastFilterSignatureRef = useRef("");
  const restoreScrollRef = useRef(null);
  const sessionAutosaveRef = useRef(null);
  if (!sessionAutosaveRef.current) sessionAutosaveRef.current = createDebouncedSessionSaver();
  // Contexto pendiente para el próximo mensaje del re-filtrado automático:
  // quien cambia criterios en bloque (plantilla, preset, mercados) lo deja
  // aquí y el efecto de re-filtrado lo antepone a su estado ("Plantilla
  // aplicada: X · 42 de 500 a la vista"). Evita que el recálculo pise el
  // mensaje que explica QUÉ acaba de aplicarse.
  const statusContextRef = useRef("");
  // Aviso al que el banner de cobertura sustituyó, para devolverlo cuando la
  // cobertura vuelva a estar completa (el snapshotNotice es un slot único).
  const coverageReplacedNoticeRef = useRef(null);
  const marketsStaleReplacedNoticeRef = useRef(null);
  // Propiedad de los resultados visibles: "none" | "session" | "cloud" | "local".
  // La restauración asíncrona desde Supabase SOLO aplica si nadie produjo
  // resultados mientras resolvía (evita que un snapshot viejo pise resultados
  // ya restaurados por otra vía).
  const resultsOwnerRef = useRef("none");
  const manualRefreshGenRef = useRef(0);
  const marketLoadGenRef = useRef(0);
  function restoreSnapshot(scan, { source = "local", notice = null } = {}) {
    if (!scan || !Array.isArray(scan.rows) || !scan.rows.length) return false;
    resultsOwnerRef.current = source;
    const restoredPresetKey = PRESETS[scan.preset] ? scan.preset : "balanced";
    const restoredSettings = settingsForPreset(restoredPresetKey, scan.settings || {});
    const restoredFilterLayers = restoreFilterLayers(scan.filterLayers, scan.filterLayersVersion, restoredPresetKey);
    const restoredFieldRules = { ...DEFAULT_FIELD_RULES, ...(scan.fieldRules || {}) };
    const restoredViewLayers = scan.viewLayers || DEFAULT_VIEW_LAYERS;
    const restoredUseRegimeFilter = scan.useRegimeFilter !== false;
    const restoredActiveSettings = scan.activeSettings || effectiveSettingsFromLayers(restoredSettings, restoredFilterLayers, restoredFieldRules);
    const restoredRowsAreFiltered = snapshotRowsAreFiltered(scan);
    const actualScannedMarkets = scannedMarketsFromScan(scan, scan.rows);
    const signedMarkets = actualScannedMarkets.length ? actualScannedMarkets : [...markets].sort();
    const nextScanContext = {
      id: scan.id || uid(),
      symbolsCount: scan.rows.length,
      baseCount: scan.rows.length,
      providerErrors: [],
      scannedAt: scan.updatedAt || scan.createdAt || new Date().toISOString(),
      snapshotSource: source === "cloud" ? "supabase" : "local",
      snapshotRowsAreFiltered: restoredRowsAreFiltered,
      // El snapshot restaurado se considera "vigente" respecto a los mercados
      // que realmente cubre (no a la selección UI si divergen).
      settingsSignature: scanSettingsSignature(signedMarkets, manual, scanMode),
      scannedMarkets: signedMarkets,
      scannedScanMode: scanMode,
      screenerFilters: screenerFiltersFromScan(scan),
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
    syncAdvancedBaseline(restoredSettings, restoredFilterLayers);
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
  // Trae los datos de anoche (nube, con la copia local como respaldo) y los
  // restaura si nadie ha producido resultados mientras tanto. La usan el
  // arranque y "Reset sesión": sin botón Ejecutar, este es el único camino
  // que repuebla la tabla, así que ningún reset puede dejarla vacía sin
  // volver a llamarlo.
  //
  // "Los datos de anoche" es UN escaneo concreto: el último nocturno
  // estadounidense (lib/nightlyUsScan.js). Ni el más reciente de la base —el
  // cron europeo de las 22-23h corre después y traía una acción italiana— ni el
  // más reciente del navegador. Cuando ese escaneo no está, la pantalla lo dice
  // con su motivo y se queda vacía; sustituirlo en silencio es lo que rompió el
  // arranque el 16 de agosto de 2026.
  function restoreLatestSnapshot({ isCancelled = () => false } = {}) {
    setRestoringScan(true);
    setStatus("Cargando el escaneo nocturno...");
    const declareNightlyAbsence = (nightly) => {
      if (isCancelled() || resultsOwnerRef.current !== "none") return;
      setSnapshotNotice(nightlyAbsenceNotice(nightly));
      setStatus(nightlyAbsenceStatus(nightly));
    };
    const restoreLocalSnapshot = (reason = "") => {
      if (isCancelled() || resultsOwnerRef.current !== "none") return false;
      const localScan = pickNightlyUsRestorableScan(safeRead(STORAGE_KEYS.scans, []));
      if (!localScan) return false;
      // El universo entero no cabe en localStorage (25 M de caracteres frente
      // a 4,5 M de presupuesto), así que la copia local puede ser una muestra
      // repartida del escaneo — nunca "las mejores". Si lo es, se dice aquí:
      // los filtros sobre esa copia ven menos acciones que los de la nube.
      const sampled = localScanIsSampled(localScan);
      const sampleDetail = sampled ? ` ${localSampleDetail(localScan)}` : "";
      const notice = reason ? {
        tone: "info",
        label: "Copia local",
        detail: `${reason} Se restaura la última copia local del escaneo nocturno estadounidense.${sampleDetail}`,
        source: "local",
      } : null;
      const restored = restoreSnapshot(localScan, { source: "local", notice });
      if (restored) {
        setStatus(sampled
          ? `Última copia local cargada: ${localScan.rows.length} de ${localScan.rowsAvailable} acciones (muestra repartida). Los filtros se aplican al momento sobre estos datos.`
          : `Última copia local cargada: ${localScan.rows.length} acciones. Los filtros se aplican al momento sobre estos datos.`);
      }
      return restored;
    };
    getLatestScanFromCloud().then((result) => {
      // Si mientras resolvía el fetch llegaron resultados por otra vía, el
      // snapshot remoto NO debe pisarlos.
      if (isCancelled() || resultsOwnerRef.current !== "none") return;
      if (!result.ok || result.configured === false) {
        // Este aviso lo pinta ScreenerShell tal cual (snapshotNotice.detail), así
        // que aquí NO puede entrar ni el nombre del servicio ni el error crudo:
        // era la vía que quedaba viva del banner "Supabase: Failed to fetch".
        // El original va a consola, como en loadUniverse.
        if (result.message) console.error("[snapshot] copia en la nube no disponible:", result.message);
        if (!restoreLocalSnapshot(userFacingServiceError(result.message, "La copia guardada en la nube no está disponible."))) {
          declareNightlyAbsence({ reason: result.configured === false ? "supabase-disabled" : "cloud-unavailable" });
        }
        return;
      }
      // El servidor ya devolvió cero escaneos con el motivo: no se busca "otro
      // que valga" ni en la nube ni localmente más allá del propio nocturno.
      const nightly = result.data?.nightly || null;
      const scan = pickNightlyUsRestorableScan(result.data?.scans || []);
      if (!scan) {
        const absence = nightly?.found === false ? nightly : { reason: "no-nightly-scan" };
        if (!restoreLocalSnapshot(nightlyAbsenceReasonText(absence))) declareNightlyAbsence(absence);
        return;
      }
      const notice = buildSnapshotFreshnessNotice(result.data, scan);
      const storedScans = safeRead(STORAGE_KEYS.scans, []);
      safeWrite(STORAGE_KEYS.scans, fitScansForBrowser([scan, ...(Array.isArray(storedScans) ? storedScans.filter((item) => item?.id !== scan.id) : [])]));
      restoreSnapshot(scan, { source: "cloud", notice });
      setStatus(notice?.stale
        ? `Última copia cacheada cargada: ${scan.rows.length} acciones. La nube no respondió al refrescar.`
        : notice?.truncated
          ? `Últimos datos de la nube cargados: ${scan.rows.length} de ${notice.rowsAvailable} acciones (parcial).`
          : `Últimos datos de la nube cargados: ${scan.rows.length} acciones. Los filtros se aplican al momento sobre este universo estable.`);
    }).catch((error) => {
      console.error("[snapshot] fallo al leer la copia en la nube:", error);
      if (isCancelled()) return;
      if (!restoreLocalSnapshot(userFacingServiceError(error?.message, "La copia guardada en la nube no está disponible."))) {
        declareNightlyAbsence({ reason: "nightly-read-failed" });
      }
    }).finally(() => {
      if (!isCancelled()) setRestoringScan(false);
    });
  }
  // ── Caducidad y población de los DATOS de la sesión ───────────────────────
  // La sesión persiste dos cosas de naturaleza distinta: los CRITERIOS del
  // usuario (preset, capas, orden, filtros de vista, búsqueda, scroll), que
  // no caducan nunca, y una referencia a los DATOS (scanRef → copia local),
  // que caducan cada noche cuando corre el nocturno. Hasta el 25-08-2026 la
  // restauración no comparaba fechas y una sesión del 16 de agosto enseñó
  // "scan 16 ago" durante una semana, hasta que el dueño borró el
  // almacenamiento a mano (docs/analisis-screener-uso-real-2026-08-23.md A3).
  // Es el mismo defecto que la caché de discovery del 13-08, y se aplica el
  // mismo criterio: la frontera nocturna de lib/nightlyBoundary.js.
  //
  // P2 (26-08): la copia local es casi siempre una MUESTRA (~576 de ~3309)
  // porque el universo no cabe en localStorage. Rehidratar por scanRef sin
  // pedir la nube filtraba en silencio el 17% del universo. Esta misma
  // función cubre los dos disparadores: caducidad (P1) y muestra (P2).
  //
  // Esta función renueva SOLO los datos. Trae el último nocturno US (misma
  // petición anclada que el arranque en frío) y sustituye analyzedRows y
  // scanContext; las filas visibles las recalcula el efecto de re-filtrado
  // automático con los criterios de la sesión (el id nuevo del escaneo cambia
  // la firma de fastFilterSignature). No puede usar restoreSnapshot: esa vía
  // restaura también preset/capas/orden del escaneo, y pisaría la
  // configuración que la sesión existe para conservar — está bien para
  // "Reset sesión", que promete exactamente eso, no aquí.
  function refreshSessionSnapshotData({ isCancelled = () => false, scanSignature = null, sampledScan = null, manual = false } = {}) {
    const refreshStillApplies = () => {
      if (isCancelled()) return false;
      if (manual) return true;
      return resultsOwnerRef.current === "session";
    };
    setRestoringScan(true);
    const sampled = localScanIsSampled(sampledScan);
    setStatus(manual
      ? manualDataRefreshStatus({ sampled })
      : sessionAutoRefreshStatus({ sampled }));
    if (sampled) setSnapshotNotice(buildSessionKeepNotice({ scan: sampledScan }));
    // Si la renovación no puede completarse, la sesión se queda como estaba
    // (datos viejos o muestra local, con su fecha real visible) y se dice:
    // nunca se vacía la tabla ni se sustituye por otro escaneo que "valga".
    const keepSessionData = (reason = "") => {
      if (!refreshStillApplies()) return;
      if (manual && resultsOwnerRef.current === "none") {
        setSnapshotNotice(buildSessionKeepNotice({ reason, scan: sampledScan }));
        setStatus(reason || "No se pudo cargar el escaneo nocturno.");
        return;
      }
      if (!manual && resultsOwnerRef.current !== "session") return;
      setSnapshotNotice(buildSessionKeepNotice({ reason, scan: sampledScan }));
      setStatus(sampled
        ? `No se pudo actualizar el escaneo nocturno; se muestran ${sampledScan.rows.length} de ${sampledScan.rowsAvailable} acciones (muestra repartida).`
        : manual
          ? "No se pudo actualizar el escaneo nocturno; se muestran los datos cargados."
          : "No se pudo actualizar el escaneo nocturno; se muestran los datos guardados de la sesión.");
    };
    getLatestScanFromCloud().then((result) => {
      // Si mientras resolvía el fetch los resultados cambiaron de dueño (un
      // reset, un scan), esta renovación ya no aplica — salvo refresh manual
      // explícito (P4), que sigue hasta que el usuario lo cancele.
      if (!refreshStillApplies()) return;
      if (!result.ok || result.configured === false) {
        if (result.message) console.error("[snapshot] renovación de sesión: la nube no está disponible:", result.message);
        keepSessionData(userFacingServiceError(result.message, "La copia guardada en la nube no está disponible."));
        return;
      }
      const nightly = result.data?.nightly || null;
      const scan = pickNightlyUsRestorableScan(result.data?.scans || []);
      if (!scan) {
        keepSessionData(nightlyAbsenceReasonText(nightly?.found === false ? nightly : { reason: "no-nightly-scan" }));
        return;
      }
      // La copia local pasa a ser la del nocturno vigente, para que la
      // rehidratación por scanRef de la próxima recarga lo encuentre.
      const storedScans = safeRead(STORAGE_KEYS.scans, []);
      safeWrite(STORAGE_KEYS.scans, fitScansForBrowser([scan, ...(Array.isArray(storedScans) ? storedScans.filter((item) => item?.id !== scan.id) : [])]));
      applyFreshSnapshotData(scan, {
        notice: buildSnapshotFreshnessNotice(result.data, scan),
        scanSignature,
      });
    }).catch((error) => {
      console.error("[snapshot] renovación de sesión: fallo al leer la nube:", error);
      if (!refreshStillApplies()) return;
      keepSessionData(userFacingServiceError(error?.message, "La copia guardada en la nube no está disponible."));
    }).finally(() => {
      if (isCancelled()) return;
      if (!manual && resultsOwnerRef.current === "none") return;
      setRestoringScan(false);
    });
  }
  // El complemento de restoreSnapshot: datos nuevos, criterios intactos.
  // scanSignature trae markets/manual/scanMode de la SESIÓN restaurada — no
  // puede leerlos del estado porque este closure se creó en el primer render,
  // antes de que la restauración los aplicara.
  function applyFreshSnapshotData(scan, { notice = null, scanSignature = null } = {}) {
    if (!scan || !Array.isArray(scan.rows) || !scan.rows.length) return false;
    resultsOwnerRef.current = "cloud";
    const signedMarkets = (() => {
      const fromScan = scannedMarketsFromScan(scan, scan.rows);
      if (fromScan.length) return fromScan;
      return Array.isArray(scanSignature?.markets) && scanSignature.markets.length ? scanSignature.markets : markets;
    })();
    const signedManual = scanSignature?.manual ?? manual;
    const signedScanMode = scanSignature?.scanMode || scanMode;
    const nextScanContext = {
      id: scan.id || uid(),
      symbolsCount: scan.rows.length,
      baseCount: scan.rows.length,
      providerErrors: [],
      scannedAt: scan.updatedAt || scan.createdAt || new Date().toISOString(),
      snapshotSource: "supabase",
      snapshotRowsAreFiltered: snapshotRowsAreFiltered(scan),
      // Igual que en restoreSnapshot: el snapshot renovado se considera
      // vigente respecto a los criterios con los que convive (los de la
      // sesión); si markets/manual/scanMode cambian después, el banner de
      // staleness lo reflejará.
      settingsSignature: scanSettingsSignature(signedMarkets, signedManual, signedScanMode),
      scannedMarkets: [...signedMarkets].sort(),
      scannedScanMode: signedScanMode,
      screenerFilters: screenerFiltersFromScan(scan),
    };
    setAnalyzedRows(scan.rows);
    setScanContext(nextScanContext);
    setSnapshotNotice(notice);
    // Los errores de proveedor persistidos eran del escaneo viejo; con los
    // datos renovados, mantenerlos sería atribuirle al nocturno de hoy los
    // fallos de otro día.
    setFail([]);
    // El re-filtrado automático pondrá su propio estado ("N de M a la
    // vista"); este prefijo hace que además diga de dónde salen los datos.
    statusContextRef.current = `Datos actualizados al escaneo nocturno (${dateTime(nextScanContext.scannedAt)}); tus filtros se mantienen`;
    return true;
  }
  useEffect(() => {
    let cancelled = false;
    let restoredRowsCount = 0;
    let sampledScan = null;
    setFavoriteSymbols(new Set(safeRead(STORAGE_KEYS.favorites, []).map((x) => x.symbol)));
    setChartSettings(readChartSettings());
    setSavedFilterTemplates(normalizeFilterTemplates(safeRead(STORAGE_KEYS.screenerFilterTemplates, [])));
    const session = safeRead(STORAGE_KEYS.screenerSession, null);
    if (session?.version === SCREENER_SESSION_VERSION) {
      const restoredPresetKey = PRESETS[session.presetKey] ? session.presetKey : "balanced";
      const restoredMarkets = filterSelectableMarkets(
        Array.isArray(session.markets) && session.markets.length ? session.markets : DEFAULT_MARKETS,
      );
      const restoredManual = session.manual || "";
      const restoredUniverse = Array.isArray(session.universe) ? session.universe : [];
      let restoredRows = Array.isArray(session.rows) ? session.rows : [];
      let restoredAnalyzedRows = Array.isArray(session.analyzedRows) ? session.analyzedRows : [];
      const restoredSettings = settingsForPreset(restoredPresetKey, session.settings || {});
      const restoredFilterLayers = restoreFilterLayers(session.filterLayers, session.filterLayersVersion, restoredPresetKey);
      const restoredFieldRules = { ...DEFAULT_FIELD_RULES, ...(session.fieldRules || {}) };
      const restoredMarketHealth = session.marketHealth || null;
      const restoredUseRegimeFilter = session.useRegimeFilter !== false;
      const restoredActiveSettings = session.activeSettings || effectiveSettingsFromLayers(restoredSettings, restoredFilterLayers, restoredFieldRules);
      const restoredScrollY = Number(session.scrollY);
      // Sesión con referencia en vez de filas: rehidrata desde el snapshot
      // local y recalcula las visibles con los criterios de la SESIÓN (nunca
      // los del scan — eso es lo que distingue esta vía de restoreSnapshot).
      // El lookup sale del if de rehidratación porque P2 también aplica cuando
      // la sesión ya trae analyzedRows: hay que saber si el escaneo local
      // referenciado es una muestra (~576 de ~3309) para pedir el universo.
      const storedScans = safeRead(STORAGE_KEYS.scans, []);
      const referencedScan = session.scanRef?.id
        ? ((Array.isArray(storedScans) ? storedScans : []).find((scan) => scan?.id === session.scanRef.id)
          || pickNightlyUsRestorableScan(storedScans))
        : null;
      if (!restoredRows.length && !restoredAnalyzedRows.length && session.scanRef?.id && session.scanContext) {
        // Si el escaneo referenciado ya no está, el respaldo es el nocturno
        // estadounidense — no "el mejor snapshot local que haya", que podía ser
        // el de otro mercado.
        if (referencedScan?.rows?.length) {
          const rehydrateContext = withScanScreenerFilters({ ...session.scanContext, marketHealth: restoredMarketHealth, useRegimeFilter: restoredUseRegimeFilter }, referencedScan);
          const rehydratedView = restoredSnapshotView(referencedScan, restoredActiveSettings, rehydrateContext, filterAnalyzedRows);
          restoredAnalyzedRows = rehydratedView.analyzedRows;
          restoredRows = rehydratedView.rows;
        }
      }
      if (localScanIsSampled(referencedScan)) sampledScan = referencedScan;
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
      setScanContext(withScanScreenerFilters(session.scanContext || null, referencedScan));
      setScanPerf(session.scanPerf || null);
      setSnapshotNotice(session.snapshotNotice || null);
      // normalizeScanErrorGroups cubre las sesiones guardadas con el formato
      // plano anterior (una entrada por símbolo).
      setFail(normalizeScanErrorGroups(session.fail));
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
      // La cola del modal se restaura de STORAGE_KEYS.review (su única copia;
      // antes la sesión guardaba un duplicado en quickReviewRows). Las
      // sesiones antiguas que aún lo traen conservan su vía.
      if (Array.isArray(session.quickReviewRows) && session.quickReviewRows.length) {
        restoreQuickReviewSession(session.quickReviewRows, Number.isFinite(session.quickReviewIndex) ? session.quickReviewIndex : 0);
      } else {
        const storedReview = safeRead(STORAGE_KEYS.review, {});
        if (storedReview?.source === "current" && Array.isArray(storedReview.rows) && storedReview.rows.length) {
          restoreQuickReviewSession(storedReview.rows, Number.isFinite(storedReview.currentIndex) ? storedReview.currentIndex : 0);
        }
      }
      if (restoredRows.length && restoredAnalyzedRows.length && session.scanContext) {
        fastFilterSignatureRef.current = fastFilterSignature(
          restoredAnalyzedRows,
          restoredActiveSettings,
          { ...withScanScreenerFilters(session.scanContext, referencedScan), marketHealth: restoredMarketHealth, useRegimeFilter: restoredUseRegimeFilter },
        );
      }
      setStatus(
        restoredRows.length
          ? `Sesión restaurada: ${restoredRows.length} acciones en el screener.`
          : restoredAnalyzedRows.length
            ? `Sesión restaurada: ${restoredAnalyzedRows.length} acciones analizadas; recalculando filtros.`
            : DEFAULT_STATUS
      );
      syncAdvancedBaseline(restoredSettings, restoredFilterLayers);
    } else {
      syncAdvancedBaseline(settingsForPreset("balanced"), filterLayersForPreset("balanced"));
    }
    const refreshReason = restoredRowsCount
      ? screenerSessionRefreshReason({
        expired: screenerSessionDataExpired(session),
        sampled: Boolean(sampledScan),
      })
      : null;
    if (!restoredRowsCount) {
      restoreLatestSnapshot({ isCancelled: () => cancelled });
    } else if (refreshReason) {
      // P1: datos anteriores a la frontera nocturna. P2: copia local muestreada
      // (fitScansForBrowser deja ~576 de ~3309). Las dos disparan el MISMO
      // getLatestScanFromCloud + applyFreshSnapshotData; no se dobla el fetch.
      refreshSessionSnapshotData({
        isCancelled: () => cancelled,
        sampledScan,
        scanSignature: {
          markets: Array.isArray(session?.markets) && session.markets.length ? session.markets : DEFAULT_MARKETS,
          manual: session?.manual || "",
          scanMode: session?.scanMode || "all",
        },
      });
    }
    setSessionReady(true);
    // Migración perezosa. Dos cosas, ambas idempotentes:
    //
    // 1. Los snapshots del cron de OTROS mercados que el arranque llegó a
    //    cachear mientras pedía "el más reciente" (JP, IT-ES…). No los borra
    //    solo esta pantalla: encabezan la lista local que leen el radar de
    //    OPVs, sectores y el pulso de escaneos de salud de mercado.
    // 2. El recorte al presupuesto de los snapshots guardados antes de que
    //    existiera (filas con objectiveMetricAudit/decisionTrace, hasta 50).
    const storedScansOnStartup = safeRead(STORAGE_KEYS.scans, []);
    const storedScansForBudget = dropForeignMarketSnapshots(storedScansOnStartup);
    if (storedScansForBudget.length !== (Array.isArray(storedScansOnStartup) ? storedScansOnStartup.length : 0)) {
      safeWrite(STORAGE_KEYS.scans, storedScansForBudget);
    }
    if (payloadChars(storedScansForBudget) > (budgetFor(STORAGE_KEYS.scans) || Infinity)) {
      safeWrite(STORAGE_KEYS.scans, fitScansForBrowser(storedScansForBudget));
    }
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

  // La sesión ya NO guarda filas: guarda los criterios y una referencia al
  // snapshot local (STORAGE_KEYS.scans) del que salieron los datos. Medido el
  // 2026-08-15: la sesión pesaba 31,7 MB porque duplicaba dentro del mismo
  // localStorage las 500 filas que scans ya tenía (analyzedRows, 18,8 MB) más
  // las 282 visibles sin compactar (11,4 MB). Con la referencia, la sesión
  // queda en decenas de KB y las filas viven UNA vez, en scans, en proyección
  // de persistencia (persistRowsForBrowser). Al restaurar, restoreSessionData
  // rehidrata analyzedRows desde esa referencia y recalcula las visibles con
  // los criterios de la sesión.
  function buildScreenerSessionPayload(overrides = {}) {
    const previousSession = safeRead(STORAGE_KEYS.screenerSession, {});
    return {
      version: SCREENER_SESSION_VERSION,
      updatedAt: new Date().toISOString(),
      markets,
      manual,
      settings,
      presetKey,
      universeScope,
      universeCount: universe.length || null,
      scanRef: scanContext?.id ? { id: scanContext.id, count: analyzedRows.length || null } : null,
      rowsCount: rows.length || null,
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
      perfPeriod,
      scanMode,
      batchStart,
      scanBatchSize,
      resultPageSize,
      resultPage,
      marketHealth,
      useRegimeFilter,
      filterLayers,
      filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
      fieldRules,
      viewLayers,
      searchSymbol,
      searchResult: persistRowForBrowser(searchResult),
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
      // Red de seguridad: sin el estado del último scan la sesión son solo
      // criterios (~KBs) y siempre cabe. safeWrite ya notificó el fallo.
      return safeWrite(STORAGE_KEYS.screenerSession, {
        ...sessionPayload,
        scanRef: null,
        fail: [],
        diagnostics: null,
        searchResult: null,
        lastOpenedStockContext: null,
        storageNote: "Sesión reducida a los criterios por falta de espacio.",
      });
    }
    return saved;
  }

  function saveSessionBeforeStockOpen(rowOrSymbol = null) {
    const row = rowOrSymbol && typeof rowOrSymbol === "object" ? rowOrSymbol : null;
    const symbol = typeof rowOrSymbol === "string" ? rowOrSymbol : row?.symbol;
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    sessionAutosaveRef.current?.cancel();
    persistScreenerSession({
      lastOpenedStockSymbol: symbol || "",
      lastOpenedStockAt: new Date().toISOString(),
      lastOpenedStockContext: buildScreenerStockOpenContext(rowOrSymbol),
      scrollY,
    });
  }

  useEffect(() => {
    if (!sessionReady) return;
    if (restoringScan && !rows.length) return;
    sessionAutosaveRef.current?.schedule(persistScreenerSession);
    // La sesión persiste criterios y referencias, no filas: universe, rows,
    // analyzedRows, searchCandidates y quickReviewRows salieron del payload y
    // de estas dependencias. Los cambios de resultados llegan igualmente vía
    // scanContext/scanPerf (scan y re-filtrados los actualizan siempre).
    // Debounce: el gesto (preset/orden) disparaba 4 setItem en 9 s; el
    // guardado no va en el hot path. pagehide/unmount hace flush.
  }, [sessionReady, markets, manual, settings, presetKey, universeScope, scanContext, scanPerf, snapshotNotice, fail, diagnostics, status, themeFilter, sectorFilter, industryFilter, countryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, sort, perfPeriod, scanMode, batchStart, scanBatchSize, resultPageSize, resultPage, marketHealth, restoringScan, useRegimeFilter, filterLayers, fieldRules, viewLayers, searchSymbol, searchResult, quickReviewIndex]);

  useEffect(() => {
    function flushSessionAutosave() {
      sessionAutosaveRef.current?.flush();
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flushSessionAutosave();
    }
    window.addEventListener("pagehide", flushSessionAutosave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushSessionAutosave);
      document.removeEventListener("visibilitychange", onVisibility);
      flushSessionAutosave();
    };
  }, []);

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
  // Re-filtrado automático: cualquier cambio de criterios (a mano, por
  // plantilla o por preset) se aplica al momento sobre las filas ya cargadas.
  // No hay botón intermedio: este efecto ES la aplicación de filtros.
  useEffect(() => {
    if (!sessionReady || !analyzedRows.length || !scanContext) return;
    const context = { ...scanContext, marketHealth, useRegimeFilter };
    const signature = fastFilterSignature(analyzedRows, activeSettings, context);
    if (fastFilterSignatureRef.current === signature) return;
    const filteredView = filterAnalyzedRows(analyzedRows, activeSettings, context);
    fastFilterSignatureRef.current = signature;
    setRows(filteredView.rows);
    setDiagnostics(filteredView.diagnostics);
    setResultPage(1);
    setScanPerf((prev) => ({
      ...(prev || {}),
      lastFilterMs: filteredView.filterMs,
      lastFastFilterMs: filteredView.filterMs,
      lastFilterPath: filteredView.path || "rules",
      lastFilterRescored: Boolean(filteredView.rescored),
      analyzedRows: analyzedRows.length,
      fastRefilters: (prev?.fastRefilters || 0) + 1,
    }));
    // El contexto pendiente ("Plantilla aplicada: X", "Mercados actualizados")
    // se antepone al resultado para que el recálculo no pise la explicación.
    const prefix = statusContextRef.current;
    statusContextRef.current = "";
    // El orden visible no cambia aquí: filtrar quita o repone filas; el
    // criterio de orden solo lo mueve el usuario (selector o plantilla).
    setStatus(filteredView.rows.length
      ? `${prefix ? `${prefix} · ` : ""}${filteredView.rows.length} de ${analyzedRows.length} acciones a la vista (filtro aplicado en ${secondsLabel(filteredView.filterMs)}).`
      : `${prefix ? `${prefix} · ` : ""}Ningún valor de los ${analyzedRows.length} analizados pasa este filtro. Afloja alguna condición o cambia de plantilla; los datos siguen cargados.`);
  }, [sessionReady, analyzedRows, scanContext, activeSettings, marketHealth, useRegimeFilter]);
  const executionLayerTotal = EXECUTION_LAYERS.length + 1;
  const executionLayerActive = activeLayerCount(filterLayers) + (useRegimeFilter ? 1 : 0);
  const executionRuleTotal = REGIME_LAYER.count + EXECUTION_LAYERS.reduce((sum, layer) => sum + layer.count, 0);
  const executionRuleActive = (useRegimeFilter ? REGIME_LAYER.count : 0) + EXECUTION_LAYERS.reduce((sum, layer) => sum + (filterLayers[layer.key] ? layer.count : 0), 0);
  const fineRuleTotal = FILTER_FIELDS.length;
  const fineRuleActive = FILTER_FIELDS.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length;
  const kpiUniverseCount = universe.length || scanContext?.baseCount || analyzedRows.length || rows.length;
  // Estado vacío de la tabla, con la causa dicha (punto 4 del contrato sin
  // botón): cargando ≠ cero-por-filtro ≠ sin datos. Nunca "Ejecuta un scan".
  const resultsEmptyLabel = restoringScan
    ? "Cargando los últimos datos guardados..."
    : analyzedRows.length
      ? `Ningún valor de los ${analyzedRows.length} analizados pasa este filtro. Afloja alguna condición o cambia de plantilla; los datos siguen cargados.`
      : "No hay datos cargados todavía. Los datos de anoche se cargan al abrir la página; si no aparecen, recarga.";
  // --- Staleness de scan-settings -------------------------------------------
  // El scan mostrado es "vigente" si markets/manual/scanMode actuales coinciden
  // con los vigentes al completar el último scan (guardados en scanContext).
  // NO comparamos activeSettings/filterLayers/useRegimeFilter/marketHealth:
  // esos son post-filtrado en cliente sobre analyzedRows (filterAnalyzedRows),
  // nunca producen staleness del universo. Solo el banner global + dots de
  // control (markets/scanMode) consumen estos flags.
  const currentSettingsSignature = useMemo(() => scanSettingsSignature(markets, manual, scanMode), [markets, manual, scanMode]);
  const scannedSettingsSignature = scanContext?.settingsSignature || null;
  const scanStale = Boolean(scanContext && scannedSettingsSignature && scannedSettingsSignature !== currentSettingsSignature);
  // Dots por control: comparan el valor actual de cada campo con el capturado
  // en el último scan. marketsStale y scanModeStale solo son true cuando el
  // banner global también lo es (no señalamos "cambió y luego se deshizo" si
  // el resultado final coincide). manual no tiene control visible en el shell,
  // así que no expone dot (lo cubre el banner global).
  const scannedMarketsKey = (scanContext?.scannedMarkets || []).slice().sort().join(",");
  const marketsStale = scanStale && (markets.slice().sort().join(",") !== scannedMarketsKey);
  const scanModeStale = scanStale && scanContext && scanMode !== scanContext?.scannedScanMode;
  useEffect(() => {
    if (!sessionReady || !marketsStale) {
      setSnapshotNotice((prev) => {
        if (prev?.source !== "markets-stale") return prev;
        const replaced = marketsStaleReplacedNoticeRef.current;
        marketsStaleReplacedNoticeRef.current = null;
        return replaced;
      });
      return;
    }
    const notice = buildMarketsStaleNotice({
      scannedMarkets: scanContext?.scannedMarkets || [],
      selectedMarkets: markets,
      rowCount: analyzedRows.length,
    });
    if (!notice) return;
    setSnapshotNotice((prev) => {
      if (prev?.source !== "markets-stale") marketsStaleReplacedNoticeRef.current = prev || null;
      return notice;
    });
  }, [sessionReady, marketsStale, scanContext?.scannedMarkets, markets, analyzedRows.length]);
  // Aviso de cobertura (punto único): si la selección de mercados pide
  // mercados sin filas en los datos cargados, se dice — nunca se vacía la
  // tabla. Con pocos huecos se nombran; con mayoría de huecos se nombra lo
  // cubierto (la lista de 28 mercados era ilegible). El aviso ocupa el slot
  // del snapshotNotice y devuelve el anterior cuando deja de aplicar.
  function announceCoverage(requestedMarkets) {
    const gaps = snapshotCoverageGaps(requestedMarkets, analyzedRows);
    if (gaps.length) {
      const covered = (requestedMarkets || []).filter((code) => !gaps.includes(code));
      const detail = gaps.length <= 3
        ? `Los datos cargados no incluyen ${gaps.map((code) => marketName(code)).join(", ")}: esos mercados no aparecen en la tabla.`
        : covered.length
          ? `Los datos cargados solo incluyen ${covered.map((code) => marketName(code)).join(", ")}. Los otros ${gaps.length} mercados seleccionados no aparecen en la tabla.`
          : `Ninguno de los ${gaps.length} mercados seleccionados tiene filas en los datos cargados.`;
      setSnapshotNotice((prev) => {
        if (prev?.source !== "coverage") coverageReplacedNoticeRef.current = prev || null;
        return { tone: "warn", label: "Cobertura", detail, source: "coverage" };
      });
    } else {
      setSnapshotNotice((prev) => {
        if (prev?.source !== "coverage") return prev;
        const replaced = coverageReplacedNoticeRef.current;
        coverageReplacedNoticeRef.current = null;
        return replaced;
      });
    }
    return gaps;
  }
  function loadScanForMarketSelection(nextMarkets, label = "Mercados actualizados.") {
    const normalized = normalizeMarketList(nextMarkets, []);
    const nextKey = normalized.slice().sort().join(",");
    const scannedKey = (scanContext?.scannedMarkets || []).slice().sort().join(",");
    if (nextKey === scannedKey) {
      setStatus(label);
      return;
    }
    // v1: solo auto-carga con un mercado; multi-mercado conserva filas + banner stale.
    if (normalized.length !== 1) {
      setStatus(label);
      return;
    }
    const marketCode = normalized[0];
    const useNightlyUs = marketCode === "US";
    const loadGen = ++marketLoadGenRef.current;
    setRestoringScan(true);
    setStatus(useNightlyUs
      ? "Cargando el escaneo nocturno..."
      : `Cargando materializado ${marketName(marketCode)}…`);
    const fetchPromise = useNightlyUs ? getLatestScanFromCloud() : getLatestScanFromCloudForMarkets(normalized);
    fetchPromise.then((result) => {
      if (marketLoadGenRef.current !== loadGen) return;
      if (!result.ok || result.configured === false) {
        if (result.message) console.error("[snapshot] materializado por mercado:", result.message);
        setStatus(userFacingServiceError(result.message, "No se pudo cargar el materializado de ese mercado."));
        return;
      }
      if (useNightlyUs) {
        const nightly = result.data?.nightly || null;
        const scan = pickNightlyUsRestorableScan(result.data?.scans || []);
        if (!scan) {
          setSnapshotNotice(nightlyAbsenceNotice(nightly?.found === false ? nightly : { reason: "no-nightly-scan" }));
          setStatus(nightlyAbsenceStatus(nightly?.found === false ? nightly : { reason: "no-nightly-scan" }));
          return;
        }
        const storedScans = safeRead(STORAGE_KEYS.scans, []);
        safeWrite(STORAGE_KEYS.scans, fitScansForBrowser([scan, ...(Array.isArray(storedScans) ? storedScans.filter((item) => item?.id !== scan.id) : [])]));
        applyFreshSnapshotData(scan, {
          notice: buildSnapshotFreshnessNotice(result.data, scan),
          scanSignature: { markets: normalized, manual, scanMode },
        });
        setStatus(`Últimos datos de la nube cargados: ${scan.rows.length} acciones (${marketName("US")}).`);
        return;
      }
      const marketsMeta = result.data?.markets || null;
      if (marketsMeta?.found === false) {
        if (marketsMeta.reason === "insufficient-rows") {
          setSnapshotNotice({
            tone: "warn",
            label: "Materializado",
            detail: `${marketName(marketCode)}: materializado insuficiente (${marketsMeta.rowCount ?? 0} filas). Usa escaneo manual o espera al cron.`,
            source: "materialized",
          });
        } else if (marketsMeta.reason === "materialized-not-publishable") {
          setSnapshotNotice({
            tone: "warn",
            label: "Materializado",
            detail: `${marketName(marketCode)}: el último materializado no es publicable (${marketsMeta.rejectedScan?.status || "failed"}). Usa escaneo manual o espera al cron.`,
            source: "materialized",
          });
        } else {
          // sin scan exacto (p. ej. HK/AU solo tienen lotes mixtos US,HK,AU)
          setSnapshotNotice({
            tone: "warn",
            label: "Materializado",
            detail: `${marketName(marketCode)}: no hay materializado publicable para este mercado. Usa escaneo manual o espera al cron.`,
            source: "materialized",
          });
        }
        setStatus(label);
        return;
      }
      const scan = (result.data?.scans || [])[0];
      if (!scan || !Array.isArray(scan.rows) || !scan.rows.length) {
        setStatus(`${marketName(marketCode)}: sin materializado publicable en la nube.`);
        return;
      }
      const storedScans = safeRead(STORAGE_KEYS.scans, []);
      safeWrite(STORAGE_KEYS.scans, fitScansForBrowser([scan, ...(Array.isArray(storedScans) ? storedScans.filter((item) => item?.id !== scan.id) : [])]));
      applyFreshSnapshotData(scan, {
        notice: buildSnapshotFreshnessNotice(result.data, scan),
        scanSignature: { markets: normalized, manual, scanMode },
      });
      setStatus(`Materializado ${marketName(marketCode)} cargado: ${scan.rows.length} acciones.`);
    }).catch((error) => {
      console.error("[snapshot] materializado por mercado:", error);
      if (marketLoadGenRef.current !== loadGen) return;
      setStatus(userFacingServiceError(error?.message, "No se pudo cargar el materializado de ese mercado."));
    }).finally(() => {
      if (marketLoadGenRef.current === loadGen) setRestoringScan(false);
    });
  }
  function setMarketsAndInvalidate(nextMarkets, label = "Mercados actualizados.") {
    const normalized = filterSelectableMarkets(
      (Array.isArray(nextMarkets) ? nextMarkets : [])
        .filter((code, index, list) => MARKET_META[code] && list.indexOf(code) === index),
    );
    setMarkets(normalized);
    setUniverse([]);
    setUniverseScope("");
    announceCoverage(normalized);
    loadScanForMarketSelection(normalized, label);
  }
  function resetScreenerSession() {
    manualRefreshGenRef.current += 1;
    safeRemove(STORAGE_KEYS.screenerSession);
    resultsOwnerRef.current = "none";
    const nextSettings = settingsForPreset("balanced");
    const nextLayers = filterLayersForPreset("balanced");
    syncAdvancedBaseline(nextSettings, nextLayers);
    setMarkets(DEFAULT_MARKETS);
    setManual("");
    setSettings(nextSettings);
    setPresetKey("balanced");
    setUniverse([]);
    setUniverseScope("");
    setRows([]);
    setAnalyzedRows([]);
    setScanContext(null);
    setScanPerf(null);
    fastFilterSignatureRef.current = "";
    setFail([]);
    setDiagnostics(null);
    resetResultView(defaultSortForSettings(settingsForPreset("balanced")));
    setErr("");
    setScanMode("all");
    setBatchStart(0);
    setScanBatchSize(DEFAULT_SCAN_BATCH_SIZE);
    setMarketHealth(null);
    setUseRegimeFilter(true);
    setFilterLayers(nextLayers);
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
    setSelectedResultSymbol("");
    // Un reset tiene que dejar al usuario en un estado BUENO, no repetir el que
    // le hizo pulsarlo. Antes de recargar se tiran los snapshots cacheados de
    // otros mercados —el residuo del arranque que pedía "el más reciente"—; si
    // no, la copia local seguía sirviendo el mismo escaneo equivocado.
    const storedScans = safeRead(STORAGE_KEYS.scans, []);
    const cleanedScans = dropForeignMarketSnapshots(storedScans);
    if (cleanedScans.length !== (Array.isArray(storedScans) ? storedScans.length : 0)) safeWrite(STORAGE_KEYS.scans, cleanedScans);
    setSnapshotNotice(null);
    // Sin botón Ejecutar, un reset que dejara la tabla vacía sería un camino
    // sin salida: se recargan los datos de anoche inmediatamente.
    setStatus("Criterios reiniciados. Recargando el escaneo nocturno...");
    restoreLatestSnapshot();
  }
  function refreshScreenerSnapshotData() {
    if (restoringScan) return;
    const storedScans = safeRead(STORAGE_KEYS.scans, []);
    const referencedScan = scanContext?.id
      ? (Array.isArray(storedScans) ? storedScans : []).find((scan) => scan?.id === scanContext.id)
      : null;
    const sampledScan = localScanIsSampled(referencedScan) ? referencedScan : null;
    const gen = ++manualRefreshGenRef.current;
    refreshSessionSnapshotData({
      manual: true,
      isCancelled: () => manualRefreshGenRef.current !== gen,
      sampledScan,
      scanSignature: { markets, manual, scanMode },
    });
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
    statusContextRef.current = `Patrón aplicado: ${setupModeLabel(nextMode)}`;
    setStatus(`Patrón aplicado: ${setupModeLabel(nextMode)}.`);
  }
  const updateSetting = (key, value) => {
    if (key === "setupMode") {
      applySetupMode(value);
      return;
    }
    setSettings((prev) => ({ ...prev, [key]: value }));
  };
  const toggleFilterLayer = (key) => {
    if (filterLayers[key] !== false) {
      const impact = layerToggleImpact({ settings, filterLayers, fieldRules, layerKey: key, nextOn: false });
      if (impact.warnings.length && !window.confirm(`${impact.warnings.join("\n\n")}\n\n¿Apagar igualmente?`)) return;
    }
    setFilterLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };
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
      filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
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
      perfPeriod,
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
    if (!template.config || typeof template.config !== "object") {
      // Plantilla ilegible: no se toca nada de lo que hay en pantalla.
      setStatus(`La plantilla ${template.name} no se pudo leer. Se conserva el filtro actual.`);
      return;
    }
    setFilterTemplateName(template.name);
    // La plantilla se re-aplica sobre el snapshot ya cargado: applyFilterConfig
    // cambia criterios (nunca datos) y el re-filtrado automático hace el resto.
    // La evaluación previa decide el mensaje sin esperar al efecto.
    const assessment = templateSnapshotAssessment(template.config, analyzedRows, { marketHealth });
    applyFilterConfig(template.config);
    if (!assessment.analyzedCount) {
      setStatus(`Plantilla aplicada: ${template.name}. Aún no hay datos cargados; se aplicará en cuanto lleguen.`);
      return;
    }
    statusContextRef.current = `Plantilla aplicada: ${template.name}`;
    setStatus(assessment.filteredCount === 0
      ? `Plantilla aplicada: ${template.name}. Ningún valor de los ${assessment.analyzedCount} analizados la pasa; los datos siguen cargados.`
      : `Plantilla aplicada: ${template.name}: ${assessment.filteredCount} de ${assessment.analyzedCount} acciones a la vista.`);
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
  // Aplica los criterios de una plantilla (o de la copia en nube) SIN tocar
  // los datos cargados. Hasta 2026-08-15 esto terminaba en clear(): borraba
  // analyzedRows y scanContext —las dos precondiciones del re-filtrado
  // automático— y dejaba la tabla vacía pidiendo un scan sin necesidad alguna:
  // todos los criterios de fila se resuelven en cliente. Lo único que el
  // snapshot no puede satisfacer es cobertura de mercados, y eso se AVISA
  // (announceCoverage), no se vacía.
  function applyFilterConfig(config = {}) {
    const nextPresetKey = PRESETS[config.presetKey] ? config.presetKey : "balanced";
    const nextPreset = PRESETS[nextPresetKey] || PRESETS.balanced;
    const nextMarkets = Array.isArray(config.markets) && config.markets.length ? config.markets : DEFAULT_MARKETS;
    const nextSettings = settingsForPreset(nextPresetKey, config.settings || {});
    const nextFilterLayers = restoreFilterLayers(config.filterLayers, config.filterLayersVersion, nextPresetKey);
    syncAdvancedBaseline(nextSettings, nextFilterLayers);
    setMarkets(nextMarkets);
    setManual(config.manual || "");
    setPresetKey(nextPresetKey);
    setSettings(nextSettings);
    setUseRegimeFilter(config.useRegimeFilter !== false);
    setFilterLayers(nextFilterLayers);
    setFieldRules({ ...DEFAULT_FIELD_RULES, ...(config.fieldRules || {}) });
    setViewLayers({ ...DEFAULT_VIEW_LAYERS, ...(config.viewLayers || {}) });
    // Las plantillas guardadas antes de 2026-08-15 no traen perfPeriod: se
    // conserva el periodo actual en vez de resetearlo al defecto.
    restoreResultViewSession({ ...config, perfPeriod: config.perfPeriod ?? perfPeriod }, nextPreset.v, { resetPage: true });
    setScanMode(config.scanMode || "all");
    setBatchStart(Number.isFinite(config.batchStart) ? config.batchStart : 0);
    setScanBatchSize(SCAN_BATCH_SIZES.includes(config.scanBatchSize) ? config.scanBatchSize : DEFAULT_SCAN_BATCH_SIZE);
    setUniverse([]);
    setUniverseScope("");
    announceCoverage(nextMarkets);
  }
  async function saveFilterConfigToCloud() {
    setStatus("Guardando filtros en la nube...");
    const result = await syncSettingToCloud({ ...SCREENER_FILTER_SETTING, value: currentFilterConfig() });
    if (result.configured === false) setStatus("Filtros guardados en este dispositivo: la copia en la nube no está activada.");
    else if (result.ok) setStatus("Filtros guardados en la nube.");
    else {
      // El mensaje de la nube puede ser cualquier cosa: "Failed to fetch", un
      // código HTTP, texto del proveedor. A pantalla va traducido y sin nombre
      // de servicio; el original, a consola.
      console.error("[filtros] no se pudieron guardar en la nube:", result.message);
      setStatus(`No se pudieron guardar los filtros en la nube. ${userFacingServiceError(result.message, "Inténtalo de nuevo en unos minutos.")}`);
    }
  }
  async function loadFilterConfigFromCloud() {
    setStatus("Cargando filtros desde la nube...");
    const result = await getSettingFromCloud(SCREENER_FILTER_SETTING.type, SCREENER_FILTER_SETTING.key);
    if (result.configured === false) {
      setStatus("La copia en la nube no está activada. Se mantienen los filtros de este dispositivo.");
      return;
    }
    if (!result.ok) {
      console.error("[filtros] no se pudieron cargar de la nube:", result.message);
      setStatus(`No se pudieron cargar los filtros de la nube. ${userFacingServiceError(result.message, "Inténtalo de nuevo en unos minutos.")}`);
      return;
    }
    const value = result.data?.setting?.value;
    if (!value) {
      setStatus("Todavía no hay filtros guardados en la nube.");
      return;
    }
    applyFilterConfig(value);
    statusContextRef.current = "Filtros cargados desde la nube";
    setStatus("Filtros cargados desde la nube. Se aplican al momento sobre los datos cargados.");
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
      // Cuarta ruta que produce filas, y la única que las construye en
      // cliente: sin esto la tarjeta de búsqueda enseñaba el RS ausente para
      // símbolos que sí están en el ranking semanal, igual que le pasaba a la
      // tabla. El RS que se muestra sale SIEMPRE de rs_weekly_items
      // (lib/rsCanonical.js); si la lectura falla, la fila queda marcada como
      // no disponible y la tarjeta enseña ausencia, nunca el percentil del lote.
      const weekly = await getJson(`/api/rs-weekly?symbol=${encodeURIComponent(normalized)}&limit=1`)
        .catch(() => null);
      const weeklyLatest = weekly?.latest || null;
      const weeklyRs = Number.isFinite(weeklyLatest?.rsRating) ? {
        weeklyRsAvailable: true,
        weeklyRsRating: weeklyLatest.rsRating,
        weeklyRsRank: weeklyLatest.rank ?? null,
        weeklyRsSampleSize: weeklyLatest.sampleSize ?? null,
        weeklyRsAsOf: weeklyLatest.date || "",
        weeklyRsWeekKey: weeklyLatest.weekKey || "",
        weeklyRsEngineVersion: weeklyLatest.engineVersion || "",
        weeklyRsReason: null,
      } : {
        weeklyRsAvailable: false,
        weeklyRsRating: null,
        weeklyRsRank: null,
        weeklyRsSampleSize: null,
        weeklyRsAsOf: null,
        weeklyRsWeekKey: null,
        weeklyRsEngineVersion: null,
        weeklyRsReason: null,
      };
      const row = sectorize([{ ...withBenchmark, ...dataCoverageForRow(withBenchmark, profile), ...weeklyRs }])[0];
      setSearchResult(row);
      setStatus(`Vista rápida cargada para ${row.companyName || candidate?.name || normalized} (${normalized}).`);
    } catch (e) {
      setSearchResult(null);
      setSearchError(e.message || "Proveedor no disponible");
      setStatus(`No se pudo cargar la vista rápida de ${normalized}.`);
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
        // País sin filas en los datos cargados: es el caso de cobertura, no
        // un motivo para tirar la tabla (antes: clear() + cargar universo
        // para un scan que ya no existe). Se declara el mercado, se avisa, y
        // el universo de tickers se refresca para KPI/búsqueda.
        setMarkets([item.value]);
        setUniverse([]);
        setUniverseScope("");
        announceCoverage([item.value]);
        setStatus(`Los datos cargados no incluyen ${marketName(item.value)}.`);
        await loadUniverse([item.value]);
      } else {
        setStatus(`Vista por país: ${marketName(item.value)}.`);
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
        setSearchError("No encontre candidatos. Prueba con nombre, ticker, sector, subsector, país o sufijo de mercado.");
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
  function setPreset(k) {
    const nextSettings = settingsForPreset(k);
    const nextLayers = filterLayersForPreset(k);
    syncAdvancedBaseline(nextSettings, nextLayers);
    setPresetKey(k);
    setSettings(nextSettings);
    setSort(defaultSortForSettings(PRESETS[k].v));
    setFieldRules(DEFAULT_FIELD_RULES);
    setFilterLayers(nextLayers);
    setUseRegimeFilter(true);
    setSelectedFilterTemplateId("");
    setFilterTemplateName("");
    // Cambiar de preset re-filtra el snapshot cargado al momento (el efecto
    // de re-filtrado); los datos nunca se tiran.
    statusContextRef.current = `Filtro activo: ${PRESETS[k].name}`;
    setStatus(`Filtro activo: ${PRESETS[k].name}. Capas del preset aplicadas.`);
  }
  // Descarga la lista de tickers del ámbito seleccionado (la usa la búsqueda
  // por país/mercado). Nunca toca los resultados cargados: sin botón Ejecutar,
  // ninguna preparación de universo puede costar la tabla.
  async function loadUniverse(marketsOverride = null) {
    setErr("");
    setFail([]);
    setStatus("Descargando universos completos...");
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
      setStatus(`Universo cargado${marketLabel}: ${u.length} tickers${ipoRadar.length ? ` · IPO Radar ${ipoRadar.length}` : ""}. Filtro: ${PRESETS[presetKey].name}.`);
      return u;
    } catch (e) {
      // El mensaje crudo (puede incluir detalle de red o del proveedor de
      // datos) queda en consola para depurar; el banner err (pintado por
      // ScreenerShell) es siempre lenguaje de producto — mismo criterio que
      // el resto de errores de datos, ver lib/screenerFormat.js.
      console.error("[loadUniverse] fallo al cargar universo", e);
      setErr(scanFailureExplanation(e.message));
      setStatus("Proveedor no disponible al cargar universo");
      return [];
    }
  }
  function marketPreset(t) {
    setBatchStart(0);
    setMarketsAndInvalidate(marketPresetMarkets(t), "Preset cambiado.");
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
    setStatus(`${row.symbol} guardado en favoritos de este dispositivo. Sincronizando con la nube...`);
    syncFavoriteToCloud(favorite).then((result) => {
      if (result.configured === false) setStatus(`${row.symbol} guardado en este dispositivo: la copia en la nube no está activada.`);
      else if (result.ok) setStatus(`${row.symbol} guardado en favoritos y sincronizado con la nube.`);
      else {
        console.error("[favoritos] no se pudo sincronizar con la nube:", result.message);
        setStatus(`${row.symbol} guardado en este dispositivo. ${userFacingServiceError(result.message, "No se pudo sincronizar con la nube.")}`);
      }
    });
  }
  function saveSnapshot(currentRows) {
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
      name: `${PRESETS[presetKey].name} · ${decisionRows.length} acciones · ${dateTime(new Date())}`,
      preset: presetKey,
      settings,
      activeSettings,
      filterLayers,
      filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
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
    safeWrite(STORAGE_KEYS.scans, fitScansForBrowser([scan, ...scans]));
    const generatedAlerts = alertsFromScan(scan);
    const nextAlerts = mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), generatedAlerts).slice(0, 500);
    safeWrite(STORAGE_KEYS.alerts, nextAlerts);
    setStatus(`Snapshot guardado en este dispositivo: ${decisionRows.length} acciones · ${eventTotal} eventos · ${generatedAlerts.length} alertas. Sincronizando con la nube...`);
    setSnapshotNotice(null);
    syncScanToCloud(scan).then((result) => {
      if (result.configured === false) setStatus(`Snapshot guardado en este dispositivo: ${decisionRows.length} acciones · ${generatedAlerts.length} alertas. La copia en la nube no está activada.`);
      else if (result.ok) setStatus(`Snapshot guardado: ${decisionRows.length} acciones · ${generatedAlerts.length} alertas. Disponible en este dispositivo y en la nube.`);
      else {
        console.error("[snapshot] no se pudo sincronizar con la nube:", result.message);
        setStatus(`Snapshot guardado en este dispositivo. ${userFacingServiceError(result.message, "La copia en la nube no se pudo actualizar ahora mismo.")}`);
      }
    });
    syncAlertsToCloud(generatedAlerts).then((result) => {
      if (result.configured !== false && !result.ok) {
        console.error("[alertas] no se pudieron sincronizar con la nube:", result.message);
        setStatus(`Snapshot guardado. Las alertas se quedan en este dispositivo. ${userFacingServiceError(result.message, "")}`.trim());
      }
      else if (result.ok && result.data?.alerts?.length) safeWrite(STORAGE_KEYS.alerts, mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), result.data.alerts).slice(0, 500));
    });
  }
  function csv(filteredRows) {
    const h = ["Rank", "Ticker", "Empresa", "Actividad ES", "Tema", "País", "Sector", "Subsector", "IPO", "IPO Date", "IPO Age Months", "Benchmark", "Last Price Date", "Price Freshness Days", "Price Freshness Label", "Price Freshness Issue", "Data Coverage", "Technical Coverage", "Fundamental Coverage", "Data Issues", "Data Health", "Data Health Key", "Data Health Detail", "Data Health Topline", "Data Health Issues", "RS Benchmark", "RS", "RS País", "RS Grupo", "RS Quality", "RS Stability", "Speculation Risk", "RS Quality Label", "Weakness Score", "Weakness Label", "Weakness Reasons", "RS Sample", "RS País Sample", "RS Grupo Sample", "RS 3M", "RS 6M", "RS 12M", "Dist 20d", "Dist 50d", "Dist 52w", "Dist ATH", "Highs Spread", "3M", "6M", "12M", "SMA50", "Avg Volume 20d", "Latest Volume", "Avg Turnover 20d", "Latest Turnover", "UD Vol", "Rel Volume", "Volume Surge %", "Volume Effect Score", "A/D Proxy", "EPS/Growth Proxy", "Volume Evidence", "Short Float %", "Short Ratio", "Shares Short", "Float Shares", "Up Volume", "Max Daily Move 20d", "Max Daily Range 20d", "Avg Daily Range 20d", "Price Range 63d", "Volatility 63d", "Downside Vol 63d", "Max Drawdown 63d", "Return/Vol 3M", "Return/Drawdown 3M", "Risk/Reward Score", "Estructura", "Ruptura", "Momentum", "Risk", "Volume", "Liquidity", "Sector Score", "Objective Setup", "Pattern Score", "Pattern Contribution", "Setup Quality", "Demand", "Growth", "IPO Score", "Objective Score", "Composite", "Objective Label", "Composite Label", "Reasons", "Risks", "Decision Priority", "Decision Confidence", "Decision Confidence Score", "Decision Issues", "Decision Drivers", "Decision Watch", "Decision", "Decision Detail", "Action", "Action Detail"];
    const lines = filteredRows.map((r, i) => {
      const explanation = explainScreenerRank(r, activeSettings);
      const trace = buildDecisionTrace(r, explanation);
      const dataHealth = buildScreenerDataHealth(r, activeSettings);
      return [i + 1, r.symbol, r.companyName, r.businessEs, r.theme, r.country, r.sector, r.industry, r.ipoCategory, r.ipoDate, r.ipoAgeMonths, r.benchmarkSymbol, r.lastDate, r.priceFreshnessDays, r.priceFreshnessLabel, r.priceFreshnessIssue, r.dataCoverageScore, r.technicalCoverageScore, r.fundamentalCoverageScore, (r.dataCoverageIssues || []).join(" | "), dataHealth.status?.label, dataHealth.status?.key, dataHealth.status?.detail, dataHealth.topLine, dataHealth.issues.map((item) => item.label).join(" | "), r.rsRating, r.rsGlobalPct, r.rsCountryPct, r.rsSectorPct, r.rsQualityScore, r.rsStabilityScore, r.speculationRiskScore, r.rsQualityLabel, r.weaknessScore, r.weaknessLabel, (r.weaknessReasons || []).join(" | "), r.rsGlobalSample, r.rsCountrySample, r.rsSectorSample, r.rs3m, r.rs6m, r.rs12m, r.distance20d, r.distance50d, r.distance52w, r.distanceATH, r.highsSpreadPct, r.perf3m, r.perf6m, r.perf12m, r.extSma50, r.avgVolume, r.latestVolume, r.avgTurnover, r.latestTurnover, r.upDownVolRatio, r.relativeVolume, r.volumeSurgePct, r.volumeEffectScore, r.adProxyScore, r.epsGrowthProxyScore, r.volumeEvidence, r.shortPercentOfFloat, r.shortRatio, r.sharesShort, r.floatShares, r.upVolume, r.maxDailyMove20dPct, r.maxDailyRange20dPct, r.avgDailyRange20dPct, r.range63dPct, r.volatility63d, r.downsideVolatility63d, r.maxDrawdown63d, r.returnToVol3m, r.returnToDrawdown3m, r.riskRewardScore, r.weinsteinScore, r.minerviniScore, r.momentumScore, r.riskScore, r.volumeScore, r.liquidityScore, r.sectorScore, r.objectiveSetupScore, r.patternScore, r.patternContributionScore, r.setupQualityScore, r.demandScore, r.growthScore, r.ipoScore, r.objectiveScore, r.totalScore, r.objectiveLabel, r.compositeLabel, (r.compositeReasons || []).join(" | "), (r.compositeRisks || []).join(" | "), trace.priorityScore, trace.confidence?.label, trace.confidence?.score, trace.issues.map((item) => item.label).join(" | "), trace.drivers.map((item) => item.value ? `${item.label} ${item.value}` : item.label).join(" | "), trace.watch.map((item) => item.value ? `${item.label}: ${item.value}` : item.label).join(" | "), explanation.readiness.label, explanation.readiness.detail, explanation.action.label, explanation.action.detail].map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",");
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
        icon: "Acción",
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
    hiddenByView,
    viewFiltersActive,
  }), [activeSettings, presetKey, filterLayers, useRegimeFilter, executionRuleActive, executionRuleTotal, fineRuleActive, fineRuleTotal, rows.length, filtered.length, analyzedRows.length, diagnostics, hiddenByView, viewFiltersActive]);
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
    // `fail` viene agrupado por motivo desde el servidor: cada grupo aporta su
    // `count` entero (no 1) y hasta 20 símbolos de ejemplo.
    normalizeScanErrorGroups(fail).forEach((group) => {
      const kind = failureKind(group.reason);
      const bucket = map.get(kind.key) || { ...kind, count: 0, examples: [] };
      bucket.count += group.count;
      for (const symbol of group.symbols) {
        if (bucket.examples.length >= 8) break;
        bucket.examples.push(symbol);
      }
      map.set(kind.key, bucket);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [fail]);
  const modalActiveResolution = useMemo(() => activeModalRow
    ? decisionResolutionForSymbol({ decisionResolutions: screenerDecisionResolutions }, activeModalRow.symbol)
    : null,
  [activeModalRow?.symbol, screenerDecisionResolutions]);
  const modalDecisionResolutions = screenerDecisionResolutions;
  // La maquinaria de veredictos del modal —los items de cola con nueve chips,
  // los resúmenes de auditoría/prioridad/perfil/decisión, el rank-explain, la
  // evidencia, el score-audit y el contexto de origen (quickReviewOrigin)—
  // se retiró el 2026-08-24 con la limpieza de la vista rápida
  // (docs/analisis-vista-rapida-2026-08-24.md): eran veredictos operativos y
  // diagnóstico interno del motor. El modal recibe ahora la fila, la cola y
  // la clasificación del inversor; nada más.
  const modalReviewSourceMeta = activeModalRow ? safeRead(STORAGE_KEYS.review, {}) : {};
  const modalReviewSourceLabel = String(modalReviewSourceMeta.sourceLabel || "Screener actual").trim() || "Screener actual";
  const modalOriginLabel = modalReviewSourceLabel === "Screener actual" ? "Revisión Screener" : modalReviewSourceLabel;

  useEffect(() => {
    if (!activeFilterFamily) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setActiveFilterFamily(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFilterFamily]);

  function onSelectResultRow(symbol = "") {
    setSelectedResultSymbol(String(symbol || "").trim());
  }

  function openResultReview(symbol = "") {
    if (symbol) onSelectResultRow(symbol);
    openReview(filtered, symbol);
  }

  useEffect(() => {
    if (!selectedResultSymbol) return;
    if (!pagedRows.some((row) => row.symbol === selectedResultSymbol)) {
      setSelectedResultSymbol("");
    }
  }, [pagedRows, selectedResultSymbol]);

  useEffect(() => {
    if (!sessionReady || activeModalRow) return undefined;
    function shouldIgnoreKeyboardTarget(target) {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
    }
    function onKeyDown(event) {
      if (event.defaultPrevented || shouldIgnoreKeyboardTarget(event.target)) return;
      if (!pagedRows.length) return;
      const currentIndex = selectedResultSymbol
        ? pagedRows.findIndex((row) => row.symbol === selectedResultSymbol)
        : -1;
      if (event.key === "Enter" && currentIndex >= 0) {
        const row = pagedRows[currentIndex];
        if (!row?.symbol) return;
        event.preventDefault();
        saveSessionBeforeStockOpen(row);
        window.location.href = stockUrl(row.symbol);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionReady, activeModalRow, pagedRows, selectedResultSymbol]);

  return <>
  <StorageAlert />
  <ScreenerShell
    chrome={{
      presetKey,
      markets,
      filtered,
      filteredCount: filtered.length,
      err,
      status,
      snapshotNotice,
      restoringScan,
      showMobileFilters,
      sidebarCollapsed,
      setShowMobileFilters,
      setSidebarCollapsed,
      kpiUniverseCount,
      marketHealth,
      rows,
    }}
    sidebar={{
      presetKey,
      savedFilterTemplates,
      selectedFilterTemplateId,
      filterTemplateName,
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
      diagnostics,
      markAdvancedBaseline,
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
    staleness={{
      scanStale,
      marketsStale,
      scanModeStale,
      scannedAt: scanContext?.scannedAt || null,
    }}
    results={{
      rows,
      filtered,
      pagedRows,
      activeSettings,
      analyzedRows,
      universe,
      favoriteSymbols,
      screenerDecisionResolutions,
      emptyLabel: resultsEmptyLabel,
    }}
    actions={{
      openReview,
      addFavorite,
      saveSnapshot,
      csv,
      decisionAuditJson,
      resetScreenerSession,
      refreshScreenerSnapshotData,
      saveSessionBeforeStockOpen,
      selectedResultSymbol,
      onSelectResultRow,
      openResultReview,
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
      chartListId={chartListId}
      chartScope={chartScope}
      chartSettings={chartSettings}
      modalActiveResolution={modalActiveResolution}
      modalDecisionResolutions={modalDecisionResolutions}
      modalReviewPosition={modalReviewPosition}
      modalReviewRows={modalReviewRows}
      modalOriginLabel={modalOriginLabel}
      closeQuickReview={closeQuickReview}
      moveQuickReview={moveQuickReview}
      reopenQuickReviewDecision={reopenQuickReviewDecision}
      resolveQuickReviewDecision={resolveQuickReviewDecision}
      saveQuickReviewStockOpen={saveQuickReviewStockOpen}
      updateChartScope={updateChartScope}
      updateChartSettings={updateChartSettings}
    />
  </>;
}
