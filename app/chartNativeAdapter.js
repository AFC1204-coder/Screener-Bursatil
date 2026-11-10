// app/chartNativeAdapter.js — adaptador imperativo por attachment del chart
// nativo (ADR chart-controller-extraction §5.1, paso 7 de §9).
//
// NO es una cuarta frontera de estado. Es una función/objeto por attachment
// que traduce el modelo de series (rows seguras del data model + config) a
// llamadas de `lightweight-charts` y devuelve:
//
//   { chart, mainSeries, updateGeometry, destroySeries }
//
// Reglas del contrato (ADR §5.1, §5.4):
//   - `chart` se devuelve al controller; es el controller quien decide cuándo
//     llamar `chart.remove()` exactamente una vez.
//   - `destroySeries` libera las series y handlers creados por el adaptador.
//     NO llama `chart.remove()`; esa llamada sigue siendo exclusiva del
//     controller.
//   - El adaptador no conserva estado entre recreaciones: cada llamada
//     produce un attachment nuevo e independiente.
//
// Esta pieza es la única que:
//   - importa `lightweight-charts` (vía `await import(...)` por parte del
//     controller; el adaptador recibe la lib ya importada);
//   - accede a `getComputedStyle` para resolver tokens CSS a colores;
//   - muta el DOM del container del chart.

import { responsiveChartHeight } from "@/lib/chartViewportModel";
import {
  movingAverage,
  projectBenchmarkLineSeries,
  projectCandles,
  projectLineSeries,
  projectPatternMarkers,
  projectRsCountryRatingSeries,
  projectRsRatingSeries,
  projectRsThemeRatingSeries,
  projectVolumeSeries,
  rsLineHistory,
} from "@/lib/chartSeriesModel";

const PRICE_SCALE_LINE = 2;
const PRICE_SCALE_DASHED = 2;

// Overlay del RS rating en el panel de precio (lightweight-charts v5). El RS es
// un percentil 1-99 y el precio una cotización en cualquier escala: una escala
// overlay invisible con rango fijo y banda propia evita compartir eje con el
// precio sin reservar un panel aparte (patrón B2/B3).
//
// Global, país y tema comparten UNA sola escala overlay: las tres series son
// percentiles 1-99 en la misma banda. Escalas separadas por línea desalineaban
// la superposición y duplicaban márgenes/referencias.
const RS_OVERLAY_SCALE_ID = "rs-rating";
// Bandas verticales del panel (0 = arriba, 1 = abajo). Antes la banda RS
// (0,75→0,98) se dibujaba ENCIMA del volumen (0,82→1) (auditoría 2026-11, H7).
// Con línea RS dibujada, cada cosa tiene su franja y no se pisan:
//   precio 0,08→0,68 · RS 0,70→0,84 · volumen 0,86→1.
// Sin línea RS, el reparto de siempre (precio según el perfil, volumen 0,82→1).
const RS_OVERLAY_MARGINS = { top: 0.70, bottom: 0.16 };
const PRICE_MARGINS_WITH_RS = { top: 0.08, bottom: 0.32 };
const VOLUME_MARGINS = { top: 0.82, bottom: 0 };
const VOLUME_MARGINS_WITH_RS = { top: 0.86, bottom: 0 };
// Línea ÷ benchmark (opcional, apagada por defecto): franja baja del precio,
// por encima de la del RS.
const BENCHMARK_MARGINS = { top: 0.50, bottom: 0.34 };
// Extremos del ranking. El eje se fija a ellos en vez de autoescalar: un RS de
// 70 significa lo mismo en cualquier valor, y una escala que se reajusta a la
// ventana visible convierte un movimiento de tres puntos en una montaña.
const RS_SCALE_MIN = 1;
const RS_SCALE_MAX = 99;
// Mediana del universo. Referencia descriptiva —por encima el valor va mejor
// que la mitad del universo, por debajo peor—, no un umbral de decisión.
const RS_REFERENCE = 50;

/**
 * @typedef {object} ChartCssTokens
 * @property {string} soft
 * @property {string} humo
 * @property {string} tiza
 * @property {string} line
 * @property {string} line2
 * @property {string} line3
 * @property {string} pizarra2
 * @property {string} senal
 * @property {string} traza
 * @property {string} trazaDim
 * @property {string} rsTheme
 */

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtPrice(price) {
  const n = Number(price);
  return Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
}

function finiteOrNullValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtReadoutPrice(price) {
  const n = finiteOrNullValue(price);
  return n !== null
    ? n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
}

