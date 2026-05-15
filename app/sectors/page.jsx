"use client";
import { useEffect, useMemo, useState } from "react";
import { clamp, num, pct } from "@/lib/formatters";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { countryCode, countryName, externalLinks, marketFlag, stockUrl } from "@/lib/symbols";

const STRENGTH_FILTERS = [
  ["all", "Todos"],
  ["leaders", "Fuertes"],
  ["constructive", "Constructivos"],
  ["weak", "Debiles"],
  ["veryWeak", "Muy debiles"],
];
function rowCountry(row = {}) {
  return row.country || row.snapshot?.country || (row.symbol ? countryCode(row.symbol) : "US");
}

function rowScore(row = {}) {
  return row.totalScore ?? row.snapshot?.totalScore ?? 0;
}
function weaknessScore(row = {}) {
  const direct = row.weaknessScore ?? row.snapshot?.weaknessScore;
  if (Number.isFinite(direct)) return direct;
  let score = 0;
  const rs = row.rsRating ?? row.snapshot?.rsRating ?? 50;
  if (rs < 45) score += 16;
  if (Number.isFinite(row.distance52w) && row.distance52w < -30) score += 14;
  if (Number.isFinite(row.perf3m) && row.perf3m < 0) score += 12;
  if (Number.isFinite(row.extSma50) && row.extSma50 < -8) score += 10;
  if ((row.riskScore ?? row.snapshot?.riskScore ?? 50) < 35) score += 10;
  return clamp(score);
}
function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span>i</span>
    <em>{text}</em>
  </span>;
}
function shortBusiness(row = {}) {
  return [row.industry, row.sector, row.theme].filter((value, index, arr) => value && value !== "Sin industria" && value !== "Sin sector" && arr.indexOf(value) === index).slice(0, 3).join(" · ") || row.source || "";
}

function favoriteRows(favorites = []) {
  return favorites.map((favorite) => ({
    symbol: favorite.symbol,
    companyName: favorite.companyName || favorite.symbol,
    theme: favorite.snapshot?.theme || favorite.theme || "Favoritos",
    sector: favorite.sector || "Sin sector",
    industry: favorite.industry || "Sin industria",
    businessEs: favorite.snapshot?.businessEs || favorite.notes || "",
    totalScore: favorite.snapshot?.totalScore ?? null,
    rsRating: favorite.snapshot?.rsRating ?? null,
    weaknessScore: favorite.snapshot?.weaknessScore ?? null,
    weinsteinScore: favorite.snapshot?.weinsteinScore ?? null,
    minerviniScore: favorite.snapshot?.minerviniScore ?? null,
    riskScore: favorite.snapshot?.riskScore ?? null,
    perf3m: favorite.snapshot?.perf3m ?? null,
    perf6m: favorite.snapshot?.perf6m ?? null,
    perf12m: favorite.snapshot?.perf12m ?? null,
    distance20d: favorite.snapshot?.distance20d ?? null,
    distance52w: favorite.snapshot?.distance52w ?? null,
    extSma50: favorite.snapshot?.extSma50 ?? null,
    source: "favorite",
  }));
}

function cleanRows(rows = []) {
  return Array.from(new Map(rows.filter(Boolean).map((row) => [row.symbol, {
    ...row,
    theme: row.theme || row.snapshot?.theme || "Sin tematica",
    sector: row.sector || "Sin sector",
    industry: row.industry || "Sin industria",
    companyName: row.companyName || row.name || row.symbol,
  }])).values());
}

