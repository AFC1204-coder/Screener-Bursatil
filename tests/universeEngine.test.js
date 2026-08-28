import { describe, expect, it } from "vitest";
import { _forTest } from "@/lib/universeEngine";

const { normalizeEntry, dbSnapshotToApi } = _forTest;

describe("universeEngine HKEX metadata", () => {
  it("normalizeEntry conserva exchangeSubCategory y shortSellEligible", () => {
    const main = normalizeEntry({
      symbol: "0700.HK",
      name: "Tencent",
      country: "HK",
      source: "HKEX Full List of Securities",
      exchangeCategory: "Equity",
      exchangeSubCategory: "Equity Securities (Main Board)",
      shortSellEligible: true,
      isin: "KYG875721634",
      currency: "HKD",
    }, "HK");

    expect(main.exchangeSubCategory).toBe("Equity Securities (Main Board)");
    expect(main.shortSellEligible).toBe(true);
    expect(main.exchangeCategory).toBe("Equity");
    expect(main.isin).toBe("KYG875721634");
    expect(main.currency).toBe("HKD");

    const gem = normalizeEntry({
      symbol: "8001.HK",
      name: "GEM Co",
      country: "HK",
      source: "HKEX Full List of Securities",
      exchangeSubCategory: "Equity Securities (GEM)",
      shortSellEligible: false,
    }, "HK");

    expect(gem.exchangeSubCategory).toBe("Equity Securities (GEM)");
    expect(gem.shortSellEligible).toBe(false);
    expect(gem.exchangeCategory).toBeUndefined();
  });

  it("dbSnapshotToApi restaura metadatos HKEX desde row.raw", () => {
    const snapshot = {
      cache_key: "hk",
      markets: ["HK"],
      source: "Universe Engine cache",
      total_count: 2,
      excluded_count: 0,
      quality_gate: {},
      coverage: {},
      updated_at: "2026-08-29T00:00:00.000Z",
    };
    const symbols = [
      {
        symbol: "0700.HK",
        name: "Tencent",
        country: "HK",
        market: "HK",
        source: "HKEX Full List of Securities",
        passed: true,
        quality_gate: { passed: true, instrumentType: "equity" },
        coverage: { universeCoverageScore: 90, universeCoverageLabel: "alta" },
        raw: {
          symbol: "0700.HK",
          name: "Tencent",
          country: "HK",
          market: "HK",
          source: "HKEX Full List of Securities",
          exchangeCategory: "Equity",
          exchangeSubCategory: "Equity Securities (Main Board)",
          shortSellEligible: true,
          isin: "KYG875721634",
          currency: "HKD",
        },
      },
      {
        symbol: "8001.HK",
        name: "GEM Co",
        country: "HK",
        market: "HK",
        source: "HKEX Full List of Securities",
        passed: true,
        quality_gate: { passed: true, instrumentType: "equity" },
        coverage: { universeCoverageScore: 80, universeCoverageLabel: "útil" },
        raw: {
          symbol: "8001.HK",
          exchangeSubCategory: "Equity Securities (GEM)",
          shortSellEligible: false,
        },
      },
    ];

    const api = dbSnapshotToApi(snapshot, symbols, { hit: true, status: "supabase" });
    const withMeta = api.universe.filter((row) => row.exchangeSubCategory);

    expect(withMeta).toHaveLength(2);
    expect(api.universe[0].exchangeSubCategory).toBe("Equity Securities (Main Board)");
    expect(api.universe[0].shortSellEligible).toBe(true);
    expect(api.universe[1].exchangeSubCategory).toBe("Equity Securities (GEM)");
    expect(api.universe[1].shortSellEligible).toBe(false);
  });
});
