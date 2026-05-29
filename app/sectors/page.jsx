"use client";
import { useEffect, useMemo, useState } from "react";
import { num, pct } from "@/lib/formatters";
import { filterGroupsByStrength, groupRows, STRENGTH_FILTERS } from "@/lib/grouping";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { favoriteToRow, normalizeStockRows, rowCountry, shortBusiness, weaknessScore } from "@/lib/stockRows";
import { countryName, externalLinks, marketFlag, stockUrl } from "@/lib/symbols";

function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span>i</span>
    <em>{text}</em>
  </span>;
}

function listHref(dimension, key) {
  return `/lists?groupType=${encodeURIComponent(dimension)}&group=${encodeURIComponent(key)}`;
}

function dimensionLabel(dimension) {
  return { theme: "tematica", sector: "sector", industry: "industria" }[dimension] || dimension;
}

function listText(items = []) {
  return items?.length ? items.join(", ") : "-";
}

function sectorStateClass(value = "") {
  const text = String(value).toLowerCase();
  if (text.includes("bull") || text.includes("alc") || text.includes("construct")) return "bullish";
  if (text.includes("bear") || text.includes("baj") || text.includes("debil") || text.includes("deterior")) return "bearish";
  return "neutral";
}

function MarketSectorOverview({ data, error }) {
  const sectors = data?.sectorTape || [];
  const summary = data?.sectorSummary || {};
  const sorted = [...sectors].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return <section className="sectorOverview">
    <div className="sectionTitle">
      <h2>Estado sectorial</h2>
      <span className="fine">Mercado · 1D / 1W / 1M / 3M</span>
    </div>

    {!data && !error && <div className="dataNote">Cargando comparativa sectorial...</div>}
    {error && <div className="dataNote">Proveedor no disponible: {error}</div>}

    {!!sectors.length && <>
      <div className="kpis">
        <div className="kpi"><b>{num(data.marketScore)}</b><span>market score</span></div>
        <div className="kpi"><b>{data.regime || "-"}</b><span>regimen</span></div>
        <div className="kpi"><b>{num(summary.avgScore)}</b><span>score medio</span></div>
        <div className="kpi"><b>{summary.above50 ?? "-"}/{summary.count ?? "-"}</b><span>sobre SMA50</span></div>
        <div className="kpi"><b>{summary.best1m || "-"}</b><span>mejor 1M</span></div>
        <div className="kpi"><b>{summary.worst1m || "-"}</b><span>peor 1M</span></div>
      </div>

      <div className="sectorPulse compact">
        <div><b>Lideres</b><span>{listText(summary.leaders)}</span></div>
        <div><b>Debiles</b><span>{listText(summary.laggards)}</span></div>
      </div>

      <div className="tableWrap sectorOverviewTable">
        <table className="table sectorTapeTable">
          <thead><tr>{["Sector", "ETF", "Estado", "Score", metricShortLabel("weinsteinScore"), metricShortLabel("stage"), "1D", "1W", "1M", "3M", "RS 1M", "SMA50", "SMA200", "Dist/Acc", "52w"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>{sorted.map((sector) => <tr key={sector.symbol}>
            <td><b>{sector.name}</b><br /><span className="fine">{sector.group}</span></td>
            <td className="ticker">{sector.symbol}</td>
            <td><i className={`sentimentPill ${sectorStateClass(sector.state?.bias || sector.state?.label)}`}>{sector.state?.label || "-"}</i></td>
            <td className="ticker">{num(sector.score)}</td>
            <td>{num(sector.weinsteinScore)}</td>
            <td>{sector.stage30w || "-"}</td>
            <td>{pct(sector.perf1d)}</td>
            <td>{pct(sector.perf1w)}</td>
            <td>{pct(sector.perf1m)}</td>
            <td>{pct(sector.perf3m)}</td>
            <td>{pct(sector.rs1m)}</td>
            <td>{sector.price > sector.sma50 ? "Si" : "No"}</td>
            <td>{sector.price > sector.sma200 ? "Si" : "No"}</td>
            <td>{Number.isFinite(sector.distributionDays20) ? `${sector.distributionDays20}/${sector.accumulationDays20}` : "-"}</td>
            <td>{pct(sector.distance52w)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="fine sectorCoverageNote">Proxy inicial mediante ETFs sectoriales USA. La capa por snapshot cubre Europa, Hong Kong, Japon y el resto de mercados cuando hay resultados guardados.</p>
    </>}
  </section>;
}

function GroupCard({ group, active, onClick }) {
  return <button type="button" className={`groupCard ${active ? "active" : ""}`} onClick={onClick}>
    <span className="groupCardTop"><b>{group.key}</b><em>{group.count} acciones</em></span>
    <span className="strengthBar"><i style={{ width: `${group.strength}%` }} /></span>
    <span className="groupStats">
      <span><b>{metricShortLabel("totalScore")}</b>{num(group.avgTotal)}</span>
      <span><b>{metricShortLabel("rsGlobalPct")}</b>{num(group.avgRs)}</span>
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
  const [marketHealth, setMarketHealth] = useState(null);
  const [marketHealthError, setMarketHealthError] = useState("");

  function reloadLocal() {
    const nextScans = safeRead(STORAGE_KEYS.scans, []);
    const nextFavorites = safeRead(STORAGE_KEYS.favorites, []);
    setScans(nextScans);
    setFavorites(nextFavorites);
    if (!scanId && nextScans[0]) setScanId(nextScans[0].id);
  }

  useEffect(() => { reloadLocal(); }, []);
  useEffect(() => {
    let alive = true;
    fetch("/api/market-health").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload;
    }).then((payload) => {
      if (alive) setMarketHealth(payload);
    }).catch((error) => {
      if (alive) setMarketHealthError(error.message || "Sin respuesta");
    });
    return () => { alive = false; };
  }, []);

  const selectedScan = useMemo(() => scans.find((scan) => scan.id === scanId) || scans[0] || null, [scans, scanId]);
  const snapshotRows = useMemo(() => normalizeStockRows(selectedScan?.rows || []), [selectedScan]);
  const fallbackRows = useMemo(() => normalizeStockRows(favorites.map(favoriteToRow)), [favorites]);
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

  return <main className="page sectorsPage">
    <section className="card hero">
      <div className="heroTop">
        <div>
          <div className="badge">StageRadar · Sectores</div>
          <h1>Sectores y temáticas</h1>
          <p className="muted">Ranking por temática, sector e industria desde snapshot/favoritos.</p>
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

    {!rows.length && <MarketSectorOverview data={marketHealth} error={marketHealthError} />}

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
            <span><b>{metricShortLabel("totalScore")}</b>{num(selected.avgTotal)}</span>
            <span><b>{metricShortLabel("rsGlobalPct")}</b>{num(selected.avgRs)}</span>
            <span><b>3M</b>{pct(selected.avg3m)}</span>
            <span><b>6M</b>{pct(selected.avg6m)}</span>
            <span><b>Near pivot</b>{selected.nearPivot}</span>
            <span><b>Extendidas</b>{selected.extended}</span>
            <span><b>Deterioro</b>{selected.weak}</span>
            <span><b>Deterioro medio</b>{num(selected.avgWeakness)}</span>
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
          <thead><tr>{["Ticker", "Empresa", "País", "Temática", "Sector", "Industria", metricShortLabel("rsGlobalPct"), metricShortLabel("weaknessScore"), "3M", "6M", "52w", "SMA50", metricShortLabel("weinsteinScore"), metricShortLabel("minerviniScore"), metricShortLabel("riskScore"), metricShortLabel("totalScore"), "Acciones"].map((head) => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>{selected.items.slice(0, 40).map((row) => <tr key={row.symbol}>
            <td><a className="ticker" href={stockUrl(row.symbol)}>{row.symbol}</a></td>
            <td>{row.companyName}<br /><span className="fine">{shortBusiness(row)}</span></td>
            <td><span className="countryCell"><i>{marketFlag(rowCountry(row))}</i><b>{rowCountry(row)}</b></span></td>
            <td><span className="pill">{row.theme}</span></td>
            <td>{row.sector || "Sin dato"}</td>
            <td>{row.industry || "Sin dato"}</td>
            <td className="ticker">{num(row.rsGlobalPct)}</td>
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
