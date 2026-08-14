// lib/chartViewportModel.js — pieza pura de la frontera de viewport (ADR §4.2 / §5.1 / §5.2 / §8 / §9.5)
//
// Encapsula **toda la matemática no-react** del viewport del chart:
//
//   - Configuración canónica: `resolveChartViewportConfig(settings)` normaliza
//     el objeto controlado por `ChartPreferences` a la forma estable
//     `{ dataRange, interval, style, scale, indicators, intraday }` que
//     consumen el data model, el viewport y el controller. Aquí se asegura
//     que los nombres no se duplican en cada componente (ADR §4.2:
//     `dataRange` ≠ `visibleLogicalRange`).
//   - Perfil adaptativo: `adaptiveChartProfile({...})` y `responsiveChartHeight(...)`
//     dependen solo de dimensiones, intervalo, rango y rowCount; nunca del DOM.
//     El módulo los posee porque dependen de dimensiones y afectan a la
//     ventana visible (ADR §4.2).
//   - Formatters puros: `axisTickFormatter`, `crosshairTimeFormatter` y los
//     helpers `dateFromChartTime`, `secondsFromChartTime`,
//     `numericVisibleTimeRange`, `emptyManualWindow`, `padTime`, `axisMonth`.
//   - Labels y ventanas: `chartWindowLabel`, `chartWindowDateLabel` y los
//     helpers `timeWindowFromSeconds`/`timeWindowLabel` para derivar copy
//     estable desde un `timeRange` numérico.
//
// El módulo **NO importa React, ni lightweight-charts, ni accede a `window`/
// `document`/`getComputedStyle`**. Toda la dependencia de DOM/canvas queda
// en el adaptador nativo (`chartNativeAdapter`) o en el hook `useChartViewport`.
// `chartNavigation.js` permanece intacto: este archivo solo posee profile,
// formatters y labels; las matemáticas de navegación/rango siguen siendo
// las suyas (ADR §4.5 / §9 paso 5).

import {
  CHART_RANGES,
  DEFAULT_CHART_SETTINGS,
  normalizeChartInterval,
} from "@/lib/chartSettings";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes internas. Mantienen la misma forma exacta que el componente
// `UniversalPriceChart.jsx` original para no introducir regresiones de copy.

const AXIS_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const INTRADAY_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1H", "4H"]);

// ─────────────────────────────────────────────────────────────────────────────
// Configuración canónica (ADR §4.2).
//
// Devuelve un objeto congelado en sus campos normales (dataRange / interval /
// style / scale / intraday / indicators) listo para ser consumido por el data
// model, el viewport hook y el controller. Los nombres no se reinterpretan:
// `dataRange` es el rango solicitado al histórico (UniversalPriceChart
// `settings.range`), NO la ventana visible del timeScale.

export function resolveChartViewportConfig(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const indicators = source.indicators && typeof source.indicators === "object" ? source.indicators : {};

  const interval = normalizeChartInterval(source.interval || DEFAULT_CHART_SETTINGS.interval);
  const intraday = INTRADAY_INTERVALS.has(interval);

  const dataRange = validRangeKey(source.range || DEFAULT_CHART_SETTINGS.range);
  const style = validStyleKey(source.style || DEFAULT_CHART_SETTINGS.style);
  const scale = validScaleKey(source.scale || DEFAULT_CHART_SETTINGS.scale);

  const fastLength = Number(indicators.maFastLength);
  const slowLength = Number(indicators.maSlowLength);

  return {
    dataRange,
    interval,
    style,
    scale,
    indicators: {
      volume: indicators.volume !== false,
      rsLine: indicators.rsLine !== false,
      maFast: indicators.maFast !== false,
      maSlow: indicators.maSlow !== false,
      maFastLength: Number.isFinite(fastLength)
        ? Math.min(400, Math.max(2, Math.round(fastLength)))
        : DEFAULT_CHART_SETTINGS.indicators.maFastLength,
      maSlowLength: Number.isFinite(slowLength)
        ? Math.min(600, Math.max(2, Math.round(slowLength)))
        : DEFAULT_CHART_SETTINGS.indicators.maSlowLength,
    },
    intraday,
  };
}

function validRangeKey(value) {
  return CHART_RANGES.some((item) => item.key === value) ? value : DEFAULT_CHART_SETTINGS.range;
}

function validStyleKey(value) {
  const styles = ["1", "8", "3"];
  return styles.includes(value) ? value : DEFAULT_CHART_SETTINGS.style;
}

