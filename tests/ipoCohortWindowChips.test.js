import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// La frescura del precio se calcula AL LEER desde lastDate hasta hoy
// (lib/dataAge.js → livePriceFreshness), no desde priceFreshnessDays guardado:
// el reloj se fija al día siguiente del precio del fixture (2026-08-25).
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-26T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
import {
  buildIpoCohortWindowChips,
  IPO_COHORT_DEFAULT_MONTHS,
  IPO_COHORT_WINDOW_MONTHS,
  isIpoCohortLensActive,
} from "@/lib/ipoCohortWindowChips";
import { settingsForPreset } from "@/lib/screenerFilterCatalog";

function cohortRow(overrides = {}) {
  return {
    symbol: "NEW",
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
    ipoDate: "2025-06-01",
    ipoAgeMonths: 8,
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

describe("ipoCohortWindowChips", () => {
  it("expone ventanas 6/12/24/36 con default 24", () => {
    expect(IPO_COHORT_WINDOW_MONTHS).toEqual([6, 12, 24, 36]);
    expect(IPO_COHORT_DEFAULT_MONTHS).toBe(24);
  });

  it("solo activa en preset ipoDiscovery / ficha radar-ipo", () => {
    expect(isIpoCohortLensActive({ presetKey: "ipoDiscovery" })).toBe(true);
    expect(isIpoCohortLensActive({ cardId: "radar-ipo" })).toBe(true);
    expect(isIpoCohortLensActive({ presetKey: "balanced" })).toBe(false);
  });

  it("marca chip activo y cuenta filas por ventana", () => {
    const baseSettings = settingsForPreset("ipoDiscovery");
    const analyzedRows = [
      cohortRow({ symbol: "A", ipoAgeMonths: 4 }),
      cohortRow({ symbol: "B", ipoAgeMonths: 10 }),
      cohortRow({ symbol: "C", ipoAgeMonths: 20 }),
      cohortRow({ symbol: "D", ipoAgeMonths: 30 }),
    ];
    const chips = buildIpoCohortWindowChips({
      analyzedRows,
      baseSettings,
      activeMonths: 24,
    });
    expect(chips.map((chip) => chip.months)).toEqual([6, 12, 24, 36]);
    expect(chips.find((chip) => chip.months === 6)?.count).toBe(1);
    expect(chips.find((chip) => chip.months === 12)?.count).toBe(2);
    expect(chips.find((chip) => chip.months === 24)?.count).toBe(3);
    expect(chips.find((chip) => chip.months === 36)?.count).toBe(4);
    expect(chips.find((chip) => chip.months === 24)?.active).toBe(true);
  });
});
