// Verifica docs/duplicados-restantes-2026-08-07.md (rsQualityScore):
//   - mergeUniverseRelativeStrength (camino con snapshot de scan_results) SE
//     UNIFICÓ: ahora delega en la canónica scoreRsQuality en vez de la
//     fórmula .68/.32 paralela.
//   - relativeStrengthFromBars (camino sin snapshot, solo bars) NO se
//     unificó — impedimento real de datos documentado en el propio código.
//     Este test documenta la diferencia esperada en vez de ocultarla.
import { describe, expect, it } from "vitest";
import { scoreRsQuality } from "@/lib/relativeStrength";
import { mergeUniverseRelativeStrength, relativeStrengthFromBars } from "@/app/api/company-brief/route";

describe("rsQualityScore en company-brief", () => {
  it("mergeUniverseRelativeStrength: con ranking semanal, coincide EXACTAMENTE con llamar a la canónica scoreRsQuality con los mismos inputs", () => {
    const benchmarkStrength = {
      rating: 62,
      volatility63d: 30,
      maxDrawdown63d: 14,
      rsStabilityScore: 80,
      speculationRiskScore: 18,
      rsQualityScore: 999, // valor viejo que debe ser reemplazado, no conservado
    };
    const universe = {
      rsGlobalPct: 78,
      rsCountryPct: 60,
      rsSectorPct: 55,
      rsGlobalSample: 500,
      rsCountrySample: 50,
      rsSectorSample: 40,
      riskRewardScore: 55,
      liquidityScore: 60,
      maxDailyMove20dPct: 5,
      range63dPct: 40,
      highsSpreadPct: 4,
      extSma50: 6,
    };

    // El RS base es el del ranking semanal, el único que la ficha enseña.
    // Antes este test pasaba `null` como semanal y la función caía al
    // percentil del lote; ese respaldo ya no existe (ver
    // tests/companyBriefRatingSource.test.js).
    const weeklyGlobal = { latest: { date: "2026-08-09", rsRating: 78, sampleSize: 4868 }, series: [] };
    const result = mergeUniverseRelativeStrength(benchmarkStrength, universe, weeklyGlobal);

    const expected = scoreRsQuality({
      rsGlobalPct: 78,
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

    expect(result.rsQualityScore).toBe(expected.rsQualityScore);
    expect(result.rsStabilityScore).toBe(expected.rsStabilityScore);
    expect(result.speculationRiskScore).toBe(expected.speculationRiskScore);
    expect(result.rsQualityLabel).toBe(expected.rsQualityLabel);
    // Regresión concreta del bug documentado: la fórmula vieja
    // (rating*.68 + stability*.32, sin riskRewardScore) daba
    // clamp(78*.68 + 80*.32) = 78.64. La canónica, con riskRewardScore=55
    // real incluido, da un número distinto.
    const oldFormulaValue = Math.max(0, Math.min(100, 78 * .68 + 80 * .32));
    expect(result.rsQualityScore).not.toBe(oldFormulaValue);
  });

  it("relativeStrengthFromBars: NO delega en la canónica — divergencia esperada y documentada, no oculta (impedimento real: faltan riskRewardScore y varios términos de estabilidad, ver comentario en el código)", () => {
    // 300 barras diarias sintéticas con tendencia suave + benchmark plano.
    const bars = [];
    const benchmarkBars = [];
    const start = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 300; i += 1) {
      const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
      const close = 100 + i * 0.15 + (i % 7 === 0 ? -2 : 0);
      bars.push({ date, close, high: close * 1.01, low: close * 0.99 });
      const benchClose = 200 + i * 0.05;
      benchmarkBars.push({ date, close: benchClose, high: benchClose * 1.005, low: benchClose * 0.995 });
    }

    const result = relativeStrengthFromBars(bars, benchmarkBars);
    expect(Number.isFinite(result.rating)).toBe(true);
    expect(Number.isFinite(result.rsQualityScore)).toBe(true);

    // La canónica, con SOLO rating/volatility/drawdown disponibles (mismos
    // datos que relativeStrengthFromBars sí calcula desde bars) y el resto de
    // términos ausentes, EXCLUYE esos términos y renormaliza — no aplica el
    // peso fijo .68/.32 de la fórmula paralela. Confirmamos que el resultado
    // de hoy (paralela) NO coincide con el de la canónica sobre las mismas
    // entradas parciales: es la divergencia real que el código deja
    // documentada como impedimento, no un descuido silencioso.
    const canonicalWithSameInputs = scoreRsQuality({
      rsGlobalPct: result.rating,
      volatility63d: result.volatility63d,
      maxDrawdown63d: result.maxDrawdown63d,
      // riskRewardScore, maxDailyMove20dPct, range63dPct, highsSpreadPct,
      // extSma50 deliberadamente ausentes: relativeStrengthFromBars no los
      // calcula desde bars (ver comentario STOP en el código fuente).
    });
    expect(result.rsQualityScore).not.toBe(canonicalWithSameInputs.rsQualityScore);
  });
});
