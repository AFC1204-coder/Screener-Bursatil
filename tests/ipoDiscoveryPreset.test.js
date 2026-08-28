import { describe, expect, it } from "vitest";
import { screenerFilterRejectReason } from "@/lib/screenerFilters";
import {
  IPO_DISCOVERY_PRESET_KEY,
  ipoDateCoverageStats,
  ipoDiscoveryEmptyMessage,
  rowHasIpoDateSignal,
} from "@/lib/ipoDiscoveryView";
import { settingsForPreset } from "@/lib/screenerFilterCatalog";

function discoveryRow(overrides = {}) {
  return {
    symbol: "RDDT",
    price: 45,
    marketCap: 8_000_000_000,
    avgVolume: 4_000_000,
    avgTurnover: 180_000_000,
    dataCoverageScore: 70,
    technicalCoverageScore: 72,
    priceFreshnessOk: true,
    priceFreshnessDays: 1,
    priceFreshnessMaxDays: 14,
    lastDate: "2026-08-25",
    ipoDate: "2024-03-21",
    ipoAgeMonths: 17,
    perf3m: 5,
    perf6m: 12,
    perf12m: 40,
    distance20d: -8,
    distance50d: -12,
    distance52w: -15,
    distanceATH: -20,
    highsSpreadPct: 10,
    extSma50: 12,
    weinsteinScore: 55,
    minerviniScore: 48,
    momentumScore: 40,
    objectiveScore: 55,
    totalScore: 55,
    ipoScore: 50,
    rsGlobalPct: 60,
    ...overrides,
  };
}

describe("ipoDiscovery preset", () => {
  const settings = settingsForPreset(IPO_DISCOVERY_PRESET_KEY);

  it("usa modo discovery abierto con IPO reciente ≤72m", () => {
    expect(settings.filterStrictness).toBe("discovery");
    expect(settings.setupMode).toBe("ipoRecent");
    expect(settings.requireRecentIpo).toBe(true);
    expect(settings.maxIpoAgeMonths).toBe(72);
    expect(settings.minMarketCap).toBeLessThanOrEqual(50_000_000);
    expect(settings.minPerf3m).toBeLessThanOrEqual(0);
    expect(settings.minDataCoverageScore).toBeLessThanOrEqual(25);
  });

  it("acepta IPO reciente con umbrales relajados", () => {
    expect(screenerFilterRejectReason(discoveryRow(), settings)).toBe("");
  });

  it("rechaza IPO demasiado antigua", () => {
    expect(screenerFilterRejectReason(discoveryRow({ ipoAgeMonths: 96 }), settings)).toMatchObject({
      field: "requireRecentIpo",
    });
  });

  it("rechaza fila sin fecha IPO cuando requireRecentIpo está activo", () => {
    expect(screenerFilterRejectReason(discoveryRow({ ipoDate: "", ipoAgeMonths: null }), settings)).toMatchObject({
      field: "requireRecentIpo",
    });
  });
});

describe("ipoDateCoverageStats", () => {
  it("marca cobertura baja cuando casi ninguna fila trae ipoDate", () => {
    const rows = [
      discoveryRow({ symbol: "A" }),
      ...Array.from({ length: 24 }, (_, index) => ({ symbol: `B${index}` })),
    ];
    const stats = ipoDateCoverageStats(rows);
    expect(stats.withIpoDate).toBe(1);
    expect(stats.low).toBe(true);
  });

  it("detecta ipoAgeMonths sin ipoDate explícito", () => {
    expect(rowHasIpoDateSignal({ ipoAgeMonths: 8 })).toBe(true);
    expect(rowHasIpoDateSignal({ ipoDate: "2024-01-15" })).toBe(true);
    expect(rowHasIpoDateSignal({})).toBe(false);
  });
});

describe("ipoDiscoveryEmptyMessage", () => {
  it("explica ausencia total de ipoDate en el materializado", () => {
    const text = ipoDiscoveryEmptyMessage({
      analyzedCount: 3319,
      coverage: { total: 3319, withIpoDate: 0, low: true },
    });
    expect(text).toMatch(/nocturno/i);
    expect(text).toMatch(/IPO Radar/i);
  });

  it("explica cobertura parcial", () => {
    const text = ipoDiscoveryEmptyMessage({
      analyzedCount: 500,
      coverage: { total: 500, withIpoDate: 12, low: true },
    });
    expect(text).toMatch(/12 de 500/);
  });
});
