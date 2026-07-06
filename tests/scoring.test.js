// Tests de lib/scoring.js. Las filas se construyen con buildResearchRow sobre las
// fixtures sintéticas (sin benchmarks ni perfil) para que los scores sean deterministas.
// Valores esperados documentados:
//   stage 2 → Weinstein 100, Minervini 100, Momentum 80, Risk 100, Weakness 6 ("Sin deterioro claro")
//   stage 4 → Weinstein 0, Minervini 0, Momentum 0, Risk 18, Weakness 100 ("Deterioro severo")
import { describe, expect, it } from "vitest";
import {
  between,
  compositeLabel,
  gt,
  gte,
  isStage2,
  lt,
  lte,
  objectiveStage,
  regimeRejectReason,
  scoreMinervini,
  scoreMomentum,
  scoreRisk,
  scoreWeakness,
  scoreWeinstein,
} from "@/lib/scoring";
import { buildResearchRow } from "@/lib/researchRow";
import { stage2Bars, stage4Bars } from "./fixtures.js";

const stage2Row = buildResearchRow("STAGE2", { bars: stage2Bars() }, {}, { requireLongHistory: false }, {});
const stage4Row = buildResearchRow("STAGE4", { bars: stage4Bars() }, {}, { requireLongHistory: false }, {});

describe("scoring · fila stage 2", () => {
  it("scores de tendencia en máximo: Weinstein 100, Minervini 100", () => {
    expect(scoreWeinstein(stage2Row)).toBe(100);
    expect(scoreMinervini(stage2Row)).toBe(100);
    expect(stage2Row.weinsteinScore).toBe(100);
    expect(stage2Row.minerviniScore).toBe(100);
  });
  it("momentum 80 y riesgo 100 (poca extensión sobre SMA50)", () => {
    expect(scoreMomentum(stage2Row)).toBe(80);
    expect(scoreRisk(stage2Row)).toBe(100);
    expect(stage2Row.extSma50).toBeCloseTo(4.968, 2);
  });
  it("sin deterioro: weakness 6", () => {
    const weakness = scoreWeakness(stage2Row);
    expect(weakness.weaknessScore).toBe(6);
    expect(weakness.weaknessLabel).toBe("Sin deterioro claro");
  });
  it("stage objetivo: Precio > SMA50 > SMA150 > SMA200 y Stage 2 confirmado", () => {
    expect(objectiveStage(stage2Row)).toBe("Precio > SMA50 > SMA150 > SMA200");
    expect(isStage2(stage2Row)).toBe(true);
  });
});

describe("scoring · fila stage 4", () => {
  it("scores de tendencia a cero y riesgo mínimo (18)", () => {
    expect(scoreWeinstein(stage4Row)).toBe(0);
    expect(scoreMinervini(stage4Row)).toBe(0);
    expect(scoreMomentum(stage4Row)).toBe(0);
    expect(scoreRisk(stage4Row)).toBe(18);
  });
  it("deterioro severo: weakness 100", () => {
    const weakness = scoreWeakness(stage4Row);
    expect(weakness.weaknessScore).toBe(100);
    expect(weakness.weaknessLabel).toBe("Deterioro severo");
    expect(weakness.weaknessReasons.length).toBeGreaterThan(0);
  });
  it("stage objetivo: Precio < SMA200 y sin Stage 2", () => {
    expect(objectiveStage(stage4Row)).toBe("Precio < SMA200");
    expect(isStage2(stage4Row)).toBe(false);
  });
});

