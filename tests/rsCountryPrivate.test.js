import { describe, expect, it } from "vitest";

import { percentileFromSorted } from "@/lib/relativeStrength";
import {
  computeLocalSymbol,
  EXCLUSION_REASONS,
  parseArgs,
  runMarketRanking,
} from "@/scripts/rs-country-private.mjs";
import { intlCountryRsEngineVersion } from "@/lib/rsEngines";
import { marketSymbols } from "@/lib/universes";

function syntheticBars({ count = 300, start = 100, growthPerBar = 0.001 } = {}) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1) + (count - i) * 86400000).toISOString().slice(0, 10);
    bars.push({ date, close: start * (1 + growthPerBar) ** (count - i) });
  }
  return bars.sort((a, b) => (a.date < b.date ? 1 : -1));
}

describe("rs-country-private parseArgs", () => {
  it("dry-run por defecto", () => {
    const args = parseArgs([]);
    expect(args.dryRun).toBe(true);
    expect(args.write).toBe(false);
  });

  it("--write desactiva dry-run salvo --dry-run explícito", () => {
    expect(parseArgs(["--write"]).dryRun).toBe(false);
    expect(parseArgs(["--write", "--dry-run=true"]).dryRun).toBe(true);
  });

  it("acepta --markets=HK,CA", () => {
    const args = parseArgs(["--markets=HK,CA", "--limit=5"]);
    expect(args.markets).toEqual(["HK", "CA"]);
    expect(args.limit).toBe(5);
  });
});

describe("computeLocalSymbol", () => {
  it("calcula raw con barras suficientes", () => {
    const bars = syntheticBars();
    const result = computeLocalSymbol({ symbol: "0700.HK", currency: "HKD" }, bars);
    expect(result.ok).toBe(true);
    expect(Number.isFinite(result.raw)).toBe(true);
  });

  it("excluye barras insuficientes", () => {
    const result = computeLocalSymbol({ symbol: "X", currency: "HKD" }, syntheticBars({ count: 50 }));
    expect(result.ok).toBe(false);
    expect(result.exclusionReason).toBe(EXCLUSION_REASONS.INSUFFICIENT_BARS);
  });

  it("excluye serie discontinua", () => {
    const bars = syntheticBars();
    bars[1] = { ...bars[1], close: bars[0].close * 5 };
    const result = computeLocalSymbol({ symbol: "X", currency: "HKD" }, bars);
    expect(result.ok).toBe(false);
    expect(result.exclusionReason).toBe(EXCLUSION_REASONS.DISCONTINUOUS);
  });
});

describe("runMarketRanking dry path (HK)", () => {
  it("rankea población curada HK sin Supabase", async () => {
    const hkSymbols = marketSymbols("HK");
    expect(hkSymbols.length).toBeGreaterThan(0);
    const config = { ownerId: "test", configured: true };
    const fetchBarsForSymbol = async (_config, symbol) => syntheticBars({ start: symbol.length * 10 });
    const report = await runMarketRanking(config, "HK", {
      limit: 12,
      concurrency: 4,
      minSample: 5,
      persistExclusions: true,
      dryRun: true,
      write: false,
      markets: ["HK"],
    }, { fetchBarsForSymbol });
    expect(report.scopeMarket).toBe("HK");
    expect(report.engineVersion).toBe(intlCountryRsEngineVersion("HK"));
    expect(report.populationDefined).toBe(hkSymbols.length);
    expect(report.populationRequested).toBe(12);
    expect(report.included).toBe(12);
    expect(report.ranked.length).toBe(12);
    const ratings = report.ranked.map((row) => row.rsRating).filter((v) => v !== null);
    expect(ratings.length).toBeGreaterThan(0);
    const sortedRaw = report.ranked.map((row) => row.raw).sort((a, b) => a - b);
    for (const row of report.ranked) {
      expect(row.rsRating).toBe(percentileFromSorted(row.raw, sortedRaw, 5));
    }
  });
});
