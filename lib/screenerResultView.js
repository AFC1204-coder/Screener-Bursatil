// lib/screenerResultView.js — helpers puros de la vista de resultados del screener.
// Sin JSX, sin hooks, sin React. Extraídos de app/screenerPanels.jsx para corregir
// la inversión de capas (useResultViewModel es un hook y no debe importar de un
// archivo de presentación). Comportamiento idéntico al original.

import { rowPassesListContract } from "@/lib/listRationale";
import { sortMetric } from "@/lib/screenerPipeline";
import { gt, gte, lte, isStage2 } from "@/lib/scoring";
import { rsUniverseValue } from "@/lib/relativeStrength";
import { decisionEvidenceMatchesFilter, explainScreenerRank } from "@/lib/screenerExplainability";
import { auditDecisionRowIssues, decisionConfidenceSummary } from "@/lib/decisionAudit";
import { decisionProfileForRow, reviewPriorityForRow } from "@/lib/decisionProfile";
import { dataHealthMatchesFilter } from "@/lib/screenerDataHealth";
import { scoreAuditMatchesFilter } from "@/lib/screenerScoreAudit";
import { RELIABILITY_FILTER_ALL, screenerReliabilityMatchesFilter } from "@/lib/screenerReliability";
import { countryCode } from "@/lib/symbols";

export const decisionConfidenceForRow = (row = {}, settingsOrExplanation = {}) => decisionConfidenceSummary(row, settingsOrExplanation);

export function decisionResolutionForRow(row = {}, decisionResolutions = {}) {
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  return symbol ? decisionResolutions?.[symbol] || null : null;
}

export function verifiedIpoCategory(row = {}) {
  if (!rowPassesListContract(row, "ipo")) return "";
  return String(row.ipoCategory || row.snapshot?.ipoCategory || "IPO verificable").trim() || "IPO verificable";
}

export function opportunityBuckets(rows = []) {
  const sorted = (check, key = "objectiveScore") => rows.filter(check).sort((a, b) => sortMetric(b, key) - sortMetric(a, key));
  const defs = [
    { key: "pivot", title: "Vigilancia pivot", note: "Setup observable", check: (r) => rowPassesListContract(r, "nearPivot") },
    { key: "stage2", title: "Stage 2 temprano", note: "Transición saludable", check: (r) => gt(r.price, r.sma200) && gte(r.sma200Slope, 0) && gte(r.distance52w, -35) && lte(r.extSma50, 18) && !isStage2(r) },
    { key: "pullback", title: "Pullback SMA50", note: "Descanso en tendencia", check: (r) => rowPassesListContract(r, "pullback") },
    { key: "rs", title: "RS", note: "Percentil del lote", check: (r) => (rsUniverseValue(r) ?? 0) >= 75 && gte(r.distance52w, -25) },
    { key: "growth", title: "Growth Quality", note: "Crecimiento + margen", check: (r) => (r.growthScore || 0) >= 70 && (r.objectiveScore ?? r.totalScore ?? 0) >= 64 },
    { key: "ipo", title: "IPO reales", note: "Últimos 5 años", check: (r) => rowPassesListContract(r, "ipo") },
    { key: "extended", title: "Extendidas fuertes", note: "Extensión alta", check: (r) => rowPassesListContract(r, "extended") },
    { key: "risk", title: "Riesgo a revisar", note: "Volatilidad/extensión", check: (r) => (r.riskScore || 0) < 45 || gt(r.extSma50, 28) || (r.speculationRiskScore || 0) >= 70 },
    { key: "weakness", title: "Deterioro técnico", note: "Evitar largos / estudiar debilidad", sortKey: "weaknessScore", check: (r) => rowPassesListContract(r, "weakness") },
  ];
  return defs.map((def) => {
    const hits = sorted(def.check, def.sortKey);
    return { ...def, count: hits.length, leaders: hits.slice(0, 5) };
  });
}

export function passesSectorStrength(row = {}, mode = "Todos") {
  const score = row.sectorScore ?? row.groupStrengthScore;
  if (mode === "Todos") return true;
  if (!Number.isFinite(score)) return false;
  if (mode === "Fuertes") return score >= 70;
  if (mode === "Constructivos") return score >= 55 && score < 70;
  if (mode === "Debiles" || mode === "Débiles") return score < 55;
  if (mode === "Muy debiles" || mode === "Muy débiles") return score < 40;
  return true;
}

