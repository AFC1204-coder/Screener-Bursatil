import { describe, expect, it } from "vitest";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import {
  canUseScreenPassedFastPath,
  filterCriteriaMatchPrecomputed,
  populationNeedsRescore,
  screenerFiltersFromScan,
} from "@/lib/screenerFilterFastPath";
import { DEFAULT_FILTER_LAYERS, ALL_FILTER_LAYERS, settingsForPreset } from "@/lib/screenerFilterCatalog";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";
import { screenerFilterRejectReason, screenerFiltersFromParams } from "@/lib/screenerFilters";
import { filterAnalyzedRows, sectorize, splitByFilter } from "@/lib/screenerPipeline";

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

function legacyHotPath(rows, settings) {
  const startedAt = performance.now();
  const qualityPassed = [];
  for (const row of rows) {
    const gate = qualityGateForResearchRow(row, settings);
    if (gate.passed) qualityPassed.push({ ...row, qualityGate: gate });
  }
  const sectorized = sectorize(qualityPassed);
  const split = splitByFilter(sectorized, settings);
  return { rows: split.passed, filterMs: performance.now() - startedAt, rescored: true };
}

const balancedSettings = effectiveSettingsFromLayers(settingsForPreset("balanced"), DEFAULT_FILTER_LAYERS);
const balancedCronAlignedSettings = effectiveSettingsFromLayers(settingsForPreset("balanced"), ALL_FILTER_LAYERS);
const weaknessSettings = effectiveSettingsFromLayers(settingsForPreset("weakness"), DEFAULT_FILTER_LAYERS);
const balancedPrecomputed = screenerFiltersFromParams({ filterPreset: "balanced" });

describe("P3 · fast-path screenPassed", () => {
  it("en frío la pantalla no coincide con el nocturno (capas opcionales off)", () => {
    expect(filterCriteriaMatchPrecomputed(balancedSettings, balancedPrecomputed.values)).toBe(false);
    expect(filterCriteriaMatchPrecomputed(weaknessSettings, balancedPrecomputed.values)).toBe(false);
  });

  it("con todas las capas on, la pantalla vuelve a coincidir con el nocturno", () => {
    const allLayersSettings = effectiveSettingsFromLayers(settingsForPreset("balanced"), ALL_FILTER_LAYERS);
    expect(filterCriteriaMatchPrecomputed(allLayersSettings, balancedPrecomputed.values)).toBe(true);
  });

  it("no usa screenPassed si el usuario cambió el modo o apagó una capa núcleo", () => {
    const rows = stampScreenPassed([scoredRow(1), scoredRow(2)], balancedSettings);
    const context = { screenerFilters: balancedPrecomputed };
    expect(canUseScreenPassedFastPath(rows, balancedSettings, context)).toBe(false);
    expect(canUseScreenPassedFastPath(rows, weaknessSettings, context)).toBe(false);
    const layeredOff = effectiveSettingsFromLayers(settingsForPreset("balanced"), { ...DEFAULT_FILTER_LAYERS, trend: false });
    expect(canUseScreenPassedFastPath(rows, layeredOff, context)).toBe(false);
    const allLayersSettings = effectiveSettingsFromLayers(settingsForPreset("balanced"), ALL_FILTER_LAYERS);
    const allOnRows = stampScreenPassed([scoredRow(1), scoredRow(2)], allLayersSettings);
    expect(canUseScreenPassedFastPath(allOnRows, allLayersSettings, context)).toBe(true);
  });

  it("el fast-path devuelve los mismos símbolos que el motor de 68 reglas (capas alineadas con cron)", () => {
    const raw = Array.from({ length: 80 }, (_, index) => scoredRow(index, {
      perf6m: index % 3 === 0 ? 2 : 22,
      weinsteinScore: index % 5 === 0 ? 20 : 72,
    }));
    const stamped = stampScreenPassed(raw, balancedCronAlignedSettings);
    const context = {
      id: "nightly",
      screenerFilters: balancedPrecomputed,
      useRegimeFilter: false,
      marketHealth: null,
    };
    const fast = filterAnalyzedRows(stamped, balancedCronAlignedSettings, context);
    const viaRules = filterAnalyzedRows(stamped.map((row) => {
      const { screenPassed, screenRejectField, screenRejectReason, ...rest } = row;
      return rest;
    }), balancedCronAlignedSettings, { ...context, screenerFilters: null });
    expect(fast.path).toBe("screen-passed");
    expect(viaRules.path).toBe("rules");
    expect(fast.rows.map((row) => row.symbol)).toEqual(viaRules.rows.map((row) => row.symbol));
  });

  it("con capas opcionales off, el fast-path cae a rules aunque haya screenPassed del cron", () => {
    const stamped = stampScreenPassed([scoredRow(1), scoredRow(2)], balancedSettings);
    const view = filterAnalyzedRows(stamped, balancedSettings, {
      screenerFilters: balancedPrecomputed,
      useRegimeFilter: false,
    });
    expect(view.path).toBe("rules");
  });

  it("Balanceado → Deterioro no usa screenPassed del nocturno", () => {
    const stamped = stampScreenPassed(Array.from({ length: 20 }, (_, index) => scoredRow(index)), balancedSettings);
    const view = filterAnalyzedRows(stamped, weaknessSettings, {
      screenerFilters: balancedPrecomputed,
      useRegimeFilter: false,
    });
    expect(view.path).toBe("rules");
    expect(view.rescored).toBe(false);
  });
});

describe("P3 · medición del gesto sobre ~3309 filas", () => {
  it("omite re-sectorizar y el fast-path baja el coste frente al camino legado", () => {
    const raw = Array.from({ length: 3309 }, (_, index) => scoredRow(index, {
      perf6m: index % 4 === 0 ? 3 : 24,
      minerviniScore: index % 7 === 0 ? 18 : 68,
    }));
    const stamped = stampScreenPassed(raw, balancedCronAlignedSettings);
    expect(populationNeedsRescore(stamped)).toBe(false);

    const legacy = legacyHotPath(stamped, balancedCronAlignedSettings);
    const fast = filterAnalyzedRows(stamped, balancedCronAlignedSettings, {
      screenerFilters: balancedPrecomputed,
      useRegimeFilter: false,
    });
    const weakness = filterAnalyzedRows(stamped, weaknessSettings, {
      screenerFilters: balancedPrecomputed,
      useRegimeFilter: false,
    });

    expect(fast.path).toBe("screen-passed");
    expect(fast.rescored).toBe(false);
    expect(weakness.path).toBe("rules");
    expect(weakness.rescored).toBe(false);
    expect(fast.filterMs).toBeLessThan(legacy.filterMs);
    expect(weakness.filterMs).toBeLessThan(legacy.filterMs);

    // Evidencia para el resumen de retorno (no es umbral de CI).
    process.stdout.write(
      `[P3] n=${stamped.length} legado=${legacy.filterMs.toFixed(1)}ms fast-path=${fast.filterMs.toFixed(1)}ms deterioro=${weakness.filterMs.toFixed(1)}ms\n`,
    );
  });
});

describe("screenerFiltersFromScan", () => {
  it("lee el resumen persistido en settings del nocturno", () => {
    expect(screenerFiltersFromScan({ settings: { screenerFilters: balancedPrecomputed } })).toEqual(balancedPrecomputed);
    expect(screenerFiltersFromScan({})).toBeNull();
  });
});
