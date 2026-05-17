"use client";
import { useEffect, useMemo, useState } from "react";
import { clamp, num, pct } from "@/lib/formatters";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { stockUrl } from "@/lib/symbols";

function uniqueRows(rows) { return Array.from(new Map(rows.filter(Boolean).map((r) => [r.symbol, r])).values()); }
function weaknessScore(row = {}) {
  const direct = row.weaknessScore ?? row.snapshot?.weaknessScore;
  if (Number.isFinite(direct)) return direct;
  let score = 0;
  const rs = row.rsGlobalPct ?? row.rsRating ?? row.snapshot?.rsGlobalPct ?? row.snapshot?.rsRating ?? 50;
  if (rs < 45) score += 16;
  if (Number.isFinite(row.distance52w) && row.distance52w < -30) score += 14;
  if (Number.isFinite(row.perf3m ?? row.snapshot?.perf3m) && (row.perf3m ?? row.snapshot?.perf3m) < 0) score += 12;
  if (Number.isFinite(row.extSma50) && row.extSma50 < -8) score += 10;
  if ((row.riskScore ?? row.snapshot?.riskScore ?? 50) < 35) score += 10;
  return clamp(score);
}
function metricValue(row, key) { return key === "weaknessScore" ? weaknessScore(row) : row[key] ?? row.snapshot?.[key] ?? 0; }
function sortBy(rows, key) { return [...rows].sort((a, b) => (metricValue(b, key) || 0) - (metricValue(a, key) || 0)); }
function shortBusiness(row = {}) {
  return [row.industry, row.sector, row.theme || row.snapshot?.theme].filter((value, index, arr) => value && value !== "Sin industria" && value !== "Sin sector" && arr.indexOf(value) === index).slice(0, 3).join(" · ") || "";
}
function monthsSince(d) { if (!d) return null; const x = new Date(d); if (Number.isNaN(x.getTime())) return null; const n = new Date(); return (n.getFullYear() - x.getFullYear()) * 12 + n.getMonth() - x.getMonth(); }
function isRecentIpo(row, maxMonths = 60) { const m = monthsSince(row?.ipoDate); return Number.isFinite(m) && m >= 0 && m <= maxMonths; }
function queryState() {
  if (typeof window === "undefined") return { groupType: "", group: "" };
  const p = new URLSearchParams(window.location.search);
  return { groupType: p.get("groupType") || "", group: p.get("group") || "" };
}
function applyGroupFilter(rows, groupType, group) {
  if (!groupType || !group) return rows;
  return rows.filter((r) => String(r[groupType] || "") === group);
}

function MiniTable({ title, desc, rows, scoreKey = "totalScore", collapsible = true }) {
  const table = <div className="tableWrap">
    <table className="table">
      <thead><tr>{["Ticker", "Empresa", "Tema", "3M", "52w", "SMA50", "W", "M", "RSQ", "Weak", "Risk", "Total"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 18).map((r) => <tr key={r.symbol}>
        <td><a className="ticker" href={stockUrl(r.symbol)}>{r.symbol}</a></td>
        <td>{r.companyName || r.symbol}<br /><span className="fine">{shortBusiness(r)}</span></td>
        <td><span className="pill">{r.theme || r.snapshot?.theme || "-"}</span></td>
        <td>{pct(r.perf3m ?? r.snapshot?.perf3m)}</td>
        <td>{pct(r.distance52w)}</td>
        <td>{pct(r.extSma50)}</td>
        <td>{num(r.weinsteinScore ?? r.snapshot?.weinsteinScore)}</td>
        <td>{num(r.minerviniScore ?? r.snapshot?.minerviniScore)}</td>
        <td>{num(r.rsQualityScore ?? r.snapshot?.rsQualityScore)}</td>
        <td>{num(weaknessScore(r))}</td>
        <td>{num(r.riskScore ?? r.snapshot?.riskScore)}</td>
        <td className="ticker">{num(Number.isFinite(metricValue(r, scoreKey)) ? metricValue(r, scoreKey) : r.snapshot?.totalScore)}</td>
      </tr>)}{!rows.length && <tr><td colSpan="12">Sin datos todavia.</td></tr>}</tbody>
    </table>
  </div>;

  if (collapsible) {
    return <details className="card listDisclosure" open>
      <summary className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></summary>
      {table}
    </details>;
  }

  return <section className="card">
    <div className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></div>
    {table}
  </section>;
}

