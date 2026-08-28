import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/universeEngine", () => ({
  getUniverseEngineSnapshot: vi.fn(),
}));

import { getUniverseEngineSnapshot } from "@/lib/universeEngine";
import { planMaterializedScan } from "@/lib/materializedScanner";
import { marketSymbols } from "@/lib/universes";

function officialDumpSnapshot(market, count, { skipCurated = true } = {}) {
  const curated = new Set(marketSymbols(market).map((symbol) => String(symbol).toUpperCase()));
  const suffix = market === "AU" ? ".AX" : `.${market}`;
  const universe = [];
  let i = 0;
  while (universe.length < count) {
    i += 1;
    const symbol = market === "HK"
      ? `${String(2000 + i).padStart(4, "0")}.HK`
      : `DUMP${i}${suffix}`;
    if (skipCurated && curated.has(symbol.toUpperCase())) continue;
    universe.push({
      symbol,
      name: `Dump ${i}`,
      market,
      country: market,
      source: "official-dump",
      qualityGate: { instrumentType: "equity" },
    });
  }
  return {
    key: `universe:${market}`,
    markets: [market],
    count: universe.length,
    totalBeforeGate: universe.length,
    excludedCount: 0,
    universe,
    excluded: [],
    coverage: { byMarket: {}, bySource: {}, bySourceByMarket: {}, byInstrumentType: {} },
    cache: { hit: true, status: "supabase" },
  };
}

function hkLiquidBandSnapshot({ gemCount = 80, mainBoardCount = 40, skipCurated = true } = {}) {
  const curated = new Set(marketSymbols("HK").map((symbol) => String(symbol).toUpperCase()));
  const universe = [];
  for (let i = 0; i < gemCount; i += 1) {
    const symbol = `${String(1000 + i).padStart(4, "0")}.HK`;
    if (skipCurated && curated.has(symbol.toUpperCase())) continue;
    universe.push({
      symbol,
      name: `GEM ${i}`,
      market: "HK",
      country: "HK",
      source: "HKEX Full List of Securities",
      exchangeSubCategory: "Equity Securities (GEM)",
      shortSellEligible: false,
      qualityGate: { instrumentType: "equity" },
    });
  }
  for (let i = 0; i < mainBoardCount; i += 1) {
    const symbol = `${String(3000 + i).padStart(4, "0")}.HK`;
    if (skipCurated && curated.has(symbol.toUpperCase())) continue;
    universe.push({
      symbol,
      name: `Main ${i}`,
      market: "HK",
      country: "HK",
      source: "HKEX Full List of Securities",
      exchangeSubCategory: "Equity Securities (Main Board)",
      shortSellEligible: true,
      qualityGate: { instrumentType: "equity" },
    });
  }
  return {
    key: "universe:HK",
    markets: ["HK"],
    count: universe.length,
    totalBeforeGate: universe.length,
    excludedCount: 0,
    universe,
    excluded: [],
    coverage: { byMarket: {}, bySource: {}, bySourceByMarket: {}, byInstrumentType: {} },
    cache: { hit: true, status: "supabase" },
  };
}

function isHkMainBoardRow(symbol, rows = []) {
  const row = rows.find((item) => item.symbol === symbol);
  return Boolean(row?.exchangeSubCategory?.includes("Main Board") && row?.shortSellEligible === true);
}

describe("materializedScanner · official-broad HK/CA", () => {
  it("HK official-broad: universo > 76 y selección incluye símbolos no curados", async () => {
    const curated = new Set(marketSymbols("HK").map((symbol) => symbol.toUpperCase()));
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("HK", 400));

    const plan = await planMaterializedScan({
      markets: ["HK"],
      perMarket: 100,
      limit: 100,
      offset: 0,
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.stats.selection.priorityMode).toBe("official-broad");
    expect(plan.universeTotal).toBeGreaterThan(76);
    expect(plan.symbols.length).toBe(100);
    const nonCurated = plan.symbols.filter((symbol) => !curated.has(symbol.toUpperCase()));
    expect(nonCurated.length).toBeGreaterThanOrEqual(5);
    expect(plan.settings.universeTotal).toBeGreaterThan(76);
  });

  it("HK official-broad: cursor alto avanza sobre símbolos no curados sin reset", async () => {
    const curated = new Set(marketSymbols("HK").map((symbol) => symbol.toUpperCase()));
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("HK", 400));

    const plan = await planMaterializedScan({
      markets: ["HK"],
      perMarket: 10,
      limit: 10,
      offset: 90,
      marketOffsets: { HK: 90 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.stats.selection.priorityMode).toBe("official-broad");
    expect(plan.settings.marketOffsets.HK).toBe(90);
    expect(plan.symbols.length).toBe(10);
    const nonCurated = plan.symbols.filter((symbol) => !curated.has(symbol.toUpperCase()));
    expect(nonCurated.length).toBeGreaterThan(0);
  });

  it("HK official-broad (INT-3e): en banda GEM salta microcaps y prioriza Main Board+short-sell", async () => {
    const snapshot = hkLiquidBandSnapshot({ gemCount: 80, mainBoardCount: 40 });
    getUniverseEngineSnapshot.mockResolvedValue(snapshot);

    const plan = await planMaterializedScan({
      markets: ["HK"],
      perMarket: 24,
      limit: 24,
      offset: 50,
      marketOffsets: { HK: 50 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.stats.selection.priorityMode).toBe("official-broad");
    expect(plan.symbols).toHaveLength(24);
    const mainBoardCount = plan.symbols.filter((symbol) => isHkMainBoardRow(symbol, snapshot.universe)).length;
    expect(mainBoardCount).toBeGreaterThanOrEqual(13);
    expect(plan.stats.selection.skippedLiquid).toBeGreaterThan(0);
    expect(plan.settings.nextMarketOffsets.HK).toBeGreaterThan(50);
  });

  it("CA official-broad: no usa curated-core como techo", async () => {
    const curated = new Set(marketSymbols("CA").map((symbol) => symbol.toUpperCase()));
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("CA", 200));

    const plan = await planMaterializedScan({
      markets: ["CA"],
      perMarket: 50,
      limit: 50,
      offset: 40,
      marketOffsets: { CA: 40 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.stats.selection.priorityMode).toBe("official-broad");
    expect(plan.settings.marketOffsets.CA).toBe(40);
    expect(plan.symbols.length).toBe(50);
    const nonCurated = plan.symbols.filter((symbol) => !curated.has(symbol.toUpperCase()));
    expect(nonCurated.length).toBeGreaterThan(0);
  });
});
