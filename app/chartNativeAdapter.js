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

import { adaptiveChartProfile, responsiveChartHeight } from "@/lib/chartViewportModel";
import {
  movingAverage,
  projectBenchmarkLineSeries,
  projectCandles,
  projectLineSeries,
  projectPatternMarkers,
  projectRsRatingSeries,
  projectVolumeSeries,
} from "@/lib/chartSeriesModel";

const PRICE_SCALE_LINE = 2;
const PRICE_SCALE_DASHED = 2;

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
 * @param {object} args.colors                    tokens CSS ya resueltos.
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
 *   updateGeometry: (next: { width, height, profile }) => void,
 *   updateRsBadge: (() => void) | null,
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
    requestedHeight = 460,
  } = overrides;

  const width = Math.max(container.clientWidth || 0, 280);
  const height = responsiveChartHeight(width, requestedHeight);

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

  // Pattern markers (sin color, sólo descriptores)
  const markerDescriptors = projectPatternMarkers(patternOverlay, rows, interval);
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

  // Medias móviles
  if (indicators.maFast) {
    const series = chart.addSeries(LineSeries, { color: colors.soft, lineWidth: 1 });
    series.setData(movingAverage(rows, indicators.maFastLength));
    extraSeries.push(series);
  }
  if (indicators.maSlow) {
    const series = chart.addSeries(LineSeries, { color: colors.humo, lineWidth: 1 });
    series.setData(movingAverage(rows, indicators.maSlowLength));
    extraSeries.push(series);
  }

  // Línea RS
  let rsSeries = null;
  let updateRsBadge = null;
  const rsLineData = projectRsRatingSeries(rows, rsRatingSeries, indicators, interval);
  if (!intraday && indicators.rsLine && rsLineData.length > 1) {
    const rsScaleId = "rs-line-overlay";
    rsSeries = chart.addSeries(LineSeries, {
      color: colors.traza,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: rsScaleId,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
      title: "",
    });
    rsSeries.setData(rsLineData.map((point) => ({ time: point.time, value: point.value })));
    if (typeof rsSeries.createPriceLine === "function") {
      rsSeries.createPriceLine({
        price: 0,
        color: colors.line2,
        lineStyle: PRICE_SCALE_DASHED,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "RS base",
      });
    }
    chart.priceScale(rsScaleId).applyOptions({
      visible: false,
      autoScale: true,
      scaleMargins: indicators.volume ? { top: 0.56, bottom: 0.14 } : { top: 0.62, bottom: 0.06 },
    });
    extraSeries.push(rsSeries);

    const rsBadgeRef = overrides.rsBadgeRef || null;
    updateRsBadge = () => {
      const badge = rsBadgeRef && rsBadgeRef.current;
      const latestRsPoint = rsLineData.at(-1);
      if (!badge || !latestRsPoint) return;
      const timeScale = chart.timeScale?.();
      if (!timeScale) return;
      const x = timeScale.timeToCoordinate?.(latestRsPoint.time);
      const y = rsSeries.priceToCoordinate?.(latestRsPoint.value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        badge.style.opacity = "0";
        return;
      }
      const nextX = container.offsetLeft + Math.min(Math.max(x + 8, 8), Math.max(8, width - 78));
      const nextY = container.offsetTop + Math.min(Math.max(y - 13, 18), Math.max(18, height - 30));
      badge.style.transform = `translate(${Math.round(nextX)}px, ${Math.round(nextY)}px)`;
      badge.style.opacity = "1";
    };
  }

  // Benchmark line (proyección sin pintar — el controller decide si la quiere)
  // Se proyecta aquí para que la pieza pura siga siendo la única fuente de
  // cálculos sobre rows seguras, pero el render queda a decisión del
  // controller; el adapter no la pinta por defecto.
  void projectBenchmarkLineSeries(rows, overrides.benchmarkSeries, interval, indicators);

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
    if (updateRsBadge) updateRsBadge();
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
    updateGeometry,
    updateRsBadge,
    destroySeries,
  };
}

/**
 * Resuelve los tokens CSS del sistema visual a colores concretos para
 * `lightweight-charts`. Es un helper del adapter porque es la única
 * pieza que toca el DOM.
 */
export function resolveCssTokensNative() {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return {
      soft: "#cccccc",
      humo: "#888888",
      tiza: "#ffffff",
      traza: "#cccccc",
      trazaDim: "#aaaaaa",
      line: "#222222",
      line2: "#333333",
      line3: "#444444",
      pizarra2: "#1a1a1a",
    };
  }
  const root = document.documentElement;
  const get = (name, fallback) => {
    const value = getComputedStyle(root).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    soft: get("--ink-soft, #cccccc"),
    humo: get("--ink-humo, #888888"),
    tiza: get("--ink-tiza, #ffffff"),
    traza: get("--ink-traza, #cccccc"),
    trazaDim: get("--ink-traza-dim, #aaaaaa"),
    line: get("--rule-line, #222222"),
    line2: get("--rule-line-2, #333333"),
    line3: get("--rule-line-3, #444444"),
    pizarra2: get("--pizarra-2, #1a1a1a"),
  };
}
