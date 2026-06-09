"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScanSearch } from "lucide-react";
import ChartPreferences from "@/app/ChartPreferences";
import ScreenerOriginPanel from "@/app/ScreenerOriginPanel";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { methodologyCompactReasonLine, methodologyDisplayForRow } from "@/lib/methodologyDisplay";
import { dataStatusLabel } from "@/lib/patternNarrative";
import { screenerStockContextFromSession } from "@/lib/screenerContracts";
import { setupPatternForBars } from "@/lib/setupPatterns";
import { computeTradePlan, tradePlanEligibility } from "@/lib/tradePlan";
import { vcpObjectiveSummary } from "@/lib/vcpDiagnostics";

const fmt = (n) => Number.isFinite(n) ? n.toLocaleString("es-ES") : "Sin dato";
const rsFmt = (n) => Number.isFinite(n) ? String(Math.round(Math.max(0, Math.min(99, n)))) : "Sin dato";
const scoreFmt = (n) => Number.isFinite(n) ? String(Math.round(Math.max(0, Math.min(99, n)))) : "Sin dato";
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
function withPatternHistoryCoverage(pattern = null, bars = []) {
  if (!pattern) return null;
  const existingBars = Number(pattern.patternBarsCount);
  if (Number.isFinite(existingBars)) return pattern;
  const barsCount = Array.isArray(bars) ? bars.length : 0;
  if (!barsCount) return pattern;
  const minBars = Number.isFinite(Number(pattern.patternMinBars)) ? Number(pattern.patternMinBars) : 90;
  return {
    ...pattern,
    patternBarsCount: barsCount,
    patternMinBars: minBars,
    patternCoveragePct: minBars > 0 ? Math.min(100, (barsCount / minBars) * 100) : null,
  };
}

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

function scoreTone(value, good = 75, bad = 45) {
  if (!Number.isFinite(value)) return "neutral";
  if (value >= good) return "good";
  if (value < bad) return "bad";
  return "neutral";
}

function riskTone(value, warn = 60) {
  if (!Number.isFinite(value)) return "neutral";
  return value >= warn ? "warn" : "neutral";
}

function sampleText(value) {
  return Number.isFinite(value) ? `n=${Math.round(value)}` : "sin muestra";
}

function compactDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

function compactBusinessTeaser(data = {}) {
  const fallback = [data.sector, data.industry].filter(Boolean).join(" · ");
  const summary = String(data.summary || "").replace(/\s+/g, " ").trim();
  const usableSummary = summary && !/^Yahoo no ofrece/i.test(summary) ? summary : "";
  const raw = String(usableSummary || data.short || fallback || "").replace(/\s+/g, " ").trim();
  if (!raw || /^Yahoo no ofrece/i.test(raw)) return fallback || "Sin descripción disponible";
  if (raw.length <= 92) return raw;
  const clipped = raw.slice(0, 89).replace(/\s+\S*$/, "").trim();
  return clipped ? `${clipped}...` : raw.slice(0, 89);
}

function latestWeeklyRs(rs = {}) {
  return Array.isArray(rs.globalRsSeries) ? rs.globalRsSeries.at(-1) : null;
}

function RsMetric({ label, value, detail = "", tone = "neutral", compact = false }) {
  return <div className={`rsMetric ${tone} ${compact ? "compact" : ""}`.trim()}>
    <span>{label}</span>
    <b>{value}</b>
    {detail && <small>{detail}</small>}
  </div>;
}

function RsGroup({ title, subtitle = "", children }) {
  return <div className="rsMetricGroup">
    <div className="rsMetricGroupHead">
      <span>{title}</span>
      {subtitle && <em>{subtitle}</em>}
    </div>
    <div className="rsMetricGroupGrid">{children}</div>
  </div>;
}

