import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  REVIEW_PREFETCH_MAX_TARGETS,
  buildReviewChartPrefetchPlan,
  reviewQueueNeighbors,
  runReviewChartPrefetchPlan,
  shouldPrefetchChartForRow,
} from "@/lib/reviewChartPrefetch";

const testDir = dirname(fileURLToPath(import.meta.url));

function sourceWithoutComments(relativePath) {
  return readFileSync(resolve(testDir, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const REVIEW_SETTINGS = { range: "6M", interval: "D", style: "1" };

function row(symbol, extra = {}) {
  return {
    symbol,
    chartPreview: [
      { date: "2026-01-01", close: 100, volume: 1000 },
      { date: "2026-01-02", close: 101, volume: 1100 },
    ],
    ...extra,
  };
}

describe("reviewChartPrefetch — plan N+1 / N-1", () => {
  it("cola <2 no genera prefetch", () => {
    expect(buildReviewChartPrefetchPlan({
      focusSymbol: "AAA",
      visibleRows: [row("AAA")],
      currentIndex: 0,
      chartSettings: REVIEW_SETTINGS,
    })).toEqual([]);
  });

  it("cola ≥2 incluye N+1 y N-1 acotado a 2 targets", () => {
    const visibleRows = [row("AAA"), row("BBB"), row("CCC")];
    const plan = buildReviewChartPrefetchPlan({
      focusSymbol: "BBB",
      visibleRows,
      currentIndex: 1,
      chartSettings: REVIEW_SETTINGS,
    });
    expect(plan.length).toBeLessThanOrEqual(REVIEW_PREFETCH_MAX_TARGETS);
    expect(plan.map((item) => item.symbol).sort()).toEqual(["AAA", "CCC"]);
    expect(plan.every((item) => item.prefetchChart)).toBe(true);
  });

  it("reviewQueueNeighbors envuelve en cola circular", () => {
    const visibleRows = [row("AAA"), row("BBB")];
    expect(reviewQueueNeighbors(visibleRows, 0)).toEqual({
      next: visibleRows[1],
      prev: visibleRows[1],
    });
    expect(reviewQueueNeighbors(visibleRows, 1)).toEqual({
      next: visibleRows[0],
      prev: visibleRows[0],
    });
  });

  it("no pide chart si el local ya cubre el rango", () => {
    const longPreview = Array.from({ length: 260 }, (_, i) => ({
      date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
      time: 1_700_000_000 + i * 86400,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    }));
    expect(shouldPrefetchChartForRow(row("ZZZ", { chartPreview: longPreview }), REVIEW_SETTINGS)).toBe(false);
  });

  it("pide rs-weekly solo si la fila no trae series hidratadas", () => {
    const visibleRows = [
      row("AAA"),
      row("BBB"),
      row("CCC", { globalRsSeries: [{ rsRating: 90, weekEnd: "2026-01-01" }] }),
    ];
    const plan = buildReviewChartPrefetchPlan({
      focusSymbol: "AAA",
      visibleRows,
      currentIndex: 0,
      chartSettings: REVIEW_SETTINGS,
    });
    expect(plan.find((item) => item.symbol === "BBB")?.prefetchRsWeekly).toBe(true);
    expect(plan.find((item) => item.symbol === "CCC")?.prefetchRsWeekly).toBe(false);
  });

  it("runReviewChartPrefetchPlan dispara chart y rs-weekly sin company-brief", () => {
    const prefetchChartImpl = vi.fn();
    const prefetchRsWeeklyImpl = vi.fn();
    const plan = [{
      role: "next",
      symbol: "BBB",
      prefetchChart: true,
      prefetchRsWeekly: true,
      rsWeeklyUrl: "/api/rs-weekly?symbol=BBB&limit=180",
      chartRequest: { symbol: "BBB", dataRange: "6M", interval: "D" },
    }];
    const started = runReviewChartPrefetchPlan(plan, { prefetchChartImpl, prefetchRsWeeklyImpl });
    expect(prefetchChartImpl).toHaveBeenCalledWith({ symbol: "BBB", dataRange: "6M", interval: "D" });
    expect(prefetchRsWeeklyImpl).toHaveBeenCalledWith("/api/rs-weekly?symbol=BBB&limit=180");
    expect(started).toHaveLength(2);
    expect(JSON.stringify(started)).not.toContain("company-brief");
  });
});

describe("REVIEW-CHART-PREFETCH-N1 — candados Review", () => {
  const reviewSource = sourceWithoutComments("../app/review/page.jsx");
  const prefetchLibSource = sourceWithoutComments("../lib/reviewChartPrefetch.js");
  const hookSource = sourceWithoutComments("../app/useReviewChartPrefetch.js");
  const chartModelSource = sourceWithoutComments("../app/useChartDataModel.js");

  it("/review usa useReviewChartPrefetch y no importa company-brief", () => {
    expect(reviewSource).toContain("useReviewChartPrefetch");
    expect(reviewSource).not.toContain("/api/company-brief");
    expect(reviewSource).not.toContain("hydrateReviewRow");
  });

  it("lib de prefetch no referencia brief ni reviewSession", () => {
    expect(prefetchLibSource).not.toContain("company-brief");
    expect(prefetchLibSource).not.toContain("reviewSession");
    expect(prefetchLibSource).toContain("prefetchChart");
    expect(prefetchLibSource).toContain("REVIEW_PREFETCH_MAX_TARGETS");
  });

  it("hook estabiliza con requestIdleCallback o setTimeout(0)", () => {
    expect(hookSource).toMatch(/requestIdleCallback/);
    expect(hookSource).toMatch(/setTimeout/);
    expect(hookSource).toContain("buildReviewChartPrefetchPlan");
  });

  it("useChartDataModel consume fetchChartCached (misma caché que prefetch)", () => {
    expect(chartModelSource).toContain("fetchChartCached");
    expect(chartModelSource).toMatch(/generationRef\.current !== generation/);
  });
});
