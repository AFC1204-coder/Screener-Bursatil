import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";

export const CHART_RANGES = [
  { key: "1M", label: "1M", bars: 21 },
  { key: "3M", label: "3M", bars: 63 },
  { key: "6M", label: "6M", bars: 126 },
  { key: "1A", label: "1A", bars: 252 },
  { key: "2A", label: "2A", bars: 504 },
  { key: "5A", label: "5A", bars: 1260 },
];

export const CHART_INTERVALS = [
  { key: "D", label: "D" },
  { key: "W", label: "W" },
  { key: "M", label: "M" },
];

export const CHART_STYLES = [
  { key: "1", label: "Velas" },
  { key: "8", label: "Linea" },
  { key: "3", label: "Area" },
];

export const DEFAULT_CHART_SETTINGS = {
  range: "1A",
  interval: "D",
  style: "1",
  notes: {},
};

function validKey(list, value, fallback) {
  return list.some((item) => item.key === value) ? value : fallback;
}

export function normalizeChartSettings(value = {}) {
  return {
    ...DEFAULT_CHART_SETTINGS,
    ...value,
    range: validKey(CHART_RANGES, value.range, DEFAULT_CHART_SETTINGS.range),
    interval: validKey(CHART_INTERVALS, value.interval, DEFAULT_CHART_SETTINGS.interval),
    style: validKey(CHART_STYLES, value.style, DEFAULT_CHART_SETTINGS.style),
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
