import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";

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
  { key: "1h", label: "1H", intraday: true },
  { key: "4h", label: "4H", intraday: true },
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

export const DEFAULT_CHART_SETTINGS = {
  range: "1A",
  interval: "D",
  style: "1",
  scale: "price",
  indicators: {
    volume: true,
    rsLine: true,
    maFast: true,
    maFastLength: 50,
    maSlow: true,
    maSlowLength: 200,
  },
  notes: {},
};

function validKey(list, value, fallback) {
  return list.some((item) => item.key === value) ? value : fallback;
}

export function normalizeChartSettings(value = {}) {
  const indicators = value.indicators && typeof value.indicators === "object" ? value.indicators : {};
  const fastLength = Number(indicators.maFastLength);
  const slowLength = Number(indicators.maSlowLength);
  return {
    ...DEFAULT_CHART_SETTINGS,
    ...value,
    range: validKey(CHART_RANGES, value.range, DEFAULT_CHART_SETTINGS.range),
    interval: validKey(CHART_INTERVALS, value.interval, DEFAULT_CHART_SETTINGS.interval),
    style: validKey(CHART_STYLES, value.style, DEFAULT_CHART_SETTINGS.style),
    scale: validKey(CHART_SCALE_MODES, value.scale, DEFAULT_CHART_SETTINGS.scale),
    indicators: {
      ...DEFAULT_CHART_SETTINGS.indicators,
      ...indicators,
      volume: indicators.volume !== false,
      rsLine: indicators.rsLine !== false,
      maFast: indicators.maFast !== false,
      maSlow: indicators.maSlow !== false,
      maFastLength: Number.isFinite(fastLength) ? Math.min(400, Math.max(2, Math.round(fastLength))) : DEFAULT_CHART_SETTINGS.indicators.maFastLength,
      maSlowLength: Number.isFinite(slowLength) ? Math.min(600, Math.max(2, Math.round(slowLength))) : DEFAULT_CHART_SETTINGS.indicators.maSlowLength,
    },
    notes: value.notes && typeof value.notes === "object" ? value.notes : {},
  };
}

export function readChartSettings() {
  return normalizeChartSettings(safeRead(STORAGE_KEYS.chartSettings, DEFAULT_CHART_SETTINGS));
}

export function writeChartSettings(value = {}) {
  const next = normalizeChartSettings(value);
  safeWrite(STORAGE_KEYS.chartSettings, next);
  return next;
}

export function chartRangeBars(rangeKey = DEFAULT_CHART_SETTINGS.range) {
  return CHART_RANGES.find((range) => range.key === rangeKey)?.bars || 252;
}
