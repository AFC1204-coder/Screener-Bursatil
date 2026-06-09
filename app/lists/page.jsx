"use client";
import { useEffect, useMemo, useState } from "react";
import { num, pct, pctShare } from "@/lib/formatters";
import { auditIssueLabels, buildCoverageAudit } from "@/lib/discoveryAudit";
import { buildSavedListView, listViewHref, listViewSignature, normalizeListScope, normalizeSavedListViews, savedListViewMetaLine } from "@/lib/listViews";
import { enforceListContractRows, listContractForKey, listInclusionSummary, rowPassesListContract, summarizeListReliability } from "@/lib/listRationale";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { favoriteToRow, isLongOpportunityRow, metricValue, normalizeStockRows, shortBusiness, sortByMetric, uniqueRows, weaknessScore } from "@/lib/stockRows";
import { stockUrl } from "@/lib/symbols";

async function fetchJsonWithTimeout(path, timeoutMs = 16000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { signal: controller.signal, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function hasOwn(obj = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span aria-hidden="true">i</span>
    <em aria-hidden="true">{text}</em>
  </span>;
}

function scopedDiscoveryPath(filter = {}) {
  const params = new URLSearchParams({
    limit: "25",
    groupItemLimit: "12",
    groupsLimit: "45",
    maxRows: "8000",
    sinceDays: "45",
  });
  if (filter.groupType && filter.group) {
    params.set("groupType", filter.groupType);
    params.set("group", filter.group);
  }
  return `/api/discovery?${params.toString()}`;
}

function DiscoveryHealthPanel({ data, error, loading, usingDiscovery, localRows, filter }) {
  const health = data?.health || {};
  const status = loading ? "" : usingDiscovery ? (health.state === "pass" ? "pass" : "warn") : "warn";
  const scope = filter?.group ? `${filter.groupType}: ${filter.group}` : "Global";
  const source = loading ? "Actualizando discovery" : usingDiscovery ? health.sourceLabel || "Discovery API" : "Snapshot local";
  const note = loading
    ? "Vista provisional desde snapshot local; los conteos y rankings se actualizarán al terminar Discovery."
    : error ? `Discovery API no disponible: ${error}` : usingDiscovery ? health.note : "Usando snapshots/favoritos locales hasta tener scans persistidos suficientes.";

  return <section className="card discoveryHealthPanel">
    <div className="sectionTitle">
      <h2>Fiabilidad discovery</h2>
      <span className={`discoveryStatus ${status}`}>{source}</span>
    </div>
    <div className="discoveryHealthGrid">
      <span><b>{usingDiscovery ? health.rows ?? 0 : localRows}</b><em>filas ranking</em></span>
      <span><b>{usingDiscovery ? health.staleRows ?? 0 : "-"}</b><em>precio viejo</em></span>
      <span><b>{usingDiscovery ? health.lowCoverageRows ?? 0 : "-"}</b><em>cobertura baja</em></span>
      <span><b>{usingDiscovery ? health.missingTaxonomyRows ?? 0 : "-"}</b><em>taxonomía incompleta</em></span>
      <span><b>{usingDiscovery ? health.planClaims ?? 0 : "-"}</b><em>planes VCP</em></span>
      <span><b>{scope}</b><em>alcance</em></span>
    </div>
    <p className="fine">{note}</p>
  </section>;
}

function SavedListViewsPanel({ views, currentSignature, onSave, onDelete }) {
  return <section className="card savedListViewsPanel">
    <div className="sectionTitle">
      <h2>Vistas guardadas</h2>
      <button className="btn btnSmall btnPrimary" type="button" onClick={onSave}>Guardar vista</button>
    </div>
    <div className="savedListViews">
      {views.map((view) => <div className={`savedListView ${view.signature === currentSignature ? "active" : ""}`} key={view.id}>
        <a href={listViewHref(view)}><b>{view.name}</b><span>{savedListViewMetaLine(view)}</span></a>
        <button className="btn btnSmall" type="button" onClick={() => onDelete(view.id)}>Borrar</button>
      </div>)}
      {!views.length && <div className="dataNote">Sin vistas guardadas.</div>}
    </div>
  </section>;
}

function CoverageAuditPanel({ audit }) {
  if (!audit) return null;
  const status = audit.state === "pass" ? "pass" : audit.state === "empty" ? "" : "warn";
  const issues = auditIssueLabels(audit, 5);
  const topMarkets = audit.topMarkets || [];
  const topSectors = audit.topSectors || [];
  const hasCoverageInput = (audit.universeRows ?? 0) > 0 || (audit.rankedRows ?? 0) > 0;

  return <section className="card coverageAuditPanel">
    <div className="sectionTitle">
      <h2>Auditoria cobertura</h2>
      <span className={`discoveryStatus ${status}`}>{audit.label || "Sin auditoria"}</span>
    </div>
    <div className="coverageAuditGrid">
      <span><b>{audit.universeRows ?? 0}</b><em>universo scope</em></span>
      <span><b>{audit.rankedRows ?? 0}</b><em>rankeadas</em></span>
      <span><b>{pctShare(audit.rankingCoveragePct ?? 0, 1)}</b><em>cobertura ranking</em></span>
      <span><b>{audit.rankedMarketCount ?? 0}/{audit.marketCount ?? 0}</b><em>mercados ranking</em></span>
      <span><b>{hasCoverageInput ? audit.listHealth?.emptyLists?.length ?? 0 : "-"}</b><em>listas vacias</em></span>
    </div>
    <div className="coverageAuditColumns">
      <div>
        <b>Mercados en ranking</b>
        <span>{topMarkets.length ? topMarkets.map((item) => `${item.key} ${pctShare(item.sharePct, 1)}`).join(" · ") : "Sin dato"}</span>
      </div>
      <div>
        <b>Sectores en ranking</b>
        <span>{topSectors.length ? topSectors.map((item) => `${item.key} ${pctShare(item.sharePct, 1)}`).join(" · ") : "Sin dato"}</span>
      </div>
      <div>
        <b>Alertas accionables</b>
        <span>{hasCoverageInput ? (issues.length ? issues.join(" · ") : "Sin alertas de sesgo relevantes") : "Sin universo suficiente"}</span>
      </div>
    </div>
    <p className="fine">{audit.note}</p>
  </section>;
}

function ListScopeSummary({ filter, rowsCount, rankingAppearances, activeRankingCount, savedView, useDiscovery, discoveryLoading }) {
  const scope = normalizeListScope(filter);
  const scopeRows = savedView?.counts?.scopeRows;
  const savedRows = savedView?.counts?.rows;
  const hasScopeRows = Number.isFinite(scopeRows) && scopeRows > 0;
  const hasLegacySavedRows = !hasScopeRows && Number.isFinite(savedRows) && savedRows > 0 && savedRows !== rowsCount;
  const source = discoveryLoading ? "Cargando" : useDiscovery ? "Discovery API" : "Snapshot local";
  const note = hasScopeRows && scopeRows !== rowsCount
    ? "El grupo completo puede contener mas acciones que los rankings visibles; Listas muestra candidatos unicos deduplicados por estrategia."
    : hasLegacySavedRows
      ? "El conteo guardado pertenece al alcance original de la vista; Listas muestra candidatos unicos deduplicados con los rankings actuales."
    : scope.group
      ? "Todos los rankings visibles aplican este mismo filtro de grupo."
      : "Vista global: los rankings se derivan del universo disponible sin filtro sectorial.";

  return <section className="card listScopeSummary">
    <div className="sectionTitle">
      <h2>Vista actual</h2>
      <span className={`discoveryStatus ${savedView ? "pass" : "warn"}`}>{savedView ? "Guardada" : "No guardada"}</span>
    </div>
    <div className="discoveryHealthGrid">
      <span><b>{scope.label}</b><em>scope</em></span>
      {hasScopeRows && <span><b>{scopeRows}</b><em>acciones en grupo</em></span>}
      {hasLegacySavedRows && <span><b>{savedRows}</b><em>conteo guardado</em></span>}
      <span><b>{rowsCount}</b><em>acciones unicas</em></span>
      <span><b>{rankingAppearances}</b><em>apariciones visibles</em></span>
      <span><b>{activeRankingCount}</b><em>listas con datos</em></span>
      <span><b>{source}</b><em>fuente</em></span>
    </div>
    <p className="fine">{note}</p>
  </section>;
}

function chartPath(points, key, x, y) {
  let open = false;
  return points.map((p, i) => {
    const value = p[key];
    if (!Number.isFinite(value)) {
      open = false;
      return "";
    }
    const cmd = open ? "L" : "M";
    open = true;
    return `${cmd}${x(i).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

function chartPreviewBars(b, limit = 96) {
  const asc = [...b].filter((x) => Number.isFinite(x.close)).reverse();
  const enriched = asc.map((bar, i) => {
    const windowAvg = (n) => i >= n - 1 ? avg(asc.slice(i - n + 1, i + 1).map((x) => x.close)) : null;
    return {
      date: bar.date,
      open: Number.isFinite(bar.open) ? bar.open : bar.close,
      high: Number.isFinite(bar.high) ? bar.high : bar.close,
      low: Number.isFinite(bar.low) ? bar.low : bar.close,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : 0,
      sma50: windowAvg(50),
      sma200: windowAvg(200),
    };
  });
  return enriched.slice(-limit);
}

function MiniSparkline({ bars = [] }) {
  const points = bars.filter((x) => Number.isFinite(x.close));
  if (points.length < 2) return <div className="previewEmpty" style={{ height: "44px", display: "grid", placeItems: "center" }}>Sin dato</div>;
  const w = 260, h = 118, pad = 10;
  const values = points.flatMap((p) => [p.close, p.sma50, p.sma200].filter(Number.isFinite));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, max * 0.02);
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => pad + (1 - ((v - min) / range)) * (h - pad * 2);
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const trendClass = last >= first ? "up" : "down";
  const volumeMax = Math.max(...points.map((p) => p.volume || 0), 1);
  const barW = Math.max(1.2, (w - pad * 2) / points.length - 1);
  return <svg className={`miniSparkline ${trendClass}`} style={{ width: "100%", height: "40px", display: "block" }} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grafico tecnico compacto">
    <line x1={pad} x2={w - pad} y1={y(max)} y2={y(max)} className="sparkGuide" />
    <line x1={pad} x2={w - pad} y1={y(min)} y2={y(min)} className="sparkGuide" />
    {points.map((p, i) => {
      const vh = Math.max(1, ((p.volume || 0) / volumeMax) * 20);
      return <rect key={`${p.date}-${i}`} x={x(i) - barW / 2} y={h - pad - vh} width={barW} height={vh} className="sparkVolume" />;
    })}
    <path d={chartPath(points, "sma200", x, y)} className="sparkMa sparkMa200" />
    <path d={chartPath(points, "sma50", x, y)} className="sparkMa sparkMa50" />
    <path d={chartPath(points, "close", x, y)} className="sparkPrice" />
    <circle cx={x(points.length - 1)} cy={y(last)} r="3.4" className="sparkLast" />
  </svg>;
}

function ListSparkline({ row, chartsCache }) {
  if (Array.isArray(row.chartPreview) && row.chartPreview.length >= 2) {
    return <MiniSparkline bars={row.chartPreview} />;
  }
  const cachedBars = chartsCache[row.symbol];
  if (Array.isArray(cachedBars) && cachedBars.length >= 2) {
    return <MiniSparkline bars={cachedBars} />;
  }
  if (chartsCache[row.symbol] === null) {
    return <div className="previewEmpty" style={{ height: "44px", display: "grid", placeItems: "center" }}>Sin gráfico</div>;
  }
  return (
    <div className="sparklineSkeleton">
      <div className="skeletonPulse"></div>
    </div>
  );
}

function queryState() {
  if (typeof window === "undefined") return { groupType: "", group: "" };
  const p = new URLSearchParams(window.location.search);
  return { groupType: p.get("groupType") || "", group: p.get("group") || "" };
}
function applyGroupFilter(rows, groupType, group) {
  if (!groupType || !group) return rows;
  return rows.filter((r) => String(r[groupType] || "") === group);
}

function ListContractNote({ listKey }) {
  const contract = listContractForKey(listKey);
  return <p className={`listContractNote ${contract.tone}`}><b>{contract.label}</b>{contract.text}</p>;
}

function ListReliabilityStrip({ summary, contractRejected = 0 }) {
  const safe = summary || summarizeListReliability([]);
  const displayed = contractRejected > 0
    ? {
        ...safe,
        state: safe.state === "warn" ? "warn" : "watch",
        label: "Contrato aplicado",
        note: `${contractRejected} filas excluidas por no cumplir el contrato visible de la lista.`,
      }
    : safe;
  return <div className={`listReliabilityStrip ${displayed.state}`}>
    <span className="listReliabilityMain"><b>{displayed.label}</b><em>{displayed.note}</em></span>
    <span><b>{safe.rows}</b><em>filas</em></span>
    <span><b>{safe.staleRows}</b><em>precio viejo</em></span>
    <span><b>{safe.lowCoverageRows}</b><em>cobertura baja</em></span>
    <span><b>{safe.dataLimitedRows}</b><em>datos limitados</em></span>
    <span><b>{contractRejected}</b><em>excluidas contrato</em></span>
  </div>;
}

function ListsEmptyState({ loading, hasSnapshot, discoveryError }) {
  const title = loading ? "Cargando rankings" : "Sin listas disponibles";
  const detail = loading
    ? "Se esta consultando discovery. Si no hay datos remotos, se usara el ultimo snapshot local."
    : hasSnapshot
      ? "Hay snapshot local, pero no genera candidatos visibles con los contratos actuales."
      : "Listas se alimenta de discovery o de snapshots guardados desde el screener.";
  const status = loading ? "Discovery" : discoveryError ? "Snapshot local" : hasSnapshot ? "Sin candidatos" : "Sin snapshot";
  return <section className="card listsEmptyState">
    <div className="emptyStateHead">
      <h2>{title} <InfoHint text={detail} /></h2>
      <span className="fine">{status}</span>
    </div>
    <div className="controls">
      <a className="btn btnPrimary" href="/">Screener</a>
      <a className="btn" href="/research-desk">Research</a>
    </div>
  </section>;
}

function MiniTable({ title, desc, rows, chartsCache, listKey = "leaders", scoreKey = "totalScore", collapsible = true, emptyLabel = "Sin datos todavia.", contractRejected = 0 }) {
  const visibleRows = rows.slice(0, 18);
  const reliability = summarizeListReliability(rows);
  const table = <div className="tableWrap">
    <table className="table">
      <thead><tr>{["Ticker", "Empresa", "Gráfico", "Tema", "3M", "52w", "SMA50", metricShortLabel("weinsteinScore"), metricShortLabel("minerviniScore"), metricShortLabel("rsQualityScore"), metricShortLabel("weaknessScore"), metricShortLabel("riskScore"), metricShortLabel("totalScore")].map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{visibleRows.map((r) => <tr key={r.symbol}>
        <td><a className="ticker" href={stockUrl(r.symbol)}>{r.symbol}</a></td>
        <td>{r.companyName || r.symbol}<br /><span className="fine">{shortBusiness(r)}</span><span className="listInclusionReason">{listInclusionSummary(r, listKey)}</span></td>
        <td className="compactSparkCell" style={{ width: "110px", minWidth: "110px", verticalAlign: "middle" }}>
          <ListSparkline row={r} chartsCache={chartsCache} />
        </td>
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
      </tr>)}{!rows.length && <tr><td colSpan="13">{emptyLabel}</td></tr>}</tbody>
    </table>
  </div>;
  const mobileRows = <div className="listMobileRows">
    {visibleRows.map((r) => <a className="listMobileRow" key={`${title}-${r.symbol}`} href={stockUrl(r.symbol)}>
      <div className="listMobileRowTop">
        <span><b>{r.symbol}</b><em>{r.companyName || r.symbol}</em></span>
        <strong>{num(Number.isFinite(metricValue(r, scoreKey)) ? metricValue(r, scoreKey) : r.snapshot?.totalScore)}</strong>
      </div>
      <div className="listMobileSpark"><ListSparkline row={r} chartsCache={chartsCache} /></div>
      <div className="listMobileFacts">
        <span>3M <b>{pct(r.perf3m ?? r.snapshot?.perf3m)}</b></span>
        <span>52w <b>{pct(r.distance52w)}</b></span>
        <span>RSQ <b>{num(r.rsQualityScore ?? r.snapshot?.rsQualityScore)}</b></span>
        <span>Riesgo <b>{num(r.riskScore ?? r.snapshot?.riskScore)}</b></span>
      </div>
      <p>{shortBusiness(r) || r.theme || r.snapshot?.theme || "Sin contexto"}</p>
      <span className="listMobileReason">{listInclusionSummary(r, listKey)}</span>
    </a>)}
    {!rows.length && <div className="listMobileEmpty">{emptyLabel}</div>}
  </div>;

  if (collapsible) {
    return <details className="card listDisclosure" open={visibleRows.length > 0}>
      <summary className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></summary>
      <ListContractNote listKey={listKey} />
      <ListReliabilityStrip summary={reliability} contractRejected={contractRejected} />
      {table}
      {mobileRows}
    </details>;
  }

  return <section className="card">
    <div className="sectionTitle"><h2>{title}</h2><span className="fine">{desc}</span></div>
    <ListContractNote listKey={listKey} />
    <ListReliabilityStrip summary={reliability} contractRejected={contractRejected} />
    {table}
    {mobileRows}
  </section>;
}

export default function ListsPage() {
  const [scans, setScans] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [filter, setFilter] = useState({ groupType: "", group: "" });
  const [chartsCache, setChartsCache] = useState({});
  const [discovery, setDiscovery] = useState(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [savedListViews, setSavedListViews] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const storedScans = safeRead(STORAGE_KEYS.scans, []);
    const loadedScans = (Array.isArray(storedScans) ? storedScans : []).filter((scan) => scan?.id !== "seed-scan-01");
    const loadedFavorites = safeRead(STORAGE_KEYS.favorites, []);
    const loadedListViews = normalizeSavedListViews(safeRead(STORAGE_KEYS.listViews, []));

    setScans(loadedScans);
    safeWrite(STORAGE_KEYS.scans, loadedScans);
    setFavorites(loadedFavorites);
    setSavedListViews(loadedListViews);
    setFilter(queryState());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return undefined;
    let alive = true;
    setDiscoveryError("");
    setDiscoveryLoading(true);
    fetchJsonWithTimeout(scopedDiscoveryPath(filter), 18000)
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
  }, [loaded, filter.groupType, filter.group]);

  const latest = scans[0];
  const localRows = useMemo(() => normalizeStockRows(uniqueRows(latest?.rows || [])), [latest]);
  const discoveryReady = discovery?.configured === true && !discoveryError;
  const discoveryRows = useMemo(() => normalizeStockRows(uniqueRows(discovery?.rows || [])), [discovery]);
  const useDiscovery = discoveryReady && discoveryRows.length > 0;
  const allRows = useMemo(() => useDiscovery ? discoveryRows : localRows, [useDiscovery, discoveryRows, localRows]);
  const rows = useMemo(() => applyGroupFilter(allRows, filter.groupType, filter.group), [allRows, filter]);
  const favoritesAsRows = useMemo(() => favorites.map(favoriteToRow), [favorites]);
  const discoveryListContracts = useMemo(() => Object.fromEntries((discovery?.lists || []).map((list) => {
    const normalizedRows = normalizeStockRows(list.items || []);
    return [list.key, enforceListContractRows(normalizedRows, list.key)];
  })), [discovery]);
  const discoveryListRows = useMemo(() => Object.fromEntries(Object.entries(discoveryListContracts).map(([key, result]) => [key, result.rows || []])), [discoveryListContracts]);
  const discoveryRejectedByKey = useMemo(() => Object.fromEntries(Object.entries(discoveryListContracts).map(([key, result]) => [key, result.rejectedCount || 0])), [discoveryListContracts]);
  const currentListViewSignature = listViewSignature(filter);
  const longRows = useMemo(() => rows.filter((row) => isLongOpportunityRow(row)), [rows]);
  const trendTemplateRows = useMemo(() => rows.filter((row) => isLongOpportunityRow(row, { requireTrendTemplate: true })), [rows]);

  const leaders = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "leaders") ? discoveryListRows.leaders : sortByMetric(longRows.filter((r) => rowPassesListContract(r, "leaders")), "totalScore"), [useDiscovery, discoveryListRows, longRows]);
  const rsQuality = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "rsQuality") ? discoveryListRows.rsQuality : sortByMetric(longRows.filter((r) => rowPassesListContract(r, "rsQuality")), "rsQualityScore"), [useDiscovery, discoveryListRows, longRows]);
  const weakness = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "weakness") ? discoveryListRows.weakness : sortByMetric(rows.filter((r) => rowPassesListContract(r, "weakness")), "weaknessScore"), [useDiscovery, discoveryListRows, rows]);
  const weinstein = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "weinstein") ? discoveryListRows.weinstein : sortByMetric(trendTemplateRows.filter((r) => rowPassesListContract(r, "weinstein")), "weinsteinScore"), [useDiscovery, discoveryListRows, trendTemplateRows]);
  const minervini = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "minervini") ? discoveryListRows.minervini : sortByMetric(trendTemplateRows.filter((r) => rowPassesListContract(r, "minervini")), "minerviniScore"), [useDiscovery, discoveryListRows, trendTemplateRows]);
  const nearPivot = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "nearPivot") ? discoveryListRows.nearPivot : longRows.filter((r) => rowPassesListContract(r, "nearPivot")).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [useDiscovery, discoveryListRows, longRows]);
  const ipo = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "ipo") ? discoveryListRows.ipo : longRows.filter((r) => rowPassesListContract(r, "ipo")).sort((a, b) => (b.ipoScore || 0) - (a.ipoScore || 0)), [useDiscovery, discoveryListRows, longRows]);
  const extended = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "extended") ? discoveryListRows.extended : longRows.filter((r) => rowPassesListContract(r, "extended")).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [useDiscovery, discoveryListRows, longRows]);
  const pullback = useMemo(() => useDiscovery && hasOwn(discoveryListRows, "pullback") ? discoveryListRows.pullback : longRows.filter((r) => rowPassesListContract(r, "pullback")).sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [useDiscovery, discoveryListRows, longRows]);
  const listSections = useMemo(() => [
    { key: "leaders", title: "Composite Leaders", desc: "Ranking principal", rows: leaders, contractRejected: discoveryRejectedByKey.leaders || 0 },
    { key: "rsQuality", title: "RS Quality Leaders", desc: "RS alto con volatilidad/drawdown controlados", rows: rsQuality, scoreKey: "rsQualityScore", contractRejected: discoveryRejectedByKey.rsQuality || 0 },
    { key: "weakness", title: "Deterioro técnico", desc: "Debilidad observable para evitar largos o estudiar cortos", rows: weakness, scoreKey: "weaknessScore", contractRejected: discoveryRejectedByKey.weakness || 0 },
    { key: "weinstein", title: "Weinstein Leaders", desc: "Mejor estructura de etapa/tendencia", rows: weinstein, scoreKey: "weinsteinScore", contractRejected: discoveryRejectedByKey.weinstein || 0 },
    { key: "minervini", title: "Minervini Leaders", desc: "Trend template, momentum y máximos", rows: minervini, scoreKey: "minerviniScore", contractRejected: discoveryRejectedByKey.minervini || 0 },
    { key: "nearPivot", title: "Vigilancia pivot", desc: "Setup observable cerca de pivot; no equivale a plan automático", rows: nearPivot, contractRejected: discoveryRejectedByKey.nearPivot || 0 },
    { key: "ipo", title: "IPO / New Leaders", desc: "Solo IPOs reales verificables <= 5 años", rows: ipo, scoreKey: "ipoScore", contractRejected: discoveryRejectedByKey.ipo || 0 },
    { key: "extended", title: "Extended but strong", desc: "Muy fuertes, pero vigilar extensión sobre SMA50", rows: extended, contractRejected: discoveryRejectedByKey.extended || 0 },
    { key: "pullback", title: "Pullback to SMA50", desc: "Líderes cerca de SMA50 para vigilancia", rows: pullback, contractRejected: discoveryRejectedByKey.pullback || 0 },
  ], [leaders, rsQuality, weakness, weinstein, minervini, nearPivot, ipo, extended, pullback, discoveryRejectedByKey]);
  const rankingAppearances = useMemo(() => listSections.reduce((sum, section) => sum + (section.rows || []).slice(0, 18).length, 0), [listSections]);
  const activeRankingCount = useMemo(() => listSections.filter((section) => (section.rows || []).length > 0).length, [listSections]);
  const activeSavedView = useMemo(() => savedListViews.find((view) => view.signature === currentListViewSignature) || null, [savedListViews, currentListViewSignature]);
  const hasAnyListRows = favoritesAsRows.length > 0 || listSections.some((section) => (section.rows || []).length > 0);
  const hasListSource = rows.length > 0 || favoritesAsRows.length > 0 || useDiscovery;
  const showListTables = hasListSource || hasAnyListRows;
  const showEmptyState = !showListTables;
  const coverageAudit = useMemo(() => {
    if (useDiscovery && discovery?.audit) return discovery.audit;
    return buildCoverageAudit({
      inputRows: rows,
      rankedRows: listSections.flatMap((section) => section.rows || []),
      lists: listSections,
      scopeType: filter.groupType || "global",
      scopeValue: filter.group || "",
    });
  }, [useDiscovery, discovery, rows, listSections, filter.groupType, filter.group]);

  // Recolectar todos los tickers visibles únicos en pantalla (top 18 de cada lista)
  const visibleTickers = useMemo(() => {
    const set = new Set();
    const addRows = (list) => {
      if (!Array.isArray(list)) return;
      list.slice(0, 18).forEach((r) => {
        if (r && r.symbol) set.add(r.symbol);
      });
    };
    addRows(favoritesAsRows);
    listSections.forEach((section) => addRows(section.rows));
    return Array.from(set);
  }, [favoritesAsRows, listSections]);

  // useEffect para descargar secuencialmente en lotes los sparklines de la API real
  useEffect(() => {
    if (!visibleTickers.length) return;
    let active = true;

    const fetchRealCharts = async () => {
      const neededTickers = visibleTickers.filter((symbol) => {
        // Si ya tiene chartPreview real de base de datos/scan anterior
        const rowFromScans = allRows.find(r => r.symbol === symbol) || favoritesAsRows.find(r => r.symbol === symbol);
        if (rowFromScans && Array.isArray(rowFromScans.chartPreview) && rowFromScans.chartPreview.length >= 2) {
          return false;
        }
        // Si ya está en nuestra caché reactiva
        if (chartsCache[symbol]) {
          return false;
        }
        return true;
      });

      if (!neededTickers.length) return;

      const batchSize = 4;
      for (let i = 0; i < neededTickers.length; i += batchSize) {
        if (!active) break;
        const batch = neededTickers.slice(i, i + batchSize);

        await Promise.all(batch.map(async (symbol) => {
          try {
            const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) {
              if (active) {
                setChartsCache((prev) => ({ ...prev, [symbol]: null })); // Indicar error para usar fallback armónico
              }
              return;
            }
            const data = await res.json();
            const rawBars = data.bars || [];
            if (rawBars.length >= 2) {
              const preview = chartPreviewBars(rawBars);
              if (active) {
                setChartsCache((prev) => ({
                  ...prev,
                  [symbol]: preview
                }));
              }
            } else {
              if (active) {
                setChartsCache((prev) => ({ ...prev, [symbol]: null }));
              }
            }
          } catch (e) {
            console.error(`Error al cargar grafico real para ${symbol}:`, e);
            if (active) {
              setChartsCache((prev) => ({ ...prev, [symbol]: null }));
            }
          }
        }));
      }
    };

    fetchRealCharts();
    return () => {
      active = false;
    };
  }, [visibleTickers, allRows, favoritesAsRows]);

  function persistSavedListViews(nextViews = []) {
    const normalized = normalizeSavedListViews(nextViews);
    setSavedListViews(normalized);
    safeWrite(STORAGE_KEYS.listViews, normalized);
    return normalized;
  }

  function saveCurrentListView() {
    const now = new Date().toISOString();
    const draft = buildSavedListView({ filter, discovery, usingDiscovery: useDiscovery, localRows: localRows.length, now, id: currentListViewSignature });
    const updated = {
      ...draft,
      id: currentListViewSignature,
      updatedAt: now,
      savedAt: savedListViews.find((view) => view.signature === currentListViewSignature)?.savedAt || now,
    };
    persistSavedListViews([updated, ...savedListViews.filter((view) => view.signature !== currentListViewSignature)]);
  }

  function deleteSavedListView(id) {
    persistSavedListViews(savedListViews.filter((view) => view.id !== id));
  }

  return <main className="page listsPage">
    <style>{`
      @keyframes sparklinePulse {
        0% { opacity: 0.35; }
        50% { opacity: 0.75; }
        100% { opacity: 0.35; }
      }
      .sparklineSkeleton {
        height: 38px;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(13, 27, 42, 0.4);
        border-radius: 4px;
        border: 1px dashed rgba(0, 82, 204, 0.15);
      }
      .skeletonPulse {
        height: 10px;
        width: 65px;
        background: rgba(0, 82, 204, 0.22);
        border-radius: 2px;
        animation: sparklinePulse 1.4s infinite ease-in-out;
      }
    `}</style>

    <section className="card hero">
      <div className="heroTop">
        <div><div className="badge">StageRadar · Listas</div><h1>Listas rápidas</h1><p className="muted">Líderes, favoritos y setups desde discovery derivado o snapshot local.</p></div>
        <div className="mobileActions"><a className="btn" href="/">Screener</a><a className="btn" href="/review?source=latest">Vista rapida</a><a className="btn" href="/ipo-radar">IPO Radar</a><a className="btn" href="/research-desk">Research</a><a className="btn btnPrimary" href="/sectors">Sectores</a></div>
      </div>
    </section>
    <section className="card"><div className="kpis"><div className="kpi"><b>{loaded ? rows.length : "-"}</b><span>acciones unicas</span></div><div className="kpi"><b>{loaded ? favorites.length : "-"}</b><span>favoritos</span></div><div className="kpi"><b>{discoveryLoading ? "..." : useDiscovery ? "API" : loaded ? "Local" : "-"}</b><span>fuente rankings</span></div><div className="kpi"><b>{loaded && latest ? new Date(latest.createdAt).toLocaleDateString() : "-"}</b><span>ultimo snapshot local</span></div></div></section>
    <DiscoveryHealthPanel data={discovery} error={discoveryError} loading={discoveryLoading} usingDiscovery={useDiscovery} localRows={localRows.length} filter={filter} />
    <CoverageAuditPanel audit={coverageAudit} />
    <ListScopeSummary filter={filter} rowsCount={rows.length} rankingAppearances={rankingAppearances} activeRankingCount={activeRankingCount} savedView={activeSavedView} useDiscovery={useDiscovery} discoveryLoading={discoveryLoading} />
    <SavedListViewsPanel views={savedListViews} currentSignature={currentListViewSignature} onSave={saveCurrentListView} onDelete={deleteSavedListView} />
    {filter.group && <section className="card status">Filtro activo: <b>{filter.groupType} = {filter.group}</b> · <a className="ticker" href="/lists">limpiar</a></section>}
    {showEmptyState ? <ListsEmptyState loading={!loaded || discoveryLoading} hasSnapshot={localRows.length > 0 || scans.length > 0} discoveryError={discoveryError} /> : <>
      {favoritesAsRows.length > 0 ? <MiniTable title="Favoritos" desc="Tu watchlist curada" rows={favoritesAsRows} chartsCache={chartsCache} listKey="favorites" collapsible={false} emptyLabel={loaded ? "Sin favoritos guardados." : "Cargando listas..."} /> : null}
      {listSections.map((section) => <MiniTable
        key={section.key}
        title={section.title}
        desc={section.desc}
        rows={section.rows}
        chartsCache={chartsCache}
        listKey={section.key}
        scoreKey={section.scoreKey || "totalScore"}
        contractRejected={section.contractRejected || 0}
        emptyLabel={loaded ? "Sin datos." : "Cargando listas..."}
      />)}
    </>}
  </main>;
}
