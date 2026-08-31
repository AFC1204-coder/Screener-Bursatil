import { safeRead, safeWrite, STORAGE_KEYS } from "./localState.js";

export const CHART_RANGES = [
  { key: "1D", label: "1D", bars: 2 },
  { key: "5D", label: "5D", bars: 5 },
  { key: "1M", label: "1M", bars: 21 },
  { key: "3M", label: "3M", bars: 63 },
  { key: "6M", label: "6M", bars: 126 },
  { key: "1A", label: "1A", bars: 252 },
  { key: "2A", label: "2A", bars: 504 },
  { key: "5A", label: "5A", bars: 1260 },
  { key: "MAX", label: "Max", bars: Infinity },
];

export const CHART_INTERVALS = [
  { key: "1m", label: "1m", intraday: true },
  { key: "5m", label: "5m", intraday: true },
  { key: "15m", label: "15m", intraday: true },
  { key: "30m", label: "30m", intraday: true },
  { key: "1H", label: "1H", intraday: true },
  { key: "4H", label: "4H", intraday: true },
  { key: "D", label: "D" },
  { key: "W", label: "W" },
  { key: "M", label: "M" },
];

export const CHART_STYLES = [
  { key: "1", label: "Velas" },
  { key: "8", label: "Linea" },
  { key: "3", label: "Area" },
];

export const CHART_SCALE_MODES = [
  { key: "price", label: "Precio" },
  { key: "log", label: "Log" },
  { key: "percent", label: "%" },
];

export const QUICK_REVIEW_CHART_INDICATOR_DEFAULTS = {
  rsLine: true,
  rsCountryLine: false,
  rsThemeLine: false,
};

export const DEFAULT_CHART_SETTINGS = {
  range: "1A",
  interval: "D",
  style: "1",
  scale: "price",
  indicators: {
    volume: true,
    rsLine: true,
    rsCountryLine: true,
    rsThemeLine: true,
    maFast: true,
    maFastLength: 50,
    maSlow: true,
    maSlowLength: 200,
  },
  notes: {},
  benchmarks: {},
  symbolPresets: {},
  listPresets: {},
  quickReviewPreset: null,
};

function validKey(list, value, fallback) {
  return list.some((item) => item.key === value) ? value : fallback;
}

export function normalizeChartInterval(value = DEFAULT_CHART_SETTINGS.interval) {
  const text = String(value || "").trim();
  const aliases = {
    "1h": "1H",
    "60m": "1H",
    "4h": "4H",
    "240m": "4H",
  };
  return validKey(CHART_INTERVALS, aliases[text] || text, DEFAULT_CHART_SETTINGS.interval);
}

export function normalizeChartSettings(value = {}) {
  const indicators = value.indicators && typeof value.indicators === "object" ? value.indicators : {};
  const fastLength = Number(indicators.maFastLength);
  const slowLength = Number(indicators.maSlowLength);
  return {
    ...DEFAULT_CHART_SETTINGS,
    ...value,
    range: validKey(CHART_RANGES, value.range, DEFAULT_CHART_SETTINGS.range),
    interval: normalizeChartInterval(value.interval),
    style: validKey(CHART_STYLES, value.style, DEFAULT_CHART_SETTINGS.style),
    scale: validKey(CHART_SCALE_MODES, value.scale, DEFAULT_CHART_SETTINGS.scale),
    indicators: {
      ...DEFAULT_CHART_SETTINGS.indicators,
      ...indicators,
      volume: indicators.volume !== false,
      rsLine: indicators.rsLine !== false,
      rsCountryLine: indicators.rsCountryLine !== false,
      rsThemeLine: indicators.rsThemeLine !== false,
      maFast: indicators.maFast !== false,
      maSlow: indicators.maSlow !== false,
      maFastLength: Number.isFinite(fastLength) ? Math.min(400, Math.max(2, Math.round(fastLength))) : DEFAULT_CHART_SETTINGS.indicators.maFastLength,
      maSlowLength: Number.isFinite(slowLength) ? Math.min(600, Math.max(2, Math.round(slowLength))) : DEFAULT_CHART_SETTINGS.indicators.maSlowLength,
    },
    notes: value.notes && typeof value.notes === "object" ? value.notes : {},
    benchmarks: value.benchmarks && typeof value.benchmarks === "object" ? value.benchmarks : {},
    symbolPresets: value.symbolPresets && typeof value.symbolPresets === "object" ? value.symbolPresets : {},
    listPresets: value.listPresets && typeof value.listPresets === "object" ? value.listPresets : {},
    quickReviewPreset: value.quickReviewPreset && typeof value.quickReviewPreset === "object" ? value.quickReviewPreset : null,
  };
}

