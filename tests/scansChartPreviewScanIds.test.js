import { describe, expect, it } from "vitest";
import {
  chartPreviewScanIdsFromScan,
  isScanUuid,
  isSyntheticChartPreviewScanId,
  marketsFromSyntheticScanId,
  normalizeChartPreviewScanIds,
} from "@/lib/scansChartPreviewScanIds";

const US_UUID = "11111111-2222-4333-8444-555555555555";
const HK_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("scansChartPreviewScanIds", () => {
  it("isScanUuid acepta uuid v4 y rechaza sintéticos", () => {
    expect(isScanUuid(US_UUID)).toBe(true);
    expect(isScanUuid("merged-nightly-materialized:US-HK:2026-09-16")).toBe(false);
    expect(isScanUuid("materialized:US:2026-09-16")).toBe(false);
  });

  it("normalizeChartPreviewScanIds filtra no-uuid y dedupe", () => {
    expect(normalizeChartPreviewScanIds([
      US_UUID,
      "merged-nightly-materialized:US-HK:2026-09-16",
      US_UUID,
      HK_UUID,
      "",
    ])).toEqual([US_UUID, HK_UUID]);
  });

  it("chartPreviewScanIdsFromScan usa mergedFrom cloudIds", () => {
    const ids = chartPreviewScanIdsFromScan({
      cloudId: "merged-nightly-materialized:US-HK:2026-09-16",
      settings: {
        source: "merged-nightly-materialized",
        mergedFrom: [
          { cloudId: US_UUID, market: "US" },
          { cloudId: HK_UUID, market: "HK" },
          { cloudId: "not-a-uuid", market: "X" },
        ],
      },
    });
    expect(ids).toEqual([US_UUID, HK_UUID]);
  });

  it("chartPreviewScanIdsFromScan usa accumulatedFrom", () => {
    expect(chartPreviewScanIdsFromScan({
      cloudId: "accumulated-materialized:HK:2026-09-16",
      settings: {
        accumulatedFrom: [{ cloudId: HK_UUID }, { cloudId: US_UUID }],
      },
    })).toEqual([HK_UUID, US_UUID]);
  });

  it("chartPreviewScanIdsFromScan cae a cloudId UUID", () => {
    expect(chartPreviewScanIdsFromScan({ cloudId: US_UUID, settings: {} })).toEqual([US_UUID]);
  });

  it("chartPreviewScanIdsFromScan vacío si solo id sintético", () => {
    expect(chartPreviewScanIdsFromScan({
      cloudId: "merged-nightly-materialized:US-HK:2026-09-16",
      settings: { source: "merged-nightly-materialized" },
    })).toEqual([]);
  });

  it("marketsFromSyntheticScanId parsea fusión y acumulado", () => {
    expect(marketsFromSyntheticScanId("merged-nightly-materialized:US-CA-HK:2026-09-16"))
      .toEqual(["CA", "HK", "US"]);
    expect(marketsFromSyntheticScanId("merged-materialized:HK-AU:2026-09-16"))
      .toEqual(["AU", "HK"]);
    expect(marketsFromSyntheticScanId("accumulated-materialized:HK:2026-09-16"))
      .toEqual(["HK"]);
    expect(marketsFromSyntheticScanId(US_UUID)).toEqual([]);
    expect(isSyntheticChartPreviewScanId("merged-nightly-materialized:US-HK:2026-09-16")).toBe(true);
    expect(isSyntheticChartPreviewScanId(US_UUID)).toBe(false);
  });
});
