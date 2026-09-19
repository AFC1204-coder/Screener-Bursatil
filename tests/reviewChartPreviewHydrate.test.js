// Review chartPreview hydrate — foco /review sin brief (decisión E / UX #7).

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  REVIEW_CHART_PREVIEW_FOCUS_MAX,
  REVIEW_DIRECT_CHART_DATA_RANGE,
  buildReviewChartPreviewHydratePlan,
  collectReviewSymbolsForChartPreviewHydrate,
  resolveReviewScanCloudId,
  reviewRowsForChartPreviewHydrate,
  runReviewChartPreviewHydrate,
  runReviewDirectChartHydrate,
} from "@/lib/reviewChartPreviewHydrate";
import {
  peekCachedChartPreviews,
  rememberPreviewsForTests,
  resetChartPreviewHydrateCacheForTests,
} from "@/lib/scansChartPreviewHydrate";

const testDir = dirname(fileURLToPath(import.meta.url));

function sourceWithoutComments(relativePath) {
  return readFileSync(resolve(testDir, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const preview = [
  { date: "2026-01-01", close: 10, volume: 1000 },
  { date: "2026-01-02", close: 11, volume: 1100 },
];

function row(symbol, withPreview = false) {
  return withPreview
    ? { symbol, chartPreview: preview }
    : { symbol };
}

describe("reviewRowsForChartPreviewHydrate", () => {
  it("devuelve activo + vecinos (máx 3) y deduplica", () => {
    const rows = [row("AAA"), row("BBB"), row("CCC")];
    expect(reviewRowsForChartPreviewHydrate(rows, 1).map((r) => r.symbol)).toEqual([
      "BBB", "CCC", "AAA",
    ]);
    expect(reviewRowsForChartPreviewHydrate([row("ONLY")], 0)).toHaveLength(1);
    expect(reviewRowsForChartPreviewHydrate(rows, 1).length).toBeLessThanOrEqual(
      REVIEW_CHART_PREVIEW_FOCUS_MAX,
    );
  });
});

describe("collectReviewSymbolsForChartPreviewHydrate", () => {
  it("omite símbolos que ya tienen preview usable", () => {
    const rows = [row("AAA", true), row("BBB"), row("CCC")];
    expect(collectReviewSymbolsForChartPreviewHydrate(rows, 0)).toEqual(["BBB", "CCC"]);
  });

  it("cola vacía → []", () => {
    expect(collectReviewSymbolsForChartPreviewHydrate([], 0)).toEqual([]);
  });
});

describe("buildReviewChartPreviewHydratePlan", () => {
  it("null si disabled o sin huecos", () => {
    expect(buildReviewChartPreviewHydratePlan({
      enabled: false,
      scans: [{ cloudId: "scan-1" }],
      visibleRows: [row("AAA")],
      currentIndex: 0,
    })).toBeNull();
    expect(buildReviewChartPreviewHydratePlan({
      enabled: true,
      scans: [{ cloudId: "scan-1" }],
      visibleRows: [row("AAA", true)],
      currentIndex: 0,
    })).toBeNull();
  });

  it("modo direct sin cloudId (P7 /review?symbol=X)", () => {
    const plan = buildReviewChartPreviewHydratePlan({
      enabled: true,
      scans: [],
      visibleRows: [row("AAPL")],
      currentIndex: 0,
    });
    expect(plan.mode).toBe("direct");
    expect(plan.symbols).toEqual(["AAPL"]);
    expect(plan.dataRange).toBe(REVIEW_DIRECT_CHART_DATA_RANGE);
    expect(plan.signature).toMatch(/^direct\|/);
  });

  it("plan scan con cloudId + symbols faltantes + signature estable", () => {
    const plan = buildReviewChartPreviewHydratePlan({
      enabled: true,
      scans: [{ cloudId: "scan-avah" }],
      visibleRows: [row("AVAH"), row("IFP.TO")],
      currentIndex: 0,
    });
    expect(plan.mode).toBe("scan");
    expect(plan.cloudId).toBe("scan-avah");
    expect(plan.symbols).toEqual(["AVAH", "IFP.TO"]);
    expect(plan.signature).toContain("AVAH");
    expect(plan.scanIds).toEqual([]);
  });

  it("plan incluye scanIds UUID de mergedFrom", () => {
    const us = "11111111-2222-4333-8444-555555555555";
    const plan = buildReviewChartPreviewHydratePlan({
      enabled: true,
      scans: [{
        cloudId: "merged-nightly-materialized:US-HK:2026-09-16",
        settings: { mergedFrom: [{ cloudId: us }] },
      }],
      visibleRows: [row("AVAH")],
      currentIndex: 0,
    });
    expect(plan.scanIds).toEqual([us]);
  });
});

describe("resolveReviewScanCloudId", () => {
  it("prefiere cloudId y cae a id", () => {
    expect(resolveReviewScanCloudId([{ cloudId: "c1", id: "i1" }])).toBe("c1");
    expect(resolveReviewScanCloudId([{ id: "i1" }])).toBe("i1");
    expect(resolveReviewScanCloudId([])).toBeNull();
  });
});

describe("runReviewChartPreviewHydrate", () => {
  it("modo scan: llama fetchImpl con cloudId y symbols; no inventa brief", async () => {
    const fetchImpl = vi.fn(async () => ({ AVAH: preview }));
    const onChunk = vi.fn();
    const result = await runReviewChartPreviewHydrate(
      {
        mode: "scan",
        cloudId: "scan-1",
        symbols: ["AVAH"],
        scanIds: ["11111111-2222-4333-8444-555555555555"],
      },
      { fetchImpl, onChunk },
    );
    expect(fetchImpl).toHaveBeenCalledWith("scan-1", ["AVAH"], {
      onChunk,
      scanIds: ["11111111-2222-4333-8444-555555555555"],
    });
    expect(result).toEqual({ AVAH: preview });
  });

  it("modo direct: compacta /api/chart a chartPreview close-only", async () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      close: 100 + i,
      volume: 1000 + i,
    }));
    const directFetchImpl = vi.fn(async () => ({ bars }));
    const onChunk = vi.fn();
    const result = await runReviewChartPreviewHydrate(
      { mode: "direct", symbols: ["AAPL"], dataRange: "6M", interval: "D" },
      { directFetchImpl, onChunk },
    );
    expect(directFetchImpl).toHaveBeenCalledWith({
      symbol: "AAPL",
      dataRange: "6M",
      interval: "D",
    });
    expect(result.AAPL.length).toBeGreaterThanOrEqual(2);
    expect(onChunk).toHaveBeenCalledWith({ AAPL: result.AAPL });
  });
});

