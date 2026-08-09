// El `rating` que enseña la ficha /stock/[symbol] sale de
// mergeUniverseRelativeStrength. Antes venía SIEMPRE del percentil del último
// lote de scan_results (universe.rsGlobalPct), aunque existiera el ranking
// semanal global calculado sobre el universo completo: la ficha llegó a
// mostrar un percentil de mayo sobre 300 símbolos mientras el semanal tenía
// dato de agosto sobre 4.868. Estos tests fijan la prioridad nueva:
// semanal > lote > nada, con la muestra y el ratingSource coherentes.
import { describe, expect, it } from "vitest";
import { scoreRsQuality } from "@/lib/relativeStrength";
import { mergeUniverseRelativeStrength } from "@/app/api/company-brief/route";

const benchmarkStrength = {
  rating: 62,
  volatility63d: 30,
  maxDrawdown63d: 14,
  rsStabilityScore: 80,
  speculationRiskScore: 18,
  rsQualityScore: 999, // valor viejo: debe ser reemplazado cuando hay rating
};

const universe = {
  rsGlobalPct: 41,
  rsCountryPct: 60,
  rsSectorPct: 55,
  rsGlobalSample: 300,
  rsCountrySample: 50,
  rsSectorSample: 40,
  riskRewardScore: 55,
  liquidityScore: 60,
  maxDailyMove20dPct: 5,
  range63dPct: 40,
  highsSpreadPct: 4,
  extSma50: 6,
  asOf: "2026-05-22T00:00:00Z",
};

const weeklyGlobal = {
  series: [
    { date: "2026-08-02", rsRating: 88, sampleSize: 4860 },
    { date: "2026-08-09", rsRating: 91, sampleSize: 4868 },
  ],
  latest: { date: "2026-08-09", rsRating: 91, sampleSize: 4868 },
};

describe("mergeUniverseRelativeStrength: origen del rating", () => {
  it("con ranking semanal disponible, el rating es el semanal y no el percentil del lote", () => {
    const result = mergeUniverseRelativeStrength(benchmarkStrength, universe, weeklyGlobal);

    expect(result.rating).toBe(91);
    expect(result.rating).not.toBe(universe.rsGlobalPct);
    expect(result.ratingSource).toBe("weekly-universe");
    expect(result.rsGlobalSample).toBe(4868);
    expect(result.rsUniverseAvailable).toBe(true);
    // El percentil del lote sigue disponible con su significado propio.
    expect(result.rsGlobalPct).toBe(41);
    expect(result.universe).toBe(universe);
  });

  it("sin semanal pero con snapshot del lote, el rating es el del lote", () => {
    const result = mergeUniverseRelativeStrength(benchmarkStrength, universe, null);

    expect(result.rating).toBe(41);
    expect(result.ratingSource).toBe("scan-batch");
    expect(result.rsGlobalSample).toBe(300);
    expect(result.rsUniverseAvailable).toBe(true);
  });

  it("sin semanal y sin snapshot, el rating es null", () => {
    const result = mergeUniverseRelativeStrength(benchmarkStrength, null, null);

    expect(result.rating).toBe(null);
    expect(result.ratingSource).toBe("universe-missing");
    expect(result.rsGlobalSample).toBe(null);
    expect(result.rsGlobalPct).toBe(null);
    expect(result.rsUniverseAvailable).toBe(false);
    expect(result.universe).toBe(null);
  });

  it("con semanal pero SIN snapshot del lote, el rating sigue siendo el semanal y los campos del lote quedan en null sin romper", () => {
    const result = mergeUniverseRelativeStrength(benchmarkStrength, null, weeklyGlobal);

    expect(result.rating).toBe(91);
    expect(result.ratingSource).toBe("weekly-universe");
    expect(result.rsGlobalSample).toBe(4868);
    expect(result.rsGlobalPct).toBe(null);
    expect(result.rsCountryPct).toBe(null);
    expect(result.rsSectorPct).toBe(null);
    expect(result.rsCountrySample).toBe(null);
    expect(result.rsSectorSample).toBe(null);
    expect(result.universe).toBe(null);
    expect(Number.isFinite(result.rsQualityScore)).toBe(true);
    expect(result.globalRsSeries).toBe(weeklyGlobal.series);
  });

  it("rsQualityScore se calcula sobre el rating que se muestra (semanal), no sobre el percentil del lote", () => {
    const result = mergeUniverseRelativeStrength(benchmarkStrength, universe, weeklyGlobal);

    const conSemanal = scoreRsQuality({
      rsGlobalPct: 91,
      rsRating: benchmarkStrength.rating,
      volatility63d: benchmarkStrength.volatility63d,
      maxDrawdown63d: benchmarkStrength.maxDrawdown63d,
      riskRewardScore: universe.riskRewardScore,
      liquidityScore: universe.liquidityScore,
      maxDailyMove20dPct: universe.maxDailyMove20dPct,
      range63dPct: universe.range63dPct,
      highsSpreadPct: universe.highsSpreadPct,
      extSma50: universe.extSma50,
    });
    const conLote = scoreRsQuality({
      rsGlobalPct: universe.rsGlobalPct,
      rsRating: benchmarkStrength.rating,
      volatility63d: benchmarkStrength.volatility63d,
      maxDrawdown63d: benchmarkStrength.maxDrawdown63d,
      riskRewardScore: universe.riskRewardScore,
      liquidityScore: universe.liquidityScore,
      maxDailyMove20dPct: universe.maxDailyMove20dPct,
      range63dPct: universe.range63dPct,
      highsSpreadPct: universe.highsSpreadPct,
      extSma50: universe.extSma50,
    });

    expect(result.rsQualityScore).toBe(conSemanal.rsQualityScore);
    expect(result.rsQualityScore).not.toBe(conLote.rsQualityScore);
    expect(result.rsQualityLabel).toBe(conSemanal.rsQualityLabel);
    expect(result.speculationRiskScore).toBe(conSemanal.speculationRiskScore);
  });

  it("sin semanal, rsQualityScore se calcula sobre el rating del lote", () => {
    const result = mergeUniverseRelativeStrength(benchmarkStrength, universe, null);

    const esperado = scoreRsQuality({
      rsGlobalPct: universe.rsGlobalPct,
      rsRating: benchmarkStrength.rating,
      volatility63d: benchmarkStrength.volatility63d,
      maxDrawdown63d: benchmarkStrength.maxDrawdown63d,
      riskRewardScore: universe.riskRewardScore,
      liquidityScore: universe.liquidityScore,
      maxDailyMove20dPct: universe.maxDailyMove20dPct,
      range63dPct: universe.range63dPct,
      highsSpreadPct: universe.highsSpreadPct,
      extSma50: universe.extSma50,
    });

    expect(result.rsQualityScore).toBe(esperado.rsQualityScore);
  });
});
