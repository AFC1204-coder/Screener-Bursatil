import { describe, expect, it } from "vitest";
import { explainScreenerRank } from "@/lib/screenerExplainability";
import { decisionConfidenceSummary, auditDecisionRowIssues, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { decisionProfileForRow } from "@/lib/decisionProfile";
import { applyResultViewFilters } from "@/lib/screenerResultView";
import { annotateScreenerRow, annotateScreenerRows, buildScreenerAnnotation } from "@/lib/screenerAnnotation";

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

/** Path legado que pasaba settings a profile (re-explain + re-audit + re-confidence). */
function annotateRowLegacyDup(row, s) {
  const explanation = explainScreenerRank(row, s);
  const issues = auditDecisionRowIssues(row, explanation);
  return {
    ...row,
    __screenerAnnotation: {
      explanation,
      confidence: decisionConfidenceSummary(row, explanation, issues),
      dataHealth: buildScreenerDataHealth(row, s),
      priority: decisionPriorityBreakdown(row, explanation),
      profile: decisionProfileForRow(row, s),
      issues,
    },
  };
}

describe("screener row annotation", () => {
  it("devuelve los mismos valores leyendo __screenerAnnotation que recalcular desde la fila", () => {
    const annotated = annotateScreenerRow(baseRow, settings);
    const explanationDirect = explainScreenerRank(baseRow, settings);
    const confidenceDirect = decisionConfidenceSummary(baseRow, settings);
    const dataHealthDirect = buildScreenerDataHealth(baseRow, settings);
    const profileDirect = decisionProfileForRow(baseRow, settings);

    expect(explainScreenerRank(annotated, settings)).toEqual(explanationDirect);
    expect(decisionConfidenceSummary(annotated, settings)).toEqual(confidenceDirect);
    expect(buildScreenerDataHealth(annotated, settings)).toEqual(dataHealthDirect);
    expect(decisionProfileForRow(annotated, settings)).toEqual(profileDirect);
  });

  it("es isomorfo al path legado (mismo resultado, sin trabajo duplicado en profile)", () => {
    const legacy = annotateRowLegacyDup(baseRow, settings);
    const next = annotateScreenerRow(baseRow, settings);
    expect(next.__screenerAnnotation).toEqual(legacy.__screenerAnnotation);
  });

  it("applyResultViewFilters produce el mismo resultado con filas anotadas que con filas crudas", () => {
    const rows = [
      baseRow,
      { ...baseRow, symbol: "WEAK", rsGlobalPct: 45, extSma50: 30, riskRewardScore: 35 },
      { ...baseRow, symbol: "STALE", priceFreshnessOk: false, dataCoverageScore: 40 },
    ];
    const annotated = annotateScreenerRows(rows, settings);

    const filters = {
      activeSettings: settings,
      countryFilter: "Todos",
      decisionResolutionFilter: "all",
    };

    const rawSymbols = applyResultViewFilters(rows, filters).map((row) => row.symbol);
    const annotatedSymbols = applyResultViewFilters(annotated, filters)
      .map((row) => row.symbol);

    expect(annotatedSymbols).toEqual(rawSymbols);
  });

  it("una fila anotada sigue siendo apta para sorteo y conserva todos sus campos", () => {
    const annotated = annotateScreenerRow(baseRow, settings);
    expect(annotated.symbol).toBe("ACME");
    expect(annotated.totalScore).toBe(82);
    expect(annotated.__screenerAnnotation).toBeDefined();
    expect(annotated.__screenerAnnotation.explanation.action.key).toBeTruthy();
    expect(annotated.__screenerAnnotation.confidence.key).toBeTruthy();
    expect(annotated.__screenerAnnotation.dataHealth.status.key).toBeTruthy();
  });

  it("priority reutiliza knownIssues sin cambiar el score", () => {
    const explanation = explainScreenerRank(baseRow, settings);
    const issues = auditDecisionRowIssues(baseRow, explanation);
    const withReuse = decisionPriorityBreakdown(baseRow, explanation, issues);
    const without = decisionPriorityBreakdown(baseRow, explanation);
    expect(withReuse).toEqual(without);
  });
});

// ─── Isomorfismo Node-puro ──────────────────────────────────────────────
// buildScreenerAnnotation y sus 6 funciones deben poderse ejecutar en Node
describe("isomorfismo Node-puro: annotate y sus 6 funciones son browser-free", () => {
  it("corre en un entorno Node puro (sin window/document/localStorage)", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof localStorage).toBe("undefined");
  });

  const deterministicChecks = [
    ["explainScreenerRank", (row, s) => explainScreenerRank(row, s)],
    ["auditDecisionRowIssues", (row, s) => {
      const explanation = explainScreenerRank(row, s);
      return auditDecisionRowIssues(row, explanation);
    }],
    ["decisionConfidenceSummary", (row, s) => {
      const explanation = explainScreenerRank(row, s);
      const issues = auditDecisionRowIssues(row, explanation);
      return decisionConfidenceSummary(row, explanation, issues);
    }],
    ["buildScreenerDataHealth", (row, s) => buildScreenerDataHealth(row, s)],
    ["decisionPriorityBreakdown", (row, s) => {
      const explanation = explainScreenerRank(row, s);
      return decisionPriorityBreakdown(row, explanation);
    }],
    ["decisionProfileForRow", (row, s) => {
      const explanation = explainScreenerRank(row, s);
      return decisionProfileForRow(row, explanation);
    }],
  ];

  it.each(deterministicChecks)("%s: 5 invocaciones consecutivas producen el mismo output determinista", (_name, invoke) => {
    const outputs = Array.from({ length: 5 }, () => JSON.stringify(invoke(baseRow, settings)));
    const first = outputs[0];
    expect(outputs.every((out) => out === first)).toBe(true);
  });

  it("annotateScreenerRow: 10 invocaciones consecutivas producen anotaciones estructuralmente idénticas", () => {
    const snapshots = Array.from({ length: 10 }, () => JSON.stringify(annotateScreenerRow(baseRow, settings)));
    expect(new Set(snapshots).size).toBe(1);
  });

  it("annotateScreenerRow siempre produce las 6 claves del annotation (contrato aguas abajo)", () => {
    const result = annotateScreenerRow(baseRow, settings);
    const keys = ["explanation", "confidence", "dataHealth", "priority", "profile", "issues"];
    for (const k of keys) {
      expect(result.__screenerAnnotation[k]).toBeDefined();
    }
  });
});

