import { metricShortLabel } from "./metricCatalog.js";
import { PRIVATE_GLOBAL_RS_DISCLOSURE } from "./rsEngines.js";

export const SCREENER_ALL_SYMBOLS_LIMIT = 999999;
export const DEFAULT_PRICE_FRESHNESS_DAYS = 5;
export const DEFAULT_FILTER_STRICTNESS = "balanced";

export const FILTER_STRICTNESS = {
  strict: { name: "Exacto", desc: "Respeta cada umbral activo" },
  balanced: { name: "Balanceado", desc: "Umbrales literales del preset" },
  discovery: { name: "Descubrimiento", desc: "Preset más amplio, sin tolerancias ocultas" },
};

export const FILTER_STRICTNESS_KEYS = new Set(Object.keys(FILTER_STRICTNESS));

export const SCREENER_FILTER_QUERY_KEYS = [
  "filterPreset",
  "filterStrictness",
  "setupMode",
  "requireStage2",
  "requirePulso",
  "requireSma200Up",
  "requirePriceAboveSma50",
  "requireRecentIpo",
  "requireUpVolume",
  "requireContractionsDecreasing",
  "stageFastWeeks",
  "stageSlowWeeks",
  "stageSlopeWeeks",
  "stageFlatPct",
  "minPrice",
  "minMarketCap",
  "minAvgVolume",
  "minAvgTurnover",
  "minLatestVolume",
  "minLatestTurnover",
  "minRelativeVolume",
  "minVolumeSurgePct",
  "minUpDownVolRatio",
  "minVolumeEffectScore",
  "minShortFloatPct",
  "maxShortFloatPct",
  "minPerf3m",
  "minPerf6m",
  "minPerf12m",
  "maxDistance20dHigh",
  "maxDistance50dHigh",
  "maxDistance52w",
  "maxDistanceATH",
  "maxHighsSpreadPct",
  "maxExtensionSma50",
  "maxDailyMove20dPct",
  "maxDailyRange20dPct",
  "maxRange63dPct",
  "maxVolatility63d",
  "maxDrawdown63d",
  "minContractionCount",
  "maxContraction1DepthPct",
  "maxContraction2DepthPct",
  "maxContraction3DepthPct",
  "maxLastContractionDepthPct",
  "maxBaseDepthPct",
  "maxAbsDistanceToPivotPct",
  "maxVolumeDryUpRatio",
  "maxTightness10dPct",
  "minPatternQualityScore",
  "minRiskRewardScore",
  "minReturnToVol3m",
  "minReturnToDrawdown3m",
  "minAdProxyScore",
  "minEpsGrowthProxyScore",
  "maxPriceFreshnessDays",
  "minDataCoverageScore",
  "minTechnicalCoverageScore",
  "minFundamentalCoverageScore",
  "minRsRating",
  "minRsBenchmarkRating",
  "minRsCountryPct",
  "minRsSectorPct",
  "minRsQualityScore",
  "minSectorScore",
  "minWeinsteinScore",
  "minMinerviniScore",
  "minMomentumScore",
  "minRiskScore",
  "minVolumeScore",
  "minLiquidityScore",
  "minTotalScore",
  "minWeaknessScore",
  "maxIpoAgeMonths",
];

export const BOOLEAN_FILTER_KEYS = new Set([
  "requireStage2",
  "requirePulso",
  "requireSma200Up",
  "requirePriceAboveSma50",
  "requireRecentIpo",
  "requireUpVolume",
  "requireContractionsDecreasing",
]);

export const STRING_FILTER_KEYS = new Set(["filterStrictness", "setupMode"]);

export const QUALITY_DEFAULTS = {
  filterStrictness: DEFAULT_FILTER_STRICTNESS,
  setupMode: "leader",
  requireStage2: true,
  // Las seis condiciones diarias que antes vivían dentro de requireStage2.
  // Por defecto NO se exigen: pedir "etapa 2" debe devolver exactamente lo
  // que la tabla marca como etapa 2. Quien quiera además la estructura
  // diaria la activa.
  requirePulso: false,
  requireSma200Up: false,
  requirePriceAboveSma50: false,
  requireRecentIpo: false,
  requireUpVolume: false,
  requireContractionsDecreasing: false,
  stageFastWeeks: 10,
  stageSlowWeeks: 30,
  stageSlopeWeeks: 10,
  stageFlatPct: 2,
  maxIpoAgeMonths: 60,
  maxPriceFreshnessDays: DEFAULT_PRICE_FRESHNESS_DAYS,
  minWeinsteinScore: 50,
  minMinerviniScore: 38,
  minMomentumScore: 15,
  minRiskScore: 15,
  minVolumeScore: 0,
  minLiquidityScore: 0,
  minRsRating: 50,
  minRsBenchmarkRating: 0,
  minRsCountryPct: 0,
  minRsSectorPct: 0,
  minRsQualityScore: 0,
  minAdProxyScore: 0,
  minEpsGrowthProxyScore: 0,
  minWeaknessScore: 50,
  minSectorScore: 0,
  minTotalScore: 0,
  minDataCoverageScore: 35,
  minTechnicalCoverageScore: 45,
  minFundamentalCoverageScore: 0,
  minAvgTurnover: 1000000,
  minLatestVolume: 0,
  minLatestTurnover: 0,
  minRelativeVolume: 1,
  minVolumeSurgePct: 15,
  minUpDownVolRatio: .8,
  minVolumeEffectScore: 0,
  minShortFloatPct: 0,
  maxShortFloatPct: 999,
  minRiskRewardScore: 35,
  minReturnToVol3m: .2,
  minReturnToDrawdown3m: .5,
  maxDailyMove20dPct: 25,
  maxDailyRange20dPct: 32,
  maxRange63dPct: 120,
  maxVolatility63d: 120,
  maxDrawdown63d: 40,
  minContractionCount: 0,
  maxContraction1DepthPct: 999,
  maxContraction2DepthPct: 999,
  maxContraction3DepthPct: 999,
  maxLastContractionDepthPct: 999,
  maxBaseDepthPct: 999,
  // minBaseWeeks / maxBaseWeeks: retirados de aquí (y de FILTER_GROUPS,
  // FIELD_RULES, FILTER_FIELD_LAYERS y NEUTRAL_FIELD_VALUES más abajo). El
  // campo que comparaban, baseWeeks, no mide nada del valor: es
  // min(65, nº de barras) / 5, y como el nocturno guarda 400 barras por
  // símbolo (WRITE_CAP_DEFAULT en lib/dailyBarsCache.js) el cociente daba
  // siempre 65/5 = 13.0 — el 100% de las 3.312 filas del nocturno del
  // 2026-08-17. Con el filtro activo, cualquier min/max distinto de 13
  // vaciaba el resultado sin que el usuario supiera por qué. Misma firma que
  // el término IPO (un cálculo que siempre da el mismo valor disfrazado de
  // dato real). El cálculo de baseWeeks en lib/setupPatterns.js se conserva
  // (otros consumidores lo leen), sólo se retira la capacidad de filtrar por
  // él. Para reactivarlo hace falta el detector de bases real diseñado en
  // docs/diseno-contracciones-2026-08-17.md — que sustituye la ventana fija
  // de 65 sesiones por contracciones decrecientes reales — y que a fecha de
  // este commit no alcanza precisión suficiente (2/8 bases reales
  // detectadas en el corpus de calibración; objetivo ≥6/8).
  maxAbsDistanceToPivotPct: 999,
  maxVolumeDryUpRatio: 999,
  maxTightness10dPct: 999,
  minPatternQualityScore: 0,
};

