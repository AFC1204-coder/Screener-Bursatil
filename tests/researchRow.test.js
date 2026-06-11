// Tests de lib/researchRow.js (buildResearchRow): forma de la fila, scores estables
// sobre fixtures sintéticas y rechazo de histórico insuficiente (<20 barras).
// Valores documentados: la serie stage 2 cierra en ~148.196 con SMA50 ~141.18;
// la stage 4 cierra en ~50.416 bajo una SMA200 de ~81.92 descendente.
import { describe, expect, it } from "vitest";
import { buildResearchRow, dataCoverageForRow, priceFreshnessForDate } from "@/lib/researchRow";
import { stage2Bars, stage4Bars, shortHistoryBars } from "./fixtures.js";

const stage2Row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
const stage4Row = buildResearchRow("STAGE4", { bars: stage4Bars() }, {}, { requireLongHistory: false }, {});

describe("buildResearchRow · serie stage 2", () => {
  it("estructura técnica coherente con la fixture", () => {
    expect(stage2Row.symbol).toBe("STAGE2");
    expect(stage2Row.price).toBeCloseTo(148.1962, 3);
    expect(stage2Row.sma50).toBeCloseTo(141.1825, 3);
    expect(stage2Row.sma150).toBeCloseTo(125.7964, 3);
    expect(stage2Row.sma200).toBeCloseTo(118.0114, 3);
    expect(stage2Row.sma200Slope).toBeGreaterThan(0);
    expect(stage2Row.distance52w).toBeCloseTo(-0.99, 2);
    expect(stage2Row.lowAdvance52w).toBeCloseTo(113.4794, 3);
    expect(stage2Row.upDownVolRatio).toBeCloseTo(1.9362, 3);
  });
  it("scores estables: W100 / M100 / Mom80 / Risk100 / RR100 / Weakness 6", () => {
    expect(stage2Row.weinsteinScore).toBe(100);
    expect(stage2Row.minerviniScore).toBe(100);
    expect(stage2Row.momentumScore).toBe(80);
    expect(stage2Row.riskScore).toBe(100);
    expect(stage2Row.riskRewardScore).toBe(100);
    expect(stage2Row.volumeEffectScore).toBe(55);
    expect(stage2Row.volumeScore).toBeCloseTo(69.5, 5);
    expect(stage2Row.liquidityScore).toBe(65);
    expect(stage2Row.weaknessScore).toBe(6);
    expect(stage2Row.weaknessLabel).toBe("Sin deterioro claro");
  });
  it("campos derivados presentes: preview de gráfico y frescura de precio", () => {
    expect(stage2Row.chartPreview.length).toBeGreaterThan(0);
    expect(stage2Row.chartPreview.length).toBeLessThanOrEqual(96);
    expect(stage2Row.priceFreshnessOk).toBe(true);
    expect(stage2Row.chartBarsCount).toBe(320);
  });
});

describe("buildResearchRow · serie stage 4", () => {
  it("scores estables: W0 / M0 / Mom0 / Risk18 / Weakness 100", () => {
    expect(stage4Row.price).toBeCloseTo(50.4162, 3);
    expect(stage4Row.weinsteinScore).toBe(0);
    expect(stage4Row.minerviniScore).toBe(0);
    expect(stage4Row.momentumScore).toBe(0);
    expect(stage4Row.riskScore).toBe(18);
    expect(stage4Row.weaknessScore).toBe(100);
    expect(stage4Row.weaknessLabel).toBe("Deterioro severo");
    expect(stage4Row.maxDrawdown63d).toBeCloseTo(27.2797, 3);
  });
});

describe("buildResearchRow · histórico insuficiente", () => {
  it("rechaza series con menos de 20 barras", () => {
    expect(() => buildResearchRow("SHORT", { bars: shortHistoryBars() }, {}, { requireLongHistory: false }, {}))
      .toThrow("Historico insuficiente");
  });
  it("con requireLongHistory exige 180 barras", () => {
    const bars = stage2Bars().slice(0, 100);
    expect(() => buildResearchRow("MID", { bars }, {}, { requireLongHistory: true }, {}))
      .toThrow("Historico insuficiente");
  });
});

describe("helpers de researchRow", () => {
  it("priceFreshnessForDate: fecha de hoy es fresca, sin fecha no lo es", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(priceFreshnessForDate(today).priceFreshnessOk).toBe(true);
    expect(priceFreshnessForDate("").priceFreshnessOk).toBe(false);
    expect(priceFreshnessForDate("").priceFreshnessLabel).toBe("sin fecha");
  });
  it("dataCoverageForRow puntúa la cobertura técnica de la fila stage 2", () => {
    const coverage = dataCoverageForRow(stage2Row, {});
    expect(coverage.technicalCoverageScore).toBeGreaterThan(70);
    expect(coverage.dataCoverageScore).toBeGreaterThan(40);
    expect(coverage.dataCoverageLabel).toBeTruthy();
  });
});