describe("presupuesto annotate O(pasan) · sin cache FILTER-ANNOTATION", () => {
  function makeRow(i) {
    return {
      ...baseRow,
      symbol: `S${i}`,
      totalScore: 70 + (i % 20),
      objectiveScore: 70 + (i % 20),
      rsGlobalPct: 60 + (i % 40),
      riskRewardScore: 55 + (i % 30),
      weaknessScore: i % 40,
      extSma50: i % 25,
    };
  }

  it("compuesto sin dup es más rápido que profile←settings sobre ~560 pasan", () => {
    const N = 560;
    const rows = Array.from({ length: N }, (_, i) => makeRow(i));
    // warmup
    for (const row of rows.slice(0, 20)) {
      annotateRowLegacyDup(row, settings);
      annotateScreenerRow(row, settings);
    }
    const tLegacy0 = performance.now();
    rows.forEach((row) => annotateRowLegacyDup(row, settings));
    const legacyMs = performance.now() - tLegacy0;
    const tNext0 = performance.now();
    rows.forEach((row) => annotateScreenerRow(row, settings));
    const nextMs = performance.now() - tNext0;

    // ROI medible: ≥20 % más rápido (microbench local; no browser LT).
    expect(nextMs).toBeLessThan(legacyMs * 0.8);
    // Igualdad estructural en muestra
    const sample = rows[0];
    expect(buildScreenerAnnotation(sample, settings)).toEqual(
      annotateRowLegacyDup(sample, settings).__screenerAnnotation,
    );
    // Log para evidencia en CI/local (no assert de ms absolutos: máquina variable).
    // eslint-disable-next-line no-console
    console.log(`[annotate-budget] n=${N} legacy=${legacyMs.toFixed(1)}ms next=${nextMs.toFixed(1)}ms ratio=${(nextMs / legacyMs).toFixed(2)}`);
  });
});