function RelativeStrengthPanel({ rs = {}, rsUniverse, rsBenchmark, country = "" }) {
  const weekly = latestWeeklyRs(rs);
  const weeklyScore = finiteValue(weekly?.rsRating);
  const snapshotScore = finiteValue(rs.rsGlobalPct);
  const globalScore = finiteValue(rsUniverse, weeklyScore, snapshotScore);
  const globalSample = finiteValue(weekly?.sampleSize, rs.rsGlobalSample);
  const globalDate = compactDate(weekly?.date || rs.universe?.asOf);
  const benchmarkSymbol = rs.benchmarkSymbol || "benchmark";
  const snapshotDate = compactDate(rs.universe?.asOf);
  const countryDetail = [country, sampleText(rs.rsCountrySample)].filter(Boolean).join(" · ");
  const groupSample = finiteValue(rs.rsSectorSample);
  const groupDetail = `${sampleText(groupSample)}${groupSample && groupSample < 20 ? " · muestra baja" : ""}`;
  const sourceLine = weekly
    ? `RS global semanal USD · ${sampleText(globalSample)}${globalDate ? ` · ${globalDate}` : ""}`
    : `RS global del ultimo scan${snapshotDate ? ` · ${snapshotDate}` : ""}`;

  return <section className="card rsPanel">
    <div className="sectionTitle rsPanelTitle">
      <div>
        <h2>Fuerza relativa</h2>
        <p className="fine">{sourceLine}</p>
      </div>
      <span className="rsPanelBadge">{rs.ratingSource === "universe" || weekly ? "RS real" : "Sin snapshot"}</span>
    </div>
    <div className="rsPanelGrid">
      <RsGroup title="Ranking" subtitle="percentil 1-99">
        <RsMetric label="RS global" value={rsFmt(globalScore)} detail={sampleText(globalSample)} tone={scoreTone(globalScore)} />
        <RsMetric label="RS pais" value={rsFmt(rs.rsCountryPct)} detail={countryDetail} tone={scoreTone(rs.rsCountryPct)} />
        <RsMetric label="Grupo" value={rsFmt(rs.rsSectorPct)} detail={groupDetail} tone={scoreTone(rs.rsSectorPct)} />
      </RsGroup>
      <RsGroup title={`Benchmark ${benchmarkSymbol}`} subtitle="precio relativo">
        <RsMetric label="RS bench" value={rsFmt(rsBenchmark)} detail="modelo técnico" tone={scoreTone(rsBenchmark)} />
        <RsMetric label="3M" value={pct(rs.rs3m)} detail="vs benchmark" tone={valueTone(rs.rs3m)} />
        <RsMetric label="6M" value={pct(rs.rs6m)} detail="vs benchmark" tone={valueTone(rs.rs6m)} />
        <RsMetric label="12M" value={pct(rs.rs12m)} detail="vs benchmark" tone={valueTone(rs.rs12m)} />
      </RsGroup>
      <RsGroup title="Calidad y riesgo" subtitle="datos técnicos">
        <RsMetric label="RS quality" value={scoreFmt(rs.rsQualityScore)} detail={rs.rsQualityLabel || "estabilidad"} tone={scoreTone(rs.rsQualityScore, 70, 45)} />
        <RsMetric label="Riesgo técnico" value={scoreFmt(rs.speculationRiskScore)} detail="0 bajo · 99 alto" tone={riskTone(rs.speculationRiskScore)} />
        <RsMetric label="Volatilidad 63d" value={pct(rs.volatility63d)} detail="anualizada" tone={riskTone(rs.volatility63d, 70)} />
        <RsMetric label="Drawdown 63d" value={pct(rs.maxDrawdown63d)} detail="maximo" tone={riskTone(rs.maxDrawdown63d, 25)} />
      </RsGroup>
      <RsGroup title="Precio" subtitle="contexto">
        <RsMetric label="Perf 3M" value={pct(rs.perf3m)} detail="precio absoluto" tone={valueTone(rs.perf3m)} />
        <RsMetric label="Dist. 52W high" value={pct(rs.distance52w)} detail="desde maximo" tone={Number.isFinite(rs.distance52w) && rs.distance52w >= -15 ? "good" : "neutral"} />
      </RsGroup>
    </div>
  </section>;
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
    <span aria-hidden="true">i</span>
    <em aria-hidden="true">{text}</em>
  </span>;
}

function SignalStat({ label, value, detail, tone = "" }) {
  return <div className={`signalStat ${tone}`}>
    <span>{label}</span>
    <b>{value}</b>
    {detail && <small>{detail}</small>}
  </div>;
}

const TRADE_PLAN_STORAGE_KEY = "statsedge:tradePlan";
function readTradePlanPrefs() {
  if (typeof window === "undefined") return { accountSize: "", accountRiskPct: "1" };
  try {
    const raw = window.localStorage.getItem(TRADE_PLAN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const accountRiskPct = Number(parsed.accountRiskPct);
      return {
        accountSize: parsed.accountSize != null ? String(parsed.accountSize) : "",
        accountRiskPct: Number.isFinite(accountRiskPct) && accountRiskPct > 0 ? String(accountRiskPct) : "1",
      };
    }
  } catch {}
  return { accountSize: "", accountRiskPct: "1" };
}

function tradePlanContext(plan) {
  const distance = plan?.distanceToPivotPct;
  if (!Number.isFinite(distance)) return { label: "Sin precio", detail: "Precio actual no disponible", tone: "neutral" };
  const absoluteDistance = Math.abs(distance);
  if (distance < -3) return { label: "Bajo pivot", detail: `a ${pct(absoluteDistance)} del pivot`, tone: "below" };
  if (distance <= 3) {
    return {
      label: "Zona pivot",
      detail: distance >= 0 ? `precio ${pct(distance)} sobre pivot` : `a ${pct(absoluteDistance)} del pivot`,
      tone: "ready",
    };
  }
  return { label: "Sobre pivot", detail: `precio ${pct(distance)} sobre pivot`, tone: distance > 8 ? "extended" : "neutral" };
}

