// lib/chartSeriesModel.js — proyecciones puras del chart (ADR §5.2 / §8 / §9.5)
//
// Funciones puras que producen el conjunto de series y descriptores que el
// adaptador nativo traduce a `lightweight-charts`. **Solo** aceptan:
//
//   - `dataModel.rows` (filas decision-grade del data model, ya normalizadas,
//     agregadas y recortadas por `chartDataModel.resolve`);
//   - `config.indicators` (snapshot inmutable que devuelve
//     `resolveChartViewportConfig(settings)` en `lib/chartViewportModel.js`).
//
// **NO** se les pasa:
//   - barras crudas de props (H5 / §5.2);
//   - resultado de fetch;
//   - `window`, `getComputedStyle` ni tokens CSS (la resolución de color es
//     del adaptador nativo).
//   - estado mutable, refs nativas ni efectos.
//
// Las proyecciones devuelven exclusivamente **datos y descriptores**: la
// forma `{ time, open, high, low, close }` para velas, `{ time, value }` para
// líneas/MA, `{ time, value, rawValue }` para la línea RS, `{ time, value,
// color }` para volumen, y descriptores `{ time, position, shape, text, size }`
// para pattern markers (sin `color` — la pieza que aplica tokens queda en el
// adaptador, ADR §5.2).

