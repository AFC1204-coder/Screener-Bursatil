import { describe, expect, it } from "vitest";
import {
  ESTIMATED_CHART_PROVIDER,
  UNAVAILABLE_CHART_PROVIDER,
  estimatedChartForSymbol,
  estimatedDailyBarsForSymbol,
  unavailableChartForSymbol,
} from "@/lib/estimatedBars";

describe("estimated chart fallback", () => {
  it("genera barras descendentes suficientes para continuidad visual", () => {
    const bars = estimatedDailyBarsForSymbol("NVDA", { range: "2A", asOfDate: "2026-06-19" });

    expect(bars.length).toBeGreaterThan(100);
    expect(bars[0].date).toBe("2026-06-19");
    expect(new Date(bars[0].date).getTime()).toBeGreaterThan(new Date(bars.at(-1).date).getTime());
    expect(bars.every((bar) => bar.high >= Math.max(bar.open, bar.close))).toBe(true);
    expect(bars.every((bar) => bar.low <= Math.min(bar.open, bar.close))).toBe(true);
    expect(bars.every((bar) => bar.estimated === true)).toBe(true);
  });

  // Contrato central del arreglo: un fallo de proveedor NO fabrica serie.
  it("un fallo de proveedor devuelve ausencia explícita, no barras inventadas", () => {
    const chart = estimatedChartForSymbol("nvda", { range: "1A", asOfDate: "2026-06-19" }, new Error("timeout"));

    expect(chart.bars).toEqual([]);
    expect(chart.meta.symbol).toBe("NVDA");
    expect(chart.meta.regularMarketPrice).toBeNull();
    expect(chart.meta.dataProvider).toBe(UNAVAILABLE_CHART_PROVIDER);
    expect(chart.meta.estimated).toBe(false);
    expect(chart.dataQuality.status).toBe("missing");
    expect(chart.dataQuality.estimated).toBe(false);
    expect(chart.dataQuality.fallbackError).toContain("timeout");
  });

  it("unavailableChartForSymbol es el payload canónico de ausencia", () => {
    const chart = unavailableChartForSymbol("ZZZZQQ", { range: "2A" }, new Error("Yahoo chart HTTP 404"));

    expect(chart.ok).toBe(false);
    expect(chart.bars).toHaveLength(0);
    expect(chart.dataQuality.status).toBe("missing");
    expect(chart.dataQuality.degraded).toBe(true);
    expect(chart.dataQuality.source).toBe("unavailable");
    expect(chart.dataQuality.demo).toBe(false);
    // El mensaje crudo del proveedor queda en meta.cache.error para
    // diagnóstico; el issue que puede leer la interfaz no lo repite.
    expect(chart.meta.cache.error).toContain("404");
    expect(chart.dataQuality.issue).not.toContain("404");
  });

  it("solo el modo demo explícito produce serie sintética", () => {
    const chart = estimatedChartForSymbol("AAPL", { range: "1A", asOfDate: "2026-06-19", demo: true }, new Error("caída del proveedor"));

    expect(chart.bars.length).toBeGreaterThan(100);
    expect(chart.meta.dataProvider).toBe(ESTIMATED_CHART_PROVIDER);
    expect(chart.dataQuality.status).toBe("estimated");
    expect(chart.dataQuality.source).toBe("estimator");
    expect(chart.dataQuality.demo).toBe(true);
    // reason es alias de fallbackError; ambos deben coincidir y contener el motivo.
    expect(chart.dataQuality.reason).toBe(chart.dataQuality.fallbackError);
    expect(chart.dataQuality.reason).toContain("caída del proveedor");
  });
});
