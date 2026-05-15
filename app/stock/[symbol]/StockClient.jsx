"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ChartPreferences from "@/app/ChartPreferences";
import { CHART_RANGES, DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
const pct = (n) => Number.isFinite(n) ? `${n.toFixed(1)}%` : "Sin dato";
const ratio = (n) => Number.isFinite(n) ? n.toFixed(2) : "Sin dato";
const margin = (numerator, denominator) => Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? pct((numerator / denominator) * 100) : "Sin dato";
const dateFmt = (value) => {
  if (!value) return "Sin dato";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "2-digit" }) : "Sin dato";
};
const money = (n, currency = "") => {
  if (!Number.isFinite(n)) return "Sin dato";
  const abs = Math.abs(n);
  const value = abs >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : abs >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : fmt(n);
  return currency ? `${value} ${currency}` : value;
};
const priceMoney = (n, currency = "") => {
  if (!Number.isFinite(n)) return "Sin dato";
  const value = n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${value} ${currency}` : value;
};
const signedPriceMoney = (n, currency = "") => {
  if (!Number.isFinite(n)) return "";
  const sign = n > 0 ? "+" : "";
  return `${sign}${priceMoney(n, currency)}`;
};
const sentimentClass = (label = "") => label === "alcista" ? "bullish" : label === "bajista" ? "bearish" : "neutral";
const textKey = (...values) => values.filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function hexToRgb(hex = "#d6ae5c") {
  const clean = hex.replace("#", "");
  const value = clean.length === 3 ? clean.split("").map((x) => x + x).join("") : clean;
  const int = parseInt(value, 16);
  return Number.isFinite(int) ? `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}` : "214, 174, 92";
}

function countryAccent(country = "", symbol = "") {
  const text = textKey(country, symbol);
  if (/china|hong kong|\.hk|\bcn\b/.test(text)) return "#c83d3d";
  if (/taiwan|\.tw/.test(text)) return "#2f7de1";
  if (/japon|japan|\.t\b/.test(text)) return "#d94b4b";
  if (/singapur|singapore|\.si/.test(text)) return "#db3b45";
  if (/australia|\.ax/.test(text)) return "#3b82f6";
  if (/espana|spain|\.mc/.test(text)) return "#d6ae5c";
  if (/alemania|germany|\.de/.test(text)) return "#d6ae5c";
  if (/francia|france|\.pa/.test(text)) return "#3b82f6";
  if (/reino unido|united kingdom|\.l\b/.test(text)) return "#4169e1";
  if (/estados unidos|united states|usa|nasdaq|nyse/.test(text)) return "#3b82f6";
  return "#d6ae5c";
}

function sectorAccent(sector = "", theme = "", industry = "") {
  const text = textKey(sector, theme, industry);
  if (/communication|internet|gaming|media|plataformas|publicidad/.test(text)) return "#7c5cff";
  if (/technology|software|semiconductor|cloud|ia|ai/.test(text)) return "#38bdf8";
  if (/consumer|retail|e-commerce|marca|cyclical/.test(text)) return "#f59e0b";
  if (/health|biotech|medical|pharma/.test(text)) return "#22c55e";
  if (/industrial|defensa|aero|electrical|automation/.test(text)) return "#d6ae5c";
  if (/financial|bank|insurance|fintech/.test(text)) return "#14b8a6";
  if (/energy|energia|utility|utilities|power/.test(text)) return "#60a5fa";
  return "#d6ae5c";
}

function stockAccentStyle(data = {}, symbol = "") {
  const country = countryAccent(data.country, symbol);
  const sector = sectorAccent(data.sector, data.theme, data.industry);
  return {
    "--stock-country-accent": country,
    "--stock-country-rgb": hexToRgb(country),
    "--stock-sector-accent": sector,
    "--stock-sector-rgb": hexToRgb(sector),
  };
}

function TradingViewChart({ symbol, settings = DEFAULT_CHART_SETTINGS }) {
  const ref = useRef(null);
  const interval = settings?.interval || DEFAULT_CHART_SETTINGS.interval;
  const range = settings?.range || DEFAULT_CHART_SETTINGS.range;
  const style = settings?.style || DEFAULT_CHART_SETTINGS.style;
  useEffect(() => {
    if (!ref.current || !symbol) return;
    ref.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      range,
      timezone: "Etc/UTC",
      theme: "dark",
      style,
      locale: "es",
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    ref.current.appendChild(script);
    return () => { if (ref.current) ref.current.innerHTML = ""; };
  }, [symbol, interval, range, style]);
  return <div className="tvBox"><div className="tradingview-widget-container" ref={ref} /></div>;
}

function PriceFallbackChart({ bars = [], symbol, currency = "", reason = "", tradingViewUrl = "", settings = DEFAULT_CHART_SETTINGS }) {
  const allRows = useMemo(() => (bars || [])
    .filter((bar) => Number.isFinite(bar.close))
    .sort((a, b) => new Date(a.date) - new Date(b.date)), [bars]);
  if (!allRows.length) return <div className="priceFallback empty">Historico insuficiente</div>;
  const activeRange = CHART_RANGES.find((range) => range.key === settings?.range) || CHART_RANGES[3];
  const rows = allRows.slice(-Math.min(activeRange.bars, allRows.length));
  const width = 960;
  const height = 320;
  const padX = 18;
  const padTop = 18;
  const padBottom = 36;
  const priceValues = rows.flatMap((bar) => [bar.open, bar.high, bar.low, bar.close].filter(Number.isFinite));
  const rawMin = Math.min(...priceValues);
  const rawMax = Math.max(...priceValues);
  const rawSpan = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
  const min = rawMin - rawSpan * .08;
  const max = rawMax + rawSpan * .08;
  const span = max - min || Math.max(max, 1);
  const x = (index) => padX + (index / Math.max(rows.length - 1, 1)) * (width - padX * 2);
  const y = (value) => padTop + ((max - value) / span) * (height - padTop - padBottom);
  const line = rows.map((bar, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(bar.close).toFixed(2)}`).join(" ");
  const area = `${line} L${x(rows.length - 1).toFixed(2)},${height - padBottom} L${x(0).toFixed(2)},${height - padBottom} Z`;
  const latest = rows[rows.length - 1];
  const first = rows[0];
  const change = first?.close ? ((latest.close / first.close) - 1) * 100 : null;
  const maxVol = Math.max(...rows.map((bar) => bar.volume || 0), 1);
  const positive = !Number.isFinite(change) || change >= 0;
  const volumeWidth = Math.max(1, Math.min(6, ((width - padX * 2) / rows.length) * .42));
  const chartStyle = settings?.style || DEFAULT_CHART_SETTINGS.style;
  const candleWidth = Math.max(2, Math.min(9, ((width - padX * 2) / rows.length) * .56));
  const canShowCandles = chartStyle === "1" && rows.some((bar) => Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low));
  const showArea = chartStyle === "3";
  return <div className="priceFallback">
    <div className="priceFallbackHead">
      <div>
        <span>{symbol}</span>
        <b>{money(latest.close, currency)}</b>
        <em className={positive ? "positive" : "negative"}>{pct(change)}</em>
      </div>
      <div className="priceFallbackTools">
        {tradingViewUrl && <a className="priceTvLink" href={tradingViewUrl} target="_blank" rel="noreferrer">Abrir TradingView</a>}
      </div>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafico de precio de ${symbol}`}>
      <defs>
        <linearGradient id={`area-${String(symbol).replace(/[^a-z0-9]/gi, "-")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={positive ? "#d6ae5c" : "#ff7a7a"} stopOpacity=".3" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((tick) => {
        const yy = padTop + tick * ((height - padTop - padBottom) / 3);
        const value = max - tick * (span / 3);
        return <g key={tick}>
          <line x1={padX} x2={width - padX} y1={yy} y2={yy} />
          <text x={width - padX} y={yy - 5}>{money(value, currency)}</text>
        </g>;
      })}
      {rows.map((bar, index) => {
        const volHeight = Math.max(1, ((bar.volume || 0) / maxVol) * 46);
        return <rect key={`${bar.date}-vol`} className="volumeBar" x={x(index) - volumeWidth / 2} y={height - padBottom - volHeight} width={volumeWidth} height={volHeight} />;
      })}
      {showArea && <path className="area" d={area} fill={`url(#area-${String(symbol).replace(/[^a-z0-9]/gi, "-")})`} />}
      {canShowCandles ? rows.map((bar, index) => {
        const open = Number.isFinite(bar.open) ? bar.open : bar.close;
        const high = Number.isFinite(bar.high) ? bar.high : Math.max(open, bar.close);
        const low = Number.isFinite(bar.low) ? bar.low : Math.min(open, bar.close);
        const up = bar.close >= open;
        const top = Math.min(y(open), y(bar.close));
        const bodyHeight = Math.max(1, Math.abs(y(open) - y(bar.close)));
        return <g key={`${bar.date}-candle`} className={up ? "candle positive" : "candle negative"}>
          <line className="candleWick" x1={x(index)} x2={x(index)} y1={y(high)} y2={y(low)} />
          <rect className="candleBody" x={x(index) - candleWidth / 2} y={top} width={candleWidth} height={bodyHeight} />
        </g>;
      }) : <path className={positive ? "line positive" : "line negative"} d={line} />}
      <circle cx={x(rows.length - 1)} cy={y(latest.close)} r="4" />
    </svg>
    <div className="priceFallbackFoot">
      <span>{rows[0]?.date || "-"}</span>
      <span>{activeRange.label}</span>
      <span>{latest.date || "-"}</span>
    </div>
    {reason && <p className="srOnly">{reason}</p>}
  </div>;
}