describe("runReviewDirectChartHydrate", () => {
  it("ignora símbolos sin barras suficientes", async () => {
    const fetchImpl = vi.fn(async () => ({ bars: [{ date: "2026-01-01", close: 10 }] }));
    const result = await runReviewDirectChartHydrate(
      { mode: "direct", symbols: ["ZZZ"] },
      { fetchImpl },
    );
    expect(result).toEqual({});
  });
});

describe("peekCachedChartPreviews", () => {
  it("lee miniaturas recordadas por scanId", () => {
    resetChartPreviewHydrateCacheForTests();
    rememberPreviewsForTests("scan-1", { AVAH: preview });
    expect(peekCachedChartPreviews("scan-1", ["AVAH", "ZZZ"])).toEqual({ AVAH: preview });
    expect(peekCachedChartPreviews("scan-other", ["AVAH"])).toEqual({});
    resetChartPreviewHydrateCacheForTests();
  });
});

describe("Review page — candados decisión E / Astra", () => {
  const reviewSource = sourceWithoutComments("../app/review/page.jsx");

  it("hidrata chart-preview del foco; 0 company-brief", () => {
    expect(reviewSource).toContain("useReviewChartPreviewHydrate");
    expect(reviewSource).toContain("peekCachedChartPreviews");
    expect(reviewSource).not.toContain("/api/company-brief");
    expect(reviewSource).not.toContain("hydrateReviewRow");
  });

  it("sigue montando RowPriceChart sin gate de métricas", () => {
    expect(reviewSource).toMatch(/ReviewChartPanel[\s\S]*RowPriceChart/);
    expect(reviewSource).not.toContain("Cargando histórico y métricas");
  });
});