export function applyQuickReviewChartDefaults(settings = {}) {
  const normalized = normalizeChartSettings(settings);
  return normalizeChartSettings({
    ...normalized,
    indicators: {
      ...normalized.indicators,
      ...QUICK_REVIEW_CHART_INDICATOR_DEFAULTS,
    },
  });
}

function cleanScopeKey(value = "") {
  return String(value || "").trim().toUpperCase();
}

function presetPayload(value = {}) {
  const normalized = normalizeChartSettings(value);
  return {
    range: normalized.range,
    interval: normalized.interval,
    style: normalized.style,
    scale: normalized.scale,
    indicators: normalized.indicators,
  };
}

function applyScopedPreset(settings, { scope = "global", symbol = "", listId = "" } = {}) {
  const normalized = normalizeChartSettings(settings);
  if (scope === "quickReview") {
    const preset = normalized.quickReviewPreset;
    return preset
      ? normalizeChartSettings({ ...normalized, ...preset })
      : applyQuickReviewChartDefaults(normalized);
  }
  const symbolKey = cleanScopeKey(symbol);
  const listKey = cleanScopeKey(listId);
  const preset = scope === "symbol" && symbolKey
    ? normalized.symbolPresets?.[symbolKey]
    : scope === "list" && listKey
      ? normalized.listPresets?.[listKey]
      : null;
  return preset ? normalizeChartSettings({ ...normalized, ...preset }) : normalized;
}

export function readChartSettings(scope = {}) {
  return applyScopedPreset(safeRead(STORAGE_KEYS.chartSettings, DEFAULT_CHART_SETTINGS), scope);
}

export function writeChartSettings(value = {}, scope = {}) {
  const stored = normalizeChartSettings(safeRead(STORAGE_KEYS.chartSettings, DEFAULT_CHART_SETTINGS));
  const next = normalizeChartSettings({ ...stored, ...value });
  const symbolKey = cleanScopeKey(scope.symbol);
  const listKey = cleanScopeKey(scope.listId);
  let storedNext = next;
  if (scope.scope === "symbol" && symbolKey) {
    storedNext = normalizeChartSettings({
      ...stored,
      notes: next.notes,
      benchmarks: next.benchmarks,
      symbolPresets: { ...stored.symbolPresets, [symbolKey]: presetPayload(next) },
    });
  } else if (scope.scope === "list" && listKey) {
    storedNext = normalizeChartSettings({
      ...stored,
      notes: next.notes,
      benchmarks: next.benchmarks,
      listPresets: { ...stored.listPresets, [listKey]: presetPayload(next) },
    });
  } else if (scope.scope === "quickReview") {
    storedNext = normalizeChartSettings({
      ...stored,
      notes: next.notes,
      benchmarks: next.benchmarks,
      quickReviewPreset: presetPayload(next),
    });
  }
  safeWrite(STORAGE_KEYS.chartSettings, storedNext);
  return applyScopedPreset(storedNext, scope);
}

export function chartRangeBars(rangeKey = DEFAULT_CHART_SETTINGS.range) {
  return CHART_RANGES.find((range) => range.key === rangeKey)?.bars || 252;
}