import { isIntradayInterval } from "@/lib/chartViewportModel";
import { normalizeChartInterval } from "@/lib/chartSettings";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos puros.

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function timeFromBar(bar = {}) {
  if (!bar) return null;
  const numeric = Number(bar.time);
  if (Number.isFinite(numeric)) return numeric;
  const dateText = String(bar.date || "");
  const parsed = Date.parse(dateText.length <= 10 ? `${dateText}T00:00:00Z` : dateText);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function clamp(value, min = 1, max = 99) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// Regla ISO 8601: el lunes de la semana. Mantener verbatim con el componente
// original (UniversalPriceChart.jsx) y con `chartDataModel.weekKey` para que
// la semana resultante sea estable entre módulos.
function weekKey(dateText = "") {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return dateText;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Score perimetral usado para derivar la posición de la línea RS en una
// ventana visible (UniversalPriceChart.jsx scoreFromEdge).
function scoreFromEdge(edgePct, sensitivity = 40) {
  if (!Number.isFinite(edgePct)) return null;
  return clamp(50 + ((2 / Math.PI) * 49 * Math.atan(edgePct / sensitivity)), 1, 99);
}

function emptyRows() {
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Proyecciones principales (vela / línea / área).

// Velas: array `{ time, open, high, low, close }` ordenado por `time` asc.
// Devuelve `[]` si no hay filas suficientes.
export function projectCandles(rows = []) {
  if (!Array.isArray(rows) || rows.length < 2) return emptyRows();
  return rows.map((row) => ({
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  }));
}

// Línea: array `{ time, value }` usando `close` como valor principal.
// La intradía y `D` no se agregan; el resto se consolida por clave temporal
// (semana ISO o mes YYYY-MM) y se queda con el último cierre del grupo.
export function projectLineSeries(rows = [], interval = "D") {
  if (!Array.isArray(rows) || rows.length < 2) return emptyRows();
  const aggregated = aggregateLinePoints(
    rows.map((row) => ({
      time: row.time,
      date: row.date || (Number.isFinite(row.time) ? new Date(row.time * 1000).toISOString().slice(0, 10) : ""),
      value: row.close,
    })),
    interval,
  );
  return aggregated.map((point) => ({ time: point.time, value: point.value }));
}

// Área: usa la misma proyección que la línea. Se mantiene como función
// independiente para que el adaptador nativo pueda decidir la variante
// (topColor / bottomColor) sin condicionar el resto del pipeline.
export function projectAreaSeries(rows = [], interval = "D") {
  return projectLineSeries(rows, interval);
}

// Agregación por clave temporal para `projectLineSeries` y
// `projectBenchmarkLineSeries`. Verbatim del componente original para no
// introducir regresiones en velas semanales/mensuales.
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

// ─────────────────────────────────────────────────────────────────────────────
// Indicadores (volumen, medias móviles).

// Volumen: array `{ time, value }` consumible por `HistogramSeries`. El
// caller aplica color en el adaptador nativo (`row.close >= row.open ? up : dn`).
export function projectVolumeSeries(rows = []) {
  if (!Array.isArray(rows) || rows.length < 2) return emptyRows();
  return rows.map((row) => ({
    time: row.time,
    value: Number.isFinite(row.volume) ? row.volume : 0,
  }));
}

// SMA con ventana fija. Devuelve `[]` si `rows.length < length` o si el
// indicador está desactivado. Mantiene la firma `(rows, length)` original.
export function movingAverage(rows = [], length = 50) {
  const safeLength = Math.max(2, Math.round(Number(length) || 50));
  if (!Array.isArray(rows) || rows.length < safeLength) return emptyRows();
  const output = [];
  let sum = 0;
  for (let index = 0; index < rows.length; index += 1) {
    sum += Number(rows[index].close);
    if (index >= safeLength) sum -= Number(rows[index - safeLength].close);
    if (index >= safeLength - 1) {
      output.push({ time: rows[index].time, value: sum / safeLength });
    }
  }
  return output;
}

// Devuelve `{ fast, slow }` desde `rows` e `indicators`. Si los flags
// `maFast`/`maSlow` están en `false` o la ventana es más grande que las
// filas, el array correspondiente es `[]`.
export function projectMovingAverages(rows = [], indicators = {}) {
  const fastLength = clampIndicatorLength(indicators.maFastLength, 50, 2, 400);
  const slowLength = clampIndicatorLength(indicators.maSlowLength, 200, 2, 600);
  return {
    fast: indicators.maFast === false ? [] : movingAverage(rows, fastLength),
    slow: indicators.maSlow === false ? [] : movingAverage(rows, slowLength),
  };
}

function clampIndicatorLength(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ─────────────────────────────────────────────────────────────────────────────
// RS — línea de fuerza relativa y benchmark.

// Proyecta la serie de rating RS (1-99) en la ventana temporal de `rows`.
// Acepta dos formatos de entrada (`series` plano o `{ points: [...] }`) y
// devuelve `[]` cuando la serie no tiene cobertura suficiente o el indicador
// está desactivado.
export function projectRsRatingSeries(rows = [], series = null, indicators = {}, interval = "D") {
  if (indicators.rsLine === false) return emptyRows();
  if (isIntradayInterval(interval)) return emptyRows(); // gating global: la línea RS nunca aparece en intradía.
  if (!Array.isArray(rows) || rows.length < 2) return emptyRows();
  const source = Array.isArray(series) ? series : Array.isArray(series?.points) ? series.points : [];
  const start = rows[0]?.time || 0;
  const end = rows.at(-1)?.time || Infinity;
  return source
    .map((point) => {
      const value = safeNumber(
        point?.rsRating ?? point?.rs_rating ?? point?.rsChartScore ?? point?.rs_chart_score
        ?? point?.rating ?? point?.score ?? point?.value,
      );
      const time = timeFromBar(point);
      if (!Number.isFinite(value) || !Number.isFinite(time)) return null;
      return {
        time,
        date: String(point?.date || point?.snapshotDate || point?.snapshot_date || "").slice(0, 10),
        value: Math.max(1, Math.min(99, Number(value.toFixed ? value.toFixed(2) : value))),
      };
    })
    .filter((point) => point && point.time >= start && point.time <= end)
    .sort((a, b) => a.time - b.time);
}

// Proyecta la línea de benchmark (RS Line) en escala logarítmica (centro en 0)
// con `rawValue` lineal (centro en 100) para etiquetas. Devuelve `[]` cuando
// el input no es usable o el indicador está desactivado.
export function projectBenchmarkLineSeries(rows = [], series = null, interval = "D", indicators = {}) {
  if (indicators.rsLine === false) return emptyRows();
  if (isIntradayInterval(interval)) return emptyRows();
  if (!Array.isArray(rows) || rows.length < 2) return emptyRows();
  const source = Array.isArray(series) ? series : Array.isArray(series?.points) ? series.points : [];
  const start = rows[0]?.time || 0;
  const end = rows.at(-1)?.time || Infinity;
  const points = aggregateLinePoints(
    source
      .map((point) => {
        const value = safeNumber(point?.rsLine ?? point?.rs_line ?? point?.relativeLine ?? point?.relative_line);
        const time = timeFromBar(point);
        if (!Number.isFinite(value) || !Number.isFinite(time) || value <= 0) return null;
        return {
          time,
          date: String(point?.date || point?.snapshotDate || point?.snapshot_date || "").slice(0, 10),
          value,
        };
      })
      .filter((point) => point && point.time >= start && point.time <= end)
      .sort((a, b) => a.time - b.time),
    interval,
  );
  const base = points[0]?.value;
  if (!Number.isFinite(base) || base <= 0) return emptyRows();
  return points.map((point) => ({
    ...point,
    rawValue: Number(((point.value / base) * 100).toFixed(2)),
    value: Number((Math.log(point.value / base) * 100).toFixed(2)),
  }));
}

// Resumen del rango visible: devuelve `{ score, changePct, positionScore }` o
// `null` si no hay suficientes puntos para derivarlo. Sin colores.
export function projectRsVisibleRangeSummary(points = []) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const values = points
    .map((point) => safeNumber(point?.rawValue))
    .filter((value) => Number.isFinite(value) && value > 0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Pattern markers (descriptores sin color — ADR §5.2).
//
// `projectPatternMarkers` devuelve, para `patternOverlay.contractionSwings`,
// los puntos temporales de la fila más cercana al `toDate` de cada swing.
// Cada descriptor lleva solo geometría + copy; **NO** incluye `color`. La
// resolución del token visual queda en el adaptador nativo. Si el intervalo
// no es diario, devuelve `[]` (los markers solo aplican en D).

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

export function projectPatternMarkers(patternOverlay = null, rows = [], interval = "D") {
  if (!patternOverlay || normalizeChartInterval(interval) !== "D") return emptyRows();
  if (!Array.isArray(rows) || rows.length < 2) return emptyRows();
  const swings = Array.isArray(patternOverlay.contractionSwings)
    ? patternOverlay.contractionSwings.slice(0, 4)
    : [];
  return swings
    .map((swing, index) => {
      const time = rowTimeForDate(rows, swing?.toDate);
      if (!Number.isFinite(time)) return null;
      return {
        time,
        position: "belowBar",
        shape: "circle",
        text: `C${index + 1}`,
        size: 1,
      };
    })
    .filter(Boolean);
}

// Helper para el controller: concentra la decisión "¿se debe dibujar la línea
// RS?" sin evaluar visual. Solo mira `config.indicators.rsLine`, `intraday` y
// `len(rsLineData) > 1` — la regla que usa hoy UniversalPriceChart antes de
// `chart.addSeries` para la RS Line.
export function shouldRenderRsLine(indicators = {}, intraday = false, rsLinePointCount = 0) {
  if (indicators?.rsLine === false) return false;
  if (intraday) return false;
  return rsLinePointCount > 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suficiencia de histórico de la línea RS.
//
// El RS es un ranking SEMANAL (`rs_weekly_items`, un punto por semana). Contar
// puntos no basta: dos filas del mismo `week_key` son un solo dato semanal
// observado dos veces, y unir dos puntos contiguos con una recta afirma una
// tendencia relativa que no se ha medido. En la práctica esa recta se dibuja
// como un segmento casi vertical pegado al borde derecho del gráfico.
//
// Por eso la unidad de suficiencia son SEMANAS ISO DISTINTAS, no puntos. Por
// debajo del mínimo no se dibuja nada y se declara la ausencia con su motivo
// (docs/principios-producto.md, principio 3 y la excepción del principio 5:
// un dato ausente se explica donde falta).
//
// El umbral no es una constante estética: ocho semanas es el histórico mínimo
// con el que la pendiente del RS describe algo más que una lectura y su
// vecina. Cambiarlo es una decisión de producto, y por eso vive aquí, en una
// sola constante exportada, y no incrustado en el adaptador.
export const RS_LINE_MIN_WEEKS = 8;

// Devuelve `{ weeks, sufficient, points }` para una serie ya proyectada por
// `projectRsRatingSeries`. Función pura: no mira tokens, ni DOM, ni config
// visual. `weeks` cuenta claves ISO distintas; los puntos sin fecha derivan la
// suya del timestamp.
export function rsLineHistory(points = []) {
  const safePoints = Array.isArray(points) ? points : [];
  const keys = new Set();
  for (const point of safePoints) {
    const dateText = String(point?.date || "").slice(0, 10)
      || (Number.isFinite(point?.time) ? new Date(point.time * 1000).toISOString().slice(0, 10) : "");
    if (!dateText) continue;
    keys.add(weekKey(dateText));
  }
  const weeks = keys.size;
  return { points: safePoints, weeks, sufficient: weeks >= RS_LINE_MIN_WEEKS };
}