export function applyResultViewFilters(baseRows = [], filters = {}) {
  const settings = filters.activeSettings || filters.settings || {};
  let list = [...baseRows];
  if (filters.decisionResolutionFilter && filters.decisionResolutionFilter !== "all") {
    list = list.filter((row) => {
      const resolution = decisionResolutionForRow(row, filters.decisionResolutions || {});
      const key = resolution?.key || "pending";
      return key === filters.decisionResolutionFilter;
    });
  }
  if ((filters.readinessFilter && filters.readinessFilter !== "Todos") || (filters.actionFilter && filters.actionFilter !== "Todos") || (filters.confidenceFilter && filters.confidenceFilter !== "Todos") || (filters.decisionProfileFilter && filters.decisionProfileFilter !== "Todos") || (filters.reviewPriorityFilter && filters.reviewPriorityFilter !== "all")) {
    list = list.filter((row) => {
      const annotation = row.__screenerAnnotation;
      const explanation = annotation?.explanation || explainScreenerRank(row, settings);
      if (filters.readinessFilter && filters.readinessFilter !== "Todos" && explanation.readiness.key !== filters.readinessFilter) return false;
      if (filters.actionFilter && filters.actionFilter !== "Todos" && explanation.action.key !== filters.actionFilter) return false;
      if (filters.confidenceFilter && filters.confidenceFilter !== "Todos" && decisionConfidenceForRow(row, explanation).key !== filters.confidenceFilter) return false;
      if (filters.decisionProfileFilter && filters.decisionProfileFilter !== "Todos" && (annotation?.profile || decisionProfileForRow(row, explanation)) !== filters.decisionProfileFilter) return false;
      if (filters.reviewPriorityFilter && filters.reviewPriorityFilter !== "all" && reviewPriorityForRow(row, explanation)?.key !== filters.reviewPriorityFilter) return false;
      return true;
    });
  }
  if (filters.decisionIssueFilter && filters.decisionIssueFilter !== "Todos") {
    list = list.filter((row) => (row.__screenerAnnotation?.issues || auditDecisionRowIssues(row, settings)).some((issue) => issue.key === filters.decisionIssueFilter));
  }
  if (filters.decisionEvidenceFilter && filters.decisionEvidenceFilter !== "all") {
    list = list.filter((row) => decisionEvidenceMatchesFilter(row, filters.decisionEvidenceFilter, settings));
  }
  if (filters.dataHealthFilter && filters.dataHealthFilter !== "Todos") {
    list = list.filter((row) => dataHealthMatchesFilter(row, filters.dataHealthFilter, settings));
  }
  if (filters.scoreAuditFilter && filters.scoreAuditFilter !== "all") {
    list = list.filter((row) => scoreAuditMatchesFilter(row, filters.scoreAuditFilter));
  }
  if (filters.reliabilityFilter && filters.reliabilityFilter !== RELIABILITY_FILTER_ALL) {
    list = list.filter((row) => screenerReliabilityMatchesFilter(row, filters.reliabilityFilter, settings));
  }
  if (filters.viewLayers?.country && filters.countryFilter !== "Todos") list = list.filter((row) => (row.country || countryCode(row.symbol)) === filters.countryFilter);
  if (filters.viewLayers?.theme && filters.themeFilter !== "Todos") list = list.filter((row) => row.theme === filters.themeFilter);
  if (filters.viewLayers?.sector && filters.sectorFilter !== "Todos") list = list.filter((row) => row.sector === filters.sectorFilter);
  if (filters.viewLayers?.industry && filters.industryFilter !== "Todos") list = list.filter((row) => row.industry === filters.industryFilter);
  if (filters.viewLayers?.sectorStrength) list = list.filter((row) => passesSectorStrength(row, filters.sectorStrength));
  if (filters.viewLayers?.ipo && filters.ipo !== "Todos") list = list.filter((row) => verifiedIpoCategory(row) === filters.ipo);
  return list;
}
