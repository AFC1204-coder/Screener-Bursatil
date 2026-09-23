import { describe, expect, it } from "vitest";
import {
  collectSymbolsForChartPreviewHydrate,
  computeHuntChartPreviewHydrateLimit,
  huntRowsForChartPreviewHydrate,
  HUNT_CHART_PREVIEW_OVERSCAN,
  MAX_HUNT_CHART_PREVIEW_HYDRATE,
} from "@/lib/scansChartPreviewHydrate";

const preview = [
  { date: "2026-01-01", close: 10, sma50: 9.5, sma200: 9, volume: 1000 },
  { date: "2026-01-02", close: 11, sma50: 9.6, sma200: 9.1, volume: 1100 },
];

function row(symbol, withPreview = false) {
  return withPreview ? { symbol, chartPreview: preview } : { symbol };
}

describe("huntRowsForChartPreviewHydrate", () => {
  it("devuelve viewport+buffer filtradas solo en modo Caza", () => {
    const filtered = [row("AAA"), row("BBB")];
    const longQueue = Array.from({ length: 120 }, (_, index) => row(`H${index}`));
    const defaultLimit = computeHuntChartPreviewHydrateLimit();
    expect(defaultLimit).toBeLessThan(MAX_HUNT_CHART_PREVIEW_HYDRATE);
    expect(defaultLimit).toBeGreaterThan(2 * HUNT_CHART_PREVIEW_OVERSCAN);
    expect(huntRowsForChartPreviewHydrate(filtered, false)).toEqual([]);
    expect(huntRowsForChartPreviewHydrate(filtered, true)).toEqual(filtered);
    expect(huntRowsForChartPreviewHydrate(longQueue, true)).toHaveLength(defaultLimit);
    expect(huntRowsForChartPreviewHydrate(longQueue, true)[0].symbol).toBe("H0");
    expect(huntRowsForChartPreviewHydrate(longQueue, true, { start: 10, limit: 5 })).toEqual(
      longQueue.slice(10, 15),
    );
    // start cerca del final se clampa para mantener ventana completa de `limit`
    expect(huntRowsForChartPreviewHydrate(longQueue, true, { start: 100, limit: 80 })).toEqual(
      longQueue.slice(40, 120),
    );
  });

  it("no pide símbolos fuera de viewport+buffer en cola larga", () => {
    const queue = Array.from({ length: 200 }, (_, index) => row(`H${index}`));
    const limit = computeHuntChartPreviewHydrateLimit(360, { rowHeight: 36, overscan: 8 });
    expect(limit).toBe(10 + 16);
    const windowed = huntRowsForChartPreviewHydrate(queue, true, { start: 40, limit });
    expect(windowed).toHaveLength(limit);
    expect(windowed[0].symbol).toBe("H40");
    expect(windowed.at(-1).symbol).toBe(`H${40 + limit - 1}`);
    expect(windowed.some((item) => item.symbol === "H0")).toBe(false);
    expect(windowed.some((item) => item.symbol === "H199")).toBe(false);
  });
});

describe("collectSymbolsForChartPreviewHydrate", () => {
  it("no incluye el universo analyzedRows — solo paged, quick-review y caza", () => {
    const universe = Array.from({ length: 120 }, (_, i) => row(`U${i}`));
    const symbols = collectSymbolsForChartPreviewHydrate({
      pagedRows: [row("PAGE1"), row("PAGE2")],
      quickReviewRows: [row("QR1")],
      huntRows: huntRowsForChartPreviewHydrate([row("HUNT1"), row("HUNT2")], true),
    });
    expect(symbols).toEqual(["PAGE1", "PAGE2", "QR1", "HUNT1", "HUNT2"]);
    expect(symbols.some((symbol) => symbol.startsWith("U"))).toBe(false);
    expect(collectSymbolsForChartPreviewHydrate({ pagedRows: universe })).toHaveLength(120);
  });

  it("omite símbolos que ya tienen chartPreview usable", () => {
    const symbols = collectSymbolsForChartPreviewHydrate({
      pagedRows: [row("AAA"), row("BBB", true)],
      quickReviewRows: [row("CCC")],
      huntRows: [row("DDD", true), row("EEE")],
    });
    expect(symbols).toEqual(["AAA", "CCC", "EEE"]);
  });

  it("deduplica símbolos entre fuentes visibles", () => {
    const symbols = collectSymbolsForChartPreviewHydrate({
      pagedRows: [row("AAA")],
      quickReviewRows: [row("AAA")],
      huntRows: [row("AAA")],
    });
    expect(symbols).toEqual(["AAA"]);
  });

  it("modo Auditoría: solo pagedRows y quickReviewRows", () => {
    const filtered = [row("VIS1"), row("VIS2"), row("VIS3")];
    const symbols = collectSymbolsForChartPreviewHydrate({
      pagedRows: filtered.slice(0, 2),
      quickReviewRows: [],
      huntRows: huntRowsForChartPreviewHydrate(filtered, false),
    });
    expect(symbols).toEqual(["VIS1", "VIS2"]);
  });
});
