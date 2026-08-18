// tests/stockVolume.test.js — el estado del volumen de un valor individual
// a partir de la ficha. Lo que el briefing (C.3 #5) dice publicar en la
// ficha: reparto up/down (50d), volumen seco (10d/50d), e impulso de
// volumen (5d/20d). Las funciones son puras: setupPattern + barras → KPIs.
import { describe, expect, it } from "vitest";
import {
  averageVolume,
  stockVolumeFactLine,
  stockVolumeState,
  STOCK_VOLUME_WINDOWS,
} from "@/lib/stockVolume";

function makeBars(count, plainVolume = 1_000_000) {
  const bars = [];
  // Bars descendentes (más reciente primero) — contrato del módulo.
  for (let i = 0; i < count; i += 1) {
    bars.push({
      date: `2026-08-${String(14 - i).padStart(2, "0")}`,
      close: 100 + i,
      volume: plainVolume + i * 1000,
    });
  }
  return bars;
}

describe("averageVolume", () => {
  it("calcula la media de las últimas N barras en orden descendente", () => {
    const bars = makeBars(20, 1_000_000);
    expect(averageVolume(bars, 20)).toBeCloseTo(1_009_500, 0);
  });

  it("devuelve null si la serie es más corta que N", () => {
    expect(averageVolume(makeBars(5), 20)).toBe(null);
  });

  it("tolera barras en orden ascendente (algunos callers)", () => {
    const bars = makeBars(20, 1_000_000).slice().reverse();
    expect(averageVolume(bars, 20)).toBeCloseTo(1_009_500, 0);
  });

  it("ignora valores no finitos al promediar", () => {
    const bars = makeBars(20, 1_000_000);
    bars[0].volume = null;
    bars[1].volume = "NaN";
    // Las 18 barras restantes (índices 2..19) tienen volumen 1_002_000,
    // 1_003_000, ..., 1_019_000. Media: 1_000_000 + (2+19)*18/2 * 1000/18
    // = 1_000_000 + 10.5 * 1000 = 1_010_500.
    expect(averageVolume(bars, 20)).toBeCloseTo(1_010_500, 0);
  });
});

describe("stockVolumeState", () => {
  it("rellena los tres KPIs del briefing cuando setupPattern trae los datos", () => {
    const state = stockVolumeState({
      setupPattern: {
        upDownVolRatio: 1.6,
        volumeDryUpRatio: 0.85,
        volumeSurgePct: 22.5,
        avgVolume5: 1_100_000,
        avgVolume50: 1_000_000,
        latestVolume: 1_200_000,
        latestVolumeRatio: 1.2,
      },
      bars: makeBars(25, 1_000_000),
      scanVolume: { upDownVolRatio: 1.6 },
    });
    expect(state.upDownVolumeRatio.available).toBe(true);
    expect(state.upDownVolumeRatio.value).toBe(1.6);
    expect(state.volumeDryUp.available).toBe(true);
    expect(state.volumeDryUp.value).toBe(0.85);
    expect(state.volumeSurge.available).toBe(true);
    expect(state.volumeSurge.value).toBe(22.5);
    expect(state.relativeVolume.available).toBe(true);
    expect(state.relativeVolume.value).toBe(1.2);
  });

  it("calcula el impulso de volumen localmente si setupPattern no lo trae", () => {
    const state = stockVolumeState({
      setupPattern: {
        upDownVolRatio: 1.0,
        volumeDryUpRatio: 1.0,
        avgVolume5: 1_200_000,
        avgVolume50: 1_000_000,
      },
      bars: makeBars(25, 1_000_000), // media 20d ≈ 1_009_500
    });
    expect(state.volumeSurge.available).toBe(true);
    // (1_200_000 / 1_009_500 − 1) × 100 ≈ 18.87
    expect(state.volumeSurge.value).toBeGreaterThan(15);
    expect(state.volumeSurge.value).toBeLessThan(20);
  });

  it("declara ausente cada KPI cuyo dato no es finito", () => {
    const state = stockVolumeState({ setupPattern: {}, bars: [] });
    expect(state.upDownVolumeRatio.available).toBe(false);
    expect(state.upDownVolumeRatio.reason).toContain("reparto del volumen");
    expect(state.volumeDryUp.available).toBe(false);
    expect(state.volumeDryUp.reason).toContain("volumen seco");
    expect(state.volumeSurge.available).toBe(false);
    expect(state.volumeSurge.reason).toContain("impulso de volumen");
  });

  it("las etiquetas de ventana siguen los valores del briefing", () => {
    const state = stockVolumeState({
      setupPattern: { upDownVolRatio: 1.0, volumeDryUpRatio: 1.0, volumeSurgePct: 0 },
    });
    expect(state.upDownVolumeRatio.window).toBe(STOCK_VOLUME_WINDOWS.upDown);
    expect(state.volumeDryUp.window).toBe(`${STOCK_VOLUME_WINDOWS.dryUpShort} vs ${STOCK_VOLUME_WINDOWS.dryUpLong}`);
    expect(state.volumeSurge.window).toBe(`${STOCK_VOLUME_WINDOWS.surgeShort} vs ${STOCK_VOLUME_WINDOWS.surgeLong}`);
  });
});

describe("stockVolumeFactLine", () => {
  it("compone la línea de hecho con los tres KPIs disponibles", () => {
    const state = stockVolumeState({
      setupPattern: {
        upDownVolRatio: 1.4,
        volumeDryUpRatio: 0.8,
        volumeSurgePct: 18,
      },
    });
    const line = stockVolumeFactLine(state);
    expect(line).toContain("reparto del volumen a 50 sesiones: 1.40×");
    expect(line).toContain("volumen seco (10d/50d): 0.80×");
    expect(line).toContain("impulso de volumen (5d/20d): +18.00%");
  });

  it("devuelve null si ningún KPI está disponible", () => {
    expect(stockVolumeFactLine(stockVolumeState({ setupPattern: {} }))).toBe(null);
  });
});
