import { describe, expect, it } from "vitest";
import { buildScreenerScoreAudit, buildScreenerScoreAuditSummary, compactScreenerScoreAudit, scoreAuditFilterLabel, scoreAuditMatchesFilter, scoreAuditReviewReasons, scoreAuditStatusForRow } from "@/lib/screenerScoreAudit";

const row = {
  totalScore: 79.5,
  setupQualityScore: 80,
  rsGlobalPct: 90,
  rsQualityScore: 74,
  demandScore: 70,
  adProxyScore: 72,
  growthScore: 68,
  epsGrowthProxyScore: 66,
  sectorScore: 75,
  riskRewardScore: 71,
  riskScore: 62,
  momentumScore: 58,
  ipoScore: 20,
  compositeRisks: ["Extensión a vigilar"],
};

// Los once pesos del composite (lib/scoringEngine.js, COMPOSITE_WEIGHTS) y su
// suma declarada. El desglose reparte el peso ausente entre los presentes, así
// que la referencia esperada se calcula aquí a mano en vez de fijar constantes
// opacas: si el motor cambia un peso, esta cuenta cambia con él y el test dice
// cuál es el nuevo número, no solo que algo se movió.
const WEIGHTS = [.17, .16, .06, .10, .08, .08, .08, .10, .08, .05, .02];
const TOTAL_WEIGHT = WEIGHTS.reduce((a, b) => a + b, 0);
const esperado = (values) => values.reduce((sum, v, i) => sum + v * WEIGHTS[i], 0) / TOTAL_WEIGHT;

describe("screenerScoreAudit", () => {
  it("calcula contribuciones del composite transparente v2", () => {
    const audit = buildScreenerScoreAudit(row);

    // setup, RS, RS calidad, demanda, A/D, growth, EPS, grupo, rent/riesgo,
    // riesgo, momentum. El ipoScore: 20 de la fila NO entra: el término salió
    // del composite el 2026-08-15.
    const calculado = esperado([80, 90, 74, 70, 72, 68, 66, 75, 71, 62, 58]);
    expect(audit.displayedScore).toBe(79.5);
    expect(audit.calculatedScore).toBe(74.85);
    // El módulo suma los puntos YA redondeados a dos decimales, así que puede
    // separarse del valor exacto hasta 11 × 0,005 = 0,055.
    expect(Math.abs(audit.calculatedScore - calculado)).toBeLessThan(0.056);
    expect(audit.components.find((item) => item.key === "ipo")).toBeUndefined();
    expect(audit.components.find((item) => item.key === "setup")).toMatchObject({
      label: "Setup",
      value: 80,
      points: Number((80 * 0.17 / TOTAL_WEIGHT).toFixed(2)),
      weight: 0.17,
    });
    // La suma de los puntos ES el score calculado: el desglose cuadra consigo
    // mismo, que es la premisa para que el residual signifique algo.
    const suma = audit.components.reduce((sum, item) => sum + item.points, 0);
    expect(suma).toBeCloseTo(audit.calculatedScore, 1);
    expect(audit.positive.map((item) => item.key).slice(0, 3)).toEqual(["rs", "setup", "group"]);
    expect(audit.risks[0]).toMatchObject({ label: "Extensión a vigilar" });
    expect(audit.integrityTone).toBe("warn");
  });

  it("marca campos ausentes y usa growth como fallback de EPS proxy", () => {
    const audit = buildScreenerScoreAudit({
      totalScore: 50,
      setupQualityScore: 40,
      rsRating: 62,
      growthScore: 65,
      riskScore: 55,
    });

    expect(audit.components.find((item) => item.key === "rs")).toMatchObject({ field: "rsRating", value: 62 });
    expect(audit.components.find((item) => item.key === "eps")).toMatchObject({ field: "growthScore", value: 65 });
    expect(audit.missing.map((item) => item.key)).toEqual(expect.arrayContaining(["rs-quality", "demand", "ad", "group", "risk-reward", "momentum"]));
    expect(audit.drags.map((item) => item.key)).toContain("setup");
  });

  it("genera un contrato compacto portable para ficha y export JSON", () => {
    const audit = compactScreenerScoreAudit(row);

    expect(audit).toMatchObject({
      schemaVersion: 1,
      displayedScore: 79.5,
      calculatedScore: 74.85,
      integrityTone: "warn",
    });
    expect(audit.components.find((item) => item.key === "setup")).toMatchObject({ value: 80, points: 13.88, weight: 0.17 });
    expect(audit.positive.map((item) => item.key).slice(0, 2)).toEqual(["rs", "setup"]);
    expect(audit.risks[0]).toMatchObject({ label: "Extensión a vigilar" });
  });

  it("resume la integridad del score en una muestra", () => {
    const summary = buildScreenerScoreAuditSummary([
      row,
      {
        totalScore: 50,
        setupQualityScore: 40,
        rsRating: 62,
        growthScore: 65,
        riskScore: 55,
      },
    ]);

    expect(summary.rows).toBe(2);
    expect(summary.attentionCount).toBe(2);
    expect(summary.mismatchCount).toBe(2);
    expect(summary.missingRows).toBe(1);
    expect(summary.verdict).toMatchObject({ key: "residual", tone: "warn" });
    expect(summary.topMissing.map((item) => item.key)).toEqual(expect.arrayContaining(["rs-quality", "demand"]));
    expect(summary.topDrags.map((item) => item.key)).toContain("setup");
  });

  it("clasifica filtros accionables de auditoría de score", () => {
    const cleanRow = { ...row, totalScore: 73.76 };
    const mismatchRow = { ...row, totalScore: 90 };
    const missingRow = {
      totalScore: 50,
      setupQualityScore: 40,
      rsRating: 62,
      growthScore: 65,
      riskScore: 55,
    };

    expect(scoreAuditStatusForRow(cleanRow)).toMatchObject({ clean: true, attention: false, mismatch: false, missing: false });
    expect(scoreAuditMatchesFilter(cleanRow, "clean")).toBe(true);
    expect(scoreAuditMatchesFilter(mismatchRow, "mismatch")).toBe(true);
    expect(scoreAuditMatchesFilter(mismatchRow, "attention")).toBe(true);
    expect(scoreAuditMatchesFilter(missingRow, "missing")).toBe(true);
    expect(scoreAuditMatchesFilter(missingRow, "clean")).toBe(false);
    expect(scoreAuditFilterLabel("mismatch", { compact: true })).toBe("Descuadre");
  });

  it("explica por qué una fila entra a auditoría de score", () => {
    const reasons = scoreAuditReviewReasons({
      totalScore: 92,
      setupQualityScore: 80,
      rsGlobalPct: 90,
      rsQualityScore: 78,
      demandScore: undefined,
      adProxyScore: 74,
      growthScore: 70,
      epsGrowthProxyScore: 68,
      sectorScore: undefined,
      riskRewardScore: 72,
      riskScore: 62,
      momentumScore: 58,
    });

    expect(reasons.map((item) => item.key)).toEqual(expect.arrayContaining(["mismatch", "missing"]));
    expect(reasons.find((item) => item.key === "mismatch")).toMatchObject({
      label: "Descuadre score",
      tone: "warn",
    });
    expect(reasons.find((item) => item.key === "missing")?.detail).toContain("Demanda");
  });
});
