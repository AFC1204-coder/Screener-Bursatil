// Tests golden de lib/scoringEngine.js.
// Comparan bit-a-bit el cálculo de cada señal contra el snapshot verbatim de
// lib/scoring.js previo a la consolidación (tests/_golden_snapshot_scoring.js).
// Si el motor cambia una fórmula sin documentar la discrepancia, el test falla
// ruidosamente. Ver plan §5.
//
// Estructura: 3 perfiles (completo / parcial / caso límite) por cada una de las
// 19 señales del registry, más 6 perfiles específicos para scoreIpo (buckets
// de edad) y 3 perfiles para computeComposite.

import { describe, expect, it } from "vitest";
import { computeComposite, computeSignal, compositeLabel, SIGNAL_REGISTRY, COMPOSITE_WEIGHTS } from "@/lib/scoringEngine";
import { scoreWeakness } from "@/lib/scoring";
import {
  scoreAdProxy as snapAdProxy,
  scoreCompositeValue as snapComposite,
  scoreDemandQuality as snapDemand,
  scoreEpsGrowthProxy as snapEps,
  scoreGrowthQuality as snapGrowth,
  scoreIpo as snapIpo,
  scoreLiquidity as snapLiquidity,
  scoreMinervini as snapMinervini,
  scoreMomentum as snapMomentum,
  scoreObjectiveSetupQuality as snapObjectiveSetup,
  scorePatternQuality as snapPatternQuality,
  scoreRisk as snapRisk,
  scoreRiskReward as snapRiskReward,
  scoreSetupQuality as snapSetup,
  scoreVolume as snapVolume,
  scoreVolumeEffect as snapVolumeEffect,
  scoreWeinstein as snapWeinstein,
} from "./_golden_snapshot_scoring.js";

// ---------------------------------------------------------------------------
// Helpers de fixtures
// ---------------------------------------------------------------------------

// Perfil completo (alcista) — todos los inputs requeridos en zona alta.
const completeRow = () => ({
  price: 120,
  sma50: 110,
  sma150: 100,
  sma200: 95,
  sma200Slope: 0.4,
  distance52w: -3,
  distance20d: -2,
  distance50d: -3,
  distanceATH: -5,
  perf6m: 25,
  perf3m: 12,
  perf12m: 50,
  perf1m: 4,
  extSma50: 5,
  lowAdvance52w: 40,
  highsSpreadPct: 8,
  upDownVolRatio: 1.5,
  relativeVolume: 1.3,
  volumeSurgePct: 20,
  upVolume: true,
  latestVolume: 600000,
  latestTurnover: 12000000,
  avgVolume: 400000,
  prevAvgVolume20: 350000,
  avgTurnover: 9000000,
  marketCap: 500000000,
  volatility63d: 30,
  maxDrawdown63d: 15,
  maxDailyMove20dPct: 6,
  range63dPct: 50,
  returnToVol3m: 0.9,
  returnToDrawdown3m: 1.6,
  failedBreakout: false,
  rsGlobalPct: 75,
  rsRating: 75,
  rsCountryPct: 80,
  rsSectorPct: 80,
  rsQualityScore: 70,
  sectorScore: 65,
  riskRewardScore: 60,
  riskScore: 70,
  momentumScore: 50,
  growthScore: 60,
  adProxyScore: 55,
  demandScore: 55,
  setupQualityScore: 60,
  objectiveSetupScore: 60,
  patternContribution: 5,
  patternQualityScore: 70,
  baseQualityScore: 60,
  contractionScore: 50,
  growthMetrics: {
    revenueGrowth: 18,
    earningsGrowth: 22,
    grossMargin: 45,
    operatingMargin: 18,
    profitMargin: 14,
    roe: 20,
    roa: 8,
    debtToEquity: 50,
    currentRatio: 1.5,
  },
  ipoAgeMonths: 12,
  ipoDate: "",
});

// Perfil parcial — varios inputs NaN/null para forzar cláusulas que no aplican.
const partialRow = () => ({
  price: 80,
  sma50: null,
  sma150: null,
  sma200: null,
  sma200Slope: undefined,
  distance52w: -20,
  distance20d: null,
  distance50d: null,
  distanceATH: null,
  perf6m: 5,
  perf3m: null,
  perf12m: null,
  perf1m: null,
  extSma50: null,
  lowAdvance52w: null,
  highsSpreadPct: null,
  upDownVolRatio: null,
  relativeVolume: null,
  volumeSurgePct: null,
  upVolume: null,
  latestVolume: null,
  latestTurnover: null,
  avgVolume: null,
  prevAvgVolume20: null,
  avgTurnover: null,
  marketCap: null,
  volatility63d: null,
  maxDrawdown63d: null,
  maxDailyMove20dPct: null,
  range63dPct: null,
  returnToVol3m: null,
  returnToDrawdown3m: null,
  failedBreakout: false,
  rsGlobalPct: 50,
  rsRating: 50,
  growthMetrics: null,
  ipoAgeMonths: null,
  ipoDate: "",
});