export const SCREENER_FILTER_PRESETS = {
  balanced: { name: "Balanceado", desc: "Tendencia alcista amplia con sesgo profesional", v: { ...QUALITY_DEFAULTS, minMarketCap: 200000000, minPrice: 2, minAvgVolume: 150000, minAvgTurnover: 1500000, maxDistance20dHigh: 20, maxDistance50dHigh: 30, maxDistance52w: 40, maxDistanceATH: 70, maxHighsSpreadPct: 25, minPerf3m: 3, minPerf6m: 8, minPerf12m: 12, maxExtensionSma50: 45, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  strict: { name: "Líderes estrictos", desc: "Muy selectivo", v: { ...QUALITY_DEFAULTS, filterStrictness: "strict", setupMode: "leader", minMarketCap: 500000000, minPrice: 5, minAvgVolume: 500000, minAvgTurnover: 10000000, minLatestVolume: 250000, minLatestTurnover: 5000000, minUpDownVolRatio: 1, minVolumeEffectScore: 35, maxDistance20dHigh: 5, maxDistance50dHigh: 10, maxDistance52w: 15, maxDistanceATH: 25, maxHighsSpreadPct: 8, minPerf3m: 15, minPerf6m: 30, minPerf12m: 50, maxExtensionSma50: 25, maxDailyMove20dPct: 12, maxDailyRange20dPct: 16, maxRange63dPct: 55, maxVolatility63d: 60, maxDrawdown63d: 22, minWeinsteinScore: 75, minMinerviniScore: 65, minMomentumScore: 45, minRiskScore: 50, minVolumeScore: 30, minLiquidityScore: 35, minRsRating: 75, minDataCoverageScore: 50, minTechnicalCoverageScore: 70, minSectorScore: 55, minTotalScore: 68, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  early: { name: "Etapa 2 temprana", desc: "Bases y líderes tempranos", v: { ...QUALITY_DEFAULTS, setupMode: "early", requireStage2: false, requireSma200Up: false, minMarketCap: 150000000, minPrice: 2, minAvgVolume: 100000, minAvgTurnover: 1000000, maxDistance20dHigh: 18, maxDistance50dHigh: 30, maxDistance52w: 38, maxDistanceATH: 65, maxHighsSpreadPct: 25, minPerf3m: 0, minPerf6m: 5, minPerf12m: 8, maxExtensionSma50: 28, maxDailyMove20dPct: 25, maxDailyRange20dPct: 34, maxRange63dPct: 120, maxVolatility63d: 120, minWeinsteinScore: 40, minMinerviniScore: 30, minMomentumScore: 10, minRsRating: 45, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  broad: { name: "Exploratorio amplio", desc: "Más candidatos / diagnóstico", v: { ...QUALITY_DEFAULTS, filterStrictness: "discovery", setupMode: "any", requireStage2: false, requireSma200Up: false, minDataCoverageScore: 20, minTechnicalCoverageScore: 35, minMarketCap: 150000000, minPrice: 2, minAvgVolume: 100000, minAvgTurnover: 1000000, minLatestVolume: 0, minLatestTurnover: 0, minUpDownVolRatio: 0, minVolumeEffectScore: 0, maxDistance20dHigh: 25, maxDistance50dHigh: 35, maxDistance52w: 40, maxDistanceATH: 60, maxHighsSpreadPct: 35, minPerf3m: 0, minPerf6m: 5, minPerf12m: 10, maxExtensionSma50: 45, maxDailyMove20dPct: 999, maxDailyRange20dPct: 999, maxRange63dPct: 999, maxVolatility63d: 999, maxDrawdown63d: 999, minWeinsteinScore: 25, minMinerviniScore: 20, minMomentumScore: 0, minRiskScore: 0, minVolumeScore: 0, minLiquidityScore: 0, minRsRating: 0, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  // No mezclar con settings del materializado (minMarketCap/minAvgTurnover del cron):
  // restoreSnapshot debe llamar settingsForPreset("intl") sin overrides de scan.
  intl: { name: "Intl / multi-mercado", desc: "Fuera de US: sin RS canónico ni liquidez NYSE", v: { ...QUALITY_DEFAULTS, filterStrictness: "discovery", setupMode: "any", requireStage2: false, requireSma200Up: false, requirePriceAboveSma50: false, minDataCoverageScore: 20, minTechnicalCoverageScore: 30, minFundamentalCoverageScore: 0, minMarketCap: 50000000, minPrice: 1, minAvgVolume: 25000, minAvgTurnover: 100000, minLatestVolume: 0, minLatestTurnover: 0, minRelativeVolume: 0, minVolumeSurgePct: -999, minUpDownVolRatio: 0, minVolumeEffectScore: 0, maxDistance20dHigh: 30, maxDistance50dHigh: 40, maxDistance52w: 50, maxDistanceATH: 80, maxHighsSpreadPct: 40, minPerf3m: -100, minPerf6m: -100, minPerf12m: -100, maxExtensionSma50: 55, maxDailyMove20dPct: 999, maxDailyRange20dPct: 999, maxRange63dPct: 999, maxVolatility63d: 999, maxDrawdown63d: 999, minWeinsteinScore: 0, minMinerviniScore: 0, minMomentumScore: 0, minRiskScore: 0, minVolumeScore: 0, minLiquidityScore: 0, minRsRating: 0, minRsBenchmarkRating: 0, minRsCountryPct: 0, minRsSectorPct: 0, minRsQualityScore: 0, minSectorScore: 0, minTotalScore: 0, minRiskRewardScore: 0, minReturnToVol3m: -999, minReturnToDrawdown3m: -999, maxPriceFreshnessDays: 14, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  ipo: { name: "IPO / nuevos líderes", desc: "IPO reales recientes", v: { ...QUALITY_DEFAULTS, setupMode: "ipoRecent", requireStage2: false, requireSma200Up: false, requireRecentIpo: true, maxIpoAgeMonths: 60, minDataCoverageScore: 35, minTechnicalCoverageScore: 45, minFundamentalCoverageScore: 0, minMarketCap: 300000000, minPrice: 5, minAvgVolume: 200000, maxDistance20dHigh: 15, maxDistance50dHigh: 25, maxDistance52w: 30, maxDistanceATH: 40, maxHighsSpreadPct: 20, minPerf3m: 10, minPerf6m: 0, minPerf12m: -100, maxExtensionSma50: 35, maxDailyMove20dPct: 28, maxDailyRange20dPct: 34, maxRange63dPct: 120, maxVolatility63d: 140, minWeinsteinScore: 30, minMinerviniScore: 30, minMomentumScore: 35, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  // Ficha Radar IPO (IPO-1b): discovery abierto, multi-mercado; no sustituye `ipo` institucional.
  ipoDiscovery: { name: "IPO discovery", desc: "Cotizando reciente: umbrales abiertos", v: { ...QUALITY_DEFAULTS, filterStrictness: "discovery", setupMode: "ipoRecent", requireStage2: false, requireSma200Up: false, requirePriceAboveSma50: false, requireRecentIpo: true, maxIpoAgeMonths: 72, minDataCoverageScore: 20, minTechnicalCoverageScore: 30, minFundamentalCoverageScore: 0, minMarketCap: 50000000, minPrice: 1, minAvgVolume: 25000, minAvgTurnover: 100000, minLatestVolume: 0, minLatestTurnover: 0, minRelativeVolume: 0, minVolumeSurgePct: -999, minUpDownVolRatio: 0, minVolumeEffectScore: 0, maxDistance20dHigh: 30, maxDistance50dHigh: 40, maxDistance52w: 50, maxDistanceATH: 80, maxHighsSpreadPct: 40, minPerf3m: -100, minPerf6m: -100, minPerf12m: -100, maxExtensionSma50: 55, maxDailyMove20dPct: 999, maxDailyRange20dPct: 999, maxRange63dPct: 999, maxVolatility63d: 999, maxDrawdown63d: 999, minWeinsteinScore: 0, minMinerviniScore: 0, minMomentumScore: 0, minRiskScore: 0, minVolumeScore: 0, minLiquidityScore: 0, minRsRating: 0, minRsBenchmarkRating: 0, minRsCountryPct: 0, minRsSectorPct: 0, minRsQualityScore: 0, minSectorScore: 0, minTotalScore: 0, minRiskRewardScore: 0, minReturnToVol3m: -999, minReturnToDrawdown3m: -999, maxPriceFreshnessDays: 14, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  nearPivot: { name: "Vigilancia pivot", desc: "Fuerte, cerca de zona de pivot y poco extendida; no implica plan automático", v: { ...QUALITY_DEFAULTS, setupMode: "nearPivot", minMarketCap: 250000000, minPrice: 3, minAvgVolume: 200000, minAvgTurnover: 2000000, maxDistance20dHigh: 6, maxDistance50dHigh: 12, maxDistance52w: 20, maxDistanceATH: 35, maxHighsSpreadPct: 10, minPerf3m: 6, minPerf6m: 12, minPerf12m: 18, maxExtensionSma50: 18, maxDailyMove20dPct: 14, maxDailyRange20dPct: 18, maxRange63dPct: 60, maxVolatility63d: 70, maxDrawdown63d: 22, minRiskScore: 45, minWeinsteinScore: 60, minMinerviniScore: 50, minRsRating: 58, minDataCoverageScore: 35, minTechnicalCoverageScore: 50, minTotalScore: 55, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
  weakness: { name: "Deterioro técnico", desc: "Debilidad para evitar largos", v: { ...QUALITY_DEFAULTS, filterStrictness: "strict", setupMode: "weakness", requireStage2: false, requireSma200Up: false, requirePriceAboveSma50: false, requireRecentIpo: false, requireUpVolume: false, minMarketCap: 150000000, minPrice: 2, minAvgVolume: 100000, minAvgTurnover: 0, minLatestVolume: 0, minLatestTurnover: 0, maxDistance20dHigh: 999, maxDistance50dHigh: 999, maxDistance52w: 999, maxDistanceATH: 999, maxHighsSpreadPct: 999, minPerf3m: -100, minPerf6m: -100, minPerf12m: -100, maxExtensionSma50: 999, minWeinsteinScore: 0, minMinerviniScore: 0, minMomentumScore: 0, minRiskScore: 0, minVolumeScore: 0, minLiquidityScore: 0, minRsRating: 0, minRsQualityScore: 0, minWeaknessScore: 55, minSectorScore: 0, minTotalScore: 0, minRelativeVolume: 0, minVolumeSurgePct: -999, minUpDownVolRatio: 0, minVolumeEffectScore: 0, minRiskRewardScore: 0, minReturnToVol3m: -999, minReturnToDrawdown3m: -999, maxDailyMove20dPct: 999, maxDailyRange20dPct: 999, maxRange63dPct: 999, maxVolatility63d: 999, maxDrawdown63d: 999, maxSymbols: SCREENER_ALL_SYMBOLS_LIMIT } },
};

function stripInternalPresetFields(values = {}) {
  const { maxSymbols, ...rest } = values;
  return rest;
}

export const SCREENER_WEB_FILTER_PRESETS = Object.fromEntries(
  Object.entries(SCREENER_FILTER_PRESETS).map(([key, preset]) => [key, stripInternalPresetFields(preset.v)]),
);

export function filterStrictnessForPreset(key = "balanced") {
  const strictness = SCREENER_FILTER_PRESETS[key]?.v?.filterStrictness || DEFAULT_FILTER_STRICTNESS;
  return FILTER_STRICTNESS[strictness] ? strictness : DEFAULT_FILTER_STRICTNESS;
}

export function settingsForPreset(key = "balanced", overrides = {}) {
  const preset = SCREENER_FILTER_PRESETS[key] || SCREENER_FILTER_PRESETS.balanced;
  return { ...preset.v, filterStrictness: filterStrictnessForPreset(key), ...overrides };
}

/** Claves del jobs/scan-refresh que no deben pisar umbrales del preset de UI. */
export const MATERIALIZED_SCAN_SETTING_KEYS = new Set([
  "legalMode",
  "limit",
  "marketOffsets",
  "markets",
  "materializationLookbackDays",
  "maxFundamentalsAgeDays",
  "maxPriceFreshnessDays",
  "minAvgTurnover",
  "minBars",
  "minCoverageScore",
  "minMarketCap",
  "minPrice",
  "nextMarketOffsets",
  "offset",
  "perMarket",
  "population",
  "prioritizeMaterialization",
  "priorityMode",
  "progress",
  "recentScanDays",
  "screenerFilters",
  "shadowSource",
  "skipRecentlyScanned",
  "source",
]);

/** Overrides seguros al restaurar un materializado: nunca reintroducir puertas del cron. */
export function uiSettingsOverridesFromScan(scanSettings = {}, presetKey = "") {
  if (String(presetKey || "") === "intl") return {};
  const out = {};
  for (const [key, value] of Object.entries(scanSettings || {})) {
    if (MATERIALIZED_SCAN_SETTING_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Presets US-céntricos que vacían lotes intl si el usuario no incluye US. */
export const INTL_AUTO_SWITCH_PRESET_KEYS = new Set(["balanced", "strict", "nearPivot", "early", "ipo"]);

export function marketSelectionIncludesUs(markets = []) {
  return (Array.isArray(markets) ? markets : []).some((code) => String(code || "").toUpperCase() === "US");
}

export function shouldAutoApplyIntlFilterPreset(markets = [], presetKey = "") {
  const key = String(presetKey || "").trim();
  if (!key || key === "intl" || key === "broad" || key === "weakness") return false;
  if (marketSelectionIncludesUs(markets)) return false;
  return INTL_AUTO_SWITCH_PRESET_KEYS.has(key);
}

/** Al volver a US (o mezclar US), el default de producto es Balanceado — no dejar intl pegado. */
export function shouldAutoRestoreBalancedFilterPreset(markets = [], presetKey = "") {
  if (String(presetKey || "").trim() !== "intl") return false;
  return marketSelectionIncludesUs(markets);
}

export function intlPresetAutoApplyStatus() {
  return "Preset Intl aplicado (fuera de US)";
}

export const SETUP_MODES = [
  ["leader", "Líder etapa 2"],
  ["nearPivot", "Vigilancia pivot"],
  ["pullback", "Pullback SMA50"],
  ["early", "Etapa 2 temprana"],
  ["ipoRecent", "IPO reciente real"],
  ["extended", "Extendida fuerte"],
  ["weakness", "Deterioro técnico"],
  ["any", "Exploratorio"],
];

export const SETUP_MODE_DEFAULTS = {
  leader: { setupMode: "leader", requireStage2: true, requireRecentIpo: false },
  nearPivot: { setupMode: "nearPivot", requireStage2: true, requireRecentIpo: false, maxDistance20dHigh: 6, maxDistance50dHigh: 12, maxDistance52w: 20, maxDistanceATH: 35, maxHighsSpreadPct: 10, maxExtensionSma50: 18, minRiskScore: 45, minWeinsteinScore: 60, minMinerviniScore: 50, minRsRating: 58, minTotalScore: 55 },
  pullback: { setupMode: "pullback", requireStage2: true, requireRecentIpo: false, maxDistance20dHigh: 18, maxDistance50dHigh: 30, maxDistance52w: 35, maxDistanceATH: 65, maxHighsSpreadPct: 25, maxExtensionSma50: 24, minPerf3m: 0, minPerf6m: 8, minPerf12m: 12, minMomentumScore: 10, minRiskScore: 20 },
  early: { setupMode: "early", requireStage2: false, requireRecentIpo: false, minWeinsteinScore: 40, minMinerviniScore: 30, minMomentumScore: 10, minRsRating: 45, minPerf3m: 0, minPerf6m: 5, minPerf12m: 8, maxDistance20dHigh: 18, maxDistance50dHigh: 30, maxDistance52w: 38, maxDistanceATH: 65, maxHighsSpreadPct: 25, maxExtensionSma50: 28 },
  ipoRecent: { setupMode: "ipoRecent", requireStage2: false, requireRecentIpo: true, maxIpoAgeMonths: 60, minDataCoverageScore: 35, minTechnicalCoverageScore: 45, minPerf3m: 10, minPerf6m: 0, minPerf12m: -100, maxDistance20dHigh: 15, maxDistance50dHigh: 25, maxDistance52w: 30, maxDistanceATH: 40, maxHighsSpreadPct: 20, maxExtensionSma50: 35, minWeinsteinScore: 30, minMinerviniScore: 30, minMomentumScore: 35 },
  extended: { setupMode: "extended", requireStage2: true, requireRecentIpo: false, minPerf3m: 12, minPerf6m: 25, minPerf12m: 35, minMomentumScore: 55, maxExtensionSma50: 55, maxDistance20dHigh: 25, maxDistance50dHigh: 35, maxDistance52w: 35, maxDistanceATH: 60 },
  weakness: { ...SCREENER_WEB_FILTER_PRESETS.weakness },
  any: { setupMode: "any", filterStrictness: "discovery", requireStage2: false, requireRecentIpo: false, minWeinsteinScore: 20, minMinerviniScore: 20, minMomentumScore: 0, minRiskScore: 0, minTotalScore: 0, minRsRating: 0, minPerf3m: 0, minPerf6m: 5, minPerf12m: 10, maxDistance20dHigh: 25, maxDistance50dHigh: 35, maxDistance52w: 45, maxDistanceATH: 70, maxHighsSpreadPct: 35, maxExtensionSma50: 45, minDataCoverageScore: 20, minTechnicalCoverageScore: 35 },
};

export function setupModeDefaults(mode = "leader") {
  const key = SETUP_MODE_DEFAULTS[mode] ? mode : "leader";
  return { ...SETUP_MODE_DEFAULTS[key], setupMode: key };
}

// Orden Núcleo → Adicionales (mismo contrato que CORE_LAYER_KEYS / OPTIONAL_LAYER_KEYS).
export const FILTER_FAMILY_ORDER = [
  "liquidity",
  "trend",
  "momentum",
  "relativeStrength",
  "proximity",
  "volatility",
  "score",
  "coverage",
  "pattern",
  "volumeSurge",
  "riskReward",
  "shortInterest",
  "ipo",
];

function familyLayerCount(family) {
  return family.fields.length + (family.settingKeys?.length || 0);
}

export const FILTER_FAMILIES = {
  liquidity: {
    key: "liquidity",
    label: "Liquidez",
    title: "Liquidez",
    detail: "precio, cap, importe",
    intro: "Precio, capitalizacion, volumen e importe.",
    settingKeys: [],
    fields: [
      { key: "minPrice", label: "Precio min", unit: "", step: 1 },
      { key: "minMarketCap", label: "Market cap min", unit: "M", scale: 1000000, step: 50 },
      { key: "minAvgVolume", label: "Acciones/día 20d min", unit: "k", scale: 1000, step: 25, hint: "Media de acciones negociadas en las últimas 20 sesiones." },
      { key: "minAvgTurnover", label: "Importe 20d min", unit: "M", scale: 1000000, step: 1, hint: "Precio x volumen medio 20d en moneda de cotización. En mercados no USD no convierte divisa." },
      { key: "minLiquidityScore", label: "Liquidity score min", unit: "", step: 5 },
    ],
    actions: [
      { label: "Institucional", detail: "Mayor tamaño y turnover.", settings: { minPrice: 5, minMarketCap: 500000000, minAvgVolume: 500000, minAvgTurnover: 10000000 } },
      { label: "Normal", detail: "Base global equilibrada.", settings: { minPrice: 2, minMarketCap: 200000000, minAvgVolume: 150000, minAvgTurnover: 1500000 } },
      { label: "Small caps", detail: "Amplia liquidez para descubrimiento.", settings: { minPrice: 2, minMarketCap: 150000000, minAvgVolume: 100000, minAvgTurnover: 1000000 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  trend: {
    key: "trend",
    label: "Tendencia",
    title: "Tendencia",
    detail: "Etapa / tendencia primaria",
    intro: "Etapa, medias y calidad de estructura de tendencia y de ruptura.",
    settingKeys: ["requireStage2", "requirePulso"],
    fields: [
      { key: "minWeinsteinScore", label: "Estructura tend. min", unit: "", step: 5 },
      { key: "minMinerviniScore", label: "Estructura rupt. min", unit: "", step: 5 },
    ],
    actions: [
      { label: "Líder etapa 2", detail: "Filtro direccional clásico.", settings: { setupMode: "leader", requireStage2: true, minWeinsteinScore: 65, minMinerviniScore: 55 }, fieldRules: { minWeinsteinScore: true, minMinerviniScore: true } },
      { label: "Base temprana", detail: "Permite transición sin etapa 2 estricta.", settings: { setupMode: "early", requireStage2: false, minWeinsteinScore: 45, minMinerviniScore: 35 } },
      { label: "Explorar tendencia", detail: "Abre el filtro de tendencia.", settings: { setupMode: "any", requireStage2: false, minWeinsteinScore: 20, minMinerviniScore: 20 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  momentum: {
    key: "momentum",
    label: "Momentum",
    title: "Momentum",
    detail: "3M, 6M, 12M",
    intro: "Fuerza de precio en 3, 6 y 12 meses.",
    settingKeys: [],
    fields: [
      { key: "minPerf3m", label: "Perf 3M min", unit: "%", step: 1 },
      { key: "minPerf6m", label: "Perf 6M min", unit: "%", step: 1 },
      { key: "minPerf12m", label: "Perf 12M min", unit: "%", step: 1 },
      { key: "minMomentumScore", label: "Momentum score min", unit: "", step: 5 },
    ],
    actions: [
      { label: "Momentum fuerte", detail: "Busca líderes con aceleración clara.", settings: { minPerf3m: 15, minPerf6m: 30, minPerf12m: 45, minMomentumScore: 45 }, fieldRules: { minPerf3m: true, minPerf6m: true, minPerf12m: true, minMomentumScore: true } },
      { label: "Pullback sano", detail: "Exige tendencia, afloja 3M.", settings: { setupMode: "pullback", minPerf3m: 0, minPerf6m: 15, minPerf12m: 25, minMomentumScore: 25 } },
      { label: "Descubrimiento", detail: "Más candidatos, menos sesgo a 12M.", settings: { minPerf3m: 0, minPerf6m: 5, minPerf12m: 10, minMomentumScore: 0 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  relativeStrength: {
    key: "relativeStrength",
    label: "RS",
    title: "Fuerza relativa",
    detail: `${PRIVATE_GLOBAL_RS_DISCLOSURE}; bench/país/grupo son auxiliares`,
    intro: "La columna RS y el umbral mínimo comparten el ranking semanal global (universo privado curado, base USD con FX). Bench, país, grupo y quality son filtros auxiliares o percentiles de lote; no sustituyen el RS global.",
    intensityPilot: true,
    settingKeys: [],
    fields: [
      { key: "minRsRating", label: `${metricShortLabel("rsGlobalPct")} min`, unit: "", step: 5 },
      { key: "minRsBenchmarkRating", label: `${metricShortLabel("rsRating")} min`, unit: "", step: 5 },
      { key: "minRsCountryPct", label: `${metricShortLabel("rsCountryPct")} min`, unit: "", step: 5 },
      { key: "minRsSectorPct", label: `${metricShortLabel("rsSectorPct")} min`, unit: "", step: 5 },
      { key: "minRsQualityScore", label: `${metricShortLabel("rsQualityScore")} min`, unit: "", step: 5 },
      { key: "minSectorScore", label: "Fuerza grupo min", unit: "", step: 5 },
    ],
    actions: [
      { label: "Top RS", detail: "Solo nombres claramente fuertes.", settings: { minRsRating: 75, minRsBenchmarkRating: 60, minRsQualityScore: 60, minSectorScore: 55 } },
      { label: "Sector líder", detail: "Prioriza grupos fuertes.", settings: { minRsRating: 60, minRsBenchmarkRating: 0, minRsQualityScore: 40, minSectorScore: 65 } },
      { label: "RS abierto", detail: "No corta por ranking relativo.", settings: { minRsRating: 0, minRsBenchmarkRating: 0, minRsCountryPct: 0, minRsSectorPct: 0, minRsQualityScore: 0, minSectorScore: 0 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  proximity: {
    key: "proximity",
    label: "Cercanía",
    title: "Cercania",
    detail: "máximos y extensión",
    intro: "Distancia a máximos, pivots y extensión.",
    settingKeys: [],
    fields: [
      { key: "maxDistance20dHigh", label: "Max caída vs 20d", unit: "%", step: 1 },
      { key: "maxDistance50dHigh", label: "Max caída vs 50d", unit: "%", step: 1 },
      { key: "maxDistance52w", label: "Max caída vs 52w", unit: "%", step: 1 },
      { key: "maxDistanceATH", label: "Max caída vs ATH", unit: "%", step: 1 },
      { key: "maxHighsSpreadPct", label: "Highs spread max", unit: "%", step: 1 },
      { key: "maxExtensionSma50", label: "Extensión SMA50 max", unit: "%", step: 1 },
    ],
    actions: [
      { label: "Vigilancia pivot", detail: "Cerca de máximos/pivot y poco extendida; requiere lectura posterior.", settings: { setupMode: "nearPivot", maxDistance20dHigh: 5, maxDistance50dHigh: 10, maxDistance52w: 18, maxHighsSpreadPct: 8, maxExtensionSma50: 15 } },
      { label: "Pullback amplio", detail: "Tolera bases más profundas.", settings: { setupMode: "pullback", maxDistance20dHigh: 15, maxDistance50dHigh: 25, maxDistance52w: 32, maxHighsSpreadPct: 20, maxExtensionSma50: 22 } },
      { label: "Sin cercanía", detail: "No corta por distancia a máximos.", filterLayers: { proximity: false }, settings: { setupMode: "any", maxDistance20dHigh: 999, maxDistance50dHigh: 999, maxDistance52w: 999, maxDistanceATH: 999, maxHighsSpreadPct: 999, maxExtensionSma50: 999 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  volatility: {
    key: "volatility",
    label: "Volatilidad",
    title: "Volatilidad",
    detail: "movimiento y rango",
    intro: "Rango, drawdown y movimiento diario.",
    settingKeys: [],
    fields: [
      { key: "maxDailyMove20dPct", label: "Movimiento diario max 20d", unit: "%", step: 1, hint: "Mayor cambio absoluto cierre-cierre de las últimas 20 sesiones." },
      { key: "maxDailyRange20dPct", label: "Rango intradía max 20d", unit: "%", step: 1, hint: "Mayor rango high-low relativo al cierre en las últimas 20 sesiones." },
      { key: "maxRange63dPct", label: "Rango precio 63d max", unit: "%", step: 5, hint: "Amplitud high-low de los últimos tres meses." },
      { key: "maxVolatility63d", label: "Volatilidad anualizada max", unit: "%", step: 5 },
      { key: "maxDrawdown63d", label: "Drawdown 3M max", unit: "%", step: 1 },
    ],
    actions: [
      { label: "Conservador", detail: "Evita nombres bruscos.", settings: { maxDailyMove20dPct: 10, maxDailyRange20dPct: 14, maxRange63dPct: 45, maxVolatility63d: 55, maxDrawdown63d: 18 } },
      { label: "Balanceado", detail: "Riesgo técnico normal.", settings: { maxDailyMove20dPct: 18, maxDailyRange20dPct: 22, maxRange63dPct: 85, maxVolatility63d: 85, maxDrawdown63d: 32 } },
      { label: "Permisivo", detail: "No bloquea por volatilidad.", settings: { maxDailyMove20dPct: 999, maxDailyRange20dPct: 999, maxRange63dPct: 999, maxVolatility63d: 999, maxDrawdown63d: 999 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  score: {
    key: "score",
    label: "Scores",
    title: "Scores",
    detail: "minimos composite",
    intro: "Calidad compuesta y proxies técnicos.",
    settingKeys: [],
    fields: [
      { key: "minRiskScore", label: "Risk score min", unit: "", step: 5 },
      { key: "minVolumeScore", label: "Volume score min", unit: "", step: 5 },
      { key: "minTotalScore", label: "Score compuesto min", unit: "", step: 5 },
      { key: "minAdProxyScore", label: `${metricShortLabel("adProxyScore")} min`, unit: "", step: 5, hint: "Proxy 0-100 de acumulación/distribución usando up/down volume, volumen relativo y cierre con volumen." },
      { key: "minEpsGrowthProxyScore", label: `${metricShortLabel("epsGrowthProxyScore")} min`, unit: "", step: 5, hint: "Proxy 0-100 de crecimiento/calidad con beneficios, ventas, margenes y ROE si el proveedor devuelve datos." },
      { key: "minWeaknessScore", label: "Deterioro min", unit: "", step: 5 },
    ],
    actions: [
      { label: "Alta calidad", detail: "Score compuesto alto y proxies exigentes.", settings: { minTotalScore: 68, minRiskScore: 50, minVolumeScore: 30, minEpsGrowthProxyScore: 35 } },
      { label: "Calidad media", detail: "Filtro usable para daily scan.", settings: { minTotalScore: 55, minRiskScore: 30, minVolumeScore: 15, minEpsGrowthProxyScore: 0 } },
      { label: "Abrir scores", detail: "Deja pasar para diagnosticar.", settings: { minTotalScore: 0, minRiskScore: 0, minVolumeScore: 0, minEpsGrowthProxyScore: 0, minWeaknessScore: 0 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  coverage: {
    key: "coverage",
    label: "Cobertura",
    title: "Cobertura",
    detail: "calidad mínima de datos",
    intro: "Calidad y frescura de datos.",
    settingKeys: [],
    fields: [
      { key: "maxPriceFreshnessDays", label: "Precio fresco max", unit: "d", step: 1, hint: "Días máximos desde la última vela diaria. Si el dato está viejo, la acción no entra en rankings operativos." },
      { key: "minDataCoverageScore", label: "Cobertura total min", unit: "", step: 5 },
      { key: "minTechnicalCoverageScore", label: "Cobertura técnica min", unit: "", step: 5 },
      { key: "minFundamentalCoverageScore", label: "Cobertura fundamental min", unit: "", step: 5 },
    ],
    actions: [
      { label: "Datos limpios", detail: "Ficha fiable para decisión.", settings: { maxPriceFreshnessDays: 3, minDataCoverageScore: 65, minTechnicalCoverageScore: 80, minFundamentalCoverageScore: 35 } },
      { label: "Normal", detail: "Balance entre cobertura y amplitud.", settings: { maxPriceFreshnessDays: DEFAULT_PRICE_FRESHNESS_DAYS, minDataCoverageScore: 35, minTechnicalCoverageScore: 45, minFundamentalCoverageScore: 0 } },
      { label: "Permitir parcial", detail: "Util para mercados con datos incompletos.", settings: { maxPriceFreshnessDays: 10, minDataCoverageScore: 20, minTechnicalCoverageScore: 35, minFundamentalCoverageScore: 0 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  pattern: {
    key: "pattern",
    label: "Estructura",
    title: "Estructura",
    detail: "contracciones, base y pivot",
    intro: "Contracciones, base reciente, pivot estimado y volumen seco. La app mide evidencia; no etiqueta recomendaciones.",
    settingKeys: ["requireContractionsDecreasing"],
    fields: [
      { key: "minContractionCount", label: "Contracciones min", unit: "", step: 1, hint: "Número de pullbacks medidos por swings locales dentro de la base reciente." },
      { key: "maxContraction1DepthPct", label: "Contracción 1 max", unit: "%", step: 1 },
      { key: "maxContraction2DepthPct", label: "Contracción 2 max", unit: "%", step: 1 },
      { key: "maxContraction3DepthPct", label: "Contracción 3 max", unit: "%", step: 1 },
      { key: "maxLastContractionDepthPct", label: "Última contracción max", unit: "%", step: 1 },
      { key: "maxBaseDepthPct", label: "Profundidad base max", unit: "%", step: 1 },
      { key: "maxAbsDistanceToPivotPct", label: "Distancia pivot max", unit: "%", step: .5 },
      { key: "maxVolumeDryUpRatio", label: "Volumen seco max", unit: "x", step: .05, hint: "Volumen medio 10d dividido entre volumen medio 50d." },
      { key: "maxTightness10dPct", label: "Rango 10d max", unit: "%", step: .5 },
      { key: "minPatternQualityScore", label: "Calidad estructura min", unit: "", step: 5 },
    ],
    actions: [
      { label: "Contraccion progresiva", detail: "3 pullbacks decrecientes con base controlada.", filterLayers: { pattern: true }, settings: { requireContractionsDecreasing: true, minContractionCount: 3, maxContraction1DepthPct: 25, maxContraction2DepthPct: 16, maxContraction3DepthPct: 8, maxLastContractionDepthPct: 8, maxBaseDepthPct: 35, maxAbsDistanceToPivotPct: 6, maxVolumeDryUpRatio: .9, maxTightness10dPct: 12 } },
      { label: "Base en vigilancia", detail: "Misma logica, algo más permisiva para seguimiento.", filterLayers: { pattern: true }, settings: { requireContractionsDecreasing: true, minContractionCount: 3, maxContraction1DepthPct: 30, maxContraction2DepthPct: 20, maxContraction3DepthPct: 12, maxLastContractionDepthPct: 12, maxBaseDepthPct: 40, maxAbsDistanceToPivotPct: 10, maxVolumeDryUpRatio: 1, maxTightness10dPct: 16, minPatternQualityScore: 50 } },
      { label: "Base estrecha", detail: "Rango reciente contenido cerca de pivot.", filterLayers: { pattern: true }, settings: { requireContractionsDecreasing: false, minContractionCount: 1, maxBaseDepthPct: 25, maxAbsDistanceToPivotPct: 8, maxTightness10dPct: 8, minPatternQualityScore: 55 } },
      { label: "Sin estructura", detail: "Desactiva esta familia opcional.", filterLayers: { pattern: false }, settings: { requireContractionsDecreasing: false, minContractionCount: 0, maxContraction1DepthPct: 999, maxContraction2DepthPct: 999, maxContraction3DepthPct: 999, maxLastContractionDepthPct: 999, maxBaseDepthPct: 999, maxAbsDistanceToPivotPct: 999, maxVolumeDryUpRatio: 999, maxTightness10dPct: 999, minPatternQualityScore: 0 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  volumeSurge: {
    key: "volumeSurge",
    label: "Volumen+",
    title: "Volumen objetivo",
    detail: "actividad objetiva",
    intro: "Volumen relativo, aceleracion y vela alcista.",
    settingKeys: ["requireUpVolume"],
    fields: [
      { key: "minLatestVolume", label: "Acciones sesión min", unit: "k", scale: 1000, step: 25, hint: "Volumen de la última vela diaria." },
      { key: "minLatestTurnover", label: "Importe sesión min", unit: "M", scale: 1000000, step: 1, hint: "Precio actual x volumen de la última sesión." },
      { key: "minRelativeVolume", label: "Volumen hoy / media 20d min", unit: "x", step: .1 },
      { key: "minVolumeSurgePct", label: "Volumen 5d vs tramo previo min", unit: "%", step: 5 },
      { key: "minUpDownVolRatio", label: "Up/Down volume 50d min", unit: "x", step: .1 },
      { key: "minVolumeEffectScore", label: "Volume Effect min", unit: "", step: 5, hint: "Score 0-100 basado en importe negociado, volumen relativo, aceleración 5d y up/down volume." },
    ],
    actions: [
      { label: "Breakout volumen", detail: "Confirma expansion de demanda.", settings: { requireUpVolume: true, minLatestVolume: 250000, minLatestTurnover: 5000000, minRelativeVolume: 1.5, minVolumeSurgePct: 35, minUpDownVolRatio: 1, minVolumeEffectScore: 35 } },
      { label: "Acumulacion", detail: "Menos pico, más calidad de volumen.", settings: { requireUpVolume: false, minRelativeVolume: 1.1, minVolumeSurgePct: 15, minUpDownVolRatio: 1.05, minVolumeEffectScore: 25 } },
      { label: "Sin volumen+", detail: "Desactiva esta familia opcional.", filterLayers: { volumeSurge: false }, settings: { requireUpVolume: false, minLatestVolume: 0, minLatestTurnover: 0, minRelativeVolume: 0, minVolumeSurgePct: -999, minUpDownVolRatio: 0, minVolumeEffectScore: 0 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  riskReward: {
    key: "riskReward",
    label: "Rent/Riesgo",
    title: "Rentabilidad/riesgo",
    detail: "retorno contra riesgo",
    intro: "Retorno ajustado por volatilidad y drawdown.",
    settingKeys: [],
    fields: [
      { key: "minRiskRewardScore", label: "Score rent/riesgo min", unit: "", step: 5 },
      { key: "minReturnToVol3m", label: "Retorno 3M / volatilidad min", unit: "x", step: .1 },
      { key: "minReturnToDrawdown3m", label: "Retorno 3M / drawdown min", unit: "x", step: .1 },
    ],
    actions: [
      { label: "Asimetria alta", detail: "Exige perfil limpio.", settings: { minRiskRewardScore: 60, minReturnToVol3m: .55, minReturnToDrawdown3m: 1.2 } },
      { label: "Balance", detail: "Umbrales estandar.", settings: { minRiskRewardScore: 45, minReturnToVol3m: .35, minReturnToDrawdown3m: .8 } },
      { label: "Sin rent/riesgo", detail: "No corta por esta familia.", filterLayers: { riskReward: false }, settings: { minRiskRewardScore: 0, minReturnToVol3m: -999, minReturnToDrawdown3m: -999 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  shortInterest: {
    key: "shortInterest",
    label: metricShortLabel("shortPercentOfFloat"),
    title: "Short interest",
    detail: "flota en corto",
    intro: "Control de presion corta o busqueda de squeezes.",
    settingKeys: [],
    fields: [
      { key: "minShortFloatPct", label: `${metricShortLabel("shortPercentOfFloat")} min`, unit: "%", step: 1, hint: "Porcentaje de la flota vendida en corto según proveedor. Si no hay dato y esta regla esta activa, no pasa el filtro." },
      { key: "maxShortFloatPct", label: `${metricShortLabel("shortPercentOfFloat")} max`, unit: "%", step: 1, hint: "Util para evitar acciones con presion corta extrema si buscas largos más limpios." },
    ],
    actions: [
      { label: "Evitar presion", detail: "Excluye short float elevado.", settings: { minShortFloatPct: 0, maxShortFloatPct: 12 } },
      { label: "Squeeze watch", detail: "Busca short float relevante.", settings: { minShortFloatPct: 8, maxShortFloatPct: 999 } },
      { label: "Ignorar short", detail: "No usa short interest.", filterLayers: { shortInterest: false }, settings: { minShortFloatPct: 0, maxShortFloatPct: 999 } },
    ],
    coverageMetric: null,
    modes: null,
  },
  ipo: {
    key: "ipo",
    label: "IPO",
    title: "IPO",
    detail: "solo recientes reales",
    intro: "Nuevos líderes, edad máxima y setup IPO.",
    intensityPilot: true,
    settingKeys: ["requireRecentIpo"],
    fields: [
      { key: "maxIpoAgeMonths", label: "Edad IPO max", unit: "m", step: 6 },
    ],
    actions: [
      { label: "IPO real", detail: "Solo IPO recientes confirmadas.", settings: { setupMode: "ipoRecent", requireRecentIpo: true, maxIpoAgeMonths: 60, minDataCoverageScore: 35, minTechnicalCoverageScore: 45, minPerf3m: 10, minPerf6m: 0, minPerf12m: -100 } },
      { label: "IPO temprano", detail: "Más permisivo para candidatos jóvenes.", settings: { setupMode: "ipoRecent", requireRecentIpo: true, maxIpoAgeMonths: 84, minDataCoverageScore: 20, minTechnicalCoverageScore: 30, minPerf3m: 0, minPerf6m: -100, minPerf12m: -100 } },
      { label: "Sin IPO", detail: "Quita la familia IPO.", filterLayers: { ipo: false }, settings: { setupMode: "any", requireRecentIpo: false, maxIpoAgeMonths: 999 } },
    ],
    coverageMetric: null,
    modes: null,
  },
};

export const FILTER_GROUPS = FILTER_FAMILY_ORDER.map((key) => {
  const family = FILTER_FAMILIES[key];
  return { title: family.title, fields: family.fields };
});

export const FILTER_FIELDS = FILTER_GROUPS.flatMap((group) => group.fields);
export const DEFAULT_FIELD_RULES = Object.fromEntries(FILTER_FIELDS.map((field) => [field.key, true]));

// UX-FILTERS-2 / P5: cada field pertenece a exactamente una capa. Antes minRiskScore
// vivía en proximity+score y minVolumeScore en score+liquidity; apagar solo Cercanía
// o Liquidez ya no neutraliza esos scores (solo la capa Scores).
export const FILTER_FIELD_LAYERS = Object.fromEntries(
  FILTER_FAMILY_ORDER.flatMap((key) => FILTER_FAMILIES[key].fields.map((field) => [field.key, [key]])),
);

export const NEUTRAL_FIELD_VALUES = {
  minPrice: 0,
  minMarketCap: 0,
  minAvgVolume: 0,
  minAvgTurnover: 0,
  minLatestVolume: 0,
  minLatestTurnover: 0,
  minRelativeVolume: 0,
  minVolumeSurgePct: -999,
  minUpDownVolRatio: 0,
  minVolumeEffectScore: 0,
  minShortFloatPct: 0,
  maxShortFloatPct: 999,
  minPerf3m: -100,
  minPerf6m: -100,
  minPerf12m: -100,
  maxDistance20dHigh: 999,
  maxDistance50dHigh: 999,
  maxDistance52w: 999,
  maxDistanceATH: 999,
  maxHighsSpreadPct: 999,
  maxExtensionSma50: 999,
  minRiskRewardScore: 0,
  minRsQualityScore: 0,
  minAdProxyScore: 0,
  minEpsGrowthProxyScore: 0,
  minWeaknessScore: 0,
  minReturnToVol3m: -999,
  minReturnToDrawdown3m: -999,
  maxDailyMove20dPct: 999,
  maxDailyRange20dPct: 999,
  maxRange63dPct: 999,
  maxVolatility63d: 999,
  maxDrawdown63d: 999,
  minContractionCount: 0,
  maxContraction1DepthPct: 999,
  maxContraction2DepthPct: 999,
  maxContraction3DepthPct: 999,
  maxLastContractionDepthPct: 999,
  maxBaseDepthPct: 999,
  maxAbsDistanceToPivotPct: 999,
  maxVolumeDryUpRatio: 999,
  maxTightness10dPct: 999,
  minPatternQualityScore: 0,
  maxPriceFreshnessDays: 999,
  minDataCoverageScore: 0,
  minTechnicalCoverageScore: 0,
  minFundamentalCoverageScore: 0,
  minRsRating: 0,
  minRsBenchmarkRating: 0,
  minRsCountryPct: 0,
  minRsSectorPct: 0,
  minWeinsteinScore: 0,
  minMinerviniScore: 0,
  minMomentumScore: 0,
  minRiskScore: 0,
  minVolumeScore: 0,
  minLiquidityScore: 0,
  minSectorScore: 0,
  minTotalScore: 0,
  maxIpoAgeMonths: 999,
};

// Versión del contrato de capas. Sube cuando el significado del estado
// guardado de `filterLayers` cambia y las configuraciones anteriores dejan de
// ser interpretables. Ver restoreFilterLayers() en lib/screenerFilterLayers.js.
//
// v2 (2026-08-14): ninguna capa viene apagada de fábrica. Antes venían cuatro
// (pattern, volumeSurge, shortInterest, riskReward), y eso hacía que el mismo
// preset filtrara distinto en la pantalla que en el escaneo nocturno — el cron
// aplica el preset crudo, sin capas. Sobre las mismas 264 filas de producción
// pasaban 78 por el cron y 91 por la pantalla, y las seis reglas que sólo
// actuaban de noche (minRelativeVolume, minVolumeSurgePct, minUpDownVolRatio,
// minRiskRewardScore, minReturnToVol3m, minReturnToDrawdown3m) incluían dos de
// las tres más selectivas del preset. Ver docs/auditoria-filtros-2026-08-13.md,
// sección D.5.
export const FILTER_LAYERS_CONTRACT_VERSION = 2;

// Las trece capas arrancan encendidas. Apagar una es una decisión del
// usuario, visible en el panel de filtros; nunca un estado de fábrica.
export const DEFAULT_FILTER_LAYERS = Object.fromEntries(FILTER_FAMILY_ORDER.map((key) => [key, true]));
// Se conserva como alias explícito de "todas encendidas" para los scripts de
// contrato (scripts/filter-layer-contract-audit.mjs, filter-regression-test.mjs),
// que lo usan como base desde la que apagar una capa concreta. Desde v2 es
// idéntico a DEFAULT_FILTER_LAYERS.
export const ALL_FILTER_LAYERS = { ...DEFAULT_FILTER_LAYERS };
// Vacío desde v2. `strict` encendía volumeSurge y riskReward (redundante: ya
// vienen encendidas) y `weakness` apagaba nueve capas, cuyo único efecto
// medible sobre los ajustes efectivos era neutralizar maxIpoAgeMonths — una
// regla que en ese preset no se aplica, porque requireRecentIpo es false.
// Quitarlos no cambia lo que filtra ningún preset; sólo deja de apagar capas
// a espaldas del usuario.
export const PRESET_LAYER_OVERRIDES = {};

export function filterLayersForPreset(key = "balanced") {
  return { ...DEFAULT_FILTER_LAYERS, ...(PRESET_LAYER_OVERRIDES[key] || {}) };
}

export function setupModeLayerRequirements(mode = "") {
  // Sólo capas que el modo necesita ENCENDIDAS. El modo weakness depende de la
  // capa `score`: si se apaga, effectiveSettingsFromLayers degrada el modo a
  // "any". Antes esta rama devolvía filterLayersForPreset("weakness"), que
  // incluía nueve capas en false y las apagaba al elegir el modo.
  if (mode === "weakness") return { score: true };
  if (mode === "leader") return { trend: true };
  if (mode === "ipoRecent") return { ipo: true, proximity: true, momentum: true };
  if (mode === "pullback" || mode === "early") return { trend: true, proximity: true, momentum: true };
  if (mode === "nearPivot" || mode === "extended") return { proximity: true, momentum: true };
  return {};
}

export const REGIME_LAYER = { label: "Régimen", detail: "salud de mercado", count: 1 };
export const EXECUTION_LAYERS = FILTER_FAMILY_ORDER.map((key) => {
  const family = FILTER_FAMILIES[key];
  return {
    key: family.key,
    label: family.label,
    detail: family.detail,
    count: familyLayerCount(family),
  };
});

export const FILTER_FAMILY_PRESETS = Object.fromEntries(
  FILTER_FAMILY_ORDER.map((key) => {
    const family = FILTER_FAMILIES[key];
    return [key, { title: family.title, intro: family.intro, actions: family.actions }];
  }),
);

export const SETTING_LAYER_DEPENDENCIES = {
  requireStage2: { layer: "trend", label: "Trend" },
  requirePulso: { layer: "trend", label: "Trend" },
  requireUpVolume: { layer: "volumeSurge", label: "Volumen+" },
  requireRecentIpo: { layer: "ipo", label: "IPO" },
  requireContractionsDecreasing: { layer: "pattern", label: "Estructura" },
};

export const FIELD_RULES = {
  minPrice: { op: "min", metric: "price", label: "precio" },
  minMarketCap: { op: "min", metric: "marketCap", label: "market cap" },
  minAvgVolume: { op: "min", metric: "avgVolume", label: "volumen medio" },
  minAvgTurnover: { op: "min", metric: "avgTurnover", label: "importe medio" },
  minLatestVolume: { op: "min", metric: "latestVolume", label: "volumen sesion" },
  minLatestTurnover: { op: "min", metric: "latestTurnover", label: "importe sesion" },
  minRelativeVolume: { op: "min", metric: "relativeVolume", label: "volumen relativo" },
  minVolumeSurgePct: { op: "min", metric: "volumeSurgePct", label: "volumen 5d" },
  minUpDownVolRatio: { op: "min", metric: "upDownVolRatio", label: "up/down volume" },
  minVolumeEffectScore: { op: "min", metric: "volumeEffectScore", label: "volume effect" },
  minShortFloatPct: { op: "min", metric: "shortPercentOfFloat", label: "short float" },
  maxShortFloatPct: { op: "max", metric: "shortPercentOfFloat", label: "short float" },
  minPerf3m: { op: "min", metric: "perf3m", label: "perf 3M" },
  minPerf6m: { op: "min", metric: "perf6m", label: "perf 6M" },
  minPerf12m: { op: "min", metric: "perf12m", label: "perf 12M" },
  maxHighsSpreadPct: { op: "max", metric: "highsSpreadPct", label: "highs spread" },
  maxExtensionSma50: { op: "max", metric: "extSma50", label: "extension SMA50" },
  maxDailyMove20dPct: { op: "max", metric: "maxDailyMove20dPct", label: "movimiento diario 20d" },
  maxDailyRange20dPct: { op: "max", metric: "maxDailyRange20dPct", label: "rango intradia 20d" },
  maxRange63dPct: { op: "max", metric: "range63dPct", label: "rango 63d" },
  maxVolatility63d: { op: "max", metric: "volatility63d", label: "volatilidad 63d" },
  maxDrawdown63d: { op: "max", metric: "maxDrawdown63d", label: "drawdown 63d" },
  minContractionCount: { op: "min", metric: "contractionCount", label: "contracciones" },
  maxContraction1DepthPct: { op: "max", metric: "contraction1DepthPct", label: "contracción 1" },
  maxContraction2DepthPct: { op: "max", metric: "contraction2DepthPct", label: "contracción 2" },
  maxContraction3DepthPct: { op: "max", metric: "contraction3DepthPct", label: "contracción 3" },
  maxLastContractionDepthPct: { op: "max", metric: "lastContractionDepthPct", label: "última contracción" },
  maxBaseDepthPct: { op: "max", metric: "baseDepthPct", label: "profundidad base" },
  maxAbsDistanceToPivotPct: { op: "max", metric: "absDistanceToPivotPct", label: "distancia pivot" },
  maxVolumeDryUpRatio: { op: "max", metric: "volumeDryUpRatio", label: "volumen seco" },
  maxTightness10dPct: { op: "max", metric: "tightness10dPct", label: "rango 10d" },
  minPatternQualityScore: { op: "min", metric: "patternQualityScore", label: "calidad estructura" },
  minRiskRewardScore: { op: "min", metric: "riskRewardScore", label: "rentabilidad/riesgo" },
  minReturnToVol3m: { op: "min", metric: "returnToVol3m", label: "retorno/volatilidad" },
  minReturnToDrawdown3m: { op: "min", metric: "returnToDrawdown3m", label: "retorno/drawdown" },
  minAdProxyScore: { op: "min", metric: "adProxyScore", label: "A/D proxy" },
  minEpsGrowthProxyScore: { op: "min", metric: "epsGrowthProxyScore", label: "EPS/growth proxy" },
  minDataCoverageScore: { op: "min", metric: "dataCoverageScore", label: "cobertura total" },
  minTechnicalCoverageScore: { op: "min", metric: "technicalCoverageScore", label: "cobertura técnica" },
  minFundamentalCoverageScore: { op: "min", metric: "fundamentalCoverageScore", label: "cobertura fundamental" },
  minRsBenchmarkRating: { op: "min", metric: "rsRating", label: "RS benchmark" },
  minRsCountryPct: { op: "min", metric: "rsCountryPct", label: "RS país" },
  minRsSectorPct: { op: "min", metric: "rsSectorPct", label: "RS grupo" },
  minRsQualityScore: { op: "min", metric: "rsQualityScore", label: "RS quality" },
  minSectorScore: { op: "min", metric: "sectorScore", label: "fuerza grupo" },
  minWeinsteinScore: { op: "min", metric: "weinsteinScore", label: "estructura de tendencia" },
  minMinerviniScore: { op: "min", metric: "minerviniScore", label: "estructura de ruptura" },
  minMomentumScore: { op: "min", metric: "momentumScore", label: "momentum score" },
  minRiskScore: { op: "min", metric: "riskScore", label: "risk score" },
  minVolumeScore: { op: "min", metric: "volumeScore", label: "volume score" },
  minLiquidityScore: { op: "min", metric: "liquidityScore", label: "liquidity score" },
  minTotalScore: { op: "min", metric: "objectiveScore", label: "score compuesto" },
};

export const DISTANCE_RULES = {
  maxDistance20dHigh: { metric: "distance20d", label: "distancia 20d" },
  maxDistance50dHigh: { metric: "distance50d", label: "distancia 50d" },
  maxDistance52w: { metric: "distance52w", label: "distancia 52w" },
  maxDistanceATH: { metric: "distanceATH", label: "distancia ATH" },
};

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeFilterStrictness(value = "") {
  const key = cleanText(value || DEFAULT_FILTER_STRICTNESS).toLowerCase();
  return FILTER_STRICTNESS_KEYS.has(key) ? key : DEFAULT_FILTER_STRICTNESS;
}

export function effectiveScreenerFilterValues(values = {}) {
  const strictness = normalizeFilterStrictness(values.filterStrictness);
  return { ...values, filterStrictness: strictness };
}
