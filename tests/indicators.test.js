// Tests de lib/indicators.js sobre las series sintéticas de tests/fixtures.js.
// Valores esperados calculados una vez sobre las fixtures deterministas y documentados aquí:
// la serie stage 2 sube ~+0.31/día (50 → ~148.2) y la stage 4 baja simétricamente (150 → ~50.4).
import { describe, expect, it } from "vitest";
import {
  annualizedVolatility,
  avgVolume,
  dailyReturns,
  downsideVolatility,
  highDist,
  hiLo,
  lowAdv,
  maxDrawdown,
  perf,
  sma,
  stdev,
  udVol,
} from "@/lib/indicators";
import { stage2Bars, stage4Bars, shortHistoryBars } from "./fixtures.js";

const stage2 = stage2Bars();
const stage4 = stage4Bars();
const short = shortHistoryBars();

describe("indicators · serie stage 2 (alcista)", () => {
  it("medias móviles apiladas: precio > SMA50 > SMA150 > SMA200 y SMA200 ascendente", () => {
    expect(stage2[0].close).toBeCloseTo(148.1962, 3);
    expect(sma(stage2, 50)).toBeCloseTo(141.1825, 3);
    expect(sma(stage2, 150)).toBeCloseTo(125.7964, 3);
    expect(sma(stage2, 200)).toBeCloseTo(118.0114, 3);
    // SMA200 desplazada 30 sesiones queda por debajo → pendiente positiva.
    expect(sma(stage2, 200, 30)).toBeCloseTo(108.759, 3);
  });
  it("rendimientos positivos a 3/6/12 meses", () => {
    expect(perf(stage2, 63)).toBeCloseTo(15.2137, 3);
    expect(perf(stage2, 126)).toBeCloseTo(33.1187, 3);
    expect(perf(stage2, 252)).toBeCloseTo(110.9054, 3);
  });
  it("cerca de máximos y lejos de mínimos de 52 semanas", () => {
    expect(highDist(stage2, 252)).toBeCloseTo(-0.9901, 3);
    expect(lowAdv(stage2, 252)).toBeCloseTo(113.4794, 3);
    const { hi, lo } = hiLo(stage2, 252);
    expect(hi).toBeGreaterThan(lo);
  });
  it("volatilidad y drawdown bajos en tendencia limpia", () => {
    expect(stdev(dailyReturns(stage2, 63))).toBeCloseTo(0.0025, 5);
    expect(annualizedVolatility(stage2)).toBeCloseTo(3.9691, 3);
    expect(downsideVolatility(stage2)).toBeLessThan(annualizedVolatility(stage2));
    expect(maxDrawdown(stage2)).toBeCloseTo(0.4935, 3);
  });
  it("volumen comprador dominante (udVol > 1) y volumen medio estable", () => {
    expect(udVol(stage2, 50)).toBeCloseTo(1.9362, 3);
    expect(avgVolume(stage2.slice(0, 20))).toBe(1145000);
  });
});

describe("indicators · serie stage 4 (bajista)", () => {
  it("medias móviles invertidas: precio < SMA50 < SMA150 < SMA200 y SMA200 descendente", () => {
    expect(stage4[0].close).toBeCloseTo(50.4162, 3);
    expect(sma(stage4, 50)).toBeCloseTo(58.5925, 3);
    expect(sma(stage4, 150)).toBeCloseTo(74.2064, 3);
    expect(sma(stage4, 200)).toBeCloseTo(81.9214, 3);
    expect(sma(stage4, 200, 30)).toBeCloseTo(91.269, 3);
  });
  it("rendimientos negativos y lejos de máximos", () => {
    expect(perf(stage4, 63)).toBeCloseTo(-27.8813, 3);
    expect(perf(stage4, 252)).toBeCloseTo(-60.8347, 3);
    expect(highDist(stage4, 252)).toBeCloseTo(-60.9968, 3);
    expect(lowAdv(stage4, 252)).toBeCloseTo(1.1846, 3);
  });
  it("drawdown alto y volumen vendedor dominante (udVol < 1)", () => {
    expect(maxDrawdown(stage4)).toBeCloseTo(27.2797, 3);
    expect(annualizedVolatility(stage4)).toBeCloseTo(9.1651, 3);
    expect(udVol(stage4, 50)).toBeCloseTo(0.2789, 3);
  });
});

describe("indicators · casos límite", () => {
  it("sma devuelve null si no hay barras suficientes", () => {
    expect(sma(short, 50)).toBeNull();
    expect(sma(short, 15)).not.toBeNull();
  });
  it("stdev devuelve null con menos de 2 valores finitos", () => {
    expect(stdev([])).toBeNull();
    expect(stdev([1])).toBeNull();
    expect(stdev([null, undefined, 3])).toBeNull();
  });
  it("perf devuelve null sin histórico suficiente", () => {
    expect(perf(short, 63)).toBeNull();
  });
});