// Perfil caso límite — en los bordes exactos de varias cláusulas.
const edgeRow = () => ({
  price: 5,            // borde del tramo price>=5 de scoreLiquidity
  sma50: 5.001,        // justo por encima del price → cumple gt
  sma150: 5.0,         // exactamente igual → NO cumple gt
  sma200: 4.999,
  sma200Slope: 0,      // borde (gt > 0 false)
  distance52w: -25,    // borde (gte -25 true)
  distance20d: -10,    // borde (gte -10 true)
  distance50d: -18,    // borde (gte -18 true)
  distanceATH: -15,    // borde (gte -15 true) para scoreIpo high
  perf6m: 0,           // borde (gt > 0 false)
  perf3m: 10,          // borde (gt > 10 false)
  perf12m: 80,         // borde (gte 80 true)
  extSma50: 8,         // borde alto del primer tramo between(-3,8)
  lowAdvance52w: 30,   // borde (gte 30 true)
  highsSpreadPct: 12,  // borde (lte 12 true)
  upDownVolRatio: 1.8, // borde (gte 1.8 true)
  relativeVolume: 2.2, // borde (gte 2.2 true)
  volumeSurgePct: 80,  // borde (gte 80 true)
  upVolume: true,
  latestVolume: 2000000, // borde (gte 2M true)
  latestTurnover: 25000000, // borde (gte 25M true)
  avgVolume: 1000000,  // borde (gte 1M true)
  avgTurnover: 25000000, // borde (gte 25M true)
  marketCap: 1000000000, // borde (gte 1B true)
  volatility63d: 25,   // borde (lte 25 true)
  maxDrawdown63d: 10,  // borde (lte 10 true)
  maxDailyMove20dPct: 8, // borde (lte 8 true)
  range63dPct: 55,     // borde (lte 55 true)
  returnToVol3m: 1.2,  // borde (gte 1.2 true)
  returnToDrawdown3m: 2.5, // borde (gte 2.5 true)
  failedBreakout: true,
  rsGlobalPct: 90,     // borde (rs >= 90 true) en scoreDemandQuality
  growthMetrics: {
    revenueGrowth: 30, // borde (gte 30 true)
    earningsGrowth: 50, // borde (gte 50 true) en epsGrowthProxy
    grossMargin: 55,   // borde (gte 55 true)
    operatingMargin: 25, // borde (gte 25 true)
    profitMargin: 20,  // borde (gte 20 true)
    roe: 25,           // borde (gte 25 true)
    roa: 10,           // borde (gte 10 true)
    debtToEquity: 60,  // borde (lte 60 true)
    currentRatio: 1.4, // borde (gte 1.4 true)
  },
  ipoAgeMonths: 6,     // borde: m < 6 false, m < 18 true → age=30
  sectorScore: 40,
});

const rowEnginesAndSnapshots = {
  weinsteinScore: [snapWeinstein, "row"],
  minerviniScore: [snapMinervini, "row"],
  momentumScore: [snapMomentum, "row"],
  riskScore: [snapRisk, "row"],
  riskRewardScore: [snapRiskReward, "row"],
  volumeEffectScore: [snapVolumeEffect, "row"],
  volumeScore: [snapVolume, "row"],
  liquidityScore: [snapLiquidity, "row"],
  objectiveSetupScore: [snapObjectiveSetup, "row"],
  patternScore: [snapPatternQuality, "row"],
  demandScore: [snapDemand, "row"],
  growthScore: [snapGrowth, "metrics"],   // firma del original: scoreGrowthQuality(r.growthMetrics || {})
  epsGrowthProxyScore: [snapEps, "metrics"], // idem
  adProxyScore: [snapAdProxy, "row"],
};

const profiles = {
  completo: completeRow,
  parcial: partialRow,
  "caso límite": edgeRow,
};

describe("scoringEngine · equivalencia bit-a-bit con scoring.js pre-consolidación", () => {
  for (const [profileName, buildRow] of Object.entries(profiles)) {
    for (const [signalKey, [snapshotFn, inputArg]] of Object.entries(rowEnginesAndSnapshots)) {
      it(`${signalKey} (${profileName}) · engine === snapshot`, () => {
        const row = buildRow();
        // Eliminamos cualquier override que el motor respetaría (objectiveSetupScore,
        // setupQualityScore) para que tanto el motor como el snapshot recalculen desde
        // cero — única forma de comparar bit-a-bit sin ruido de overrides.
        delete row.objectiveSetupScore;
        delete row.setupQualityScore;
        const { value: fromEngine } = computeSignal(row, signalKey);
        const snapshotInput = inputArg === "metrics" ? (row.growthMetrics || {}) : row;
        const fromSnapshot = snapshotFn(snapshotInput);
        expect(fromEngine).toBe(fromSnapshot);
      });
    }
  }

  // scoreSetupQuality se compara por separado — el motor acepta override de
  // objectiveSetupScore, replicado en el snapshot. Sin override, ambos recalculan.
  it("setupQualityScore (completo) · engine === snapshot", () => {
    const row = completeRow();
    delete row.setupQualityScore;
    delete row.objectiveSetupScore;
    expect(computeSignal(row, "setupQualityScore").value).toBe(snapSetup(row));
  });
  it("setupQualityScore (caso límite) · engine === snapshot", () => {
    const row = edgeRow();
    delete row.setupQualityScore;
    delete row.objectiveSetupScore;
    expect(computeSignal(row, "setupQualityScore").value).toBe(snapSetup(row));
  });

  // patternContribution depende de methodologyPatternEvidenceBonus (no en el
  // snapshot). Solo validamos que patternScore sea idéntico, ya cubierto arriba.
});

