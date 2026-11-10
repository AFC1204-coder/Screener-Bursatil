import { describe, expect, it, afterEach } from "vitest";
import { setupPatternForBars } from "@/lib/setupPatterns";
import {
  detectV7,
  evaluateShadowGates,
  evaluateUnifiedVcpFromDailyBars,
  gateG1,
  gateG3,
  isVcpUnifiedEnabled,
} from "@/lib/vcpEngine";
import { STRUCTURE_E2_MA_ONLY } from "@/lib/weeklyStageStructure";

describe("isVcpUnifiedEnabled", () => {
  const prev = process.env.STATSEDGE_VCP_UNIFIED;

  afterEach(() => {
    if (prev === undefined) delete process.env.STATSEDGE_VCP_UNIFIED;
    else process.env.STATSEDGE_VCP_UNIFIED = prev;
  });

  it("OFF por defecto", () => {
    delete process.env.STATSEDGE_VCP_UNIFIED;
    expect(isVcpUnifiedEnabled()).toBe(false);
    expect(isVcpUnifiedEnabled({})).toBe(false);
  });

  it("ON con env o option", () => {
    process.env.STATSEDGE_VCP_UNIFIED = "1";
    expect(isVcpUnifiedEnabled()).toBe(true);
    delete process.env.STATSEDGE_VCP_UNIFIED;
    expect(isVcpUnifiedEnabled({ vcpUnified: true })).toBe(true);
  });
});

describe("evaluateUnifiedVcpFromDailyBars", () => {
  it("rechaza sin barras suficientes", () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1_000_000,
    })).reverse();
    const out = evaluateUnifiedVcpFromDailyBars(bars, { stage: "stage2", structure: "n/a" });
    expect(out.vcpCandidate).toBe(false);
    expect(out.v7.base).toBe(false);
  });

  it("G1 bloquea E3", () => {
    const shadow = evaluateShadowGates({
      detectorHit: true,
      stage: "stage3",
      structure: "n/a",
      distResistancePct: -2,
      metrics: {
        primeraEnAtr: 4,
        primeraEnAtrVentana: 4,
        ultimaEnAtr: 2,
        tightRatio: 0.5,
        episodeBars: 40,
        contractionCount: 3,
      },
    });
    expect(shadow.propuestaProducto).toBe(false);
    expect(gateG1("stage3", "n/a", 2).pass).toBe(false);
  });

  it("G3 bloquea primera superficial", () => {
    expect(gateG3({
      primeraEnAtr: 2.5,
      primeraEnAtrVentana: 2.5,
      ultimaEnAtr: 1.5,
      tightRatio: 0.5,
      episodeBars: 30,
    }).pass).toBe(false);
  });

  it("MSI-like E2_ma_only sin pata tight queda fuera", () => {
    const shadow = evaluateShadowGates({
      detectorHit: true,
      stage: "stage2",
      structure: STRUCTURE_E2_MA_ONLY,
      distResistancePct: -1.5,
      metrics: {
        primeraEnAtr: 4,
        primeraEnAtrVentana: 4,
        ultimaEnAtr: 3.5,
        tightRatio: 0.8,
        episodeBars: 90,
        contractionCount: 3,
      },
    });
    expect(shadow.propuestaProducto).toBe(false);
  });
});

// Serie sintética pero REAL para el motor: 260 sesiones de avance (40→100) y una base con tres
// contracciones decrecientes (≈20 %, 11 %, 5 %) y volumen que se seca. Fechas laborables
// distintas y `referenceDate` fija: las barras con fechas repetidas o «viejas» caían en la
// puerta de datos (`insufficient_data`) y los tests de abajo comparaban resultados degenerados.
function weekdaysAscending(n) {
  const out = [];
  const d = new Date(Date.UTC(2026, 9, 30));
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}
const leg = (from, to, n) => Array.from({ length: n }, (_, i) => from + (to - from) * ((i + 1) / n));
function vcpSeriesDesc({ failedBreakout = false } = {}) {
  const closes = [
    ...leg(40, 100, 260), ...leg(100, 82, 16), ...leg(82, 98, 12),
    ...leg(98, 89, 10), ...leg(89, 99, 9), ...leg(99, 96, 7), ...leg(96, 98.5, 7),
  ];
  const dates = weekdaysAscending(closes.length);
  const bars = closes.map((c, i) => ({
    date: dates[i], open: c, high: c * 1.012, low: c * 0.988, close: c,
    volume: i < 260 ? 1_500_000 : 1_500_000 - (i - 260) * 14_000,
  }));
  if (failedBreakout) {
    const n = bars.length;
    bars[n - 3] = { ...bars[n - 3], high: 103.5, close: 101 };          // supera el pivote…
    bars[n - 1] = { ...bars[n - 1], close: 99, high: 99.6, volume: 1_900_000 }; // …y vuelve por debajo con volumen
  }
  return bars.reverse();
}
const REF = "2026-11-02";
const STAGE2 = { weeklyStage: { state: "stage2", label: "Etapa 2" }, weeklyStageStructure: { structure: "n/a", distResistancePct: -2 } };

describe("setupPatternForBars unified bridge", () => {
  it("la serie de prueba es analizable y el motor unificado la reconoce (no es un caso degenerado)", () => {
    const bars = vcpSeriesDesc();
    const out = setupPatternForBars(bars, { rawBars: bars, referenceDate: REF, vcpUnified: true, ...STAGE2 });
    expect(out.patternFamily).not.toBe("insufficient_data");
    expect(out.vcpCandidate).toBe(true);
    expect(out.pivotSource).toBe("ultima_contraccion");
  });

  it("flag OFF == comportamiento heredado, y el flag solo cambia el pivote", () => {
    const bars = vcpSeriesDesc();
    const base = { rawBars: bars, referenceDate: REF };
    const legacy = setupPatternForBars(bars, base);
    const explicitOff = setupPatternForBars(bars, { ...base, vcpUnified: false });
    const on = setupPatternForBars(bars, { ...base, vcpUnified: true, ...STAGE2 });
    for (const field of ["vcpCandidate", "patternFamily", "pivotPrice", "pivotSource"]) {
      expect(explicitOff[field]).toEqual(legacy[field]);
    }
    expect(legacy.patternFamily).not.toBe("insufficient_data");
    expect(legacy.pivotSource).toBe("maximo_65s");
    expect(on.pivotPrice).toBeLessThan(legacy.pivotPrice);
  });

  it("failedBreakout no bloquea si unified propone VCP", () => {
    const bars = vcpSeriesDesc({ failedBreakout: true });
    const pattern = setupPatternForBars(bars, { rawBars: bars, referenceDate: REF, vcpUnified: true, ...STAGE2 });
    expect(pattern.failedBreakout).toBe(true);
    expect(pattern.vcpCandidate).toBe(true);
    expect(pattern.patternFamily).not.toBe("failed_breakout");
    expect(pattern.patternFamily).toBe("progressive_contraction");
  });
});

describe("detectV7 parity with research re-export", () => {
  it("exporta detectV7 desde research v7.mjs", async () => {
    const research = await import("../research/contracciones/detector/v7.mjs");
    expect(typeof research.detectV7).toBe("function");
    expect(research.detectV7).toBe(detectV7);
  });
});
