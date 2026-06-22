"use client";
import "../styles/screener.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ChartPreferences from "@/app/ChartPreferences";
import RowTrustSignature from "@/app/RowTrustSignature";
import ScreenerOriginPanel from "@/app/ScreenerOriginPanel";
import { TrustMetric } from "@/app/components/ui/MetricSource";
import {
  activeLayerCount,
  amount,
  applyResultViewFilters,
  CompactResultsTable,
  CompanyMark,
  DECISION_PROFILE_ORDER,
  DecisionEvidenceChecklist,
  DecisionEvidenceSummaryRail,
  DecisionOperatingBrief,
  DecisionQualityStrip,
  DecisionSummaryRail,
  DataHealthSummaryRail,
  AuditabilitySummaryRail,
  buildReviewProfileSummary,
  decisionProfileForRow,
  decisionProfileLabel,
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
  PendingDecisionWorkRail,
  PendingResultsBar,
  prepareReviewQueueRows,
  PreviewCard,
  quickBusinessDescription,
  quickBusinessMarket,
  ratioLabel,
  ResultFilterChips,
  SearchCandidateList,
  SearchScopeList,
  ScoreAuditPanel,
  ScoreAuditSummaryRail,
  SetupChipRail,
  shortBusiness,
  sleep,
  searchText,
  reviewProfileMeta,
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
import { ASIA, DEFAULT_MARKETS, DEFAULT_RESULT_PAGE_SIZE, DEFAULT_SCAN_BATCH_SIZE, DEFAULT_STATUS, DEFAULT_VIEW_LAYERS, EUROPE, FULL_SCAN_PARTIAL_EVERY, MARKET_META, MARKET_ORDER, MARKETS, marketExchange, marketName, normalizeSectorStrength, RESULT_PAGE_SIZES, SCAN_BATCH_SIZES, SCREENER_FILTER_SETTING, SCREENER_SESSION_VERSION, SECTOR_STRENGTH_LABELS, SECTOR_STRENGTH_OPTIONS, SERVER_SCAN_POLL_MS, SORT_LABELS, USER_TEMPLATE_LIMIT, VIEW_LAYERS } from "@/lib/screenerConfig";
import { buildScreenerDecisionBrief } from "@/lib/screenerDecisionBrief";
import { DECISION_EVIDENCE_FILTER_ALL, DECISION_EVIDENCE_FILTER_ORDER, buildDecisionBrief, buildDecisionEvidenceChecklist, buildDecisionEvidenceSummary, buildDecisionQueueItem, buildDecisionQueueSummary, decisionEvidenceFilterLabel, DECISION_READINESS_ORDER, decisionReadinessLabel, explainScreenerRank, RANK_ACTION_ORDER, rankActionLabel } from "@/lib/screenerExplainability";
import { attachDecisionTrace, auditDecisionRowIssues, auditDecisionScan, buildDecisionAuditExportPayload, buildDecisionTrace, DECISION_CONFIDENCE_ORDER, decisionConfidenceLabel, decisionConfidenceSummary, decisionPriorityBreakdown, decisionTraceForRow } from "@/lib/decisionAudit";
import { buildReviewPrioritySummary, decisionProfileStateForStock, reviewPriorityForRow, reviewPriorityMeta } from "@/lib/decisionProfile";
import { DATA_HEALTH_FILTER_ALL, DATA_HEALTH_FILTER_ORDER, buildScreenerDataHealth, buildScreenerDataHealthSummary, dataHealthFilterLabel } from "@/lib/screenerDataHealth";
import { RELIABILITY_FILTER_ALL, RELIABILITY_FILTER_ORDER, buildScreenerAuditabilitySummary, buildScreenerReliabilitySummary, screenerReliabilityFilterLabel } from "@/lib/screenerReliability";
import { SCORE_AUDIT_FILTER_ALL, SCORE_AUDIT_FILTER_ORDER, buildScreenerScoreAudit, buildScreenerScoreAuditSummary, scoreAuditFilterLabel, scoreAuditMatchesFilter, scoreAuditReviewReasons, scoreAuditStatusForRow } from "@/lib/screenerScoreAudit";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";
import { buildReviewStockOpenContext } from "@/lib/reviewStockContext";
import { STOCK_DECISION_ACTIONS, applyStockDecisionResolution, buildStockDecisionResolutionSummary, decisionResolutionForSymbol, reopenStockDecisionResolution, reviewDecisionStateForRows, stockDecisionResolutionFilter } from "@/lib/stockDecisionResolution";
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

const CACHE_PREVIEW_TIMEOUT_MS = 3500;
const MARKET_HEALTH_TIMEOUT_MS = 5000;

function decisionResolutionDisplayLabel(key = "") {
  return key === "pending" ? "Sin decidir" : stockDecisionResolutionFilter(key).label;
}

function reviewPriorityDisplayLabel(key = "all") {
  return key === "all" ? "Todas" : reviewPriorityMeta(key).label;
}

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

function reviewQueueMetricTruthMeta(row = {}) {
  const status = objectiveMetricAuditStatusForRow(row);
  const audit = status.audit || null;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const usable = items.filter((item) => item?.status === "verified" || item?.status === "traceable");
  const measuredCount = usable.filter((item) => item?.proxy !== true).length;
  const proxyCount = usable.filter((item) => item?.proxy === true).length;
  const issueDetail = Array.isArray(audit?.issues) && audit.issues.length
    ? audit.issues.slice(0, 2).map((item) => [item.label || item.key, item.status].filter(Boolean).join(": ")).join(" · ")
    : "";
  const detail = [
    status.detail || issueDetail,
    measuredCount ? `${measuredCount} medidas` : "",
    proxyCount ? `${proxyCount} proxy` : "",
  ].filter(Boolean).join(" · ");
  if (status.key === "bad") {
    return { key: "blocked", label: "Bloq.", tone: "bad", detail, measuredCount, proxyCount };
  }
  if (status.key === "warn") {
    return { key: "review", label: "Rev.", tone: "warn", detail, measuredCount, proxyCount };
  }
  if (status.key === "missing") {
    return { key: "missing", label: "Sin audit", tone: "warn", detail: status.detail || "Sin auditoria numerica.", measuredCount: 0, proxyCount: 0 };
  }
  return {
    key: proxyCount ? "mixed" : "measured",
    label: proxyCount ? "Mixto" : "Med.",
    tone: proxyCount ? "neutral" : "good",
    detail,
    measuredCount,
    proxyCount,
  };
}

function QuickReviewMetricValue({ row = {}, metricKey = "", label = "", value = "-", className = "" }) {
  return <TrustMetric row={row} metricKey={metricKey} label={label} value={value} className={className} baseClass="quickReviewMetricValue" variant="b" />;
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

function ReviewQueueFocusBadge({ focus = null }) {
  if (!focus) return null;
  return <span className={`reviewQueueFocusBadge ${focus.tone || "warn"} focus-${focus.key || "other"}`} title={focus.detail || focus.label}>Foco {focus.label}</span>;
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

function ReviewPriorityResultRail({ summary = [], activeKey = "all", onSelect, onReview }) {
  const items = Array.isArray(summary) ? summary.filter((item) => item?.count > 0) : [];
  if (!items.length) return null;
  const activeItem = activeKey !== "all" ? items.find((item) => item.key === activeKey) : null;
  const reviewTarget = activeItem || items[0];
  return <div className="decisionSummaryRail reviewPriorityResultRail" aria-label="Resumen por prioridad de investigacion">
    {items.map((item) => {
      const active = activeKey === item.key;
      return <button
        type="button"
        key={item.key}
        className={`decisionSummaryChip priority-${item.key} ${item.tone || "neutral"} ${active ? "active" : ""}`.trim()}
        onClick={() => onSelect?.(active ? "all" : item.key)}
        onDoubleClick={() => onReview?.(item.key)}
        title={[item.topSymbol ? `${item.topSymbol} · ${Math.round(item.topScore || 0)}` : "", item.sampleSymbols?.length ? item.sampleSymbols.join(", ") : item.label, "Doble click: revisar esta prioridad"].filter(Boolean).join(" · ")}
      >
        <b>{item.count}</b>
        <span>{item.shortLabel || item.label}</span>
      </button>;
    })}
    {reviewTarget ? <button
      type="button"
      className={`decisionSummaryChip reviewPriorityAction priority-${reviewTarget.key} ${reviewTarget.tone || "neutral"}`.trim()}
      onClick={() => onReview?.(reviewTarget.key)}
      title={`Abrir cola Review: ${reviewTarget.label}`}
    >
      <b>Ir</b>
      <span>Revisar {reviewTarget.shortLabel || reviewTarget.label}</span>
    </button> : null}
  </div>;
}

function ReviewPriorityPanel({ priority = null, compact = false }) {
  if (!priority) return null;
  const components = Array.isArray(priority.priority?.components) ? priority.priority.components.slice(0, compact ? 3 : 4) : [];
  const penalties = Array.isArray(priority.priority?.penalties) ? priority.priority.penalties.slice(0, compact ? 2 : 3) : [];
  return <div className={`reviewPriorityPanel quickReviewPriorityPanel ${compact ? "compact" : ""} ${priority.tone || ""}`} aria-label="Prioridad de investigacion">
    <div className="reviewPriorityHead">
      <span><b>{priority.label}</b><em>{priority.reason}</em></span>
      <strong>{Math.round(priority.score || 0)}</strong>
    </div>
    {components.length ? <div className="reviewPriorityComponents">
      {components.map((item) => <span key={item.key} title={item.detail || item.label}>
        <em>{item.label}</em>
        <b>{Math.round(item.value || 0)}</b>
      </span>)}
    </div> : null}
    {penalties.length ? <div className="reviewPriorityPenalties">
      {penalties.map((item) => <small className={item.severity || "warn"} key={item.key}>-{Math.round(item.value || 0)} {item.label}</small>)}
    </div> : null}
  </div>;
}

function resultBriefToneRank(tone = "") {
  if (tone === "bad") return 4;
  if (tone === "warn") return 3;
  if (tone === "watch") return 2;
  if (tone === "good") return 0;
  return 1;
}

function resultBriefIssue(key, verdict = null, okKeys = []) {
  if (!verdict?.key || okKeys.includes(verdict.key)) return null;
  return {
    key,
    label: verdict.label || key,
    detail: verdict.detail || "",
    tone: verdict.tone || "neutral",
    count: Number(verdict.count || 0),
  };
}

function buildResultViewBrief({ chips = [], visibleCount = 0, totalCount = 0, decisionBrief = null, dataHealthSummary = null, decisionEvidenceSummary = null, scoreAuditSummary = null, pendingDecisionWorkSummary = null } = {}) {
  if (!visibleCount) return null;
  const verdict = decisionBrief?.verdict || {
    label: "Vista de investigación",
    tone: "neutral",
    detail: `${visibleCount} resultados visibles.`,
  };
  const focus = chips.length
    ? chips.slice(0, 3).map((chip) => chip.label).join(" · ")
    : "Sin filtros activos";
  const blockers = [
    resultBriefIssue("evidence", decisionEvidenceSummary?.verdict, ["ready", "empty"]),
    resultBriefIssue("data", dataHealthSummary?.verdict, ["ready", "empty"]),
    resultBriefIssue("score", scoreAuditSummary?.verdict, ["clean", "empty"]),
    decisionBrief?.primaryIssue ? {
      key: `issue-${decisionBrief.primaryIssue.key}`,
      label: decisionBrief.primaryIssue.label,
      detail: [`${decisionBrief.primaryIssue.count || 0} filas`, decisionBrief.primaryIssue.share].filter(Boolean).join(" · "),
      tone: decisionBrief.primaryIssue.severity || "warn",
      count: Number(decisionBrief.primaryIssue.count || 0),
    } : null,
  ].filter(Boolean).sort((a, b) => resultBriefToneRank(b.tone) - resultBriefToneRank(a.tone) || b.count - a.count);
  const blocker = blockers[0] || null;
  const top = pendingDecisionWorkSummary?.top || null;
  const firstAction = top
    ? {
      value: top.symbol,
      detail: `Pri ${Math.round(top.priority || 0)} · ${top.confidenceLabel || "Confianza"}`,
      tone: top.confidenceKey === "high" ? "good" : "warn",
    }
    : decisionBrief?.actions?.[0]
      ? {
        value: decisionBrief.actions[0].label,
        detail: decisionBrief.actions[0].detail,
        tone: "warn",
      }
      : {
        value: "Revisar ranking",
        detail: `${visibleCount} resultados visibles`,
        tone: "neutral",
      };

  return {
    label: verdict.label,
    detail: verdict.detail,
    tone: blocker?.tone || verdict.tone || "neutral",
    primarySymbol: top?.symbol || "",
    sourceDetail: [
      `Brief vista: ${verdict.label}`,
      `Foco: ${focus}`,
      `Primero: ${firstAction.value}`,
      `Freno: ${blocker?.label || "Sin freno"}`,
    ].join(" · "),
    items: [
      {
        key: "focus",
        label: "Foco",
        value: focus,
        detail: `${visibleCount}/${totalCount || visibleCount} visibles`,
        tone: chips.length ? "warn" : "neutral",
      },
      {
        key: "first",
        label: "Primero",
        value: firstAction.value,
        detail: firstAction.detail,
        tone: firstAction.tone,
      },
      {
        key: "blocker",
        label: "Freno",
        value: blocker?.label || "Sin freno",
        detail: blocker?.detail || "La vista no concentra una alerta crítica.",
        tone: blocker?.tone || "good",
      },
    ],
  };
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
  const [themeFilter, setThemeFilter] = useState("Todos");
  const [sectorFilter, setSectorFilter] = useState("Todos");
  const [industryFilter, setIndustryFilter] = useState("Todos");
  const [countryFilter, setCountryFilter] = useState("Todos");
  const [sectorStrength, setSectorStrength] = useState("Todos");
  const [ipo, setIpo] = useState("Todos");
  const [actionFilter, setActionFilter] = useState("Todos");
  const [readinessFilter, setReadinessFilter] = useState("Todos");
  const [decisionProfileFilter, setDecisionProfileFilter] = useState("Todos");
  const [reviewPriorityFilter, setReviewPriorityFilter] = useState("all");
  const [reliabilityFilter, setReliabilityFilter] = useState(RELIABILITY_FILTER_ALL);
  const [decisionEvidenceFilter, setDecisionEvidenceFilter] = useState(DECISION_EVIDENCE_FILTER_ALL);
  const [confidenceFilter, setConfidenceFilter] = useState("Todos");
  const [dataHealthFilter, setDataHealthFilter] = useState(DATA_HEALTH_FILTER_ALL);
  const [scoreAuditFilter, setScoreAuditFilter] = useState(SCORE_AUDIT_FILTER_ALL);
  const [decisionIssueFilter, setDecisionIssueFilter] = useState("Todos");
  const [decisionResolutionFilter, setDecisionResolutionFilter] = useState("all");
  const [sort, setSort] = useState("objectiveScore");
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
  const [quickReviewResolutionRevision, setQuickReviewResolutionRevision] = useState(0);
  const [screenerDecisionRevision, setScreenerDecisionRevision] = useState(0);
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
      setThemeFilter(session.themeFilter || "Todos");
      setSectorFilter(session.sectorFilter || "Todos");
      setIndustryFilter(session.industryFilter || "Todos");
      setCountryFilter(session.countryFilter || "Todos");
      setSectorStrength(normalizeSectorStrength(session.sectorStrength));
      setIpo(session.ipo || "Todos");
      setActionFilter(session.actionFilter || "Todos");
      setReadinessFilter(session.readinessFilter || "Todos");
      setDecisionProfileFilter(session.decisionProfileFilter || "Todos");
      setReviewPriorityFilter(session.reviewPriorityFilter || "all");
      setReliabilityFilter(session.reliabilityFilter || RELIABILITY_FILTER_ALL);
      setDecisionEvidenceFilter(session.decisionEvidenceFilter || DECISION_EVIDENCE_FILTER_ALL);
      setConfidenceFilter(session.confidenceFilter || "Todos");
      setDataHealthFilter(session.dataHealthFilter || DATA_HEALTH_FILTER_ALL);
      setScoreAuditFilter(session.scoreAuditFilter || SCORE_AUDIT_FILTER_ALL);
      setDecisionIssueFilter(session.decisionIssueFilter || "Todos");
      setDecisionResolutionFilter(session.decisionResolutionFilter || "all");
      setSort(session.sort || defaultSortForSettings(restoredActiveSettings));
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

  function quickReviewContext(row = activeModalRow, index = modalReviewPosition) {
    const list = modalReviewRows.length ? modalReviewRows : row ? [row] : [];
    const fallbackIndex = row?.symbol ? list.findIndex((item) => item.symbol === row.symbol) : 0;
    const resolvedIndex = Number.isFinite(index) ? index : Math.max(0, fallbackIndex);
    return {
      list,
      index: Math.max(0, resolvedIndex),
      rank: resolvedIndex >= 0 ? resolvedIndex + 1 : 1,
    };
  }

  function quickReviewPayload(row = activeModalRow, index = modalReviewPosition, previousReview = safeRead(STORAGE_KEYS.review, {})) {
    const context = quickReviewContext(row, index);
    const decisionState = reviewDecisionStateForRows(previousReview, context.list);
    return {
      ...previousReview,
      source: "current",
      rows: context.list,
      activeSettings,
      presetKey,
      currentIndex: context.index,
      reviewedSymbols: decisionState.reviewedSymbols,
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      decisionResolutionLog: decisionState.decisionResolutionLog,
      selectedSymbol: row?.symbol || context.list[context.index]?.symbol || "",
      updatedAt: new Date().toISOString(),
    };
  }

  function saveQuickReviewStockOpen(row = activeModalRow, index = modalReviewPosition) {
    if (!row?.symbol) {
      saveSessionBeforeStockOpen(row);
      return;
    }
    const contextMeta = quickReviewContext(row, index);
    const openedAt = new Date().toISOString();
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const digestFilter = previousReview.digestFilter || "all";
    const resolutionFilter = previousReview.resolutionFilter || "all";
    const reviewSourceLabel = previousReview.sourceLabel || "Screener actual";
    const reviewSourceDetail = String(previousReview.sourceDetail || "").trim();
    const reviewQueueMode = String(previousReview.queueMode || "screener-review").trim() || "screener-review";
    const reviewPayload = { ...quickReviewPayload(row, index, previousReview), updatedAt: openedAt };
    safeWrite(STORAGE_KEYS.review, reviewPayload);
    const context = buildReviewStockOpenContext(row, {
      settings: activeSettings,
      source: "current",
      sourceLabel: reviewSourceLabel,
      sourceDetail: reviewSourceDetail,
      queueMode: reviewQueueMode,
      digestFilter,
      resolutionFilter,
      rank: contextMeta.rank,
      queueSize: contextMeta.list.length,
      rowsCount: contextMeta.list.length,
      visibleCount: contextMeta.list.length,
      hiddenCount: 0,
      openedAt,
    });
    persistScreenerSession({
      lastOpenedStockSymbol: row.symbol,
      lastOpenedStockAt: openedAt,
      lastOpenedStockContext: context,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      quickReviewRows: compactRowsForSession(contextMeta.list),
      quickReviewIndex: contextMeta.index,
      searchResult: compactRowForSession(searchResult),
      rows: compactRowsForSession(rows),
      analyzedRows: compactRowsForSession(analyzedRows),
    });
  }

  function resolveQuickReviewDecision(actionKey, row = activeModalRow, index = modalReviewPosition) {
    if (!row?.symbol) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decision = modalReviewQueueItems[index] || buildDecisionQueueItem(row, activeSettings);
    const note = [
      decision?.nextAction?.value || "",
      decision?.risk?.value || "",
    ].filter(Boolean).join(" · ");
    const nextReview = applyStockDecisionResolution(quickReviewPayload(row, index, previousReview), {
      symbol: row.symbol,
      actionKey,
      source: "screener-review",
      note,
    });
    safeWrite(STORAGE_KEYS.review, nextReview);
    setQuickReviewResolutionRevision((value) => value + 1);
    const resolution = decisionResolutionForSymbol(nextReview, row.symbol);
    setStatus(`${row.symbol}: ${resolution?.label || "resuelta"} desde Vista rápida`);
  }

  function reopenQuickReviewDecision(row = activeModalRow, index = modalReviewPosition) {
    if (!row?.symbol) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const resolution = decisionResolutionForSymbol(previousReview, row.symbol);
    const nextReview = reopenStockDecisionResolution(quickReviewPayload(row, index, previousReview), {
      symbol: row.symbol,
      source: "screener-review",
      note: resolution?.label ? `Antes: ${resolution.label}` : "",
    });
    safeWrite(STORAGE_KEYS.review, nextReview);
    setQuickReviewResolutionRevision((value) => value + 1);
    setStatus(`${row.symbol}: reabierta desde Vista rápida`);
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
  const decisionFilterActive = (actionFilter !== "Todos" ? 1 : 0) + (readinessFilter !== "Todos" ? 1 : 0) + (decisionProfileFilter !== "Todos" ? 1 : 0) + (reviewPriorityFilter !== "all" ? 1 : 0) + (reliabilityFilter !== RELIABILITY_FILTER_ALL ? 1 : 0) + (decisionEvidenceFilter !== DECISION_EVIDENCE_FILTER_ALL ? 1 : 0) + (confidenceFilter !== "Todos" ? 1 : 0) + (dataHealthFilter !== DATA_HEALTH_FILTER_ALL ? 1 : 0) + (scoreAuditFilter !== SCORE_AUDIT_FILTER_ALL ? 1 : 0) + (decisionIssueFilter !== "Todos" ? 1 : 0) + (decisionResolutionFilter !== "all" ? 1 : 0);
  const viewFiltersActive = decisionFilterActive + VIEW_LAYERS.reduce((sum, layer) => sum + (viewLayers[layer.key] ? viewFilterCounts[layer.key] : 0), 0);
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
    setThemeFilter("Todos");
    setSectorFilter("Todos");
    setIndustryFilter("Todos");
    setCountryFilter("Todos");
    setSectorStrength("Todos");
    setIpo("Todos");
    setActionFilter("Todos");
    setReadinessFilter("Todos");
    setDecisionProfileFilter("Todos");
    setReviewPriorityFilter("all");
    setReliabilityFilter(RELIABILITY_FILTER_ALL);
    setDecisionEvidenceFilter(DECISION_EVIDENCE_FILTER_ALL);
    setConfidenceFilter("Todos");
    setDataHealthFilter(DATA_HEALTH_FILTER_ALL);
    setScoreAuditFilter(SCORE_AUDIT_FILTER_ALL);
    setDecisionIssueFilter("Todos");
    setDecisionResolutionFilter("all");
    setSort(defaultSortForSettings(settingsForPreset("balanced")));
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
    setThemeFilter(config.themeFilter || "Todos");
    setSectorFilter(config.sectorFilter || "Todos");
    setIndustryFilter(config.industryFilter || "Todos");
    setCountryFilter(config.countryFilter || "Todos");
    setSectorStrength(normalizeSectorStrength(config.sectorStrength));
    setIpo(config.ipo || "Todos");
    setActionFilter(config.actionFilter || "Todos");
    setReadinessFilter(config.readinessFilter || "Todos");
    setDecisionProfileFilter(config.decisionProfileFilter || "Todos");
    setReviewPriorityFilter(config.reviewPriorityFilter || "all");
    setReliabilityFilter(config.reliabilityFilter || RELIABILITY_FILTER_ALL);
    setDecisionEvidenceFilter(config.decisionEvidenceFilter || DECISION_EVIDENCE_FILTER_ALL);
    setConfidenceFilter(config.confidenceFilter || "Todos");
    setDataHealthFilter(config.dataHealthFilter || DATA_HEALTH_FILTER_ALL);
    setScoreAuditFilter(config.scoreAuditFilter || SCORE_AUDIT_FILTER_ALL);
    setDecisionIssueFilter(config.decisionIssueFilter || "Todos");
    setDecisionResolutionFilter(config.decisionResolutionFilter || "all");
    setSort(config.sort || defaultSortForSettings(nextPreset.v));
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
  function openReview(currentRows, startSymbol = "", options = {}) {
    const reviewRows = prepareReviewQueueRows(currentRows, activeSettings);
    if (!reviewRows.length) {
      setStatus("Sin filas actuales para abrir vista rapida.");
      return;
    }
    const reviewSourceLabel = options.sourceLabel || "Screener actual";
    const reviewSourceDetail = options.sourceDetail || "";
    const queueMode = options.queueMode || "screener-review";
    const nextResolutionFilter = options.resolutionFilter || "all";
    const nextDigestFilter = options.digestFilter || "all";
    const currentIndex = Math.max(0, reviewRows.findIndex((row) => row.symbol === startSymbol));
    const profileSummary = buildReviewProfileSummary(reviewRows, activeSettings);
    const cleanCount = profileSummary.find((group) => group.key === "operable-clean")?.count || 0;
    const fragileCount = profileSummary.find((group) => group.key === "operable-fragile")?.count || 0;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decisionState = reviewDecisionStateForRows(previousReview, reviewRows);
    setQuickReviewRows(reviewRows);
    setQuickReviewIndex(currentIndex);
    setActiveModalRow(reviewRows[currentIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: "current",
      sourceLabel: reviewSourceLabel,
      sourceDetail: reviewSourceDetail,
      queueMode,
      rows: reviewRows,
      activeSettings,
      presetKey,
      currentIndex,
      contractContext: buildScreenerStockOpenContext(reviewRows[currentIndex], { rank: currentIndex + 1, queueSize: reviewRows.length, sourceLabel: reviewSourceLabel === "Screener actual" ? "Revisión Screener" : reviewSourceLabel }),
      reviewedSymbols: decisionState.reviewedSymbols,
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      decisionResolutionLog: decisionState.decisionResolutionLog,
      resolutionFilter: nextResolutionFilter,
      digestFilter: nextDigestFilter,
      selectedSymbol: startSymbol || reviewRows[0]?.symbol || "",
      updatedAt: new Date().toISOString(),
    });
    setStatus(`${reviewSourceLabel}: ${reviewRows.length} acciones en cola · ${cleanCount} limpias · ${fragileCount} fragiles.`);
  }
  function selectQuickReview(index, list = quickReviewRows) {
    if (!list.length) return;
    const nextIndex = ((index % list.length) + list.length) % list.length;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    const decisionState = reviewDecisionStateForRows(previousReview, list);
    setQuickReviewIndex(nextIndex);
    setActiveModalRow(list[nextIndex]);
    safeWrite(STORAGE_KEYS.review, {
      source: previousReview.source || "current",
      sourceLabel: previousReview.sourceLabel || "Screener actual",
      sourceDetail: previousReview.sourceDetail || "",
      queueMode: previousReview.queueMode || "screener-review",
      rows: list,
      activeSettings,
      presetKey,
      currentIndex: nextIndex,
      contractContext: buildScreenerStockOpenContext(list[nextIndex], { rank: nextIndex + 1, queueSize: list.length, sourceLabel: previousReview.sourceLabel && previousReview.sourceLabel !== "Screener actual" ? previousReview.sourceLabel : "Revisión Screener" }),
      reviewedSymbols: decisionState.reviewedSymbols,
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      decisionResolutionLog: decisionState.decisionResolutionLog,
      resolutionFilter: previousReview.resolutionFilter || "all",
      digestFilter: previousReview.digestFilter || "all",
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

  const screenerDecisionResolutions = useMemo(() => safeRead(STORAGE_KEYS.review, {})?.decisionResolutions || {}, [screenerDecisionRevision, quickReviewResolutionRevision]);
  const viewFilterState = { viewLayers, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, decisionResolutions: screenerDecisionResolutions, activeSettings };
  const filtered = useMemo(() => {
    const list = applyResultViewFilters(rows, viewFilterState);
    return [...list].sort((a, b) => sortMetric(b, sort, activeSettings) - sortMetric(a, sort, activeSettings));
  }, [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings, sort, viewLayers]);
  const reviewPriorityBaseRows = useMemo(() => applyResultViewFilters(rows, {
    ...viewFilterState,
    reviewPriorityFilter: "all",
  }), [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings, viewLayers]);
  const reliabilityBaseRows = useMemo(() => applyResultViewFilters(rows, {
    ...viewFilterState,
    reliabilityFilter: RELIABILITY_FILTER_ALL,
  }), [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings, viewLayers]);
  const decisionEvidenceBaseRows = useMemo(() => applyResultViewFilters(rows, {
    ...viewFilterState,
    decisionEvidenceFilter: DECISION_EVIDENCE_FILTER_ALL,
  }), [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings, viewLayers]);
  const dataHealthBaseRows = useMemo(() => applyResultViewFilters(rows, {
    ...viewFilterState,
    dataHealthFilter: DATA_HEALTH_FILTER_ALL,
  }), [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings, viewLayers]);
  const scoreAuditBaseRows = useMemo(() => applyResultViewFilters(rows, {
    ...viewFilterState,
    scoreAuditFilter: SCORE_AUDIT_FILTER_ALL,
  }), [rows, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings, viewLayers]);
  const pendingDecisionWorkSummary = useMemo(() => {
    const pendingItems = filtered.map((row) => {
      if (decisionResolutionForSymbol({ decisionResolutions: screenerDecisionResolutions }, row.symbol)) return null;
      const explanation = explainScreenerRank(row, activeSettings);
      const confidence = decisionConfidenceSummary(row, explanation);
      const priority = decisionPriorityBreakdown(row, explanation);
      return {
        row,
        symbol: row.symbol,
        companyName: row.companyName || row.name || "",
        priority: priority.score,
        confidenceKey: confidence.key,
        confidenceLabel: confidence.label,
      };
    }).filter(Boolean).sort((a, b) => b.priority - a.priority);
    const highConfidenceItems = pendingItems.filter((item) => item.confidenceKey === "high");
    const focusItems = highConfidenceItems.length ? highConfidenceItems : pendingItems;
    return {
      pendingCount: pendingItems.length,
      highConfidenceCount: highConfidenceItems.length,
      focusCount: focusItems.length,
      usesHighConfidence: highConfidenceItems.length > 0,
      top: focusItems[0] || null,
      rows: focusItems.map((item) => item.row),
    };
  }, [filtered, screenerDecisionResolutions, activeSettings]);
  const pendingDecisionWorkActive = decisionResolutionFilter === "pending"
    && sort === "decisionPriority"
    && reviewPriorityFilter === "all"
    && (pendingDecisionWorkSummary.usesHighConfidence ? confidenceFilter === "high" : confidenceFilter === "Todos");
  function applyPendingDecisionWorkFocus() {
    if (!pendingDecisionWorkSummary.pendingCount) return;
    setDecisionResolutionFilter("pending");
    setReviewPriorityFilter("all");
    setConfidenceFilter(pendingDecisionWorkSummary.usesHighConfidence ? "high" : "Todos");
    setSort("decisionPriority");
    setResultPage(1);
    const label = pendingDecisionWorkSummary.usesHighConfidence ? `${pendingDecisionWorkSummary.highConfidenceCount} pendientes de confianza alta` : `${pendingDecisionWorkSummary.pendingCount} pendientes priorizadas`;
    setStatus(`Trabajo pendiente: ${label}.`);
  }
  function clearPendingDecisionWorkFocus() {
    setDecisionResolutionFilter("all");
    setReviewPriorityFilter("all");
    if (confidenceFilter === "high") setConfidenceFilter("Todos");
    setResultPage(1);
  }
  function reviewPendingDecisionWork() {
    const reviewRows = pendingDecisionWorkSummary.rows?.length ? pendingDecisionWorkSummary.rows : filtered;
    const detail = pendingDecisionWorkSummary.usesHighConfidence
      ? "Sin decidir · confianza alta · prioridad decision"
      : "Sin decidir · prioridad decision";
    openReview(reviewRows, pendingDecisionWorkSummary.top?.symbol || "", {
      sourceLabel: "Trabajo pendiente",
      sourceDetail: detail,
      queueMode: "pending-work",
      resolutionFilter: "pending",
    });
  }
  const pendingFilteredCount = useMemo(() => {
    if (!pendingResults) return 0;
    return applyResultViewFilters(pendingResults.rows || [], viewFilterState).length;
  }, [pendingResults, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings, viewLayers]);
  useEffect(() => {
    if (running || filtered.length || !pendingResults?.rows?.length || pendingFilteredCount <= 0) return;
    setRows(pendingResults.rows || []);
    setDiagnostics(pendingResults.diagnostics || null);
    setSnapshotNotice(null);
    setPendingResults(null);
    setResultPage(1);
    setStatus(`Resultados actualizados automaticamente: ${pendingResults.rows?.length || 0} acciones calculadas.`);
  }, [running, filtered.length, pendingFilteredCount, pendingResults]);
  const totalResultPages = Math.max(1, Math.ceil(filtered.length / resultPageSize));
  const visibleResultPage = Math.min(resultPage, totalResultPages);
  const resultPageStart = (visibleResultPage - 1) * resultPageSize;
  const resultPageEnd = Math.min(resultPageStart + resultPageSize, filtered.length);
  const pagedRows = filtered.slice(resultPageStart, resultPageEnd);
  const visibleDecisionAudit = useMemo(() => filtered.length
    ? auditDecisionScan({ id: "visible-results", name: "Resultados visibles", rows: filtered, activeSettings })
    : null, [filtered, activeSettings]);
  const setResultPageClamped = (page) => setResultPage(Math.max(1, Math.min(page, totalResultPages)));
  function updateResultPageSize(size) {
    const nextSize = RESULT_PAGE_SIZES.includes(size) ? size : DEFAULT_RESULT_PAGE_SIZE;
    setResultPageSize(nextSize);
    setResultPage(1);
  }
  const opportunities = useMemo(() => opportunityBuckets(filtered), [filtered]);
  useEffect(() => {
    setResultPage(1);
  }, [countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, sort, resultPageSize]);
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
  const actionCounts = useMemo(() => {
    const counts = new Map();
    rows.forEach((row) => {
      const actionKey = explainScreenerRank(row, activeSettings).action.key;
      counts.set(actionKey, (counts.get(actionKey) || 0) + 1);
    });
    return counts;
  }, [rows, activeSettings]);
  const actionOptions = useMemo(() => {
    const known = RANK_ACTION_ORDER.filter((key) => actionCounts.has(key));
    const unknown = [...actionCounts.keys()].filter((key) => !RANK_ACTION_ORDER.includes(key)).sort();
    return ["Todos", ...known, ...unknown];
  }, [actionCounts]);
  const readinessCounts = useMemo(() => {
    const counts = new Map();
    rows.forEach((row) => {
      const readinessKey = explainScreenerRank(row, activeSettings).readiness.key;
      counts.set(readinessKey, (counts.get(readinessKey) || 0) + 1);
    });
    return counts;
  }, [rows, activeSettings]);
  const readinessOptions = useMemo(() => {
    const known = DECISION_READINESS_ORDER.filter((key) => readinessCounts.has(key));
    const unknown = [...readinessCounts.keys()].filter((key) => !DECISION_READINESS_ORDER.includes(key)).sort();
    return ["Todos", ...known, ...unknown];
  }, [readinessCounts]);
  const readinessSummary = useMemo(() => DECISION_READINESS_ORDER
    .map((key) => ({ key, label: decisionReadinessLabel(key), count: readinessCounts.get(key) || 0 }))
    .filter((item) => item.count > 0), [readinessCounts]);
  const decisionProfileCounts = useMemo(() => {
    const counts = new Map();
    rows.forEach((row) => {
      const key = decisionProfileForRow(row, activeSettings);
      if (key === "other") return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [rows, activeSettings]);
  const decisionProfileOptions = useMemo(() => {
    const known = DECISION_PROFILE_ORDER.filter((key) => decisionProfileCounts.has(key));
    const unknown = [...decisionProfileCounts.keys()].filter((key) => !DECISION_PROFILE_ORDER.includes(key)).sort();
    return ["Todos", ...known, ...unknown];
  }, [decisionProfileCounts]);
  const confidenceCounts = useMemo(() => {
    const counts = new Map();
    rows.forEach((row) => {
      const confidenceKey = decisionConfidenceSummary(row, activeSettings).key;
      counts.set(confidenceKey, (counts.get(confidenceKey) || 0) + 1);
    });
    return counts;
  }, [rows, activeSettings]);
  const confidenceOptions = useMemo(() => {
    const known = DECISION_CONFIDENCE_ORDER.filter((key) => confidenceCounts.has(key));
    const unknown = [...confidenceCounts.keys()].filter((key) => !DECISION_CONFIDENCE_ORDER.includes(key)).sort();
    return ["Todos", ...known, ...unknown];
  }, [confidenceCounts]);
  const dataHealthCounts = useMemo(() => {
    const counts = new Map();
    dataHealthBaseRows.forEach((row) => {
      const key = buildScreenerDataHealth(row, activeSettings).status.key;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [dataHealthBaseRows, activeSettings]);
  const dataHealthSummary = useMemo(() => buildScreenerDataHealthSummary(dataHealthBaseRows, activeSettings), [dataHealthBaseRows, activeSettings]);
  const dataHealthOptions = useMemo(() => {
    const known = DATA_HEALTH_FILTER_ORDER.filter((key) => dataHealthCounts.has(key));
    const unknown = [...dataHealthCounts.keys()].filter((key) => !DATA_HEALTH_FILTER_ORDER.includes(key)).sort();
    return [DATA_HEALTH_FILTER_ALL, ...known, ...unknown].map((key) => ({
      key,
      label: dataHealthFilterLabel(key),
      displayLabel: key === DATA_HEALTH_FILTER_ALL ? "Datos: Todos" : `${dataHealthFilterLabel(key)}${dataHealthCounts.get(key) ? ` (${dataHealthCounts.get(key)})` : ""}`,
    }));
  }, [dataHealthCounts]);
  const reviewPrioritySummary = useMemo(() => buildReviewPrioritySummary(reviewPriorityBaseRows, activeSettings), [reviewPriorityBaseRows, activeSettings]);
  const reviewPriorityOptions = useMemo(() => [
    { key: "all", label: "Todas", displayLabel: "Prioridad: Todas" },
    ...reviewPrioritySummary.map((item) => ({
      key: item.key,
      label: item.label,
      displayLabel: `${item.label}${item.count ? ` (${item.count})` : ""}`,
    })),
  ], [reviewPrioritySummary]);
  const reliabilitySummary = useMemo(() => buildScreenerReliabilitySummary(reliabilityBaseRows, activeSettings), [reliabilityBaseRows, activeSettings]);
  const reliabilityCounts = useMemo(() => new Map(Object.entries(reliabilitySummary.counts || {}).filter(([, count]) => Number(count) > 0)), [reliabilitySummary]);
  const reliabilityOptions = useMemo(() => {
    const known = RELIABILITY_FILTER_ORDER.filter((key) => reliabilityCounts.has(key));
    const unknown = [...reliabilityCounts.keys()].filter((key) => !RELIABILITY_FILTER_ORDER.includes(key)).sort();
    return [RELIABILITY_FILTER_ALL, ...known, ...unknown].map((key) => ({
      key,
      label: screenerReliabilityFilterLabel(key),
      displayLabel: key === RELIABILITY_FILTER_ALL ? "Fiabilidad: Todas" : `${screenerReliabilityFilterLabel(key)}${reliabilityCounts.get(key) ? ` (${reliabilityCounts.get(key)})` : ""}`,
    }));
  }, [reliabilityCounts]);
  const decisionEvidenceSummary = useMemo(() => buildDecisionEvidenceSummary(decisionEvidenceBaseRows, activeSettings), [decisionEvidenceBaseRows, activeSettings]);
  const decisionEvidenceCounts = useMemo(() => new Map(Object.entries(decisionEvidenceSummary.counts || {}).filter(([, count]) => Number(count) > 0)), [decisionEvidenceSummary]);
  const decisionEvidenceOptions = useMemo(() => {
    const known = DECISION_EVIDENCE_FILTER_ORDER.filter((key) => decisionEvidenceCounts.has(key));
    const unknown = [...decisionEvidenceCounts.keys()].filter((key) => !DECISION_EVIDENCE_FILTER_ORDER.includes(key)).sort();
    return [DECISION_EVIDENCE_FILTER_ALL, ...known, ...unknown].map((key) => ({
      key,
      label: decisionEvidenceFilterLabel(key),
      displayLabel: key === DECISION_EVIDENCE_FILTER_ALL ? "Pruebas: Todas" : `${decisionEvidenceFilterLabel(key)}${decisionEvidenceCounts.get(key) ? ` (${decisionEvidenceCounts.get(key)})` : ""}`,
    }));
  }, [decisionEvidenceCounts]);
  function openReviewPriorityQueue(key = "all") {
    const filterKey = key === "all" ? (reviewPrioritySummary[0]?.key || "all") : key;
    if (filterKey === "all") {
      openReview(filtered);
      return;
    }
    const priority = reviewPriorityMeta(filterKey);
    const reviewRows = applyResultViewFilters(rows, { ...viewFilterState, reviewPriorityFilter: filterKey });
    if (!reviewRows.length) {
      setStatus(`Prioridad ${priority.label}: sin resultados visibles.`);
      return;
    }
    openReview(reviewRows, reviewRows[0]?.symbol || "", {
      sourceLabel: `Prioridad: ${priority.label}`,
      sourceDetail: `Filtro de prioridad de investigacion · ${reviewRows.length} acciones`,
      queueMode: "priority-focus",
    });
  }
  function openReviewDecisionEvidenceQueue(key = DECISION_EVIDENCE_FILTER_ALL) {
    const filterKey = key === DECISION_EVIDENCE_FILTER_ALL
      ? (decisionEvidenceSummary.items || []).find((item) => item.key === "needs-work" && item.count > 0)?.key
        || (decisionEvidenceSummary.items || []).find((item) => item.key === "blocked" && item.count > 0)?.key
        || (decisionEvidenceSummary.items || []).find((item) => item.count > 0)?.key
        || DECISION_EVIDENCE_FILTER_ALL
      : key;
    if (filterKey === DECISION_EVIDENCE_FILTER_ALL) {
      openReview(filtered);
      return;
    }
    const label = decisionEvidenceFilterLabel(filterKey);
    const reviewRows = applyResultViewFilters(rows, { ...viewFilterState, decisionEvidenceFilter: filterKey });
    if (!reviewRows.length) {
      setStatus(`Pruebas ${label}: sin resultados visibles.`);
      return;
    }
    openReview(reviewRows, reviewRows[0]?.symbol || "", {
      sourceLabel: `Pruebas: ${label}`,
      sourceDetail: `Checklist de decision · ${reviewRows.length} acciones`,
      queueMode: "evidence-focus",
    });
  }
  function openReviewScoreAuditQueue(key = SCORE_AUDIT_FILTER_ALL) {
    const preferredKey = scoreAuditCounts.get("attention") > 0
      ? "attention"
      : scoreAuditCounts.get("mismatch") > 0
        ? "mismatch"
        : scoreAuditCounts.get("missing") > 0
          ? "missing"
          : SCORE_AUDIT_FILTER_ALL;
    const filterKey = key === SCORE_AUDIT_FILTER_ALL ? preferredKey : key;
    if (filterKey === SCORE_AUDIT_FILTER_ALL) {
      openReview(filtered);
      return;
    }
    const label = scoreAuditFilterLabel(filterKey);
    const reviewRows = applyResultViewFilters(rows, { ...viewFilterState, scoreAuditFilter: filterKey });
    if (!reviewRows.length) {
      setStatus(`Score audit ${label}: sin resultados visibles.`);
      return;
    }
    openReview(reviewRows, reviewRows[0]?.symbol || "", {
      sourceLabel: `Score audit: ${label}`,
      sourceDetail: `Auditoria de score · ${reviewRows.length} acciones`,
      queueMode: "score-audit-focus",
    });
  }
  function openReviewMethodologyFocusQueue(key = "") {
    const focusKey = String(key || "").trim();
    if (!focusKey) {
      openReview(filtered);
      return;
    }
    const target = (visibleAuditabilitySummary.methodologyReviewFocus || []).find((item) => item.key === focusKey) || null;
    const reviewRows = filtered.filter((row) => {
      const evidence = buildDecisionEvidenceChecklist(row, activeSettings);
      return (evidence.reviewFocus || []).some((item) => item.requiresReview && item.key === focusKey);
    });
    if (!reviewRows.length) {
      setStatus(`Foco metodológico ${target?.label || focusKey}: sin resultados visibles.`);
      return;
    }
    openReview(reviewRows, reviewRows[0]?.symbol || "", {
      sourceLabel: `Método: ${target?.label || focusKey}`,
      sourceDetail: `Foco de revisión metodológica · ${reviewRows.length} acciones · herramienta de observación`,
      queueMode: "methodology-focus",
    });
  }
  const scoreAuditCounts = useMemo(() => {
    const counts = new Map();
    SCORE_AUDIT_FILTER_ORDER.forEach((key) => counts.set(key, 0));
    scoreAuditBaseRows.forEach((row) => {
      SCORE_AUDIT_FILTER_ORDER.forEach((key) => {
        if (scoreAuditMatchesFilter(row, key)) counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return counts;
  }, [scoreAuditBaseRows]);
  const scoreAuditOptions = useMemo(() => {
    const known = SCORE_AUDIT_FILTER_ORDER.filter((key) => scoreAuditCounts.get(key) > 0);
    return [SCORE_AUDIT_FILTER_ALL, ...known].map((key) => ({
      key,
      label: scoreAuditFilterLabel(key),
      displayLabel: key === SCORE_AUDIT_FILTER_ALL ? "Score: Todos" : `${scoreAuditFilterLabel(key)}${scoreAuditCounts.get(key) ? ` (${scoreAuditCounts.get(key)})` : ""}`,
    }));
  }, [scoreAuditCounts]);
  const scoreAuditSummary = useMemo(() => buildScreenerScoreAuditSummary(scoreAuditBaseRows), [scoreAuditBaseRows]);
  const visibleDecisionBrief = useMemo(() => buildScreenerDecisionBrief({ audit: visibleDecisionAudit, rows: filtered }), [visibleDecisionAudit, filtered]);
  const visibleDataHealthSummary = useMemo(() => buildScreenerDataHealthSummary(filtered, activeSettings), [filtered, activeSettings]);
  const visibleDecisionEvidenceSummary = useMemo(() => buildDecisionEvidenceSummary(filtered, activeSettings), [filtered, activeSettings]);
  const visibleScoreAuditSummary = useMemo(() => buildScreenerScoreAuditSummary(filtered), [filtered]);
  const visibleAuditabilitySummary = useMemo(() => buildScreenerAuditabilitySummary(filtered, activeSettings), [filtered, activeSettings]);
  const decisionResolutionOptions = useMemo(() => buildStockDecisionResolutionSummary(rows, { decisionResolutions: screenerDecisionResolutions })
    .map((item) => ({
      ...item,
      label: decisionResolutionDisplayLabel(item.key),
      displayLabel: item.key === "all" ? "Resolución: Todas" : `${decisionResolutionDisplayLabel(item.key)}${item.count ? ` (${item.count})` : ""}`,
    })), [rows, screenerDecisionResolutions]);
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
    const rankExplain = row ? explainScreenerRank(row, activeSettings) : null;
    const decisionIssues = row ? auditDecisionRowIssues(row, rankExplain || activeSettings) : [];
    const decisionTrace = row ? decisionTraceForRow(row, rankExplain || activeSettings) : null;
    const decisionBrief = row ? (decisionTrace?.brief || buildDecisionBrief(row, rankExplain || activeSettings)) : null;
    const decisionEvidence = row ? buildDecisionEvidenceChecklist(row, rankExplain || activeSettings) : null;
    const dataHealth = row ? buildScreenerDataHealth(row, activeSettings) : null;
    const scoreAudit = row ? buildScreenerScoreAudit(row) : null;
    const metricTruth = row ? reviewQueueMetricTruthMeta(row) : null;
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
  const resultFilterChips = [
    viewLayers.country && countryFilter !== "Todos" ? { key: "country", label: `País: ${marketName(countryFilter)}`, onClear: () => setCountryFilter("Todos") } : null,
    viewLayers.theme && themeFilter !== "Todos" ? { key: "theme", label: `Tema: ${themeFilter}`, onClear: () => setThemeFilter("Todos") } : null,
    viewLayers.sector && sectorFilter !== "Todos" ? { key: "sector", label: `Sector: ${sectorFilter}`, onClear: () => setSectorFilter("Todos") } : null,
    viewLayers.industry && industryFilter !== "Todos" ? { key: "industry", label: `Subsector: ${industryFilter}`, onClear: () => setIndustryFilter("Todos") } : null,
    viewLayers.sectorStrength && sectorStrength !== "Todos" ? { key: "sectorStrength", label: `Fuerza: ${SECTOR_STRENGTH_LABELS[sectorStrength] || sectorStrength}`, onClear: () => setSectorStrength("Todos") } : null,
    viewLayers.ipo && ipo !== "Todos" ? { key: "ipo", label: `IPO: ${ipo}`, onClear: () => setIpo("Todos") } : null,
    readinessFilter !== "Todos" ? { key: "readiness", label: `Decisión: ${decisionReadinessLabel(readinessFilter)}`, onClear: () => setReadinessFilter("Todos") } : null,
    decisionProfileFilter !== "Todos" ? { key: "decisionProfile", label: `Perfil: ${decisionProfileLabel(decisionProfileFilter)}`, onClear: () => setDecisionProfileFilter("Todos") } : null,
    reviewPriorityFilter !== "all" ? { key: "reviewPriority", label: `Prioridad: ${reviewPriorityDisplayLabel(reviewPriorityFilter)}`, onClear: () => setReviewPriorityFilter("all") } : null,
    reliabilityFilter !== RELIABILITY_FILTER_ALL ? { key: "reliability", label: `Fiabilidad: ${screenerReliabilityFilterLabel(reliabilityFilter, { compact: true })}`, onClear: () => setReliabilityFilter(RELIABILITY_FILTER_ALL) } : null,
    decisionEvidenceFilter !== DECISION_EVIDENCE_FILTER_ALL ? { key: "decisionEvidence", label: `Pruebas: ${decisionEvidenceFilterLabel(decisionEvidenceFilter, { compact: true })}`, onClear: () => setDecisionEvidenceFilter(DECISION_EVIDENCE_FILTER_ALL) } : null,
    actionFilter !== "Todos" ? { key: "action", label: `Acción: ${rankActionLabel(actionFilter)}`, onClear: () => setActionFilter("Todos") } : null,
    confidenceFilter !== "Todos" ? { key: "confidence", label: `Confianza: ${decisionConfidenceLabel(confidenceFilter)}`, onClear: () => setConfidenceFilter("Todos") } : null,
    dataHealthFilter !== DATA_HEALTH_FILTER_ALL ? { key: "dataHealth", label: `Datos: ${dataHealthFilterLabel(dataHealthFilter, { compact: true })}`, onClear: () => setDataHealthFilter(DATA_HEALTH_FILTER_ALL) } : null,
    scoreAuditFilter !== SCORE_AUDIT_FILTER_ALL ? { key: "scoreAudit", label: `Score: ${scoreAuditFilterLabel(scoreAuditFilter, { compact: true })}`, onClear: () => setScoreAuditFilter(SCORE_AUDIT_FILTER_ALL) } : null,
    decisionIssueFilter !== "Todos" ? { key: "decisionIssue", label: `Issue: ${visibleDecisionAudit?.decisionQuality?.topIssues?.find((item) => item.key === decisionIssueFilter)?.label || decisionIssueFilter}`, onClear: () => setDecisionIssueFilter("Todos") } : null,
    decisionResolutionFilter !== "all" ? { key: "decisionResolution", label: `Resolución: ${decisionResolutionDisplayLabel(decisionResolutionFilter)}`, onClear: () => setDecisionResolutionFilter("all") } : null,
  ].filter(Boolean);
  const resultViewBrief = useMemo(() => buildResultViewBrief({
    chips: resultFilterChips,
    visibleCount: filtered.length,
    totalCount: rows.length,
    decisionBrief: visibleDecisionBrief,
    dataHealthSummary: visibleDataHealthSummary,
    decisionEvidenceSummary: visibleDecisionEvidenceSummary,
    scoreAuditSummary: visibleScoreAuditSummary,
    pendingDecisionWorkSummary,
  }), [resultFilterChips, filtered.length, rows.length, visibleDecisionBrief, visibleDataHealthSummary, visibleDecisionEvidenceSummary, visibleScoreAuditSummary, pendingDecisionWorkSummary]);
  function openResultViewReview() {
    if (!filtered.length) return;
    openReview(filtered, resultViewBrief?.primarySymbol || filtered[0]?.symbol || "", {
      sourceLabel: "Vista filtrada",
      sourceDetail: resultViewBrief?.sourceDetail || `${filtered.length} resultados filtrados`,
      queueMode: "filtered-view",
    });
  }
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
    if (key === "action") setActionFilter("Todos");
    if (key === "readiness") setReadinessFilter("Todos");
    if (key === "decisionProfile") setDecisionProfileFilter("Todos");
    if (key === "reviewPriority") setReviewPriorityFilter("all");
    if (key === "reliability") setReliabilityFilter(RELIABILITY_FILTER_ALL);
    if (key === "decisionEvidence") setDecisionEvidenceFilter(DECISION_EVIDENCE_FILTER_ALL);
    if (key === "confidence") setConfidenceFilter("Todos");
    if (key === "dataHealth") setDataHealthFilter(DATA_HEALTH_FILTER_ALL);
    if (key === "scoreAudit") setScoreAuditFilter(SCORE_AUDIT_FILTER_ALL);
    if (key === "decisionIssue") setDecisionIssueFilter("Todos");
    if (key === "decisionResolution") setDecisionResolutionFilter("all");
  }
  const clearResultView = () => {
    setCountryFilter("Todos");
    setThemeFilter("Todos");
    setSectorFilter("Todos");
    setIndustryFilter("Todos");
    setSectorStrength("Todos");
    setIpo("Todos");
    setActionFilter("Todos");
    setReadinessFilter("Todos");
    setDecisionProfileFilter("Todos");
    setReviewPriorityFilter("all");
    setReliabilityFilter(RELIABILITY_FILTER_ALL);
    setDecisionEvidenceFilter(DECISION_EVIDENCE_FILTER_ALL);
    setConfidenceFilter("Todos");
    setDataHealthFilter(DATA_HEALTH_FILTER_ALL);
    setScoreAuditFilter(SCORE_AUDIT_FILTER_ALL);
    setDecisionIssueFilter("Todos");
    setDecisionResolutionFilter("all");
  };
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
  useEffect(() => {
    if (countryFilter !== "Todos" && !countryOptions.includes(countryFilter)) setCountryFilter("Todos");
    if (themeFilter !== "Todos" && !themeOptions.includes(themeFilter)) setThemeFilter("Todos");
    if (sectorFilter !== "Todos" && !sectorOptions.includes(sectorFilter)) setSectorFilter("Todos");
    if (industryFilter !== "Todos" && !industryOptions.includes(industryFilter)) setIndustryFilter("Todos");
    if (ipo !== "Todos" && !ipos.includes(ipo)) setIpo("Todos");
    if (rows.length && actionFilter !== "Todos" && !actionOptions.includes(actionFilter)) setActionFilter("Todos");
    if (rows.length && readinessFilter !== "Todos" && !readinessOptions.includes(readinessFilter)) setReadinessFilter("Todos");
    if (rows.length && decisionProfileFilter !== "Todos" && !decisionProfileOptions.includes(decisionProfileFilter)) setDecisionProfileFilter("Todos");
    if (rows.length && reviewPriorityFilter !== "all" && !reviewPriorityOptions.some((item) => item.key === reviewPriorityFilter)) setReviewPriorityFilter("all");
    if (rows.length && reliabilityFilter !== RELIABILITY_FILTER_ALL && !reliabilityOptions.some((item) => item.key === reliabilityFilter)) setReliabilityFilter(RELIABILITY_FILTER_ALL);
    if (rows.length && decisionEvidenceFilter !== DECISION_EVIDENCE_FILTER_ALL && !decisionEvidenceOptions.some((item) => item.key === decisionEvidenceFilter)) setDecisionEvidenceFilter(DECISION_EVIDENCE_FILTER_ALL);
    if (rows.length && confidenceFilter !== "Todos" && !confidenceOptions.includes(confidenceFilter)) setConfidenceFilter("Todos");
    if (rows.length && dataHealthFilter !== DATA_HEALTH_FILTER_ALL && !dataHealthOptions.some((item) => item.key === dataHealthFilter)) setDataHealthFilter(DATA_HEALTH_FILTER_ALL);
    if (rows.length && scoreAuditFilter !== SCORE_AUDIT_FILTER_ALL && !scoreAuditOptions.some((item) => item.key === scoreAuditFilter)) setScoreAuditFilter(SCORE_AUDIT_FILTER_ALL);
    if (rows.length && decisionResolutionFilter !== "all" && !decisionResolutionOptions.some((item) => item.key === decisionResolutionFilter)) setDecisionResolutionFilter("all");
  }, [countryFilter, countryOptions, themeFilter, themeOptions, sectorFilter, sectorOptions, industryFilter, industryOptions, ipo, ipos, rows.length, actionFilter, actionOptions, readinessFilter, readinessOptions, decisionProfileFilter, decisionProfileOptions, reviewPriorityFilter, reviewPriorityOptions, reliabilityFilter, reliabilityOptions, decisionEvidenceFilter, decisionEvidenceOptions, confidenceFilter, confidenceOptions, dataHealthFilter, dataHealthOptions, scoreAuditFilter, scoreAuditOptions, decisionResolutionFilter, decisionResolutionOptions]);
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
    const metricTruth = reviewQueueMetricTruthMeta(row);
    const vcp = vcpReliabilityAudit(row);
    const focus = reviewQueueFocusMeta({ dataHealth, metricTruth, scoreAudit, evidence: item.evidence, methodologyFocus: item.methodologyFocus, vcp });
    const trustSignature = buildRowTrustSignature({ dataHealth, metricTruth, scoreAudit, evidence: item.evidence, vcpReliability: vcp });
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

  return <main className="page screenerTerminalPage">
    <div className="topbar screenerHeroBar">
      <div className="screenerHeroTitle">
        <span className="screenerEyebrow">StatsEdge · Screener</span>
        <h1 className="title">Global Leaders</h1>
        <p>{PRESETS[presetKey]?.name || "Filtro activo"} · {markets.length} mercados · {filtered.length} resultados visibles</p>
      </div>
      <div className="actions">
        <button className="btn btnMobileOnly" onClick={() => setShowMobileFilters(!showMobileFilters)}>Filtros</button>
        <button className={`btn ${running ? "btnGhost" : "btnPrimary"}`} onClick={() => { if (running) stopScan(); else { setShowMobileFilters(false); run(); } }}>{running ? "Detener" : "Ejecutar"}</button>
      </div>
    </div>
    {err && <div className="error">{err}</div>}
    <div className={`scanStatusBar ${running ? "running" : err ? "error" : ""}`} role="status" aria-live="polite">
      <span>{running ? "En ejecución" : err ? "Incidencia" : "Estado"}</span>
      <b>{investorStatusLabel(status)}</b>
    </div>
    {snapshotNotice ? <div className={`snapshotFreshnessNotice ${snapshotNotice.tone || "info"}`} role="note">
      <span>{snapshotNotice.label}</span>
      <b>{snapshotNotice.detail}</b>
    </div> : null}
    
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
                <PreviewCard row={searchResult} variant="search" onFavorite={addFavorite} onOpenStock={saveSessionBeforeStockOpen} isFavorite={favoriteSymbols.has(searchResult.symbol)} decisionResolutions={screenerDecisionResolutions} />
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
          <PendingDecisionWorkRail
            summary={pendingDecisionWorkSummary}
            active={pendingDecisionWorkActive}
            onFocus={applyPendingDecisionWorkFocus}
            onClear={clearPendingDecisionWorkFocus}
            onReview={reviewPendingDecisionWork}
            className="mobile"
          />
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
            onAuditJson={() => decisionAuditJson(filtered)}
            onOpenStock={saveSessionBeforeStockOpen}
            savingDisabled={running}
            page={visibleResultPage}
            pageSize={resultPageSize}
            totalPages={totalResultPages}
            onPage={setResultPageClamped}
            onPageSize={updateResultPageSize}
            decisionQuality={visibleDecisionAudit}
            decisionIssueFilter={decisionIssueFilter}
            onDecisionIssueFilter={setDecisionIssueFilter}
            decisionProfileFilter={decisionProfileFilter}
            onDecisionProfileFilter={setDecisionProfileFilter}
            reviewPriorityFilter={reviewPriorityFilter}
            reviewPriorityOptions={reviewPriorityOptions}
            onReviewPriorityFilter={setReviewPriorityFilter}
            reliabilityFilter={reliabilityFilter}
            reliabilityOptions={reliabilityOptions}
            onReliabilityFilter={setReliabilityFilter}
            decisionEvidenceSummary={decisionEvidenceSummary}
            decisionEvidenceFilter={decisionEvidenceFilter}
            decisionEvidenceOptions={decisionEvidenceOptions}
            onDecisionEvidenceFilter={setDecisionEvidenceFilter}
            onDecisionEvidenceReview={openReviewDecisionEvidenceQueue}
            readinessSummary={readinessSummary}
            readinessFilter={readinessFilter}
            onReadinessFilter={setReadinessFilter}
            confidenceFilter={confidenceFilter}
            confidenceOptions={confidenceOptions}
            confidenceCounts={confidenceCounts}
            onConfidenceFilter={setConfidenceFilter}
            dataHealthSummary={dataHealthSummary}
            dataHealthFilter={dataHealthFilter}
            dataHealthOptions={dataHealthOptions}
            onDataHealthFilter={setDataHealthFilter}
            scoreAuditSummary={scoreAuditSummary}
            scoreAuditFilter={scoreAuditFilter}
            scoreAuditOptions={scoreAuditOptions}
            onScoreAuditFilter={setScoreAuditFilter}
            onScoreAuditReview={openReviewScoreAuditQueue}
            decisionResolutionFilter={decisionResolutionFilter}
            decisionResolutionOptions={decisionResolutionOptions}
            onDecisionResolutionFilter={setDecisionResolutionFilter}
            decisionResolutions={screenerDecisionResolutions}
            emptyLabel={restoringScan ? "Cargando último snapshot guardado..." : undefined}
          />
        </section>

        <section className="desktopResultsSection" style={{ marginBottom: 20 }}>
          <PendingResultsBar pending={pendingResults ? { ...pendingResults, filteredCount: pendingFilteredCount } : null} visibleCount={rows.length} filteredCount={filtered.length} onCommit={commitPendingResults} />
          <div className="resultsHeader">
            <div className="resultsTitleBlock">
              <span>Results</span>
              <h2>{filtered.length} resultados</h2>
              <p>{rows.length} pasan · {analyzedRows.length || universe.length || 0} analizadas · {SORT_LABELS[sort] || sort}</p>
              <DecisionSummaryRail summary={readinessSummary} activeKey={readinessFilter} onSelect={setReadinessFilter} />
              <ReviewPriorityResultRail summary={reviewPrioritySummary} activeKey={reviewPriorityFilter} onSelect={setReviewPriorityFilter} onReview={openReviewPriorityQueue} />
            </div>
            <div className="controls">
              {(rows.length > 0 || pendingResults?.rows?.length || diagnostics) ? <button className="btn btnSmall btnGhost" onClick={resetScreenerSession}>Reset sesión</button> : null}
              {filtered.length ? <>
                <button className="btn btnSmall btnGhost" onClick={() => csv(filtered)}>↓ CSV</button>
                <button className="btn btnSmall btnGhost" onClick={() => decisionAuditJson(filtered)} title="Exportar JSON compatible con audit:decisions">JSON audit</button>
                <button className="btn btnSmall btnPrimary" onClick={() => openReview(filtered)}>Revisar</button>
                <button className="btn btnSmall" onClick={() => saveSnapshot(filtered)} disabled={running} aria-label="Guardar snapshot de resultados">Guardar</button>
              </> : null}
            </div>
          </div>
          <DecisionQualityStrip audit={visibleDecisionAudit} activeIssueKey={decisionIssueFilter} onIssueSelect={setDecisionIssueFilter} activeProfileKey={decisionProfileFilter} onProfileSelect={setDecisionProfileFilter} />
          <DecisionOperatingBrief audit={visibleDecisionAudit} rows={filtered} onIssueSelect={setDecisionIssueFilter} onReadinessFilter={setReadinessFilter} onConfidenceFilter={setConfidenceFilter} onReview={() => openReview(filtered)} />
          <DecisionEvidenceSummaryRail summary={decisionEvidenceSummary} activeKey={decisionEvidenceFilter} onSelect={setDecisionEvidenceFilter} onReview={openReviewDecisionEvidenceQueue} />
          <DataHealthSummaryRail summary={dataHealthSummary} activeKey={dataHealthFilter} onSelect={setDataHealthFilter} />
          <ScoreAuditSummaryRail summary={scoreAuditSummary} activeKey={scoreAuditFilter} onSelect={setScoreAuditFilter} onReview={openReviewScoreAuditQueue} />
          <AuditabilitySummaryRail summary={visibleAuditabilitySummary} onReviewFocus={openReviewMethodologyFocusQueue} />
          <PendingDecisionWorkRail
            summary={pendingDecisionWorkSummary}
            active={pendingDecisionWorkActive}
            onFocus={applyPendingDecisionWorkFocus}
            onClear={clearPendingDecisionWorkFocus}
            onReview={reviewPendingDecisionWork}
          />
          <div className="controls resultFilterBar" style={{ marginBottom: 12 }}>
            <select className="select resultFilterSelect" value={readinessFilter} onChange={(e) => setReadinessFilter(e.target.value)} aria-label="Filtrar por calidad de decision">
              {readinessOptions.map((x) => <option key={x} value={x}>{optionLabel("Decisión", x, readinessCounts, decisionReadinessLabel)}</option>)}
            </select>
            <select className="select resultFilterSelect" value={decisionResolutionFilter} onChange={(e) => setDecisionResolutionFilter(e.target.value)} aria-label="Filtrar por resolución de decision">
              {decisionResolutionOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
            </select>
            <select className="select resultFilterSelect" value={decisionProfileFilter} onChange={(e) => setDecisionProfileFilter(e.target.value)} aria-label="Filtrar por perfil de decision">
              {decisionProfileOptions.map((x) => <option key={x} value={x}>{optionLabel("Perfil", x, decisionProfileCounts, decisionProfileLabel)}</option>)}
            </select>
            <select className="select resultFilterSelect" value={reviewPriorityFilter} onChange={(e) => setReviewPriorityFilter(e.target.value)} aria-label="Filtrar por prioridad de investigacion">
              {reviewPriorityOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
            </select>
            <select className="select resultFilterSelect" value={reliabilityFilter} onChange={(e) => setReliabilityFilter(e.target.value)} aria-label="Filtrar por fiabilidad de observacion">
              {reliabilityOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
            </select>
            <select className="select resultFilterSelect" value={decisionEvidenceFilter} onChange={(e) => setDecisionEvidenceFilter(e.target.value)} aria-label="Filtrar por pruebas de decision">
              {decisionEvidenceOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
            </select>
            <select className="select resultFilterSelect" value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)} aria-label="Filtrar por confianza de decision">
              {confidenceOptions.map((x) => <option key={x} value={x}>{optionLabel("Confianza", x, confidenceCounts, decisionConfidenceLabel)}</option>)}
            </select>
            <select className="select resultFilterSelect" value={dataHealthFilter} onChange={(e) => setDataHealthFilter(e.target.value)} aria-label="Filtrar por salud de datos">
              {dataHealthOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
            </select>
            <select className="select resultFilterSelect" value={scoreAuditFilter} onChange={(e) => setScoreAuditFilter(e.target.value)} aria-label="Filtrar por auditoría de score">
              {scoreAuditOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel}</option>)}
            </select>
            <select className="select resultFilterSelect" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} aria-label="Filtrar por accion sugerida">
              {actionOptions.map((x) => <option key={x} value={x}>{optionLabel("Acción", x, actionCounts, rankActionLabel)}</option>)}
            </select>
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
              <option value="objectiveScore">Ordenar: Calidad objetiva</option>
              <option value="decisionPriority">Ordenar: Calidad decisión</option>
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
          <ResultFilterChips chips={resultFilterChips} hiddenCount={hiddenByView} visibleCount={filtered.length} totalCount={rows.length} brief={resultViewBrief} onClearAll={clearResultView} onReview={filtered.length ? openResultViewReview : undefined} />
          {filtered.length ? <div className="controls resultPager" style={{ justifyContent: "space-between", marginBottom: 12 }}>
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
      <CompactResultsTable rows={pagedRows} settings={activeSettings} favoriteSymbols={favoriteSymbols} onFavorite={addFavorite} onReview={(symbol) => openReview(filtered, symbol)} onOpenStock={saveSessionBeforeStockOpen} rankOffset={resultPageStart} emptyLabel={restoringScan ? "Cargando último snapshot guardado..." : undefined} decisionIssueFilter={decisionIssueFilter} onDecisionIssueFilter={setDecisionIssueFilter} decisionEvidenceFilter={decisionEvidenceFilter} onDecisionEvidenceFilter={setDecisionEvidenceFilter} dataHealthFilter={dataHealthFilter} onDataHealthFilter={setDataHealthFilter} scoreAuditFilter={scoreAuditFilter} onScoreAuditFilter={setScoreAuditFilter} decisionResolutions={screenerDecisionResolutions} />
        </section>
      </main>
    </div>
    <footer className="footer" style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 16, fontSize: 11, opacity: 0.5 }}>StatsEdge · Datos orientativos · {investorStatusLabel(status)}</footer>

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
              <Link className="btn" href={stockUrl(activeModalRow.symbol)} onPointerDown={() => saveQuickReviewStockOpen(activeModalRow, modalReviewPosition)} onClick={() => saveQuickReviewStockOpen(activeModalRow, modalReviewPosition)}>Ficha</Link>
              <a className="btn" href={externalLinks(activeModalRow.symbol, activeModalRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
              <button className="btn" onClick={closeQuickReview}>Cerrar</button>
            </div>
          </div>

          <div className={`quickReviewSourceBrief mode-${modalReviewQueueMode}`} aria-label="Origen de la cola Review">
            <span>
              <em>Origen cola</em>
              <b>{modalOriginLabel}</b>
            </span>
            {modalReviewSourceDetail ? <p>{modalReviewSourceDetail}</p> : <p>{modalReviewRows.length} acciones abiertas desde el Screener.</p>}
            <small>{modalReviewRows.length} acciones · {modalReviewPosition + 1}/{modalReviewRows.length}</small>
          </div>

          <ScreenerOriginPanel origin={quickReviewOrigin} variant="review" />
          <div className="reviewResolveRail quickReviewResolveRail" aria-label="Resolver decision desde Vista rápida">
            <span>{modalActiveResolution ? `Resolución: ${modalActiveResolution.label}` : "Resolver cola"}</span>
            <div>
              <button
                type="button"
                className={`neutral ${!modalActiveResolution ? "active" : ""}`.trim()}
                onClick={() => reopenQuickReviewDecision(activeModalRow, modalReviewPosition)}
                disabled={!modalActiveResolution}
                title="Vuelve a pendiente"
              >
                Reabrir
              </button>
              {STOCK_DECISION_ACTIONS.map((item) => <button
                type="button"
                key={item.key}
                className={`${item.tone || ""} ${modalActiveResolution?.key === item.key ? "active" : ""}`.trim()}
                onClick={() => resolveQuickReviewDecision(item.key, activeModalRow, modalReviewPosition)}
                title={item.detail}
              >
                {item.label}
              </button>)}
            </div>
          </div>
          {!quickReviewOrigin?.decisionBrief && modalRankExplain ? <div className={`reviewThesisBar ${modalRankExplain.readiness.tone}`}>
            <span className="reviewDecisionPills">
              <span className={`rankActionBadge ${modalRankExplain.action.tone}`}>{modalRankExplain.action.label}</span>
              <span className={`rankDecisionBadge ${modalRankExplain.readiness.tone}`}>{modalRankExplain.readiness.label}</span>
            </span>
            <b>{modalRankExplain.line}</b>
            <small>{modalRankExplain.readiness.detail}</small>
          </div> : null}

          <div className="screenerReviewLayout">
            <aside className="reviewQueue screenerReviewQueue" aria-label="Cola de acciones del screener">
              <div className="reviewQueueHead">
                <h2>Cola</h2>
                <span>{modalReviewRows.length}</span>
              </div>
              {modalReviewAuditSummary.length ? <div className="reviewQueueSummary reviewQueueAuditSummary" aria-label="Resumen de auditoría de la cola">
                {modalReviewAuditSummary.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={`reviewQueueSummaryChip audit-${item.key} ${item.tone || "neutral"} ${item.active ? "active" : ""}`}
                    onClick={() => selectQuickReview(item.firstIndex, modalReviewRows)}
                    disabled={!item.count}
                    title={item.detail}
                  >
                    <b>{item.count}</b>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div> : null}
              {modalReviewPrioritySummary.length ? <div className="reviewQueueSummary reviewPrioritySummary" aria-label="Prioridad de investigacion">
                {modalReviewPrioritySummary.map((group) => (
                  <button
                    type="button"
                    key={group.key}
                    className={`reviewQueueSummaryChip priority-${group.key} ${group.tone || "neutral"} ${modalReviewQueueItems[modalReviewPosition]?.reviewPriority?.key === group.key ? "active" : ""}`}
                    onClick={() => selectQuickReview(group.firstIndex, modalReviewRows)}
                    title={[group.topSymbol ? `${group.topSymbol} · ${Math.round(group.topScore || 0)}` : "", group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label].filter(Boolean).join(" · ")}
                  >
                    <b>{group.count}</b>
                    <span>{group.shortLabel || group.label}</span>
                  </button>
                ))}
              </div> : null}
              {modalReviewProfileSummary.length ? <div className="reviewQueueSummary reviewQueueProfileSummary" aria-label="Prioridad de cola por perfil">
                {modalReviewProfileSummary.map((group) => (
                  <button
                    type="button"
                    key={group.key}
                    className={`reviewQueueSummaryChip profile-${group.key} ${group.tone || "neutral"} ${modalReviewQueueItems[modalReviewPosition]?.profileKey === group.key ? "active" : ""}`}
                    onClick={() => selectQuickReview(group.firstIndex, modalReviewRows)}
                    title={group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label}
                  >
                    <b>{group.count}</b>
                    <span>{group.label}</span>
                  </button>
                ))}
              </div> : null}
              {modalReviewQueueSummary.groups.length ? <div className="reviewQueueSummary" aria-label="Resumen de cola por decision">
                {modalReviewQueueSummary.groups.map((group) => (
                  <button
                    type="button"
                    key={group.key}
                    className={`reviewQueueSummaryChip ${group.tone || "neutral"} ${modalReviewQueueItems[modalReviewPosition]?.readiness?.key === group.key ? "active" : ""}`}
                    onClick={() => selectQuickReview(group.firstIndex, modalReviewRows)}
                    title={group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label}
                  >
                    <b>{group.count}</b>
                    <span>{group.label}</span>
                  </button>
                ))}
              </div> : null}
              <div className="reviewQueueList">
                {modalReviewRows.map((row, index) => {
                  const decision = modalReviewQueueItems[index] || buildDecisionQueueItem(row, activeSettings);
                  const resolution = decisionResolutionForSymbol({ decisionResolutions: modalDecisionResolutions }, row.symbol);
                  return <Link
                    key={`${row.symbol}-${index}`}
                    href={stockUrl(row.symbol)}
                    onPointerDown={() => saveQuickReviewStockOpen(row, index)}
                    onClick={() => saveQuickReviewStockOpen(row, index)}
                    className={`reviewQueueItem ${index === modalReviewPosition ? "active" : ""} decision-${decision.readiness?.key || "unknown"} score-audit-${decision.scoreAudit?.key || "unknown"} data-health-${decision.dataHealth?.key || "unknown"} metric-truth-${decision.metricTruth?.key || "unknown"} focus-${decision.focus?.key || "none"} ${resolution ? `resolved-${resolution.key}` : ""}`}
                    aria-current={index === modalReviewPosition ? "true" : undefined}
                    title={resolution ? `${resolution.label} · ${resolution.detail}` : [decision.focus ? `Foco ${decision.focus.label}: ${decision.focus.detail || ""}` : "", `${decision.nextAction?.value || "Revisar"} · ${decision.risk?.value || row.symbol}`].filter(Boolean).join(" · ")}
                  >
                    <CompanyMark row={row} size="sm" />
                    <span className="reviewQueueBody">
                      <b>{row.symbol}</b>
                      <em>{row.companyName || row.name || row.symbol}</em>
                      <RowTrustSignature signature={decision.trustSignature} className="reviewQueueTrustSignature" />
                      <span className="reviewQueueDecisionLine">
                        <span className={`reviewQueueDecisionBadge ${decision.tone || "neutral"}`}>{decision.nextAction?.value || decision.action?.label || "Revisar"}</span>
                        {resolution ? <span className={`reviewQueueResolutionBadge ${resolution.tone || "neutral"}`}>{resolution.label}</span> : null}
                        <ReviewQueueFocusBadge focus={decision.focus} />
                        {decision.reviewPriority ? <span className={`reviewQueuePriorityBadge ${decision.reviewPriority.tone || "neutral"}`} title={decision.reviewPriority.reason}>{decision.reviewPriority.shortLabel || decision.reviewPriority.label}</span> : null}
                        {decision.profileKey && decision.profileKey !== "other" ? <span className={`reviewQueueProfileBadge ${decision.profileTone || "neutral"}`}>{decision.profileLabel}</span> : null}
                        {decision.methodologyFocus ? <span className={`reviewQueueMethodologyBadge ${decision.methodologyFocus.tone || "neutral"}`} title={decision.methodologyFocus.detail || decision.methodologyFocus.label}>Método: {decision.methodologyFocus.shortLabel || decision.methodologyFocus.label}</span> : null}
                        {decision.dataHealth ? <span className={`reviewQueueDataHealthBadge ${decision.dataHealth.tone || "neutral"} data-${decision.dataHealth.key || "unknown"}`} title={decision.dataHealth.detail || decision.dataHealth.label}>{decision.dataHealth.label}</span> : null}
                        {decision.metricTruth ? <span className={`reviewQueueMetricTruthBadge ${decision.metricTruth.tone || "neutral"} metric-${decision.metricTruth.key || "unknown"}`} title={decision.metricTruth.detail || decision.metricTruth.label}>{decision.metricTruth.label}</span> : null}
                        {decision.scoreAudit ? <span className={`reviewQueueScoreAuditBadge ${decision.scoreAudit.tone || "neutral"} score-${decision.scoreAudit.key || "unknown"}`} title={decision.scoreAudit.detail || decision.scoreAudit.label}>{decision.scoreAudit.label}</span> : null}
                        {decision.risk?.value ? <small>{decision.risk.value}</small> : null}
                      </span>
                    </span>
                    <i>{decision.score ?? (Number.isFinite(row.objectiveScore) ? Math.round(row.objectiveScore) : Number.isFinite(row.totalScore) ? Math.round(row.totalScore) : "-")}</i>
                  </Link>;
                })}
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
                  <ReviewPriorityPanel priority={modalActiveReviewPriority} compact />
                  <DecisionEvidenceChecklist evidence={modalDecisionEvidence} compact />
                  <ScoreAuditPanel audit={modalScoreAudit} />

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
                    <div className="profileRow"><span>{metricShortLabel("objectiveScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="objectiveScore" label={metricShortLabel("objectiveScore")} value={activeModalRow.objectiveScore?.toFixed(0) || activeModalRow.totalScore?.toFixed(0) || "-"} className="up" /></div>
                    <div className="profileRow"><span>{metricShortLabel("totalScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="totalScore" label={metricShortLabel("totalScore")} value={activeModalRow.totalScore?.toFixed(0) || "-"} /></div>
                    <div className="profileRow"><span>{metricShortLabel("rsGlobalPct")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="rsGlobalPct" label={metricShortLabel("rsGlobalPct")} value={activeModalRow.rsGlobalPct?.toFixed(0) || "-"} /></div>
                    <div className="profileRow"><span>{metricShortLabel("rsQualityScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="rsQualityScore" label={metricShortLabel("rsQualityScore")} value={activeModalRow.rsQualityScore?.toFixed(0) || "-"} /></div>
                    <div className="profileRow"><span>{metricShortLabel("adProxyScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="adProxyScore" label={metricShortLabel("adProxyScore")} value={activeModalRow.adProxyScore?.toFixed(0) || "-"} /></div>
                    <div className="profileRow"><span>{metricShortLabel("epsGrowthProxyScore")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="epsGrowthProxyScore" label={metricShortLabel("epsGrowthProxyScore")} value={activeModalRow.epsGrowthProxyScore?.toFixed(0) || "-"} /></div>
                    <div className="profileRow"><span>Setup quality</span><QuickReviewMetricValue row={activeModalRow} metricKey="setupQualityScore" label="Setup quality" value={activeModalRow.setupQualityScore?.toFixed(0) || "-"} /></div>
                    <div className="profileRow"><span>Growth</span><QuickReviewMetricValue row={activeModalRow} metricKey="growthScore" label="Growth" value={activeModalRow.growthScore?.toFixed(0) || "-"} /></div>
                    <div className="profileRow"><span>Rentabilidad/riesgo</span><QuickReviewMetricValue row={activeModalRow} metricKey="riskRewardScore" label="Rentabilidad/riesgo" value={activeModalRow.riskRewardScore?.toFixed(0) || "-"} /></div>
                  </div>

                  <div className="profileCard">
                    <div className="profileCardHeader">
                      <h3>Volumen y riesgo</h3>
                      <span>Datos</span>
                    </div>
                    <div className="profileRow"><span>Volumen sesión</span><QuickReviewMetricValue row={activeModalRow} metricKey="latestTurnover" label="Volumen sesión" value={amount(activeModalRow.latestTurnover, activeModalRow.currency) || "-"} /></div>
                    <div className="profileRow"><span>Volumen 5d</span><QuickReviewMetricValue row={activeModalRow} metricKey="volumeSurgePct" label="Volumen 5d" value={pct(activeModalRow.volumeSurgePct)} className={(activeModalRow.volumeSurgePct || 0) > 0 ? "up" : ""} /></div>
                    <div className="profileRow"><span>Up/down ratio</span><QuickReviewMetricValue row={activeModalRow} metricKey="upDownVolRatio" label="Up/down ratio" value={ratioLabel(activeModalRow.upDownVolRatio)} /></div>
                    <div className="profileRow"><span>{metricShortLabel("shortPercentOfFloat")}</span><QuickReviewMetricValue row={activeModalRow} metricKey="shortPercentOfFloat" label={metricShortLabel("shortPercentOfFloat")} value={pct(activeModalRow.shortPercentOfFloat)} /></div>
                    <div className="profileRow"><span>Drawdown 3M</span><QuickReviewMetricValue row={activeModalRow} metricKey="maxDrawdown63d" label="Drawdown 3M" value={Number.isFinite(activeModalRow.maxDrawdown63d) ? `${activeModalRow.maxDrawdown63d.toFixed(1)}%` : "-"} className="down" /></div>
                    <div className="profileRow"><span>Volatilidad</span><QuickReviewMetricValue row={activeModalRow} metricKey="volatility63d" label="Volatilidad" value={Number.isFinite(activeModalRow.volatility63d) ? `${activeModalRow.volatility63d.toFixed(1)}%` : "-"} /></div>
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