function pathFromPoints(points = [], key, x, y) {
  let open = false;
  return points.map((point, index) => {
    const value = point[key];
    if (!Number.isFinite(value)) {
      open = false;
      return "";
    }
    const cmd = open ? "L" : "M";
    open = true;
    return `${cmd}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
  }).filter(Boolean).join(" ");
}

function RsLineChart({ series = {}, benchmarkSymbol = "" }) {
  const points = (series?.points || []).filter((point) => Number.isFinite(point.rsLine));
  if (points.length < 2) return <div className="dataNote">Historico insuficiente para graficar la linea RS.</div>;
  const width = 760;
  const height = 260;
  const padX = 22;
  const padTop = 26;
  const padBottom = 42;
  const values = points.flatMap((point) => [point.rsLine, point.rsLineSma50].filter(Number.isFinite));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * .04);
  const x = (index) => padX + (index / Math.max(1, points.length - 1)) * (width - padX * 2);
  const y = (value) => padTop + ((max - value) / span) * (height - padTop - padBottom);
  const first = points[0]?.rsLine;
  const latest = points.at(-1)?.rsLine;
  const up = !Number.isFinite(first) || !Number.isFinite(latest) || latest >= first;
  const line = pathFromPoints(points, "rsLine", x, y);
  const ma = pathFromPoints(points, "rsLineSma50", x, y);
  const ratingPoints = points.filter((point) => Number.isFinite(point.rsRating));
  return <div className="rsLineChart">
    <div className="rsLineMeta">
      <span><b>{Number.isFinite(series.latestLine) ? series.latestLine.toFixed(1) : "-"}</b><small>RS line vs {benchmarkSymbol || "benchmark"}</small></span>
      <span><b>{Number.isFinite(series.latestRating) ? series.latestRating.toFixed(0) : "-"}</b><small>RS rating aprox.</small></span>
      <span><b>{pct(series.trend21d)}</b><small>cambio 21d RS</small></span>
      <span><b>{series.newHigh52w ? "Si" : "No"}</b><small>maximo RS 52w</small></span>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Linea de fuerza relativa vs ${benchmarkSymbol || "benchmark"}`}>
      {[0, 1, 2, 3].map((tick) => {
        const yy = padTop + tick * ((height - padTop - padBottom) / 3);
        const value = max - tick * (span / 3);
        return <g key={tick}>
          <line className="rsGrid" x1={padX} x2={width - padX} y1={yy} y2={yy} />
          <text x={width - padX} y={yy - 5}>{value.toFixed(1)}</text>
        </g>;
      })}
      <path className={`rsArea ${up ? "up" : "down"}`} d={`${line} L${x(points.length - 1).toFixed(2)},${height - padBottom} L${x(0).toFixed(2)},${height - padBottom} Z`} />
      {ma && <path className="rsMa" d={ma} />}
      <path className={`rsLine ${up ? "up" : "down"}`} d={line} />
      <circle className="rsLast" cx={x(points.length - 1)} cy={y(latest)} r="4" />
    </svg>
    <div className="rsLineFoot">
      <span>{points[0]?.date || "-"}</span>
      <span>{ratingPoints.length ? `${ratingPoints.length} puntos con rating aproximado` : "RS line normalizada"}</span>
      <span>{points.at(-1)?.date || "-"}</span>
    </div>
    {series.note && <p className="fine">{series.note}</p>}
  </div>;
}

function Metric({ label, value, tone = "" }) {
  return <div className={`metric ${tone}`.trim()}><span>{label}</span><b>{value}</b></div>;
}

function PeerLogo({ item }) {
  const [index, setIndex] = useState(0);
  const sources = [item.logoUrl, item.fallbackLogoUrl].filter(Boolean);
  const src = sources[index];
  return <span className="companyMark similarLogo">
    <b>{String(item.name || item.symbol).slice(0, 2).toUpperCase()}</b>
    {src ? <img src={src} alt="" loading="lazy" onError={() => setIndex((value) => value + 1)} /> : null}
  </span>;
}

function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span>i</span>
    <em>{text}</em>
  </span>;
}

