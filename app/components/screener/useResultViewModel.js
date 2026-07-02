"use client";

import { useEffect, useMemo, useState } from "react";
import { buildResultViewBrief } from "@/app/components/screener/resultViewBrief";
import { applyResultViewFilters, opportunityBuckets, passesSectorStrength, verifiedIpoCategory } from "@/lib/screenerResultView";
import { decisionConfidenceLabel, decisionConfidenceSummary, decisionPriorityBreakdown, DECISION_CONFIDENCE_ORDER, auditDecisionRowIssues, auditDecisionScan } from "@/lib/decisionAudit";
import { DECISION_PROFILE_ORDER, buildReviewPrioritySummary, decisionProfileForRow, decisionProfileLabel, reviewPriorityMeta } from "@/lib/decisionProfile";
import { rowPassesListContract } from "@/lib/listRationale";
import {
  DATA_HEALTH_FILTER_ALL,
  DATA_HEALTH_FILTER_ORDER,
  buildScreenerDataHealth,
  buildScreenerDataHealthSummary,
  dataHealthFilterLabel,
} from "@/lib/screenerDataHealth";
import {
  DEFAULT_RESULT_PAGE_SIZE,
  MARKET_ORDER,
  marketName,
  normalizeSectorStrength,
  RESULT_PAGE_SIZES,
  SECTOR_STRENGTH_LABELS,
  SECTOR_STRENGTH_OPTIONS,
  VIEW_LAYERS,
} from "@/lib/screenerConfig";
import { buildScreenerDecisionBrief } from "@/lib/screenerDecisionBrief";
import {
  DECISION_EVIDENCE_FILTER_ALL,
  DECISION_EVIDENCE_FILTER_ORDER,
  DECISION_READINESS_ORDER,
  buildDecisionEvidenceChecklist,
  buildDecisionEvidenceSummary,
  decisionEvidenceFilterLabel,
  decisionReadinessLabel,
  explainScreenerRank,
  RANK_ACTION_ORDER,
  rankActionLabel,
} from "@/lib/screenerExplainability";
import { sortMetric, defaultSortForSettings } from "@/lib/screenerPipeline";
import {
  RELIABILITY_FILTER_ALL,
  RELIABILITY_FILTER_ORDER,
  buildScreenerAuditabilitySummary,
  buildScreenerReliabilitySummary,
  screenerReliabilityFilterLabel,
} from "@/lib/screenerReliability";
import {
  SCORE_AUDIT_FILTER_ALL,
  SCORE_AUDIT_FILTER_ORDER,
  buildScreenerScoreAuditSummary,
  scoreAuditFilterLabel,
  scoreAuditMatchesFilter,
} from "@/lib/screenerScoreAudit";
import {
  buildStockDecisionResolutionSummary,
  decisionResolutionForSymbol,
  stockDecisionResolutionFilter,
} from "@/lib/stockDecisionResolution";
import { countryCode } from "@/lib/symbols";

function decisionResolutionDisplayLabel(key = "") {
  return key === "pending" ? "Sin decidir" : stockDecisionResolutionFilter(key).label;
}

function reviewPriorityDisplayLabel(key = "all") {
  return key === "all" ? "Todas" : reviewPriorityMeta(key).label;
}

function cleanOption(value, emptyLabel) {
  return value && value !== emptyLabel ? value : "";
}