function validScaleKey(value) {
  const modes = ["price", "log", "percent"];
  return modes.includes(value) ? value : DEFAULT_CHART_SETTINGS.scale;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers numéricos y de parsing (ADR §9.5: "axis formatters, crosshair
// formatters, chartWindowLabel/dateLabel, timeWindow helpers").

export function isIntradayInterval(interval = "") {
  return INTRADAY_INTERVALS.has(normalizeChartInterval(interval));
}

function padTime(value = 0) {
  return String(value).padStart(2, "0");
}

function axisMonth(date) {
  return AXIS_MONTHS[date.getUTCMonth()] || "";
}

// Conversión tolerante de `time` (formato de lightweight-charts: number
// epoch-seconds, string YYYY-MM-DD o { year, month, day }) a un Date UTC.
export function dateFromChartTime(time) {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") return new Date(`${time.slice(0, 10)}T00:00:00Z`);
  if (time && typeof time === "object") return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1));
  return null;
}

export function secondsFromChartTime(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  const date = dateFromChartTime(time);
  return date && Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : null;
}

// Deduplica y ordena numéricamente una ventana temporal `{ from, to }`. Devuelve
// `null` si la ventana no es usable (sin datos, vacía, from===to).
export function numericVisibleTimeRange(timeRange = null) {
  const from = secondsFromChartTime(timeRange?.from);
  const to = secondsFromChartTime(timeRange?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

export function emptyManualWindow() {
  return { active: false, timeRange: null, logicalRange: null, rowCount: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters puros. Devuelven funciones listas para pasar al `tickMarkFormatter`
// y al `timeFormatter` de `lightweight-charts`. Mantienen la misma forma de
// copy que el componente original (eje corto `dd mes`, intradía HH:MM, etc.).

export function axisTickFormatter(interval = "D", range = "1A") {
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

export function crosshairTimeFormatter(interval = "D") {
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

// ─────────────────────────────────────────────────────────────────────────────
// Labels de ventana visible (ADR §9.5).
//
// `chartWindowDateLabel` formatea un único timestamp (en segundos) al copy
// canónico: `dd mes YYYY` para diario/semanal/mensual, `dd mes YYYY HH:MM`
// para intradía. `chartWindowLabel` une ambos extremos en el rango visible,
// abreviando cuando from===to.

export function chartWindowDateLabel(seconds, interval = "D") {
  const date = new Date(Number(seconds) * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const intraday = isIntradayInterval(interval);
  const day = String(intraday ? date.getDate() : date.getUTCDate()).padStart(2, "0");
  const month = AXIS_MONTHS[intraday ? date.getMonth() : date.getUTCMonth()] || "";
  const year = intraday ? date.getFullYear() : date.getUTCFullYear();
  if (!intraday) return `${day} ${month} ${year}`;
  return `${day} ${month} ${year} ${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}

export function chartWindowLabel(timeRange = null, interval = "D") {
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

// Variantes de la ventana para casos donde el caller ya tiene un par
// numérico en segundos (por ejemplo, derivado de un `timeRange` nativo).
export function timeWindowLabel(secondsRange = null, interval = "D") {
  const from = Number(secondsRange?.from);
  const to = Number(secondsRange?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "Sin ventana";
  if (from === to) return chartWindowDateLabel(from, interval) || "Sin ventana";
  const start = chartWindowDateLabel(Math.min(from, to), interval);
  const end = chartWindowDateLabel(Math.max(from, to), interval);
  return start && end ? `${start} - ${end}` : "Sin ventana";
}

export function timeWindowFromSeconds(secondsRange = null) {
  const from = Number(secondsRange?.from);
  const to = Number(secondsRange?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Perfil adaptativo (ADR §4.2 / §9.5: `responsiveChartHeight`,
// `adaptiveChartProfile`).
//
// `responsiveChartHeight` acota la altura solicitada por el caller en función
// del ancho disponible. `adaptiveChartProfile` produce el objeto consumido por
// `lightweight-charts` para `timeScale` y `priceScaleMargins`; usa solo los
// datos de la pieza pura (interval, range, rowCount, width, volume) y devuelve
// también los formatters ya construidos.

export function responsiveChartHeight(width = 0, requestedHeight = 460) {
  if (width <= 440) return Math.max(330, Math.min(requestedHeight, 410));
  if (width <= 760) return Math.max(360, Math.min(requestedHeight, 460));
  return requestedHeight;
}

// CONTRATO DE VENTANA (docs/analisis-grafico-2026-08-14.md, Parte C.1): el
// perfil decide DENSIDAD y FORMATO (espaciado mínimo, formatters, márgenes de
// escala), nunca la ventana visible. Aquí no hay `barSpacing` objetivo ni
// número de barras objetivo: la ventana inicial la fija `fitContent` sobre el
// rango declarado, en `lib/chartViewportLifecycle.js`. El `minBarSpacing`
// bajo (0.5) existe para que incluso MAX quepa entero en pantalla.
export function adaptiveChartProfile({
  interval = "D",
  range = "1A",
  volume = true,
} = {}) {
  const normalizedInterval = normalizeChartInterval(interval);
  const intraday = isIntradayInterval(normalizedInterval);
  return {
    priceScaleMargins: volume ? { top: 0.08, bottom: 0.25 } : { top: 0.08, bottom: 0.08 },
    timeScale: {
      minBarSpacing: 0.5,
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