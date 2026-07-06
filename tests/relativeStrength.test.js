// Tests de lib/relativeStrength.js — verifican que el call site de scoreRelativeStrength
// hacia scoreRsBenchmarkModel ya incluye los inputs rs1m y perf1m (peso .10 cada uno).
// Antes del fix, el call site omitía ambos términos y ~7% del score se perdía en silencio.
// Tras el fix, los scores reaccionan al signo del input 1m, subiendo o bajando de forma
// coherente.
import { describe, expect, it } from "vitest";
import { perf } from "@/lib/indicators";
import { scoreRelativeStrength, scoreRsBenchmarkModel } from "@/lib/relativeStrength";

// Mismo generador que tests/fixtures.js, sin tocar esa firma pública.
function buildBars({ count, startClose, dailyDrift }) {
  const dates = [];
  const cursor = new Date();
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() - 1);
  }
  const bars = [];
  for (let i = 0; i < count; i++) {
    const t = count - 1 - i;
    const close = startClose + dailyDrift * t;
    bars.push({ date: dates[i], close });
  }
  return bars;
}

function rowFromBars(bars) {
  const closes = bars.map((b) => b.close);
  const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const sma = (n, off = 0) => avg(closes.slice(off, off + n));
  const s50 = sma(50);
  const s200 = sma(200);
  const s200Prev = sma(200, 30);
  const last252 = closes.slice(0, 252);
  const distance52w = last252.length === 252 ? ((closes[0] / Math.max(...last252)) - 1) * 100 : null;
  return {
    price: closes[0],
    sma50: s50,
    sma200: s200,
    sma200Slope: Number.isFinite(s200) && Number.isFinite(s200Prev) && s200Prev !== 0 ? ((s200 / s200Prev) - 1) * 100 : null,
    distance52w,
    perf1m: perf(bars, 21),
    perf3m: perf(bars, 63),
    perf6m: perf(bars, 126),
    perf12m: perf(bars, 252),
  };
}

describe("scoreRelativeStrength · horizonte 1m cableado al call site", () => {
  it("exposición del horizonte 1m en el retorno (rs1m, benchmarkPerf1m)", () => {
    const bars = buildBars({ count: 320, startClose: 50, dailyDrift: 0.31 });
    const bench = buildBars({ count: 320, startClose: 100, dailyDrift: 0.05 });
    const result = scoreRelativeStrength(rowFromBars(bars), bench);
    // Antes del fix: result no contenía rs1m ni benchmarkPerf1m (undefined).
    expect(Number.isFinite(result.rs1m)).toBe(true);
    expect(Number.isFinite(result.benchmarkPerf1m)).toBe(true);
    // Serie claramente más fuerte que el benchmark en 1m.
    expect(result.rs1m).toBeGreaterThan(0);
  });

  it("rsRating post-fix difiere del rsRating pre-fix equivalente (con rs1m/perf1m anulados)", () => {
    // Verificación end-to-end del call site sin espías: comparamos el rsRating real
    // (que es el del call site actual) contra el rsRating que resultaría si el input
    // a scoreRsBenchmarkModel se hubiera construido sin rs1m/perf1m, usando los mismos
    // datos técnicos. Antes del fix ambos coincidían exactamente. Tras el fix difieren.
    const fixtures = [
      { name: "alcista débil",  bars: buildBars({ count: 320, startClose: 50, dailyDrift: 0.31 }), bench: buildBars({ count: 320, startClose: 100, dailyDrift: 0.05 }) },
      { name: "alcista fuerte", bars: buildBars({ count: 320, startClose: 50, dailyDrift: 0.60 }), bench: buildBars({ count: 320, startClose: 100, dailyDrift: 0.10 }) },
      { name: "bajista",        bars: buildBars({ count: 320, startClose: 150, dailyDrift: -0.31 }), bench: buildBars({ count: 320, startClose: 100, dailyDrift: 0.05 }) },
    ];
    for (const fx of fixtures) {
      const row = rowFromBars(fx.bars);
      const result = scoreRelativeStrength(row, fx.bench);

      // Construimos el rating "pre-fix" como si el call site NO hubiera incluido 1m.
      const preFixScore = scoreRsBenchmarkModel({
        rs3m: result.rs3m,
        rs6m: result.rs6m,
        rs12m: result.rs12m,
        perf3m: row.perf3m,
        perf6m: row.perf6m,
        perf12m: row.perf12m,
        price: row.price,
        sma50: row.sma50,
        sma200: row.sma200,
        sma200Slope: row.sma200Slope,
        distance52w: row.distance52w,
      });
      const preFixRating = Number.isFinite(preFixScore)
        ? Math.round(Math.max(1, Math.min(99, preFixScore)))
        : null;

      // El contrato: tras el fix los rsRating son diferentes. Si el call site siguiera
      // omitiendo rs1m/perf1m, ambos ratings coincidirían y este assert fallaría.
      expect(Number.isFinite(result.rsRating)).toBe(true);
      expect(result.rsRating).not.toBe(preFixRating);
    }
  });

  it("dirección coherente con el signo de rs1m/perf1m en zona no saturada", () => {
    // Validación del modelo: con rs3m/rs6m/rs12m neutros (scoreFromEdge ≈ 50),
    // rs1m y perf1m dominados por sus signos deciden la dirección de forma predecible.
    // Esto comprueba que el input 1m tiene peso real en el resultado.
    const base = {
      price: 100, sma50: 100, sma200: 100, sma200Slope: 0, distance52w: -3,
      rs3m: 0, rs6m: 0, rs12m: 0,
      perf3m: 0, perf6m: 0, perf12m: 0,
    };
    const positive = scoreRsBenchmarkModel({ ...base, rs1m: 5, perf1m: 5 });
    const neutral = scoreRsBenchmarkModel({ ...base, rs1m: 0, perf1m: 0 });
    const negative = scoreRsBenchmarkModel({ ...base, rs1m: -5, perf1m: -5 });
    // Signos opuestos: positivo > neutral > negativo.
    expect(positive).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(negative);
    // Delta material (≥ 0.5 puntos): descarta ruido numérico de redondeo.
    expect(positive - neutral).toBeGreaterThan(0.5);
    expect(neutral - negative).toBeGreaterThan(0.5);
  });
});
