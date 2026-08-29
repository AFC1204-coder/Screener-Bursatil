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
  projectRsRatingSeries,
  projectVolumeSeries,
  rsLineHistory,
} from "@/lib/chartSeriesModel";

const PRICE_SCALE_LINE = 2;
const PRICE_SCALE_DASHED = 2;

// Overlay del RS rating en el panel de precio (lightweight-charts v5). El RS es
// un percentil 1-99 y el precio una cotización en cualquier escala: una escala
// overlay invisible con rango fijo y banda inferior propia evita compartir eje
// con el precio sin reservar un panel aparte (patrón B2/B3).
const RS_OVERLAY_SCALE_ID = "rs-rating";
// Banda inferior ~25% del panel de precio (top 0.75 → franja 75%–98%).
const RS_OVERLAY_MARGINS = { top: 0.75, bottom: 0.02 };
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
 */

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtPrice(price) {
  const n = Number(price);
  return Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
}

/**
 * Crea el chart y todas sus series a partir de las filas decision-grade del
 * data model y la config normalizada. Devuelve un handle sin estado
 * persistente entre recreaciones.
 *
 * @param {object} args
 * @param {HTMLElement} args.container          contenedor DOM del chart.
 * @param {object} args.lib                       módulo `lightweight-charts` ya importado.
 * @param {object} args.profile                   perfil adaptativo del viewport.
 * @param {object} args.config                    config canónica del viewport.
 * @param {Array}  args.rows                      filas decision-grade.
 * @param {Array}  args.rowTimes                  tiempos normalizados.
 * @param {ChartCssTokens} args.colors            tokens CSS ya resueltos.
 * @param {object} [args.overrides]               campos derivados
 *   (patternOverlay, relativeStrength, benchmarkSymbol, rsMainScore,
 *    rsRatingSeries, showPatternDiagnostics, requestedHeight).
 *
 * @returns {{
 *   chart: object,
 *   mainSeries: object,
 *   extraSeries: object[],
 *   markerDescriptors: object[],
 *   pivotPriceLine: object | null,
 *   rsPane: { rendered, paneIndex, points, weeks, latestValue },
 *   updateGeometry: (next: { width, height, profile }) => void,
 *   destroySeries: () => void,
 * }}
 */
