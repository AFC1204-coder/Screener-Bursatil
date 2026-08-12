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
//      no es dibujable: `barsAreCandleGrade` lo rechaza y el data model
//      devolvería "Sin dato" sin llegar a pedir OHLC real, porque la
//      suficiencia se decide por número de barras, no por su forma. Pasando
//      `[]` en ese caso, el chart pide la serie real a /api/chart y pinta
//      velas de verdad. En estilo línea/área el preview sí vale y se usa tal
//      cual: pinta al instante y evita una petición.

"use client";

import UniversalPriceChart from "@/app/UniversalPriceChart";
import { barsAreCandleGrade, chartQuality } from "@/lib/chartDataQuality";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
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

export default function RowPriceChart({
  row = null,
  settings = DEFAULT_CHART_SETTINGS,
  height = 460,
  className = "",
  emptyLabel = "Sin dato",
}) {
  if (!row?.symbol) return <div className="previewEmpty">{emptyLabel}</div>;

  const links = externalLinks(row.symbol, row.exchange);
  const bars = localBarsForRow(row, settings?.style);
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
      settings={settings}
      relativeStrength={row.relativeStrength || row.relativeStrengthSeries}
      rsMainScore={row.rsGlobalPct}
      benchmarkSymbol={row.benchmarkSymbol}
      localQuality={localQuality}
      className={className}
      height={height}
    />
  );
}
