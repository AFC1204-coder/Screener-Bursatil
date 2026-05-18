"use client";
import { useEffect, useMemo, useState } from "react";
import { deleteFavoriteFromCloud, deleteScanFromCloud, getAlertsFromCloud, getCloudStatus, mergeByKey, pullCloudState, pushCloudState, resolveAlertInCloud, syncAlertsToCloud, syncFavoriteToCloud, syncFavoritesToCloud, syncScanToCloud } from "@/lib/cloudSyncClient";
import { num, pct } from "@/lib/formatters";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { activeAlerts, alertSummary, alertsFromScan, mergeAlerts, resolveAlert } from "@/lib/methodologyAlerts";
import { checklistForRow, compactMethodologySnapshot, enrichRowsWithMethodology, findCompatiblePreviousScan, snapshotCompatibilityKey, summarizeMethodology } from "@/lib/methodologyEngine";
import { benchmarkForFavorite, externalLinks, stockUrl } from "@/lib/symbols";

function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
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
function sortScans(rows = []) {
  return [...rows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}
function sortFavorites(rows = []) {
  return [...rows].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
}
function exportJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
async function getJson(url) {
  const r = await fetch(url); const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
function closeOnOrBefore(bars = [], isoDate) {
  const target = new Date(isoDate || Date.now()).toISOString().slice(0, 10);
  return bars.find((bar) => bar.date <= target)?.close ?? bars.at(-1)?.close ?? null;
}
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function stateFromBars(bars = []) {
  if (bars.length < 210) return "Historico insuficiente";
  const sma = (n) => avg(bars.slice(0, n).map((x) => x.close));
  const price = bars[0].close;
  const s50 = sma(50), s200 = sma(200);
  if (price > s50 && price > s200) return "Tendencia constructiva";
  if (price < s200) return "Bajo SMA200";
  if (price < s50) return "Pullback / vigilancia";
  return "Neutral";
}
async function quoteWithBars(symbol) {
  const d = await getJson(`/api/chart?symbol=${encodeURIComponent(symbol)}`);
  const bars = d.bars || [];
  if (!bars.length) throw new Error("Sin dato");
  return { symbol, bars, price: bars[0].close, lastDate: bars[0].date, state: stateFromBars(bars) };
}
function favoriteFromRow(row, scan, market) {
  const methodologySnapshot = compactMethodologySnapshot(row);
  return {
    id: uid(),
    symbol: row.symbol,
    companyName: row.companyName || row.symbol,
    country: row.country,
    sector: row.sector,
    industry: row.industry,
    addedAt: new Date().toISOString(),
    entryPrice: Number.isFinite(row.price) ? row.price : null,
    lastPrice: Number.isFinite(row.price) ? row.price : null,
    lastDate: row.lastDate || null,
    source: "scan",
    notes: "",
    marketScore: scan?.marketScore ?? market?.marketScore ?? null,
    marketRegime: scan?.marketRegime || market?.regime?.label || "sin dato",
    snapshot: {
      ...methodologySnapshot,
      totalScore: row.totalScore,
      weinsteinScore: row.weinsteinScore,
      minerviniScore: row.minerviniScore,
      momentumScore: row.momentumScore,
      riskScore: row.riskScore,
      rsQualityScore: row.rsQualityScore,
      speculationRiskScore: row.speculationRiskScore,
      rsQualityLabel: row.rsQualityLabel,
      weaknessScore: row.weaknessScore,
      weaknessLabel: row.weaknessLabel,
      weaknessReasons: row.weaknessReasons || [],
      sectorScore: row.sectorScore,
      riskState: methodologySnapshot.riskState,
      dataQualityState: methodologySnapshot.dataQualityState,
      price: row.price,
      sma50: row.sma50,
      sma150: row.sma150,
      sma200: row.sma200,
      sma200Slope: row.sma200Slope,
      distance20d: row.distance20d,
      distance52w: row.distance52w,
      extSma50: row.extSma50,
      highsSpreadPct: row.highsSpreadPct,
      perf3m: row.perf3m,
      perf6m: row.perf6m,
      perf12m: row.perf12m,
      theme: row.theme,
      businessEs: row.businessEs,
    },
  };
}

export default function ResearchDesk() {
  const [scans, setScans] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState("Listo");
  const [selectedScan, setSelectedScan] = useState(null);
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cloud, setCloud] = useState({ configured: false, ok: false, message: "Comprobando Supabase..." });
  const [syncing, setSyncing] = useState(false);

  function reloadLocal() {
    const nextScans = safeRead(STORAGE_KEYS.scans, []);
    const nextFavs = safeRead(STORAGE_KEYS.favorites, []);
    const nextAlerts = safeRead(STORAGE_KEYS.alerts, []);
    setScans(nextScans);
    setFavorites(nextFavs);
    setAlerts(nextAlerts);
    if (!selectedScan && nextScans[0]) setSelectedScan(nextScans[0]);
    return { nextScans, nextFavs, nextAlerts };
  }
  useEffect(() => {
    reloadLocal();
    refreshCloudStatus(false);
  }, []);
  function persistScans(next) { setScans(next); safeWrite(STORAGE_KEYS.scans, next); }
  function persistFavs(next) { setFavorites(next); safeWrite(STORAGE_KEYS.favorites, next); }
  function persistAlerts(next) { setAlerts(next); safeWrite(STORAGE_KEYS.alerts, next); }

  async function refreshCloudStatus(report = true) {
    const result = await getCloudStatus();
    setCloud(result);
    if (report) setStatus(result.configured ? (result.ok ? "Supabase conectado." : `Supabase: ${result.message}`) : "Supabase no configurado. Sigues en localStorage.");
    return result;
  }

  async function pushToCloud() {
    setSyncing(true);
    setStatus("Subiendo localStorage a Supabase...");
    try {
      const result = await pushCloudState({ scans, favorites, alerts });
      await refreshCloudStatus(false);
      if (result.configured === false) setStatus("Supabase no configurado. No se ha subido nada.");
      else if (result.ok) setStatus(`Supabase actualizado: ${result.scansSaved} snapshots, ${result.favoritesSaved} favoritos y ${result.alertsSaved || 0} alertas.`);
      else setStatus(`Supabase no pudo sincronizar: ${result.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function pullFromCloud() {
    setSyncing(true);
    setStatus("Importando datos desde Supabase...");
    try {
      const result = await pullCloudState();
      await refreshCloudStatus(false);
      if (result.configured === false) {
        setStatus("Supabase no configurado. No hay datos remotos que importar.");
        return;
      }
      if (!result.ok) {
        setStatus(`No se pudo importar Supabase: ${result.message}`);
        return;
      }
      const nextScans = sortScans(mergeByKey(result.scans, scans, (scan) => scan.id));
      const nextFavs = sortFavorites(mergeByKey(result.favorites, favorites, (favorite) => String(favorite.symbol || "").toUpperCase()));
      const nextAlerts = mergeAlerts(result.alerts || [], alerts);
      persistScans(nextScans);
      persistFavs(nextFavs);
      persistAlerts(nextAlerts);
      setSelectedScan(nextScans[0] || null);
      setStatus(`Importado Supabase: ${result.scans.length} snapshots, ${result.favorites.length} favoritos y ${result.alerts.length} alertas. Local fusionado.`);
    } finally {
      setSyncing(false);
    }
  }

  async function loadMarket() {
    setStatus("Actualizando benchmark...");
    try {
      const d = await getJson("/api/market-health");
      setMarket(d);
      setStatus(`Market Score ${Math.round(d.marketScore || 0)} · ${d.regime?.label || "sin regimen"}`);
      return d;
    } catch (e) {
      setStatus(`Proveedor no disponible: ${e.message}`);
      return null;
    }
  }
  function importLatestScan() {
    const { nextScans } = reloadLocal();
    if (!nextScans.length) {
      setStatus("No hay snapshot guardado desde el screener.");
      return;
    }
    setSelectedScan(nextScans[0]);
    setStatus(`Ultimo scan importado: ${nextScans[0].rows?.length || 0} acciones.`);
  }
  function importManualSnapshot() {
    const raw = prompt("Pega aqui un JSON de filas/candidatas para crear un snapshot manual.");
    if (!raw) return;
    try {
      const rows = JSON.parse(raw);
      const rawRows = Array.isArray(rows) ? rows : rows.rows || [];
      const manualSymbols = rawRows.map((row) => String(row.symbol || "").trim().toUpperCase()).filter(Boolean).sort().join(",");
      const compatibilityContext = { preset: "manual", scanMode: "manual", markets: rows.markets || rows.market || [], universeKey: manualSymbols };
      const compatibilityKey = snapshotCompatibilityKey(compatibilityContext);
      const previousScan = findCompatiblePreviousScan(scans, compatibilityContext);
      const enrichedRows = enrichRowsWithMethodology(rawRows, previousScan?.rows || []);
      const scan = { id: uid(), createdAt: new Date().toISOString(), name: `Snapshot manual · ${new Date().toLocaleString()}`, preset: "manual", marketRegime: market?.regime?.label || "sin dato", marketScore: market?.marketScore ?? null, snapshotCompatibilityKey: compatibilityKey, comparison: { compatiblePrevious: Boolean(previousScan), previousScanId: previousScan?.id || null, previousScanDate: previousScan?.createdAt || null }, methodologySummary: summarizeMethodology(enrichedRows, previousScan), rows: enrichedRows };
      const generatedAlerts = alertsFromScan(scan);
      persistScans([scan, ...scans].slice(0, 50));
      persistAlerts(mergeAlerts(alerts, generatedAlerts).slice(0, 500));
      setSelectedScan(scan);
      setStatus(`Snapshot guardado localmente: ${scan.rows.length} acciones · ${generatedAlerts.length} alertas`);
      syncScanToCloud(scan).then((result) => {
        if (result.configured !== false && result.ok) setStatus(`Snapshot guardado en local y Supabase: ${scan.rows.length} acciones`);
      });
      syncAlertsToCloud(generatedAlerts).then((result) => {
        if (result.ok && result.data?.alerts?.length) persistAlerts(mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), result.data.alerts).slice(0, 500));
      });
    } catch {
      setStatus("JSON no valido");
    }
  }
  function createManualFavorites() {
    const syms = Array.from(new Set(manual.split(/[\n,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)));
    if (!syms.length) return;
    const existing = new Set(favorites.map((x) => x.symbol));
    const now = new Date().toISOString();
    const newFavorites = syms.filter((s) => !existing.has(s)).map((symbol) => ({
        id: uid(),
        symbol,
        companyName: symbol,
        addedAt: now,
        entryPrice: null,
        lastPrice: null,
        lastDate: null,
        source: "manual",
        notes: "",
        marketScore: market?.marketScore ?? null,
        marketRegime: market?.regime?.label || "sin dato",
      }));
    if (!newFavorites.length) {
      setManual("");
      setStatus("Todos los tickers ya estaban en favoritos.");
      return;
    }
    const next = [
      ...newFavorites,
      ...favorites,
    ];
    persistFavs(next);
    setManual("");
    setStatus(`${newFavorites.length} tickers anadidos a favoritos/watchlist`);
    syncFavoritesToCloud(newFavorites).then((result) => {
      if (result.configured !== false && result.ok) setStatus(`${newFavorites.length} favoritos anadidos en local y Supabase`);
    });
  }
  function favFromRow(row) {
    if (favorites.some((f) => f.symbol === row.symbol)) {
      setStatus(`${row.symbol} ya esta en favoritos`);
      return;
    }
    const fav = favoriteFromRow(row, selectedScan, market);
    persistFavs([fav, ...favorites]);
    setStatus(`${row.symbol} anadido a favoritos`);
    syncFavoriteToCloud(fav).then((result) => {
      if (result.configured !== false && result.ok) setStatus(`${row.symbol} anadido a favoritos y Supabase`);
    });
  }
  function removeFav(id) {
    const favorite = favorites.find((x) => x.id === id);
    persistFavs(favorites.filter((x) => x.id !== id));
    if (favorite) deleteFavoriteFromCloud(favorite);
  }
  function deleteScan(id) {
    const scan = scans.find((x) => x.id === id);
    const next = scans.filter((x) => x.id !== id);
    persistScans(next);
    if (selectedScan?.id === id) setSelectedScan(next[0] || null);
    if (scan) deleteScanFromCloud(scan);
  }
  function clearAll() { if (confirm("Borrar scans y favoritos locales?")) { persistScans([]); persistFavs([]); setSelectedScan(null); } }

  async function importCloudAlerts() {
    setSyncing(true);
    setStatus("Importando alertas desde Supabase...");
    try {
      const result = await getAlertsFromCloud("all");
      if (result.configured === false) {
        setStatus("Supabase no configurado. Las alertas siguen en localStorage.");
        return;
      }
      if (!result.ok) {
        setStatus(`No se pudieron importar alertas: ${result.message}`);
        return;
      }
      const next = mergeAlerts(result.data?.alerts || [], alerts);
      persistAlerts(next);
      setStatus(`Alertas importadas: ${result.data?.alerts?.length || 0} remotas, ${activeAlerts(next).length} activas.`);
    } finally {
      setSyncing(false);
    }
  }

  function resolveLocalAlert(alert) {
    const nextAlert = resolveAlert(alert);
    const next = mergeAlerts(alerts.filter((item) => item.id !== alert.id), [nextAlert]);
    persistAlerts(next);
    setStatus(`${alert.symbol} · alerta resuelta`);
    resolveAlertInCloud(nextAlert).then((result) => {
      if (result.configured !== false && !result.ok) setStatus(`Alerta resuelta localmente. Supabase: ${result.message}`);
      else if (result.ok && result.data?.alerts?.length) persistAlerts(mergeAlerts(safeRead(STORAGE_KEYS.alerts, []), result.data.alerts).slice(0, 500));
    });
  }

  async function refreshFavorites() {
    setLoading(true);
    setStatus("Actualizando favoritos y benchmarks...");
    const next = [];
    for (const f of favorites) {
      try {
        const q = await quoteWithBars(f.symbol);
        const benchmarkSymbol = f.benchmarkSymbol || benchmarkForFavorite(f);
        const bq = await quoteWithBars(benchmarkSymbol);
        const entry = Number.isFinite(f.entryPrice) ? f.entryPrice : closeOnOrBefore(q.bars, f.addedAt);
        const benchEntry = closeOnOrBefore(bq.bars, f.addedAt);
        const perfSinceAdd = entry ? ((q.price / entry) - 1) * 100 : null;
        const benchmarkPerf = benchEntry ? ((bq.price / benchEntry) - 1) * 100 : null;
        next.push({
          ...f,
          entryPrice: entry,
          lastPrice: q.price,
          lastDate: q.lastDate,
          perfSinceAdd,
          benchmarkSymbol,
          benchmarkEntry: benchEntry,
          benchmarkLast: bq.price,
          benchmarkPerf,
          alpha: Number.isFinite(perfSinceAdd) && Number.isFinite(benchmarkPerf) ? perfSinceAdd - benchmarkPerf : null,
          currentState: q.state,
          error: null,
        });
      } catch (e) {
        next.push({ ...f, error: e.message || "Proveedor no disponible" });
      }
      await new Promise((r) => setTimeout(r, 70));
    }
    persistFavs(next);
    setLoading(false);
    setStatus("Favoritos actualizados");
    syncFavoritesToCloud(next).then((result) => {
      if (result.configured !== false && result.ok) setStatus("Favoritos actualizados y sincronizados en Supabase");
    });
  }

  const selectedRows = selectedScan?.rows || [];
  const selectedMethodology = selectedScan?.methodologySummary || summarizeMethodology(selectedRows);
  const selectedEvents = useMemo(() => selectedRows
    .flatMap((row) => (row.methodologyEvents || []).map((event) => ({ ...event, symbol: row.symbol, companyName: row.companyName })))
    .slice(0, 24), [selectedRows]);
  const visibleAlerts = useMemo(() => activeAlerts(alerts).slice(0, 30), [alerts]);
  const alertsSummary = useMemo(() => alertSummary(alerts), [alerts]);
  const favoriteStats = useMemo(() => {
    const valid = favorites.filter((f) => Number.isFinite(f.perfSinceAdd));
    const avgPerf = valid.length ? valid.reduce((a, b) => a + b.perfSinceAdd, 0) / valid.length : null;
    const avgAlpha = valid.filter((f) => Number.isFinite(f.alpha));
    return { count: favorites.length, tracked: valid.length, avg: avgPerf, alpha: avgAlpha.length ? avgAlpha.reduce((a, b) => a + b.alpha, 0) / avgAlpha.length : null };
  }, [favorites]);

  return <main className="page">
    <section className="card hero">
      <div className="heroTop">
        <div><div className="badge">STATS EDGE · Research Desk</div><h1>Registro y favoritos</h1><p className="muted">Snapshots, watchlist, notas y seguimiento local-first.</p></div>
        <div className="mobileActions"><a className="btn" href="/">Screener</a><a className="btn" href="/review?source=favorites">Vista favoritos</a><a className="btn" href="/lists">Listas</a><a className="btn" href="/ipo-radar">IPO Radar</a><a className="btn" href="/market-health">Salud mercado</a><button className="btn btnPrimary" onClick={refreshFavorites} disabled={loading}>{loading ? "Actualizando..." : "Actualizar favoritos"}</button></div>
      </div>
    </section>

    <section className="card"><div className="kpis"><div className="kpi"><b>{scans.length}</b><span>snapshots guardados</span></div><div className="kpi"><b>{favoriteStats.count}</b><span>favoritos</span></div><div className="kpi"><b>{alertsSummary.active}</b><span>alertas activas</span></div><div className="kpi"><b>{pct(favoriteStats.avg)}</b><span>media desde favorito</span></div><div className="kpi"><b>{pct(favoriteStats.alpha)}</b><span>alpha media</span></div></div></section>
    <section className="card status">Estado: <b>{status}</b></section>

    <section className="card">
      <div className="sectionTitle"><h2>Supabase <InfoHint text={cloud.message || "Sincronizacion opcional. localStorage sigue activo aunque Supabase no este configurado."} /></h2><span className="fine">{cloud.configured ? (cloud.ok ? "Conectado" : "Configurado con error") : "No configurado"}</span></div>
      <div className="controls">
        <button className="btn" onClick={() => refreshCloudStatus(true)} disabled={syncing}>Probar conexion</button>
        <button className="btn btnPrimary" onClick={pushToCloud} disabled={syncing}>{syncing ? "Sincronizando..." : "Subir local"}</button>
        <button className="btn" onClick={pullFromCloud} disabled={syncing}>Importar nube</button>
        <button className="btn" onClick={importCloudAlerts} disabled={syncing}>Importar alertas</button>
      </div>
    </section>

    <section className="grid grid2">
      <div className="card">
        <h2>Acciones rapidas</h2>
        <div className="controls">
          <button className="btn" onClick={loadMarket}>Actualizar benchmark</button>
          <button className="btn btnPrimary" onClick={importLatestScan}>Importar ultimo scan</button>
          <button className="btn" onClick={importManualSnapshot}>Snapshot manual</button>
          <button className="btn" onClick={() => exportJson("statsedge-backup.json", { scans, favorites, exportedAt: new Date().toISOString() })}>Exportar backup</button>
          <button className="btn btnGhost" onClick={clearAll}>Borrar local</button>
        </div>
      </div>
      <div className="card"><h2>Anadir favoritos manuales</h2><textarea className="textarea" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={"NVDA\nASML.AS\nRHM.DE"} /><button className="btn btnPrimary" style={{ marginTop: 10 }} onClick={createManualFavorites}>Anadir a watchlist</button></div>
    </section>

    {!!selectedEvents.length && <section className="card">
      <div className="sectionTitle"><h2>Cambios desde snapshot anterior</h2><span className="fine">{selectedEvents.length} eventos visibles · {selectedMethodology.previousScanDate ? new Date(selectedMethodology.previousScanDate).toLocaleString() : "sin comparativo previo"}</span></div>
      <div className="grid grid3">
        <div className="kpi"><b>{selectedMethodology.severityCounts?.positive || 0}</b><span>mejoras</span></div>
        <div className="kpi"><b>{selectedMethodology.severityCounts?.warning || 0}</b><span>deterioros</span></div>
        <div className="kpi"><b>{selectedMethodology.stageCounts?.stage2 || 0}</b><span>Stage 2</span></div>
      </div>
      <div className="tableWrap" style={{ marginTop: 10 }}><table className="table"><thead><tr>{["Ticker", "Evento", "Tipo", "Detalle"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{selectedEvents.map((event, index) => <tr key={`${event.symbol}-${event.type}-${index}`}><td><a className="ticker" href={stockUrl(event.symbol)}>{event.symbol}</a><br /><span className="fine">{event.companyName || ""}</span></td><td>{event.label}</td><td><span className="pill">{event.severity}</span></td><td>{event.detail}</td></tr>)}</tbody></table></div>
    </section>}

    <section className="card">
      <div className="sectionTitle"><h2>Alertas activas</h2><span className="fine">{alertsSummary.warnings} deterioros · {alertsSummary.positives} mejoras · {alertsSummary.neutral} contexto</span></div>
      {visibleAlerts.length ? <div className="tableWrap"><table className="table"><thead><tr>{["Ticker", "Alerta", "Severidad", "Origen", "Detalle", "Acciones"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{visibleAlerts.map((alert) => <tr key={alert.id}><td><a className="ticker" href={stockUrl(alert.symbol)}>{alert.symbol}</a><br /><span className="fine">{alert.payload?.companyName || ""}</span></td><td>{alert.payload?.label || alert.alertType}</td><td><span className="pill">{alert.payload?.severity || "neutral"}</span></td><td>{alert.payload?.scanName || "Snapshot"}<br /><span className="fine">{alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : ""}</span></td><td>{alert.payload?.detail || "-"}</td><td><div className="actionCell"><a className="btn btnSmall" href={stockUrl(alert.symbol)}>Ficha</a><button className="btn btnSmall btnGhost" onClick={() => resolveLocalAlert(alert)}>Resolver</button></div></td></tr>)}</tbody></table></div> : <p className="fine">Sin alertas activas. Guarda un nuevo snapshot comparable para generar cambios observables.</p>}
    </section>

    <section className="card">
      <h2>Favoritos / watchlist</h2>
      <div className="tableWrap"><table className="table"><thead><tr>{["Ticker", "Empresa", "Desde", "Precio ref", "Ultimo", "Rend.", "Benchmark", "Alpha", "Estado", "Regimen", "Scores", "Notas", "Acciones"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{favorites.map((f) => {
        const links = externalLinks(f.symbol);
        const checklist = checklistForRow(f).slice(1, 6);
        return <tr key={f.id}>
          <td><a className="ticker" href={stockUrl(f.symbol)}>{f.symbol}</a></td>
          <td>{f.companyName}<br /><span className="fine">{f.snapshot?.theme || f.source}</span></td>
          <td>{new Date(f.addedAt).toLocaleDateString()}</td>
          <td>{Number.isFinite(f.entryPrice) ? f.entryPrice.toFixed(2) : "Sin dato"}</td>
          <td>{Number.isFinite(f.lastPrice) ? f.lastPrice.toFixed(2) : "Sin dato"}<br /><span className="fine">{f.lastDate || f.error || "sin actualizar"}</span></td>
          <td className="ticker">{pct(f.perfSinceAdd)}</td>
          <td>{f.benchmarkSymbol || benchmarkForFavorite(f)}<br /><span className="fine">{pct(f.benchmarkPerf)}</span></td>
          <td className="ticker">{pct(f.alpha)}</td>
          <td>{f.currentState || "Sin dato"}</td>
          <td>{f.marketRegime || "-"}<br /><span className="fine">Score {num(f.marketScore)}</span></td>
          <td>Tot {num(f.snapshot?.totalScore)} · RSQ {num(f.snapshot?.rsQualityScore)} · Weak {num(f.snapshot?.weaknessScore)} · W {num(f.snapshot?.weinsteinScore)}<br /><span className="fine">{checklist.map((item) => `${item.label}: ${item.status}`).join(" · ")}</span></td>
          <td><input className="input" value={f.notes || ""} onChange={(e) => persistFavs(favorites.map((x) => x.id === f.id ? { ...x, notes: e.target.value, updatedAt: new Date().toISOString() } : x))} onBlur={() => {
            const latest = safeRead(STORAGE_KEYS.favorites, []).find((item) => item.id === f.id || item.symbol === f.symbol);
            if (latest) syncFavoriteToCloud(latest);
          }} placeholder="tesis / alerta" /></td>
          <td><div className="actionCell"><a className="btn btnSmall" href={stockUrl(f.symbol)}>Ficha</a><a className="btn btnSmall" href={links.tradingView} target="_blank" rel="noreferrer">TV</a><button className="starBtn on" onClick={() => removeFav(f.id)}>Eliminar</button></div></td>
        </tr>;
      })}{!favorites.length && <tr><td colSpan="13">Aun no tienes favoritos.</td></tr>}</tbody></table></div>
    </section>

    <section className="grid grid2">
      <div className="card"><h2>Historial de scans</h2>{scans.map((s) => <div className="summaryRow" key={s.id} onClick={() => setSelectedScan(s)} style={{ cursor: "pointer", borderColor: selectedScan?.id === s.id ? "rgba(243,217,139,.7)" : undefined }}><span>{s.name || new Date(s.createdAt).toLocaleString()}<br /><span className="fine">{s.preset || "-"} · {s.marketRegime || "sin regimen"}</span></span><span>{s.rows?.length || 0} acciones</span></div>)}{!scans.length && <p className="fine">No hay snapshots todavia. Guarda uno desde el screener o importa datos manualmente.</p>}</div>
      <div className="card"><h2>Snapshot seleccionado</h2>{selectedScan ? <><div className="summaryRow"><span>{selectedScan.name}</span><span>{selectedRows.length} filas</span></div><div className="controls" style={{ marginTop: 10 }}><button className="btn" onClick={() => exportJson(`scan-${selectedScan.id}.json`, selectedScan)}>Exportar scan</button><button className="btn btnGhost" onClick={() => deleteScan(selectedScan.id)}>Eliminar scan</button><a className="btn" href="/review?source=latest">Vista rapida</a><a className="btn btnPrimary" href="/lists">Ver en listas</a></div></> : <p className="fine">Selecciona un snapshot del historial.</p>}</div>
    </section>

    {selectedScan && <section className="card"><h2>Candidatas del snapshot</h2><div className="tableWrap"><table className="table"><thead><tr>{["★", "Ticker", "Empresa", "Tema", "Stage", "Cambios", "3M", "6M", "12M", "Weinstein", "Minervini", "RSQ", "Weak", "Risk", "Total", "Acciones"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{selectedRows.map((r) => <tr key={r.symbol}><td><button className="starBtn" onClick={() => favFromRow(r)}>★</button></td><td><a className="ticker" href={stockUrl(r.symbol)}>{r.symbol}</a></td><td>{r.companyName}<br /><span className="fine">{shortBusiness(r)}</span></td><td><span className="pill">{r.theme}</span></td><td>{r.stageLabel || r.methodology?.stageState?.label || "-"}</td><td>{(r.methodologyEvents || []).slice(0, 2).map((event) => event.label).join(" · ") || "-"}</td><td>{pct(r.perf3m)}</td><td>{pct(r.perf6m)}</td><td>{pct(r.perf12m)}</td><td>{num(r.weinsteinScore)}</td><td>{num(r.minerviniScore)}</td><td>{num(r.rsQualityScore)}</td><td>{num(r.weaknessScore)}</td><td>{num(r.riskScore)}</td><td className="ticker">{num(r.totalScore)}</td><td><div className="actionCell"><a className="btn btnSmall" href={stockUrl(r.symbol)}>Ficha</a><a className="btn btnSmall" href={externalLinks(r.symbol).tradingView} target="_blank" rel="noreferrer">TV</a></div></td></tr>)}</tbody></table></div></section>}

    <footer className="card footer">Local-first con sincronizacion opcional.</footer>
  </main>;
}
