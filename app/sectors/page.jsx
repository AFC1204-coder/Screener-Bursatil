"use client";
import { useEffect, useMemo, useState } from "react";
import { authHeaders, getJson } from "@/lib/clientApi";
import { num, pct, pctShare } from "@/lib/formatters";
import { auditIssueLabels, buildCoverageAudit } from "@/lib/discoveryAudit";
import { filterGroupsByStrength, groupRows, STRENGTH_FILTERS } from "@/lib/grouping";
import { buildGroupListDrilldown } from "@/lib/listRationale";
import { buildSavedListView, listViewSignature, normalizeSavedListViews } from "@/lib/listViews";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";
import { favoriteToRow, normalizeStockRows, rowCountry, shortBusiness, weaknessScore } from "@/lib/stockRows";
import { countryName, externalLinks, marketFlag, stockUrl } from "@/lib/symbols";

async function fetchJsonWithTimeout(path, timeoutMs = 16000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { signal: controller.signal, cache: "no-store", headers: authHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span aria-hidden="true">i</span>
    <em aria-hidden="true">{text}</em>
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

function textLabel(value, fallback = "-") {
  if (typeof value === "string") return value || fallback;
  if (value && typeof value === "object") return value.label || value.name || value.key || value.stance || fallback;
  return value == null ? fallback : String(value);
}

function countRows(items = [], predicate = () => false) {
  return (Array.isArray(items) ? items : []).filter(predicate).length;
}

function rowHasValidPlanClaim(row = {}) {
  const display = methodologyDisplayForRow(row);
  return display.blocksPatternClaim !== true
    && display.dataLimited !== true
    && display.actionable === true
    && display.tradePlanEligible === true;
}

function groupDiscoverySnapshot(discovery = null, group = null) {
  const items = group?.items || [];
  const scopeRows = Number(group?.count || items.length || 0);
  return {
    generatedAt: discovery?.generatedAt || "",
    criteria: discovery?.criteria || {},
    health: {
      rows: items.length,
      scopeRows,
      listItemCount: items.length,
      staleRows: countRows(items, (row) => Boolean(row.priceFreshnessIssue)),
      planClaims: countRows(items, rowHasValidPlanClaim),
    },
  };
}

function groupRowsLabel(group = {}) {
  const sampleRows = Number(group?.items?.length || 0);
  const scopeRows = Number(group?.count || sampleRows || 0);
  if (scopeRows > sampleRows && sampleRows > 0) return `Top ${sampleRows} de ${scopeRows} acciones`;
  if (scopeRows > 0) return `${scopeRows} acciones`;
  return "Sin acciones";
}

function sectorStateClass(value = "") {
  const text = String(value).toLowerCase();
  if (text.includes("bull") || text.includes("alc") || text.includes("construct")) return "bullish";
  if (text.includes("bear") || text.includes("baj") || text.includes("debil") || text.includes("deterior")) return "bearish";
  return "neutral";
}

function DiscoveryHealthPanel({ data, error, loading, usingDiscovery, countryFilter, localRows, groupedRows, groupCount }) {
  const health = data?.health || {};
  const status = loading ? "" : usingDiscovery ? (health.state === "pass" ? "pass" : "warn") : "warn";
  const source = loading ? "Actualizando discovery" : usingDiscovery ? health.sourceLabel || "Discovery API" : "Snapshot local";
  const note = loading
    ? "Vista provisional desde snapshot local; los grupos y rankings se actualizarán al terminar Discovery."
    : error
      ? `Discovery API no disponible: ${error}`
      : usingDiscovery
        ? health.note
        : countryFilter !== "Todos"
          ? "Filtro de pais activo: usando snapshot local para no mezclar universos."
          : "Usando snapshot/favoritos locales hasta tener scans persistidos suficientes.";

  return <section className="card discoveryHealthPanel">
    <div className="sectionTitle">
      <h2>Fiabilidad sectorial</h2>
      <span className={`discoveryStatus ${status}`}>{source}</span>
    </div>
    <div className="discoveryHealthGrid">
      <span><b>{usingDiscovery ? groupedRows : localRows}</b><em>acciones agrupadas</em></span>
      <span><b>{usingDiscovery ? groupCount : "-"}</b><em>grupos visibles</em></span>
      <span><b>{usingDiscovery ? health.lowCoverageRows ?? 0 : "-"}</b><em>cobertura baja</em></span>
      <span><b>{usingDiscovery ? health.missingTaxonomyRows ?? 0 : "-"}</b><em>taxonomía incompleta</em></span>
      <span><b>{usingDiscovery ? health.planClaims ?? 0 : "-"}</b><em>planes VCP</em></span>
      <span><b>{countryFilter}</b><em>país</em></span>
    </div>
    <p className="fine">{note}</p>
  </section>;
}

function SectorCoverageAuditPanel({ audit, dimension }) {
  if (!audit) return null;
  const status = audit.state === "pass" ? "pass" : audit.state === "empty" ? "" : "warn";
  const issues = auditIssueLabels(audit, 5);
  const thinGroups = audit.groupHealth?.strongThinGroups?.length ? audit.groupHealth.strongThinGroups : audit.groupHealth?.thinGroups || [];

  return <section className="card coverageAuditPanel sectorCoverageAuditPanel">
    <div className="sectionTitle">
      <h2>Auditoria sector/listas</h2>
      <span className={`discoveryStatus ${status}`}>{audit.label || "Sin auditoria"}</span>
    </div>
    <div className="coverageAuditGrid">
      <span><b>{audit.universeRows ?? 0}</b><em>universo scope</em></span>
      <span><b>{audit.rankedRows ?? 0}</b><em>filas ranking</em></span>
      <span><b>{pctShare(audit.rankingCoveragePct ?? 0, 1)}</b><em>cobertura ranking</em></span>
      <span><b>{audit.rankedSectorCount ?? 0}/{audit.sectorCount ?? 0}</b><em>sectores ranking</em></span>
      <span><b>{thinGroups.length}</b><em>grupos muestra chica</em></span>
    </div>
    <div className="coverageAuditColumns">
      <div>
        <b>Mercados dominantes</b>
        <span>{audit.topMarkets?.length ? audit.topMarkets.map((item) => `${item.key} ${pctShare(item.sharePct, 1)}`).join(" · ") : "Sin dato"}</span>
      </div>
      <div>
        <b>{dimensionLabel(dimension)} con muestra chica</b>
        <span>{thinGroups.length ? thinGroups.slice(0, 5).map((item) => `${item.key} ${item.count}`).join(" · ") : "Sin alertas"}</span>
      </div>
      <div>
        <b>Accion recomendada</b>
        <span>{issues.length ? issues.join(" · ") : "Ranking sectorial sin sesgos fuertes detectados"}</span>
      </div>
    </div>
    <p className="fine">{audit.note}</p>
  </section>;
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
        <div className="kpi"><b>{textLabel(data.regime)}</b><span>regimen</span></div>
        <div className="kpi"><b>{num(summary.avgScore)}</b><span>score medio</span></div>
        <div className="kpi"><b>{summary.above50 ?? "-"}/{summary.count ?? "-"}</b><span>sobre SMA50</span></div>
        <div className="kpi"><b>{summary.best1m || "-"}</b><span>mejor 1M</span></div>
        <div className="kpi"><b>{summary.worst1m || "-"}</b><span>peor 1M</span></div>
      </div>

      <div className="sectorPulse compact">
        <div><b>Lideres</b><span>{listText(summary.leaders)}</span></div>
        <div><b>Débiles</b><span>{listText(summary.laggards)}</span></div>
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
      <span><b>Débiles</b>{group.weak}</span>
    </span>
    <small>Top: {group.top.map((row) => row.symbol).join(", ") || "Sin dato"}</small>
  </button>;
}

function GroupDrilldownPanel({ group, dimension }) {
  const hasContractDrilldown = Array.isArray(group?.contractDrilldown) && group.contractDrilldown.length > 0;
  const drilldown = hasContractDrilldown ? group.contractDrilldown : buildGroupListDrilldown(group?.items || []);
  const visible = drilldown.filter((bucket) => bucket.count > 0);
  const sampleLabel = groupRowsLabel(group);
  const contractScopeRows = Number(group?.contractScopeRows || group?.count || group?.items?.length || 0);
  const contractScopeLabel = hasContractDrilldown
    ? `${contractScopeRows} filas del grupo auditadas por contrato`
    : "Contratos calculados sobre la muestra visible";

  return <section className="card groupDrilldownPanel">
    <div className="sectionTitle">
      <h2>Drill-down de {group.key}</h2>
      <span className="fine">{sampleLabel} · contratos de Listas</span>
    </div>
    <div className={`groupContractScope ${hasContractDrilldown ? "pass" : "watch"}`}>
      <b>{hasContractDrilldown ? "Contratos completos" : "Muestra visible"}</b>
      <span>{contractScopeLabel}. Las sublistas alcistas excluyen deterioro técnico y bajismo estructural.</span>
    </div>
    <div className="groupDrilldownGrid">
      {drilldown.map((bucket) => <article className={`groupDrilldownCard ${bucket.tone}`} key={bucket.key}>
        <div className="groupDrilldownHead">
          <span><b>{bucket.title}</b><em>{bucket.label}</em></span>
          <strong>{bucket.count}</strong>
        </div>
        <div className={`groupDrilldownReliability ${bucket.reliability?.state || "empty"}`}>
          <b>{bucket.reliability?.label || "Sin datos"}</b>
          <span>{bucket.reliability?.rows || 0} filas · {bucket.reliability?.staleRows || 0} precio viejo · {bucket.reliability?.lowCoverageRows || 0} cobertura baja</span>
        </div>
        <p>{bucket.contract}</p>
        <div className="groupDrilldownSamples">
          {bucket.sample.map((item) => <a href={stockUrl(item.symbol)} key={`${bucket.key}-${item.symbol}`}>
            <b>{item.symbol}</b>
            <span>{item.reason || item.companyName}</span>
          </a>)}
          {!bucket.sample.length && <span className="dataNote">Sin candidatos coherentes en la muestra.</span>}
        </div>
      </article>)}
    </div>
    <div className="controls">
      <a className="btn btnPrimary" href={listHref(dimension, group.key)}>Abrir listas completas del grupo</a>
      <span className="fine">{visible.length ? `${visible.length} sublistas con candidatos coherentes.` : "La vista completa puede encontrar candidatos si el grupo tiene mas filas que la muestra."}</span>
    </div>
  </section>;
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
  const [discovery, setDiscovery] = useState(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [savedListViews, setSavedListViews] = useState([]);
  const [saveStatus, setSaveStatus] = useState("");

  function reloadLocal() {
    const nextScans = safeRead(STORAGE_KEYS.scans, []);
    const nextFavorites = safeRead(STORAGE_KEYS.favorites, []);
    const nextListViews = normalizeSavedListViews(safeRead(STORAGE_KEYS.listViews, []));
    setScans(nextScans);
    setFavorites(nextFavorites);
    setSavedListViews(nextListViews);
    if (!scanId && nextScans[0]) setScanId(nextScans[0].id);
  }

  useEffect(() => { reloadLocal(); }, []);
  useEffect(() => {
    let alive = true;
    getJson("/api/market-health").then((payload) => {
      if (alive) setMarketHealth(payload);
    }).catch((error) => {
      if (alive) setMarketHealthError(error.message || "Sin respuesta");
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    setDiscoveryError("");
    setDiscoveryLoading(true);
    fetchJsonWithTimeout("/api/discovery?limit=25&groupItemLimit=12&groupsLimit=60&maxRows=8000&sinceDays=45", 18000)
      .then((payload) => {
        if (alive) setDiscovery(payload);
      })
      .catch((error) => {
        if (!alive) return;
        setDiscovery(null);
        setDiscoveryError(error.name === "AbortError" ? "timeout" : error.message || "Sin respuesta");
      })
      .finally(() => {
        if (alive) setDiscoveryLoading(false);
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
  const discoveryGroups = discovery?.groups?.[dimension] || [];
  const useDiscoveryGroups = discovery?.configured === true && !discoveryError && countryFilter === "Todos" && discoveryGroups.length > 0;
  const groups = useMemo(() => useDiscoveryGroups ? discoveryGroups : groupRows(rows, dimension), [useDiscoveryGroups, discoveryGroups, rows, dimension]);
  const filteredGroups = useMemo(() => filterGroupsByStrength(groups, strengthFilter), [groups, strengthFilter]);
  const selected = filteredGroups.find((group) => group.key === active) || filteredGroups[0] || null;
  const weakestGroup = groups.length ? [...groups].sort((a, b) => a.strength - b.strength)[0] : null;
  const visibleRowsCount = useDiscoveryGroups ? groups.reduce((sum, group) => sum + (Number(group.count) || 0), 0) : rows.length;
  const selectedScope = selected ? { groupType: dimension, group: selected.key } : { groupType: "", group: "" };
  const selectedSignature = listViewSignature(selectedScope);
  const selectedSaved = selected ? savedListViews.some((view) => view.signature === selectedSignature) : false;
  const sectorSourceLabel = discoveryLoading
    ? "Cargando discovery derivado..."
    : useDiscoveryGroups
      ? `Discovery API · ${discovery?.generatedAt ? new Date(discovery.generatedAt).toLocaleString() : "scans persistidos"}`
      : sourceLabel;
  const coverageAudit = useMemo(() => {
    if (useDiscoveryGroups && discovery?.audit) return discovery.audit;
    return buildCoverageAudit({
      inputRows: rows,
      rankedRows: groups.flatMap((group) => group.items || []),
      groups: { [dimension]: groups },
    });
  }, [useDiscoveryGroups, discovery, rows, groups, dimension]);

  useEffect(() => {
    if (countryFilter !== "Todos" && !countryOptions.some((item) => item.code === countryFilter)) {
      setCountryFilter("Todos");
    }
  }, [countryFilter, countryOptions]);

  useEffect(() => {
    setSaveStatus("");
  }, [selectedSignature]);

  function persistSavedListViews(nextViews = []) {
    const normalized = normalizeSavedListViews(nextViews);
    setSavedListViews(normalized);
    safeWrite(STORAGE_KEYS.listViews, normalized);
    return normalized;
  }

  function saveSelectedGroupView() {
    if (!selected) return;
    const now = new Date().toISOString();
    const groupSnapshot = groupDiscoverySnapshot(discovery, selected);
    const draft = buildSavedListView({
      filter: selectedScope,
      discovery: groupSnapshot,
      usingDiscovery: useDiscoveryGroups,
      localRows: Number(selected.count || selected.items?.length || 0),
      now,
      id: selectedSignature,
    });
    const previous = savedListViews.find((view) => view.signature === selectedSignature);
    const updated = {
      ...draft,
      id: selectedSignature,
      savedAt: previous?.savedAt || now,
      updatedAt: now,
    };
    persistSavedListViews([updated, ...savedListViews.filter((view) => view.signature !== selectedSignature)]);
    setSaveStatus(`Vista guardada: ${updated.name}.`);
  }

  return <main className="page sectorsPage">
    <section className="card hero">
      <div className="heroTop">
        <div>
          <div className="badge">StageRadar · Sectores</div>
          <h1>Sectores y temáticas</h1>
          <p className="muted">Ranking por temática, sector e industria desde discovery derivado o snapshot local.</p>
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
        <div className="kpi"><b>{visibleRowsCount}</b><span>{useDiscoveryGroups ? "acciones derivadas" : snapshotRows.length ? "acciones en snapshot" : "favoritos agrupados"}</span></div>
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
        <span className="dataNote">{sectorSourceLabel}</span>
      </div>
    </section>

    <DiscoveryHealthPanel data={discovery} error={discoveryError} loading={discoveryLoading} usingDiscovery={useDiscoveryGroups} countryFilter={countryFilter} localRows={rows.length} groupedRows={visibleRowsCount} groupCount={groups.length} />
    <SectorCoverageAuditPanel audit={coverageAudit} dimension={dimension} />

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

    {!groups.length && <MarketSectorOverview data={marketHealth} error={marketHealthError} />}

    {groups.length > 0 && <section className="sectorMapLayout">
      <div className="card">
        <div className="sectionTitle"><h2>Mapa de grupos</h2><span className="fine">Ranking por fuerza compuesta</span></div>
        <div className="groupMap">
          {filteredGroups.map((group) => <GroupCard key={group.key} group={group} active={group.key === selected?.key} onClick={() => setActive(group.key)} />)}
          {!filteredGroups.length && <div className="dataNote">No hay grupos en este rango de fuerza. Cambia el filtro o guarda un snapshot más amplio.</div>}
        </div>
      </div>

      <div className="card">
        <div className="sectionTitle"><h2>Lectura rápida <InfoHint text="Fuerza compuesta local: score medio, RS, momentum 3M y número de líderes del snapshot. Los grupos débiles se ordenan de peor a menos débil." /></h2><span className="fine">{dimensionLabel(dimension)}</span></div>
        {selected && <>
          <div className="quickMetricGrid">
            <span><b>Grupo</b>{selected.key}</span>
            <span><b>Fuerza</b>{num(selected.strength)}</span>
            <span><b>{metricShortLabel("totalScore")}</b>{num(selected.avgTotal)}</span>
            <span><b>{metricShortLabel("rsGlobalPct")}</b>{num(selected.avgRs)}</span>
            <span><b>3M</b>{pct(selected.avg3m)}</span>
            <span><b>6M</b>{pct(selected.avg6m)}</span>
            <span><b>Vigilancia pivot</b>{selected.pivotWatch ?? selected.nearPivot}</span>
            <span><b>Extendidas</b>{selected.extended}</span>
            <span><b>Deterioro</b>{selected.weak}</span>
            <span><b>Deterioro medio</b>{num(selected.avgWeakness)}</span>
          </div>
          <div className="controls" style={{ marginTop: 12 }}>
            <a className="btn btnPrimary" href={listHref(dimension, selected.key)}>Saltar a lista filtrada</a>
            <button className="btn" type="button" onClick={saveSelectedGroupView}>{selectedSaved ? "Actualizar vista" : "Guardar vista"}</button>
            <a className="btn" href="/">Nuevo scan</a>
          </div>
          {(saveStatus || selectedSaved) && <p className="fine sectorSavedViewNote">{saveStatus || "Este grupo ya esta guardado como vista."}</p>}
        </>}
      </div>
    </section>}

    {selected && <GroupDrilldownPanel group={selected} dimension={dimension} />}

    {selected && <section className="card">
      <div className="sectionTitle"><h2>Lideres de {selected.key}</h2><span className="fine">{groupRowsLabel(selected)}</span></div>
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