export default function ListsPage() {
  const [scans, setScans] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [filter, setFilter] = useState({ groupType: "", group: "" });
  useEffect(() => {
    setScans(safeRead(STORAGE_KEYS.scans, []));
    setFavorites(safeRead(STORAGE_KEYS.favorites, []));
    setFilter(queryState());
  }, []);

  const latest = scans[0];
  const allRows = useMemo(() => uniqueRows(latest?.rows || []), [latest]);
  const rows = useMemo(() => applyGroupFilter(allRows, filter.groupType, filter.group), [allRows, filter]);
  const favoritesAsRows = useMemo(() => favorites.map((f) => ({
    symbol: f.symbol,
    companyName: f.companyName,
    theme: f.snapshot?.theme,
    totalScore: f.snapshot?.totalScore,
    rsQualityScore: f.snapshot?.rsQualityScore,
    weaknessScore: f.snapshot?.weaknessScore,
    weinsteinScore: f.snapshot?.weinsteinScore,
    minerviniScore: f.snapshot?.minerviniScore,
    riskScore: f.snapshot?.riskScore,
    perf3m: f.snapshot?.perf3m,
    snapshot: f.snapshot,
  })), [favorites]);

  const leaders = useMemo(() => sortBy(rows, "totalScore"), [rows]);
  const rsQuality = useMemo(() => sortBy(rows, "rsQualityScore"), [rows]);
  const weakness = useMemo(() => sortBy(rows.filter((r) => weaknessScore(r) >= 45), "weaknessScore"), [rows]);
  const weinstein = useMemo(() => sortBy(rows, "weinsteinScore"), [rows]);
  const minervini = useMemo(() => sortBy(rows, "minerviniScore"), [rows]);
  const nearPivot = useMemo(() => rows.filter((r) => (r.distance20d ?? -999) >= -5 && (r.riskScore ?? 0) >= 50).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [rows]);
  const ipo = useMemo(() => rows.filter((r) => isRecentIpo(r, 60)).sort((a, b) => (b.ipoScore || 0) - (a.ipoScore || 0)), [rows]);
  const extended = useMemo(() => rows.filter((r) => (r.extSma50 ?? 0) >= 15 && (r.totalScore ?? 0) >= 70 && (r.distance52w ?? -99) >= -20).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [rows]);
  const pullback = useMemo(() => rows.filter((r) => (r.extSma50 ?? 99) >= -3 && (r.extSma50 ?? 99) <= 8 && (r.price ?? 0) > (r.sma200 ?? Infinity)).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [rows]);

  return <main className="page">
    <section className="card hero">
      <div className="heroTop">
        <div><div className="badge">STATS EDGE · Quick Lists</div><h1>Listas rapidas</h1><p className="muted">Lideres, favoritos y setups desde el ultimo snapshot.</p></div>
        <div className="mobileActions"><a className="btn" href="/">Screener</a><a className="btn" href="/review?source=latest">Vista rapida</a><a className="btn" href="/ipo-radar">IPO Radar</a><a className="btn" href="/research-desk">Research</a><a className="btn btnPrimary" href="/sectors">Sectores</a></div>
      </div>
    </section>
    <section className="card"><div className="kpis"><div className="kpi"><b>{rows.length}</b><span>acciones visibles</span></div><div className="kpi"><b>{favorites.length}</b><span>favoritos</span></div><div className="kpi"><b>{scans.length}</b><span>snapshots</span></div><div className="kpi"><b>{latest ? new Date(latest.createdAt).toLocaleDateString() : "-"}</b><span>ultimo scan</span></div></div></section>
    {filter.group && <section className="card status">Filtro activo: <b>{filter.groupType} = {filter.group}</b> · <a className="ticker" href="/lists">limpiar</a></section>}
    <MiniTable title="Favoritos" desc="Tu watchlist curada" rows={favoritesAsRows} collapsible={false} />
    <MiniTable title="Total Score Leaders" desc="Ranking principal" rows={leaders} />
    <MiniTable title="RS Quality Leaders" desc="RS alto con volatilidad/drawdown controlados" rows={rsQuality} scoreKey="rsQualityScore" />
    <MiniTable title="Deterioro tecnico" desc="Debilidad observable para evitar largos o estudiar cortos" rows={weakness} scoreKey="weaknessScore" />
    <MiniTable title="Weinstein Leaders" desc="Mejor estructura de etapa/tendencia" rows={weinstein} scoreKey="weinsteinScore" />
    <MiniTable title="Minervini Leaders" desc="Trend template, momentum y maximos" rows={minervini} scoreKey="minerviniScore" />
    <MiniTable title="Near Pivot" desc="Cerca de maximos y con riesgo controlado" rows={nearPivot} />
    <MiniTable title="IPO / New Leaders" desc="Solo IPOs reales con fecha <= 5 años" rows={ipo} scoreKey="ipoScore" />
    <MiniTable title="Extended but strong" desc="Muy fuertes, pero vigilar extension sobre SMA50" rows={extended} />
    <MiniTable title="Pullback to SMA50" desc="Lideres cerca de SMA50 para vigilancia" rows={pullback} />
  </main>;
}