describe("scoring · helpers y régimen", () => {
  it("comparadores tolerantes a no-finitos", () => {
    expect(gt(1, 0)).toBe(true);
    expect(gt(null, 0)).toBe(false);
    expect(gte(NaN, 0)).toBe(false);
    expect(lt(-1, 0)).toBe(true);
    expect(lte(0, 0)).toBe(true);
    expect(between(5, 0, 10)).toBe(true);
    expect(between(NaN, 0, 10)).toBe(false);
  });
  it("compositeLabel por tramos: 85 Elite, 75 Leader, 65 Fuerte, 55 Watchlist, <55 Revisar", () => {
    expect(compositeLabel(90)).toBe("Elite");
    expect(compositeLabel(80)).toBe("Leader");
    expect(compositeLabel(70)).toBe("Fuerte");
    expect(compositeLabel(60)).toBe("Watchlist");
    expect(compositeLabel(40)).toBe("Revisar");
  });
  it("regimeRejectReason: mercado fuerte no filtra; mercado débil exige scores altos", () => {
    const strongRow = { totalScore: 90, riskScore: 80, weinsteinScore: 90, minerviniScore: 80 };
    const weakRow = { totalScore: 50, riskScore: 30, weinsteinScore: 40, minerviniScore: 30 };
    expect(regimeRejectReason(strongRow, { marketScore: 80 }, true, {})).toBeNull();
    expect(regimeRejectReason(weakRow, { marketScore: 80 }, true, {})).toBeNull();
    expect(regimeRejectReason(strongRow, { marketScore: 30 }, true, {})).toBeNull();
    const rejected = regimeRejectReason(weakRow, { marketScore: 30 }, true, {});
    expect(rejected).not.toBeNull();
    expect(rejected.key).toBe("regime");
    // Con el filtro de régimen desactivado nunca rechaza.
    expect(regimeRejectReason(weakRow, { marketScore: 30 }, false, {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scoreWeakness · cadena de fallback RS unificada con screenerFilters.js
// ---------------------------------------------------------------------------
// Cobertura del caso límite que cambió de comportamiento con la consolidación:
// símbolos donde rsGlobalPct y rsRating son null/undefined pero rsCountryPct o
// rsSectorPct están presentes.
//
// ANTES del fix:
//   - lib/scoring.js usaba rsPrimaryScore(r) ≡ rsGlobalPct ?? rsRating ?? 50,
//     caía a 50 → score 36 ("Debilidad mixta").
//   - lib/screenerFilters.js usaba metric("rsPrimary") ≡ rsGlobalPct ?? rsRating
//     ?? rsCountryPct ?? rsSectorPct ?? 50, usaba 80 → score 30.
//   → researchRow.js y screenerPipeline.js (vía scoring.js) divergían de
//     materializedScanner.js (vía screenerFilters.js) en 6 puntos.
//
// DESPUÉS del fix:
//   - lib/scoring.js usa la cadena de 4 niveles; lib/screenerFilters.js importa
//     y re-exporta scoreWeakness desde lib/scoring.js. Ambas rutas convergen.
//
// Este test fija el valor esperado nuevo (30) y por lo tanto FALLARÁ si se
// revierte el fix a rsPrimaryScore (volvería a 36).
import { scoreWeakness as scoreWeaknessFromFilters } from "@/lib/screenerFilters";

const rsFallbackRow = {
  price: 80, sma50: 95, sma200: 90, sma200Slope: 0.5,
  // rsGlobalPct y rsRating ausentes — antes hacían caer a 50.
  rsGlobalPct: null,
  rsRating: null,
  // rsCountryPct/rsSectorPct presentes — el fix ahora los usa como fallback.
  rsCountryPct: 70,
  rsSectorPct: 80,
  perf3m: 5, perf6m: 10, perf12m: 20,
  distance52w: -10, distance20d: -5, maxDrawdown63d: 15, upDownVolRatio: 1.2,
  upVolume: true, relativeVolume: 1.0, riskScore: 60, extSma50: -10,
  speculationRiskScore: 30,
};

describe("scoreWeakness · cadena de fallback RS unificada (rsGlobalPct ?? rsRating ?? rsCountryPct ?? rsSectorPct ?? 50)", () => {
  it("usa rsSectorPct=80 cuando rsGlobalPct y rsRating faltan → score 30 (no 36)", () => {
    const w = scoreWeakness(rsFallbackRow);
    // Con el fix, rs se resuelve a 80 (rsSectorPct) → fuera de los tramos RS que
    // penalizan (<30, <45, <55). Sin el fix, rs caía a 50 (rama <55 → +6) y el
    // score era 36. La diferencia de 6 puntos proviene exclusivamente del tramo
    // "rs < 55 → +6 (sin razón)". Por eso el assert fija 30 y rompe en revert.
    expect(w.weaknessScore).toBe(30);
    expect(w.weaknessLabel).toBe("Sin deterioro claro");
  });

  it("scoring.js y screenerFilters.js producen el MISMO resultado (consolidación)", () => {
    // Tras el fix screenerFilters.js re-exporta scoreWeakness desde scoring.js,
    // así que son la misma función. Antes divergían en 6 puntos para esta fixture.
    expect(scoreWeakness(rsFallbackRow)).toEqual(scoreWeaknessFromFilters(rsFallbackRow));
  });

  it("razones con tilde son las canónicas ('muy lejos de máximos', 'caída con volumen')", () => {
    const w = scoreWeakness({ ...rsFallbackRow, distance52w: -50, upVolume: false, relativeVolume: 1.3 });
    expect(w.weaknessReasons).toEqual(expect.arrayContaining([
      "muy lejos de máximos",
      "caída con volumen",
    ]));
    // Y explícitamente NO contienen las versiones sin tilde que tenía screenerFilters.
    expect(w.weaknessReasons).not.toContain("muy lejos de maximos");
    expect(w.weaknessReasons).not.toContain("caida con volumen");
  });
});
