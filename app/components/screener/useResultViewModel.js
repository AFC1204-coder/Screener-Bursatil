"use client";

import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { buildResultViewBrief } from "@/app/components/screener/resultViewBrief";
import { applyResultViewFilters, opportunityBuckets, passesSectorStrength, verifiedIpoCategory } from "@/lib/screenerResultView";
import { auditDecisionRowIssues, auditDecisionScan, decisionConfidenceSummary, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { decisionProfileForRow } from "@/lib/decisionProfile";
import { rowPassesListContract } from "@/lib/listRationale";
import {
  buildScreenerDataHealth,
  buildScreenerDataHealthSummary,
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
  buildDecisionEvidenceSummary,
  explainScreenerRank,
} from "@/lib/screenerExplainability";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";
import { compareRowsForSort, defaultSortForSettings } from "@/lib/screenerPipeline";
import {
  alignRestoredSortSession,
  applyPerfPeriodSelection,
  applySortSelection,
} from "@/lib/screenerSortInvariant";
import {
  buildScreenerAuditabilitySummary,
} from "@/lib/screenerReliability";
import {
  buildScreenerScoreAuditSummary,
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
  const [decisionResolutionFilter, setDecisionResolutionFilter] = useState("all");
  const [sort, setSortState] = useState(DEFAULT_PERFORMANCE_PERIOD);
  const [sortAsc, setSortAsc] = useState(false);
  // Periodo de la columna de rendimiento. Es GLOBAL (una sola elección para
  // toda la tabla) porque si fuera por fila se perdería la comparación entre
  // valores — docs/principios-producto.md, principio 7.5.
  const [perfPeriod, setPerfPeriodState] = useState(DEFAULT_PERFORMANCE_PERIOD);
  const [resultPageSize, setResultPageSize] = useState(DEFAULT_RESULT_PAGE_SIZE);
  const [resultPage, setResultPage] = useState(1);

  function setSort(value, options = {}) {
    const { sort: nextSort, perfPeriod: nextPerf } = applySortSelection(value, { perfPeriod });
    if (options.toggle && value === sort) {
      setSortAsc((prev) => !prev);
    } else {
      setSortAsc(false);
    }
    setSortState(nextSort);
    setPerfPeriodState(nextPerf);
    if (!options.skipPageReset) setResultPage(1);
  }

  // El orden sigue al selector: mirar a tres meses es ordenar por tres meses.
  function setPerfPeriod(value) {
    const { sort: nextSort, perfPeriod: nextPerf } = applyPerfPeriodSelection(value);
    setPerfPeriodState(nextPerf);
    setSortState(nextSort);
    setSortAsc(false);
    setResultPage(1);
  }

  function toggleSortColumn(columnSortKey = "") {
    const key = String(columnSortKey || "").trim();
    if (!key) return;
    if (key === sort) {
      setSortAsc((prev) => !prev);
      setResultPage(1);
      return;
    }
    setSort(key);
  }

  function restoreResultViewSession(session = {}, fallbackSettings = activeSettings, options = {}) {
    const aligned = alignRestoredSortSession({
      sort: session.sort,
      perfPeriod: session.perfPeriod,
      fallbackSort: defaultSortForSettings(fallbackSettings),
    });
    setThemeFilter(session.themeFilter || "Todos");
    setSectorFilter(session.sectorFilter || "Todos");
    setIndustryFilter(session.industryFilter || "Todos");
    setCountryFilter(session.countryFilter || "Todos");
    setSectorStrength(normalizeSectorStrength(session.sectorStrength));
    setIpo(session.ipo || "Todos");
    setDecisionResolutionFilter(session.decisionResolutionFilter || "all");
    setSortState(aligned.sort);
    setPerfPeriodState(aligned.perfPeriod);
    setSortAsc(session.sortAsc === true);
    setResultPageSize(resolveResultPageSize(session.resultPageSize));
    setResultPage(options.resetPage ? 1 : (Number.isFinite(session.resultPage) && session.resultPage > 0 ? session.resultPage : 1));
  }

  function resetResultView(nextSort = defaultSortForSettings(activeSettings)) {
    const aligned = alignRestoredSortSession({
      sort: nextSort,
      perfPeriod: DEFAULT_PERFORMANCE_PERIOD,
      fallbackSort: nextSort,
    });
    setThemeFilter("Todos");
    setSectorFilter("Todos");
    setIndustryFilter("Todos");
    setCountryFilter("Todos");
    setSectorStrength("Todos");
    setIpo("Todos");
    setDecisionResolutionFilter("all");
    setSortState(aligned.sort);
    setPerfPeriodState(aligned.perfPeriod);
    setSortAsc(false);
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
    decisionResolutionFilter,
    decisionResolutions: screenerDecisionResolutions,
    activeSettings,
  }), [viewLayers, countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, decisionResolutionFilter, screenerDecisionResolutions, activeSettings]);

  // ── Paso de anotación única por fila ───────────────────────────────────
  // Consolida explanation/confidence/dataHealth/priority/profile/issues que
  // antes recalculaban 8+ memos independientes y applyResultViewFilters (6×/render).
  // Cache en `__screenerAnnotation`: campo no-persistido (no es RESEARCH_ROW_CORE_FIELD,
  // así que compactResearchRow lo descarta y nunca llega a localStorage).
  //
  // Dep memo: las 6 funciones de annotateRow solo leen `activeSettings.setupMode`
  // (verificado en lib/screenerExplainability.js, lib/decisionAudit.js,
  // lib/screenerDataHealth.js, lib/decisionProfile.js). Estrechar el memo a esa
  // única clave evita re-anotar N filas cuando cambia un umbral que no afecta
  // a la anotación (ej. settings.maxSymbols, settings.minRS, sortIndex).
  //
  // CONTRATO: si añades una 7ª función a annotateRow que lea OTRA clave de
  // activeSettings, amplia este useMemo para incluirla.
  const setupMode = activeSettings?.setupMode;
  const deferredRows = useDeferredValue(rows);
  const rowsDeferredStale = deferredRows !== rows;
  // Si rows acaba de cambiar (p. ej. hunt acota mesa) deferredRows sigue en el lote
  // anterior: re-anotar ese lote con setupMode nuevo tumba el hilo (BUG-HUNT-1b).
  const annotateSourceRows = rowsDeferredStale ? rows : deferredRows;
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

  const annotatedRows = useMemo(() => annotateSourceRows.map(annotateRow), [annotateSourceRows, setupMode]);

  const viewFilteredRows = useMemo(
    () => applyResultViewFilters(annotatedRows, viewFilterState),
    [annotatedRows, viewFilterState],
  );

  const filtered = useMemo(() => (
    [...viewFilteredRows].sort((a, b) => compareRowsForSort(a, b, {
      sort,
      sortAsc,
      settings: activeSettings,
    }))
  ), [viewFilteredRows, sort, sortAsc, activeSettings]);

  const pendingDecisionWorkSummary = useMemo(() => {
    const pendingItems = viewFilteredRows.map((row) => {
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
  }, [viewFilteredRows, screenerDecisionResolutions]);

  const pendingDecisionWorkActive = decisionResolutionFilter === "pending"
    && sort === "decisionPriority";

  function applyPendingDecisionWorkFocus() {
    if (!pendingDecisionWorkSummary.pendingCount) return;
    setDecisionResolutionFilter("pending");
    setSort("decisionPriority");
    setResultPage(1);
    const label = pendingDecisionWorkSummary.usesHighConfidence ? `${pendingDecisionWorkSummary.highConfidenceCount} pendientes de confianza alta` : `${pendingDecisionWorkSummary.pendingCount} pendientes priorizadas`;
    setStatus(`Trabajo pendiente: ${label}.`);
  }

  function clearPendingDecisionWorkFocus() {
    setDecisionResolutionFilter("all");
    setResultPage(1);
  }

  function reviewPendingDecisionWork() {
    const reviewRows = pendingDecisionWorkSummary.rows?.length ? pendingDecisionWorkSummary.rows : filtered;
    const detail = pendingDecisionWorkSummary.usesHighConfidence
      ? "Sin decidir · confianza alta · prioridad decisión"
      : "Sin decidir · prioridad decisión";
    openReview(reviewRows, pendingDecisionWorkSummary.top?.symbol || "", {
      sourceLabel: "Trabajo pendiente",
      sourceDetail: detail,
      queueMode: "pending-work",
      resolutionFilter: "pending",
    });
  }

  const totalResultPages = Math.max(1, Math.ceil(filtered.length / resultPageSize));
  const visibleResultPage = Math.min(resultPage, totalResultPages);
  const resultPageStart = (visibleResultPage - 1) * resultPageSize;
  const resultPageEnd = Math.min(resultPageStart + resultPageSize, filtered.length);
  const pagedRows = filtered.slice(resultPageStart, resultPageEnd);
  const visibleDecisionAudit = useMemo(() => viewFilteredRows.length
    ? auditDecisionScan({ id: "visible-results", name: "Resultados visibles", rows: viewFilteredRows, activeSettings })
    : null, [viewFilteredRows, activeSettings]);
  const setResultPageClamped = (page) => setResultPage(Math.max(1, Math.min(page, totalResultPages)));

  function updateResultPageSize(size) {
    const nextSize = resolveResultPageSize(size);
    setResultPageSize(nextSize);
    setResultPage(1);
  }

  const opportunities = useMemo(() => opportunityBuckets(viewFilteredRows), [viewFilteredRows]);

  useEffect(() => {
    setResultPage(1);
  }, [countryFilter, themeFilter, sectorFilter, industryFilter, sectorStrength, ipo, decisionResolutionFilter, sort, resultPageSize]);

  useEffect(() => {
    if (resultPage > totalResultPages) setResultPage(totalResultPages);
  }, [resultPage, totalResultPages]);

  const visibleDecisionBrief = useMemo(() => buildScreenerDecisionBrief({ audit: visibleDecisionAudit, rows: viewFilteredRows }), [visibleDecisionAudit, viewFilteredRows]);
  const visibleDataHealthSummary = useMemo(() => buildScreenerDataHealthSummary(viewFilteredRows, activeSettings), [viewFilteredRows, activeSettings]);
  const visibleDecisionEvidenceSummary = useMemo(() => buildDecisionEvidenceSummary(viewFilteredRows, activeSettings), [viewFilteredRows, activeSettings]);
  const visibleScoreAuditSummary = useMemo(() => buildScreenerScoreAuditSummary(viewFilteredRows), [viewFilteredRows]);
  const visibleAuditabilitySummary = useMemo(() => buildScreenerAuditabilitySummary(viewFilteredRows, activeSettings), [viewFilteredRows, activeSettings]);
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
  const resolutionFilterActive = decisionResolutionFilter !== "all" ? 1 : 0;
  const viewFiltersActive = resolutionFilterActive + VIEW_LAYERS.reduce((sum, layer) => sum + (viewLayers[layer.key] ? viewFilterCounts[layer.key] : 0), 0);
  const resultFilterChips = [
    viewLayers.country && countryFilter !== "Todos" ? {
      key: "country",
      label: `País: ${marketName(countryFilter)}`,
      impact: countryCounts.get(countryFilter) || 0,
      onClear: () => setCountryFilter("Todos"),
    } : null,
    viewLayers.theme && themeFilter !== "Todos" ? {
      key: "theme",
      label: `Tema: ${themeFilter}`,
      impact: themeCounts.get(themeFilter) || 0,
      onClear: () => setThemeFilter("Todos"),
    } : null,
    viewLayers.sector && sectorFilter !== "Todos" ? {
      key: "sector",
      label: `Sector: ${sectorFilter}`,
      impact: sectorCounts.get(sectorFilter) || 0,
      onClear: () => setSectorFilter("Todos"),
    } : null,
    viewLayers.industry && industryFilter !== "Todos" ? {
      key: "industry",
      label: `Subsector: ${industryFilter}`,
      impact: industryCounts.get(industryFilter) || 0,
      onClear: () => setIndustryFilter("Todos"),
    } : null,
    viewLayers.sectorStrength && sectorStrength !== "Todos" ? {
      key: "sectorStrength",
      label: `Fuerza: ${SECTOR_STRENGTH_LABELS[sectorStrength] || sectorStrength}`,
      impact: sectorStrengthCounts.get(sectorStrength) || 0,
      onClear: () => setSectorStrength("Todos"),
    } : null,
    viewLayers.ipo && ipo !== "Todos" ? {
      key: "ipo",
      label: `IPO: ${ipo}`,
      impact: ipoCounts.get(ipo) || 0,
      onClear: () => setIpo("Todos"),
    } : null,
    decisionResolutionFilter !== "all" ? {
      key: "decisionResolution",
      label: `Resolución: ${decisionResolutionDisplayLabel(decisionResolutionFilter)}`,
      impact: decisionResolutionOptions.find((item) => item.key === decisionResolutionFilter)?.count || 0,
      onClear: () => setDecisionResolutionFilter("all"),
    } : null,
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
    if (key === "decisionResolution") setDecisionResolutionFilter("all");
  }

  function clearResultView() {
    setCountryFilter("Todos");
    setThemeFilter("Todos");
    setSectorFilter("Todos");
    setIndustryFilter("Todos");
    setSectorStrength("Todos");
    setIpo("Todos");
    setDecisionResolutionFilter("all");
  }

  useEffect(() => {
    if (countryFilter !== "Todos" && !countryOptions.includes(countryFilter)) setCountryFilter("Todos");
    if (themeFilter !== "Todos" && !themeOptions.includes(themeFilter)) setThemeFilter("Todos");
    if (sectorFilter !== "Todos" && !sectorOptions.includes(sectorFilter)) setSectorFilter("Todos");
    if (industryFilter !== "Todos" && !industryOptions.includes(industryFilter)) setIndustryFilter("Todos");
    if (ipo !== "Todos" && !ipos.includes(ipo)) setIpo("Todos");
    if (rows.length && decisionResolutionFilter !== "all" && !decisionResolutionOptions.some((item) => item.key === decisionResolutionFilter)) setDecisionResolutionFilter("all");
  }, [countryFilter, countryOptions, themeFilter, themeOptions, sectorFilter, sectorOptions, industryFilter, industryOptions, ipo, ipos, rows.length, decisionResolutionFilter, decisionResolutionOptions]);

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
    decisionResolutionFilter,
    setDecisionResolutionFilter,
    sort,
    setSort,
    sortAsc,
    toggleSortColumn,
    perfPeriod,
    setPerfPeriod,
    resultPageSize,
    setResultPageSize,
    resultPage,
    setResultPage,
    restoreResultViewSession,
    resetResultView,
    viewFilterState,
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
    rowsDeferredStale,
  };
}
