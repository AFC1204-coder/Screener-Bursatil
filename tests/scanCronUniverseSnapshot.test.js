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
