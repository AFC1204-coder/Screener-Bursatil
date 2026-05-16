"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHART_RANGES, DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : "Sin dato";
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

function isIntradayInterval(interval = "") {
  return ["1m", "5m", "15m", "30m", "1h", "4h"].includes(interval);
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
  if (interval === "D" || (isIntradayInterval(interval) && interval !== "4h")) return rows;
  const groups = new Map();
  for (const row of rows) {
    const key = interval === "4h" ? String(Math.floor(row.time / (4 * 60 * 60))) : interval === "M" ? row.date.slice(0, 7) : weekKey(row.date);
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

function rsLineDataForRows(rows = [], series = {}, interval = "D") {
  if (isIntradayInterval(interval)) return [];
  const points = (series?.points || [])
    .map((point) => ({
      time: timeFromBar(point),
      date: String(point.date || "").slice(0, 10),
      value: safeNumber(point.rsLine),
      ma: safeNumber(point.rsLineSma50),
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .sort((a, b) => a.time - b.time);
  if (rows.length < 2 || points.length < 2) return [];
  const output = [];
  let cursor = 0;
  let last = null;
  for (const row of rows) {
    while (cursor < points.length && points[cursor].time <= row.time) {
      last = points[cursor];
      cursor += 1;
    }
    if (last) output.push({ time: row.time, value: last.value, ma: last.ma, date: row.date });
  }
  return output.filter((point) => Number.isFinite(point.value));
}

function chartRangeRows(rows = [], rangeKey = DEFAULT_CHART_SETTINGS.range, interval = DEFAULT_CHART_SETTINGS.interval) {
  if (isIntradayInterval(interval)) return rows;
  const activeRange = CHART_RANGES.find((range) => range.key === rangeKey) || CHART_RANGES[3];
  if (activeRange.key === "MAX" || activeRange.bars === Infinity) return rows;
  return rows.slice(-Math.min(activeRange.bars, rows.length));
}

export default function UniversalPriceChart({
  bars = [],
  symbol = "",
  currency = "",
  settings = DEFAULT_CHART_SETTINGS,
  tradingViewUrl = "",
  relativeStrength = null,
  benchmarkSymbol = "",
  className = "",
  height = 460,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [remote, setRemote] = useState({ bars: null, loading: false, error: "", meta: null });
  const [renderError, setRenderError] = useState("");
  const range = settings?.range || DEFAULT_CHART_SETTINGS.range;
  const interval = settings?.interval || DEFAULT_CHART_SETTINGS.interval;
  const style = settings?.style || DEFAULT_CHART_SETTINGS.style;
  const scale = settings?.scale || DEFAULT_CHART_SETTINGS.scale;
  const indicators = { ...DEFAULT_CHART_SETTINGS.indicators, ...(settings?.indicators || {}) };
  const needsRemote = isIntradayInterval(interval);

  useEffect(() => {
    if (!needsRemote || !symbol) {
      setRemote({ bars: null, loading: false, error: "", meta: null });
      return;
    }
    const controller = new AbortController();
    setRemote((prev) => ({ ...prev, loading: true, error: "" }));
    const params = new URLSearchParams({ symbol, range, interval });
    fetch(`/api/chart?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json().then((json) => ({ ok: res.ok, status: res.status, json })))
      .then(({ ok, status, json }) => {
        if (!ok || json.error) throw new Error(json.error || `HTTP ${status}`);
        setRemote({ bars: json.bars || [], loading: false, error: "", meta: json.meta || null });
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setRemote({ bars: [], loading: false, error: error.message || "Proveedor intradia no disponible", meta: null });
      });
    return () => controller.abort();
  }, [needsRemote, symbol, range, interval]);

  const rows = useMemo(() => {
    const sourceBars = needsRemote ? (remote.bars || []) : bars;
    const normalized = normalizeRows(sourceBars);
    return chartRangeRows(aggregateRows(normalized, interval), range, interval);
  }, [bars, remote.bars, needsRemote, interval, range]);
  const rsLineData = useMemo(
    () => indicators.rsLine ? rsLineDataForRows(rows, relativeStrength, interval) : [],
    [rows, relativeStrength, interval, indicators.rsLine],
  );

  const latest = rows.at(-1);
  const first = rows[0];
  const change = first?.close ? ((latest?.close / first.close) - 1) * 100 : null;
  const positive = !Number.isFinite(change) || change >= 0;

  useEffect(() => {
    let cancelled = false;
    let chart = null;
    let resizeObserver = null;

    async function render() {
      if (!containerRef.current || rows.length < 2) return;
      setRenderError("");
      const {
        AreaSeries,
        CandlestickSeries,
        createChart,
        HistogramSeries,
        LineSeries,
        PriceScaleMode,
      } = await import("lightweight-charts");

      if (cancelled || !containerRef.current) return;
      const container = containerRef.current;
      container.innerHTML = "";
      const width = Math.max(container.clientWidth || 0, 320);

      chart = createChart(container, {
        width,
        height,
        layout: {
          background: { color: "transparent" },
          textColor: "rgba(235, 235, 242, .72)",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          fontSize: 12,
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,.035)" },
          horzLines: { color: "rgba(255,255,255,.07)" },
        },
        rightPriceScale: {
          borderColor: "rgba(255,255,255,.1)",
          mode: scale === "log" ? PriceScaleMode.Logarithmic : scale === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal,
          scaleMargins: { top: 0.08, bottom: 0.25 },
        },
        timeScale: {
          borderColor: "rgba(255,255,255,.1)",
          fixLeftEdge: true,
          fixRightEdge: true,
          timeVisible: isIntradayInterval(interval),
        },
        crosshair: {
          vertLine: { color: "rgba(214,174,92,.34)", labelBackgroundColor: "#1d2430" },
          horzLine: { color: "rgba(214,174,92,.26)", labelBackgroundColor: "#1d2430" },
        },
        localization: {
          priceFormatter: (price) => fmt(price),
        },
      });
      chartRef.current = chart;

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
              lineColor: positive ? "#4ade80" : "#ff6464",
              topColor: positive ? "rgba(74, 222, 128, .22)" : "rgba(255, 100, 100, .2)",
              bottomColor: "rgba(0,0,0,0)",
              lineWidth: 2,
            }
          : isLine
            ? { color: positive ? "#4ade80" : "#ff6464", lineWidth: 2 }
            : {
                upColor: "#4ade80",
                downColor: "#ff6464",
                borderUpColor: "#4ade80",
                borderDownColor: "#ff6464",
                wickUpColor: "rgba(74, 222, 128, .72)",
                wickDownColor: "rgba(255, 100, 100, .72)",
              },
      );
      mainSeries.setData(isLine || isArea ? lineData : candleData);

      if (indicators.volume) {
        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
          color: "rgba(160,160,170,.24)",
        });
        volumeSeries.setData(rows.map((row) => ({
          time: row.time,
          value: row.volume || 0,
          color: row.close >= row.open ? "rgba(74,222,128,.28)" : "rgba(255,100,100,.26)",
        })));
        chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }

      const maFastLength = Math.max(2, Math.min(400, Number(indicators.maFastLength) || 50));
      const maSlowLength = Math.max(2, Math.min(600, Number(indicators.maSlowLength) || 200));
      const smaFast = indicators.maFast ? movingAverage(rows, maFastLength) : [];
      if (smaFast.length) {
        const series = chart.addSeries(LineSeries, { color: "rgba(235,235,242,.58)", lineWidth: 1 });
        series.setData(smaFast);
      }
      const smaSlow = indicators.maSlow ? movingAverage(rows, maSlowLength) : [];
      if (smaSlow.length) {
        const series = chart.addSeries(LineSeries, { color: "rgba(214,174,92,.42)", lineWidth: 1 });
        series.setData(smaSlow);
      }

      if (rsLineData.length > 1) {
        const rsScaleId = "rs-line";
        const rsSeries = chart.addSeries(LineSeries, {
          color: "rgba(96,165,250,.9)",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceScaleId: rsScaleId,
          title: "RS",
        });
        rsSeries.setData(rsLineData.map((point) => ({ time: point.time, value: point.value })));
        rsSeries.createPriceLine?.({
          price: 100,
          color: "rgba(96,165,250,.22)",
          lineStyle: 2,
          lineWidth: 1,
          axisLabelVisible: false,
          title: "RS 100",
        });
        const rsMa = rsLineData.filter((point) => Number.isFinite(point.ma)).map((point) => ({ time: point.time, value: point.ma }));
        if (rsMa.length > 1) {
          const rsMaSeries = chart.addSeries(LineSeries, {
            color: "rgba(235,235,242,.34)",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            priceScaleId: rsScaleId,
          });
          rsMaSeries.setData(rsMa);
        }
        chart.priceScale(rsScaleId).applyOptions({
          scaleMargins: indicators.volume ? { top: 0.64, bottom: 0.19 } : { top: 0.72, bottom: 0.06 },
        });
      }

      chart.timeScale().fitContent();
      resizeObserver = new ResizeObserver(([entry]) => {
        const nextWidth = Math.floor(entry.contentRect.width);
        if (nextWidth > 0) chart?.applyOptions({ width: nextWidth, height });
      });
      resizeObserver.observe(container);
    }

    render().catch((error) => {
      if (!cancelled) setRenderError(error.message || "Grafico no disponible");
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      chartRef.current = null;
      chart?.remove();
    };
  }, [rows, style, positive, height, scale, interval, indicators.volume, indicators.rsLine, indicators.maFast, indicators.maFastLength, indicators.maSlow, indicators.maSlowLength, rsLineData, benchmarkSymbol]);

  if (rows.length < 2) {
    return <div className={`universalChart empty ${className}`}>
      {remote.loading ? "Cargando intradia..." : remote.error ? `Proveedor intradia no disponible: ${remote.error}` : "Historico insuficiente"}
    </div>;
  }

  return <div className={`universalChart ${className}`}>
    <div className="universalChartHead">
      <div>
        <span>{symbol}</span>
        <b>{money(latest?.close, currency)}</b>
        <em className={positive ? "positive" : "negative"}>{pct(change)}</em>
      </div>
      {rsLineData.length > 1 && <div className="universalChartBadges" title={`RS vs ${benchmarkSymbol || "benchmark"}`} aria-label={`RS vs ${benchmarkSymbol || "benchmark"}`}>
        <span>RS</span>
        <b>{rsLineData.at(-1)?.value?.toFixed?.(1) || "-"}</b>
      </div>}
      {tradingViewUrl && <a className="priceTvLink" href={tradingViewUrl} target="_blank" rel="noreferrer">Abrir TradingView</a>}
    </div>
    <div className="universalChartCanvas" ref={containerRef} style={{ minHeight: height }} />
    {renderError && <p className="dataNote">{renderError}</p>}
  </div>;
}
