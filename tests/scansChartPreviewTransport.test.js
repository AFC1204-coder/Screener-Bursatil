import { describe, expect, it } from "vitest";
import {
  mergeChartPreviewsIntoRows,
  rowHasChartPreview,
  scanChartPreviewTransportMode,
  stripChartPreviewForTransport,
  symbolsMissingChartPreview,
} from "@/lib/scansChartPreviewTransport";

const preview = [
  { date: "2026-01-01", close: 10, sma50: 9.5, sma200: 9, volume: 1000 },
  { date: "2026-01-02", close: 11, sma50: 9.6, sma200: 9.1, volume: 1100 },
];

describe("scanChartPreviewTransportMode", () => {
  it("compacto de mesa difiere chartPreview por defecto", () => {
    expect(scanChartPreviewTransportMode({})).toBe("deferred");
    expect(scanChartPreviewTransportMode({ chartPreviewParam: "0" })).toBe("deferred");
  });
  it("full y decision mantienen inline", () => {
    expect(scanChartPreviewTransportMode({ full: true })).toBe("inline");
    expect(scanChartPreviewTransportMode({ decisionProjection: true })).toBe("inline");
    expect(scanChartPreviewTransportMode({ chartPreviewParam: "1" })).toBe("inline");
  });
});

describe("stripChartPreviewForTransport", () => {
  it("quita chartPreview sin tocar el resto", () => {
    const row = { symbol: "AAA", price: 10, chartPreview: preview };
    const stripped = stripChartPreviewForTransport(row);
    expect(stripped.symbol).toBe("AAA");
    expect(stripped.price).toBe(10);
    expect(stripped.chartPreview).toBeUndefined();
  });
});

describe("mergeChartPreviewsIntoRows", () => {
  it("rellena previews faltantes por símbolo", () => {
    const merged = mergeChartPreviewsIntoRows(
      [{ symbol: "AAA" }, { symbol: "BBB", chartPreview: preview }],
      new Map([["AAA", preview]]),
    );
    expect(merged[0].chartPreview).toEqual(preview);
    expect(merged[1].chartPreview).toEqual(preview);
  });
});

describe("symbolsMissingChartPreview", () => {
  it("lista símbolos sin miniatura usable", () => {
    expect(symbolsMissingChartPreview([
      { symbol: "AAA" },
      { symbol: "BBB", chartPreview: preview },
      { symbol: "CCC", chartPreview: [] },
    ])).toEqual(["AAA", "CCC"]);
    expect(rowHasChartPreview({ chartPreview: preview })).toBe(true);
  });
});
