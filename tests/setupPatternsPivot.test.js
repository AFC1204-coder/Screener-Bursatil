import { describe, expect, it, vi } from "vitest";

// El pivote del VCP es el máximo local de la última contracción (decisión del dueño,
// 2026-11-10), no el máximo de 65 sesiones. Se simula el motor para aislar la regla.
const engine = vi.hoisted(() => ({ result: null }));
vi.mock("@/lib/vcpEngine", () => ({
  isVcpUnifiedEnabled: (options = {}) => options.vcpUnified !== false,
  evaluateUnifiedVcpFromDailyBars: () => engine.result,
}));

import { setupPatternForBars } from "../lib/setupPatterns.js";

// Barras descendentes (la más reciente primero): máximo de 65 sesiones = 120, cierre 100.
function barsDesc(n = 120) {
  return Array.from({ length: n }, (_, i) => {
    const high = i === 40 ? 120 : 101;
    return { date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}-${i}`, open: 99, high, low: 98, close: 100, volume: 1_000_000 };
  });
}

describe("pivote del VCP", () => {
  it("usa el máximo de la última contracción cuando el motor detecta VCP", () => {
    engine.result = { vcpCandidate: true, v7: { base: true, pivote: 104.5, contracciones: [12, 6] }, shadow: {}, metrics: {} };
    const out = setupPatternForBars(barsDesc());
    expect(out.pivotPrice).toBe(104.5);
    expect(out.pivotSource).toBe("ultima_contraccion");
  });

  it("sin VCP detectado mantiene el máximo de 65 sesiones", () => {
    engine.result = { vcpCandidate: false, v7: { base: false }, shadow: {}, metrics: {} };
    const out = setupPatternForBars(barsDesc());
    expect(out.pivotPrice).toBe(120);
    expect(out.pivotSource).toBe("maximo_65s");
  });

  it("con el motor apagado no cambia el cálculo", () => {
    engine.result = { vcpCandidate: true, v7: { base: true, pivote: 104.5, contracciones: [12, 6] } };
    const out = setupPatternForBars(barsDesc(), { vcpUnified: false });
    expect(out.pivotPrice).toBe(120);
  });
});