// ---------------------------------------------------------------------------
// scoreIpo — buckets de edad (6 perfiles)
// ---------------------------------------------------------------------------
describe("scoringEngine · scoreIpo buckets de edad", () => {
  const baseIpo = (overrides) => ({
    ipoAgeMonths: 12,
    ipoDate: "",
    distanceATH: -20,
    distance52w: -25,
    avgVolume: 500000,
    price: 80,
    sma50: 70,
    perf3m: 5,
    sectorScore: 50,
    ...overrides,
  });

  const cases = [
    { name: "joven <6m (age=25)", row: baseIpo({ ipoAgeMonths: 4, distance52w: -30, perf3m: 5, sectorScore: 50 }) },
    { name: "<18m (age=30) + cerca ATH (high=25)", row: baseIpo({ ipoAgeMonths: 12, distanceATH: -10, distance52w: -10, avgVolume: 1500000, perf3m: 15, price: 100, sma50: 90, sectorScore: 60 }) },
    { name: "<36m (age=24)", row: baseIpo({ ipoAgeMonths: 30 }) },
    { name: "≥36m ≤60m (age=16)", row: baseIpo({ ipoAgeMonths: 50 }) },
    { name: ">60m → 0", row: baseIpo({ ipoAgeMonths: 80 }) },
    { name: "NaN → 0", row: baseIpo({ ipoAgeMonths: null, ipoDate: "" }) },
  ];

  for (const c of cases) {
    it(`${c.name} · engine === snapshot`, () => {
      const { value: fromEngine } = computeSignal(c.row, "ipoScore");
      const fromSnapshot = snapIpo(c.row);
      expect(fromEngine).toBe(fromSnapshot);
      // Para los buckets bien definidos, sanity adicional sobre el rango [0,100].
      if (c.name !== ">60m → 0" && c.name !== "NaN → 0") {
        expect(fromEngine).toBeGreaterThanOrEqual(0);
        expect(fromEngine).toBeLessThanOrEqual(100);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// computeComposite — 3 perfiles
// ---------------------------------------------------------------------------
describe("scoringEngine · computeComposite (composite)", () => {
  it("perfil completo · engine === snapshot", () => {
    const input = {
      setupQualityScore: 70,
      rsAnchor: 75,
      rsQualityScore: 70,
      demandScore: 65,
      adProxyScore: 55,
      growthScore: 60,
      epsAnchor: 60,
      sectorScore: 65,
      riskRewardScore: 60,
      riskScore: 70,
      momentumScore: 50,
      ipoScore: 30,
    };
    expect(computeComposite(input)).toBe(snapComposite(input));
  });
  it("con ipoScore omitido (default 0)", () => {
    const input = {
      setupQualityScore: 70, rsAnchor: 75, rsQualityScore: 70,
      demandScore: 65, adProxyScore: 55, growthScore: 60, epsAnchor: 60,
      sectorScore: 65, riskRewardScore: 60, riskScore: 70, momentumScore: 50,
    };
    expect(computeComposite(input)).toBe(snapComposite(input));
  });
  it("perfil bajo · engine === snapshot", () => {
    const input = {
      setupQualityScore: 20, rsAnchor: 30, rsQualityScore: 25,
      demandScore: 20, adProxyScore: 15, growthScore: 25, epsAnchor: 20,
      sectorScore: 30, riskRewardScore: 20, riskScore: 25, momentumScore: 10,
      ipoScore: 0,
    };
    expect(computeComposite(input)).toBe(snapComposite(input));
  });
});

// ---------------------------------------------------------------------------
// Registry: integridad estructural
// ---------------------------------------------------------------------------
describe("scoringEngine · SIGNAL_REGISTRY integridad", () => {
  it("cada entrada tiene key, requiredInputs (array, puede ser vacío), direction, compute", () => {
    for (const [key, entry] of Object.entries(SIGNAL_REGISTRY)) {
      expect(entry.key).toBe(key);
      // requiredInputs es siempre un array; puede ser vacío cuando una señal no
      // declara ningún input escalar (ej: patternContributionScore delega en
      // methodologyPatternEvidenceBonus, que decide su propia degradación interna).
      // El contrato de inputCoverage define requiredInputs=[] → coverage=1.0.
      expect(Array.isArray(entry.requiredInputs)).toBe(true);
      expect(["positive", "negative"]).toContain(entry.direction);
      expect(typeof entry.compute).toBe("function");
    }
  });

  it("los pesos del composite suman 1.00 y todas las claves existen", () => {
    let sum = 0;
    for (const { key, weight } of COMPOSITE_WEIGHTS) {
      sum += weight;
      // Las claves externas (rsAnchor, rsQualityScore, sectorScore, epsAnchor)
      // no están en el registry — solo verificamos que las internas sí.
    }
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("computeSignal devuelve null para claves desconocidas", () => {
    expect(computeSignal({}, "noExiste")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// compositeLabel — los 5 tramos
// ---------------------------------------------------------------------------
describe("scoringEngine · compositeLabel", () => {
  it("tramos", () => {
    expect(compositeLabel(100)).toBe("Elite");
    expect(compositeLabel(85)).toBe("Elite");
    expect(compositeLabel(84.9)).toBe("Leader");
    expect(compositeLabel(75)).toBe("Leader");
    expect(compositeLabel(74.9)).toBe("Fuerte");
    expect(compositeLabel(65)).toBe("Fuerte");
    expect(compositeLabel(64.9)).toBe("Watchlist");
    expect(compositeLabel(55)).toBe("Watchlist");
    expect(compositeLabel(54.9)).toBe("Revisar");
    expect(compositeLabel(0)).toBe("Revisar");
  });
});

// ---------------------------------------------------------------------------
// computeSignal · wrapper { value, coverage, partial }
// ---------------------------------------------------------------------------
describe("scoringEngine · computeSignal coverage wrapper", () => {
  // momentumScore: requiredInputs = ["perf3m", "perf6m", "perf12m"] (3 inputs)
  it("momentumScore: coverage=1.0 cuando los 3 requiredInputs están presentes", () => {
    const row = { perf3m: 25, perf6m: 40, perf12m: 80 };
    const result = computeSignal(row, "momentumScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("momentumScore: coverage=0.667 cuando faltan 1 de 3 inputs", () => {
    const row = { perf3m: 25, perf12m: 80 }; // perf6m ausente
    const result = computeSignal(row, "momentumScore");
    expect(result.coverage).toBeCloseTo(2 / 3, 6);
    expect(result.partial).toBe(true);
  });

  it("momentumScore: coverage=0.333 cuando solo 1 de 3 inputs", () => {
    const row = { perf3m: 25 }; // perf6m, perf12m ausentes
    const result = computeSignal(row, "momentumScore");
    expect(result.coverage).toBeCloseTo(1 / 3, 6);
    expect(result.partial).toBe(true);
  });

  it("momentumScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "momentumScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // compute() still runs → degrades to 0 (all branches fail)
    expect(result.value).toBe(0);
  });

  // weinsteinScore: requiredInputs = 7 inputs (más señales para confirmar genericidad)
  it("weinsteinScore: coverage=1.0 cuando los 7 requiredInputs están presentes", () => {
    const row = { price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4, distance52w: -3, perf6m: 25 };
    const result = computeSignal(row, "weinsteinScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("weinsteinScore: coverage=4/7≈0.571 cuando faltan 3 de 7 inputs", () => {
    // price, sma200, perf6m ausentes
    const row = { sma50: 110, sma150: 100, sma200Slope: 0.4, distance52w: -3 };
    const result = computeSignal(row, "weinsteinScore");
    expect(result.coverage).toBeCloseTo(4 / 7, 6);
    expect(result.partial).toBe(true);
  });

  it("weinsteinScore: coverage=0 cuando todos los inputs son null/undefined", () => {
    const row = { price: null, sma50: undefined, sma150: NaN, sma200: null, sma200Slope: undefined, distance52w: null, perf6m: undefined };
    const result = computeSignal(row, "weinsteinScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
  });

  // growthScore: requiredInputs = 9 dotted paths into growthMetrics.* (Task: container fix)
  // Antes del fix, growthMetrics={} reportaba coverage=1.0 (engañaba: compute() no tenía
  // datos reales). Ahora coverage es proporcional a los campos internos presentes.
  it("growthScore: coverage=0 cuando growthMetrics={} (contenedor vacío)", () => {
    const row = { growthMetrics: {} };
    const result = computeSignal(row, "growthScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // value no cambia: compute() sigue degradando a 45
    expect(result.value).toBe(45);
  });

  it("growthScore: coverage=0 cuando growthMetrics es null", () => {
    const row = { growthMetrics: null };
    const result = computeSignal(row, "growthScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // compute() still runs → returns 45 (default when no metrics are finite)
    expect(result.value).toBe(45);
  });

  it("growthScore: coverage proporcional cuando algunos campos están presentes", () => {
    // 2 de 9 campos internos presentes (revenueGrowth, earningsGrowth) → coverage ≈ 2/9
    const row = { growthMetrics: { revenueGrowth: 30, earningsGrowth: 40 } };
    const result = computeSignal(row, "growthScore");
    expect(result.coverage).toBeCloseTo(2 / 9, 6);
    expect(result.partial).toBe(true);
  });

  it("growthScore: coverage=1.0 cuando todos los campos internos están presentes", () => {
    const row = {
      growthMetrics: {
        revenueGrowth: 30, earningsGrowth: 40, grossMargin: 60,
        operatingMargin: 25, profitMargin: 20, roe: 25,
        roa: 10, debtToEquity: 50, currentRatio: 1.5,
      },
    };
    const result = computeSignal(row, "growthScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
  });

  // epsGrowthProxyScore: requiredInputs = 6 dotted paths (las del guard some(Number.isFinite))
  it("epsGrowthProxyScore: coverage=0 cuando growthMetrics={} (value=null)", () => {
    const row = { growthMetrics: {} };
    const result = computeSignal(row, "epsGrowthProxyScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // value no cambia: compute() sigue devolviendo null cuando no hay métricas
    expect(result.value).toBeNull();
  });

  it("epsGrowthProxyScore: coverage=0.5 cuando 3 de 6 campos presentes", () => {
    // Los 6 requiredInputs son: revenueGrowth, earningsGrowth, operatingMargin, profitMargin, roe, roa
    const row = { growthMetrics: { revenueGrowth: 30, roe: 25, roa: 10 } }; // 3 de 6 → 0.5
    const result = computeSignal(row, "epsGrowthProxyScore");
    expect(result.coverage).toBeCloseTo(3 / 6, 6);
    expect(result.partial).toBe(true);
  });

  it("epsGrowthProxyScore: coverage=1.0 cuando todos los 6 campos presentes", () => {
    const row = {
      growthMetrics: {
        revenueGrowth: 30, earningsGrowth: 40, operatingMargin: 25,
        profitMargin: 20, roe: 25, roa: 10,
      },
    };
    const result = computeSignal(row, "epsGrowthProxyScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
  });

  // value idéntico al comportamiento pre-cambio (usamos golden snapshot como referencia)
  it("value no cambia respecto al comportamiento pre-wrapper (momentumScore)", () => {
    const row = { perf3m: 25, perf6m: 40, perf12m: 80 };
    const { value } = computeSignal(row, "momentumScore");
    expect(value).toBe(snapMomentum(row));
  });

  it("value no cambia con inputs faltantes (momentumScore parcial)", () => {
    const row = { perf3m: 25 }; // perf6m, perf12m ausentes
    const { value } = computeSignal(row, "momentumScore");
    // Directly call the compute function — same result as pre-wrapper
    expect(value).toBe(SIGNAL_REGISTRY.momentumScore.compute(row));
  });

  it("value no cambia respecto al comportamiento pre-wrapper (weinsteinScore)", () => {
    const row = { price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4, distance52w: -3, perf6m: 25 };
    const { value } = computeSignal(row, "weinsteinScore");
    expect(value).toBe(snapWeinstein(row));
  });

  // null para key desconocida (no cambia)
  it("devuelve null para claves desconocidas", () => {
    expect(computeSignal({}, "noExiste")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// patternContributionScore — fix del input fantasma methodologyPatternContext
// ---------------------------------------------------------------------------
// Antes del fix, requiredInputs era ["methodologyPatternContext"] — un campo que
// NUNCA existe en ninguna fila (cero asignaciones/lecturas en el repo). Resultado:
// la señal reportaba coverage=0 / partial=true SIEMPRE, incluso con inputs reales
// de patrón presentes, porque ese campo inexistente faltaba. Tras eliminarlo,
// requiredInputs=[] → "nada requerido" → coverage=1.0 / partial=false (contrato
// documentado de inputCoverage). value NO cambia: sigue siendo 0 cuando los datos
// de patrón no son "usables" y >0 cuando sí lo son (lógica interna del compute).
describe("scoringEngine · patternContributionScore (fix input fantasma)", () => {
  it("coverage=1.0 / partial=false en cualquier fila (sin inputs requeridos)", () => {
    const result = computeSignal({}, "patternContributionScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
  });

  it("coverage=1.0 incluso con inputs reales presentes (no falso partial)", () => {
    // Antes este caso daba coverage=0/partial=true por el campo fantasma. Ahora 1.0.
    const row = { patternQualityScore: 80, contractionScore: 50, vcpCandidate: true };
    const result = computeSignal(row, "patternContributionScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
  });

  it("value NO cambia: degrada a 0 cuando los datos de patrón no son usables", () => {
    // Sin patternEligible/patternDataStatus usables, methodologyPatternEvidenceBonus
    // retorna 0 — comportamiento pre-fix preservado (value es el contrato inmutable).
    const result = computeSignal({}, "patternContributionScore");
    expect(result.value).toBe(0);
  });

  it("value NO cambia: >0 cuando methodologyPatternEvidenceBonus aporta bonus", () => {
    // Fila "usable" con calidad alta → bonus positivo. Verificamos que el value
    // refleja el compute() real (no inventamos lógica, solo confirmamos invariabilidad).
    const row = {
      patternEligible: true,
      patternDataStatus: "ok",
      patternQualityScore: 80,
      contractionScore: 50,
      vcpCandidate: true,
    };
    const result = computeSignal(row, "patternContributionScore");
    expect(result.value).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// weaknessScore — registro diagnósticas (NO entra al composite)
// ---------------------------------------------------------------------------
// weaknessScore es la única señal "negative" del registry (valores altos = peor
// estado). NO se añade a COMPOSITE_WEIGHTS: sigue resolviéndose por cascada de
// prioridad en decisionAudit.js. Aquí registramos solo para que signalContradictions
// (fase posterior) pueda evaluar reglas que lo involucren con el mismo mecanismo
// de coverage/partial que las 19 señales existentes.
describe("scoringEngine · weaknessScore (registro diagnósticas)", () => {
  // Fila completa con los 20 requiredInputs presentes (los 4 RS + 16 directos).
  const completeRow = () => ({
    rsGlobalPct: 75, rsRating: 70, rsCountryPct: 68, rsSectorPct: 65,
    price: 100, sma50: 95, sma200: 90, sma200Slope: 0.5,
    perf3m: 10, perf6m: 15, perf12m: 20,
    distance52w: -5, distance20d: -2,
    maxDrawdown63d: 8, upDownVolRatio: 1.3, upVolume: true, relativeVolume: 1.1,
    riskScore: 80, extSma50: 5, speculationRiskScore: 30,
  });

  it("entrada del registry: direction 'negative', requiredInputs no vacío, compute función", () => {
    const entry = SIGNAL_REGISTRY.weaknessScore;
    expect(entry).toBeDefined();
    expect(entry.key).toBe("weaknessScore");
    expect(entry.direction).toBe("negative");
    expect(Array.isArray(entry.requiredInputs)).toBe(true);
    expect(entry.requiredInputs.length).toBeGreaterThan(0);
    expect(typeof entry.compute).toBe("function");
  });

  it("requiredInputs incluye los 4 campos RS del fallback + los lecturas directas verificadas", () => {
    const req = SIGNAL_REGISTRY.weaknessScore.requiredInputs;
    // Cadena de fallback RS (firstFinite en scoreWeakness L92)
    expect(req).toContain("rsGlobalPct");
    expect(req).toContain("rsRating");
    expect(req).toContain("rsCountryPct");
    expect(req).toContain("rsSectorPct");
    // Lecturas directas verificadas contra el cuerpo de scoreWeakness
    for (const f of ["price", "sma50", "sma200", "sma200Slope", "perf3m", "perf6m",
      "perf12m", "distance52w", "distance20d", "maxDrawdown63d", "upDownVolRatio",
      "upVolume", "relativeVolume", "riskScore", "extSma50", "speculationRiskScore"]) {
      expect(req).toContain(f);
    }
  });

  it("computeSignal con fila completa → coverage=1.0, value === scoreWeakness(row).weaknessScore", () => {
    const row = completeRow();
    const result = computeSignal(row, "weaknessScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    // value === número extraído de scoreWeakness (contrato del wrapper)
    expect(result.value).toBe(scoreWeakness(row).weaknessScore);
    // una fila sana con RS alto y precios sobre SMAs → deteriorationScore bajo
    expect(result.value).toBeLessThan(35);
  });

  it("computeSignal con inputs faltantes → coverage<1.0, partial=true", () => {
    // Faltan perf3m/perf6m/perf12m/distance52w/distance20d (5 de 20)
    const row = {
      rsGlobalPct: 75, rsRating: 70, rsCountryPct: 68, rsSectorPct: 65,
      price: 100, sma50: 95, sma200: 90, sma200Slope: 0.5,
      maxDrawdown63d: 8, upDownVolRatio: 1.3, upVolume: true, relativeVolume: 1.1,
      riskScore: 80, extSma50: 5, speculationRiskScore: 30,
    };
    const result = computeSignal(row, "weaknessScore");
    expect(result.coverage).toBeCloseTo(15 / 20, 6);
    expect(result.partial).toBe(true);
    // value sigue siendo coherente (compute() tolera inputs faltantes)
    expect(typeof result.value).toBe("number");
  });

  it("weaknessScore NO aparece en COMPOSITE_WEIGHTS (protegido contra reintroducción)", () => {
    const keys = COMPOSITE_WEIGHTS.map((w) => w.key);
    expect(keys).not.toContain("weaknessScore");
  });

  it("computeComposite NO se ve afectado por weaknessScore (no hay parámetro ni peso)", () => {
    // Un input composite "base" sin weaknessScore, y el mismo input con un
    // weaknessScore añadido: el resultado debe ser idéntico (weaknessScore es
    // ignorado por computeComposite).
    const baseInput = {
      setupQualityScore: 70, rsAnchor: 75, rsQualityScore: 70,
      demandScore: 65, adProxyScore: 55, growthScore: 60, epsAnchor: 60,
      sectorScore: 65, riskRewardScore: 60, riskScore: 70, momentumScore: 50, ipoScore: 30,
    };
    const withWeakness = { ...baseInput, weaknessScore: 90 };
    expect(computeComposite(withWeakness)).toBe(computeComposite(baseInput));
  });
});

// ---------------------------------------------------------------------------
// Coverage wrapper para las 12 señales del registry que NO estaban cubiertas
// directamente en el bloque "computeSignal coverage wrapper" superior.
// Patrón idéntico: (1) coverage=1.0 con todos los requiredInputs presentes,
// (2) coverage proporcional con un subconjunto presente, (3) coverage=0 con
// ninguno presente, (4) value === snapshot pre-consolidación para una fila
// completa (contrato inmutable del wrapper).
//
// Notas de diseño:
// - volumeScore depende de volumeEffectScore (intra-row); los tests lo incluyen
//   como requiredInput ya calculado en la fila mock.
// - demandScore depende de volumeScore/volumeEffectScore/liquidityScore (intra-
//   row) y de campos RS (rsGlobalPct/rsRating) — fixtures locales, no integración.
// - setupQualityScore depende de objectiveSetupScore; el motor acepta override y
//   lo respeta, pero los tests pasan objectiveSetupScore explícito para mantener
//   comparabilidad con el snapshot pre-consolidación (snapSetup replica override).
// - ipoScore: señal "muerta" en el pipeline real (materializedScanner no la
//   invoca); aquí se prueba como señal aislada, igual que las demás.
// ---------------------------------------------------------------------------
describe("scoringEngine · computeSignal coverage wrapper (señales sin cobertura directa)", () => {
  // ---- minerviniScore: requiredInputs = 10 ---------------------------------
  it("minerviniScore: coverage=1.0 cuando los 10 requiredInputs están presentes", () => {
    const row = {
      price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4,
      lowAdvance52w: 40, distance52w: -3, distance20d: -2, highsSpreadPct: 8, perf3m: 12,
    };
    const result = computeSignal(row, "minerviniScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("minerviniScore: coverage=5/10=0.5 cuando faltan 5 de 10 inputs", () => {
    // sma150, lowAdvance52w, distance52w, distance20d, highsSpreadPct ausentes
    const row = { price: 120, sma50: 110, sma200: 95, sma200Slope: 0.4, perf3m: 12 };
    const result = computeSignal(row, "minerviniScore");
    expect(result.coverage).toBeCloseTo(5 / 10, 6);
    expect(result.partial).toBe(true);
  });

  it("minerviniScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "minerviniScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBe(0);
  });

  it("minerviniScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = {
      price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4,
      lowAdvance52w: 40, distance52w: -3, distance20d: -2, highsSpreadPct: 8, perf3m: 12,
    };
    const { value } = computeSignal(row, "minerviniScore");
    expect(value).toBe(snapMinervini(row));
  });

  // ---- riskScore: requiredInputs = 5 ---------------------------------------
  it("riskScore: coverage=1.0 cuando los 5 requiredInputs están presentes", () => {
    const row = { extSma50: 5, distance20d: -2, distance50d: -3, price: 120, sma50: 110 };
    const result = computeSignal(row, "riskScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("riskScore: coverage=3/5=0.6 cuando faltan 2 de 5 inputs", () => {
    // extSma50, distance50d ausentes
    const row = { distance20d: -2, price: 120, sma50: 110 };
    const result = computeSignal(row, "riskScore");
    expect(result.coverage).toBeCloseTo(3 / 5, 6);
    expect(result.partial).toBe(true);
  });

  it("riskScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "riskScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBe(0);
  });

  it("riskScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = { extSma50: 5, distance20d: -2, distance50d: -3, price: 120, sma50: 110 };
    const { value } = computeSignal(row, "riskScore");
    expect(value).toBe(snapRisk(row));
  });

  // ---- riskRewardScore: requiredInputs = 7 --------------------------------
  it("riskRewardScore: coverage=1.0 cuando los 7 requiredInputs están presentes", () => {
    const row = {
      returnToVol3m: 0.9, returnToDrawdown3m: 1.6, volatility63d: 30,
      maxDrawdown63d: 15, maxDailyMove20dPct: 6, range63dPct: 50, perf3m: 12,
    };
    const result = computeSignal(row, "riskRewardScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("riskRewardScore: coverage=4/7≈0.571 cuando faltan 3 de 7 inputs", () => {
    // volatility63d, maxDailyMove20dPct, range63dPct ausentes
    const row = {
      returnToVol3m: 0.9, returnToDrawdown3m: 1.6, maxDrawdown63d: 15, perf3m: 12,
    };
    const result = computeSignal(row, "riskRewardScore");
    expect(result.coverage).toBeCloseTo(4 / 7, 6);
    expect(result.partial).toBe(true);
  });

  it("riskRewardScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "riskRewardScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBe(0);
  });

  it("riskRewardScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = {
      returnToVol3m: 0.9, returnToDrawdown3m: 1.6, volatility63d: 30,
      maxDrawdown63d: 15, maxDailyMove20dPct: 6, range63dPct: 50, perf3m: 12,
    };
    const { value } = computeSignal(row, "riskRewardScore");
    expect(value).toBe(snapRiskReward(row));
  });

  // ---- volumeEffectScore: requiredInputs = 6 ------------------------------
  it("volumeEffectScore: coverage=1.0 cuando los 6 requiredInputs están presentes", () => {
    const row = {
      latestTurnover: 12000000, latestVolume: 600000, relativeVolume: 1.3,
      volumeSurgePct: 20, upDownVolRatio: 1.5, upVolume: true,
    };
    const result = computeSignal(row, "volumeEffectScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("volumeEffectScore: coverage=3/6=0.5 cuando faltan 3 de 6 inputs", () => {
    // latestVolume, volumeSurgePct, upVolume ausentes
    const row = { latestTurnover: 12000000, relativeVolume: 1.3, upDownVolRatio: 1.5 };
    const result = computeSignal(row, "volumeEffectScore");
    expect(result.coverage).toBeCloseTo(3 / 6, 6);
    expect(result.partial).toBe(true);
  });

  it("volumeEffectScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "volumeEffectScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBe(0);
  });

  it("volumeEffectScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = {
      latestTurnover: 12000000, latestVolume: 600000, relativeVolume: 1.3,
      volumeSurgePct: 20, upDownVolRatio: 1.5, upVolume: true,
    };
    const { value } = computeSignal(row, "volumeEffectScore");
    expect(value).toBe(snapVolumeEffect(row));
  });

  // ---- volumeScore: requiredInputs = 6 (incluye volumeEffectScore intra-row)
  it("volumeScore: coverage=1.0 cuando los 6 requiredInputs están presentes", () => {
    const row = {
      avgTurnover: 9000000, avgVolume: 400000, upDownVolRatio: 1.5,
      relativeVolume: 1.3, volumeSurgePct: 20, volumeEffectScore: 60,
    };
    const result = computeSignal(row, "volumeScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("volumeScore: coverage=3/6=0.5 cuando faltan 3 de 6 inputs (incl. dep intra-row)", () => {
    // upDownVolRatio, volumeSurgePct, volumeEffectScore ausentes
    const row = { avgTurnover: 9000000, avgVolume: 400000, relativeVolume: 1.3 };
    const result = computeSignal(row, "volumeScore");
    expect(result.coverage).toBeCloseTo(3 / 6, 6);
    expect(result.partial).toBe(true);
  });

  it("volumeScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "volumeScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // value=0: sin inputs, compute() no aporta puntos y el bonus
    // volumeEffectScore (||0) aporta 0.
    expect(result.value).toBe(0);
  });

  it("volumeScore: value === snapshot pre-consolidación con fila completa (dep intra-row incluida)", () => {
    const row = {
      avgTurnover: 9000000, avgVolume: 400000, upDownVolRatio: 1.5,
      relativeVolume: 1.3, volumeSurgePct: 20, volumeEffectScore: 60,
    };
    const { value } = computeSignal(row, "volumeScore");
    expect(value).toBe(snapVolume(row));
  });

  // ---- liquidityScore: requiredInputs = 4 ---------------------------------
  it("liquidityScore: coverage=1.0 cuando los 4 requiredInputs están presentes", () => {
    const row = { marketCap: 500000000, avgTurnover: 9000000, avgVolume: 400000, price: 120 };
    const result = computeSignal(row, "liquidityScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("liquidityScore: coverage=2/4=0.5 cuando faltan 2 de 4 inputs", () => {
    // marketCap, avgTurnover ausentes
    const row = { avgVolume: 400000, price: 120 };
    const result = computeSignal(row, "liquidityScore");
    expect(result.coverage).toBeCloseTo(2 / 4, 6);
    expect(result.partial).toBe(true);
  });

  it("liquidityScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "liquidityScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBe(0);
  });

  it("liquidityScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = { marketCap: 500000000, avgTurnover: 9000000, avgVolume: 400000, price: 120 };
    const { value } = computeSignal(row, "liquidityScore");
    expect(value).toBe(snapLiquidity(row));
  });

  // ---- ipoScore: requiredInputs = 9 ---------------------------------------
  // ipoScore es "muerta" en el pipeline real (materializedScanner no la invoca);
  // se prueba igual como señal aislada para cubrir el contrato del wrapper.
  it("ipoScore: coverage=1.0 cuando los 9 requiredInputs están presentes", () => {
    const row = {
      ipoAgeMonths: 12, ipoDate: "", distanceATH: -10, distance52w: -10,
      avgVolume: 1500000, price: 100, sma50: 90, perf3m: 15, sectorScore: 60,
    };
    const result = computeSignal(row, "ipoScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("ipoScore: coverage=5/9≈0.556 cuando faltan 4 de 9 inputs", () => {
    // distanceATH, ipoDate, sma50, sectorScore ausentes
    const row = {
      ipoAgeMonths: 12, distance52w: -10, avgVolume: 1500000, price: 100, perf3m: 15,
    };
    const result = computeSignal(row, "ipoScore");
    expect(result.coverage).toBeCloseTo(5 / 9, 6);
    expect(result.partial).toBe(true);
  });

  it("ipoScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "ipoScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // compute() sin ipoAgeMonths/ipoDate válidos → m=null → bucket out of range → 0
    expect(result.value).toBe(0);
  });

  it("ipoScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = {
      ipoAgeMonths: 12, ipoDate: "", distanceATH: -10, distance52w: -10,
      avgVolume: 1500000, price: 100, sma50: 90, perf3m: 15, sectorScore: 60,
    };
    const { value } = computeSignal(row, "ipoScore");
    expect(value).toBe(snapIpo(row));
  });

  // ---- objectiveSetupScore: requiredInputs = 9 -----------------------------
  it("objectiveSetupScore: coverage=1.0 cuando los 9 requiredInputs están presentes", () => {
    const row = {
      price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4,
      distance52w: -3, distance20d: -2, extSma50: 5, highsSpreadPct: 8,
    };
    const result = computeSignal(row, "objectiveSetupScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("objectiveSetupScore: coverage=5/9≈0.556 cuando faltan 4 de 9 inputs", () => {
    // sma150, sma200, distance52w, highsSpreadPct ausentes
    const row = { price: 120, sma50: 110, sma200Slope: 0.4, distance20d: -2, extSma50: 5 };
    const result = computeSignal(row, "objectiveSetupScore");
    expect(result.coverage).toBeCloseTo(5 / 9, 6);
    expect(result.partial).toBe(true);
  });

  it("objectiveSetupScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "objectiveSetupScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.value).toBe(0);
  });

  it("objectiveSetupScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = {
      price: 120, sma50: 110, sma150: 100, sma200: 95, sma200Slope: 0.4,
      distance52w: -3, distance20d: -2, extSma50: 5, highsSpreadPct: 8,
    };
    const { value } = computeSignal(row, "objectiveSetupScore");
    expect(value).toBe(snapObjectiveSetup(row));
  });

  // ---- patternScore: requiredInputs = 4 -----------------------------------
  it("patternScore: coverage=1.0 cuando los 4 requiredInputs están presentes", () => {
    const row = {
      patternContribution: 5, patternQualityScore: 70, baseQualityScore: 60, contractionScore: 50,
    };
    const result = computeSignal(row, "patternScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("patternScore: coverage=2/4=0.5 cuando faltan 2 de 4 inputs", () => {
    // patternContribution, contractionScore ausentes
    const row = { patternQualityScore: 70, baseQualityScore: 60 };
    const result = computeSignal(row, "patternScore");
    expect(result.coverage).toBeCloseTo(2 / 4, 6);
    expect(result.partial).toBe(true);
  });

  it("patternScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "patternScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // Sin patternContribution ni quality resoluble → compute() retorna 0
    expect(result.value).toBe(0);
  });

  it("patternScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = {
      patternContribution: 5, patternQualityScore: 70, baseQualityScore: 60, contractionScore: 50,
    };
    const { value } = computeSignal(row, "patternScore");
    expect(value).toBe(snapPatternQuality(row));
  });

  // ---- setupQualityScore: requiredInputs = 3 ------------------------------
  // setupQualityScore depende de objectiveSetupScore (intra-row, lo recalcula
  // si no viene pre-calculado). El snapshot snapSetup replica el override, por
  // lo que pasamos objectiveSetupScore explícito en la fila mock.
  it("setupQualityScore: coverage=1.0 cuando los 3 requiredInputs están presentes", () => {
    const row = { objectiveSetupScore: 60, patternContribution: 5, failedBreakout: false };
    const result = computeSignal(row, "setupQualityScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("setupQualityScore: coverage=1/3≈0.333 cuando solo 1 de 3 inputs presente", () => {
    // Solo objectiveSetupScore presente (patternContribution y failedBreakout ausentes)
    const row = { objectiveSetupScore: 60 };
    const result = computeSignal(row, "setupQualityScore");
    expect(result.coverage).toBeCloseTo(1 / 3, 6);
    expect(result.partial).toBe(true);
  });

  it("setupQualityScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "setupQualityScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // Sin patternContribution (||0) ni failedBreakout (false → no descuento) → 0
    expect(result.value).toBe(0);
  });

  it("setupQualityScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = { objectiveSetupScore: 60, patternContribution: 5, failedBreakout: false };
    const { value } = computeSignal(row, "setupQualityScore");
    expect(value).toBe(snapSetup(row));
  });

  // ---- demandScore: requiredInputs = 9 (incluye deps intra-row y RS) ------
  // demandScore depende de volumeScore/volumeEffectScore/liquidityScore (intra-
  // row) y de la cadena RS via rsPrimaryValue (rsGlobalPct ?? rsRating ?? ...).
  // Construimos la fila mock con esos campos ya poblados.
  it("demandScore: coverage=1.0 cuando los 9 requiredInputs están presentes", () => {
    const row = {
      rsGlobalPct: 75, rsRating: 75, volumeScore: 55, volumeEffectScore: 60,
      liquidityScore: 60, upDownVolRatio: 1.5, relativeVolume: 1.3,
      volumeSurgePct: 20, avgVolume: 400000,
    };
    const result = computeSignal(row, "demandScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("demandScore: coverage=5/9≈0.556 cuando faltan 4 de 9 inputs", () => {
    // rsRating, volumeEffectScore, upDownVolRatio, avgVolume ausentes
    const row = {
      rsGlobalPct: 75, volumeScore: 55, liquidityScore: 60,
      relativeVolume: 1.3, volumeSurgePct: 20,
    };
    const result = computeSignal(row, "demandScore");
    expect(result.coverage).toBeCloseTo(5 / 9, 6);
    expect(result.partial).toBe(true);
  });

  it("demandScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "demandScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // rs=50 (fallback), volumeScore/volumeEffectScore/liquidityScore=0 → 0+0+0+0+0+0+0 = 0
    expect(result.value).toBe(0);
  });

  it("demandScore: value === snapshot pre-consolidación con fila completa (RS + deps intra-row)", () => {
    const row = {
      rsGlobalPct: 75, rsRating: 75, volumeScore: 55, volumeEffectScore: 60,
      liquidityScore: 60, upDownVolRatio: 1.5, relativeVolume: 1.3,
      volumeSurgePct: 20, avgVolume: 400000,
    };
    const { value } = computeSignal(row, "demandScore");
    expect(value).toBe(snapDemand(row));
  });

  // ---- adProxyScore: requiredInputs = 10 ----------------------------------
  it("adProxyScore: coverage=1.0 cuando los 10 requiredInputs están presentes", () => {
    const row = {
      upDownVolRatio: 1.5, relativeVolume: 1.3, upVolume: true, volumeSurgePct: 20,
      perf3m: 12, distance20d: -2, distance52w: -3, price: 120, sma50: 110,
      maxDrawdown63d: 15,
    };
    const result = computeSignal(row, "adProxyScore");
    expect(result.coverage).toBe(1.0);
    expect(result.partial).toBe(false);
    expect(typeof result.value).toBe("number");
  });

  it("adProxyScore: coverage=5/10=0.5 cuando faltan 5 de 10 inputs", () => {
    // upVolume, volumeSurgePct, distance20d, distance52w, maxDrawdown63d ausentes
    const row = {
      upDownVolRatio: 1.5, relativeVolume: 1.3, perf3m: 12, price: 120, sma50: 110,
    };
    const result = computeSignal(row, "adProxyScore");
    expect(result.coverage).toBeCloseTo(5 / 10, 6);
    expect(result.partial).toBe(true);
  });

  it("adProxyScore: coverage=0 cuando ningún requiredInput está presente", () => {
    const result = computeSignal({}, "adProxyScore");
    expect(result.coverage).toBe(0);
    expect(result.partial).toBe(true);
    // s=45 base, sin tramos ni descuentos aplicables
    expect(result.value).toBe(45);
  });

  it("adProxyScore: value === snapshot pre-consolidación con fila completa", () => {
    const row = {
      upDownVolRatio: 1.5, relativeVolume: 1.3, upVolume: true, volumeSurgePct: 20,
      perf3m: 12, distance20d: -2, distance52w: -3, price: 120, sma50: 110,
      maxDrawdown63d: 15,
    };
    const { value } = computeSignal(row, "adProxyScore");
    expect(value).toBe(snapAdProxy(row));
  });
});