function countByOption(list, picker) {
  const counts = new Map();
  list.forEach((row) => {
    const value = picker(row);
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return counts;
}

function optionLabel(prefix, value, counts, formatter = (item) => item) {
  if (value === "Todos") return `${prefix}: Todos`;
  const count = counts?.get(value) || 0;
  return `${formatter(value)}${count ? ` (${count})` : ""}`;
}

function resolveResultPageSize(size) {
  return RESULT_PAGE_SIZES.includes(size) ? size : DEFAULT_RESULT_PAGE_SIZE;
}

export function useResultViewModel({
  rows = [],
  pendingResults = null,
  activeSettings = {},
  viewLayers = {},
  screenerDecisionResolutions = {},
  openReview = () => {},
  setStatus = () => {},
} = {}) {
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
  const [resultPageSize, setResultPageSize] = useState(DEFAULT_RESULT_PAGE_SIZE);
  const [resultPage, setResultPage] = useState(1);

  function restoreResultViewSession(session = {}, fallbackSettings = activeSettings, options = {}) {
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
    setSort(session.sort || defaultSortForSettings(fallbackSettings));
    setResultPageSize(resolveResultPageSize(session.resultPageSize));
    setResultPage(options.resetPage ? 1 : (Number.isFinite(session.resultPage) && session.resultPage > 0 ? session.resultPage : 1));
  }

  function resetResultView(nextSort = defaultSortForSettings(activeSettings)) {
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
    setSort(nextSort);
    setResultPageSize(DEFAULT_RESULT_PAGE_SIZE);
    setResultPage(1);
  }

  const viewFilterState = useMemo(() => ({
    viewLayers,
    countryFilter,
    themeFilter,
    sectorFilter,
    industryFilter,
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
    decisionResolutions: screenerDecisionResolutions,
    activeSettings,
  }), [viewLayers, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, actionFilter, readinessFilter, decisionProfileFilter, reviewPriorityFilter, reliabilityFilter, decisionEvidenceFilter, confidenceFilter, dataHealthFilter, scoreAuditFilter, decisionIssueFilter, decisionResolutionFilter, screenerDecisionResolutions, activeSettings]);

  // ── Paso de anotación única por fila ───────────────────────────────────
  // Consolida explanation/confidence/dataHealth/priority/profile/issues que
  // antes recalculaban 8+ memos independientes y applyResultViewFilters (6×/render).
  // Cache en `__screenerAnnotation`: campo no-persistido (no es RESEARCH_ROW_CORE_FIELD,
  // así que compactResearchRow lo descarta y nunca llega a localStorage).
  function annotateRow(row) {
    const explanation = explainScreenerRank(row, activeSettings);
    const issues = auditDecisionRowIssues(row, explanation);
    return {
      ...row,
      __screenerAnnotation: {
        explanation,
        confidence: decisionConfidenceSummary(row, explanation, issues),
        dataHealth: buildScreenerDataHealth(row, activeSettings),
        priority: decisionPriorityBreakdown(row, explanation),
        profile: decisionProfileForRow(row, activeSettings),
        issues,
      },
    };
  }

  const annotatedRows = useMemo(() => rows.map(annotateRow), [rows, activeSettings]);

  const filtered = useMemo(() => {
    const list = applyResultViewFilters(annotatedRows, viewFilterState);
    return [...list].sort((a, b) => sortMetric(b, sort, activeSettings) - sortMetric(a, sort, activeSettings));
  }, [annotatedRows, viewFilterState, sort, activeSettings]);

  const reviewPriorityBaseRows = useMemo(() => applyResultViewFilters(annotatedRows, {
    ...viewFilterState,
    reviewPriorityFilter: "all",
  }), [annotatedRows, viewFilterState]);
  const reliabilityBaseRows = useMemo(() => applyResultViewFilters(annotatedRows, {
    ...viewFilterState,
    reliabilityFilter: RELIABILITY_FILTER_ALL,
  }), [annotatedRows, viewFilterState]);
  const decisionEvidenceBaseRows = useMemo(() => applyResultViewFilters(annotatedRows, {
    ...viewFilterState,
    decisionEvidenceFilter: DECISION_EVIDENCE_FILTER_ALL,
  }), [annotatedRows, viewFilterState]);
  const dataHealthBaseRows = useMemo(() => applyResultViewFilters(annotatedRows, {
    ...viewFilterState,
    dataHealthFilter: DATA_HEALTH_FILTER_ALL,
  }), [annotatedRows, viewFilterState]);
  const scoreAuditBaseRows = useMemo(() => applyResultViewFilters(annotatedRows, {
    ...viewFilterState,
    scoreAuditFilter: SCORE_AUDIT_FILTER_ALL,
  }), [annotatedRows, viewFilterState]);

  const pendingDecisionWorkSummary = useMemo(() => {
    const pendingItems = filtered.map((row) => {
      if (decisionResolutionForSymbol({ decisionResolutions: screenerDecisionResolutions }, row.symbol)) return null;
      const annotation = row.__screenerAnnotation;
      if (!annotation) return null;
      return {
        row,
        symbol: row.symbol,
        companyName: row.companyName || row.name || "",
        priority: annotation.priority.score,
        confidenceKey: annotation.confidence.key,
        confidenceLabel: annotation.confidence.label,
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
  }, [pendingResults, viewFilterState]);

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
    const nextSize = resolveResultPageSize(size);
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

  const actionCounts = useMemo(() => {
    const counts = new Map();
    annotatedRows.forEach((row) => {
      const annotation = row.__screenerAnnotation;
      if (!annotation) return;
      const actionKey = annotation.explanation.action.key;
      counts.set(actionKey, (counts.get(actionKey) || 0) + 1);
    });
    return counts;
  }, [annotatedRows]);
  const actionOptions = useMemo(() => {
    const known = RANK_ACTION_ORDER.filter((key) => actionCounts.has(key));
    const unknown = [...actionCounts.keys()].filter((key) => !RANK_ACTION_ORDER.includes(key)).sort();
    return ["Todos", ...known, ...unknown];
  }, [actionCounts]);
  const readinessCounts = useMemo(() => {
    const counts = new Map();
    annotatedRows.forEach((row) => {
      const annotation = row.__screenerAnnotation;
      if (!annotation) return;
      const readinessKey = annotation.explanation.readiness.key;
      counts.set(readinessKey, (counts.get(readinessKey) || 0) + 1);
    });
    return counts;
  }, [annotatedRows]);
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
    annotatedRows.forEach((row) => {
      const key = row.__screenerAnnotation?.profile;
      if (!key || key === "other") return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [annotatedRows]);
  const decisionProfileOptions = useMemo(() => {
    const known = DECISION_PROFILE_ORDER.filter((key) => decisionProfileCounts.has(key));
    const unknown = [...decisionProfileCounts.keys()].filter((key) => !DECISION_PROFILE_ORDER.includes(key)).sort();
    return ["Todos", ...known, ...unknown];
  }, [decisionProfileCounts]);
  const confidenceCounts = useMemo(() => {
    const counts = new Map();
    annotatedRows.forEach((row) => {
      const confidenceKey = row.__screenerAnnotation?.confidence?.key;
      if (!confidenceKey) return;
      counts.set(confidenceKey, (counts.get(confidenceKey) || 0) + 1);
    });
    return counts;
  }, [annotatedRows]);
  const confidenceOptions = useMemo(() => {
    const known = DECISION_CONFIDENCE_ORDER.filter((key) => confidenceCounts.has(key));
    const unknown = [...confidenceCounts.keys()].filter((key) => !DECISION_CONFIDENCE_ORDER.includes(key)).sort();
    return ["Todos", ...known, ...unknown];
  }, [confidenceCounts]);
  const dataHealthCounts = useMemo(() => {
    const counts = new Map();
    dataHealthBaseRows.forEach((row) => {
      const key = row.__screenerAnnotation?.dataHealth?.status?.key || buildScreenerDataHealth(row, activeSettings).status.key;
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
    const reviewRows = applyResultViewFilters(annotatedRows, { ...viewFilterState, reviewPriorityFilter: filterKey });
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
    const reviewRows = applyResultViewFilters(annotatedRows, { ...viewFilterState, decisionEvidenceFilter: filterKey });
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
    const reviewRows = applyResultViewFilters(annotatedRows, { ...viewFilterState, scoreAuditFilter: filterKey });
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
  const recentIpoRows = useMemo(() => rows.filter((r) => rowPassesListContract(r, "ipo")), [rows]);
  const ipos = useMemo(() => ["Todos", ...Array.from(new Set(recentIpoRows.map(verifiedIpoCategory).filter(Boolean))).sort()], [recentIpoRows]);
  const ipoCounts = useMemo(() => countByOption(recentIpoRows, verifiedIpoCategory), [recentIpoRows]);
  const hiddenByView = Math.max(0, rows.length - filtered.length);
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

  function clearResultView() {
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
  }

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

  return {
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
    setResultPageSize,
    resultPage,
    setResultPage,
    restoreResultViewSession,
    resetResultView,
    viewFilterState,
    filtered,
    reviewPriorityBaseRows,
    reliabilityBaseRows,
    decisionEvidenceBaseRows,
    dataHealthBaseRows,
    scoreAuditBaseRows,
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
    scoreAuditCounts,
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
  };
}