/**
 * Línea de lectura bajo el cursor, en una sola línea:
 * `16 abr 2026 · C 251,07 · RS 64`. Sustituye a las etiquetas de último valor
 * de las medias en el eje (auditoría 2026-11, P2). Sin RS dibujado en esa
 * fecha, el tramo RS se omite (no se inventa).
 */
export function chartReadoutText({ dateText = "", close = null, rs = null } = {}) {
  const parts = [];
  if (dateText) parts.push(String(dateText));
  const closeText = fmtReadoutPrice(close);
  if (closeText) parts.push(`C ${closeText}`);
  const rsValue = finiteOrNullValue(rs);
  if (rsValue !== null) parts.push(`RS ${Math.round(rsValue)}`);
  return parts.length > 1 ? parts.join(" · ") : "";
}

// Último punto de `points` (ordenados por time) con time <= `time`. El RS es
// semanal: entre dos lecturas vale la última publicada, nunca la siguiente.
export function pointAtOrBefore(points = [], time) {
  const t = Number(time);
  if (!Array.isArray(points) || !points.length || !Number.isFinite(t)) return null;
  let lo = 0;
  let hi = points.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= t) {
      found = points[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function rsOverlaySeriesOptions() {
  return {
    priceScaleId: RS_OVERLAY_SCALE_ID,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: "price", precision: 0, minMove: 1 },
    autoscaleInfoProvider: () => ({
      priceRange: { minValue: RS_SCALE_MIN, maxValue: RS_SCALE_MAX },
    }),
  };
}

// Medias móviles: trazo sin etiqueta de último valor, sin línea de precio
// punteada y sin marcador de cursor. Sus etiquetas en el eje eran dos de las
// tres que se sumaban al precio (H29); la lectura bajo el cursor las sustituye.
function movingAverageSeriesOptions(color) {
  return {
    color,
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
  };
}

function mainSeriesOptions(isLine, isArea, positive, colors) {
  if (isArea) {
    return {
      lineColor: positive ? colors.tiza : colors.humo,
      topColor: positive ? colors.trazaDim : colors.line,
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
    };
  }
  if (isLine) return { color: positive ? colors.tiza : colors.humo, lineWidth: 2 };
  return {
    upColor: colors.tiza,
    downColor: "rgba(0,0,0,0)",
    borderUpColor: colors.tiza,
    borderDownColor: colors.soft,
    wickUpColor: colors.soft,
    wickDownColor: colors.humo,
  };
}

function priceScaleModeFor(scale, PriceScaleMode) {
  if (scale === "log") return PriceScaleMode?.Logarithmic;
  if (scale === "percent") return PriceScaleMode?.Percentage;
  return PriceScaleMode?.Normal;
}

/**
 * Crea el chart y todas sus series a partir de las filas decision-grade del
 * data model y la config normalizada. Devuelve un handle con `update()` para
 * cambiar datos, rango, temporalidad, escala o indicadores SIN destruir el
 * chart (auditoría 2026-11, H22: cada cambio de rango hacía `chart.remove()` +
 * `createChart` 2-3 veces). Lo único que obliga a recrear es el TIPO de la
 * serie principal (velas/línea/área), que decide el controller.
 *
 * @param {object} args
 * @param {HTMLElement} args.container          contenedor DOM del chart.
 * @param {object} args.lib                       módulo `lightweight-charts` ya importado.
 * @param {object} args.profile                   perfil adaptativo del viewport.
 * @param {object} args.config                    config canónica del viewport.
 * @param {Array}  args.rows                      filas decision-grade.
 * @param {ChartCssTokens} args.colors            tokens CSS ya resueltos.
 * @param {(text: string) => void} [args.onReadout] recibe la línea de lectura
 *   del cursor ("" al salir del lienzo).
 * @param {object} [args.overrides]               campos derivados
 *   (patternOverlay, rsRatingSeries, rsCountrySeries, rsThemeSeries,
 *    benchmarkSeries, contextRows, requestedHeight, positive).
 */
export function createChartNativeAdapter(args) {
  const {
    container,
    lib,
    profile,
    config,
    colors,
    onReadout = null,
  } = args;

  const width = Number.isFinite(Number(args.width)) && Number(args.width) > 0
    ? Number(args.width)
    : Math.max(container.clientWidth || 0, 280);
  const height = Number.isFinite(Number(args.height)) && Number(args.height) > 0
    ? Number(args.height)
    : responsiveChartHeight(width, args.overrides?.requestedHeight ?? 460);

  const {
    AreaSeries,
    CandlestickSeries,
    createChart,
    createSeriesMarkers,
    HistogramSeries,
    LineSeries,
    LineStyle,
    PriceScaleMode,
  } = lib;

  // El tipo de serie principal es ESTRUCTURAL: fijo durante la vida del handle.
  const isLine = config.style === "8";
  const isArea = config.style === "3";

  const chart = createChart(container, {
    width,
    height,
    layout: {
      background: { color: "transparent" },
      textColor: colors.soft,
      fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif",
      fontSize: 12,
      panes: {
        enableResize: false,
        separatorColor: colors.line2,
        separatorHoverColor: colors.line2,
      },
    },
    grid: {
      vertLines: { color: colors.line },
      horzLines: { color: colors.line },
    },
    rightPriceScale: {
      borderColor: colors.line2,
      mode: priceScaleModeFor(config.scale, PriceScaleMode),
      autoScale: true,
      scaleMargins: profile.priceScaleMargins,
    },
    timeScale: {
      borderColor: colors.line2,
      ...profile.timeScale,
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
      priceFormatter: fmtPrice,
      timeFormatter: profile.timeFormatter,
    },
  });

  const mainSeries = chart.addSeries(
    isArea ? AreaSeries : isLine ? LineSeries : CandlestickSeries,
    mainSeriesOptions(isLine, isArea, args.overrides?.positive !== false, colors),
  );

  // Estado vivo del handle. `extraSeries` es el MISMO array durante toda la
  // vida del handle (se muta en sitio al añadir/quitar series opcionales).
  const extraSeries = [];
  const slots = {
    volume: null,
    maFast: null,
    maSlow: null,
    rs: null,
    rsCountry: null,
    rsTheme: null,
    benchmark: null,
  };
  let markersPlugin = null;
  let referenceLine = null; // { series, line }
  let rsOverlayScaleConfigured = false;
  let benchmarkScaleConfigured = false;
  let currentProfile = profile;
  let currentPriceMargins = profile.priceScaleMargins;
  let currentRsPoints = [];
  let lastMainRendered = false;

  function removeSlot(name) {
    const series = slots[name];
    if (!series) return;
    if (referenceLine?.series === series) referenceLine = null;
    try { chart.removeSeries?.(series); } catch { /* noop */ }
    const index = extraSeries.indexOf(series);
    if (index >= 0) extraSeries.splice(index, 1);
    slots[name] = null;
  }

  function ensureSlot(name, needed, factory) {
    if (!needed) {
      removeSlot(name);
      return null;
    }
    if (!slots[name]) {
      slots[name] = factory();
      extraSeries.push(slots[name]);
    }
    return slots[name];
  }

  function ensureRsOverlayScale() {
    if (rsOverlayScaleConfigured) return;
    chart.priceScale(RS_OVERLAY_SCALE_ID).applyOptions({
      visible: false,
      autoScale: true,
      scaleMargins: RS_OVERLAY_MARGINS,
    });
    rsOverlayScaleConfigured = true;
  }

  const handle = {
    chart,
    mainSeries,
    extraSeries,
    markerDescriptors: [],
    pivotPriceLine: null,
    rsPane: null,
    rsCountryPane: null,
    rsThemePane: null,
    update,
    updateGeometry,
    destroySeries,
  };

  // Aplica (o re-aplica) TODO lo que depende de datos/config sobre el chart
  // existente. Idempotente: las series opcionales se crean o retiran según
  // haga falta; las vivas reciben setData.
  function apply({ config: nextConfig, rows = [], overrides = {}, profile: nextProfile = currentProfile }) {
    const { interval, scale, indicators = {}, intraday } = nextConfig;
    const {
      patternOverlay = null,
      rsRatingSeries = null,
      rsCountrySeries = null,
      rsThemeSeries = null,
      benchmarkSeries = null,
    } = overrides;
    const positive = overrides.positive !== false;
    currentProfile = nextProfile || currentProfile;

    // Serie principal.
    mainSeries.applyOptions?.(mainSeriesOptions(isLine, isArea, positive, colors));
    mainSeries.setData(isLine || isArea ? projectLineSeries(rows, interval) : projectCandles(rows));
    lastMainRendered = rows.length > 0;

    // Pivote.
    if (handle.pivotPriceLine) {
      try { mainSeries.removePriceLine?.(handle.pivotPriceLine); } catch { /* noop */ }
      handle.pivotPriceLine = null;
    }
    const pivotPrice = safeNumber(patternOverlay?.pivotPrice);
    if (!intraday && pivotPrice && pivotPrice > 0 && typeof mainSeries.createPriceLine === "function") {
      handle.pivotPriceLine = mainSeries.createPriceLine({
        price: pivotPrice,
        color: colors.line3,
        lineStyle: PRICE_SCALE_LINE,
        lineWidth: 1,
        axisLabelVisible: true,
        title: "Pivot",
      });
    }

    // Marcadores C1..C4. La proyección pura no conoce tokens visuales; el
    // adaptador aplica --senal.
    const markerDescriptors = projectPatternMarkers(patternOverlay, rows, interval)
      .map((marker) => ({ ...marker, color: colors.senal }));
    handle.markerDescriptors = markerDescriptors;
    const visibleMarkers = intraday ? [] : markerDescriptors;
    if (markersPlugin && typeof markersPlugin.setMarkers === "function") {
      markersPlugin.setMarkers(visibleMarkers);
    } else if (visibleMarkers.length > 0 && typeof createSeriesMarkers === "function") {
      markersPlugin = createSeriesMarkers(mainSeries, visibleMarkers) || null;
    }

    // Proyecciones RS (mismas funciones puras que usa el controller).
    const rsLineData = projectRsRatingSeries(rows, rsRatingSeries, indicators, interval);
    const rsHistory = rsLineHistory(rsLineData);
    const rsRendered = !intraday && !!indicators.rsLine && rsLineData.length > 1 && rsHistory.sufficient;
    const rsCountryLineData = projectRsCountryRatingSeries(rows, rsCountrySeries, indicators, interval);
    const rsCountryHistory = rsLineHistory(rsCountryLineData);
    const rsCountryRendered = !intraday && !!indicators.rsCountryLine && rsCountryLineData.length > 1 && rsCountryHistory.sufficient;
    const rsThemeLineData = projectRsThemeRatingSeries(rows, rsThemeSeries, indicators, interval);
    const rsThemeHistory = rsLineHistory(rsThemeLineData);
    const rsThemeRendered = !intraday && !!indicators.rsThemeLine && rsThemeLineData.length > 1 && rsThemeHistory.sufficient;
    const anyRs = rsRendered || rsCountryRendered || rsThemeRendered;

    // Escala de precio: modo y franja (cede sitio a la banda RS si se dibuja).
    currentPriceMargins = anyRs ? PRICE_MARGINS_WITH_RS : currentProfile.priceScaleMargins;
    chart.applyOptions?.({
      rightPriceScale: { mode: priceScaleModeFor(scale, PriceScaleMode), autoScale: true, scaleMargins: currentPriceMargins },
      localization: { locale: "es-ES", priceFormatter: fmtPrice, timeFormatter: currentProfile.timeFormatter },
    });
    mainSeries.priceScale?.().applyOptions?.({ autoScale: true, scaleMargins: currentPriceMargins });

    // Volumen.
    const volumeSeries = ensureSlot("volume", !!indicators.volume, () => chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: colors.line,
      lastValueVisible: false,
      priceLineVisible: false,
    }));
    if (volumeSeries) {
      volumeSeries.setData(projectVolumeSeries(rows, { positive, upColor: colors.trazaDim, downColor: colors.line }));
      chart.priceScale("").applyOptions({ scaleMargins: anyRs ? VOLUME_MARGINS_WITH_RS : VOLUME_MARGINS });
    }

    // Medias móviles. Se calculan sobre el CONTEXTO (la serie agregada sin
    // recortar al rango) y se dibujan solo dentro de la ventana: así la media
    // no pierde su warm-up al principio del rango cuando hay histórico previo.
    const maSource = Array.isArray(overrides.contextRows) && overrides.contextRows.length >= rows.length
      ? overrides.contextRows
      : rows;
    const windowStart = rows[0]?.time ?? -Infinity;
    const maInWindow = (length) => movingAverage(maSource, length).filter((point) => point.time >= windowStart);
    const maFast = ensureSlot("maFast", !!indicators.maFast, () => chart.addSeries(LineSeries, movingAverageSeriesOptions(colors.soft)));
    if (maFast) maFast.setData(maInWindow(indicators.maFastLength));
    const maSlow = ensureSlot("maSlow", !!indicators.maSlow, () => chart.addSeries(LineSeries, movingAverageSeriesOptions(colors.humo)));
    if (maSlow) maSlow.setData(maInWindow(indicators.maSlowLength));

    // ── Líneas RS rating (overlay compartido en panel de precio) ─────────────
    // La referencia 50 se cuelga de la primera línea RS dibujada; se retira
    // antes de reubicarla para no duplicarla.
    if (referenceLine) {
      try { referenceLine.series.removePriceLine?.(referenceLine.line); } catch { /* noop */ }
      referenceLine = null;
    }
    const rsSeries = ensureSlot("rs", rsRendered, () => chart.addSeries(
      LineSeries,
      { ...rsOverlaySeriesOptions(), color: colors.traza, lineWidth: 2, title: "RS" },
      0,
    ));
    if (rsSeries) rsSeries.setData(rsLineData.map((point) => ({ time: point.time, value: point.value })));
    const rsCountryHandle = ensureSlot("rsCountry", rsCountryRendered, () => chart.addSeries(
      LineSeries,
      { ...rsOverlaySeriesOptions(), color: colors.soft, lineWidth: 2, lineStyle: LineStyle?.Dashed ?? PRICE_SCALE_DASHED, title: "RS país" },
      0,
    ));
    if (rsCountryHandle) rsCountryHandle.setData(rsCountryLineData.map((point) => ({ time: point.time, value: point.value })));
    const rsThemeHandle = ensureSlot("rsTheme", rsThemeRendered, () => chart.addSeries(
      LineSeries,
      { ...rsOverlaySeriesOptions(), color: colors.rsTheme, lineWidth: 2, title: "RS tema" },
      0,
    ));
    if (rsThemeHandle) rsThemeHandle.setData(rsThemeLineData.map((point) => ({ time: point.time, value: point.value })));
    if (anyRs) ensureRsOverlayScale();
    const referenceHost = rsSeries || rsCountryHandle || rsThemeHandle;
    if (referenceHost && typeof referenceHost.createPriceLine === "function") {
      referenceLine = {
        series: referenceHost,
        line: referenceHost.createPriceLine({
          price: RS_REFERENCE,
          color: colors.line2,
          lineStyle: LineStyle?.Dashed ?? PRICE_SCALE_DASHED,
          lineWidth: 1,
          axisLabelVisible: false,
          title: "",
        }),
      };
    }
    currentRsPoints = rsRendered ? rsLineData : [];

    // ── Línea ÷ benchmark («Comparar vs») ────────────────────────────────────
    // APAGADA por defecto (auditoría 2026-11, H29: un trazo sin rótulo que el
    // usuario no sabía leer). Se activa con `indicators.benchmarkLine` en las
    // preferencias del gráfico. Ratio precio/benchmark log-rebasado y anclado a
    // las velas; escala overlay invisible con franja propia.
    const benchmarkLineData = indicators.benchmarkLine === true
      ? projectBenchmarkLineSeries(rows, benchmarkSeries, interval, indicators)
      : [];
    const benchmarkLineSeries = ensureSlot("benchmark", !intraday && benchmarkLineData.length > 1, () => chart.addSeries(LineSeries, {
      color: colors.soft,
      lineWidth: 1,
      priceScaleId: "benchmark-ratio",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }, 0));
    if (benchmarkLineSeries) {
      benchmarkLineSeries.setData(benchmarkLineData.map((point) => ({ time: point.time, value: point.value })));
      if (!benchmarkScaleConfigured) {
        chart.priceScale("benchmark-ratio").applyOptions({ visible: false, scaleMargins: BENCHMARK_MARGINS });
        benchmarkScaleConfigured = true;
      }
    }

    // Lo que el overlay RS acabó dibujando, para que el controller pueda
    // declarar la ausencia con su motivo sin recalcular la serie.
    handle.rsPane = {
      rendered: rsRendered,
      paneIndex: rsRendered ? 0 : null,
      points: rsLineData.length,
      weeks: rsHistory.weeks,
      latestValue: rsRendered ? (rsLineData.at(-1)?.value ?? null) : null,
    };
    handle.rsCountryPane = {
      rendered: rsCountryRendered,
      paneIndex: rsCountryRendered ? 0 : null,
      points: rsCountryLineData.length,
      weeks: rsCountryHistory.weeks,
      latestValue: rsCountryRendered ? (rsCountryLineData.at(-1)?.value ?? null) : null,
    };
    handle.rsThemePane = {
      rendered: rsThemeRendered,
      paneIndex: rsThemeRendered ? 0 : null,
      points: rsThemeLineData.length,
      weeks: rsThemeHistory.weeks,
      latestValue: rsThemeRendered ? (rsThemeLineData.at(-1)?.value ?? null) : null,
    };
  }

  /** Cambia datos/config/overlays sobre el chart vivo (sin recrearlo). */
  function update(next = {}) {
    apply({
      config: next.config || config,
      rows: next.rows || [],
      overrides: next.overrides || {},
      profile: next.profile || currentProfile,
    });
    if (typeof onReadout === "function") onReadout("");
    return handle;
  }

  // Lectura bajo el cursor: fecha, cierre y RS de ESA fecha. Se escribe fuera
  // de React (callback imperativo) para no re-renderizar en cada movimiento.
  const crosshairHandler = (param) => {
    if (typeof onReadout !== "function") return;
    const time = param?.time;
    const point = param?.point;
    if (time == null || !point || point.x < 0 || point.y < 0 || !lastMainRendered) {
      onReadout("");
      return;
    }
    const bar = param.seriesData?.get?.(mainSeries);
    const close = bar ? (bar.close ?? bar.value) : null;
    const rsPoint = pointAtOrBefore(currentRsPoints, time);
    const dateText = typeof currentProfile?.timeFormatter === "function" ? currentProfile.timeFormatter(time) : "";
    onReadout(chartReadoutText({ dateText, close, rs: rsPoint?.value ?? null }));
  };
  if (typeof chart.subscribeCrosshairMove === "function") chart.subscribeCrosshairMove(crosshairHandler);

  function updateGeometry({ width: nextWidth = width, height: nextHeight = height, profile: nextProfile = currentProfile } = {}) {
    const w = Math.max(Number(nextWidth) || 0, 280);
    const h = Number.isFinite(Number(nextHeight)) ? Number(nextHeight) : height;
    if (nextProfile) currentProfile = nextProfile;
    chart.applyOptions?.({
      width: w,
      height: h,
      rightPriceScale: { autoScale: true, scaleMargins: currentPriceMargins },
      timeScale: { ...currentProfile.timeScale },
      localization: {
        locale: "es-ES",
        priceFormatter: fmtPrice,
        timeFormatter: currentProfile.timeFormatter,
      },
    });
    mainSeries.priceScale?.().applyOptions?.({
      autoScale: true,
      scaleMargins: currentPriceMargins,
    });
  }

  function destroySeries() {
    // Las series de lightweight-charts se liberan con `chart.remove()` (que
    // llama el controller); aquí se sueltan datos y suscripciones.
    try { chart.unsubscribeCrosshairMove?.(crosshairHandler); } catch { /* noop */ }
    if (typeof onReadout === "function") {
      try { onReadout(""); } catch { /* noop */ }
    }
    if (typeof mainSeries.setData === "function") {
      try { mainSeries.setData([]); } catch { /* noop */ }
    }
    for (const s of extraSeries) {
      if (s && typeof s.setData === "function") {
        try { s.setData([]); } catch { /* noop */ }
      }
    }
  }

  apply({ config, rows: args.rows || [], overrides: args.overrides || {}, profile });
  return handle;
}