function SignalStat({ label, value, detail, tone = "" }) {
  return <div className={`signalStat ${tone}`}>
    <span>{label}</span>
    <b>{value}</b>
    {detail && <small>{detail}</small>}
  </div>;
}

function HolderTable({ title, rows }) {
  return <section className="card">
    <h2>{title}</h2>
    <div className="tableWrap">
      <table className="table">
        <thead><tr>{["Nombre", "%", "Posicion", "Valor", "Fecha"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows?.length ? rows.map((r) => <tr key={`${title}-${r.name}`}><td>{r.name}</td><td>{pct(r.pctHeld)}</td><td>{fmt(r.position)}</td><td>{fmt(r.value)}</td><td>{r.reportDate || "Sin dato"}</td></tr>) : <tr><td colSpan="5">Sin dato</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

function EarningsSection({ calendar = {}, currency = "" }) {
  if (!calendar) return null;
  return <section className="card">
    <div className="sectionTitle">
      <h2>Resultados y calendario <InfoHint text={calendar.source || "Calendario y estimaciones segun proveedor disponible."} /></h2>
    </div>
    <div className="calendarGrid">
      <Metric label="Proxima fecha resultados" value={calendar.earningsDate || (calendar.earningsStart && calendar.earningsEnd ? `${calendar.earningsStart} / ${calendar.earningsEnd}` : "Sin dato")} />
      <Metric label="EPS estimate" value={money(calendar.epsEstimate, currency)} />
      <Metric label="EPS growth est." value={pct(calendar.epsEstimateGrowth)} />
      <Metric label="Revenue estimate" value={money(calendar.revenueEstimate, currency)} />
      <Metric label="Revenue growth est." value={pct(calendar.revenueEstimateGrowth)} />
      <Metric label="Ex-dividend date" value={calendar.exDividendDate || "Sin dato"} />
    </div>
  </section>;
}

function ResultsSection({ results = {}, currency = "" }) {
  const [period, setPeriod] = useState("quarter");
  const [statement, setStatement] = useState("summary");
  const incomeQuarterly = results?.incomeQuarterly || [];
  const incomeAnnual = results?.incomeAnnual || [];
  const incomeRows = period === "quarter" ? incomeQuarterly : incomeAnnual;
  const balanceRows = period === "quarter" ? (results?.balanceQuarterly || []) : (results?.balanceAnnual || []);
  const cashflowRows = period === "quarter" ? (results?.cashflowQuarterly || []) : (results?.cashflowAnnual || []);
  const latestQuarter = incomeQuarterly[0] || incomeAnnual[0] || {};
  const latestAnnual = incomeAnnual[0] || {};
  const latest = results?.latest || {};
  const balance = results?.balanceQuarterly?.[0] || results?.balanceAnnual?.[0] || {};
  const cashflowQuarter = results?.cashflowQuarterly?.[0] || results?.cashflowAnnual?.[0] || {};
  const cashflowAnnual = results?.cashflowAnnual?.[0] || {};
  if (!results) return null;

  const findByDate = (rows, date, index) => rows.find((row) => row.date === date) || rows[index] || {};
  const count = Math.max(incomeRows.length, balanceRows.length, cashflowRows.length);
  const periods = Array.from({ length: count }).map((_, index) => {
    const income = incomeRows[index] || {};
    const date = income.date || balanceRows[index]?.date || cashflowRows[index]?.date || "";
    return {
      date,
      income,
      balance: findByDate(balanceRows, date, index),
      cashflow: findByDate(cashflowRows, date, index),
    };
  }).filter((row) => row.date).slice(0, period === "quarter" ? 8 : 6);

  const debtEquity = (row) => Number.isFinite(row.balance?.totalDebt) && Number.isFinite(row.balance?.equity) && row.balance.equity !== 0 ? row.balance.totalDebt / row.balance.equity : null;
  const fcfMargin = (row) => Number.isFinite(row.cashflow?.freeCashFlow) && Number.isFinite(row.income?.revenue) && row.income.revenue !== 0 ? (row.cashflow.freeCashFlow / row.income.revenue) * 100 : null;
  const formatValue = (value, type) => {
    if (type === "money") return money(value, currency);
    if (type === "pct") return pct(value);
    if (type === "ratio") return ratio(value);
    return fmt(value);
  };
  const valueTone = (value, tone) => {
    if (!tone || !Number.isFinite(value)) return "";
    return value > 0 ? "positive" : value < 0 ? "negative" : "";
  };
  const rowsByStatement = {
    summary: [
      { label: "Ventas", type: "money", get: (row) => row.income.revenue },
      { label: "Ventas YoY", type: "pct", tone: true, get: (row) => row.income.revenueGrowthYoY },
      { label: "Margen bruto", type: "pct", get: (row) => Number.isFinite(row.income.grossProfit) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.grossProfit / row.income.revenue) * 100 : null },
      { label: "Margen operativo", type: "pct", get: (row) => Number.isFinite(row.income.operatingIncome) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.operatingIncome / row.income.revenue) * 100 : null },
      { label: "Beneficio neto", type: "money", get: (row) => row.income.netIncome },
      { label: "Beneficio YoY", type: "pct", tone: true, get: (row) => row.income.netIncomeGrowthYoY },
      { label: "EPS", type: "ratio", get: (row) => row.income.eps },
      { label: "Free cash flow", type: "money", get: (row) => row.cashflow.freeCashFlow },
      { label: "Caja", type: "money", get: (row) => row.balance.cash },
      { label: "Deuda total", type: "money", get: (row) => row.balance.totalDebt },
    ],
    income: [
      { label: "Ventas", type: "money", get: (row) => row.income.revenue },
      { label: "Ventas YoY", type: "pct", tone: true, get: (row) => row.income.revenueGrowthYoY },
      { label: "Beneficio bruto", type: "money", get: (row) => row.income.grossProfit },
      { label: "Margen bruto", type: "pct", get: (row) => Number.isFinite(row.income.grossProfit) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.grossProfit / row.income.revenue) * 100 : null },
      { label: "Resultado operativo", type: "money", get: (row) => row.income.operatingIncome },
      { label: "Margen operativo", type: "pct", get: (row) => Number.isFinite(row.income.operatingIncome) && Number.isFinite(row.income.revenue) && row.income.revenue !== 0 ? (row.income.operatingIncome / row.income.revenue) * 100 : null },
      { label: "EBITDA", type: "money", get: (row) => row.income.ebitda },
      { label: "Beneficio neto", type: "money", get: (row) => row.income.netIncome },
      { label: "Beneficio YoY", type: "pct", tone: true, get: (row) => row.income.netIncomeGrowthYoY },
      { label: "EPS", type: "ratio", get: (row) => row.income.eps },
    ],
    balance: [
      { label: "Caja", type: "money", get: (row) => row.balance.cash },
      { label: "Deuda total", type: "money", get: (row) => row.balance.totalDebt },
      { label: "Activos totales", type: "money", get: (row) => row.balance.totalAssets },
      { label: "Pasivos totales", type: "money", get: (row) => row.balance.totalLiabilities },
      { label: "Patrimonio", type: "money", get: (row) => row.balance.equity },
      { label: "Deuda / patrimonio", type: "ratio", get: debtEquity },
    ],
    cashflow: [
      { label: "Cash flow operativo", type: "money", get: (row) => row.cashflow.operatingCashFlow },
      { label: "Capex", type: "money", get: (row) => row.cashflow.capitalExpenditures },
      { label: "Free cash flow", type: "money", get: (row) => row.cashflow.freeCashFlow },
      { label: "Margen FCF", type: "pct", get: fcfMargin },
      { label: "Dividendos pagados", type: "money", get: (row) => row.cashflow.dividendsPaid },
      { label: "Recompras", type: "money", get: (row) => row.cashflow.repurchaseOfStock },
    ],
  };
  const tableRows = rowsByStatement[statement] || rowsByStatement.summary;
  const candidateRows = tableRows.filter((row) => periods.some((periodRow) => Number.isFinite(row.get(periodRow))));
  const minValuesByStatement = statement === "summary" ? 4 : statement === "income" ? 3 : 1;
  const visiblePeriods = periods.filter((periodRow) => candidateRows.reduce((count, row) => count + (Number.isFinite(row.get(periodRow)) ? 1 : 0), 0) >= minValuesByStatement);
  const visibleRows = candidateRows.filter((row) => visiblePeriods.some((periodRow) => Number.isFinite(row.get(periodRow))));

  return <section className="card fundamentalCard">
    <div className="sectionTitle">
      <h2>Fundamentales historicos <InfoHint text={`Fuente: ${results.source || "Yahoo / SEC"}. Vista inspirada en estados financieros historicos; no son datos normalizados propietarios. En empresas no USA la cobertura puede variar por mercado, proveedor y moneda.`} /></h2>
      <span className="fine">{currency || "Moneda no disponible"}</span>
    </div>
    <div className="metricGrid fundamentalSnapshot">
      <Metric label="Ventas ultimo trimestre" value={money(latestQuarter.revenue, currency)} />
      <Metric label="Ventas YoY trimestre" value={pct(latestQuarter.revenueGrowthYoY)} />
      <Metric label="Beneficio neto trimestre" value={money(latestQuarter.netIncome, currency)} />
      <Metric label="Ventas ultimo FY" value={money(latestAnnual.revenue, currency)} />
      <Metric label="FCF ultimo FY" value={money(cashflowAnnual.freeCashFlow, currency)} />
      <Metric label="Caja / deuda" value={`${money(balance.cash ?? latest.cash, currency)} / ${money(balance.totalDebt ?? latest.totalDebt, currency)}`} />
    </div>
    <div className="fundamentalToolbar" aria-label="Selector de fundamentales">
      <div>
        <button type="button" className={period === "quarter" ? "active" : ""} onClick={() => setPeriod("quarter")}>Trimestres</button>
        <button type="button" className={period === "annual" ? "active" : ""} onClick={() => setPeriod("annual")}>Años</button>
      </div>
      <div>
        <button type="button" className={statement === "summary" ? "active" : ""} onClick={() => setStatement("summary")}>Resumen</button>
        <button type="button" className={statement === "income" ? "active" : ""} onClick={() => setStatement("income")}>Resultados</button>
        <button type="button" className={statement === "balance" ? "active" : ""} onClick={() => setStatement("balance")}>Balance</button>
        <button type="button" className={statement === "cashflow" ? "active" : ""} onClick={() => setStatement("cashflow")}>Cash flow</button>
      </div>
    </div>
    {visiblePeriods.length && visibleRows.length ? <div className="tableWrap statementMatrix">
      <table className="table">
        <thead><tr><th>Magnitud</th>{visiblePeriods.map((row) => <th key={`${period}-${row.date}`}>{row.date || "Sin dato"}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={`${statement}-${row.label}`}>
          <td>{row.label}</td>
          {visiblePeriods.map((periodRow) => {
            const value = row.get(periodRow);
            return <td key={`${row.label}-${periodRow.date}`} className={valueTone(value, row.tone)}>{formatValue(value, row.type)}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div> : <div className="dataNote" style={{ marginTop: 12 }}>Historico insuficiente del proveedor para esta vista. Se mantienen las metricas disponibles y el resto queda como Sin dato.</div>}
  </section>;
}

function NewsSection({ rows = [] }) {
  const cardContent = (item) => <>
    {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
    <span>
      <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`}>{item.sentimentLabel || "neutral"}</i>
      <b>{item.title}</b>
      <em>{item.publisher || "Proveedor"} · {dateFmt(item.publishedAt)}</em>
      <small>{item.relevanceReasons?.length ? `Relevancia: ${item.relevanceReasons.join(", ")}` : "Relevancia aproximada por ticker/nombre"}</small>
      <span className={`newsLinkCue ${item.link ? "" : "disabled"}`}>{item.link ? "Abrir noticia ->" : "Sin enlace del proveedor"}</span>
    </span>
  </>;
  return <section className="card">
    <div className="sectionTitle">
      <h2>Noticias relevantes <InfoHint text="Noticias recuperadas desde proveedores disponibles. La relevancia y el sesgo son heuristicas, no una clasificacion editorial." /></h2>
      <span className="fine">sesgo heuristico</span>
    </div>
    <div className="newsGrid">
      {rows?.length ? rows.map((item, index) => {
        const className = `newsItem ${item.thumbnail ? "" : "newsItemNoThumb"} ${index === 0 ? "newsItemLead" : ""} ${item.link ? "" : "newsItemDisabled"}`;
        return item.link
          ? <a className={className} key={`${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer" aria-label={`Abrir noticia: ${item.title}`}>{cardContent(item)}</a>
          : <article className={className} key={`${item.title}-${item.publishedAt}`}>{cardContent(item)}</article>;
      }) : <div className="dataNote">Sin noticias recientes del proveedor para este ticker.</div>}
    </div>
  </section>;
}

function SocialPulseSection({ social = null, loading = false, symbol = "" }) {
  const bullish = Math.max(0, Math.min(100, social?.bullishPct || 0));
  const neutral = Math.max(0, Math.min(100, social?.neutralPct || 0));
  const bearish = Math.max(0, Math.min(100, social?.bearishPct || 0));
  const hasRows = !!social?.rows?.length;
  return <section className="card">
    <div className="sectionTitle">
      <h2>Pulso X / cashtag <InfoHint text="Busca posts recientes con cashtag tipo $TICKER mediante la API oficial de X si hay token configurado. No hace scraping ni usa X como fuente de precio." /></h2>
      <span className="fine">{loading ? "cargando" : social?.provider || "X API v2 recent search"}</span>
    </div>
    {social?.error && <div className="dataNote" style={{ marginBottom: 12 }}>{social.error}</div>}
    <div className="sentimentBars" aria-label={`Distribucion social de ${symbol}`}>
      <span className="bearish" style={{ width: `${bearish}%` }} />
      <span className="neutral" style={{ width: `${neutral}%` }} />
      <span className="bullish" style={{ width: `${bullish}%` }} />
    </div>
    <div className="metricGrid">
      <Metric label="Posts" value={fmt(social?.total)} />
      <Metric label="Alcistas" value={`${fmt(social?.bullish)} · ${pct(social?.bullishPct)}`} />
      <Metric label="Bajistas" value={`${fmt(social?.bearish)} · ${pct(social?.bearishPct)}`} />
      <Metric label="Pesimismo social" value={fmt(social?.pessimismIndex)} />
      <Metric label="Engagement" value={fmt(social?.totalEngagement)} />
      <Metric label="Score ponderado" value={Number.isFinite(social?.weightedAvgScore) ? social.weightedAvgScore.toFixed(1) : "Sin dato"} />
    </div>
    <div className="summaryRow"><span>Query</span><span className="summaryValue"><b>{social?.query || `"$${String(symbol).split(".")[0]}"`}</b></span></div>
    {hasRows ? <div className="newsGrid" style={{ marginTop: 14 }}>
      {social.rows.slice(0, 8).map((item) => <a className="newsItem newsTextOnly" key={item.id || `${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer">
        <span>
          <i className={`sentimentPill ${sentimentClass(item.sentimentLabel)}`}>{item.sentimentLabel || "neutral"}</i>
          <b>{item.title}</b>
          <em>{item.publisher || "X"} · {dateFmt(item.publishedAt)}</em>
          <small>{item.sentimentReasons?.length ? `${item.sentimentReasons.join(", ")} · engagement ${item.engagement || 0}` : `sin sesgo fuerte detectado · engagement ${item.engagement || 0}`}</small>
        </span>
      </a>)}
    </div> : <div className="dataNote" style={{ marginTop: 12 }}>{loading ? "Leyendo posts recientes..." : "Sin posts recientes disponibles para esta muestra."}</div>}
  </section>;
}

function SimilarStocks({ rows = [] }) {
  if (!rows.length) return null;
  return <section className="card">
    <div className="sectionTitle"><h2>Acciones similares</h2></div>
    <div className="similarGrid">
      {rows.map((item) => <a className="similarCard" key={item.symbol} href={`/stock/${encodeURIComponent(item.symbol)}`} aria-label={`Abrir ficha de ${item.symbol}`}>
        <div className="similarTop">
          <PeerLogo item={item} />
          <div>
            <strong className="ticker">{item.symbol}</strong>
            <p>{item.name || item.symbol}</p>
          </div>
          <span className="similarArrow">Abrir</span>
        </div>
        <div className="similarMeta">
          <span>{item.theme || item.sector || "Sin clasificar"}</span>
          <span>{item.industry || item.country || "-"}</span>
        </div>
      </a>)}
    </div>
  </section>;
}

export default function StockClient({ initialSymbol = "", initialData = null, initialError = "" }) {
  const symbol = String(initialSymbol || "").toUpperCase();
  const [data, setData] = useState(initialData || null);
  const [error, setError] = useState(initialError || "");
  const [loading, setLoading] = useState(false);
  const [logoIndex, setLogoIndex] = useState(0);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [similar, setSimilar] = useState([]);
  const [social, setSocial] = useState(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [chartSettings, setChartSettings] = useState(DEFAULT_CHART_SETTINGS);

  function updateChartSettings(nextSettings) {
    setChartSettings(writeChartSettings(nextSettings));
  }

  function loadSimilarFor(payload) {
    if (!symbol || !payload) return;
    const qs = new URLSearchParams({
      symbol,
      name: payload.name || symbol,
      sector: payload.sector || "",
      industry: payload.industry || "",
      theme: payload.theme || "",
      country: payload.country || "",
    });
    fetch(`/api/similar?${qs.toString()}`)
      .then((res) => res.json())
      .then((result) => setSimilar(result.results || []))
      .catch(() => setSimilar([]));
  }

  function loadSocialFor(payload) {
    if (!symbol) return;
    setSocialLoading(true);
    const qs = new URLSearchParams({
      symbol,
      name: payload?.name || symbol,
    });
    fetch(`/api/social-sentiment?${qs.toString()}`)
      .then((res) => res.json())
      .then((result) => setSocial(result))
      .catch((error) => setSocial({ error: error.message || "Pulso X no disponible", rows: [] }))
      .finally(() => setSocialLoading(false));
  }

  async function load() {
    if (!symbol) return;
    setLoading(true); setError("");
    setSimilar([]);
    try {
      const r = await fetch(`/api/company-brief?symbol=${encodeURIComponent(symbol)}`);
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d);
      loadSimilarFor(d);
      loadSocialFor(d);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setChartSettings(readChartSettings());
    setLogoIndex(0);
    setLogoLoaded(false);
    if (initialData) {
      loadSimilarFor(initialData);
      loadSocialFor(initialData);
      return;
    }
    if (!initialError) load();
  }, [symbol]);
  const logoCandidates = [data?.visual?.logoUrl, data?.visual?.clearbitLogoUrl].filter(Boolean);
  const logo = logoCandidates[logoIndex] || "";
  const g = data?.growthMetrics || {};
  const v = data?.valuationMetrics || {};
  const q = data?.quoteSnapshot || {};
  const rs = data?.relativeStrength || {};
  const statementCurrency = data?.financialResults?.currency || g.financialCurrency || data?.currency || "";
  const stageTone = /etapa 2/i.test(data?.stage?.label || "") ? "good" : /etapa 4/i.test(data?.stage?.label || "") ? "bad" : "neutral";
  const dayTone = (q.dayChangePct || 0) >= 0 ? "up" : "down";
  const nextEarnings = data?.earningsCalendar?.earningsDate || data?.earningsCalendar?.earningsStart || "Sin dato";
  const providerIssues = [
    data?.dataQuality?.profileProviderError ? `Perfil: ${data.dataQuality.profileProviderError}` : "",
    data?.dataQuality?.extrasProviderError ? `Extras: ${data.dataQuality.extrasProviderError}` : "",
    data?.dataQuality?.secProviderError ? `SEC: ${data.dataQuality.secProviderError}` : "",
  ].filter(Boolean).join(" · ");
  const compactProfile = data ? [data.sector, data.industry, data.country].filter(Boolean).join(" · ") : "";
  const useChartFallback = data?.chartEmbed?.supported === false;

  return <main className="page stockPage">
    <section className="stockCommand" style={stockAccentStyle(data, symbol)}>
      <div className="stockCommandMain">
        <div className="stockHead">
          <div className="stockLogo stockLogoPro">
            <span className={logo ? "logoInitialHidden" : ""}>{data?.visual?.initials || symbol.slice(0, 2)}</span>
            {logo && <img className={logoLoaded ? "isLoaded" : ""} src={logo} alt={`${data?.name || symbol} logo`} onLoad={() => setLogoLoaded(true)} onError={() => { setLogoLoaded(false); setLogoIndex((index) => index + 1); }} />}
          </div>
          <div>
            <div className="stockKicker">
              <span>{symbol}</span>
              {data?.exchange && <span>{data.exchange}</span>}
              {data?.sector && <span>{data.sector}</span>}
            </div>
            <div className="stockTitleBlock">
              <h1>{symbol}</h1>
              <p className="stockCompanyName">{data?.name || symbol}</p>
            </div>
            <div className="stockQuoteLine">
              <span className="stockQuoteLabel">Ultima cotizacion</span>
              <strong>{Number.isFinite(q.price) ? priceMoney(q.price) : "Sin cotizacion"}</strong>
              {data?.currency && <span className="stockQuoteCurrency">{data.currency}</span>}
              {Number.isFinite(q.dayChangePct) && <b className={dayTone}>{signedPriceMoney(q.dayChange)} ({pct(q.dayChangePct)})</b>}
            </div>
          </div>
        </div>
      </div>
      <div className="signalStrip">
        <SignalStat label="Etapa" value={data?.stage?.label || "Cargando"} detail={data?.theme || "Clasificacion pendiente"} tone={stageTone} />
        <SignalStat label="RS StatsEdge" value={fmt(rs.rating)} detail={`vs ${rs.benchmarkSymbol || "benchmark"}`} tone={(rs.rating || 0) >= 75 ? "good" : (rs.rating || 0) < 45 ? "bad" : "neutral"} />
        <SignalStat label="Dist. 52w high" value={pct(rs.distance52w)} detail="Proximidad a maximos" tone={Number.isFinite(rs.distance52w) && rs.distance52w >= -10 ? "good" : "neutral"} />
        <SignalStat label="Capitalizacion" value={data?.marketCap ? money(data.marketCap, data.marketCapCurrency) : "Sin dato"} detail={data?.marketCapCurrency && data.marketCapCurrency !== "USD" ? (data.marketCapUsdLabel || "USD no disponible") : data?.marketCapCurrency || ""} />
        <SignalStat label="Resultados" value={nextEarnings} detail={data?.earningsCalendar?.source ? "Calendario proveedor" : "Sin calendario"} />
      </div>
    </section>

    {error && <section className="card error">{error}</section>}

    {data && <>
      <section className="stockWorkspace">
        <div className="terminalPanel chartPanel">
          <div className="sectionTitle">
            <h2>{useChartFallback ? "Grafico precio" : "Grafico TradingView"}</h2>
          </div>
          <ChartPreferences settings={chartSettings} onChange={updateChartSettings} symbol={symbol} compact />
          {useChartFallback
            ? <PriceFallbackChart bars={data.chartBars} symbol={symbol} currency={data.currency} reason={data.chartEmbed?.reason} tradingViewUrl={data.links?.tradingView} settings={chartSettings} />
            : <TradingViewChart symbol={data.tradingViewSymbol} settings={chartSettings} />}
        </div>
        <aside className="stockIntelRail">
          <section className="terminalPanel">
            <div className="sectionTitle">
              <h2>Negocio</h2>
            </div>
            <p className="leadText">{data.summary}</p>
            <div className="summaryRow"><span>Tematica</span><span>{data.theme}</span></div>
            <div className="summaryRow"><span>Sector</span><span>{data.sector}</span></div>
            <div className="summaryRow"><span>Industria</span><span>{data.industry}</span></div>
          </section>
          <section className="terminalPanel">
            <div className="sectionTitle">
              <h2>Evidencia tecnica</h2>
            </div>
            <div className="summaryRow"><span>Etapa aproximada</span><span>{data.stage?.label || "Sin dato"}</span></div>
            <div className="summaryRow">
              <span>Capitalizacion</span>
              <span className="summaryValue">
                <b>{data.marketCapLabel || "Sin dato"}</b>
                {data.marketCapCurrency && data.marketCapCurrency !== "USD" && <small>{data.marketCapUsdLabel ? `${data.marketCapUsdLabel} aprox.` : "USD: proveedor no disponible"}</small>}
              </span>
            </div>
            <div className="summaryRow"><span>Empleados</span><span>{fmt(data.employees)}</span></div>
            <div className="summaryRow"><span>IPO / primera cotizacion</span><span>{data.ipoDate || "Sin dato"}</span></div>
          </section>
          <section className="terminalPanel">
            <div className="sectionTitle"><h2>Enlaces rapidos</h2></div>
            <div className="linkGrid">
              {data.links?.official && <a className="btn btnPrimary btnSmall" href={data.links.official} target="_blank" rel="noreferrer">Web oficial</a>}
              <a className="btn btnSmall" href={data.links?.tradingView} target="_blank" rel="noreferrer">TradingView</a>
              <a className="btn btnSmall" href={data.links?.yahooFinance} target="_blank" rel="noreferrer">Yahoo Finance</a>
              <a className="btn btnSmall" href={data.links?.googleFinance} target="_blank" rel="noreferrer">Google</a>
            </div>
          </section>
        </aside>
      </section>

      <SimilarStocks rows={similar} />

      <div className="grid grid2">
        <section className="card">
          <div className="sectionTitle">
            <h2>Fuerza relativa</h2>
          </div>
          <div className="metricGrid rsMetricGrid">
            <Metric label="RS Rating StatsEdge" value={fmt(rs.rating)} tone={(rs.rating || 0) >= 75 ? "good" : (rs.rating || 0) < 45 ? "bad" : "neutral"} />
            <Metric label="RS Quality" value={fmt(rs.rsQualityScore)} tone={(rs.rsQualityScore || 0) >= 70 ? "good" : (rs.rsQualityScore || 0) < 45 ? "bad" : "neutral"} />
            <Metric label="Spec Risk" value={fmt(rs.speculationRiskScore)} tone={(rs.speculationRiskScore || 0) >= 60 ? "warn" : "neutral"} />
            <Metric label="Volatilidad 63d" value={pct(rs.volatility63d)} tone={(rs.volatility63d || 0) >= 70 ? "warn" : "neutral"} />
            <Metric label="Drawdown 63d" value={pct(rs.maxDrawdown63d)} tone={(rs.maxDrawdown63d || 0) >= 25 ? "warn" : "neutral"} />
            <Metric label="RS 3M vs bench" value={pct(rs.rs3m)} tone={(rs.rs3m || 0) >= 0 ? "good" : "bad"} />
            <Metric label="RS 6M vs bench" value={pct(rs.rs6m)} tone={(rs.rs6m || 0) >= 0 ? "good" : "bad"} />
            <Metric label="RS 12M vs bench" value={pct(rs.rs12m)} tone={(rs.rs12m || 0) >= 0 ? "good" : "bad"} />
            <Metric label="Perf 3M" value={pct(rs.perf3m)} tone={(rs.perf3m || 0) >= 0 ? "good" : "bad"} />
            <Metric label="Dist. 52w high" value={pct(rs.distance52w)} tone={Number.isFinite(rs.distance52w) && rs.distance52w >= -15 ? "good" : "neutral"} />
          </div>
          <RsLineChart series={rs.series} benchmarkSymbol={rs.benchmarkSymbol} />
        </section>

        <section className="card">
          <div className="sectionTitle">
            <h2>Growth metrics</h2>
          </div>
          <div className="metricGrid">
            <Metric label="Rev Growth" value={pct(g.revenueGrowth)} />
            <Metric label="Earn Growth" value={pct(g.earningsGrowth)} />
            <Metric label="Gross Margin" value={pct(g.grossMargin)} />
            <Metric label="Oper Margin" value={pct(g.operatingMargin)} />
            <Metric label="Profit Margin" value={pct(g.profitMargin)} />
            <Metric label="EBITDA Margin" value={pct(g.ebitdaMargin)} />
            <Metric label="ROE" value={pct(g.roe)} />
            <Metric label="ROA" value={pct(g.roa)} />
            <Metric label="Debt/Equity" value={ratio(g.debtToEquity)} />
            <Metric label="Current Ratio" value={ratio(g.currentRatio)} />
            <Metric label="Inst. Own" value={pct(g.institutionalOwnership)} />
            <Metric label="Insider Own" value={pct(g.insiderOwnership)} />
            <Metric label="Short Float" value={pct(g.shortPercentOfFloat)} />
            <Metric label="Short Ratio" value={ratio(g.shortRatio)} />
          </div>
        </section>

        <section className="card">
          <div className="sectionTitle">
            <h2>Mercado y valoración <InfoHint text={v.source || q.source || "Datos de cotizacion y valoracion segun proveedor disponible. No son ratings propietarios."} /></h2>
          </div>
          <div className="metricGrid">
            <Metric label="Precio proveedor" value={priceMoney(q.price, data.currency)} />
            <Metric label="Cambio dia" value={pct(q.dayChangePct)} />
            <Metric label="P/E trailing" value={ratio(v.trailingPe)} />
            <Metric label="P/E forward" value={ratio(v.forwardPe)} />
            <Metric label="P/S" value={ratio(v.priceToSales)} />
            <Metric label="P/B" value={ratio(v.priceToBook)} />
            <Metric label="EV/EBITDA" value={ratio(v.enterpriseToEbitda)} />
            <Metric label="Beta" value={ratio(v.beta)} />
            <Metric label="Div. yield" value={pct(v.dividendYield)} />
            <Metric label="EPS TTM" value={money(v.epsTrailingTwelveMonths, data.currency)} />
            <Metric label="Vol. medio 3M" value={fmt(v.averageVolume3m || q.averageVolume3m)} />
            <Metric label="Acciones emitidas" value={fmt(v.sharesOutstanding || g.sharesOutstanding)} />
          </div>
        </section>
      </div>

      <EarningsSection calendar={data.earningsCalendar} currency={statementCurrency} />

      <ResultsSection results={data.financialResults} currency={statementCurrency} />

      <NewsSection rows={data.news} />

      <SocialPulseSection social={social} loading={socialLoading} symbol={symbol} />

      <section className="grid grid2">
        <HolderTable title="Top Funds" rows={g.topFunds} />
        <HolderTable title="Top Institutions" rows={g.topInstitutions} />
      </section>

    </>}

    {!data && !error && <section className="card">Cargando ficha de {symbol}...</section>}
  </main>;
}
