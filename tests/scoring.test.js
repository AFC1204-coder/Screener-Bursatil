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
