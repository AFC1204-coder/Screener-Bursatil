import { describe, expect, it } from "vitest";
import { explainScreenerRank } from "@/lib/screenerExplainability";
import { decisionConfidenceSummary, auditDecisionRowIssues, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { decisionProfileForRow } from "@/lib/decisionProfile";
import { applyResultViewFilters } from "@/lib/screenerResultView";

// Anotación local equivalente a annotateRow() en useResultViewModel.js.
// Mantenerla en sincronía con el helper del hook; este test protege el contrato.
function annotateRow(row, settings) {
  const explanation = explainScreenerRank(row, settings);
  const issues = auditDecisionRowIssues(row, explanation);
  return {
    ...row,
    __screenerAnnotation: {
      explanation,
      confidence: decisionConfidenceSummary(row, explanation, issues),
      dataHealth: buildScreenerDataHealth(row, settings),
      priority: decisionPriorityBreakdown(row, explanation),
      profile: decisionProfileForRow(row, settings),
      issues,
    },
  };
}

const settings = { setupMode: "leader" };

const baseRow = {
  symbol: "ACME",
  price: 50,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
  profileCoverageScore: 70,
  totalScore: 82,
  objectiveScore: 82,
  rsGlobalPct: 90,
  rsSectorPct: 82,
  rsQualityScore: 78,
  weinsteinScore: 86,
  minerviniScore: 82,
  volumeEffectScore: 76,
  adProxyScore: 74,
  growthScore: 70,
  epsGrowthProxyScore: 68,
  riskRewardScore: 72,
  weaknessScore: 12,
  extSma50: 10,
  setupDisplayPlanValid: true,
};

describe("screener row annotation cache", () => {
  it("devuelve los mismos valores leyendo __screenerAnnotation que recalcular desde la fila", () => {
    const annotated = annotateRow(baseRow, settings);
    const explanationDirect = explainScreenerRank(baseRow, settings);
    const confidenceDirect = decisionConfidenceSummary(baseRow, settings);
    const dataHealthDirect = buildScreenerDataHealth(baseRow, settings);
    const profileDirect = decisionProfileForRow(baseRow, settings);

    expect(explainScreenerRank(annotated, settings)).toEqual(explanationDirect);
    expect(decisionConfidenceSummary(annotated, settings)).toEqual(confidenceDirect);
    expect(buildScreenerDataHealth(annotated, settings)).toEqual(dataHealthDirect);
    expect(decisionProfileForRow(annotated, settings)).toEqual(profileDirect);
  });

  it("applyResultViewFilters produce el mismo resultado con filas anotadas que con filas crudas", () => {
    const rows = [
      baseRow,
      { ...baseRow, symbol: "WEAK", rsGlobalPct: 45, extSma50: 30, riskRewardScore: 35 },
      { ...baseRow, symbol: "STALE", priceFreshnessOk: false, dataCoverageScore: 40 },
    ];
    const annotated = rows.map((row) => annotateRow(row, settings));

    const filters = {
      activeSettings: settings,
      actionFilter: "Todos",
      readinessFilter: "Todos",
      confidenceFilter: "Todos",
      dataHealthFilter: "ready",
      decisionResolutionFilter: "all",
    };

    const rawSymbols = applyResultViewFilters(rows, filters).map((row) => row.symbol);
    const annotatedSymbols = applyResultViewFilters(annotated, filters)
      .map((row) => row.symbol);

    expect(annotatedSymbols).toEqual(rawSymbols);
  });

  it("una fila anotada sigue siendo apta para sorteo y conserva todos sus campos", () => {
    const annotated = annotateRow(baseRow, settings);
    expect(annotated.symbol).toBe("ACME");
    expect(annotated.totalScore).toBe(82);
    expect(annotated.__screenerAnnotation).toBeDefined();
    expect(annotated.__screenerAnnotation.explanation.action.key).toBeTruthy();
    expect(annotated.__screenerAnnotation.confidence.key).toBeTruthy();
    expect(annotated.__screenerAnnotation.dataHealth.status.key).toBeTruthy();
  });
});
