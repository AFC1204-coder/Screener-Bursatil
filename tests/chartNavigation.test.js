import { describe, expect, it } from "vitest";
import { chartViewStateFromLogicalRange, hasLeftWhitespaceLogicalRange, latestLogicalRange, shiftedLogicalRange, timeWindowFromLogicalRange, timeWindowLogicalRange, zoomedLogicalRange } from "@/lib/chartNavigation";

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

  it("hasLeftWhitespaceLogicalRange detecta whitespace sin clasificar como manual por zoom", () => {
    const state = chartViewStateFromLogicalRange({ from: -30, to: 199.5 }, 200);

    expect(state.isManual).toBe(false);
    expect(state.key).toBe("latest");
    expect(hasLeftWhitespaceLogicalRange({ from: -30, to: 199.5 })).toBe(true);
    expect(hasLeftWhitespaceLogicalRange({ from: -0.5, to: 199.5 })).toBe(false);
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

  // La política de restauración heurística (`manualChartWindowRestorePolicy`)
  // y `rescaledLogicalRange` se eliminaron con la inversión del contrato de
  // ventana (docs/analisis-grafico-2026-08-14.md, C.1). La desviación manual
  // es ahora estado explícito del lifecycle y su preservación/reset se cubre
  // en `tests/chartViewport.test.js`.
});
