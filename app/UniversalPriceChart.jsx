"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, SkipForward, TrendingUp, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { CHART_RANGES, DEFAULT_CHART_SETTINGS, normalizeChartInterval } from "@/lib/chartSettings";
import { barsAreCandleGrade } from "@/lib/chartDataQuality";
import { chartViewStateFromLogicalRange, latestLogicalRange, manualChartWindowRestorePolicy, rescaledLogicalRange, shiftedLogicalRange, timeWindowFromLogicalRange, timeWindowLogicalRange, zoomedLogicalRange } from "@/lib/chartNavigation";
import { getJson } from "@/lib/clientApi";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";
import { userFacingSearchError } from "@/lib/screenerFormat";
import { vcpDiagnosticSnapshot } from "@/lib/vcpDiagnostics";
import { useChartDrawings } from "@/app/useChartDrawings";

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : "Sin dato";
const TRADING_DAY_SECONDS = 86400 * 7 / 5;
const AXIS_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const money = (n, currency = "") => {
  if (!Number.isFinite(n)) return "Sin dato";
  const value = Math.abs(n) >= 1000
    ? n.toLocaleString("es-ES", { maximumFractionDigits: 2 })
    : n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${value} ${currency}` : value;
};

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 1, max = 99) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function scoreFromEdge(edgePct, sensitivity = 40) {
  if (!Number.isFinite(edgePct)) return null;
  return clamp(50 + ((2 / Math.PI) * 49 * Math.atan(edgePct / sensitivity)), 1, 99);
}

function isIntradayInterval(interval = "") {
  return ["1m", "5m", "15m", "30m", "1H", "4H"].includes(normalizeChartInterval(interval));
}

function vcpGateMark(state = "") {
  if (state === "fail") return "x";
  if (state === "watch" || state === "warn") return "!";
  return "";
}

function timeFromBar(bar = {}) {
  const numeric = safeNumber(bar.time);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(bar.date || "").length <= 10 ? `${bar.date}T00:00:00Z` : bar.date);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function normalizeRows(bars = []) {
  return (bars || [])
    .map((bar) => {
      const close = safeNumber(bar.close);
      if (!Number.isFinite(close)) return null;
      const open = safeNumber(bar.open) ?? close;
      const time = timeFromBar(bar);
      return {
        time,
        date: String(bar.date || "").slice(0, 10),
        open,
        high: safeNumber(bar.high) ?? Math.max(open, close),
        low: safeNumber(bar.low) ?? Math.min(open, close),
        close,
        volume: safeNumber(bar.volume) ?? 0,
      };
    })
    .filter((bar) => Number.isFinite(bar?.time) && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.time - b.time);
}

function weekKey(dateText = "") {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return dateText;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function aggregateRows(rows = [], interval = "D") {
  if (interval === "D" || (isIntradayInterval(interval) && interval !== "4H")) return rows;
  const groups = new Map();
  for (const row of rows) {
    const key = interval === "4H" ? String(Math.floor(row.time / (4 * 60 * 60))) : interval === "M" ? row.date.slice(0, 7) : weekKey(row.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    return {
      time: last.time,
      date: last.date,
      open: first.open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: last.close,
      volume: group.reduce((sum, item) => sum + (item.volume || 0), 0),
    };
  });
}

function aggregateLinePoints(points = [], interval = "D") {
  const normalizedInterval = normalizeChartInterval(interval);
  if (normalizedInterval === "D" || isIntradayInterval(normalizedInterval)) return points;
  const groups = new Map();
  for (const point of points) {
    const dateText = point.date || (Number.isFinite(point.time) ? new Date(point.time * 1000).toISOString().slice(0, 10) : "");
    const key = normalizedInterval === "M" ? dateText.slice(0, 7) : weekKey(dateText);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  return [...groups.values()].map((group) => group[group.length - 1]).filter(Boolean);
}

function movingAverage(rows = [], length = 50) {
  const output = [];
  let sum = 0;
  for (let index = 0; index < rows.length; index += 1) {
    sum += rows[index].close;
    if (index >= length) sum -= rows[index - length].close;
    if (index >= length - 1) output.push({ time: rows[index].time, value: sum / length });
  }
  return output;
}

function chartRangeRows(rows = [], rangeKey = DEFAULT_CHART_SETTINGS.range, interval = DEFAULT_CHART_SETTINGS.interval) {
  if (isIntradayInterval(interval)) return rows;
  const activeRange = CHART_RANGES.find((range) => range.key === rangeKey) || CHART_RANGES[3];
  if (activeRange.key === "MAX" || activeRange.bars === Infinity) return rows;
  const latestTime = rows.at(-1)?.time;
  if (!Number.isFinite(latestTime)) return rows.slice(-Math.min(activeRange.bars, rows.length));
  const cutoff = latestTime - (activeRange.bars * TRADING_DAY_SECONDS);
  const filtered = rows.filter((row) => Number.isFinite(row.time) && row.time >= cutoff);
  return filtered.length >= 2 ? filtered : rows.slice(-Math.min(activeRange.bars, rows.length));
}

function shouldRequestRemoteBars(localRows = [], rangeKey = DEFAULT_CHART_SETTINGS.range, interval = DEFAULT_CHART_SETTINGS.interval) {
  if (isIntradayInterval(interval)) return true;
  const activeRange = CHART_RANGES.find((range) => range.key === rangeKey) || CHART_RANGES[3];
  if (activeRange.key === "MAX" || activeRange.bars === Infinity) return localRows.length < 900;
  return Number.isFinite(activeRange.bars) && localRows.length < activeRange.bars;
}

function responsiveChartHeight(width = 0, requestedHeight = 460) {
  if (width <= 440) return Math.max(330, Math.min(requestedHeight, 410));
  if (width <= 760) return Math.max(360, Math.min(requestedHeight, 460));
  return requestedHeight;
}

function dateFromChartTime(time) {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") return new Date(`${time.slice(0, 10)}T00:00:00Z`);
  if (time && typeof time === "object") return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1));
  return null;
}

function secondsFromChartTime(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  const date = dateFromChartTime(time);
  return date && Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : null;
}

function numericVisibleTimeRange(timeRange = null) {
  const from = secondsFromChartTime(timeRange?.from);
  const to = secondsFromChartTime(timeRange?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

function emptyManualWindow() {
  return { active: false, timeRange: null, logicalRange: null, rowCount: 0 };
}

function padTime(value = 0) {
  return String(value).padStart(2, "0");
}

function axisMonth(date) {
  return AXIS_MONTHS[date.getUTCMonth()] || "";
}

function axisTickFormatter(interval = "D", range = "1A") {
  const normalizedInterval = normalizeChartInterval(interval);
  const intraday = isIntradayInterval(normalizedInterval);
  return (time) => {
    const date = dateFromChartTime(time);
    if (!date || !Number.isFinite(date.getTime())) return null;
    if (intraday) {
      return `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
    }
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = axisMonth(date);
    const year = String(date.getUTCFullYear());
    const shortYear = year.slice(-2);
    if (normalizedInterval === "M") {
      return ["5A", "MAX"].includes(range) ? year : `${month} ${shortYear}`;
    }
    if (normalizedInterval === "W") {
      return ["2A", "5A", "MAX"].includes(range) ? `${month} ${shortYear}` : `${day} ${month}`;
    }
    return ["1A", "2A", "5A", "MAX"].includes(range) ? `${month} ${shortYear}` : `${day} ${month}`;
  };
}

