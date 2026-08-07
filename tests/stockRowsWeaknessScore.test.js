import { describe, expect, it } from "vitest";
import { scoreWeakness } from "@/lib/scoringEngine";
import { weaknessScore } from "@/lib/stockRows";

// Regresión: lib/stockRows.js:weaknessScore() dejó de tener una fórmula
// aproximada propia (5 factores) y ahora delega en la canónica
// lib/scoringEngine.js:scoreWeakness (18 factores). Ver
// docs/weakness-score-duplicado-2026-08-05.md.
describe("stockRows.weaknessScore · unificado con scoringEngine.scoreWeakness", () => {
  it("coincide con la canónica para el caso documentado (rsGlobalPct=20, sin otros campos)", () => {
    const row = { rsGlobalPct: 20 };
    const canonical = scoreWeakness(row).weaknessScore;
    expect(canonical).toBe(18);
    expect(weaknessScore(row)).toBe(canonical);
  });

  it("coincide con la canónica para una fila técnica completa", () => {
    const row = {
      rsGlobalPct: 38,
      price: 90,
      sma50: 95,
      sma200: 100,
      sma200Slope: -0.4,
      perf3m: -6,
      perf6m: -10,
      perf12m: 5,
      distance52w: -34,
      distance20d: -14,
      maxDrawdown63d: 33,
      upDownVolRatio: 0.6,
      upVolume: false,
      relativeVolume: 1.3,
      riskScore: 28,
      extSma50: -15,
      speculationRiskScore: 72,
    };
    expect(weaknessScore(row)).toBe(scoreWeakness(row).weaknessScore);
  });

  it("resuelve los campos de entrada desde row.snapshot igual que desde el row directo", () => {
    const direct = { rsGlobalPct: 20, price: 90, sma50: 95, riskScore: 28 };
    const wrapped = { snapshot: direct };
    expect(weaknessScore(wrapped)).toBe(weaknessScore(direct));
  });

  it("prioriza el weaknessScore canónico persistido en el row sin recalcular", () => {
    const row = { weaknessScore: 30, rsGlobalPct: 5, price: 10, sma50: 50 };
    expect(weaknessScore(row)).toBe(30);
  });
});
