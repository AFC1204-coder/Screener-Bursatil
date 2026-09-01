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

describe("setupPatternForBars unified bridge", () => {
  it("flag OFF no cambia vcpCandidate vs legacy en fixture mínimo", () => {
    const bars = Array.from({ length: 120 }, (_, i) => ({
      date: `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
      open: 50 + (i % 5),
      high: 52 + (i % 5),
      low: 48 + (i % 5),
      close: 50 + (i % 3),
      volume: 800_000 + i * 1000,
    })).reverse();

    const legacy = setupPatternForBars(bars, { rawBars: bars });
    const explicitOff = setupPatternForBars(bars, { rawBars: bars, vcpUnified: false });
    expect(explicitOff.vcpCandidate).toBe(legacy.vcpCandidate);
    expect(explicitOff.patternFamily).toBe(legacy.patternFamily);
  });

  it("failedBreakout no bloquea si unified propone VCP", () => {
    const bars = Array.from({ length: 120 }, (_, i) => ({
      date: `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
      open: 50,
      high: 55,
      low: 49,
      close: 50,
      volume: 1_000_000,
    })).reverse();
    bars[0].high = 60;
    bars[0].close = 49;
    bars[0].volume = 2_000_000;

    const pattern = setupPatternForBars(bars, {
      rawBars: bars,
      vcpUnified: true,
      weeklyStage: { state: "stage2", label: "Etapa 2" },
      weeklyStageStructure: { structure: "n/a", distResistancePct: -2 },
    });
    if (pattern.vcpCandidate) {
      expect(pattern.patternFamily).not.toBe("failed_breakout");
    }
  });
});

describe("detectV7 parity with research re-export", () => {
  it("exporta detectV7 desde research v7.mjs", async () => {
    const research = await import("../research/contracciones/detector/v7.mjs");
    expect(typeof research.detectV7).toBe("function");
    expect(research.detectV7).toBe(detectV7);
  });
});