export function createChartNativeAdapter(args) {
  const {
    container,
    lib,
    profile,
    config,
    rows,
    colors,
    overrides = {},
  } = args;

  const {
    interval,
    style,
    scale,
    indicators,
    intraday,
  } = config;

  const {
    patternOverlay = null,
    rsRatingSeries = null,
    benchmarkSeries = null,
    requestedHeight = 460,
  } = overrides;

  const width = Number.isFinite(Number(args.width)) && Number(args.width) > 0
    ? Number(args.width)
    : Math.max(container.clientWidth || 0, 280);
  const height = Number.isFinite(Number(args.height)) && Number(args.height) > 0
    ? Number(args.height)
    : responsiveChartHeight(width, requestedHeight);

  const {
    AreaSeries,
    CandlestickSeries,
    createChart,
    createSeriesMarkers,
    HistogramSeries,
    LineSeries,
    PriceScaleMode,
  } = lib;

  const isLine = style === "8";
  const isArea = style === "3";

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
      mode: scale === "log" ? PriceScaleMode.Logarithmic : scale === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal,
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

  // La determinación de "positive" depende del cambio de las filas. El
  // adapter la recibe ya calculada por el controller (que es quien tiene
  // acceso al data model y al `latest`/`first`); por defecto true.
  const positive = overrides.positive !== false;

  const mainOptions = isArea
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
        };

  const mainSeries = chart.addSeries(
    isArea ? AreaSeries : isLine ? LineSeries : CandlestickSeries,
    mainOptions,
  );

  const mainData = isLine || isArea
    ? projectLineSeries(rows, interval)
    : projectCandles(rows);
  mainSeries.setData(mainData);

  mainSeries.priceScale?.().applyOptions?.({
    autoScale: true,
    scaleMargins: profile.priceScaleMargins,
  });

  const extraSeries = [];

  // Pivot price line
  const pivotPrice = safeNumber(patternOverlay?.pivotPrice);
  let pivotPriceLine = null;
  if (!intraday && pivotPrice && pivotPrice > 0 && typeof mainSeries.createPriceLine === "function") {
    pivotPriceLine = mainSeries.createPriceLine({
      price: pivotPrice,
      color: colors.line3,
      lineStyle: PRICE_SCALE_LINE,
      lineWidth: 1,
      axisLabelVisible: true,
      title: "Pivot",
    });
  }

  // La proyección pura no conoce tokens visuales; el adaptador replica el
  // contrato original y aplica --senal a los marcadores C1/C2/C3.
  const markerDescriptors = projectPatternMarkers(patternOverlay, rows, interval)
    .map((marker) => ({ ...marker, color: colors.senal }));
  if (!intraday && markerDescriptors.length > 0 && typeof createSeriesMarkers === "function") {
    createSeriesMarkers(mainSeries, markerDescriptors);
  }

  // Volumen
  let volumeSeries = null;
  if (indicators.volume) {
    volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: colors.line,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.setData(projectVolumeSeries(rows, { positive, upColor: colors.trazaDim, downColor: colors.line }));
    chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    extraSeries.push(volumeSeries);
  }

  // Medias móviles. Se calculan sobre el CONTEXTO (la serie agregada sin
  // recortar al rango) y se dibujan solo dentro de la ventana: así la media
  // no pierde su warm-up al principio del rango cuando hay histórico previo
  // (antes, una SMA200 en un rango de 1A solo cubría el tramo final). Los
  // valores en la zona común son idénticos: misma fórmula, mismas barras.
  const maSource = Array.isArray(overrides.contextRows) && overrides.contextRows.length >= rows.length
    ? overrides.contextRows
    : rows;
  const windowStart = rows[0]?.time ?? -Infinity;
  const maInWindow = (length) => movingAverage(maSource, length).filter((point) => point.time >= windowStart);
  if (indicators.maFast) {
    const series = chart.addSeries(LineSeries, { color: colors.soft, lineWidth: 1 });
    series.setData(maInWindow(indicators.maFastLength));
    extraSeries.push(series);
  }
  if (indicators.maSlow) {
    const series = chart.addSeries(LineSeries, { color: colors.humo, lineWidth: 1 });
    series.setData(maInWindow(indicators.maSlowLength));
    extraSeries.push(series);
  }

  // ── Línea RS rating (overlay en panel de precio) ───────────────────────────
  //
  // Percentil semanal 1-99 en escala overlay invisible con rango fijo y banda
  // inferior propia. No comparte eje con el precio ni reserva panel aparte.
  let rsSeries = null;
  const rsLineData = projectRsRatingSeries(rows, rsRatingSeries, indicators, interval);
  const rsHistory = rsLineHistory(rsLineData);
  const rsRendered = !intraday && !!indicators.rsLine && rsLineData.length > 1 && rsHistory.sufficient;
  if (rsRendered) {
    rsSeries = chart.addSeries(
      LineSeries,
      {
        color: colors.traza,
        lineWidth: 2,
        priceScaleId: RS_OVERLAY_SCALE_ID,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        title: "RS",
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: RS_SCALE_MIN, maxValue: RS_SCALE_MAX },
        }),
      },
      0,
    );
    rsSeries.setData(rsLineData.map((point) => ({ time: point.time, value: point.value })));
    if (typeof rsSeries.createPriceLine === "function") {
      rsSeries.createPriceLine({
        price: RS_REFERENCE,
        color: colors.line2,
        lineStyle: PRICE_SCALE_DASHED,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "",
      });
    }
    chart.priceScale(RS_OVERLAY_SCALE_ID).applyOptions({
      visible: false,
      autoScale: true,
      scaleMargins: RS_OVERLAY_MARGINS,
    });
    extraSeries.push(rsSeries);
  }

  // ── Línea de comparación con el benchmark ("Comparar vs") ────────────────
  //
  // Ratio precio/benchmark (rsLine del servidor), log-rebasado al primer
  // valor de la ventana y ANCLADO a los tiempos de las velas por la
  // proyección (analisis A2/B2: sin anclaje, cada punto con fecha propia
  // añade una columna fantasma al eje compartido). Vive en una escala
  // overlay invisible con banda propia: el precio no comparte escala con él
  // y conserva su autoescala. La línea se lee por forma (máximos y
  // pendiente), no por valor; por eso no lleva eje ni etiqueta de último
  // valor.
  let benchmarkLineSeries = null;
  const benchmarkLineData = projectBenchmarkLineSeries(rows, benchmarkSeries, interval, indicators);
  if (!intraday && benchmarkLineData.length > 1) {
    benchmarkLineSeries = chart.addSeries(LineSeries, {
      color: colors.soft,
      lineWidth: 1,
      priceScaleId: "benchmark-ratio",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }, 0);
    benchmarkLineSeries.setData(benchmarkLineData.map((point) => ({ time: point.time, value: point.value })));
    chart.priceScale("benchmark-ratio").applyOptions({
      visible: false,
      // Banda media-baja del panel del precio: por encima del volumen
      // (0.82→1) y por debajo del grueso de la acción del precio.
      scaleMargins: { top: 0.62, bottom: 0.24 },
    });
    extraSeries.push(benchmarkLineSeries);
  }

  function updateGeometry({ width: nextWidth = width, height: nextHeight = height, profile: nextProfile = profile } = {}) {
    const w = Math.max(Number(nextWidth) || 0, 280);
    const h = Number.isFinite(Number(nextHeight)) ? Number(nextHeight) : height;
    chart.applyOptions?.({
      width: w,
      height: h,
      rightPriceScale: { autoScale: true, scaleMargins: nextProfile.priceScaleMargins },
      timeScale: { ...nextProfile.timeScale },
      localization: {
        locale: "es-ES",
        priceFormatter: fmtPrice,
        timeFormatter: nextProfile.timeFormatter,
      },
    });
    mainSeries.priceScale?.().applyOptions?.({
      autoScale: true,
      scaleMargins: nextProfile.priceScaleMargins,
    });
  }

  function destroySeries() {
    // Quita listeners de las series nativas, si los hay (las series de
    // lightweight-charts no exponen remove(); basta con que el controller
    // llame `chart.remove()` para liberar la instancia completa). Aquí
    // simplemente nulos los handles para que el GC no retenga referencias.
    if (typeof mainSeries.setData === "function") {
      try { mainSeries.setData([]); } catch { /* noop */ }
    }
    for (const s of extraSeries) {
      if (s && typeof s.setData === "function") {
        try { s.setData([]); } catch { /* noop */ }
      }
    }
  }

  return {
    chart,
    mainSeries,
    extraSeries,
    markerDescriptors,
    pivotPriceLine,
    // Lo que el overlay RS acabó dibujando, para que el controller pueda
    // declarar la ausencia con su motivo sin recalcular la serie.
    rsPane: {
      rendered: rsRendered,
      paneIndex: rsRendered ? 0 : null,
      points: rsLineData.length,
      weeks: rsHistory.weeks,
      latestValue: rsRendered ? (rsLineData.at(-1)?.value ?? null) : null,
    },
    updateGeometry,
    destroySeries,
  };
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
  };
}
