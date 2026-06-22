"use client";
import "../../styles/research-desk.css";
import { useEffect, useMemo, useState } from "react";
import { DecisionTraceBadge, DecisionTracePanel } from "@/app/DecisionTraceability";
import RowTrustSignature from "@/app/RowTrustSignature";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { TrustMetric } from "@/app/components/ui/MetricSource";
import { rowTrustSignatureForRow } from "@/app/components/ui/TrustSignals";
import { getJson } from "@/lib/clientApi";
import { deleteFavoriteFromCloud, deleteScanFromCloud, getAlertsFromCloud, getCloudStatus, mergeAlertsWithTimestamps, mergeFavoritesWithTombstones, mergeScansWithTombstones, pullCloudState, pushCloudState, resolveAlertInCloud, syncAlertsToCloud, syncFavoriteToCloud, syncFavoritesToCloud, syncScanToCloud } from "@/lib/cloudSyncClient";
import { num, pct } from "@/lib/formatters";
import { sma } from "@/lib/indicators";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { activeAlerts, alertSummary, alertsFromScan, mergeAlerts, resolveAlert } from "@/lib/methodologyAlerts";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";
import { checklistForRow, enrichRowsWithMethodology, findCompatiblePreviousScan, snapshotCompatibilityKey, summarizeMethodology } from "@/lib/methodologyEngine";
import { buildDecisionTraceabilitySummary, decisionResolutionForRow } from "@/lib/decisionTraceability";
import { rowPassesListContract } from "@/lib/listRationale";
import { createFavoriteFromRow, metricValue, rowTheme, shortBusiness } from "@/lib/stockRows";
import { benchmarkForFavorite, externalLinks, stockUrl } from "@/lib/symbols";
import { vcpContractionSummary } from "@/lib/vcpDiagnostics";