function avg(items, field) {
  const values = items.map((row) => row[field]).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function groupRows(rows, dimension) {
  const map = new Map();
  for (const row of rows) {
    const key = row[dimension] || "Sin dato";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => rowScore(b) - rowScore(a));
    const avgTotal = avg(items, "totalScore");
    const avgRs = avg(items, "rsRating");
    const avgWeaknessValues = items.map(weaknessScore).filter(Number.isFinite);
    const avgWeakness = avgWeaknessValues.length ? avgWeaknessValues.reduce((a, b) => a + b, 0) / avgWeaknessValues.length : null;
    const avg3m = avg(items, "perf3m");
    const avg6m = avg(items, "perf6m");
    const leaders = items.filter((row) => rowScore(row) >= 70 || (row.rsRating || 0) >= 75).length;
    const nearPivot = items.filter((row) => (row.distance20d ?? -999) >= -5 && (row.riskScore || 0) >= 50).length;
    const extended = items.filter((row) => (row.extSma50 ?? 0) >= 15 && rowScore(row) >= 70).length;
    const weak = items.filter((row) => weaknessScore(row) >= 60).length;
    const strength = clamp((avgTotal || 0) * .58 + (avgRs || 50) * .28 + clamp(avg3m || 0, -20, 40) * .35 + leaders * 4);
    return {
      key,
      items: sorted,
      count: items.length,
      avgTotal,
      avgRs,
      avgWeakness,
      avg3m,
      avg6m,
      leaders,
      nearPivot,
      extended,
      weak,
      strength,
      top: sorted.slice(0, 5),
    };
  }).sort((a, b) => b.strength - a.strength);
}

function listHref(dimension, key) {
  return `/lists?groupType=${encodeURIComponent(dimension)}&group=${encodeURIComponent(key)}`;
}

function dimensionLabel(dimension) {
  return { theme: "tematica", sector: "sector", industry: "industria" }[dimension] || dimension;
}

function filterGroupsByStrength(groups = [], filter = "all") {
  const filtered = groups.filter((group) => {
    if (filter === "leaders") return group.strength >= 70;
    if (filter === "constructive") return group.strength >= 55 && group.strength < 70;
    if (filter === "weak") return group.strength < 55;
    if (filter === "veryWeak") return group.strength < 40;
    return true;
  });
  if (filter === "weak" || filter === "veryWeak") return [...filtered].sort((a, b) => a.strength - b.strength);
  return filtered;
}

function EmptySectorState({ favoritesCount }) {
  return <section className="card emptyState">
    <div className="sectionTitle"><h2>Sin mapa todavia</h2><span className="fine">Necesita un snapshot o favoritos con score</span></div>
    <p className="muted">Guarda un snapshot desde el screener o usa favoritos como fallback.</p>
    <div className="dataIssueGrid">
      <div className="dataIssue"><b>1. Ejecuta screener</b><strong>Scan</strong><p>Carga universo, elige preset y pulsa Ejecutar.</p><span>Mejor con Balanceado, Lideres estrictos o Near Pivot.</span></div>
      <div className="dataIssue"><b>2. Guarda snapshot</b><strong>Save</strong><p>Usa Guardar snapshot cuando aparezcan candidatas.</p><span>El mapa sectorial lee `statsedge.scans.v1`.</span></div>
      <div className="dataIssue"><b>3. Fallback</b><strong>{favoritesCount}</strong><p>Favoritos disponibles para agrupar si no hay snapshot.</p><span>Un favorito sin snapshot tiene menos metricas.</span></div>
    </div>
    <div className="controls">
      <a className="btn btnPrimary" href="/">Ir al screener</a>
      <a className="btn" href="/review?source=latest">Vista rapida</a>
      <a className="btn" href="/research-desk">Ver Research Desk</a>
      <a className="btn" href="/lists">Ver listas</a>
    </div>
  </section>;
}

function GroupCard({ group, active, onClick }) {
  return <button type="button" className={`groupCard ${active ? "active" : ""}`} onClick={onClick}>
    <span className="groupCardTop"><b>{group.key}</b><em>{group.count} acciones</em></span>
    <span className="strengthBar"><i style={{ width: `${group.strength}%` }} /></span>
    <span className="groupStats">
      <span><b>Score</b>{num(group.avgTotal)}</span>
      <span><b>RS</b>{num(group.avgRs)}</span>
      <span><b>3M</b>{pct(group.avg3m)}</span>
      <span><b>Debiles</b>{group.weak}</span>
    </span>
    <small>Top: {group.top.map((row) => row.symbol).join(", ") || "Sin dato"}</small>
  </button>;
}

