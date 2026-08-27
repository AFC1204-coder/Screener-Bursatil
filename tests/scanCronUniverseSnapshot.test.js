// Contrato: el cron de escaneo (app/api/cron/scan-refresh) pide grupos de
// mercados (SCAN_CRON_GROUPS) cuya clave de caché individual nunca se
// escribe — solo el cron de universo persiste la instantánea combinada bajo
// CRON_UNIVERSE_MARKETS. Sin este arreglo, cada grupo no europeo fallaba el
// lookup por igualdad exacta de cache_key y forzaba una reconstrucción
// completa del universo en cada corrida (cache.hit false, ~34s de los 60s
// disponibles). Ver docs/... (memo de diagnóstico 2026-08-04).
//
// Este test verifica, con getUniverseEngineSnapshot mockeado, que:
//  1. Con cronUniverseSnapshot:true y un grupo subconjunto de
//     CRON_UNIVERSE_MARKETS, se pide la instantánea combinada (no la del
//     grupo) y el resultado se recorta a los mercados del grupo.
//  2. Un grupo que NO es subconjunto de CRON_UNIVERSE_MARKETS (Europa) no
//     cambia de comportamiento: se sigue pidiendo con sus propios mercados.
//  3. Sin cronUniverseSnapshot (camino de la UI), el comportamiento no
//     cambia: se pide siempre con los mercados exactos solicitados.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/universeEngine", () => ({
  getUniverseEngineSnapshot: vi.fn(),
}));

import { getUniverseEngineSnapshot } from "@/lib/universeEngine";
import { planMaterializedScan } from "@/lib/materializedScanner";
import { CRON_UNIVERSE_MARKETS } from "@/lib/cronPlan";
import { marketSymbols } from "@/lib/universes";

function combinedSnapshotFixture() {
  const universe = [];
  let i = 0;
  for (const market of CRON_UNIVERSE_MARKETS) {
    for (let n = 0; n < 3; n += 1) {
      i += 1;
      universe.push({ symbol: `SYM${i}`, name: `Symbol ${i}`, market, country: market, source: "test" });
    }
  }
  return {
    key: `universe:${[...CRON_UNIVERSE_MARKETS].sort().join(",")}`,
    markets: CRON_UNIVERSE_MARKETS,
    count: universe.length,
    totalBeforeGate: universe.length,
    excludedCount: 0,
    universe,
    excluded: [],
    coverage: { byMarket: {}, bySource: {}, bySourceByMarket: {}, byInstrumentType: {} },
    cache: { hit: true, status: "supabase" },
  };
}

function groupSnapshotFixture(markets = []) {
  const universe = markets.flatMap((market, idx) => [{ symbol: `G${idx}A`, market, country: market, source: "test" }]);
  return {
    key: `universe:${[...markets].sort().join(",")}`,
    markets,
    count: universe.length,
    totalBeforeGate: universe.length,
    excludedCount: 0,
    universe,
    excluded: [],
    coverage: { byMarket: {}, bySource: {}, bySourceByMarket: {}, byInstrumentType: {} },
    cache: { hit: false, status: "built" },
  };
}

describe("resolveSymbols · resolución de instantánea del universo para el cron de escaneo", () => {
  it("con cronUniverseSnapshot:true, un grupo no europeo pide la instantánea combinada y se recorta a sus mercados", async () => {
    getUniverseEngineSnapshot.mockResolvedValue(combinedSnapshotFixture());

    const plan = await planMaterializedScan({
      markets: ["US", "HK", "AU"],
      perMarket: 10,
      limit: 30,
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(getUniverseEngineSnapshot).toHaveBeenCalledTimes(1);
    expect(getUniverseEngineSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      markets: expect.arrayContaining(CRON_UNIVERSE_MARKETS),
    }));
    const calledMarkets = getUniverseEngineSnapshot.mock.calls[0][0].markets;
    expect(calledMarkets).toHaveLength(CRON_UNIVERSE_MARKETS.length);

    // El resultado sólo contiene símbolos de los mercados del grupo, aunque
    // la instantánea pedida traía los ocho mercados combinados.
    const marketsInPlan = new Set(plan.selectedRows.map((row) => row.market));
    expect(marketsInPlan).toEqual(new Set(["US", "HK", "AU"]));
    expect(plan.universeTotal).toBe(9); // 3 símbolos × 3 mercados del grupo
  });

  it("con cronUniverseSnapshot:true, un grupo europeo (no subconjunto de CRON_UNIVERSE_MARKETS) no cambia de comportamiento", async () => {
    getUniverseEngineSnapshot.mockResolvedValue(groupSnapshotFixture(["GB", "DE", "FR", "NL", "CH", "SE", "IT", "ES"]));

    await planMaterializedScan({
      markets: ["GB", "DE", "FR", "NL", "CH", "SE", "IT", "ES"],
      perMarket: 3,
      limit: 24,
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(getUniverseEngineSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      markets: ["GB", "DE", "FR", "NL", "CH", "SE", "IT", "ES"],
    }));
  });

  it("sin cronUniverseSnapshot (camino de la UI), se pide siempre con los mercados exactos solicitados", async () => {
    getUniverseEngineSnapshot.mockResolvedValue(groupSnapshotFixture(["US"]));

    await planMaterializedScan({
      markets: ["US"],
      perMarket: 0,
      limit: 10,
      prioritizeMaterialization: false,
    });

    expect(getUniverseEngineSnapshot).toHaveBeenCalledWith(expect.objectContaining({ markets: ["US"] }));
  });
});

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
    universe.push({ symbol, name: `Dump ${i}`, market, country: market, source: "official-dump" });
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

