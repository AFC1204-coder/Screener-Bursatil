import { describe, expect, it } from "vitest";
import { ESTIMATED_CHART_PROVIDER, estimatedChartForSymbol, estimatedDailyBarsForSymbol } from "@/lib/estimatedBars";

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

  it("marca el payload como estimado y no-live", () => {
    const chart = estimatedChartForSymbol("nvda", { range: "1A", asOfDate: "2026-06-19" }, new Error("timeout"));

    expect(chart.ok).toBe(false);
    expect(chart.meta.symbol).toBe("NVDA");
    expect(chart.meta.dataProvider).toBe(ESTIMATED_CHART_PROVIDER);
    expect(chart.dataQuality.status).toBe("estimated");
    expect(chart.dataQuality.fallbackError).toContain("timeout");
  });
});