function crosshairTimeFormatter(interval = "D") {
  const normalizedInterval = normalizeChartInterval(interval);
  const intraday = isIntradayInterval(normalizedInterval);
  return (time) => {
    const date = dateFromChartTime(time);
    if (!date || !Number.isFinite(date.getTime())) return "";
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = axisMonth(date);
    const year = date.getUTCFullYear();
    if (!intraday) return `${day} ${month} ${year}`;
    return `${day} ${month} ${year} ${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
  };
}

function chartWindowDateLabel(seconds, interval = "D") {
  const date = new Date(Number(seconds) * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const intraday = isIntradayInterval(interval);
  const day = String(intraday ? date.getDate() : date.getUTCDate()).padStart(2, "0");
  const month = AXIS_MONTHS[intraday ? date.getMonth() : date.getUTCMonth()] || "";
  const year = intraday ? date.getFullYear() : date.getUTCFullYear();
  if (!intraday) return `${day} ${month} ${year}`;
  return `${day} ${month} ${year} ${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}

function chartWindowLabel(timeRange = null, interval = "D") {
  const from = Number(timeRange?.from);
  const to = Number(timeRange?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "Sin ventana";
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const startLabel = chartWindowDateLabel(start, interval);
  const endLabel = chartWindowDateLabel(end, interval);
  if (!startLabel || !endLabel) return "Sin ventana";
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function adaptiveChartProfile({ interval = "D", range = "1A", rowCount = 0, width = 720, volume = true } = {}) {
  const normalizedInterval = normalizeChartInterval(interval);
  const intraday = isIntradayInterval(normalizedInterval);
  const compact = width <= 520;
  const availableWidth = Math.max(260, width - (compact ? 42 : 70));
  const targetBars = normalizedInterval === "M"
    ? (compact ? 30 : 52)
    : normalizedInterval === "W"
      ? (compact ? 48 : 88)
      : intraday
        ? (compact ? 70 : 120)
        : (compact ? 90 : 160);
  const visibleBars = Math.max(8, Math.min(Math.max(rowCount, 8), targetBars));
  const rawSpacing = availableWidth / visibleBars;
  const minBarSpacing = normalizedInterval === "M" ? 7 : normalizedInterval === "W" ? 5 : intraday ? 3 : 3.5;
  const maxBarSpacing = normalizedInterval === "M" ? 36 : normalizedInterval === "W" ? 28 : intraday ? 20 : 24;
  const barSpacing = Number(clamp(rawSpacing, minBarSpacing, maxBarSpacing).toFixed(2));
  const rightOffsetPixels = compact ? 10 : normalizedInterval === "M" ? 28 : normalizedInterval === "W" ? 24 : 18;
  return {
    priceScaleMargins: volume ? { top: 0.08, bottom: 0.25 } : { top: 0.08, bottom: 0.08 },
    timeScale: {
      rightOffsetPixels,
      barSpacing,
      minBarSpacing,
      maxBarSpacing,
      fixLeftEdge: true,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: false,
      rightBarStaysOnScroll: true,
      shiftVisibleRangeOnNewBar: true,
      timeVisible: intraday,
      secondsVisible: false,
      tickMarkFormatter: axisTickFormatter(normalizedInterval, range),
    },
    timeFormatter: crosshairTimeFormatter(normalizedInterval),
  };
}

// lightweight-charts pinta en <canvas> y no entiende sintaxis CSS.
// Hay que resolver los tokens del sistema visual v2 a valores de color
// concretos (hex/rgba) antes de pasarlos a la librería, si no el motor
// del canvas recibe un color inválido y cae a un default (habitualmente
// transparente), y las velas/series se renderizan sin color.
function resolveCssTokens() {
  if (typeof window === "undefined" || typeof document === "undefined") return {};
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name, fallback) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    soft: read("--soft", "#B9BFB2"),
    humo: read("--humo", "#7E8B82"),
    tiza: read("--tiza", "#EDE8DA"),
    line: read("--line", "rgba(237, 232, 218, .10)"),
    line2: read("--line2", "rgba(237, 232, 218, .26)"),
    line3: read("--line3", "rgba(237, 232, 218, .45)"),
    pizarra2: read("--pizarra-2", "#2C4C39"),
    senal: read("--senal", "#E0A93F"),
    traza: read("--traza", "#93B8CE"),
    trazaDim: read("--traza-dim", "rgba(147, 184, 206, .12)"),
  };
}

function normalizeRsScoreSeries(series = null, visibleRows = []) {
  const source = Array.isArray(series) ? series : Array.isArray(series?.points) ? series.points : [];
  const start = visibleRows[0]?.time || 0;
  const end = visibleRows.at(-1)?.time || Infinity;
  return source
    .map((point) => {
      const value = safeNumber(point.rsRating ?? point.rs_rating ?? point.rsChartScore ?? point.rs_chart_score ?? point.rating ?? point.score ?? point.value);
      const time = timeFromBar(point);
      if (!Number.isFinite(value) || !Number.isFinite(time)) return null;
      return {
        time,
        date: String(point.date || point.snapshotDate || point.snapshot_date || "").slice(0, 10),
        value: Math.max(1, Math.min(99, Number(value.toFixed ? value.toFixed(2) : value))),
      };
    })
    .filter((point) => point && point.time >= start && point.time <= end)
    .sort((a, b) => a.time - b.time);
}

function normalizeBenchmarkLineSeries(series = null, visibleRows = [], interval = "D") {
  const source = Array.isArray(series) ? series : Array.isArray(series?.points) ? series.points : [];
  const start = visibleRows[0]?.time || 0;
  const end = visibleRows.at(-1)?.time || Infinity;
  const points = aggregateLinePoints(source
    .map((point) => {
      const value = safeNumber(point.rsLine ?? point.rs_line ?? point.relativeLine ?? point.relative_line);
      const time = timeFromBar(point);
      if (!Number.isFinite(value) || !Number.isFinite(time) || value <= 0) return null;
      return {
        time,
        date: String(point.date || point.snapshotDate || point.snapshot_date || "").slice(0, 10),
        value,
      };
    })
    .filter((point) => point && point.time >= start && point.time <= end)
    .sort((a, b) => a.time - b.time), interval);
  const base = points[0]?.value;
  if (!Number.isFinite(base) || base <= 0) return [];
  return points.map((point) => ({
    ...point,
    rawValue: Number(((point.value / base) * 100).toFixed(2)),
    value: Number((Math.log(point.value / base) * 100).toFixed(2)),
  }));
}

function rsVisibleRangeScore(points = []) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const values = points.map((point) => safeNumber(point.rawValue)).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2) return null;
  const latest = values.at(-1);
  const first = values[0];
  if (!Number.isFinite(latest) || !Number.isFinite(first) || first <= 0) return null;
  const changePct = ((latest / first) - 1) * 100;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const positionScore = high > low ? clamp(1 + ((latest - low) / (high - low)) * 98, 1, 99) : 50;
  const edgeScore = scoreFromEdge(changePct, 40);
  if (!Number.isFinite(edgeScore)) return null;
  return {
    score: Math.round(clamp(edgeScore, 1, 99)),
    changePct,
    positionScore,
  };
}