function TradePlanPanel({ pattern, price, currency, structure, display }) {
  // Initialise with SSR-safe defaults; read localStorage only after mount so the
  // server and first client render agree (no hydration mismatch).
  const [prefs, setPrefs] = useState({ accountSize: "", accountRiskPct: "1" });
  const hydratedRef = useRef(false);
  useEffect(() => {
    setPrefs(readTradePlanPrefs());
    hydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return;
    try { window.localStorage.setItem(TRADE_PLAN_STORAGE_KEY, JSON.stringify(prefs)); } catch {}
  }, [prefs]);

  const accountSize = Number(prefs.accountSize);
  const accountRiskPct = Number(prefs.accountRiskPct);
  const displayGate = display || methodologyDisplayForRow(pattern || {});
  const gate = useMemo(() => {
    if (displayGate.blocksPatternClaim) return { actionable: false, reason: displayGate.reason || displayGate.line || "Datos insuficientes para derivar plan." };
    if (!displayGate.actionable || !displayGate.tradePlanEligible) return { actionable: false, reason: displayGate.tradePlanReason || displayGate.reason || "Plan no válido para esta estructura." };
    return tradePlanEligibility({
      ...(pattern || {}),
      setupStructureKey: structure?.key,
      setupStructureStrict: structure?.strict,
      setupStructureReason: structure?.reason,
    });
  }, [pattern, structure, displayGate]);
  const plan = useMemo(() => computeTradePlan(
    { ...(pattern || {}), price },
    {
      accountSize: Number.isFinite(accountSize) && accountSize > 0 ? accountSize : undefined,
      accountRiskPct: Number.isFinite(accountRiskPct) && accountRiskPct > 0 ? accountRiskPct : 1,
    },
  ), [pattern, price, accountSize, accountRiskPct]);
  const context = plan.available ? tradePlanContext(plan) : null;
  if (!gate.actionable) return null;

  return <section className="card terminalPanel tradePlanPanel">
    <div className="sectionTitle tradePlanTitle">
      <div>
        <h2>Plan de operación</h2>
        <span className="fine">Niveles derivados de la base · referencia técnica, no recomendación</span>
      </div>
      {context && <span className={`tradePlanStatus ${context.tone}`.trim()}>{context.label}</span>}
    </div>
    {!plan.available
      ? <p className="fine">{plan.reason || "Sin estructura medible para derivar un plan."}</p>
      : <>
        <div className="signalStrip tradePlanLevels">
          <SignalStat
            label="Pivot técnico"
            value={priceMoney(plan.pivot, currency)}
            detail={context?.detail || ""}
            tone={plan.abovePivot ? "neutral" : ""}
          />
          <SignalStat label="Stop referencia" value={priceMoney(plan.stop, currency)} detail={`${plan.stopType} · riesgo ${pct(plan.riskPct)}`} tone="bad" />
          <SignalStat label="Objetivo 2R" value={priceMoney(plan.target2R, currency)} tone="good" />
          <SignalStat label="Objetivo 3R" value={priceMoney(plan.target3R, currency)} tone="good" />
        </div>
        {plan.deepBase && <p className="fine tradePlanNotice">Base profunda: el mínimo estructural queda más allá del {plan.cappedStopPct}% bajo el pivot. El stop se acota al {plan.cappedStopPct}% para limitar la pérdida por acción.</p>}
        <div className="tradePlanSizing">
          <div className="tradePlanSizingHead">
            <span>Dimensionamiento por riesgo</span>
            <small>{plan.sizing ? `Presupuesto ${priceMoney(plan.sizing.riskBudget, currency)}` : "Completa capital y riesgo"}</small>
          </div>
          <div className="tradePlanFields">
            <label className="field tradePlanField"><span>Capital de cuenta</span><input className="input" type="number" inputMode="decimal" min="0" value={prefs.accountSize} placeholder="ej. 10000" onChange={(event) => setPrefs((previous) => ({ ...previous, accountSize: event.target.value }))} /></label>
            <label className="field tradePlanField"><span>Riesgo por operación %</span><input className="input" type="number" inputMode="decimal" min="0.1" step="0.25" value={prefs.accountRiskPct} onChange={(event) => setPrefs((previous) => ({ ...previous, accountRiskPct: event.target.value }))} /></label>
          </div>
        </div>
        {plan.sizing
          ? <div className="signalStrip tradePlanSizingResults">
            <SignalStat label="Acciones" value={fmt(plan.sizing.shares)} detail={`presupuesto de riesgo ${priceMoney(plan.sizing.riskBudget, currency)}`} />
            <SignalStat label="Importe posición" value={money(plan.sizing.positionValue, currency)} detail={`${pct(plan.sizing.positionPctOfAccount)} de la cuenta`} tone={plan.sizing.leveraged ? "bad" : ""} />
            <SignalStat label="Riesgo / acción" value={priceMoney(plan.riskPerShare, currency)} />
          </div>
          : <p className="fine tradePlanEmpty">Introduce tu capital para calcular tamaño de posición.</p>}
        {plan.sizing?.shares === 0 && <p className="fine tradePlanEmpty">El presupuesto de riesgo no alcanza una acción completa con este stop.</p>}
      </>}
  </section>;
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
      <h2>{embedded ? "Histórico" : "Fundamentales históricos"} {!embedded && <InfoHint text="Vista inspirada en estados financieros históricos; no son datos normalizados propietarios. La cobertura puede variar por mercado, moneda y disponibilidad." />}</h2>
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
  const price = finiteValue(latest.close, quote.price);
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

function priceSnapshotFromBars(bars = [], quote = {}) {
  const rows = [...(bars || [])]
    .map((bar) => ({
      date: bar.date,
      close: Number(bar.close),
    }))
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const latest = rows.at(-1) || {};
  const previous = rows.at(-2) || {};
  const price = finiteValue(latest.close, quote.price);
  const dayChange = Number.isFinite(price) && Number.isFinite(previous.close) ? price - previous.close : quote.dayChange;
  const dayChangePct = Number.isFinite(price) && Number.isFinite(previous.close) && previous.close > 0 ? ((price / previous.close) - 1) * 100 : quote.dayChangePct;
  const quoteDriftPct = Number.isFinite(latest.close) && Number.isFinite(quote.price) && latest.close > 0
    ? Math.abs((quote.price / latest.close) - 1) * 100
    : null;
  return {
    price,
    date: latest.date || "",
    dayChange,
    dayChangePct,
    quoteDriftPct,
    coherent: !Number.isFinite(quoteDriftPct) || quoteDriftPct < 0.35,
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
      <em>{item.publisher || "Fuente disponible"} · {dateFmt(item.publishedAt)}</em>
      <small>{item.relevanceReasons?.length ? `Relevancia: ${item.relevanceReasons.join(", ")}` : "Relevancia aproximada por ticker/nombre"}</small>
      <span className={`newsLinkCue ${item.link ? "" : "disabled"}`}>{item.link ? "Abrir noticia ->" : "Sin enlace disponible"}</span>
    </span>
  </>;
  return <section className="card">
    <div className="sectionTitle">
      <h2>Noticias relevantes <InfoHint text="Noticias recuperadas desde fuentes disponibles. La relevancia y el sesgo son heuristicas, no una clasificacion editorial." /></h2>
      <span className="fine">sesgo heuristico</span>
    </div>
    <div className="newsGrid">
      {rows?.length ? rows.map((item, index) => {
        const className = `newsItem ${item.thumbnail ? "" : "newsItemNoThumb"} ${index === 0 ? "newsItemLead" : ""} ${item.link ? "" : "newsItemDisabled"}`;
        return item.link
          ? <a className={className} key={`${item.link}-${item.publishedAt}`} href={item.link} target="_blank" rel="noreferrer" aria-label={`Abrir noticia: ${item.title}`}>{cardContent(item)}</a>
          : <article className={className} key={`${item.title}-${item.publishedAt}`}>{cardContent(item)}</article>;
      }) : <div className="dataNote">Sin noticias recientes para este ticker.</div>}
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
      <h2>Pulso X / cashtag <InfoHint text="Busca posts recientes con cashtag tipo $TICKER si hay integracion social configurada. No se usa como fuente de precio." /></h2>
      <span className="fine">{loading ? "cargando" : hasRows ? "muestra reciente" : "sin datos"}</span>
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

function StructureSummary({ row = {}, compact = false }) {
  const display = methodologyDisplayForRow(row);
  const confidence = display.confidence;
  const score = Number.isFinite(row.patternQualityScore) ? `Calidad ${row.patternQualityScore.toFixed(0)}` : "";
  const reason = methodologyCompactReasonLine(row) || score || display.structure?.dataLabel;
  const detail = confidence.key === "partial" ? `${confidence.shortLabel} · ${reason}` : reason;
  return <div className={`structureSummary ${compact ? "compact" : ""} ${display.tone || ""}`} title={display.reason || ""}>
    <span>{display.label}</span>
    <small>{detail}</small>
  </div>;
}

function DataConfidenceCell({ row = {} }) {
  const confidence = methodologyDisplayForRow(row).confidence;
  return <span className={`dataConfidencePill ${confidence.state}`.trim()} title={confidence.detail}>{confidence.label}</span>;
}

function patternClaimBlocked(row = {}) {
  const display = methodologyDisplayForRow(row);
  return display.blocksPatternClaim === true || display.dataLimited === true ? display : null;
}

function AuditCheck({ label, value, state = "neutral", detail = "" }) {
  return <div className={`auditCheck ${state}`.trim()}>
    <span>{label}</span>
    <b>{value}</b>
    {detail && <small>{detail}</small>}
  </div>;
}

function MethodologyAuditPanel({ pattern, verdict, stage }) {
  if (!pattern) return null;
  const display = methodologyDisplayForRow(pattern);
  const currentVerdict = verdict || display.verdict;
  const confidence = display.confidence;
  const objective = vcpObjectiveSummary(pattern);
  const stageOk = /stage 2/i.test(stage?.label || "");
  const baseOk = pattern.consolidationCandidate === true;
  const count = Number(pattern.contractionCount);
  const contractionsOk = Number.isFinite(count) && count >= 2 && pattern.contractionsDecreasing === true;
  const volume = Number(pattern.volumeDryUpRatio);
  const volumeOk = Number.isFinite(volume) && volume <= 0.9;
  const pivot = Number(pattern.distanceToPivotPct);
  const pivotOk = Number.isFinite(pivot) && Math.abs(pivot) <= 6;
  const lastContraction = Number(pattern.lastContractionDepthPct);
  const lastContractionOk = Number.isFinite(lastContraction) && lastContraction <= 8;
  const range10 = Number(pattern.tightness10dPct);
  const range10Ok = Number.isFinite(range10) && range10 <= 12;
  const quality = Number(pattern.patternQualityScore);
  const qualityOk = Number.isFinite(quality) && quality >= 65;
  const planValid = display.actionable && display.tradePlanEligible && !display.blocksPatternClaim;
  const claimBlocked = display.blocksPatternClaim === true || display.dataLimited === true;
  const claimState = (ok, fallback = "warn") => claimBlocked ? "warn" : ok ? "pass" : fallback;
  const fullReason = display.reason || currentVerdict.reason || "Sin razón disponible.";
  const objectiveDetail = [objective.detail, `Veredicto: ${display.label}`, fullReason].filter(Boolean).join(" · ");
  return <section className="card methodologyAuditPanel">
    <div className="sectionTitle methodologyAuditTitle">
      <div>
        <h2>Evidencia VCP <InfoHint text="Datos observables de la base actual: compresiones de precio, rango, pivot y volumen. El veredicto se mantiene como contexto, no como recomendación." /></h2>
      </div>
      <div className="methodologyBadgeStack">
        <span className={`methodologyVerdictBadge ${display.tone || ""}`.trim()} title={display.reason || ""}>{display.label}</span>
        <span className={`methodologyConfidenceBadge ${confidence.state}`.trim()} title={confidence.detail}>{confidence.label}</span>
      </div>
    </div>
    <p className="methodologyVerdictReason">
      <span>{objective.primary}</span>
      {objective.secondary && <small>{objective.secondary}</small>}
      <InfoHint text={objectiveDetail} />
      {confidence.key !== "ok" && <small>{confidence.detail}</small>}
    </p>
    <div className="auditGrid">
      <AuditCheck label="Datos técnicos" value={confidence.label} state={confidence.state} detail={confidence.detail || currentVerdict.dataLabel || dataStatusLabel(pattern.patternDataStatus)} />
      <AuditCheck label="Histórico" value={objective.history?.value || "Sin dato"} state={objective.history?.state || "neutral"} detail={objective.history?.detail || ""} />
      <AuditCheck label="Etapa" value={stage?.label || "Sin dato"} state={stageOk ? "pass" : "warn"} />
      <AuditCheck label="Base/rango" value={Number.isFinite(pattern.baseDepthPct) ? pct(pattern.baseDepthPct) : "Sin dato"} state={baseOk ? "pass" : "fail"} detail={Number.isFinite(pattern.baseWeeks) ? `${pattern.baseWeeks.toFixed(1)} semanas` : pattern.baseContextStatus || ""} />
      <AuditCheck label="Compresiones" value={Number.isFinite(count) ? `${count.toFixed(0)} medidas` : "Sin dato"} state={claimState(contractionsOk, Number.isFinite(count) && count >= 2 ? "warn" : "fail")} detail={objective.sequence} />
      <AuditCheck label="Última comp." value={Number.isFinite(lastContraction) ? pct(lastContraction) : "Sin dato"} state={claimState(lastContractionOk)} detail={objective.contractionDetail.at(-1) || ""} />
      <AuditCheck label="Rango 10d" value={Number.isFinite(range10) ? pct(range10) : "Sin dato"} state={claimState(range10Ok)} detail={Number.isFinite(pattern.tightness20dPct) ? `20d ${pct(pattern.tightness20dPct)}` : ""} />
      <AuditCheck label="Pivot" value={Number.isFinite(pivot) ? pct(pivot) : "Sin dato"} state={claimState(pivotOk)} />
      <AuditCheck label="Volumen seco" value={Number.isFinite(volume) ? `${volume.toFixed(2)}x` : "Sin dato"} state={claimState(volumeOk)} />
      <AuditCheck label="Score patrón" value={Number.isFinite(quality) ? quality.toFixed(0) : "Sin dato"} state={claimState(qualityOk)} />
      <AuditCheck label="Plan" value={planValid ? "Válido" : "No válido"} state={planValid ? "pass" : "fail"} detail={display.tradePlanReason || currentVerdict.tradePlanReason || display.reason || ""} />
    </div>
  </section>;
}

function ContractionTape({ row = {}, depths = [] }) {
  const blocked = patternClaimBlocked(row);
  if (blocked) return <span title={blocked.reason || blocked.line || ""}>No validado</span>;
  const objective = vcpObjectiveSummary(row);
  if (objective.sequence && objective.sequence !== "sin compresiones") {
    return <span title={objective.rejectedContractionText || ""}>{objective.sequence}</span>;
  }
  const values = (Array.isArray(depths) ? depths : []).filter(Number.isFinite).slice(0, 4);
  if (!values.length) return <span>Sin dato</span>;
  return <span>{values.map((value) => `${value.toFixed(1)}%`).join(" -> ")}</span>;
}

function ComparativeContext({ rows = [], note = "", symbol = "" }) {
  const countLabel = rows.length ? `${rows.length} referencias` : "sin referencias";
  return <section className="card">
    <div className="sectionTitle">
      <div>
        <h2>Contexto comparativo</h2>
        <p className="fine">Mismo grupo o mercado · perfiles técnicos comparables</p>
      </div>
      <span className="fine">{countLabel}</span>
    </div>
    <div className="dataNote" style={{ marginBottom: 12 }}>
      {note || "Sin referencias comparables en los snapshots recientes con los datos actuales."}
    </div>
    {rows.length ? <div className="tableWrap">
      <table className="table">
        <thead><tr>{["Ticker", "Relacion", "Estructura", "Contracciones", "Base", "Pivot", "Vol. seco", "RS grupo", "Datos"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((item) => {
          const current = String(item.symbol || "").toUpperCase() === String(symbol || "").toUpperCase();
          const blocked = patternClaimBlocked(item);
          const blockedCell = <span title={blocked?.reason || blocked?.line || ""}>No validado</span>;
          return <tr key={item.symbol} className={current ? "active" : ""}>
            <td><a className="ticker" href={`/stock/${encodeURIComponent(item.symbol)}`}>{item.symbol}</a><br /><span className="fine">{item.companyName || ""}</span></td>
            <td><span className="pill">{item.relation?.label || "Contexto"}</span></td>
            <td><StructureSummary row={item} compact /></td>
            <td><ContractionTape row={item} depths={item.contractionDepths} /></td>
            <td>{Number.isFinite(item.baseDepthPct) ? `${item.baseDepthPct.toFixed(1)}%` : "Sin dato"}<br /><span className="fine">{Number.isFinite(item.baseWeeks) ? `${item.baseWeeks.toFixed(1)} sem` : ""}</span></td>
            <td>{blocked ? blockedCell : Number.isFinite(item.distanceToPivotPct) ? pct(item.distanceToPivotPct) : "Sin dato"}</td>
            <td>{blocked ? blockedCell : Number.isFinite(item.volumeDryUpRatio) ? `${item.volumeDryUpRatio.toFixed(2)}x` : "Sin dato"}</td>
            <td>{Number.isFinite(item.rsSectorPct) ? item.rsSectorPct.toFixed(0) : "Sin dato"}</td>
            <td><DataConfidenceCell row={item} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <p className="fine">La seccion queda activa y se completara cuando haya snapshots suficientes del mismo sector, industria, tema o mercado.</p>}
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
  const [comparables, setComparables] = useState({ rows: [], note: "" });
  const [social, setSocial] = useState(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [chartSettings, setChartSettings] = useState(DEFAULT_CHART_SETTINGS);
  const [chartScope, setChartScope] = useState("global");
  const [benchmarkDraft, setBenchmarkDraft] = useState("");
  const [companyBriefExpanded, setCompanyBriefExpanded] = useState(false);
  const [screenerOrigin, setScreenerOrigin] = useState(null);
  const [showVcpDiagnostics, setShowVcpDiagnostics] = useState(false);

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

  function loadComparablesFor(payload) {
    if (!symbol || !payload) return;
    const qs = new URLSearchParams({
      symbol,
      sector: payload.sector || "",
      industry: payload.industry || "",
      theme: payload.theme || "",
      country: payload.country || "",
    });
    fetch(`/api/comparables?${qs.toString()}`)
      .then((res) => res.json())
      .then((result) => setComparables({ rows: result.results || [], note: result.note || "" }))
      .catch(() => setComparables({ rows: [], note: "Contexto comparativo no disponible en este momento." }));
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
      loadComparablesFor(d);
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
    setScreenerOrigin(screenerStockContextFromSession(safeRead(STORAGE_KEYS.screenerSession, null), symbol));
    setLogoIndex(0);
    setLogoLoaded(false);
    setCompanyBriefExpanded(false);
    setShowVcpDiagnostics(false);
    const savedBenchmark = cleanBenchmarkSymbol(nextSettings.benchmarks?.[symbol]);
    if (initialData) {
      loadSimilarFor(initialData);
      loadComparablesFor(initialData);
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
  const weeklyGlobalRs = latestWeeklyRs(rs);
  const rsUniverse = finiteValue(weeklyGlobalRs?.rsRating, rs.rsGlobalPct);
  const rsBenchmark = finiteValue(rs.benchmarkRating, rs.rsRating);
  const priceSnapshot = priceSnapshotFromBars(data?.chartBars || [], q);
  const technical = technicalSnapshotFromBars(data?.chartBars || [], q);
  const statementCurrency = data?.financialResults?.currency || g.financialCurrency || data?.currency || "";
  const stageTone = /etapa 2/i.test(data?.stage?.label || "") ? "good" : /etapa 4/i.test(data?.stage?.label || "") ? "bad" : "neutral";
  const dayTone = (priceSnapshot.dayChangePct || 0) >= 0 ? "up" : "down";
  const nextEarnings = data?.earningsCalendar?.earningsDate || data?.earningsCalendar?.earningsStart || "Sin dato";
  const listingDate = data?.ipoDate || data?.listingDate || "";
  const listingLabel = data?.ipoDate ? "IPO" : data?.listingDate ? "Cotiza desde" : "IPO";
  const freshness = data?.dataQuality?.freshness || {};
  const coverage = data?.dataQuality?.coverage || {};
  const compactProfile = data ? [data.sector, data.industry, data.country].filter(Boolean).join(" · ") : "";
  const setupPattern = useMemo(() => {
    const pattern = data?.setupPattern || (data?.chartBars?.length ? setupPatternForBars(data.chartBars) : null);
    return withPatternHistoryCoverage(pattern, data?.chartBars || []);
  }, [data?.setupPattern, data?.chartBars]);
  const setupDisplay = useMemo(() => methodologyDisplayForRow(setupPattern || {}), [setupPattern]);
  const setupVerdict = setupDisplay.verdict;
  const setupStructure = setupDisplay.structure;
  const setupTradePlanEligible = setupDisplay.actionable && setupDisplay.tradePlanEligible && !setupDisplay.blocksPatternClaim;
  const actionableSetupPattern = setupTradePlanEligible ? setupPattern : null;
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
  const businessTeaser = compactBusinessTeaser(data);
  const companySummary = data?.summary || "Sin descripción de negocio disponible.";
  const companySummaryId = `hero-company-summary-${symbol || "stock"}`;
  const canExpandCompanyBrief = companySummary.length > 80;
  const compactResearchCard = data ? <section className={`terminalPanel stockResearchCard stockResearchCardHero ${companyBriefExpanded ? "stockResearchCardHeroExpanded" : ""}`}>
    <div className="marketSmithStrip" aria-label="Resumen Weinstein Minervini compacto">
      <MiniMetric label="RS" value={rsFmt(rsUniverse)} tone={Number.isFinite(rsUniverse) && rsUniverse >= 75 ? "good" : Number.isFinite(rsUniverse) && rsUniverse < 45 ? "bad" : ""} />
      <MiniMetric label="Etapa" value={stageShortLabel} tone={stageTone} />
      <MiniMetric label="Ventas YoY" value={pct(g.revenueGrowth)} tone={valueTone(g.revenueGrowth)} />
      <MiniMetric label="EPS YoY" value={pct(heroEpsYoY)} tone={valueTone(heroEpsYoY)} />
    </div>
    <div className="heroCardMetrics" aria-label="Metricas clave compactas">
      <div><span>MA 50/200</span><b className={valueTone(finiteValue(technical.distanceSma50, technical.distanceSma200))}>{pct(technical.distanceSma50)} / {pct(technical.distanceSma200)}</b></div>
      <div><span>Estructura</span><b className={setupDisplay.tone || ""} title={setupDisplay.reason || ""}>{setupDisplay.shortLabel}</b></div>
      <div><span>RS Quality</span><b>{rsFmt(rs.rsQualityScore)}</b></div>
      <div className="heroBusinessMetric"><span>Negocio</span><b title={businessTeaser}>{businessTeaser}</b></div>
    </div>
    <div className="heroCompanyBrief" aria-label="Resumen de negocio compacto">
      <div className="heroCompanyBriefHead">
        <span>Negocio</span>
        <b>{data.theme || data.sector || "Sin clasificar"}</b>
      </div>
      <div className={`heroCompanyBriefCopy ${companyBriefExpanded ? "isExpanded" : ""}`}>
        <p id={companySummaryId}>{companySummary}</p>
        {canExpandCompanyBrief && <button
          className="heroCompanyBriefToggle"
          type="button"
          aria-expanded={companyBriefExpanded}
          aria-controls={companySummaryId}
          onClick={() => setCompanyBriefExpanded((value) => !value)}
        >
          {companyBriefExpanded ? "Ver menos" : "Ver completo"}
        </button>}
      </div>
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
              <span className="stockQuoteLabel">Cierre del gráfico</span>
              <strong>{Number.isFinite(priceSnapshot.price) ? priceMoney(priceSnapshot.price) : "Sin cotizacion"}</strong>
              {data?.currency && <span className="stockQuoteCurrency">{data.currency}</span>}
              {Number.isFinite(priceSnapshot.dayChangePct) && <b className={dayTone}>{signedPriceMoney(priceSnapshot.dayChange)} ({pct(priceSnapshot.dayChangePct)})</b>}
            </div>
            <div className="stockDataLine" aria-label="Frescura y cobertura de datos">
              <span>{priceSnapshot.date || freshness.priceDate ? `Cierre ${compactDate(priceSnapshot.date || freshness.priceDate)}` : "Cierre sin fecha"}</span>
              {coverage.label && <span>{coverage.label}</span>}
              <span>{freshness.rsGlobalAsOf ? `RS ${compactDate(freshness.rsGlobalAsOf)} · ${sampleText(freshness.rsGlobalSample)}` : "RS sin snapshot"}</span>
              {!priceSnapshot.coherent && <span>cotizacion intradia distinta</span>}
            </div>
            <ScreenerOriginPanel origin={screenerOrigin} variant="stock" />
            <div className="stockHeroActions">
              <a className="stockHeroLink stockBackLink" href="/">
                Screener
              </a>
              {data?.links?.official && (
                <a className="stockHeroLink" href={data.links.official} target="_blank" rel="noreferrer">
                  Web oficial
                </a>
              )}
            </div>
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
            <button
              type="button"
              className={`chartToolButton ${showVcpDiagnostics ? "active" : ""}`.trim()}
              onClick={() => setShowVcpDiagnostics((value) => !value)}
              disabled={!setupPattern}
              aria-pressed={showVcpDiagnostics}
              title="Mostrar contracciones VCP, pivot y motivo de bloqueo en el gráfico."
            >
              <ScanSearch aria-hidden="true" size={14} />
              VCP
            </button>
            <InfoHint text="Activa C1/C2/C3, pivot y gates mínimos de diagnóstico. No cambia filtros ni verdictos." />
          </div>
          <UniversalPriceChart
            bars={data.chartBars}
            symbol={symbol}
            currency={data.currency}
            tradingViewUrl={data.links?.tradingView}
            settings={chartSettings}
            relativeStrength={rs.series}
            rsMainScore={rsUniverse}
            rsRatingSeries={rs.globalRsSeries}
            benchmarkSymbol={rs.benchmarkSymbol}
            patternOverlay={showVcpDiagnostics ? setupPattern : actionableSetupPattern}
            showPatternDiagnostics={showVcpDiagnostics}
            height={600}
          />
        </div>
      </section>

      <MethodologyAuditPanel pattern={setupPattern} verdict={setupVerdict} stage={data.stage} />

      <TradePlanPanel pattern={setupPattern} structure={setupStructure} display={setupDisplay} price={priceSnapshot.price} currency={data.currency} />

      <SimilarStocks rows={similar} />

      <ComparativeContext rows={comparables.rows} note={comparables.note} symbol={symbol} />

      <RelativeStrengthPanel rs={rs} rsUniverse={rsUniverse} rsBenchmark={rsBenchmark} country={data.country} />

      <FundamentalsPanel data={data} growth={g} valuation={v} quote={q} calendar={data.earningsCalendar} currency={statementCurrency} />

      <NewsSection rows={data.news} />

      <SocialPulseSection social={social} loading={socialLoading} symbol={symbol} />

    </>}

    {!data && !error && <section className="card">Cargando ficha de {symbol}...</section>}
  </main>;
}
