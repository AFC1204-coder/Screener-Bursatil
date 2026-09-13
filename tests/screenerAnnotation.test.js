import { describe, expect, it, beforeEach } from "vitest";
import { explainScreenerRank } from "@/lib/screenerExplainability";
import { decisionConfidenceSummary, auditDecisionRowIssues, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { decisionProfileForRow } from "@/lib/decisionProfile";
import { applyResultViewFilters } from "@/lib/screenerResultView";
import {
  annotateScreenerRow,
  annotateScreenerRows,
  buildAnnotationInputKey,
  buildScreenerAnnotation,
  clearScreenerAnnotationCache,
  getScreenerAnnotationCacheStats,
} from "@/lib/screenerAnnotationCache";

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

function canonicalAnnotateRow(row, activeSettings = settings) {
  const annotation = buildScreenerAnnotation(row, activeSettings);
  return {
    ...row,
    __screenerAnnotation: annotation,
    __screenerAnnotationInputKey: buildAnnotationInputKey(row, activeSettings),
  };
}

describe("screener row annotation cache", () => {
  beforeEach(() => {
    clearScreenerAnnotationCache();
  });

  it("devuelve los mismos valores leyendo __screenerAnnotation que recalcular desde la fila", () => {
    const annotated = canonicalAnnotateRow(baseRow, settings);
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
    const annotated = rows.map((row) => canonicalAnnotateRow(row, settings));

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
    const annotated = canonicalAnnotateRow(baseRow, settings);
    expect(annotated.symbol).toBe("ACME");
    expect(annotated.totalScore).toBe(82);
    expect(annotated.__screenerAnnotation).toBeDefined();
    expect(annotated.__screenerAnnotation.explanation.action.key).toBeTruthy();
    expect(annotated.__screenerAnnotation.confidence.key).toBeTruthy();
    expect(annotated.__screenerAnnotation.dataHealth.status.key).toBeTruthy();
  });

  it("cache hit: segunda anotación reutiliza la anotación canónica sin recomputar", () => {
    const first = annotateScreenerRow(baseRow, settings);
    const statsAfterFirst = getScreenerAnnotationCacheStats();
    expect(statsAfterFirst.misses).toBe(1);

    const second = annotateScreenerRow({ ...baseRow }, settings);
    const statsAfterSecond = getScreenerAnnotationCacheStats();
    expect(statsAfterSecond.rowHits + statsAfterSecond.cacheHits).toBeGreaterThanOrEqual(1);
    expect(second.__screenerAnnotation).toEqual(first.__screenerAnnotation);
    expect(second.__screenerAnnotationInputKey).toBe(first.__screenerAnnotationInputKey);
  });

  it("invalidación: cambiar setupMode fuerza recomputación", () => {
    const leader = annotateScreenerRow(baseRow, { setupMode: "leader" });
    clearScreenerAnnotationCache();
    const weakness = annotateScreenerRow(baseRow, { setupMode: "weakness" });
    expect(weakness.__screenerAnnotationInputKey).not.toBe(leader.__screenerAnnotationInputKey);
    expect(weakness.__screenerAnnotation).not.toEqual(leader.__screenerAnnotation);
  });

  it("invalidación: cambiar un campo relevante de fila fuerza recomputación", () => {
    const before = annotateScreenerRow(baseRow, settings);
    const after = annotateScreenerRow({ ...baseRow, rsGlobalPct: 40 }, settings);
    expect(after.__screenerAnnotationInputKey).not.toBe(before.__screenerAnnotationInputKey);
    expect(after.__screenerAnnotation).not.toEqual(before.__screenerAnnotation);
  });

  it("igualdad funcional: annotateScreenerRow coincide con la anotación canónica", () => {
    const cached = annotateScreenerRow(baseRow, settings);
    const canonical = canonicalAnnotateRow(baseRow, settings);
    expect(cached.__screenerAnnotation).toEqual(canonical.__screenerAnnotation);
    expect(cached.__screenerAnnotationInputKey).toBe(canonical.__screenerAnnotationInputKey);
  });

  it("no hay cross-symbol leakage en el cache", () => {
    const rowA = annotateScreenerRow(baseRow, settings);
    const rowB = annotateScreenerRow({ ...baseRow, symbol: "BETA" }, settings);
    expect(rowB.symbol).toBe("BETA");
    expect(rowB.__screenerAnnotationInputKey).not.toBe(rowA.__screenerAnnotationInputKey);
    expect(rowA.__screenerAnnotationInputKey.startsWith("ACME|")).toBe(true);
    expect(rowB.__screenerAnnotationInputKey.startsWith("BETA|")).toBe(true);
    const stats = getScreenerAnnotationCacheStats();
    expect(stats.misses).toBe(2);
  });

  it("annotateScreenerRows reutiliza anotaciones en un segundo pase con filas nuevas", () => {
    const rows = [baseRow, { ...baseRow, symbol: "BETA", rsGlobalPct: 70 }];
    annotateScreenerRows(rows, settings);
    const statsAfterFirst = getScreenerAnnotationCacheStats();
    expect(statsAfterFirst.misses).toBe(2);

    annotateScreenerRows(rows.map((row) => ({ ...row })), settings);
    const statsAfterSecond = getScreenerAnnotationCacheStats();
    expect(statsAfterSecond.cacheHits).toBe(2);
    expect(statsAfterSecond.misses).toBe(2);
  });
});

// ─── Isomorfismo Node-puro ──────────────────────────────────────────────
describe("isomorfismo Node-puro: annotateRow y sus 6 funciones son browser-free", () => {
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
      const issues = auditDecisionRowIssues(row, explanation);
      const confidence = decisionConfidenceSummary(row, explanation, issues);
      return decisionProfileForRow(row, explanation);
    }],
  ];

  it.each(deterministicChecks)("%s: 5 invocaciones consecutivas producen el mismo output determinista", (_name, invoke) => {
    const outputs = Array.from({ length: 5 }, () => JSON.stringify(invoke(baseRow, settings)));
    const first = outputs[0];
    expect(outputs.every((out) => out === first)).toBe(true);
  });

  it("annotateRow: 10 invocaciones consecutivas producen anotaciones estructuralmente idénticas", () => {
    const snapshots = Array.from({ length: 10 }, () => JSON.stringify(canonicalAnnotateRow(baseRow, settings)));
    expect(new Set(snapshots).size).toBe(1);
  });

  it("annotateRow siempre produce las 6 claves del annotation (contrato aguas abajo)", () => {
    const result = canonicalAnnotateRow(baseRow, settings);
    const keys = ["explanation", "confidence", "dataHealth", "priority", "profile", "issues"];
    for (const k of keys) {
      expect(result.__screenerAnnotation[k]).toBeDefined();
    }
  });
});