export default function SectorsPage() {
  const [scans, setScans] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [dimension, setDimension] = useState("theme");
  const [strengthFilter, setStrengthFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("Todos");
  const [active, setActive] = useState("");
  const [scanId, setScanId] = useState("");

  function reloadLocal() {
    const nextScans = safeRead(STORAGE_KEYS.scans, []);
    const nextFavorites = safeRead(STORAGE_KEYS.favorites, []);
    setScans(nextScans);
    setFavorites(nextFavorites);
    if (!scanId && nextScans[0]) setScanId(nextScans[0].id);
  }

  useEffect(() => { reloadLocal(); }, []);

  const selectedScan = useMemo(() => scans.find((scan) => scan.id === scanId) || scans[0] || null, [scans, scanId]);
  const snapshotRows = useMemo(() => cleanRows(selectedScan?.rows || []), [selectedScan]);
  const fallbackRows = useMemo(() => cleanRows(favoriteRows(favorites)), [favorites]);
  const baseRows = snapshotRows.length ? snapshotRows : fallbackRows;
  const countryOptions = useMemo(() => {
    const map = new Map();
    baseRows.forEach((row) => {
      const code = rowCountry(row);
      map.set(code, (map.get(code) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count }));
  }, [baseRows]);
  const rows = useMemo(() => countryFilter === "Todos" ? baseRows : baseRows.filter((row) => rowCountry(row) === countryFilter), [baseRows, countryFilter]);
  const sourceLabel = snapshotRows.length ? `Snapshot · ${new Date(selectedScan.createdAt).toLocaleString()}` : fallbackRows.length ? "Favoritos guardados" : "Sin datos locales";
  const groups = useMemo(() => groupRows(rows, dimension), [rows, dimension]);
  const filteredGroups = useMemo(() => filterGroupsByStrength(groups, strengthFilter), [groups, strengthFilter]);
  const selected = filteredGroups.find((group) => group.key === active) || filteredGroups[0] || null;
  const weakestGroup = groups.length ? [...groups].sort((a, b) => a.strength - b.strength)[0] : null;

  useEffect(() => {
    if (countryFilter !== "Todos" && !countryOptions.some((item) => item.code === countryFilter)) {
      setCountryFilter("Todos");
    }
  }, [countryFilter, countryOptions]);

  return <main className="page">
    <section className="card hero">
      <div className="heroTop">
        <div>
          <div className="badge">STATS EDGE · Sector Map</div>
          <h1>Sectores y tematicas</h1>
          <p className="muted">Ranking por tematica, sector e industria desde snapshot/favoritos.</p>
        </div>
        <div className="mobileActions">
          <a className="btn" href="/">Screener</a>
          <a className="btn" href="/lists">Listas</a>
          <a className="btn" href="/review?source=latest">Vista rapida</a>
          <a className="btn btnPrimary" href="/research-desk">Research</a>
          <button className="btn" onClick={reloadLocal}>Recargar local</button>
        </div>
      </div>
    </section>

    <section className="card">
      <div className="kpis">
        <div className="kpi"><b>{groups.length}</b><span>grupos</span></div>
        <div className="kpi"><b>{rows.length}</b><span>{snapshotRows.length ? "acciones en snapshot" : "favoritos agrupados"}</span></div>
        <div className="kpi"><b>{groups[0]?.key || "-"}</b><span>grupo lider</span></div>
        <div className="kpi"><b>{weakestGroup?.key || "-"}</b><span>grupo debil</span></div>
      </div>
      <div className="sectorToolbar">
        <label className="field">
          <span>Fuente</span>
          <select className="select" value={scanId} onChange={(event) => setScanId(event.target.value)} disabled={!scans.length}>
            {scans.length ? scans.map((scan) => <option value={scan.id} key={scan.id}>{scan.name || new Date(scan.createdAt).toLocaleString()}</option>) : <option value="">Sin snapshots</option>}
          </select>
        </label>
        <label className="field">
          <span>País</span>
          <select className="select" value={countryFilter} onChange={(event) => { setCountryFilter(event.target.value); setActive(""); }} disabled={!baseRows.length}>
            <option value="Todos">🌐 Todos los países</option>
            {countryOptions.map((item) => <option value={item.code} key={item.code}>
              {marketFlag(item.code)} {item.code} · {countryName(item.code)} · {item.count}
            </option>)}
          </select>
        </label>
        <span className="dataNote">{sourceLabel}</span>
      </div>
    </section>

    <section className="card">
      <h2>Agrupar por</h2>
      <div className="controls">
        {[["theme", "Tematica"], ["sector", "Sector"], ["industry", "Industria"]].map(([key, label]) => <button key={key} className={`btn ${dimension === key ? "btnActive" : ""}`} onClick={() => { setDimension(key); setActive(""); }}>{label}</button>)}
      </div>
      <h2 style={{ marginTop: 18 }}>Filtrar fuerza</h2>
      <div className="controls">
        {STRENGTH_FILTERS.map(([key, label]) => <button key={key} className={`btn ${strengthFilter === key ? "btnActive" : ""}`} onClick={() => { setStrengthFilter(key); setActive(""); }}>{label}</button>)}
      </div>
    </section>

    {!rows.length && <EmptySectorState favoritesCount={favorites.length} />}

    {rows.length > 0 && <section className="sectorMapLayout">
      <div className="card">
        <div className="sectionTitle"><h2>Mapa de grupos</h2><span className="fine">Ranking por fuerza compuesta</span></div>
        <div className="groupMap">
          {filteredGroups.map((group) => <GroupCard key={group.key} group={group} active={group.key === selected?.key} onClick={() => setActive(group.key)} />)}
          {!filteredGroups.length && <div className="dataNote">No hay grupos en este rango de fuerza. Cambia el filtro o guarda un snapshot mas amplio.</div>}
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle"><h2>Lectura rapida <InfoHint text="Fuerza compuesta local: score medio, RS, momentum 3M y numero de lideres del snapshot. Los grupos debiles se ordenan de peor a menos debil." /></h2><span className="fine">{dimensionLabel(dimension)}</span></div>
        {selected && <>
          <div className="quickMetricGrid">
            <span><b>Grupo</b>{selected.key}</span>
            <span><b>Fuerza</b>{num(selected.strength)}</span>
            <span><b>Score</b>{num(selected.avgTotal)}</span>
            <span><b>RS</b>{num(selected.avgRs)}</span>
            <span><b>3M</b>{pct(selected.avg3m)}</span>
            <span><b>6M</b>{pct(selected.avg6m)}</span>
            <span><b>Near pivot</b>{selected.nearPivot}</span>
            <span><b>Extendidas</b>{selected.extended}</span>
            <span><b>Deterioro</b>{selected.weak}</span>
            <span><b>Weak medio</b>{num(selected.avgWeakness)}</span>
          </div>
          <div className="controls" style={{ marginTop: 12 }}>
            <a className="btn btnPrimary" href={listHref(dimension, selected.key)}>Saltar a lista filtrada</a>
            <a className="btn" href="/">Nuevo scan</a>
          </div>
        </>}
      </div>
    </section>}

    {selected && <section className="card">
      <div className="sectionTitle"><h2>Lideres de {selected.key}</h2><span className="fine">{selected.items.length} acciones</span></div>
      <div className="tableWrap">
        <table className="table">
          <thead><tr>{["Ticker", "Empresa", "País", "Temática", "Sector", "Industria", "RS", "Weak", "3M", "6M", "52w", "SMA50", "Weinstein", "Minervini", "Risk", "Total", "Acciones"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>{selected.items.slice(0, 40).map((row) => <tr key={row.symbol}>
            <td><a className="ticker" href={stockUrl(row.symbol)}>{row.symbol}</a></td>
            <td>{row.companyName}<br /><span className="fine">{shortBusiness(row)}</span></td>
            <td><span className="countryCell"><i>{marketFlag(rowCountry(row))}</i><b>{rowCountry(row)}</b></span></td>
            <td><span className="pill">{row.theme}</span></td>
            <td>{row.sector || "Sin dato"}</td>
            <td>{row.industry || "Sin dato"}</td>
            <td className="ticker">{num(row.rsRating)}</td>
            <td>{num(weaknessScore(row))}</td>
            <td>{pct(row.perf3m)}</td>
            <td>{pct(row.perf6m)}</td>
            <td>{pct(row.distance52w)}</td>
            <td>{pct(row.extSma50)}</td>
            <td>{num(row.weinsteinScore)}</td>
            <td>{num(row.minerviniScore)}</td>
            <td>{num(row.riskScore)}</td>
            <td className="ticker">{num(row.totalScore)}</td>
            <td><div className="actionCell"><a className="btn btnSmall btnPrimary" href={stockUrl(row.symbol)}>Ficha</a><a className="btn btnSmall" href={externalLinks(row.symbol, row.exchange).tradingView} target="_blank" rel="noreferrer">TV</a></div></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}
  </main>;
}
