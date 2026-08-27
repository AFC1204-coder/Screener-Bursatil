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
      countryFilter: "Todos",
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

// ─── Isomorfismo Node-puro ──────────────────────────────────────────────
// Las seis funciones de annotateRow (useResultViewModel.js:197) deben poderse
// ejecutar en Node sin DOM, sin window, sin localStorage. Si alguna vez
// empieza a depender de un global del navegador, este test la señala en
// lugar de silenciarlo con un mock.
describe("isomorfismo Node-puro: annotateRow y sus 6 funciones son browser-free", () => {
  // Pre-condición: confirma que este test corre sin DOM (vitest sin jsdom).
  // Si alguien añade { environment: "jsdom" } a la config de vitest por error,
  // este test falla y le obliga a decidir explícitamente.
  // Nota: `navigator` puede existir en Node ≥21 aunque NO haya DOM — no es
  // un indicador fiable. Nos anclamos a window/document/localStorage, que sí
  // son exclusivamente del navegador.
  it("corre en un entorno Node puro (sin window/document/localStorage)", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof localStorage).toBe("undefined");
  });

  // Determinismo por función individual: misma input → mismo output
  // byte-a-byte en invocaciones repetidas. No usamos expect.toBe de Date.now
  // ni nada no-determinista; solo comparamos el output completo.
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
      return decisionProfileForRow(row, explanation); // profile usa explanation, no settings
    }],
  ];

  it.each(deterministicChecks)("%s: 5 invocaciones consecutivas producen el mismo output determinista", (_name, invoke) => {
    const outputs = Array.from({ length: 5 }, () => JSON.stringify(invoke(baseRow, settings)));
    const first = outputs[0];
    expect(outputs.every((out) => out === first)).toBe(true);
  });

  // Determinismo del pipeline completo (annotateRow con todas las 6 funciones).
  it("annotateRow: 10 invocaciones consecutivas producen anotaciones estructuralmente idénticas", () => {
    const snapshots = Array.from({ length: 10 }, () => JSON.stringify(annotateRow(baseRow, settings)));
    expect(new Set(snapshots).size).toBe(1);
  });

  // Estabilidad de la firma estructural: las 6 claves del annotation están
  // siempre presentes y son objetos no-undefined. Esto blinda el contrato
  // __screenerAnnotation que consumers aguas abajo asumen.
  it("annotateRow siempre produce las 6 claves del annotation (contrato aguas abajo)", () => {
    const result = annotateRow(baseRow, settings);
    const keys = ["explanation", "confidence", "dataHealth", "priority", "profile", "issues"];
    for (const k of keys) {
      expect(result.__screenerAnnotation[k]).toBeDefined();
    }
  });
});
