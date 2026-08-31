import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_FIELD_RULES, DEFAULT_FILTER_LAYERS, effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";
import { filterLayersForPreset, settingsForPreset } from "@/lib/screenerFilterCatalog";
import { HUNT_CARDS } from "@/lib/screenerHuntCards";
import {
  getOrComputeHuntFilter,
  huntPresetActiveSettings,
  warmHuntFilterCache,
} from "@/lib/screenerHuntFilterCache";
import { fastFilterSignature, filterAnalyzedRows } from "@/lib/screenerPipeline";
import { screenerFilterRejectReason } from "@/lib/screenerFilters";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function pageSource() {
  return readFileSync(join(root, "app/page.jsx"), "utf8");
}

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
    perf6m: index % 4 === 0 ? 3 : 24,
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

describe("BUG-HUNT-1 · applyHuntCard sin flushSync", () => {
  it("applyHuntCard no usa flushSync (evita re-render síncrono pesado)", () => {
    const source = pageSource();
    expect(source).not.toMatch(/flushSync\s*\(/);
    const applyBlock = source.slice(source.indexOf("function applyHuntCard"), source.indexOf("async function loadUniverse"));
    expect(applyBlock).toMatch(/fastFilterSignatureRef\.current = signature/);
    expect(applyBlock).toMatch(/startHuntTransition\(\(\) => \{[\s\S]*setPreset\(/);
    expect(applyBlock).toMatch(/setHuntTruthOverride\(/);
    expect(applyBlock).toMatch(/if \(cachedView\)[\s\S]*commitFilteredView\([\s\S]*startHuntTransition/);
    const transitionBlock = applyBlock.match(/startHuntTransition\(\(\) => \{[\s\S]*?\n    \}\);/)?.[0] || "";
    const commitIdx = transitionBlock.indexOf("commitFilteredView");
    const presetIdx = transitionBlock.indexOf("setPreset");
    expect(commitIdx).toBeGreaterThan(-1);
    expect(presetIdx).toBeGreaterThan(commitIdx);
    expect(source).toMatch(/isHuntTransitionPending\) return/);
  });

  it("useResultViewModel anota rows actuales si deferredRows está desalineado", () => {
    const source = readFileSync(join(root, "app/components/screener/useResultViewModel.js"), "utf8");
    expect(source).toMatch(/rowsDeferredStale \? rows : deferredRows/);
    expect(source).toMatch(/annotateSourceRows\.map\(annotateRow\)/);
  });

  it("huntPresetActiveSettings coincide con setPreset para cada ficha", () => {
    for (const card of HUNT_CARDS) {
      const fromHunt = huntPresetActiveSettings(card.presetKey);
      const fromPreset = effectiveSettingsFromLayers(
        settingsForPreset(card.presetKey),
        filterLayersForPreset(card.presetKey),
        DEFAULT_FIELD_RULES,
      );
      expect(fromHunt).toEqual(fromPreset);
    }
  });

  it("prefetch de firma evita segundo filter en el gesto hunt", () => {
    const balancedSettings = effectiveSettingsFromLayers(settingsForPreset("balanced"), DEFAULT_FILTER_LAYERS);
    const raw = Array.from({ length: 1208 }, (_, index) => scoredRow(index));
    const analyzedRows = stampScreenPassed(raw, balancedSettings);
    const scanContext = { id: "mesa-us", symbolsCount: analyzedRows.length, baseCount: analyzedRows.length };
    const context = { ...scanContext, useRegimeFilter: true, marketHealth: null };

    const cache = new Map();
    warmHuntFilterCache(cache, analyzedRows, context, filterAnalyzedRows, { onlyIdle: false });

    let filterCalls = 0;
    const countingFilter = (...args) => {
      filterCalls += 1;
      return filterAnalyzedRows(...args);
    };

    for (const card of HUNT_CARDS) {
      const nextActiveSettings = huntPresetActiveSettings(card.presetKey);
      const signature = fastFilterSignature(analyzedRows, nextActiveSettings, context);
      const fastFilterSignatureRef = { current: "" };

      fastFilterSignatureRef.current = signature;
      filterCalls = 0;
      const resolved = getOrComputeHuntFilter(
        cache,
        card.presetKey,
        analyzedRows,
        context,
        countingFilter,
      );

      const effectSignature = fastFilterSignature(analyzedRows, nextActiveSettings, context);
      const shouldSkipEffect = fastFilterSignatureRef.current === effectSignature;
      expect(shouldSkipEffect).toBe(true);
      expect(resolved.fromCache).toBe(true);
      expect(filterCalls).toBe(0);
      expect(resolved.view.rows.length).toBeGreaterThanOrEqual(0);
    }
  });
});
