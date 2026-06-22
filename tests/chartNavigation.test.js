import { describe, expect, it } from "vitest";
import { chartViewStateFromLogicalRange, latestLogicalRange, manualChartWindowRestorePolicy, rescaledLogicalRange, shiftedLogicalRange, timeWindowFromLogicalRange, timeWindowLogicalRange, zoomedLogicalRange } from "@/lib/chartNavigation";

describe("chart navigation helpers", () => {
  it("detecta zoom anclado al último dato por rango lógico", () => {
    const state = chartViewStateFromLogicalRange({ from: 120, to: 199.6 }, 200);

    expect(state.key).toBe("zoom");
    expect(state.isAwayFromLatest).toBe(false);
    expect(state.isZoomed).toBe(true);
    expect(state.isManual).toBe(true);
    expect(state.visibleBars).toBe(80);
    expect(state.canPanLeft).toBe(true);
    expect(state.canPanRight).toBe(false);
    expect(state.label).toBe("Zoom");
  });

  it("detecta vista completa en último dato cuando todo el rango está visible", () => {
    const state = chartViewStateFromLogicalRange({ from: -0.5, to: 199.5 }, 200);

    expect(state.key).toBe("latest");
    expect(state.isManual).toBe(false);
    expect(state.visibleBars).toBe(200);
    expect(state.canPanLeft).toBe(false);
    expect(state.canPanRight).toBe(false);
  });

  it("detecta exploración histórica aunque el rango temporal sea válido", () => {
    const state = chartViewStateFromLogicalRange({ from: 30, to: 120 }, 200);

    expect(state.key).toBe("history");
    expect(state.isAwayFromLatest).toBe(true);
    expect(state.isManual).toBe(true);
    expect(state.canPanLeft).toBe(true);
    expect(state.canPanRight).toBe(true);
    expect(state.distanceFromLatest).toBe(79);
    expect(state.detail).toContain("79");
  });

  it("construye un salto al último dato conservando el zoom actual", () => {
    const nextRange = latestLogicalRange({
      rowCount: 200,
      currentRange: { from: 20, to: 70 },
      fallbackSpan: 90,
    });

    expect(nextRange).toEqual({ from: 149.5, to: 199.5 });
  });

  it("acerca la vista conservando anclaje al último dato", () => {
    const nextRange = zoomedLogicalRange({
      rowCount: 200,
      currentRange: { from: 99.5, to: 199.5 },
      factor: 0.5,
      anchorLatest: true,
    });

    expect(nextRange).toEqual({ from: 149.5, to: 199.5 });
  });

  it("aleja la vista histórica desde su centro y dentro de límites", () => {
    const nextRange = zoomedLogicalRange({
      rowCount: 200,
      currentRange: { from: 40, to: 80 },
      factor: 2,
    });

    expect(nextRange).toEqual({ from: 20, to: 100 });
  });

  it("usa fallback cuando no hay rango visible actual", () => {
    const nextRange = latestLogicalRange({ rowCount: 40, currentRange: null, fallbackSpan: 90 });

    expect(nextRange).toEqual({ from: -0.5, to: 39.5 });
  });

  it("mueve la ventana hacia historial conservando el zoom", () => {
    const nextRange = shiftedLogicalRange({
      rowCount: 200,
      currentRange: { from: 149.5, to: 199.5 },
      direction: -1,
      stepRatio: 0.5,
    });

    expect(nextRange).toEqual({ from: 124.5, to: 174.5 });
  });

  it("limita el desplazamiento hacia el último dato", () => {
    const nextRange = shiftedLogicalRange({
      rowCount: 200,
      currentRange: { from: 170, to: 220 },
      direction: 1,
      stepRatio: 0.5,
    });

    expect(nextRange).toEqual({ from: 149.5, to: 199.5 });
  });

  it("reescalada un zoom manual cuando cambia el número de barras", () => {
    const nextRange = rescaledLogicalRange({
      previousRowCount: 96,
      nextRowCount: 25,
      previousRange: { from: 26.5, to: 95.5 },
      minSpan: 8,
    });

    expect(nextRange.from).toBeCloseTo(6.53, 2);
    expect(nextRange.to).toBeCloseTo(24.5, 2);
  });

  it("preserva distancia al último dato al reescalar una ventana histórica", () => {
    const nextRange = rescaledLogicalRange({
      previousRowCount: 96,
      nextRowCount: 25,
      previousRange: { from: 0, to: 69 },
      minSpan: 8,
    });

    expect(nextRange.from).toBeCloseTo(-0.37, 2);
    expect(nextRange.to).toBeCloseTo(17.6, 2);
  });

  it("convierte una ventana temporal en rango lógico para preservar contexto al cambiar temporalidad", () => {
    const rowTimes = Array.from({ length: 20 }, (_, index) => 1000 + index * 100);
    const nextRange = timeWindowLogicalRange({
      rowTimes,
      timeRange: { from: 1500, to: 1900 },
      minSpan: 4,
    });

    expect(nextRange).toEqual({ from: 4.5, to: 9.5 });
  });

  it("ignora ventanas temporales sin solape con los datos actuales", () => {
    const rowTimes = Array.from({ length: 20 }, (_, index) => 1000 + index * 100);

    expect(timeWindowLogicalRange({ rowTimes, timeRange: { from: 10, to: 20 } })).toBeNull();
  });

  it("deriva una ventana temporal estable desde el rango lógico visible", () => {
    const rowTimes = Array.from({ length: 10 }, (_, index) => 1000 + index * 100);
    const window = timeWindowFromLogicalRange({
      rowTimes,
      logicalRange: { from: 2.25, to: 6.75 },
    });

    expect(window).toEqual({ from: 1300, to: 1600 });
  });

  it("recorta la ventana temporal derivada cuando el rango lógico toca bordes", () => {
    const rowTimes = Array.from({ length: 10 }, (_, index) => 1000 + index * 100);

    expect(timeWindowFromLogicalRange({
      rowTimes,
      logicalRange: { from: -0.5, to: 99.5 },
    })).toEqual({ from: 1000, to: 1900 });
  });

  it("preserva una ventana manual al cambiar de intervalo en el mismo ticker", () => {
    const policy = manualChartWindowRestorePolicy({
      previousMeta: { ready: true, symbol: "ASML", range: "1A", interval: "D", style: "1", scale: "price" },
      nextMeta: { ready: true, symbol: "ASML", range: "1A", interval: "W", style: "1", scale: "price" },
      viewState: { isManual: true },
      visibleTimeRange: { from: 1710000000, to: 1720000000 },
    });

    expect(policy).toEqual({ restore: true, reason: "interval-change" });
  });

  it("preserva una ventana manual al cambiar rango, estilo o escala", () => {
    const base = {
      previousMeta: { ready: true, symbol: "ASML", range: "1A", interval: "D", style: "1", scale: "price" },
      viewState: { isManual: true },
      visibleTimeRange: { from: 1710000000, to: 1720000000 },
    };

    expect(manualChartWindowRestorePolicy({
      ...base,
      nextMeta: { ready: true, symbol: "ASML", range: "5A", interval: "D", style: "1", scale: "price" },
    })).toEqual({ restore: true, reason: "range-change" });

    expect(manualChartWindowRestorePolicy({
      ...base,
      nextMeta: { ready: true, symbol: "ASML", range: "1A", interval: "D", style: "8", scale: "price" },
    })).toEqual({ restore: true, reason: "style-change" });

    expect(manualChartWindowRestorePolicy({
      ...base,
      nextMeta: { ready: true, symbol: "ASML", range: "1A", interval: "D", style: "1", scale: "log" },
    })).toEqual({ restore: true, reason: "scale-change" });
  });

  it("resetea la ventana al cambiar de ticker o cuando la vista no era manual", () => {
    const previousMeta = { ready: true, symbol: "ASML", range: "1A", interval: "D", style: "1", scale: "price" };
    const visibleTimeRange = { from: 1710000000, to: 1720000000 };

    expect(manualChartWindowRestorePolicy({
      previousMeta,
      nextMeta: { ...previousMeta, symbol: "NVDA" },
      viewState: { isManual: true },
      visibleTimeRange,
    })).toEqual({ restore: false, reason: "symbol-change" });

    expect(manualChartWindowRestorePolicy({
      previousMeta,
      nextMeta: { ...previousMeta, interval: "W" },
      viewState: { isManual: false },
      visibleTimeRange,
    })).toEqual({ restore: false, reason: "automatic-view" });
  });

  it("no restaura si todavia no hay render previo o falta ventana temporal valida", () => {
    const meta = { ready: true, symbol: "ASML", range: "1A", interval: "D", style: "1", scale: "price" };

    expect(manualChartWindowRestorePolicy({
      previousMeta: { ...meta, ready: false },
      nextMeta: { ...meta, interval: "W" },
      viewState: { isManual: true },
      visibleTimeRange: { from: 1710000000, to: 1720000000 },
    })).toEqual({ restore: false, reason: "first-render" });

    expect(manualChartWindowRestorePolicy({
      previousMeta: meta,
      nextMeta: { ...meta, interval: "W" },
      viewState: { isManual: true },
      visibleTimeRange: { from: 1710000000, to: 1710000000 },
    })).toEqual({ restore: false, reason: "missing-time-window" });
  });
});