function rowTimeForDate(rows = [], date = "") {
  const target = String(date || "").slice(0, 10);
  if (!target) return null;
  const exact = rows.find((row) => row.date === target);
  if (exact) return exact.time;
  const targetMs = Date.parse(`${target}T00:00:00Z`);
  if (!Number.isFinite(targetMs)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    const rowMs = Date.parse(`${row.date}T00:00:00Z`);
    const distance = Math.abs(rowMs - targetMs);
    if (Number.isFinite(distance) && distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return bestDistance <= 5 * 86400000 ? best?.time ?? null : null;
}

function patternMarkersForRows(patternOverlay = null, rows = [], interval = "D") {
  if (!patternOverlay || normalizeChartInterval(interval) !== "D") return [];
  const swings = Array.isArray(patternOverlay.contractionSwings) ? patternOverlay.contractionSwings.slice(0, 4) : [];
  const senal = (typeof window !== "undefined" && typeof document !== "undefined")
    ? window.getComputedStyle(document.documentElement).getPropertyValue("--senal").trim() || "#E0A93F"
    : "#E0A93F";
  return swings.map((swing, index) => {
    const time = rowTimeForDate(rows, swing.toDate);
    if (!Number.isFinite(time)) return null;
    return {
      time,
      position: "belowBar",
      shape: "circle",
      color: senal,
      text: `C${index + 1}`,
      size: 1,
    };
  }).filter(Boolean);
}

export default function UniversalPriceChart({
  bars = [],
  symbol = "",
  currency = "",
  settings = DEFAULT_CHART_SETTINGS,
  tradingViewUrl = "",
  relativeStrength = null,
  benchmarkSymbol = "",
  rsMainScore = null,
  rsRatingSeries = [],
  patternOverlay = null,
  showPatternDiagnostics = false,
  className = "",
  height = 460,
}) {
  const containerRef = useRef(null);
  const rsBadgeRef = useRef(null);
  const chartRef = useRef(null);
  const chartProfileRef = useRef(null);
  const visibleLogicalRangeRef = useRef(null);
  const visibleTimeRangeRef = useRef(null);
  const manualWindowRef = useRef(emptyManualWindow());
  const lastInteractiveViewStateRef = useRef(chartViewStateFromLogicalRange(null, 0));
  const viewStateRef = useRef(chartViewStateFromLogicalRange(null, 0));
  const previousRenderMetaRef = useRef({ ready: false, symbol: "", range: "", interval: "", style: "", scale: "", rowCount: 0 });
  const [remote, setRemote] = useState({ bars: null, loading: false, error: "", meta: null });
  const [renderError, setRenderError] = useState("");
  const [viewState, setViewState] = useState(() => chartViewStateFromLogicalRange(null, 0));
  viewStateRef.current = viewState;
  const [visibleWindow, setVisibleWindow] = useState(null);
  const range = settings?.range || DEFAULT_CHART_SETTINGS.range;
  const interval = normalizeChartInterval(settings?.interval || DEFAULT_CHART_SETTINGS.interval);
  const style = settings?.style || DEFAULT_CHART_SETTINGS.style;
  const scale = settings?.scale || DEFAULT_CHART_SETTINGS.scale;
  const indicators = { ...DEFAULT_CHART_SETTINGS.indicators, ...(settings?.indicators || {}) };
  const localRows = useMemo(() => normalizeRows(bars), [bars]);
  const needsRemote = shouldRequestRemoteBars(localRows, range, interval);
  const intraday = isIntradayInterval(interval);
  const patternSummary = useMemo(() => methodologyDisplayForRow(patternOverlay || {}), [patternOverlay]);
  const patternDiagnostic = useMemo(
    () => showPatternDiagnostics && patternOverlay && !intraday ? vcpDiagnosticSnapshot(patternOverlay) : null,
    [showPatternDiagnostics, patternOverlay, intraday],
  );

  useEffect(() => {
    if (!needsRemote || !symbol) {
      setRemote({ bars: null, loading: false, error: "", meta: null });
      return;
    }
    const controller = new AbortController();
    setRemote((prev) => ({ ...prev, loading: true, error: "" }));
    const params = new URLSearchParams({ symbol, range, interval });
    getJson(`/api/chart?${params.toString()}`, { signal: controller.signal })
      .then((json) => {
        setRemote({ bars: json.bars || [], loading: false, error: "", meta: json.meta || null });
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setRemote({ bars: [], loading: false, error: error.message || "Proveedor de grafico no disponible", meta: null });
      });
    return () => controller.abort();
  }, [needsRemote, symbol, range, interval]);

  const rows = useMemo(() => {
    const remoteRows = normalizeRows(remote.bars || []);
    if (remoteRows.length) return chartRangeRows(aggregateRows(remoteRows, interval), range, interval);
    // Fetch remoto vacío/fallido. Si los datos locales NO son candle-grade (p.ej.
    // chartPreview close-only persistido en review) y el modo es candlestick,
    // caer a localRows pintaría velas degeneradas (puntos/guiones sueltos que el
    // usuario podría confundir con mercado real). Devolver [] fuerza el estado
    // empty limpio ("Historico insuficiente"). Los modos línea/área (style "8"/"3")
    // solo usan close, así que se permiten con bars close-only. Ver barsAreCandleGrade.
    const fallback = intraday ? [] : localRows;
    const useLocal = fallback.length >= 2 && (style === "8" || style === "3" || barsAreCandleGrade(fallback));
    return useLocal ? chartRangeRows(aggregateRows(fallback, interval), range, interval) : [];
  }, [remote.bars, intraday, localRows, interval, range, style]);
  const rowTimes = useMemo(() => rows.map((row) => row.time), [rows]);
  const mainRsValue = safeNumber(rsMainScore);
  const globalRsScoreData = useMemo(
    () => indicators.rsLine && !intraday ? normalizeRsScoreSeries(rsRatingSeries, rows) : [],
    [rows, rsRatingSeries, indicators.rsLine, intraday],
  );
  const fallbackRsScoreData = useMemo(
    () => indicators.rsLine && !intraday ? normalizeRsScoreSeries(relativeStrength, rows) : [],
    [rows, relativeStrength, indicators.rsLine, intraday],
  );
  const rsScoreData = globalRsScoreData.length > 1 ? globalRsScoreData : fallbackRsScoreData;
  const rsLineData = useMemo(
    () => indicators.rsLine && !intraday ? normalizeBenchmarkLineSeries(relativeStrength, rows, interval) : [],
    [rows, relativeStrength, indicators.rsLine, intraday, interval],
  );
  const patternMarkers = useMemo(() => patternMarkersForRows(patternOverlay, rows, interval), [patternOverlay, rows, interval]);
  const visibleRangeRs = useMemo(() => rsVisibleRangeScore(rsLineData), [rsLineData]);
  const latestGlobalRsScoreValue = globalRsScoreData.at(-1)?.value;
  const latestGlobalSnapshotValue = Number.isFinite(latestGlobalRsScoreValue) ? latestGlobalRsScoreValue : Number.isFinite(mainRsValue) ? mainRsValue : rsScoreData.at(-1)?.value;
  const latestVisibleRsValue = Number.isFinite(visibleRangeRs?.score) ? visibleRangeRs.score : latestGlobalSnapshotValue;
  const hasRsLine = indicators.rsLine && !intraday && rsLineData.length > 1;
  const rsPanelLabel = benchmarkSymbol ? `RS Line vs ${benchmarkSymbol}` : "RS Line";
  const rangeLabel = (CHART_RANGES.find((item) => item.key === range)?.label || range || "").toUpperCase();
  const visibleWindowLabel = useMemo(
    () => chartWindowLabel(visibleWindow || visibleTimeRangeRef.current, interval),
    [visibleWindow, interval],
  );
  const mainChartHeightTarget = height;

  const latest = rows.at(-1);
  const first = rows[0];
  const change = first?.close ? ((latest?.close / first.close) - 1) * 100 : null;
  const positive = !Number.isFinite(change) || change >= 0;

  // Hook de trendlines (D6): debe ir DESPUÉS de que `interval` exista para no
  // romper el orden de inicialización. El propio hook es estable entre renders.
  const drawings = useChartDrawings({ symbol, interval });
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;

  // Sincroniza rowTimes en el hook cada vez que cambian las filas (D1: la
  // primitiva necesita el array de tiempos actual para interpolar).
  useEffect(() => {
    drawingsRef.current?.setRowTimes?.(rows);
  }, [rows]);

  useEffect(() => {
    setViewState(chartViewStateFromLogicalRange(null, rows.length));
    setVisibleWindow(null);
  }, [symbol, range, interval]);

  useEffect(() => {
    manualWindowRef.current = emptyManualWindow();
    visibleLogicalRangeRef.current = null;
    visibleTimeRangeRef.current = null;
    lastInteractiveViewStateRef.current = chartViewStateFromLogicalRange(null, 0);
    setVisibleWindow(null);
  }, [symbol]);

  const commitViewState = (logicalRange) => {
    const nextState = chartViewStateFromLogicalRange(logicalRange, rows.length);
    setViewState(nextState);
    let derivedTimeRange = null;
    if (logicalRange) {
      visibleLogicalRangeRef.current = logicalRange;
      derivedTimeRange = timeWindowFromLogicalRange({
        rowTimes,
        logicalRange,
      });
      if (derivedTimeRange) visibleTimeRangeRef.current = derivedTimeRange;
    }
    setVisibleWindow(derivedTimeRange);
    if (nextState.isManual) {
      manualWindowRef.current = {
        active: true,
        timeRange: derivedTimeRange || visibleTimeRangeRef.current,
        logicalRange,
        rowCount: rows.length,
      };
    }
    if (nextState.key !== "unknown") lastInteractiveViewStateRef.current = nextState;
  };

  const syncViewStateFromChart = () => {
    const logicalRange = chartRef.current?.timeScale?.().getVisibleLogicalRange?.();
    commitViewState(logicalRange);
  };

  const syncViewStateSoon = () => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(syncViewStateFromChart);
      return;
    }
    syncViewStateFromChart();
  };

  const scrollToLatest = () => {
    const timeScale = chartRef.current?.timeScale?.();
    if (!timeScale) return;
    const nextRange = latestLogicalRange({
      rowCount: rows.length,
      currentRange: timeScale.getVisibleLogicalRange?.(),
      fallbackSpan: Math.min(rows.length, 90),
    });
    if (nextRange) {
      timeScale.setVisibleLogicalRange?.(nextRange);
      syncViewStateSoon();
      return;
    }
    timeScale.scrollToRealTime?.();
    syncViewStateSoon();
  };

  const resetCurrentRange = () => {
    const chart = chartRef.current;
    const timeScale = chart?.timeScale?.();
    if (!timeScale) return;
    timeScale.fitContent?.();
    const rightOffsetPixels = chartProfileRef.current?.timeScale?.rightOffsetPixels;
    if (Number.isFinite(rightOffsetPixels)) {
      timeScale.applyOptions?.({ rightOffsetPixels });
    }
    const restoredRange = latestLogicalRange({
      rowCount: rows.length,
      currentRange: null,
      fallbackSpan: rows.length,
    });
    if (restoredRange) {
      timeScale.setVisibleLogicalRange?.(restoredRange);
    }
    manualWindowRef.current = emptyManualWindow();
    if (restoredRange) {
      commitViewState(restoredRange);
      return;
    }
    syncViewStateSoon();
  };

  const zoomChart = (factor = 1) => {
    const timeScale = chartRef.current?.timeScale?.();
    const logicalRange = timeScale?.getVisibleLogicalRange?.();
    const nextRange = zoomedLogicalRange({
      rowCount: rows.length,
      currentRange: logicalRange,
      factor,
      anchorLatest: !viewState.isAwayFromLatest,
    });
    if (!nextRange) return;
    timeScale.setVisibleLogicalRange?.(nextRange);
    syncViewStateSoon();
  };

  const panChartWindow = (direction = -1) => {
    const timeScale = chartRef.current?.timeScale?.();
    const logicalRange = timeScale?.getVisibleLogicalRange?.();
    const nextRange = shiftedLogicalRange({ rowCount: rows.length, currentRange: logicalRange, direction });
    if (!nextRange) return;
    timeScale.setVisibleLogicalRange?.(nextRange);
    syncViewStateSoon();
  };

  useEffect(() => {
    let cancelled = false;
    let chart = null;
    let resizeObserver = null;
    let unsubscribeLogicalRange = null;
    let detachWheelHandler = null;

    async function render() {
      if (!containerRef.current || rows.length < 2) return;
      setRenderError("");
      const {
        AreaSeries,
        CandlestickSeries,
        createChart,
        createSeriesMarkers,
        HistogramSeries,
        LineSeries,
        PriceScaleMode,
      } = await import("lightweight-charts");

      if (cancelled || !containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = "";
      const colors = resolveCssTokens();
      let width = Math.max(container.clientWidth || 0, 280);
      let chartHeight = responsiveChartHeight(width, mainChartHeightTarget);
      let chartProfile = adaptiveChartProfile({ interval, range, rowCount: rows.length, width, volume: indicators.volume });
      chartProfileRef.current = chartProfile;
      const previousRenderMeta = previousRenderMetaRef.current;
      const nextRenderMeta = { ready: true, symbol, range, interval, style, scale, rowCount: rows.length };
      const manualWindow = manualWindowRef.current || emptyManualWindow();
      const restoreViewState = manualWindow.active ? { isManual: true } : viewState?.isManual ? viewState : lastInteractiveViewStateRef.current;
      const restoreTimeRange = manualWindow.active ? manualWindow.timeRange : visibleTimeRangeRef.current;
      const restoreLogicalRange = manualWindow.active ? manualWindow.logicalRange : visibleLogicalRangeRef.current;
      const restorePreviousRowCount = manualWindow.active ? manualWindow.rowCount : previousRenderMeta?.rowCount;
      const restorePolicy = manualChartWindowRestorePolicy({
        previousMeta: previousRenderMeta,
        nextMeta: nextRenderMeta,
        viewState: restoreViewState,
        visibleTimeRange: restoreTimeRange,
      });
      const restoredFromTime = restorePolicy.restore
        ? timeWindowLogicalRange({
          rowTimes,
          timeRange: restoreTimeRange,
          minSpan: 8,
        })
        : null;
      const restoredFromLogical = restorePolicy.restore
        ? rescaledLogicalRange({
          previousRowCount: restorePreviousRowCount,
          nextRowCount: rows.length,
          previousRange: restoreLogicalRange,
          minSpan: 8,
        })
        : null;
      const restoredFromTimeState = chartViewStateFromLogicalRange(restoredFromTime, rows.length);
      const restoredFromLogicalState = chartViewStateFromLogicalRange(restoredFromLogical, rows.length);
      const restoredLogicalRange = restoredFromTimeState.isManual
        ? restoredFromTime
        : restoredFromLogicalState.isManual
          ? restoredFromLogical
          : restoredFromTime;

      chart = createChart(container, {
        width,
        height: chartHeight,
        layout: {
          background: { color: "transparent" },
          textColor: colors.soft,
          fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif",
          fontSize: 12,
        },
        grid: {
          vertLines: { color: colors.line },
          horzLines: { color: colors.line },
        },
        rightPriceScale: {
          borderColor: colors.line2,
          mode: scale === "log" ? PriceScaleMode.Logarithmic : scale === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal,
          autoScale: true,
          scaleMargins: chartProfile.priceScaleMargins,
        },
        timeScale: {
          borderColor: colors.line2,
          ...chartProfile.timeScale,
        },
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: false,
          axisDoubleClickReset: true,
          mouseWheel: false,
          pinch: true,
        },
        crosshair: {
          vertLine: { color: colors.line3, labelBackgroundColor: colors.pizarra2 },
          horzLine: { color: colors.line3, labelBackgroundColor: colors.pizarra2 },
        },
        localization: {
          locale: "es-ES",
          priceFormatter: (price) => fmt(price),
          timeFormatter: chartProfile.timeFormatter,
        },
      });
      chartRef.current = chart;

      // PELLIZCO/SWIPE de trackpad en escritorio (Chrome/Safari Mac) llega como
      // evento `wheel` con ctrlKey:true — NO como gesto táctil real, así que
      // lightweight-charts v5 (que sólo escucha `touchstart/move/end` para
      // `pinch`) nunca lo ve y `pinch:true` se queda inerte. Como además
      // tenemos `handleScale.mouseWheel:false` a propósito, su handler de
      // `wheel` también hace early-return y se pierde el gesto.
      //
      // Solución mínima: handler propio en fase de captura que (a) impide que
      // el wheel llegue al listener interno de la librería (mediante
      // stopImmediatePropagation) y (b) si el wheel lleva ctrlKey, lo
      // reinyecta en el mismo pipeline que usan los botones ZoomIn/ZoomOut
      // (zoomedLogicalRange + commitViewState) para que el estado "manual" se
      // active igual que con un click. Wheel sin ctrlKey (scroll normal de
      // página) sólo se cancela cuando es cancelable, para no romper scrolls
      // donde no hace falta; nunca llega a la librería.
      const onWheelCaptured = (event) => {
        if (event.ctrlKey) {
          // Es un pellizco de trackpad: el navegador lo emite como wheel+ctrl
          // y, si no lo cancelamos, hace zoom de la PÁGINA entera, que es lo
          // que el usuario percibe como "no responde dentro del chart".
          if (event.cancelable) event.preventDefault();
          event.stopImmediatePropagation();
          const timeScale = chart.timeScale?.();
          if (!timeScale) return;
          const logicalRange = timeScale.getVisibleLogicalRange?.();
          // Mismo factor por paso (~10% por unidad de deltaY normalizado a
          // 100) que usa la librería internamente. deltaY<0 aleja (más
          // barras), deltaY>0 acerca (menos barras).
          const factor = Math.exp(event.deltaY * 0.0015);
          const nextRange = zoomedLogicalRange({
            rowCount: rows.length,
            currentRange: logicalRange,
            factor,
            anchorLatest: !viewStateRef.current?.isAwayFromLatest,
          });
          if (nextRange) {
            timeScale.setVisibleLogicalRange?.(nextRange);
            syncViewStateSoon();
          }
          return;
        }
        // Wheel normal (no pellizco): nunca debe llegar a la librería porque
        // mouseWheel:false ya lo bloquea, pero blindamos el camino con
        // stopImmediatePropagation para que un futuro cambio de opciones no
        // reactive el scroll-de-rueda accidentalmente.
        event.stopImmediatePropagation();
      };
      container.addEventListener("wheel", onWheelCaptured, { capture: true, passive: false });
      detachWheelHandler = () => container.removeEventListener("wheel", onWheelCaptured, { capture: true });

      const candleData = rows.map((row) => ({
        time: row.time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      }));
      const lineData = rows.map((row) => ({ time: row.time, value: row.close }));
      const isLine = style === "8";
      const isArea = style === "3";
      const mainSeries = chart.addSeries(
        isArea ? AreaSeries : isLine ? LineSeries : CandlestickSeries,
        isArea
          ? {
              lineColor: positive ? colors.tiza : colors.humo,
              topColor: positive ? colors.trazaDim : colors.line,
              bottomColor: "rgba(0,0,0,0)",
              lineWidth: 2,
            }
          : isLine
            ? { color: positive ? colors.tiza : colors.humo, lineWidth: 2 }
            : {
                upColor: colors.tiza,
                downColor: "rgba(0,0,0,0)",
                borderUpColor: colors.tiza,
                borderDownColor: colors.soft,
                wickUpColor: colors.soft,
                wickDownColor: colors.humo,
              },
      );
      mainSeries.setData(isLine || isArea ? lineData : candleData);
      mainSeries.priceScale?.().applyOptions?.({
        autoScale: true,
        scaleMargins: chartProfile.priceScaleMargins,
      });

      // Adjuntar primitiva de trendlines al mainSeries (D6). El hook se
      // re-suscribe al rango lógico del chart y limpia el attach previo.
      drawingsRef.current.attach(chart, mainSeries, container);

      const pivotPrice = safeNumber(patternOverlay?.pivotPrice);
      if (!intraday && Number.isFinite(pivotPrice) && pivotPrice > 0) {
        mainSeries.createPriceLine?.({
          price: pivotPrice,
          color: colors.line3,
          lineStyle: 2,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "Pivot",
        });
      }
      if (!intraday && patternMarkers.length && typeof createSeriesMarkers === "function") {
        createSeriesMarkers(mainSeries, patternMarkers);
      }

      if (indicators.volume) {
        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
          color: colors.line,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volumeSeries.setData(rows.map((row) => ({
          time: row.time,
          value: row.volume || 0,
          color: row.close >= row.open ? colors.trazaDim : colors.line,
        })));
        chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }

      const maFastLength = Math.max(2, Math.min(400, Number(indicators.maFastLength) || 50));
      const maSlowLength = Math.max(2, Math.min(600, Number(indicators.maSlowLength) || 200));
      const smaFast = indicators.maFast ? movingAverage(rows, maFastLength) : [];
      if (smaFast.length) {
        const series = chart.addSeries(LineSeries, { color: colors.soft, lineWidth: 1 });
        series.setData(smaFast);
      }
      const smaSlow = indicators.maSlow ? movingAverage(rows, maSlowLength) : [];
      if (smaSlow.length) {
        const series = chart.addSeries(LineSeries, { color: colors.humo, lineWidth: 1 });
        series.setData(smaSlow);
      }

      let updateRsBadge = null;
      if (hasRsLine) {
        const rsScaleId = "rs-line-overlay";
        const rsSeries = chart.addSeries(LineSeries, {
          color: colors.traza,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          priceScaleId: rsScaleId,
          priceFormat: { type: "price", precision: 0, minMove: 1 },
          title: "",
        });
        rsSeries.setData(rsLineData.map((point) => ({ time: point.time, value: point.value })));
        rsSeries.createPriceLine?.({
          price: 0,
          color: colors.line2,
          lineStyle: 2,
          lineWidth: 1,
          axisLabelVisible: false,
          title: "RS base",
        });
        chart.priceScale(rsScaleId).applyOptions({
          visible: false,
          autoScale: true,
          scaleMargins: indicators.volume ? { top: 0.56, bottom: 0.14 } : { top: 0.62, bottom: 0.06 },
        });
        updateRsBadge = () => {
          const badge = rsBadgeRef.current;
          const latestRsPoint = rsLineData.at(-1);
          if (!badge || !latestRsPoint) return;
          const x = chart.timeScale().timeToCoordinate(latestRsPoint.time);
          const y = rsSeries.priceToCoordinate(latestRsPoint.value);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            badge.style.opacity = "0";
            return;
          }
          const nextX = container.offsetLeft + Math.min(Math.max(x + 8, 8), Math.max(8, width - 78));
          const nextY = container.offsetTop + Math.min(Math.max(y - 13, 18), Math.max(18, chartHeight - 30));
          badge.style.transform = `translate(${Math.round(nextX)}px, ${Math.round(nextY)}px)`;
          badge.style.opacity = "1";
        };
      }

      function fitAdaptiveView(nextWidth = width, { resetRange = false } = {}) {
        const timeScale = chart?.timeScale?.();
        const rangeBeforeFit = !resetRange ? timeScale?.getVisibleLogicalRange?.() : null;
        const shouldPreserveRange = chartViewStateFromLogicalRange(rangeBeforeFit, rows.length).isManual;
        chartProfile = adaptiveChartProfile({ interval, range, rowCount: rows.length, width: nextWidth, volume: indicators.volume });
        chartProfileRef.current = chartProfile;
        chart?.applyOptions({
          rightPriceScale: {
            autoScale: true,
            scaleMargins: chartProfile.priceScaleMargins,
          },
          timeScale: chartProfile.timeScale,
          localization: {
            locale: "es-ES",
            priceFormatter: (price) => fmt(price),
            timeFormatter: chartProfile.timeFormatter,
          },
        });
        mainSeries.priceScale?.().applyOptions?.({
          autoScale: true,
          scaleMargins: chartProfile.priceScaleMargins,
        });
        if (resetRange) timeScale?.fitContent();
        timeScale?.applyOptions({
          rightOffsetPixels: chartProfile.timeScale.rightOffsetPixels,
        });
        if (!resetRange && shouldPreserveRange && rangeBeforeFit) {
          timeScale?.setVisibleLogicalRange?.(rangeBeforeFit);
        }
      }

      const watchLogicalRange = () => {
        const timeScale = chart?.timeScale?.();
        const updateRangeState = () => {
          const logicalRange = timeScale?.getVisibleLogicalRange?.();
          if (!logicalRange || cancelled) return;
          commitViewState(logicalRange);
        };
        const updateTimeRangeState = (timeRange) => {
          const nextTimeRange = numericVisibleTimeRange(timeRange);
          if (nextTimeRange && !cancelled) visibleTimeRangeRef.current = nextTimeRange;
          if (updateRsBadge) requestAnimationFrame(updateRsBadge);
        };
        timeScale?.subscribeVisibleLogicalRangeChange?.(updateRangeState);
        timeScale?.subscribeVisibleTimeRangeChange?.(updateTimeRangeState);
        unsubscribeLogicalRange = () => {
          timeScale?.unsubscribeVisibleLogicalRangeChange?.(updateRangeState);
          timeScale?.unsubscribeVisibleTimeRangeChange?.(updateTimeRangeState);
        };
        const initialTimeRange = numericVisibleTimeRange(timeScale?.getVisibleRange?.());
        if (initialTimeRange) {
          visibleTimeRangeRef.current = initialTimeRange;
          setVisibleWindow(initialTimeRange);
        }
        requestAnimationFrame(updateRangeState);
      };

      fitAdaptiveView(width, { resetRange: true });
      previousRenderMetaRef.current = nextRenderMeta;
      watchLogicalRange();
      if (restoredLogicalRange) {
        const applyRestoredLogicalRange = () => {
          if (cancelled) return;
          chart?.timeScale?.().setVisibleLogicalRange?.(restoredLogicalRange);
          commitViewState(restoredLogicalRange);
        };
        applyRestoredLogicalRange();
        window.requestAnimationFrame?.(applyRestoredLogicalRange);
        window.setTimeout(applyRestoredLogicalRange, 80);
      }
      if (updateRsBadge) {
        requestAnimationFrame(updateRsBadge);
        window.setTimeout(updateRsBadge, 80);
      }
      resizeObserver = new ResizeObserver(([entry]) => {
        const nextWidth = Math.max(Math.floor(entry.contentRect.width), 280);
        if (nextWidth > 0) {
          width = nextWidth;
          chartHeight = responsiveChartHeight(nextWidth, mainChartHeightTarget);
          chart?.applyOptions({ width, height: chartHeight });
          fitAdaptiveView(nextWidth);
          if (updateRsBadge) requestAnimationFrame(updateRsBadge);
        }
      });
      resizeObserver.observe(container);
    }

    render().catch((error) => {
      if (!cancelled) setRenderError(error.message || "Grafico no disponible");
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      unsubscribeLogicalRange?.();
      detachWheelHandler?.();
      drawingsRef.current?.detach?.();
      chartRef.current = null;
      chart?.remove();
    };
  }, [rows, rowTimes, style, positive, mainChartHeightTarget, scale, interval, range, indicators.volume, indicators.maFast, indicators.maFastLength, indicators.maSlow, indicators.maSlowLength, hasRsLine, rsLineData, patternOverlay, patternMarkers, intraday]);

  if (rows.length < 2) {
    return <div className={`universalChart empty ${className}`}>
      {remote.loading ? "Cargando historico..." : remote.error ? `Proveedor de grafico no disponible: ${remote.error}` : userFacingSearchError("Historico insuficiente")}
    </div>;
  }

  return <div className={`universalChart ${drawings.toolbarProps.toolActive ? "drawing" : ""} ${className}`.trim()}>
    <div className="universalChartHead">
      <div className="universalChartIdentity">
        <span className="universalChartSymbol">{symbol}</span>
        <div className="universalChartQuote">
          <b>{money(latest?.close, currency)}</b>
          <em className={positive ? "positive" : "negative"}>{pct(change)}</em>
        </div>
      </div>
      {indicators.rsLine && <div className={`universalChartBadges ${Number.isFinite(latestGlobalSnapshotValue) ? "" : "muted"}`} title="RS global del snapshot activo. No cambia con el rango del grafico.">
        <span>RS global</span>
        <b>{Number.isFinite(latestGlobalSnapshotValue) ? latestGlobalSnapshotValue.toFixed(0) : "Sin dato"}</b>
      </div>}
      {indicators.rsLine && intraday && <div className="universalChartBadges muted" title="La linea RS se calcula con cierre diario y se oculta en intradia">
        <span>RS</span>
        <b>D</b>
      </div>}
      {patternOverlay && !intraday && <div className={`universalChartPatternBadge ${patternSummary.tone || ""}`} title={patternSummary.reason || ""}>
        <span>{patternSummary.shortLabel}</span>
        <b>{patternSummary.evidence}</b>
      </div>}
      <div className="universalChartScopeBadge" title="Rango e intervalo aplicados">
        <span>Vista</span>
        <b>{rangeLabel} · {interval}</b>
      </div>
      <div className="universalChartNavGroup" aria-label="Navegación del gráfico">
        <span className={`universalChartViewState ${viewState.isAwayFromLatest ? "away" : viewState.isZoomed ? "zoom" : ""}`} title={viewState.detail}>
          <em>{viewState.label}</em>
          {viewState.visibleBars ? <b>{viewState.visibleBars}</b> : null}
        </span>
        <button type="button" className="universalChartNavButton icon" onClick={() => panChartWindow(-1)} disabled={!viewState.canPanLeft} aria-label="Mover ventana hacia el historial" title="Mover ventana hacia el historial"><ChevronLeft size={15} aria-hidden="true" /></button>
        <button type="button" className="universalChartNavButton icon" onClick={() => panChartWindow(1)} disabled={!viewState.canPanRight} aria-label="Mover ventana hacia el último dato" title="Mover ventana hacia el último dato"><ChevronRight size={15} aria-hidden="true" /></button>
        <button type="button" className="universalChartNavButton icon" onClick={() => zoomChart(0.72)} aria-label="Acercar gráfico" title="Acercar"><ZoomIn size={14} aria-hidden="true" /></button>
        <button type="button" className="universalChartNavButton icon" onClick={() => zoomChart(1.38)} aria-label="Alejar gráfico" title="Alejar"><ZoomOut size={14} aria-hidden="true" /></button>
        <button type="button" className="universalChartNavButton icon" onClick={resetCurrentRange} disabled={!viewState.isManual} aria-label="Restaurar rango seleccionado" title="Restaurar el rango seleccionado"><Maximize2 size={14} aria-hidden="true" /></button>
        <button
          type="button"
          className={`universalChartNavButton icon ${drawings.toolbarProps.toolActive ? "active" : ""}`.trim()}
          onClick={drawings.toolbarProps.toggleTool}
          aria-pressed={drawings.toolbarProps.toolActive}
          aria-label="Dibujar línea de tendencia"
          title={drawings.toolbarProps.toolActive ? "Salir de herramienta de dibujo" : "Dibujar línea de tendencia"}
        >
          <TrendingUp size={14} aria-hidden="true" />
        </button>
        {drawings.toolbarProps.hasSelection && (
          <button
            type="button"
            className="universalChartNavButton icon accent"
            onClick={drawings.toolbarProps.removeSelected}
            aria-label="Borrar línea seleccionada"
            title="Borrar línea seleccionada"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
        {viewState.isAwayFromLatest && <button type="button" className="universalChartNavButton icon accent" onClick={scrollToLatest} aria-label="Volver al último dato sin cambiar el zoom" title="Volver al último dato sin cambiar el zoom"><SkipForward size={14} aria-hidden="true" /></button>}
      </div>
      {tradingViewUrl && <a className="priceTvLink" href={tradingViewUrl} target="_blank" rel="noreferrer">Abrir TradingView</a>}
    </div>
    <div
      className={`universalChartViewportRail ${viewState.isManual ? "manual" : "auto"} ${viewState.key}`}
      aria-label="Estado del rango visible"
      aria-live="polite"
      data-view-mode={viewState.key}
      data-manual={viewState.isManual ? "true" : "false"}
      data-window-label={visibleWindowLabel}
      title={viewState.isManual ? "Ventana manual activa" : "Vista anclada al último dato"}
    >
      <span className="universalChartViewportChip mode">
        <em>Modo</em>
        <b>{viewState.isManual ? viewState.label : "Último dato"}</b>
      </span>
      <span className="universalChartViewportChip window">
        <em>Ventana</em>
        <b>{visibleWindowLabel}</b>
      </span>
      <span className="universalChartViewportChip bars">
        <em>Barras</em>
        <b>{viewState.visibleBars ? `${viewState.visibleBars}` : "Sin dato"}</b>
      </span>
      {viewState.isAwayFromLatest ? <span className="universalChartViewportChip distance">
        <em>Hasta último</em>
        <b>{viewState.distanceFromLatest}</b>
      </span> : null}
      {drawings.toolbarProps.modeLabel ? <span className="universalChartViewportChip drawing">
        <em>Dibujo</em>
        <b>{drawings.toolbarProps.modeLabel}</b>
      </span> : null}
    </div>
    <div className="universalChartCanvas" ref={containerRef} style={{ "--chart-target-height": `${mainChartHeightTarget}px` }} />
    {patternDiagnostic && <div className="vcpDiagnosticPanel" aria-label="Diagnóstico VCP" title={patternDiagnostic.objective?.detail || patternDiagnostic.reason || ""}>
      <div className="vcpDiagnosticHead">
        <span>Compresiones</span>
        <b>{patternDiagnostic.objective?.primary || patternDiagnostic.evidence}</b>
      </div>
      <div className="vcpDiagnosticGates">
        {patternDiagnostic.gates.map((item) => <span key={item.key} className={`vcpGate ${item.state}`} title={[item.label, item.detail].filter(Boolean).join(" · ")}>
          <em>{item.label}</em>
          <b>{item.detail}</b>
          {vcpGateMark(item.state) ? <i aria-hidden="true">{vcpGateMark(item.state)}</i> : null}
        </span>)}
      </div>
      {patternDiagnostic.contractions.length > 0 && <div className="vcpDiagnosticContractions">
        {patternDiagnostic.contractions.map((item) => <span key={`${item.label}-${item.toDate}`}>
          <b>{item.label}</b>
          <em>{item.depthPct != null ? `${item.depthPct.toFixed(1)}%` : "sin dato"}</em>
          <small>{item.toDate}</small>
        </span>)}
      </div>}
    </div>}
    {hasRsLine && Number.isFinite(latestVisibleRsValue) && <div
      ref={rsBadgeRef}
      className="universalRsLineBadge"
      title={Number.isFinite(visibleRangeRs?.changePct) ? `RS del rango ${rangeLabel}: ${visibleRangeRs.changePct.toFixed(1)}% vs benchmark.` : `RS del rango ${rangeLabel}`}
    >
      <span>RS {rangeLabel}</span>
      <b>{latestVisibleRsValue.toFixed(0)}</b>
    </div>}
    {indicators.rsLine && !intraday && <div className={`universalRsInlineLegend ${hasRsLine ? "" : "muted"}`}>
      <span>{rsPanelLabel}</span>
      {!hasRsLine && <em>Sin serie relativa suficiente</em>}
    </div>}
    {remote.loading && needsRemote && !intraday && <p className="dataNote">Ampliando historico para este rango...</p>}
    {remote.error && !intraday && <p className="dataNote">Historico ampliado no disponible: {remote.error}. Se muestra el historico local.</p>}
    {renderError && <p className="dataNote">{renderError}</p>}
  </div>;
}
