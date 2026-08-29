import { describe, expect, it } from "vitest";

import { IPO_DATE_SOURCES, IPO_DATE_UNAVAILABLE } from "@/lib/ipoDate";
import { mergeScanMetricsIpoDate, summarizePatchPlan } from "@/lib/patchScanIpoDate";

describe("mergeScanMetricsIpoDate", () => {
  it("parchea fecha ausente desde perfil", () => {
    const { metrics, changed, reason } = mergeScanMetricsIpoDate(
      { price: 10, ipoDate: "", ipoDateReason: IPO_DATE_UNAVAILABLE },
      { ipoDate: "2023-03-15", ipoDateSource: IPO_DATE_SOURCES.chartMeta },
    );
    expect(changed).toBe(true);
    expect(reason).toBe("patch");
    expect(metrics.ipoDate).toBe("2023-03-15");
    expect(metrics.ipoDateSource).toBe(IPO_DATE_SOURCES.chartMeta);
    expect(Number.isFinite(metrics.ipoAgeMonths)).toBe(true);
    expect(metrics.ipoDateReason).toBeUndefined();
    expect(metrics.price).toBe(10);
  });

  it("no cambia si ya coincide", () => {
    const age = mergeScanMetricsIpoDate({}, { ipoDate: "2020-01-01" }).metrics.ipoAgeMonths;
    const again = mergeScanMetricsIpoDate(
      { ipoDate: "2020-01-01", ipoAgeMonths: age, ipoDateSource: IPO_DATE_SOURCES.profile },
      { ipoDate: "2020-01-01" },
    );
    expect(again.changed).toBe(false);
    expect(again.reason).toBe("already");
  });

  it("sin perfil no inventa", () => {
    const out = mergeScanMetricsIpoDate({ price: 1 }, { ipoDate: "" });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("no-profile-date");
    expect(out.metrics.price).toBe(1);
  });
});

describe("summarizePatchPlan", () => {
  it("cuenta motivos", () => {
    const summary = summarizePatchPlan([
      { changed: true, reason: "patch", symbol: "A", metrics: { ipoDate: "2024-01-01", ipoAgeMonths: 12 } },
      { changed: false, reason: "already", symbol: "B" },
      { changed: false, reason: "no-profile-date", symbol: "C" },
    ]);
    expect(summary).toMatchObject({ wouldPatch: 1, already: 1, noProfile: 1 });
    expect(summary.sample).toHaveLength(1);
  });
});
