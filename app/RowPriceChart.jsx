// app/RowPriceChart.jsx — envoltorio compartido de UniversalPriceChart para
// las superficies que trabajan sobre una FILA del screener (vista rápida y
// pantalla de revisión), no sobre una ficha hidratada.
//
// Existe para que esas dos pantallas usen exactamente el mismo gráfico que la
// ficha del valor, con los mismos colores y controles, sin duplicar la
// llamada a UniversalPriceChart ni sus reglas de calidad. La ficha
// (app/stock/[symbol]/StockClient.jsx) sigue llamando a UniversalPriceChart
// directamente: tiene barras OHLC completas del brief y no necesita esta
// capa.
//
// Lo único que añade sobre UniversalPriceChart:
//
//   1. Traduce la fila (`row`) a las props del chart: símbolo, divisa, RS,
//      benchmark, enlace externo.
//   2. Decide si `row.chartPreview` sirve como fuente local. El preview del
//      screener es close-only (lib/screenerPipeline.js → contractCompactChartPreview
//      guarda {date, close, volume, sma50, sma200}), así que en estilo vela
//      no es dibujable como tal: `resolveRowChartSource` lo pinta en línea al
//      instante (`preferredStyle` conserva velas para cuando llegue /api/chart).
//      En estilo línea/área el preview se usa directamente.

"use client";

import { useEffect, useMemo, useState } from "react";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { barsAreCandleGrade, chartQuality } from "@/lib/chartDataQuality";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import {
  chartRsPropsFromRow,
  chartRsPropsFromWeeklyResponse,
  rowHasChartRsSeries,
  rsWeeklyChartQuery,
} from "@/lib/chartRsRowProps";
import { canonicalRsValue } from "@/lib/rsCanonical";
import { externalLinks } from "@/lib/symbols";

// Estilos que dibujan una sola serie de cierres: "8" = Línea, "3" = Área
// (lib/chartSettings.js CHART_STYLES). Mismo criterio que lib/chartDataModel.js.
const LINE_STYLES = new Set(["8", "3"]);

// Identidad estable para el caso "no hay barras locales usables": el chart
// memoiza el localSource por huella de valor, pero devolver siempre el mismo
// array evita churn innecesario en cada render.
const NO_LOCAL_BARS = [];

/**
 * Decide qué barras locales puede consumir el chart para esta fila y estilo.
 * Devuelve `[]` cuando el preview existe pero no es dibujable en el estilo
 * pedido — eso hace que el chart pida la serie real en vez de quedarse mudo.
 */
export function localBarsForRow(row = null, style = DEFAULT_CHART_SETTINGS.style) {
  const preview = Array.isArray(row?.chartPreview) ? row.chartPreview : NO_LOCAL_BARS;
  if (!preview.length) return NO_LOCAL_BARS;
  if (LINE_STYLES.has(String(style))) return preview;
  return barsAreCandleGrade(preview) ? preview : NO_LOCAL_BARS;
}

/**
 * Fuente local + ajustes efectivos para filas del screener.
 * Si el estilo pedido es vela pero el preview es close-only, pinta el preview
 * en línea al instante y conserva `preferredStyle` para pasar a velas cuando
 * /api/chart devuelva OHLC real.
 */
export function resolveRowChartSource(row = null, settings = DEFAULT_CHART_SETTINGS) {
  const requestedStyle = String(settings?.style || DEFAULT_CHART_SETTINGS.style);
  const directBars = localBarsForRow(row, requestedStyle);
  if (directBars.length) {
    return { bars: directBars, settings, preferredStyle: null };
  }

  const preview = Array.isArray(row?.chartPreview) ? row.chartPreview : NO_LOCAL_BARS;
  if (
    preview.length >= 2
    && !LINE_STYLES.has(requestedStyle)
    && !barsAreCandleGrade(preview)
  ) {
    return {
      bars: preview,
      settings: { ...settings, style: "8" },
      preferredStyle: requestedStyle,
    };
  }

  return { bars: NO_LOCAL_BARS, settings, preferredStyle: null };
}

export default function RowPriceChart({
  row = null,
  settings = DEFAULT_CHART_SETTINGS,
  height = 460,
  className = "",
  emptyLabel = "Sin dato",
}) {
  const [fetchedRs, setFetchedRs] = useState(null);

  useEffect(() => {
    if (!row?.symbol) {
      setFetchedRs(null);
      return undefined;
    }
    if (rowHasChartRsSeries(row)) {
      setFetchedRs(null);
      return undefined;
    }

    const controller = new AbortController();
    const url = rsWeeklyChartQuery(row.symbol, row);
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (controller.signal.aborted) return;
        setFetchedRs(chartRsPropsFromWeeklyResponse(payload));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetchedRs(null);
      });

    return () => controller.abort();
  }, [
    row?.symbol,
    row?.sector,
    row?.industry,
    row?.theme,
    row?.globalRsSeries,
    row?.countryRsSeries,
    row?.themeRsSeries,
  ]);

  if (!row?.symbol) return <div className="previewEmpty">{emptyLabel}</div>;

  const links = externalLinks(row.symbol, row.exchange);
  const {
    bars,
    settings: chartSettings,
    preferredStyle,
  } = useMemo(() => resolveRowChartSource(row, settings), [
    row,
    settings?.range,
    settings?.interval,
    settings?.style,
    settings?.scale,
    // CHART-QR-2: sin indicators, UniversalPriceChart sigue con el snapshot
    // memoizado (rsCountryLine/rsThemeLine true) aunque quickReview los apague.
    settings?.indicators,
  ]);
  const rsChartProps = useMemo(
    () => chartRsPropsFromRow(row, fetchedRs),
    [row, fetchedRs],
  );
  // ADR §3.2/§9: la calidad local viaja explícita. Solo tiene sentido cuando
  // efectivamente pasamos barras locales; si las descartamos, el veredicto lo
  // pone el payload remoto de /api/chart.
  const localQuality = bars.length
    ? chartQuality({
      bars,
      meta: {
        estimated: row.chartEstimated === true,
        dataProvider: row.chartProvider || "",
      },
    })
    : null;

  return (
    <UniversalPriceChart
      bars={bars}
      symbol={row.symbol}
      currency={row.currency}
      tradingViewUrl={links.tradingView}
      settings={chartSettings}
      preferredStyle={preferredStyle}
      relativeStrength={row.relativeStrength || row.relativeStrengthSeries}
      // El badge «RS global» del chart lleva el RS canónico (ranking semanal
      // del universo, lib/rsCanonical.js), como en la ficha. Antes recibía
      // row.rsGlobalPct —el percentil del lote del escaneo— y estas dos
      // superficies enseñaban un número bajo la etiqueta RS que contradecía a
      // la tabla y a la ficha (docs/analisis-vista-rapida-2026-08-24.md, B1).
      rsMainScore={canonicalRsValue(row)}
      rsRatingSeries={rsChartProps.rsRatingSeries}
      rsCountrySeries={rsChartProps.rsCountrySeries}
      rsCountryMainScore={rsChartProps.rsCountryMainScore}
      rsThemeSeries={rsChartProps.rsThemeSeries}
      rsThemeMainScore={rsChartProps.rsThemeMainScore}
      benchmarkSymbol={row.benchmarkSymbol}
      localQuality={localQuality}
      className={className}
      height={height}
    />
  );
}
