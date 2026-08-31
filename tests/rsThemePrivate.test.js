import { describe, expect, it } from "vitest";

import { percentileFromSorted } from "@/lib/relativeStrength";
import { rankableThemeForProfile } from "@/lib/themeRsAssign";
import { themeRsEngineVersion } from "@/lib/rsEngines";
import {
  EXCLUSION_REASONS,
  parseArgs,
  runThemeRanking,
} from "@/scripts/rs-theme-private.mjs";
import { computeSymbol } from "@/scripts/rs-global-private.mjs";

function syntheticBars({ count = 300, start = 100, growthPerBar = 0.001 } = {}) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1) + (count - i) * 86400000).toISOString().slice(0, 10);
    bars.push({ date, close: start * (1 + growthPerBar) ** (count - i) });
  }
  return bars.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

describe("rs-theme-private parseArgs", () => {
  it("dry-run por defecto", () => {
    const args = parseArgs([]);
    expect(args.dryRun).toBe(true);
    expect(args.write).toBe(false);
    expect(args.themes.length).toBe(12);
  });

  it("--write desactiva dry-run salvo --dry-run explícito", () => {
    expect(parseArgs(["--write"]).dryRun).toBe(false);
    expect(parseArgs(["--write", "--dry-run=true"]).dryRun).toBe(true);
  });

  it("acepta --themes=Software / IA", () => {
    const args = parseArgs(["--themes=Software / IA"]);
    expect(args.themes).toEqual(["Software / IA"]);
  });
});

describe("rankableThemeForProfile", () => {
  it("asigna theme curado desde sector/industria", () => {
    const assign = rankableThemeForProfile("Technology", "Semiconductors", "");
    expect(assign.themeKey).toBe("Semis / fotonica");
    expect(assign.exclusionReason).toBe(null);
  });

  it("sector Yahoo residual no rankea", () => {
    const assign = rankableThemeForProfile("Basic Materials", "Chemicals", "Mining company");
    expect(assign.themeKey).toBe(null);
    expect(assign.exclusionReason).toBe(EXCLUSION_REASONS.THEME_RESIDUAL);
  });
});

describe("runThemeRanking dry path", () => {
  it("rankea población sintética sin Supabase", async () => {
    const themeKey = "Software / IA";
    const population = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V"]
      .map((letter, index) => ({
        symbol: `SW${letter}`,
        name: `Soft ${letter}`,
        market: "US",
        currency: "USD",
        sector: "Technology",
        industry: "Software",
        themeKey,
      }));
    const config = { ownerId: "test", configured: true };
    const fetchBarsForSymbol = async (_config, symbol) => syntheticBars({ start: symbol.length * 3 });
    const fxSeries = new Map();
    const report = await runThemeRanking(config, themeKey, population, {
      limit: 0,
      concurrency: 4,
      minSample: 20,
      persistExclusions: true,
      dryRun: true,
      write: false,
    }, {
      fetchBarsForSymbol,
      fxSeriesByCurrency: fxSeries,
    });
    expect(report.themeKey).toBe(themeKey);
    expect(report.engineVersion).toBe(themeRsEngineVersion(themeKey));
    expect(report.included).toBe(22);
    expect(report.ranked.length).toBe(22);
    const ratings = report.ranked.map((row) => row.rsRating).filter((v) => v !== null);
    expect(ratings.length).toBe(22);
    const sortedRaw = report.ranked.map((row) => row.raw).sort((a, b) => a - b);
    for (const row of report.ranked) {
      expect(row.rsRating).toBe(percentileFromSorted(row.raw, sortedRaw, 20));
    }
  });

  it("computeSymbol acepta USD sin FX", () => {
    const bars = syntheticBars();
    const result = computeSymbol({ symbol: "AAPL", market: "US", currency: "USD" }, bars, new Map());
    expect(result.ok).toBe(true);
    expect(Number.isFinite(result.raw)).toBe(true);
  });
});
