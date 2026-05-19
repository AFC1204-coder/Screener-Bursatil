"use client";
import { useEffect, useState } from "react";
import ChartPreferences from "@/app/ChartPreferences";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { metricShortLabel } from "@/lib/metricCatalog";

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
const rsFmt = (n) => Number.isFinite(n) ? String(Math.round(Math.max(0, Math.min(99, n)))) : "Sin dato";
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

function ResultsSection({ results = {}, currency = "", embedded = false, snapshot = null }) {
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
  const isSnapshot = statement === "snapshot" && snapshot;
  const tableRows = isSnapshot ? [] : rowsByStatement[statement] || rowsByStatement.summary;
  const candidateRows = tableRows.filter((row) => periods.some((periodRow) => Number.isFinite(row.get(periodRow))));
  const minValuesByStatement = statement === "summary" ? 4 : statement === "income" ? 3 : 1;
  const visiblePeriods = periods.filter((periodRow) => candidateRows.reduce((count, row) => count + (Number.isFinite(row.get(periodRow)) ? 1 : 0), 0) >= minValuesByStatement);
  const visibleRows = candidateRows.filter((row) => visiblePeriods.some((periodRow) => Number.isFinite(row.get(periodRow))));

  return <section className={embedded ? "fundamentalHistory" : "card fundamentalCard"}>
    <div className="sectionTitle">
      <h2>{embedded ? "Historico" : "Fundamentales historicos"} {!embedded && <InfoHint text={`Fuente: ${results.source || "Yahoo / SEC"}. Vista inspirada en estados financieros historicos; no son datos normalizados propietarios. En empresas no USA la cobertura puede variar por mercado, proveedor y moneda.`} />}</h2>
      <span className="fine">{currency || "Moneda no disponible"}</span>
    </div>
    <div className="fundamentalToolbar" aria-label="Selector de fundamentales">
      <div>
        <button type="button" className={period === "quarter" ? "active" : ""} onClick={() => setPeriod("quarter")}>Trimestres</button>
        <button type="button" className={period === "annual" ? "active" : ""} onClick={() => setPeriod("annual")}>Años</button>
      </div>
      <div>
        {snapshot && <button type="button" className={statement === "snapshot" ? "active" : ""} onClick={() => setStatement("snapshot")}>Métricas</button>}
        <button type="button" className={statement === "summary" ? "active" : ""} onClick={() => setStatement("summary")}>Resumen</button>
        <button type="button" className={statement === "income" ? "active" : ""} onClick={() => setStatement("income")}>Resultados</button>
        <button type="button" className={statement === "balance" ? "active" : ""} onClick={() => setStatement("balance")}>Balance</button>
        <button type="button" className={statement === "cashflow" ? "active" : ""} onClick={() => setStatement("cashflow")}>Cash flow</button>
      </div>
    </div>
    {isSnapshot ? <div className="fundamentalSnapshotPane">{snapshot}</div> : visiblePeriods.length && visibleRows.length ? <div className="tableWrap statementMatrix">
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

function MiniMetric({ label, value, tone = "" }) {
  return <div className={`miniMetric ${tone}`.trim()}>
    <span>{label}</span>
    <b>{value}</b>
  </div>;
}

function FundamentalGroup({ title, children }) {
  return <div className="fundamentalGroup">
    <h3>{title}</h3>
    <div className="fundamentalGroupGrid">{children}</div>
  </div>;
}

function FundamentalSnapshot({ data = {}, growth = {}, valuation = {}, quote = {}, calendar = {}, currency = "" }) {
  const results = data.financialResults || {};
  const latest = results.latest || {};
  const balance = results.balanceQuarterly?.[0] || results.balanceAnnual?.[0] || {};
  const cashflow = results.cashflowQuarterly?.[0] || results.cashflowAnnual?.[0] || {};
  const displayCurrency = currency || data.currency || "Moneda no disponible";
  const rows = [
    ["Valoracion", "Capitalizacion", money(data.marketCap, data.marketCapCurrency || data.currency)],
    ["Valoracion", "P/E fwd", ratio(finiteValue(valuation.forwardPe, valuation.forwardPE))],
    ["Valoracion", "P/S", ratio(valuation.priceToSales)],
    ["Valoracion", "EV/EBITDA", ratio(valuation.enterpriseToEbitda)],
    ["Valoracion", "Div. yield", pct(valuation.dividendYield)],
    ["Rentabilidad", "Margen bruto", pct(growth.grossMargin)],
    ["Rentabilidad", "Margen operativo", pct(growth.operatingMargin)],
    ["Rentabilidad", "Margen neto", pct(growth.profitMargin)],
    ["Rentabilidad", "ROE", pct(growth.roe)],
    ["Balance", "Deuda/Equity", ratio(growth.debtToEquity)],
    ["Balance", "Current ratio", ratio(growth.currentRatio)],
    ["Balance", "Caja", money(balance.cash ?? latest.cash, displayCurrency)],
    ["Balance", "Deuda total", money(balance.totalDebt ?? latest.totalDebt, displayCurrency)],
    ["Balance", "Free cash flow", money(cashflow.freeCashFlow ?? latest.freeCashFlow, displayCurrency)],
    ["Estructura", "Acciones", fmt(valuation.sharesOutstanding || growth.sharesOutstanding)],
    ["Estructura", metricShortLabel("shortPercentOfFloat"), pct(growth.shortPercentOfFloat)],
  ];
  return <div className="tableWrap statementMatrix metricsStatementMatrix">
    <table className="table">
      <thead><tr><th>Métrica</th><th>Valor</th></tr></thead>
      <tbody>{rows.map(([group, label, value]) => <tr key={`${group}-${label}`}>
        <td>{label}</td>
        <td>{value}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function CompactHolderList({ title, rows = [] }) {
  const visibleRows = (rows || []).filter(Boolean).slice(0, 5);
  return <div className="compactHolderList">
    <h3>{title}</h3>
    <div>
      {visibleRows.length ? visibleRows.map((row) => <div className="compactHolderRow" key={`${title}-${row.name}`}>
        <span>{row.name || "Sin nombre"}</span>
        <b>{Number.isFinite(row.pctHeld) ? pct(row.pctHeld) : row.reportDate || ""}</b>
      </div>) : <div className="compactHolderEmpty">Sin dato</div>}
    </div>
  </div>;
}

function FundamentalsPanel({ data = {}, growth = {}, valuation = {}, quote = {}, calendar = {}, currency = "" }) {
  const results = data.financialResults || {};
  const displayCurrency = currency || data.currency || "Moneda no disponible";
  return <section className="card fundamentalsPanel">
    <ResultsSection results={results} currency={displayCurrency} embedded snapshot={<FundamentalSnapshot data={data} growth={growth} valuation={valuation} quote={quote} calendar={calendar} currency={displayCurrency} />} />

    <div className="fundamentalHoldersCompact">
      <CompactHolderList title="Top funds" rows={growth.topFunds} />
      <CompactHolderList title="Top institutions" rows={growth.topInstitutions} />
    </div>
  </section>;
}

function compactPeriodLabel(date = "", period = "annual") {
  const value = String(date || "");
  const year = value.slice(0, 4);
  if (!year) return "Sin dato";
  if (period === "annual") return year;
  const month = Number(value.slice(5, 7));
  const quarter = Number.isFinite(month) && month > 0 ? Math.ceil(month / 3) : "";
  return quarter ? `${year} T${quarter}` : year;
}

function finiteValue(...values) {
  return values.find(Number.isFinite);
}

function sortLatestFirst(rows = []) {
  return [...rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function calcGrowth(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current / previous) - 1) * 100;
}

function rowGrowth(row, sourceRows, index, valueKey, growthKey, compareOffset) {
  const providerGrowth = finiteValue(row?.[growthKey]);
  if (Number.isFinite(providerGrowth)) return providerGrowth;
  return calcGrowth(row?.[valueKey], sourceRows[index + compareOffset]?.[valueKey]);
}

function epsValue(row, sharesOutstanding) {
  if (Number.isFinite(row?.eps)) return { value: row.eps, derived: false };
  const rowShares = finiteValue(row?.weightedAverageShsOutDil, row?.weightedAverageShsOut, row?.sharesOutstanding, sharesOutstanding);
  if (Number.isFinite(row?.netIncome) && Number.isFinite(rowShares) && rowShares > 0) {
    return { value: row.netIncome / rowShares, derived: true };
  }
  return { value: null, derived: false };
}

function epsGrowth(row, sourceRows, index, compareOffset, sharesOutstanding) {
  const providerGrowth = finiteValue(row?.epsGrowthYoY);
  if (Number.isFinite(providerGrowth)) return providerGrowth;
  const current = epsValue(row, sharesOutstanding).value;
  const previous = epsValue(sourceRows[index + compareOffset], sharesOutstanding).value;
  return calcGrowth(current, previous);
}

function valueTone(value) {
  if (!Number.isFinite(value)) return "";
  return value > 0 ? "good" : value < 0 ? "bad" : "neutral";
}

function average(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function technicalSnapshotFromBars(bars = [], quote = {}) {
  const rows = [...(bars || [])]
    .map((bar) => ({
      date: bar.date,
      close: Number(bar.close),
      high: Number(bar.high),
      volume: Number(bar.volume),
    }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const latest = rows.at(-1) || {};
  const price = finiteValue(quote.price, latest.close);
  const last50 = rows.slice(-50);
  const last200 = rows.slice(-200);
  const last252 = rows.slice(-252);
  const sma50 = average(last50.map((row) => row.close));
  const sma200 = average(last200.map((row) => row.close));
  const avgVolume50 = average(last50.map((row) => row.volume));
  const high52w = Math.max(...last252.map((row) => row.high).filter(Number.isFinite), 0);
  return {
    price,
    sma50,
    sma200,
    distanceSma50: Number.isFinite(price) && Number.isFinite(sma50) && sma50 > 0 ? ((price / sma50) - 1) * 100 : null,
    distanceSma200: Number.isFinite(price) && Number.isFinite(sma200) && sma200 > 0 ? ((price / sma200) - 1) * 100 : null,
    relativeVolume50: Number.isFinite(latest.volume) && Number.isFinite(avgVolume50) && avgVolume50 > 0 ? latest.volume / avgVolume50 : null,
    distance52w: Number.isFinite(price) && high52w > 0 ? ((price / high52w) - 1) * 100 : null,
  };
}

const BENCHMARK_OPTIONS = ["SPY", "QQQ", "ACWI", "IWM", "^GSPC", "^IXIC", "^N225", "^HSI", "^STOXX50E", "^AXJO"];

function cleanBenchmarkSymbol(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 24);
}

function FundamentalMiniTable({ results = {}, currency = "", metrics = {}, sharesOutstanding = null }) {
  const annualSource = sortLatestFirst(results?.incomeAnnual || [])
    .filter((row) => row?.date && [row.revenue, row.netIncome, row.eps, row.revenueGrowthYoY, row.netIncomeGrowthYoY].some(Number.isFinite));
  const quarterSource = sortLatestFirst(results?.incomeQuarterly || [])
    .filter((row) => row?.date && [row.revenue, row.netIncome, row.eps, row.revenueGrowthYoY, row.netIncomeGrowthYoY].some(Number.isFinite));
  const useAnnual = annualSource.length >= 2;
  const sourceRows = useAnnual ? annualSource : quarterSource;
  const rows = sourceRows.slice(0, 5);
  const period = useAnnual ? "annual" : "quarter";
  const compareOffset = useAnnual ? 1 : 4;

  if (!rows.length) {
    return <div className="researchMetricGrid">
      <div className="researchMetric"><span>Ventas</span><b>{pct(metrics.revenueGrowth)}</b></div>
      <div className="researchMetric"><span>EPS YoY</span><b>{pct(metrics.earningsGrowth)}</b></div>
      <div className="researchMetric"><span>Margen op.</span><b>{pct(metrics.operatingMargin)}</b></div>
      <div className="researchMetric"><span>ROE</span><b>{pct(metrics.roe)}</b></div>
    </div>;
  }

  return <div className="fundamentalMiniTable" aria-label="Historico fundamental compacto">
    <div className="fundamentalMiniRow head">
      <span>{useAnnual ? "Año" : "Per."}</span>
      <span>Ventas</span>
      <span>YoY</span>
      <span>EPS</span>
      <span>EPS YoY</span>
    </div>
    {rows.map((row, index) => {
      const revenueGrowth = rowGrowth(row, sourceRows, index, "revenue", "revenueGrowthYoY", compareOffset);
      const eps = epsValue(row, sharesOutstanding);
      const epsYoY = epsGrowth(row, sourceRows, index, compareOffset, sharesOutstanding);
      return <div className="fundamentalMiniRow" key={`${period}-${row.date}`}>
        <span>{compactPeriodLabel(row.date, period)}</span>
        <b>{money(row.revenue, currency)}</b>
        <b className={valueTone(revenueGrowth)}>{pct(revenueGrowth)}</b>
        <b title={eps.derived ? "EPS aproximado: beneficio neto / acciones emitidas actuales" : undefined}>
          {ratio(eps.value)}{eps.derived && <small>calc.</small>}
        </b>
        <b className={valueTone(epsYoY)}>{pct(epsYoY)}</b>
      </div>;
    })}
  </div>;
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
  if (!loading && social && social.configured === false && !social.rows?.length) return null;
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
  const [chartScope, setChartScope] = useState("global");
  const [benchmarkDraft, setBenchmarkDraft] = useState("");

  function updateChartSettings(nextSettings) {
    setChartSettings(writeChartSettings(nextSettings, { scope: chartScope, symbol }));
  }

  function updateChartScope(nextScope) {
    setChartScope(nextScope);
    setChartSettings(readChartSettings({ scope: nextScope, symbol }));
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

  async function load({ benchmarkSymbol = "" } = {}) {
    if (!symbol) return;
    setLoading(true); setError("");
    setSimilar([]);
    try {
      const qs = new URLSearchParams({ symbol });
      const benchmark = cleanBenchmarkSymbol(benchmarkSymbol);
      if (benchmark) qs.set("benchmark", benchmark);
      const r = await fetch(`/api/company-brief?${qs.toString()}`);
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
    const nextSettings = readChartSettings({ scope: chartScope, symbol });
    setChartSettings(nextSettings);
    setLogoIndex(0);
    setLogoLoaded(false);
    const savedBenchmark = cleanBenchmarkSymbol(nextSettings.benchmarks?.[symbol]);
    if (initialData) {
      loadSimilarFor(initialData);
      loadSocialFor(initialData);
      if (savedBenchmark && savedBenchmark !== cleanBenchmarkSymbol(initialData.relativeStrength?.benchmarkSymbol)) {
        load({ benchmarkSymbol: savedBenchmark });
      }
      return;
    }
    if (!initialError) load({ benchmarkSymbol: savedBenchmark });
  }, [symbol]);
  const logoCandidates = [data?.visual?.logoUrl, data?.visual?.clearbitLogoUrl].filter(Boolean);
  const logo = logoCandidates[logoIndex] || "";
  const g = data?.growthMetrics || {};
  const v = data?.valuationMetrics || {};
  const q = data?.quoteSnapshot || {};
  const rs = data?.relativeStrength || {};
  const benchmarkOverride = cleanBenchmarkSymbol(chartSettings?.benchmarks?.[symbol]);
  const activeBenchmark = benchmarkOverride || cleanBenchmarkSymbol(rs.benchmarkSymbol);
  const rsUniverse = finiteValue(rs.rsGlobalPct);
  const rsBenchmark = finiteValue(rs.benchmarkRating, rs.rsRating, rs.ratingSource === "benchmark-fallback" ? rs.rating : undefined);
  const rsSourceLabel = Number.isFinite(rsUniverse) ? "RS Universo StatsEdge" : "RS Universo sin snapshot";
  const technical = technicalSnapshotFromBars(data?.chartBars || [], q);
  const statementCurrency = data?.financialResults?.currency || g.financialCurrency || data?.currency || "";
  const stageTone = /etapa 2/i.test(data?.stage?.label || "") ? "good" : /etapa 4/i.test(data?.stage?.label || "") ? "bad" : "neutral";
  const dayTone = (q.dayChangePct || 0) >= 0 ? "up" : "down";
  const nextEarnings = data?.earningsCalendar?.earningsDate || data?.earningsCalendar?.earningsStart || "Sin dato";
  const listingDate = data?.ipoDate || data?.listingDate || "";
  const listingLabel = data?.ipoDate ? "IPO" : data?.listingDate ? "Cotiza desde" : "IPO";
  const providerIssues = [
    data?.dataQuality?.profileProviderError ? `Perfil: ${data.dataQuality.profileProviderError}` : "",
    data?.dataQuality?.extrasProviderError ? `Extras: ${data.dataQuality.extrasProviderError}` : "",
    data?.dataQuality?.secProviderError ? `SEC: ${data.dataQuality.secProviderError}` : "",
  ].filter(Boolean).join(" · ");
  const compactProfile = data ? [data.sector, data.industry, data.country].filter(Boolean).join(" · ") : "";
  useEffect(() => {
    setBenchmarkDraft(activeBenchmark);
  }, [activeBenchmark]);

  function updateBenchmark(value) {
    const nextBenchmark = cleanBenchmarkSymbol(value);
    const benchmarks = { ...(chartSettings.benchmarks || {}) };
    if (nextBenchmark) benchmarks[symbol] = nextBenchmark;
    else delete benchmarks[symbol];
    const nextSettings = writeChartSettings({ ...chartSettings, benchmarks }, { scope: chartScope, symbol });
    setChartSettings(nextSettings);
    load({ benchmarkSymbol: nextBenchmark });
  }

  const annualRowsForHero = sortLatestFirst(data?.financialResults?.incomeAnnual || []);
  const quarterRowsForHero = sortLatestFirst(data?.financialResults?.incomeQuarterly || []);
  const heroEpsRows = annualRowsForHero.length >= 2 ? annualRowsForHero : quarterRowsForHero;
  const heroEpsCompareOffset = annualRowsForHero.length >= 2 ? 1 : 4;
  const heroEpsYoY = heroEpsRows.length ? epsGrowth(heroEpsRows[0], heroEpsRows, 0, heroEpsCompareOffset, v.sharesOutstanding || g.sharesOutstanding) : g.earningsGrowth;
  const stageShortLabel = (data?.stage?.label || "Sin dato").replace(/\s+probable$/i, "");
  const compactResearchCard = data ? <section className="terminalPanel stockResearchCard stockResearchCardHero">
    <div className="marketSmithStrip" aria-label="Resumen Weinstein Minervini compacto">
      <MiniMetric label="RS Universo" value={rsFmt(rsUniverse)} tone={Number.isFinite(rsUniverse) && rsUniverse >= 75 ? "good" : Number.isFinite(rsUniverse) && rsUniverse < 45 ? "bad" : ""} />
      <MiniMetric label="Etapa" value={stageShortLabel} tone={stageTone} />
      <MiniMetric label="Ventas YoY" value={pct(g.revenueGrowth)} tone={valueTone(g.revenueGrowth)} />
      <MiniMetric label="EPS YoY" value={pct(heroEpsYoY)} tone={valueTone(heroEpsYoY)} />
    </div>
    <div className="heroCardMetrics" aria-label="Metricas clave compactas">
      <div><span>MA 50/200</span><b className={valueTone(finiteValue(technical.distanceSma50, technical.distanceSma200))}>{pct(technical.distanceSma50)} / {pct(technical.distanceSma200)}</b></div>
      <div><span>Vol. 50d</span><b>{Number.isFinite(technical.relativeVolume50) ? `${technical.relativeVolume50.toFixed(1)}x` : "Sin dato"}</b></div>
      <div><span>RS Quality</span><b>{rsFmt(rs.rsQualityScore)}</b></div>
      <div><span>EV/EBITDA</span><b>{ratio(v.enterpriseToEbitda)}</b></div>
    </div>
    <div className="heroCompanyBrief" aria-label="Resumen de negocio compacto">
      <div className="heroCompanyBriefHead">
        <span>Negocio</span>
        <b>{data.theme || data.sector || "Sin clasificar"}</b>
      </div>
      <p>{data.summary || "Sin descripcion de negocio disponible."}</p>
      <div className="heroCompanyFacts">
        <div><span>Industria</span><b>{data.industry || "Sin dato"}</b></div>
        <div><span>Cap.</span><b>{money(data.marketCap, data.marketCapCurrency || data.currency)}</b></div>
        <div><span>Empleados</span><b>{fmt(data.employees)}</b></div>
        <div><span>{listingLabel === "Cotiza desde" ? "Cotiza" : listingLabel}</span><b title={data.listingDateSource || ""}>{listingDate || "Sin dato"}</b></div>
      </div>
    </div>
  </section> : null;

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
            {data?.links?.official && (
              <div className="stockHeroActions">
                <a className="stockHeroLink" href={data.links.official} target="_blank" rel="noreferrer">
                  Web oficial
                </a>
              </div>
            )}
          </div>
        </div>
        {compactResearchCard && <div className="stockHeroCompactCard">{compactResearchCard}</div>}
      </div>
    </section>

    {error && <section className="card error">{error}</section>}

    {data && <>
      <section className="stockWorkspace">
        <div className="terminalPanel chartPanel">
          <div className="sectionTitle">
            <h2>Grafico</h2>
          </div>
          <ChartPreferences settings={chartSettings} onChange={updateChartSettings} symbol={symbol} scope={chartScope} onScopeChange={updateChartScope} compact />
          <div className="chartBenchmarkControl">
            <label htmlFor={`benchmark-${symbol}`}>Comparar vs</label>
            <input id={`benchmark-${symbol}`} list={`benchmark-options-${symbol}`} value={benchmarkDraft} onChange={(event) => setBenchmarkDraft(cleanBenchmarkSymbol(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") updateBenchmark(benchmarkDraft); }} placeholder={rs.benchmarkSymbol || "SPY"} disabled={loading} />
            <datalist id={`benchmark-options-${symbol}`}>
              {BENCHMARK_OPTIONS.map((item) => <option key={item} value={item} />)}
            </datalist>
            <button type="button" onClick={() => updateBenchmark(benchmarkDraft)} disabled={loading || !benchmarkDraft}>Aplicar</button>
            <button type="button" onClick={() => updateBenchmark("")} disabled={loading || !benchmarkOverride}>Auto</button>
          </div>
          <UniversalPriceChart
            bars={data.chartBars}
            symbol={symbol}
            currency={data.currency}
            tradingViewUrl={data.links?.tradingView}
            settings={chartSettings}
            relativeStrength={rs.series}
            benchmarkSymbol={rs.benchmarkSymbol}
            height={600}
          />
        </div>
      </section>

      <SimilarStocks rows={similar} />

      <section className="card">
        <div className="sectionTitle">
          <h2>Fuerza relativa</h2>
        </div>
        <div className="metricGrid rsMetricGrid">
          <Metric label={metricShortLabel("rsGlobalPct")} value={rsFmt(rsUniverse)} tone={Number.isFinite(rsUniverse) && rsUniverse >= 75 ? "good" : Number.isFinite(rsUniverse) && rsUniverse < 45 ? "bad" : "neutral"} />
          <Metric label={metricShortLabel("rsCountryPct")} value={rsFmt(rs.rsCountryPct)} tone={(rs.rsCountryPct || 0) >= 75 ? "good" : (rs.rsCountryPct || 0) < 45 ? "bad" : "neutral"} />
          <Metric label={metricShortLabel("rsSectorPct")} value={rsFmt(rs.rsSectorPct)} tone={(rs.rsSectorPct || 0) >= 75 ? "good" : (rs.rsSectorPct || 0) < 45 ? "bad" : "neutral"} />
          <Metric label={`${metricShortLabel("rsRating")} ${rs.benchmarkSymbol ? `(${rs.benchmarkSymbol})` : ""}`} value={rsFmt(rsBenchmark)} tone={Number.isFinite(rsBenchmark) && rsBenchmark >= 75 ? "good" : Number.isFinite(rsBenchmark) && rsBenchmark < 45 ? "bad" : "neutral"} />
          <Metric label={metricShortLabel("rsQualityScore")} value={rsFmt(rs.rsQualityScore)} tone={(rs.rsQualityScore || 0) >= 70 ? "good" : (rs.rsQualityScore || 0) < 45 ? "bad" : "neutral"} />
          <Metric label="Spec Risk" value={fmt(rs.speculationRiskScore)} tone={(rs.speculationRiskScore || 0) >= 60 ? "warn" : "neutral"} />
          <Metric label="Volatilidad 63d" value={pct(rs.volatility63d)} tone={(rs.volatility63d || 0) >= 70 ? "warn" : "neutral"} />
          <Metric label="Drawdown 63d" value={pct(rs.maxDrawdown63d)} tone={(rs.maxDrawdown63d || 0) >= 25 ? "warn" : "neutral"} />
          <Metric label="RS 3M vs bench" value={pct(rs.rs3m)} tone={(rs.rs3m || 0) >= 0 ? "good" : "bad"} />
          <Metric label="RS 6M vs bench" value={pct(rs.rs6m)} tone={(rs.rs6m || 0) >= 0 ? "good" : "bad"} />
          <Metric label="RS 12M vs bench" value={pct(rs.rs12m)} tone={(rs.rs12m || 0) >= 0 ? "good" : "bad"} />
          <Metric label="Perf 3M" value={pct(rs.perf3m)} tone={(rs.perf3m || 0) >= 0 ? "good" : "bad"} />
          <Metric label="Dist. 52w high" value={pct(rs.distance52w)} tone={Number.isFinite(rs.distance52w) && rs.distance52w >= -15 ? "good" : "neutral"} />
        </div>
      </section>

      <FundamentalsPanel data={data} growth={g} valuation={v} quote={q} calendar={data.earningsCalendar} currency={statementCurrency} />

      <NewsSection rows={data.news} />

      <SocialPulseSection social={social} loading={socialLoading} symbol={symbol} />

    </>}

    {!data && !error && <section className="card">Cargando ficha de {symbol}...</section>}
  </main>;
}
