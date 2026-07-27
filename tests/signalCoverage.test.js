// Tests de signalCoverage sidecar — Task 11.
// Verifica que buildResearchRow y materializedScanner.buildRow (mock) pueblan
// signalCoverage con la forma correcta: { signalKey: { coverage, partial } }
// por cada señal computada, sin alterar los valores numéricos existentes.
//
// Estructura:
//   1. buildResearchRow: signalCoverage poblado, 10 señales base, coverage=1.0
//   2. buildResearchRow: partial=true cuando faltan inputs
//   3. Valores numéricos idénticos pre/post migración (identity check)
//   4. materializedScanner sectorize: extiende sidecar con composite-level signals
//   5. screenerPipeline sectorize: extiende sidecar con ipoScore
//   6. signalCoverage ausente en funciónes no-signal (scoreWeakness, volumeEvidence)

import { describe, expect, it } from "vitest";
import { buildResearchRow, dataCoverageForRow } from "@/lib/researchRow";
import { computeSignal } from "@/lib/scoringEngine";
import { stage2Bars, stage4Bars } from "./fixtures.js";

// ---------------------------------------------------------------------------
// 1. buildResearchRow: signalCoverage poblado con 10 señales base
// ---------------------------------------------------------------------------

describe("signalCoverage · buildResearchRow stage 2", () => {
  const row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});

  it("tiene signalCoverage como objeto con 11 señales (10 base + weaknessScore)", () => {
    expect(row.signalCoverage).toBeDefined();
    expect(typeof row.signalCoverage).toBe("object");
    // 10 señales técnicas base: weinsteinScore, minerviniScore, momentumScore,
    // riskScore, riskRewardScore, volumeEffectScore, adProxyScore,
    // epsGrowthProxyScore, volumeScore, liquidityScore
    // + weaknessScore (señal diagnósticas "negative", registrada aparte).
    const keys = Object.keys(row.signalCoverage);
    expect(keys.length).toBe(11);
    expect(keys).toContain("weinsteinScore");
    expect(keys).toContain("minerviniScore");
    expect(keys).toContain("momentumScore");
    expect(keys).toContain("riskScore");
    expect(keys).toContain("riskRewardScore");
    expect(keys).toContain("volumeEffectScore");
    expect(keys).toContain("adProxyScore");
    expect(keys).toContain("epsGrowthProxyScore");
    expect(keys).toContain("volumeScore");
    expect(keys).toContain("liquidityScore");
    expect(keys).toContain("weaknessScore");
  });

  it("cada entrada tiene { coverage: number, partial: boolean }", () => {
    for (const key of Object.keys(row.signalCoverage)) {
      const entry = row.signalCoverage[key];
      expect(entry).toHaveProperty("coverage");
      expect(entry).toHaveProperty("partial");
      expect(typeof entry.coverage).toBe("number");
      expect(typeof entry.partial).toBe("boolean");
      expect(entry.coverage).toBeGreaterThanOrEqual(0);
      expect(entry.coverage).toBeLessThanOrEqual(1);
    }
  });

  it("coverage = 1.0 (partial=false) para señales técnicas con todos los inputs", () => {
    // La fixture stage2Bars genera SMAs, precios, volúmenes, etc. completos.
    // weinsteinScore.requiredInputs = [price, sma50, sma150, sma200, sma200Slope,
    //                                   distance52w, perf6m] → 7/7 presentes → coverage=1.0
    expect(row.signalCoverage.weinsteinScore.coverage).toBe(1.0);
    expect(row.signalCoverage.weinsteinScore.partial).toBe(false);
    expect(row.signalCoverage.minerviniScore.coverage).toBe(1.0);
    expect(row.signalCoverage.minerviniScore.partial).toBe(false);
    expect(row.signalCoverage.momentumScore.coverage).toBe(1.0);
    expect(row.signalCoverage.momentumScore.partial).toBe(false);
    expect(row.signalCoverage.riskScore.coverage).toBe(1.0);
    expect(row.signalCoverage.riskScore.partial).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. partial=true cuando faltan inputs
// ---------------------------------------------------------------------------

describe("signalCoverage · partial con inputs faltantes", () => {
  it("weinsteinScore coverage=1.0 para stage4 (todos los inputs técnicos existen)", () => {
    // stage4Bars genera SMAs, precios, volúmenes completos al igual que stage2
    // (solo los valores son bajos/decrecientes). Todos los requiredInputs de
    // weinsteinScore existen como números finitos → coverage=1.0.
    const row = buildResearchRow("STAGE4", { bars: stage4Bars() }, {}, { requireLongHistory: false }, {});
    expect(row.signalCoverage.weinsteinScore.coverage).toBe(1.0);
    expect(row.signalCoverage.weinsteinScore.partial).toBe(false);
  });

  it("epsGrowthProxyScore: coverage=0, partial=true cuando growthMetrics={} está vacío", () => {
    // FIX (container audit): buildResearchRow siempre asigna `growthMetrics: profile.growthMetrics || {}`
    // (researchRow.js L231), pero el contenedor vacío NO aporta datos a compute().
    // Antes este caso reportaba coverage=1.0 (engañaba). Ahora los requiredInputs son
    // paths growthMetrics.<field>, así que un {} vacío → 0/6 presentes → coverage=0.
    // El VALUE sigue siendo null (compute() no cambia — solo cambia coverage/partial).
    const row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
    const eg = row.signalCoverage.epsGrowthProxyScore;
    expect(eg.coverage).toBe(0);
    expect(eg.partial).toBe(true);
    expect(row.epsGrowthProxyScore).toBeNull(); // value no cambia
  });

  it("computeSignal directo: epsGrowthProxyScore coverage=0 cuando growthMetrics es undefined", () => {
    // Sin el contenedor ({}) → coverage=0. Los paths growthMetrics.* resuelven a undefined.
    const result = computeSignal({}, "epsGrowthProxyScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBeNull();
  });

  it("computeSignal directo: epsGrowthProxyScore coverage proporcional con algunos campos", () => {
    // 3 de 6 campos presentes (revenueGrowth, roe, roa) → coverage ≈ 0.5
    const result = computeSignal(
      { growthMetrics: { revenueGrowth: 30, roe: 25, roa: 10 } },
      "epsGrowthProxyScore"
    );
    expect(result.coverage).toBeCloseTo(3 / 6, 6);
    expect(result.partial).toBe(true);
  });

  it("growthScore ausente del sidecar en buildResearchRow (es señal composite-level)", () => {
    const row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
    // growthScore se calcula en sectorize, no en buildResearchRow.
    expect(row.signalCoverage.growthScore).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Valores numéricos idénticos — los scores no cambiaron
// ---------------------------------------------------------------------------

describe("signalCoverage · valores numéricos idénticos", () => {
  it("weinsteinScore, minerviniScore, momentumScore, riskScore iguales", () => {
    const row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
    expect(row.weinsteinScore).toBe(100);
    expect(row.minerviniScore).toBe(100);
    expect(row.momentumScore).toBe(80);
    expect(row.riskScore).toBe(100);
    expect(row.riskRewardScore).toBe(100);
    expect(row.volumeEffectScore).toBe(55);
    expect(row.volumeScore).toBeCloseTo(69.5, 1);
    expect(row.liquidityScore).toBe(65);
  });

  it("stage4: scores idénticos a pre-migración", () => {
    const row = buildResearchRow("STAGE4", { bars: stage4Bars() }, {}, { requireLongHistory: false }, {});
    expect(row.weinsteinScore).toBe(0);
    expect(row.minerviniScore).toBe(0);
    expect(row.momentumScore).toBe(0);
    expect(row.riskScore).toBe(18);
    expect(row.weaknessScore).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 4. computeSignal directa: coverage y partial correctos
// ---------------------------------------------------------------------------

describe("signalCoverage · computeSignal coverage", () => {
  it("weinsteinScore coverage=7/7 cuando todos los inputs presentes", () => {
    // weinsteinScore.requiredInputs = [price, sma50, sma150, sma200, sma200Slope, distance52w, perf6m]
    const row = {
      price: 120, sma50: 110, sma150: 105, sma200: 100,
      sma200Slope: 1.5, distance52w: -5, perf6m: 20,
    };
    const result = computeSignal(row, "weinsteinScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("weinsteinScore coverage<1 cuando faltan inputs", () => {
    const row = { price: 120, sma50: 110 }; // solo 2 de 7 inputs
    const result = computeSignal(row, "weinsteinScore");
    expect(result.coverage).toBeLessThan(1);
    expect(result.partial).toBe(true);
    expect(typeof result.value).toBe("number"); // compute() still runs
  });

  it("momentumScore coverage=3/3 con perf3m, perf6m, perf12m", () => {
    const row = { perf3m: 10, perf6m: 20, perf12m: 30 };
    const result = computeSignal(row, "momentumScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
  });

  it("growthScore coverage=0 sin growthMetrics", () => {
    const result = computeSignal({}, "growthScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // compute() señaliza ausencia (null) en vez de fabricar un 45 — mismo
    // contrato que epsGrowthProxyScore. computeComposite renormaliza sobre
    // los términos presentes cuando esto ocurre.
    expect(result.value).toBeNull();
  });

  it("epsGrowthProxyScore coverage=0 sin growthMetrics", () => {
    const result = computeSignal({}, "epsGrowthProxyScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBeNull(); // compute() returns null
  });

  it("computeSignal returns null para key desconocido", () => {
    const result = computeSignal({}, "nonexistentSignal");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. weaknessScore — signalCoverage en fila real (buildResearchRow)
// ---------------------------------------------------------------------------
// weaknessScore se registra como señal diagnósticas (direction "negative"). Los
// pipelines añaden signalCoverage.weaknessScore = { coverage, partial } junto a
// la llamada existente a scoreWeakness(row), SIN cambiar row.weaknessScore
// (número plano) ni weaknessLabel/weaknessReasons.

describe("signalCoverage · weaknessScore en fila real", () => {
  it("buildResearchRow stage2: signalCoverage.weaknessScore existe con { coverage, partial }", () => {
    const row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
    expect(row.signalCoverage.weaknessScore).toBeDefined();
    const wk = row.signalCoverage.weaknessScore;
    expect(typeof wk.coverage).toBe("number");
    expect(typeof wk.partial).toBe("boolean");
    expect(wk.coverage).toBeGreaterThanOrEqual(0);
    expect(wk.coverage).toBeLessThanOrEqual(1);
  });

  it("row.weaknessScore (número plano) NO cambia de valor — idéntico a pre-cambio", () => {
    // stage2 = fila sana → weaknessScore bajo (documentado en researchRow.test.js: 6)
    const row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
    expect(row.weaknessScore).toBe(6);
    expect(row.weaknessLabel).toBe("Sin deterioro claro");
    // stage4 = fila deteriorada → weaknessScore alto (documentado: 100)
    const row4 = buildResearchRow("STAGE4", { bars: stage4Bars() }, {}, { requireLongHistory: false }, {});
    expect(row4.weaknessScore).toBe(100);
    expect(row4.weaknessLabel).toBe("Deterioro severo");
  });

  it("signalCoverage.weaknessScore.value vía computeSignal === row.weaknessScore (consistencia)", () => {
    // El número del sidecar (vía computeSignal) debe coincidir con el campo plano
    // (vía scoreWeakness directo). Ambos llaman a scoreWeakness sobre la misma fila.
    const row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
    const result = computeSignal(row, "weaknessScore");
    expect(result.value).toBe(row.weaknessScore);
  });
});