describe("resolveSymbols · cola curada para cohorts de un mercado HK/AU/KR/IN/CA/Europa priority", () => {
  it("con markets [HK], prioriza marketSymbols(HK) y no usa el offset 130 del dump HKEX", async () => {
    const curated = marketSymbols("HK");
    expect(curated.length).toBeGreaterThanOrEqual(24);
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("HK", 400));

    const plan = await planMaterializedScan({
      markets: ["HK"],
      perMarket: 24,
      limit: 24,
      offset: 130,
      marketOffsets: { HK: 130 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(0, 24));
    expect(plan.settings.marketOffsets.HK).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });

  it("con markets [AU], antepone marketSymbols(AU) y rellena el limit desde el dump tras reset del offset", async () => {
    const curated = marketSymbols("AU");
    expect(curated.length).toBeGreaterThan(0);
    expect(curated.length).toBeLessThan(24);
    const snapshot = officialDumpSnapshot("AU", 80);
    getUniverseEngineSnapshot.mockResolvedValue(snapshot);

    const plan = await planMaterializedScan({
      markets: ["AU"],
      perMarket: 24,
      limit: 24,
      offset: 130,
      marketOffsets: { AU: 130 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toHaveLength(24);
    expect(plan.symbols.slice(0, curated.length)).toEqual(curated);
    expect(plan.symbols.slice(curated.length)).toEqual(
      snapshot.universe.slice(0, 24 - curated.length).map((row) => row.symbol),
    );
    expect(plan.settings.marketOffsets.AU).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });

  it("conserva un offset interior a la cola curada HK (rotación dentro del núcleo)", async () => {
    const curated = marketSymbols("HK");
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("HK", 50));

    const plan = await planMaterializedScan({
      markets: ["HK"],
      perMarket: 8,
      limit: 8,
      offset: 5,
      marketOffsets: { HK: 5 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(5, 13));
    expect(plan.settings.marketOffsets.HK).toBe(5);
  });

  it("con markets [JP], prioriza marketSymbols(JP) y resetea offset alto", async () => {
    const curated = marketSymbols("JP");
    expect(curated.length).toBeGreaterThanOrEqual(24);
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("JP", 80));

    const plan = await planMaterializedScan({
      markets: ["JP"],
      perMarket: 24,
      limit: 24,
      offset: 130,
      marketOffsets: { JP: 130 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(0, 24));
    expect(plan.settings.marketOffsets.JP).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });

  it("con markets [DK], prioriza marketSymbols(DK) y resetea offset alto", async () => {
    const curated = marketSymbols("DK");
    expect(curated.length).toBeGreaterThanOrEqual(24);
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("DK", 80));

    const plan = await planMaterializedScan({
      markets: ["DK"],
      perMarket: 24,
      limit: 24,
      offset: 130,
      marketOffsets: { DK: 130 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(0, 24));
    expect(plan.settings.marketOffsets.DK).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });

  it("con markets [KR], prioriza marketSymbols(KR) y resetea offset alto", async () => {
    const curated = marketSymbols("KR");
    expect(curated.length).toBeGreaterThanOrEqual(24);
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("KR", 50));

    const plan = await planMaterializedScan({
      markets: ["KR"],
      perMarket: 24,
      limit: 24,
      offset: 130,
      marketOffsets: { KR: 130 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(0, 24));
    expect(plan.settings.marketOffsets.KR).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });

  it("con markets [IN], prioriza marketSymbols(IN) y resetea offset alto", async () => {
    const curated = marketSymbols("IN");
    expect(curated.length).toBeGreaterThanOrEqual(24);
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("IN", 80));

    const plan = await planMaterializedScan({
      markets: ["IN"],
      perMarket: 24,
      limit: 24,
      offset: 130,
      marketOffsets: { IN: 130 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(0, 24));
    expect(plan.settings.marketOffsets.IN).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });

  it("con markets [CA], prioriza marketSymbols(CA) y resetea offset alto", async () => {
    const curated = marketSymbols("CA");
    expect(curated.length).toBeGreaterThanOrEqual(24);
    const highOffset = curated.length + 50;
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("CA", 200));

    const plan = await planMaterializedScan({
      markets: ["CA"],
      perMarket: 24,
      limit: 24,
      offset: highOffset,
      marketOffsets: { CA: highOffset },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(0, 24));
    expect(plan.settings.marketOffsets.CA).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });

  it("con markets [GB], prioriza marketSymbols(GB) y resetea offset alto", async () => {
    const curated = marketSymbols("GB");
    expect(curated.length).toBeGreaterThanOrEqual(24);
    getUniverseEngineSnapshot.mockResolvedValue(officialDumpSnapshot("GB", 120));

    const plan = await planMaterializedScan({
      markets: ["GB"],
      perMarket: 24,
      limit: 24,
      offset: 130,
      marketOffsets: { GB: 130 },
      cronUniverseSnapshot: true,
      prioritizeMaterialization: false,
    });

    expect(plan.symbols).toEqual(curated.slice(0, 24));
    expect(plan.settings.marketOffsets.GB).toBe(0);
    expect(plan.stats.selection.priorityMode).toBe("curated-core");
  });
});