function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function ResearchTrustMetric({ row, metricKey, label, value, className = "" }) {
  return <TrustMetric row={row} metricKey={metricKey} label={label} value={value} className={className} baseClass="researchTrustMetric" />;
}
function ResearchScoreStrip({ row }) {
  const sourceRow = row?.snapshot || row || {};
  const trustSignature = rowTrustSignatureForRow(sourceRow);
  const items = [
    ["objectiveScore", metricShortLabel("objectiveScore"), num(metricValue(sourceRow, "objectiveScore"))],
    ["rsQualityScore", metricShortLabel("rsQualityScore"), num(sourceRow.rsQualityScore)],
    ["weaknessScore", metricShortLabel("weaknessScore"), num(sourceRow.weaknessScore)],
    ["weinsteinScore", metricShortLabel("weinsteinScore"), num(sourceRow.weinsteinScore)],
  ];
  return <span className="researchScoreCluster">
    <span className="researchScoreStrip">
      {items.map(([key, label, value]) => <span key={key}>
        <em>{label}</em>
        <ResearchTrustMetric row={sourceRow} metricKey={key} label={label} value={value} />
      </span>)}
    </span>
    <RowTrustSignature signature={trustSignature} className="researchRowTrustSignature" />
  </span>;
}
function sortScans(rows = []) {
  return [...rows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}
function sortFavorites(rows = []) {
  return [...rows].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
}
function storedScanCompatibilityKey(scan = {}) {
  return scan.snapshotCompatibilityKey || scan.settings?.snapshotCompatibilityKey || null;
}
function previousScanForDisplay(scans = [], scan = null) {
  if (!scan) return null;
  const explicitId = scan.comparison?.previousScanId || scan.methodologySummary?.previousScanId || "";
  const explicit = explicitId ? scans.find((item) => item.id === explicitId && Array.isArray(item.rows) && item.rows.length) : null;
  if (explicit) return explicit;
  const key = storedScanCompatibilityKey(scan);
  if (!key) return null;
  const selectedTime = Date.parse(scan.createdAt || scan.updatedAt || 0);
  return sortScans(scans).find((item) => {
    if (!item || item.id === scan.id || !Array.isArray(item.rows) || !item.rows.length) return false;
    if (storedScanCompatibilityKey(item) !== key) return false;
    const itemTime = Date.parse(item.createdAt || item.updatedAt || 0);
    return !Number.isFinite(selectedTime) || !Number.isFinite(itemTime) || itemTime < selectedTime;
  }) || null;
}
function exportJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
function investorStatusLabel(text = "") {
  return String(text || "")
    .replaceAll("Supabase", "nube")
    .replaceAll("localStorage", "modo local")
    .replaceAll("Proveedor", "Datos")
    .replaceAll("provider", "datos");
}
// Sparkline favorito-vs-benchmark sobre la serie diaria de favorite_snapshots.
// Ambas series se normalizan a base 100 en el primer snapshot: la línea azul es el
// favorito y la gris discontinua el benchmark.
function FavoriteSparkline({ series = [] }) {
  const points = series.filter((point) => Number.isFinite(point.price));
  if (points.length < 2) return <span className="fine">Serie en construcción ({points.length}/2 snapshots)</span>;
  const width = 130;
  const height = 36;
  const pad = 2;
  const base = points[0];
  const favorite = points.map((point) => (point.price / base.price) * 100);
  const benchmarkBase = Number.isFinite(base.benchmarkPrice) && base.benchmarkPrice > 0 ? base.benchmarkPrice : null;
  const benchmark = benchmarkBase ? points.map((point) => Number.isFinite(point.benchmarkPrice) ? (point.benchmarkPrice / benchmarkBase) * 100 : null) : [];
  const values = [...favorite, ...benchmark.filter(Number.isFinite)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index) => pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value) => max === min ? height / 2 : pad + (1 - (value - min) / (max - min)) * (height - pad * 2);
  const path = (vals) => {
    let open = false;
    return vals.map((value, index) => {
      if (!Number.isFinite(value)) { open = false; return ""; }
      const cmd = open ? "L" : "M";
      open = true;
      return `${cmd}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    }).filter(Boolean).join(" ");
  };
  const lastAlpha = [...points].reverse().find((point) => Number.isFinite(point.alpha))?.alpha ?? null;
  const title = `${points.length} snapshots · ${base.capturedAt?.slice(0, 10) || ""} → ${points.at(-1).capturedAt?.slice(0, 10) || ""}${Number.isFinite(lastAlpha) ? ` · alpha ${lastAlpha.toFixed(1)}%` : ""}`;
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
    <title>{title}</title>
    {benchmark.length > 0 && <path d={path(benchmark)} fill="none" stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 2" />}
    <path d={path(favorite)} fill="none" stroke="#2563eb" strokeWidth="1.6" />
  </svg>;
}
function closeOnOrBefore(bars = [], isoDate) {
  const target = new Date(isoDate || Date.now()).toISOString().slice(0, 10);
  return bars.find((bar) => bar.date <= target)?.close ?? bars.at(-1)?.close ?? null;
}
function stateFromBars(bars = []) {
  if (bars.length < 210) return "Historico insuficiente";
  const price = bars[0].close;
  const s50 = sma(bars, 50), s200 = sma(bars, 200);
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

function patternLabel(row = {}) {
  return methodologyDisplayForRow(row).label || row.methodologyTags?.[0] || row.stageLabel || "Sin estructura";
}

function contractionText(row = {}) {
  const source = { ...(row.snapshot || {}), ...row };
  const summary = vcpContractionSummary(source);
  if (summary) return summary;
  const depths = (source.contractionDepths || []).filter(Number.isFinite).slice(0, 3);
  if (depths.length) return depths.map((value) => `${value.toFixed(1)}%`).join(" -> ");
  const base = source.baseDepthPct;
  return Number.isFinite(base) ? `Base ${base.toFixed(1)}%` : "Sin dato";
}

function commandCenterFrom({ rows = [], alerts = [], favorites = [] } = {}) {
  const favSet = new Set(favorites.map((item) => item.symbol));
  const structures = rows
    .filter((row) => {
      const display = methodologyDisplayForRow(row);
      return display.blocksPatternClaim !== true && (display.watch || display.actionable || display.strict);
    })
    .sort((a, b) => {
      const av = methodologyDisplayForRow(a);
      const bv = methodologyDisplayForRow(b);
      return (Number(bv.actionable) - Number(av.actionable)) || (b.patternQualityScore || b.setupQualityScore || 0) - (a.patternQualityScore || a.setupQualityScore || 0);
    })
    .slice(0, 8);
  const measuredBases = rows
    .filter((row) => {
      const display = methodologyDisplayForRow(row);
      return display.blocksPatternClaim !== true && display.observable && !display.watch && !display.actionable;
    })
    .sort((a, b) => (b.patternQualityScore || b.setupQualityScore || 0) - (a.patternQualityScore || a.setupQualityScore || 0))
    .slice(0, 8);
  const pivotZone = rows
    .filter((row) => rowPassesListContract(row, "nearPivot"))
    .sort((a, b) => Math.abs(a.distanceToPivotPct || 99) - Math.abs(b.distanceToPivotPct || 99))
    .slice(0, 8);
  const favoriteAlerts = alerts
    .filter((alert) => favSet.has(alert.symbol))
    .slice(0, 8);
  const dataIssues = rows
    .filter((row) => row.patternDataStatus && !["ok", "partial_volume"].includes(row.patternDataStatus))
    .slice(0, 8);
  return [
    { key: "structures", title: "Vigilancia metodológica", detail: "Estructuras en zona útil; solo Plan válido habilita plan automático", rows: structures },
    { key: "measured", title: "Bases medibles", detail: "Estructura reconocible, pero fuera de zona de vigilancia", rows: measuredBases },
    { key: "pivot", title: "Pivot cercano", detail: "Proximidad objetiva; no implica VCP validado ni plan automático", rows: pivotZone },
    { key: "favoriteAlerts", title: "Favoritos con cambios", detail: "Alertas activas sobre valores ya guardados", alerts: favoriteAlerts },
    { key: "data", title: "Datos a revisar", detail: "Patrones no calculados por cobertura insuficiente", rows: dataIssues },
  ];
}

function DailyCommandCenter({ sections = [] }) {
  const visibleSections = sections.filter((section) => (section.rows?.length || section.alerts?.length || 0) > 0);
  if (!visibleSections.length) {
    return <section className="card commandCenterEmpty">
      <div className="emptyStateHead">
        <h2>Observatorio <InfoHint text="Cambios y estructuras observables desde snapshots y favoritos. No establece preferencias." /></h2>
        <span className="fine">Sin elementos relevantes</span>
      </div>
      <a className="btn" href="/">Screener</a>
    </section>;
  }
  return <section className="card">
    <div className="sectionTitle">
      <h2>Observatorio <InfoHint text="Cambios y estructuras observables desde snapshots y favoritos. No establece preferencias." /></h2>
      <span className="fine">snapshot + favoritos</span>
    </div>
    <div className="grid grid2">
      {visibleSections.map((section) => <div className="miniPanel" key={section.key}>
        <div className="sectionTitle"><h3>{section.title} <InfoHint text={section.detail} /></h3><span className="fine">{section.rows?.length || section.alerts?.length || 0}</span></div>
        {section.alerts ? section.alerts.slice(0, 5).map((alert) => <div className="summaryRow" key={alert.id}>
          <span><a className="ticker" href={stockUrl(alert.symbol)}>{alert.symbol}</a><br /><span className="fine">{alert.payload?.label || alert.alertType}</span></span>
          <span>{alert.payload?.severity || "neutral"}</span>
        </div>) : section.rows.slice(0, 5).map((row) => {
          const trustSignature = rowTrustSignatureForRow(row);
          return <div className="summaryRow" key={`${section.key}-${row.symbol}`}>
          <span><a className="ticker" href={stockUrl(row.symbol)}>{row.symbol}</a><br /><span className="fine">{patternLabel(row)}</span><RowTrustSignature signature={trustSignature} className="researchRowTrustSignature" /></span>
          <span>{section.key === "pivot" && Number.isFinite(row.distanceToPivotPct) ? pct(row.distanceToPivotPct) : contractionText(row)}</span>
        </div>;
        })}
      </div>)}
    </div>
  </section>;
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
  const [favoriteSeries, setFavoriteSeries] = useState({});
  const [reviewState, setReviewState] = useState({});
  useEffect(() => {
    getJson("/api/favorites/snapshots?days=180")
      .then((data) => setFavoriteSeries(data.snapshots || {}))
      .catch(() => {});
  }, []);

  function reloadLocal() {
    const nextScans = safeRead(STORAGE_KEYS.scans, []);
    const nextFavs = safeRead(STORAGE_KEYS.favorites, []);
    const nextAlerts = safeRead(STORAGE_KEYS.alerts, []);
    const nextReview = safeRead(STORAGE_KEYS.review, {});
    setScans(nextScans);
    setFavorites(nextFavs);
    setAlerts(nextAlerts);
    setReviewState(nextReview);
    if (!selectedScan && nextScans[0]) setSelectedScan(nextScans[0]);
    return { nextScans, nextFavs, nextAlerts };
  }
  useEffect(() => {
    reloadLocal();
    refreshCloudStatus(false);
  }, []);
  useEffect(() => {
    function refreshReviewState() {
      setReviewState(safeRead(STORAGE_KEYS.review, {}));
    }
    function handleStorage(event) {
      if (!event.key || event.key === STORAGE_KEYS.review) refreshReviewState();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") refreshReviewState();
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", refreshReviewState);
    window.addEventListener("pageshow", refreshReviewState);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", refreshReviewState);
      window.removeEventListener("pageshow", refreshReviewState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
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
      else if (result.ok) setStatus(`Supabase actualizado: ${result.scansSaved} snapshots, ${result.scansDeleted || 0} snapshots borrados, ${result.favoritesSaved} favoritos, ${result.favoritesDeleted || 0} borrados y ${result.alertsSaved || 0} alertas.${result.favoritesSkippedStale || result.favoritesDeleteSkippedStale || result.scansDeleteSkippedStale ? ` ${result.favoritesSkippedStale + result.favoritesDeleteSkippedStale + result.scansDeleteSkippedStale} cambios remotos mas recientes no se pisaron.` : ""}`);
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
      const nextScans = sortScans(mergeScansWithTombstones(result.scans, scans, result.scanTombstones));
      const nextFavs = sortFavorites(mergeFavoritesWithTombstones(result.favorites, favorites, result.favoriteTombstones));
      const nextAlerts = mergeAlertsWithTimestamps(result.alerts || [], alerts);
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
        if (result.ok && result.data?.alerts?.length) persistAlerts(mergeAlertsWithTimestamps(result.data.alerts, safeRead(STORAGE_KEYS.alerts, [])).slice(0, 500));
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
        updatedAt: now,
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
    const fav = createFavoriteFromRow(row, { source: "scan", scan: selectedScan, market });
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
      const next = mergeAlertsWithTimestamps(result.data?.alerts || [], alerts);
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
      else if (result.ok && result.data?.alerts?.length) persistAlerts(mergeAlertsWithTimestamps(result.data.alerts, safeRead(STORAGE_KEYS.alerts, [])).slice(0, 500));
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
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        next.push({ ...f, error: e.message || "Proveedor no disponible", updatedAt: new Date().toISOString() });
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

  const selectedPreviousScan = useMemo(() => previousScanForDisplay(scans, selectedScan), [scans, selectedScan]);
  const selectedRows = useMemo(() => {
    const rows = Array.isArray(selectedScan?.rows) ? selectedScan.rows : [];
    return rows.length ? enrichRowsWithMethodology(rows, selectedPreviousScan?.rows || []) : [];
  }, [selectedScan, selectedPreviousScan]);
  const selectedMethodology = useMemo(() => summarizeMethodology(selectedRows, selectedPreviousScan), [selectedRows, selectedPreviousScan]);
  const selectedEvents = useMemo(() => selectedRows
    .flatMap((row) => (row.methodologyEvents || []).map((event) => ({ ...event, symbol: row.symbol, companyName: row.companyName })))
    .slice(0, 24), [selectedRows]);
  const visibleAlerts = useMemo(() => activeAlerts(alerts).slice(0, 30), [alerts]);
  const alertsSummary = useMemo(() => alertSummary(alerts), [alerts]);
  const commandCenter = useMemo(() => commandCenterFrom({ rows: selectedRows, alerts: visibleAlerts, favorites }), [selectedRows, visibleAlerts, favorites]);
  const decisionTraceability = useMemo(() => buildDecisionTraceabilitySummary([...selectedRows, ...favorites], reviewState), [selectedRows, favorites, reviewState]);
  const favoriteStats = useMemo(() => {
    const valid = favorites.filter((f) => Number.isFinite(f.perfSinceAdd));
    const avgPerf = valid.length ? valid.reduce((a, b) => a + b.perfSinceAdd, 0) / valid.length : null;
    const avgAlpha = valid.filter((f) => Number.isFinite(f.alpha));
    return { count: favorites.length, tracked: valid.length, avg: avgPerf, alpha: avgAlpha.length ? avgAlpha.reduce((a, b) => a + b.alpha, 0) / avgAlpha.length : null };
  }, [favorites]);

  return <main className="page">
    <section className="card hero">
      <div className="heroTop">
        <div><div className="badge">StatsEdge · Research</div><h1>Registro y favoritos</h1><p className="muted">Snapshots, watchlist, notas y seguimiento local-first.</p></div>
        <div className="mobileActions"><a className="btn" href="/">Screener</a><a className="btn" href="/review?source=favorites">Vista favoritos</a><a className="btn" href="/lists">Listas</a><a className="btn" href="/ipo-radar">IPO Radar</a><a className="btn" href="/market-health">Salud mercado</a><button className="btn btnPrimary" onClick={refreshFavorites} disabled={loading}>{loading ? "Actualizando..." : "Actualizar favoritos"}</button></div>
      </div>
    </section>

    <section className="card"><div className="kpis"><div className="kpi"><b>{scans.length}</b><span>snapshots guardados</span></div><div className="kpi"><b>{favoriteStats.count}</b><span>favoritos</span></div><div className="kpi"><b>{alertsSummary.active}</b><span>alertas activas</span></div><div className="kpi"><b>{pct(favoriteStats.avg)}</b><span>media desde favorito</span></div><div className="kpi"><b>{pct(favoriteStats.alpha)}</b><span>alpha media</span></div></div></section>
    <section className="card status">Estado: <b>{investorStatusLabel(status)}</b></section>
    <DecisionTracePanel summary={decisionTraceability} detail="Decisiones tomadas en Review/Ficha que afectan a snapshots y favoritos visibles en Research Desk." />

    <DailyCommandCenter sections={commandCenter} />

    <section className="card">
      <div className="sectionTitle"><h2>Sincronización <InfoHint text="Copia opcional en la nube. La experiencia sigue funcionando en modo local aunque no esté conectada." /></h2><span className="fine">{cloud.configured ? (cloud.ok ? "Conectada" : "Revisar conexión") : "Modo local"}</span></div>
      <div className="controls">
        <button className="btn" onClick={() => refreshCloudStatus(true)} disabled={syncing}>Comprobar</button>
        <button className="btn btnPrimary" onClick={pushToCloud} disabled={syncing}>{syncing ? "Sincronizando..." : "Guardar copia"}</button>
        <button className="btn" onClick={pullFromCloud} disabled={syncing}>Traer copia</button>
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
          <button className="btn" onClick={() => exportJson("stageradar-backup.json", { scans, favorites, exportedAt: new Date().toISOString() })}>Exportar backup</button>
          <button className="btn btnGhost" onClick={clearAll}>Limpiar dispositivo</button>
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
      <div className="tableWrap"><table className="table"><thead><tr>{["Ticker", "Empresa", "Desde", "Precio ref", "Ultimo", "Rend.", "Benchmark", "Alpha", "Evolución", "Estado", "Regimen", "Scores", "Notas", "Acciones"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{favorites.map((f) => {
        const links = externalLinks(f.symbol);
        const checklist = checklistForRow(f).slice(1, 6);
        return <tr key={f.id}>
          <td><a className="ticker" href={stockUrl(f.symbol)}>{f.symbol}</a><DecisionTraceBadge resolution={decisionResolutionForRow(f, reviewState)} /></td>
          <td>{f.companyName}<br /><span className="fine">{rowTheme(f) || f.source}</span></td>
          <td>{new Date(f.addedAt).toLocaleDateString()}</td>
          <td>{Number.isFinite(f.entryPrice) ? f.entryPrice.toFixed(2) : "Sin dato"}</td>
          <td>{Number.isFinite(f.lastPrice) ? f.lastPrice.toFixed(2) : "Sin dato"}<br /><span className="fine">{f.lastDate || f.error || "sin actualizar"}</span></td>
          <td className="ticker">{pct(f.perfSinceAdd)}</td>
          <td>{f.benchmarkSymbol || benchmarkForFavorite(f)}<br /><span className="fine">{pct(f.benchmarkPerf)}</span></td>
          <td className="ticker">{pct(f.alpha)}</td>
          <td><FavoriteSparkline series={favoriteSeries[String(f.symbol || "").toUpperCase()] || []} /></td>
          <td>{f.currentState || "Sin dato"}</td>
          <td>{f.marketRegime || "-"}<br /><span className="fine">Score {num(f.marketScore)}</span></td>
          <td><ResearchScoreStrip row={f} /><br /><span className="fine">{checklist.map((item) => `${item.label}: ${item.status}`).join(" · ")}</span></td>
          <td><input className="input" value={f.notes || ""} onChange={(e) => persistFavs(favorites.map((x) => x.id === f.id ? { ...x, notes: e.target.value, updatedAt: new Date().toISOString() } : x))} onBlur={() => {
            const latest = safeRead(STORAGE_KEYS.favorites, []).find((item) => item.id === f.id || item.symbol === f.symbol);
            if (latest) syncFavoriteToCloud(latest);
          }} placeholder="tesis / alerta" /></td>
          <td><div className="actionCell"><a className="btn btnSmall" href={stockUrl(f.symbol)}>Ficha</a><a className="btn btnSmall" href={links.tradingView} target="_blank" rel="noreferrer">TV</a><button className="starBtn on" onClick={() => removeFav(f.id)}>Eliminar</button></div></td>
        </tr>;
      })}{!favorites.length && <tr><td colSpan="14">Aun no tienes favoritos.</td></tr>}</tbody></table></div>
    </section>

    <section className="grid grid2">
      <div className="card"><h2>Historial de scans</h2>{scans.map((s) => <div className="summaryRow" key={s.id} onClick={() => setSelectedScan(s)} style={{ cursor: "pointer", borderColor: selectedScan?.id === s.id ? "rgba(243,217,139,.7)" : undefined }}><span>{s.name || new Date(s.createdAt).toLocaleString()}<br /><span className="fine">{s.preset || "-"} · {s.marketRegime || "sin regimen"}</span></span><span>{s.rows?.length || 0} acciones</span></div>)}{!scans.length && <p className="fine">No hay snapshots todavia. Guarda uno desde el screener o importa datos manualmente.</p>}</div>
      <div className="card"><h2>Snapshot seleccionado</h2>{selectedScan ? <><div className="summaryRow"><span>{selectedScan.name}</span><span>{selectedRows.length} filas</span></div><div className="controls" style={{ marginTop: 10 }}><button className="btn" onClick={() => exportJson(`scan-${selectedScan.id}.json`, selectedScan)}>Exportar scan</button><button className="btn btnGhost" onClick={() => deleteScan(selectedScan.id)}>Eliminar scan</button><a className="btn" href="/review?source=latest">Vista rapida</a><a className="btn btnPrimary" href="/lists">Ver en listas</a></div></> : <p className="fine">Selecciona un snapshot del historial.</p>}</div>
    </section>

    {selectedScan && <section className="card">
      <h2>Candidatas del snapshot</h2>
      <div className="tableWrap">
        <table className="table">
          <thead><tr>{["★", "Ticker", "Empresa", "Tema", metricShortLabel("stage"), "Cambios", "3M", "6M", "12M", metricShortLabel("weinsteinScore"), metricShortLabel("minerviniScore"), metricShortLabel("rsQualityScore"), metricShortLabel("weaknessScore"), metricShortLabel("riskScore"), metricShortLabel("objectiveScore"), "Acciones"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{selectedRows.map((r) => {
            const trustSignature = rowTrustSignatureForRow(r);
            return <tr key={r.symbol}>
            <td><button className="starBtn" onClick={() => favFromRow(r)}>★</button></td>
            <td><a className="ticker" href={stockUrl(r.symbol)}>{r.symbol}</a><DecisionTraceBadge resolution={decisionResolutionForRow(r, reviewState)} /></td>
            <td>{r.companyName}<br /><span className="fine">{shortBusiness(r)}</span><RowTrustSignature signature={trustSignature} className="researchRowTrustSignature" /></td>
            <td><span className="pill">{rowTheme(r)}</span></td>
            <td>{r.stageLabel || r.methodology?.stageState?.label || "-"}</td>
            <td>{(r.methodologyEvents || []).slice(0, 2).map((event) => event.label).join(" · ") || "-"}</td>
            <td><ResearchTrustMetric row={r} metricKey="perf3m" label="3M" value={pct(r.perf3m)} /></td>
            <td><ResearchTrustMetric row={r} metricKey="perf6m" label="6M" value={pct(r.perf6m)} /></td>
            <td><ResearchTrustMetric row={r} metricKey="perf12m" label="12M" value={pct(r.perf12m)} /></td>
            <td><ResearchTrustMetric row={r} metricKey="weinsteinScore" label={metricShortLabel("weinsteinScore")} value={num(r.weinsteinScore)} /></td>
            <td><ResearchTrustMetric row={r} metricKey="minerviniScore" label={metricShortLabel("minerviniScore")} value={num(r.minerviniScore)} /></td>
            <td><ResearchTrustMetric row={r} metricKey="rsQualityScore" label={metricShortLabel("rsQualityScore")} value={num(r.rsQualityScore)} /></td>
            <td><ResearchTrustMetric row={r} metricKey="weaknessScore" label={metricShortLabel("weaknessScore")} value={num(r.weaknessScore)} /></td>
            <td><ResearchTrustMetric row={r} metricKey="riskScore" label={metricShortLabel("riskScore")} value={num(r.riskScore)} /></td>
            <td className="ticker"><ResearchTrustMetric row={r} metricKey="objectiveScore" label={metricShortLabel("objectiveScore")} value={num(metricValue(r, "objectiveScore"))} /></td>
            <td><div className="actionCell"><a className="btn btnSmall" href={stockUrl(r.symbol)}>Ficha</a><a className="btn btnSmall" href={externalLinks(r.symbol).tradingView} target="_blank" rel="noreferrer">TV</a></div></td>
          </tr>;
          })}</tbody>
        </table>
      </div>
    </section>}

    <footer className="card footer">Local-first con sincronizacion opcional.</footer>
  </main>;
}