/**
 * Resuelve los tokens CSS del sistema visual a colores concretos para
 * `lightweight-charts`. Es un helper del adapter porque es la única
 * pieza que toca el DOM.
 *
 * @returns {ChartCssTokens}
 */
export function resolveCssTokensNative() {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return {
      soft: "#B9BFB2",
      humo: "#7E8B82",
      tiza: "#EDE8DA",
      line: "rgba(237, 232, 218, .10)",
      line2: "rgba(237, 232, 218, .26)",
      line3: "rgba(237, 232, 218, .45)",
      pizarra2: "#2C4C39",
      senal: "#E0A93F",
      traza: "#93B8CE",
      trazaDim: "rgba(147, 184, 206, .12)",
      rsTheme: "#C4A5E8",
    };
  }
  const root = document.documentElement;
  const get = (name, fallback) => {
    const value = getComputedStyle(root).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    soft: get("--soft", "#B9BFB2"),
    humo: get("--humo", "#7E8B82"),
    tiza: get("--tiza", "#EDE8DA"),
    line: get("--line", "rgba(237, 232, 218, .10)"),
    line2: get("--line2", "rgba(237, 232, 218, .26)"),
    line3: get("--line3", "rgba(237, 232, 218, .45)"),
    pizarra2: get("--pizarra-2", "#2C4C39"),
    senal: get("--senal", "#E0A93F"),
    traza: get("--traza", "#93B8CE"),
    trazaDim: get("--traza-dim", "rgba(147, 184, 206, .12)"),
    rsTheme: get("--rs-theme", "#C4A5E8"),
  };
}
