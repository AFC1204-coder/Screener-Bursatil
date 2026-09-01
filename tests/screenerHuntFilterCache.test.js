import { describe, expect, it } from "vitest";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import {
  getOrComputeHuntFilter,
  huntFilterCacheKey,
  huntPresetActiveSettings,
  warmHuntFilterCache,
} from "@/lib/screenerHuntFilterCache";
import { HUNT_CARDS } from "@/lib/screenerHuntCards";
import { settingsForPreset, DEFAULT_FILTER_LAYERS } from "@/lib/screenerFilterCatalog";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";
import { screenerFilterRejectReason } from "@/lib/screenerFilters";
import { filterAnalyzedRows } from "@/lib/screenerPipeline";

function scoredRow(index, overrides = {}) {
  return {
    symbol: `S${index}`,
    name: `Name ${index}`,
    price: 12 + (index % 40),
    chartBarsCount: 250,
    priceFreshnessOk: true,
    lastDate: "2026-08-25",
    sma50: 18,
    sma150: 17,
    sma200: 16,
    sma200Slope: 0.25,
    weeklyStageState: "stage2",
    weeklyStageLabel: "Etapa 2",
    weeklyFastWeeks: 30,
    weeklySlowWeeks: 40,
    dataCoverageScore: 82,
    technicalCoverageScore: 84,
    fundamentalCoverageScore: 70,
    avgVolume: 1_200_000,
    latestVolume: 1_400_000,
    avgTurnover: 40_000_000,
    latestTurnover: 48_000_000,
    relativeVolume: 1.1,
    upDownVolRatio: 1.2,
    upVolume: true,
    marketCap: 800_000_000,
    weinsteinScore: 72,
    minerviniScore: 68,
    momentumScore: 60,
    riskScore: 58,
    volumeScore: 52,
    liquidityScore: 74,
    sectorScore: 62,
    weaknessScore: 18 + (index % 70),
    volatility63d: 24,
    maxDrawdown63d: -11,
    extSma50: 7,
    weeklyRsAvailable: true,
    weeklyRsRating: 74,
    rsGlobalPct: 74,
    rsCountryPct: 71,
    rsSectorPct: 68,
    rsQualityScore: 64,
    objectiveScore: 66,
    compositeScore: 66,
    totalScore: 66,
    perf3m: 12,
    perf6m: 22,
    perf12m: 34,
    distance52w: -14,
    distance20dHigh: -4,
    distance50dHigh: -7,
    theme: "Software",
    sector: "Technology",
    industry: "Software",
    country: "US",
    ...overrides,
  };
}

function stampScreenPassed(rows, settings) {
  return rows.map((row) => {
    const reason = screenerFilterRejectReason(row, settings);
    return {
      ...row,
      screenPassed: !reason,
      screenRejectField: reason?.field || null,
      screenRejectReason: reason?.reason || null,
      rowProjection: reason ? "light" : "full",
    };
  });
}

const balancedSettings = effectiveSettingsFromLayers(settingsForPreset("balanced"), DEFAULT_FILTER_LAYERS);
const context = { id: "nightly", useRegimeFilter: false, marketHealth: null };

describe("screenerHuntFilterCache", () => {
  it("huntPresetActiveSettings coincide con capas del preset", () => {
    for (const card of HUNT_CARDS) {
      const settings = huntPresetActiveSettings(card.presetKey);
      expect(settings.setupMode).toBe(settingsForPreset(card.presetKey).setupMode);
    }
  });

  it("getOrComputeHuntFilter reutiliza la vista en el segundo acceso", () => {
    const cache = new Map();
    const rows = stampScreenPassed([scoredRow(1), scoredRow(2)], balancedSettings);
    const first = getOrComputeHuntFilter(cache, "balanced", rows, context, filterAnalyzedRows);
    const second = getOrComputeHuntFilter(cache, "balanced", rows, context, filterAnalyzedRows);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.view).toBe(first.view);
    expect(cache.size).toBe(1);
  });

  it("warmHuntFilterCache materializa las 5 fichas hunt", () => {
    const cache = new Map();
    const rows = stampScreenPassed(
      Array.from({ length: 120 }, (_, index) => scoredRow(index)),
      balancedSettings,
    );
    warmHuntFilterCache(cache, rows, context, filterAnalyzedRows, { onlyIdle: false });
    const presetKeys = [...new Set(HUNT_CARDS.map((card) => card.presetKey))];
    expect(cache.size).toBe(presetKeys.length);
    for (const presetKey of presetKeys) {
      expect(cache.has(huntFilterCacheKey(presetKey, rows.length, context))).toBe(true);
    }
  });
});

describe("UX-11 · gesto hunt rail sobre ~3309 filas", () => {
  it("cada ficha hunt filtra en menos de 200 ms (sin useEffect)", () => {
    const raw = Array.from({ length: 3309 }, (_, index) => scoredRow(index, {
      perf6m: index % 4 === 0 ? 3 : 24,
      minerviniScore: index % 7 === 0 ? 18 : 68,
      ipoAgeMonths: index % 50 === 0 ? 8 : 120,
    }));
    const stamped = stampScreenPassed(raw, balancedSettings);
    const cache = new Map();
    warmHuntFilterCache(cache, stamped, context, filterAnalyzedRows, { onlyIdle: false });

    const timings = [];
    for (const card of HUNT_CARDS) {
      const startedAt = performance.now();
      const hit = getOrComputeHuntFilter(cache, card.presetKey, stamped, context, filterAnalyzedRows);
      timings.push({
        preset: card.presetKey,
        ms: performance.now() - startedAt,
        fromCache: hit.fromCache,
        rows: hit.view.rows.length,
      });
    }

    process.stdout.write(`[UX-11] hunt rail cache: ${timings.map((t) => `${t.preset}=${t.ms.toFixed(1)}ms${t.fromCache ? "(hit)" : ""}/${t.rows}rows`).join(" ")}\n`);

    for (const timing of timings) {
      expect(timing.ms).toBeLessThan(200);
    }
    expect(timings.find((t) => t.preset === "ipoDiscovery")?.rows).toBeGreaterThanOrEqual(0);

    const coldStartedAt = performance.now();
    getOrComputeHuntFilter(new Map(), "ipoDiscovery", stamped, context, filterAnalyzedRows);
    const coldMs = performance.now() - coldStartedAt;
    process.stdout.write(`[UX-11] ipo cold-path=${coldMs.toFixed(1)}ms (empty state ok)\n`);
    expect(coldMs).toBeLessThan(200);
  });
});
