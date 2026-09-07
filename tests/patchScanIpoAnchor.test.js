import { describe, expect, it } from "vitest";

import { mergeScanMetricsIpoAnchor, summarizeIpoAnchorPatchPlan } from "@/lib/patchScanIpoAnchor";

describe("mergeScanMetricsIpoAnchor", () => {
  const bars = [
    { date: "2026-01-10", close: 120 },
    { date: "2024-03-21", close: 50 },
  ];

  it("añade ancla cuando hay ipoDate e histórico", () => {
    const result = mergeScanMetricsIpoAnchor({ ipoDate: "2024-03-21" }, bars);
    expect(result.changed).toBe(true);
    expect(result.metrics.ipoAnchorClose).toBe(50);
    expect(result.metrics.ipoAnchorDate).toBe("2024-03-21");
  });

  it("no cambia si la ancla ya coincide", () => {
    const result = mergeScanMetricsIpoAnchor({
      ipoDate: "2024-03-21",
      ipoAnchorClose: 50,
      ipoAnchorDate: "2024-03-21",
    }, bars);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("already");
  });

  it("resume el plan de parche", () => {
    const summary = summarizeIpoAnchorPatchPlan([
      { changed: true, reason: "patch", symbol: "A", metrics: { ipoAnchorClose: 1, ipoAnchorDate: "2024-01-01", ipoDate: "2024-01-01" } },
      { changed: false, reason: "already", symbol: "B" },
      { changed: false, reason: "no-ipo-date", symbol: "C" },
    ]);
    expect(summary.wouldPatch).toBe(1);
    expect(summary.already).toBe(1);
    expect(summary.noIpoDate).toBe(1);
  });
});
