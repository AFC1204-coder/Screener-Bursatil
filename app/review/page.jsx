"use client";
import "../../styles/review.css";

// Cola de revisión, tras la limpieza del 2026-08-24
// (docs/analisis-vista-rapida-2026-08-24.md). La misma operación que la ficha
// el 22-08 y la vista rápida hoy: el producto clasifica, no recomienda
// (docs/principios-producto.md §1) y el diagnóstico interno no es un dato del
// valor (§2).
//
// RETIRADO de esta pantalla, con su contenido:
//
//   - El resumen de cola por decisión del motor («357 ESPERAR · 150 AUDITAR ·
//     69 DESCARTAR») y las facetas de digest/prioridad/perfil. Queda la
//     faceta de RESOLUCIÓN, que es la clasificación del propio inversor.
//   - Los chips de veredicto por fila («Esperar confirmación», «Auditar
//     antes», foco, método, datos, métricas, score, digest «PRUEBAS OK 9/9 ·
//     Setup objetivo 100») y la firma de confianza. La fila conserva
//     identidad, la clasificación del inversor y el RS canónico.
//   - La prioridad de investigación («889 · DECISION 660 · ACCIÓN 55 · SCORE
//     OBJETIVO 195 · PERCENTIL LOTE 114 · −190 Candidato no operable»):
//     constantes del motor de ordenación (lib/decisionAudit.js), no datos.
//   - El panel «Decisión Screener» (tesis/riesgo/siguiente) y la tira de
//     pruebas: eran la recomendación («Esperar confirmación», «Resolver o
//     esperar: …») que el principio 1 prohíbe.
//   - Del grid de métricas: el «RS» que en realidad era el percentil del
//     lote (rsGlobalPct) — prohibido bajo esa etiqueta por
//     lib/rsCanonical.js —, RS Benchmark, RS país/grupo (percentiles del
//     mismo lote, que la ficha declara ausentes con motivo), y los scores
//     del motor (Composite, A/D, EPS proxy, Volume Effect). El RS que se
//     muestra es ÚNICO: el ranking semanal del universo (canonicalRs).
//   - De la evidencia medible: «Deterioro» (score interno) y «Evidencia
//     volumen» (el criterio del motor como texto).
//   - Las marcas de procedencia por celda (proxy «p», bloqueada «x»):
//     diagnóstico del programa presentado como atributo del dato.
//   - La nota automática de la resolución, que guardaba el veredicto del
//     motor pegado a la decisión del inversor.
//
// SE CONSERVA lo que es de esta pantalla: la navegación entre valores (su
// razón de ser), los botones de clasificar con su historial, favoritos,
// ocultar/revisada, y los datos del valor (gráfico, rendimientos, etapa con
// su evidencia, RS canónico, volumen, volatilidad).
//
// Chart: preview close-only del foco se hidrata (miniaturas del scan, sin brief).
// RowPriceChart pinta línea al instante y pide OHLC en paralelo.
// Fallo de OHLC → emptyFallback / provider-unavailable (A2-CHART).

import { useEffect, useMemo, useRef, useState } from "react";
import RowPriceChart from "@/app/RowPriceChart";
import { useReviewChartPrefetch } from "@/app/useReviewChartPrefetch";
import { useReviewChartPreviewHydrate } from "@/app/useReviewChartPreviewHydrate";
import { getJson } from "@/lib/clientApi";
import { readChartSettings } from "@/lib/chartSettings";
import { deleteFavoriteFromCloud, syncFavoriteToCloud } from "@/lib/cloudSyncClient";
import { clamp, dateTime } from "@/lib/formatters";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { mergeReviewRowChartPreviews, persistReviewQueue } from "@/lib/screenerPipeline";
import {
  applyChartPreviewsToRows,
  peekCachedChartPreviews,
} from "@/lib/scansChartPreviewHydrate";
import {
  resolveReviewScanCloudId,
  collectReviewSymbolsForChartPreviewHydrate,
} from "@/lib/reviewChartPreviewHydrate";
import StorageAlert from "@/app/components/StorageAlert";
import { userFacingServiceError } from "@/lib/serviceErrors";
import { evidenceRows } from "@/lib/reviewEvidence";
import { buildReviewMetricRows } from "@/lib/reviewMetricGrid";
import { reviewRsCell } from "@/lib/reviewRsDisplay";
import { canonicalRs } from "@/lib/rsCanonical";
import { prepareReviewQueueRows } from "@/lib/decisionProfile";
import { buildReviewQueueNavigation } from "@/lib/reviewQueueNavigation";
import { resolveReviewFocus, reviewFocusStatusMessage } from "@/lib/reviewSession";
import { buildReviewPageHref } from "@/lib/screenerReviewLaunch";
import {
  buildSingleSymbolReviewRow,
  defaultReviewQueueCollapsed,
  SINGLE_SYMBOL_QUEUE_MODE,
  singleSymbolReviewStatus,
  shouldUseSingleSymbolReview,
} from "@/lib/reviewPath";
import { buildReviewStockOpenContext } from "@/lib/reviewStockContext";
import { SCREENER_SESSION_VERSION } from "@/lib/screenerConfig";
import { STOCK_DECISION_ACTIONS, applyStockDecisionResolution, buildStockDecisionResolutionSummary, decisionResolutionForSymbol, decisionResolutionHistory, filterRowsByDecisionResolution, reopenStockDecisionResolution, reviewDecisionStateForRows, stockDecisionResolutionFilter } from "@/lib/stockDecisionResolution";
import { createFavoriteFromRow } from "@/lib/stockRows";
import { cleanSymbol, countryCode, externalLinks, stockUrl } from "@/lib/symbols";

function normalizeRow(row = {}) {
  const snapshot = row.snapshot || {};
  return { ...snapshot, ...row, snapshot };
}
function normalizeRows(rows = []) {
  return Array.from(new Map(rows.filter(Boolean).map(normalizeRow).filter((r) => r.symbol).map((r) => [String(r.symbol).toUpperCase(), { ...r, symbol: String(r.symbol).toUpperCase() }])).values());
}
function favoriteRows(favorites = []) {
  return normalizeRows(favorites.map((favorite) => ({ ...(favorite.snapshot || {}), ...favorite, sourceType: "favorite" })));
}
function sourceLabel(source, meta = {}) {
  const customLabel = source === "current" ? String(meta?.sourceLabel || "").trim() : "";
  if (customLabel) return customLabel;
  if (source === "favorites") return "Favoritos";
  if (source === "latest") return "Último snapshot";
  if (source === "current") return "Screener actual";
  return "Cola guardada";
}
function sourceMetaForReview(source = "current", review = {}) {
  if (source !== "current") return {};
  return {
    sourceLabel: String(review?.sourceLabel || "").trim(),
    sourceDetail: String(review?.sourceDetail || "").trim(),
    queueMode: String(review?.queueMode || "").trim(),
  };
}
function investorStatusLabel(text = "") {
  return String(text || "")
    .replaceAll("Supabase", "nube")
    .replaceAll("favoritos locales", "favoritos")
    .replaceAll("localmente", "en este dispositivo")
    .replaceAll("Proveedor", "Datos");
}
function shortDateTime(value = "") {
  if (!value) return "";
  const label = dateTime(value);
  return label === "-" ? String(value).slice(0, 16) : label;
}
function rowSource(source, review, scans, favorites) {
  if (source === "favorites") return favoriteRows(favorites);
  if (source === "latest") return normalizeRows(scans[0]?.rows || []);
  if (source === "current" && review?.rows?.length) return normalizeRows(review.rows);
  if (review?.rows?.length) return normalizeRows(review.rows);
  if (scans[0]?.rows?.length) return normalizeRows(scans[0].rows);
  return favoriteRows(favorites);
}
function discoveryRowsFromPayload(data = {}) {
  const listRows = Array.isArray(data.lists)
    ? data.lists.flatMap((list) => Array.isArray(list.items) ? list.items : [])
    : [];
  const groupRows = data.groups && typeof data.groups === "object"
    ? Object.values(data.groups).flatMap((groups) => Array.isArray(groups)
      ? groups.flatMap((group) => Array.isArray(group.items) ? group.items : [])
      : [])
    : [];
  return normalizeRows([...(Array.isArray(data.rows) ? data.rows : []), ...listRows, ...groupRows]);
}
async function fetchDiscoveryReviewRows(signal) {
  const params = new URLSearchParams({
    limit: "80",
    groupItemLimit: "8",
    groupsLimit: "16",
    maxRows: "120",
    sinceDays: "14",
    minGroupSize: "1",
  });
  const data = await fetchJson(`/api/discovery?${params.toString()}`, signal, 18000);
  return discoveryRowsFromPayload(data);
}
function domainFromUrl(url = "") {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function initials(name = "", symbol = "") {
  return String(name || symbol).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || String(symbol).slice(0, 2).toUpperCase() || "SE";
}
function CompanyMark({ row, size = "md" }) {
  const domain = row.logoDomain || domainFromUrl(row.website || "");
  const logo = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : "";
  return <span className={`companyMark companyMark-${size}`}>
    {logo ? <img src={logo} alt="" loading="lazy" /> : <b>{initials(row.companyName, row.symbol)}</b>}
  </span>;
}
function chartPath(points, key, x, y) {
  return points.map((p, i) => {
    const current = p[key];
    if (!Number.isFinite(current)) return "";
    return `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(current).toFixed(1)}`;
  }).filter(Boolean).join(" ");
}
async function fetchJson(url, signal, timeoutMs = 12000) {
  return getJson(url, { signal, timeoutMs });
}
function MiniSparkline({ bars = [] }) {
  // Tolerante al orden: ver lib/screenerAtoms.jsx MiniSparkline.
  const points = bars
    .filter((x) => Number.isFinite(x.close))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (points.length < 2) return <div className="previewEmpty">Sin serie</div>;
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
  return <svg className={`miniSparkline ${trendClass}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Gráfico técnico compacto">
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
// Gráfico de la pantalla de revisión: el mismo de la ficha, vía el envoltorio
// compartido. `RowPriceChart` pinta el preview close-only en línea al instante
// y pide OHLC real para velas cuando el estilo pedido es vela.
const REVIEW_CHART_SETTINGS = {
  ...readChartSettings({ scope: "quickReview" }),
  range: "6M",
  interval: "D",
  style: "1",
  scale: "price",
};

function ReviewChartPanel({ row }) {
  if (!row?.symbol) {
    return <div className="reviewChart">
      <div className="previewEmpty">Sin gráfico disponible</div>
    </div>;
  }
  return <div className="reviewChart reviewNativeChart">
    <RowPriceChart
      row={row}
      settings={REVIEW_CHART_SETTINGS}
      height={520}
    />
  </div>;
}
export default function ReviewPage() {
  const [source, setSource] = useState("current");
  const [rows, setRows] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [reviewed, setReviewed] = useState(new Set());
  const [hidden, setHidden] = useState(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [status, setStatus] = useState("Listo");
  const [reviewSettings, setReviewSettings] = useState({});
  const [decisionResolutions, setDecisionResolutions] = useState({});
  const [decisionResolutionLog, setDecisionResolutionLog] = useState([]);
  const [resolutionFilter, setResolutionFilter] = useState("all");
  const [sourceMeta, setSourceMeta] = useState({});
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const queueCollapseSeededRef = useRef(false);
  const sourceRequestRef = useRef(0);

  function loadSource(nextSource = source, keepState = false, startSymbol = "") {
    const requestId = sourceRequestRef.current + 1;
    sourceRequestRef.current = requestId;
    const review = safeRead(STORAGE_KEYS.review, {});
    const scans = safeRead(STORAGE_KEYS.scans, []);
    const favs = safeRead(STORAGE_KEYS.favorites, []);
    const nextSettings = nextSource === "latest"
      ? (scans[0]?.activeSettings || scans[0]?.settings?.activeSettings || scans[0]?.settings || {})
      : (review.activeSettings || review.settings?.activeSettings || review.settings || {});
    const sourcedRows = rowSource(nextSource, review, scans, favs);
    let rowsWithPreviews = nextSource === "current"
      ? mergeReviewRowChartPreviews(sourcedRows, scans[0]?.rows || [])
      : sourcedRows;
    // Misma sesión que la mesa: miniaturas ya hidratadas en módulo (Caza/viewport)
    // se reponen al abrir /review sin otro POST.
    if (nextSource === "current") {
      const cloudId = resolveReviewScanCloudId(scans);
      if (cloudId) {
        const focusSymbol = String(startSymbol || review.selectedSymbol || "").trim().toUpperCase();
        const focusIndex = focusSymbol
          ? Math.max(0, rowsWithPreviews.findIndex((row) => String(row?.symbol || "").toUpperCase() === focusSymbol))
          : 0;
        const focusSymbols = collectReviewSymbolsForChartPreviewHydrate(rowsWithPreviews, focusIndex);
        const cached = peekCachedChartPreviews(cloudId, focusSymbols);
        if (Object.keys(cached).length) {
          rowsWithPreviews = applyChartPreviewsToRows(rowsWithPreviews, cached);
        }
      }
    }
    const nextRowsPrepared = prepareReviewQueueRows(rowsWithPreviews, nextSettings || {});
    // P7: /review?symbol=X sin cola → modo 1 símbolo (no empty → home).
    let nextRows = nextRowsPrepared;
    let nextSourceMeta = sourceMetaForReview(nextSource, review);
    const requestedSymbol = cleanSymbol(startSymbol || review.selectedSymbol || "");
    if (
      nextSource === "current"
      && shouldUseSingleSymbolReview({ queueRows: nextRows, symbol: requestedSymbol })
    ) {
      const single = buildSingleSymbolReviewRow(requestedSymbol);
      if (single) {
        nextRows = [single];
        nextSourceMeta = {
          sourceLabel: "1 símbolo",
          sourceDetail: singleSymbolReviewStatus(requestedSymbol),
          queueMode: SINGLE_SYMBOL_QUEUE_MODE,
        };
      }
    }
    const decisionState = reviewDecisionStateForRows(review, nextRows);
    const nextResolutionFilter = keepState ? review.resolutionFilter || "all" : "all";
    const focus = nextSource === "current" && nextRows.length
      ? resolveReviewFocus({ ...review, rows: nextRows }, startSymbol || review.selectedSymbol || "")
      : {
        symbol: startSymbol || review.selectedSymbol || "",
        index: -1,
        resolved: "requested",
        inQueue: false,
        requestedMissing: "",
      };
    const navigation = buildReviewQueueNavigation({
      ...review,
      source: nextSource,
      rows: nextRows,
      activeSettings: nextSettings || {},
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      resolutionFilter: nextResolutionFilter,
      digestFilter: "all",
      selectedSymbol: focus.symbol || review.selectedSymbol || "",
      sourceLabel: nextSourceMeta.sourceLabel || review.sourceLabel,
      sourceDetail: nextSourceMeta.sourceDetail || review.sourceDetail,
      queueMode: nextSourceMeta.queueMode || review.queueMode,
    }, focus.symbol || startSymbol || review.selectedSymbol || "");
    const symbolIndex = navigation.currentIndex;
    setSource(nextSource);
    setSourceMeta(nextSourceMeta);
    setRows(nextRows);
    setFavorites(favs);
    setReviewSettings(nextSettings || {});
    setCurrentIndex(symbolIndex >= 0 ? symbolIndex : keepState ? clamp(review.currentIndex || 0, 0, Math.max(0, navigation.visibleCount - 1)) : 0);
    setReviewed(new Set(decisionState.reviewedSymbols));
    setHidden(new Set(decisionState.hiddenSymbols));
    setDecisionResolutions(decisionState.decisionResolutions);
    setDecisionResolutionLog(decisionState.decisionResolutionLog);
    setResolutionFilter(nextResolutionFilter);
    const singleSymbolMode = nextSourceMeta.queueMode === SINGLE_SYMBOL_QUEUE_MODE;
    const focusMessage = nextSource === "current" ? reviewFocusStatusMessage(focus, nextRows.length) : "";
    setStatus(
      singleSymbolMode
        ? singleSymbolReviewStatus(focus.symbol || requestedSymbol)
        : (focusMessage || `${sourceLabel(nextSource, nextSourceMeta)} · ${nextRows.length} acciones`),
    );
    if (focus.inQueue && focus.symbol && nextSource === "current") {
      const nextHref = buildReviewPageHref(focus.symbol, nextSource);
      if (typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` !== nextHref) {
        window.history.replaceState(null, "", nextHref);
      }
    }
    if (nextSource === "latest" && !nextRows.length) {
      const controller = new AbortController();
      setStatus("Último snapshot · sin cola local; consultando Discovery...");
      fetchDiscoveryReviewRows(controller.signal)
        .then((discoveryRows) => {
          if (sourceRequestRef.current !== requestId) return;
          if (!discoveryRows.length) {
            setStatus("Último snapshot · sin filas locales ni discovery disponible.");
            return;
          }
          const orderedRows = prepareReviewQueueRows(discoveryRows, nextSettings || {});
          const discoveryDecisionState = reviewDecisionStateForRows(review, orderedRows);
          const discoveryNavigation = buildReviewQueueNavigation({
            ...review,
            source: nextSource,
            rows: orderedRows,
            activeSettings: nextSettings || {},
            hiddenSymbols: discoveryDecisionState.hiddenSymbols,
            decisionResolutions: discoveryDecisionState.decisionResolutions,
            resolutionFilter: nextResolutionFilter,
            digestFilter: "all",
          }, startSymbol || review.selectedSymbol || "");
          const discoveryIndex = discoveryNavigation.currentIndex;
          setRows(orderedRows);
          setCurrentIndex(discoveryIndex >= 0 ? discoveryIndex : 0);
          setReviewed(new Set(discoveryDecisionState.reviewedSymbols));
          setHidden(new Set(discoveryDecisionState.hiddenSymbols));
          setDecisionResolutions(discoveryDecisionState.decisionResolutions);
          setDecisionResolutionLog(discoveryDecisionState.decisionResolutionLog);
          setStatus(`Último snapshot · ${orderedRows.length} acciones desde Discovery`);
        })
        .catch((error) => {
          if (sourceRequestRef.current !== requestId) return;
          setStatus(`Último snapshot no disponible: ${error.message || "Discovery no respondió"}`);
        });
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const review = safeRead(STORAGE_KEYS.review, {});
    loadSource(params.get("source") || review.source || "current", true, params.get("symbol") || review.selectedSymbol || "");
  }, []);

  const favoriteSymbols = useMemo(() => new Set(favorites.map((f) => String(f.symbol).toUpperCase())), [favorites]);
  const baseVisibleRows = useMemo(() => showHidden ? rows : rows.filter((row) => !hidden.has(row.symbol)), [rows, hidden, showHidden]);
  const resolutionSummary = useMemo(() => buildStockDecisionResolutionSummary(baseVisibleRows, { decisionResolutions }), [baseVisibleRows, decisionResolutions]);
  const visibleRows = useMemo(() => filterRowsByDecisionResolution(baseVisibleRows, { decisionResolutions }, resolutionFilter), [baseVisibleRows, decisionResolutions, resolutionFilter]);
  const resolvedVisibleCount = useMemo(() => {
    const all = resolutionSummary.find((item) => item.key === "all")?.count || 0;
    const pending = resolutionSummary.find((item) => item.key === "pending")?.count || 0;
    return Math.max(0, all - pending);
  }, [resolutionSummary]);
  const activeResolutionFilter = useMemo(() => stockDecisionResolutionFilter(resolutionFilter), [resolutionFilter]);
  const queueFiltersActive = resolutionFilter !== "all";
  const pendingVisibleCount = resolutionSummary.find((item) => item.key === "pending")?.count || 0;
  const queueEmptyByFilter = queueFiltersActive && baseVisibleRows.length > 0 && !visibleRows.length;
  const queuePendingComplete = queueEmptyByFilter && resolutionFilter === "pending" && !pendingVisibleCount;
  const singleSymbolMode = sourceMeta.queueMode === SINGLE_SYMBOL_QUEUE_MODE;
  const queueEmptyTitle = queuePendingComplete
    ? "Cola pendiente completada"
    : queueEmptyByFilter
      ? "Sin acciones para este filtro"
      : "Sin cola de revisión";
  const queueEmptyDetail = queuePendingComplete
    ? `${sourceLabel(source, sourceMeta)} · no quedan acciones pendientes en esta cola.`
    : queueEmptyByFilter
      ? `${sourceLabel(source, sourceMeta)} · ${activeResolutionFilter.label} no tiene resultados ahora.`
      : "Carga una cola desde el Screener o abre un ticker (search → ficha) para revisar sin callejón.";

  useEffect(() => {
    if (queueCollapseSeededRef.current) return;
    if (!visibleRows.length) return;
    queueCollapseSeededRef.current = true;
    const width = typeof window !== "undefined" ? window.innerWidth : 1440;
    setQueueCollapsed(defaultReviewQueueCollapsed({
      visibleCount: visibleRows.length,
      viewportWidth: width,
    }));
  }, [visibleRows.length]);
  const queueCompletionResolution = queuePendingComplete
    ? resolutionSummary.find((item) => ["candidate", "watch", "reject"].includes(item.key) && item.count > 0)
    : null;
  const queueCompletionActionLabel = queueCompletionResolution
    ? ({
      candidate: "Ver candidatas",
      watch: "Ver vigilancia",
      reject: "Ver descartadas",
    }[queueCompletionResolution.key] || `Ver ${queueCompletionResolution.label.toLowerCase()}`)
    : "";
  const reviewStatusText = queuePendingComplete
    ? `${sourceLabel(source, sourceMeta)} · cola pendiente completada · ${resolvedVisibleCount}/${baseVisibleRows.length} resueltas`
    : queueEmptyByFilter
      ? `${sourceLabel(source, sourceMeta)} · ${activeResolutionFilter.label} · 0/${baseVisibleRows.length} visibles`
      : queueFiltersActive
        ? `${sourceLabel(source, sourceMeta)} · ${activeResolutionFilter.label} · ${visibleRows.length}/${baseVisibleRows.length} visibles`
        : status;
  const reviewStatusLineClassName = [
    "reviewStatusLine",
    queueFiltersActive ? "filtered" : "",
    queueEmptyByFilter ? "empty" : "",
    queuePendingComplete ? "complete" : "",
  ].filter(Boolean).join(" ");
  const activeBaseRow = visibleRows[currentIndex] || visibleRows[0] || null;
  const activeRow = useMemo(() => activeBaseRow ? normalizeRow(activeBaseRow) : null, [activeBaseRow]);
  const activeSymbol = activeRow?.symbol || "";
  const activeResolution = useMemo(() => decisionResolutionForSymbol({ decisionResolutions }, activeSymbol), [decisionResolutions, activeSymbol]);
  const activeResolutionHistory = useMemo(
    () => decisionResolutionHistory({ decisionResolutions, decisionResolutionLog }, { symbol: activeSymbol, limit: 4 }),
    [decisionResolutions, decisionResolutionLog, activeSymbol],
  );

  useReviewChartPrefetch({
    enabled: source === "current" && visibleRows.length > 0,
    focusSymbol: activeSymbol,
    visibleRows,
    currentIndex,
    chartSettings: REVIEW_CHART_SETTINGS,
  });

  useReviewChartPreviewHydrate({
    enabled: source === "current" && visibleRows.length > 0,
    visibleRows,
    currentIndex,
    setRows,
  });

  useEffect(() => {
    if (currentIndex >= visibleRows.length) setCurrentIndex(Math.max(0, visibleRows.length - 1));
  }, [currentIndex, visibleRows.length]);

  useEffect(() => {
    if (!activeSymbol || source !== "current") return;
    const nextHref = buildReviewPageHref(activeSymbol, source);
    if (typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` !== nextHref) {
      window.history.replaceState(null, "", nextHref);
    }
  }, [activeSymbol, source]);

  useEffect(() => {
    if (!rows.length) return;
    const previousReview = safeRead(STORAGE_KEYS.review, {});
    persistReviewQueue({
      ...previousReview,
      source,
      sourceLabel: sourceMeta.sourceLabel || "",
      sourceDetail: sourceMeta.sourceDetail || "",
      queueMode: sourceMeta.queueMode || "",
      rows,
      activeSettings: reviewSettings,
      currentIndex,
      selectedSymbol: activeSymbol,
      reviewedSymbols: [...reviewed],
      hiddenSymbols: [...hidden],
      decisionResolutions,
      decisionResolutionLog,
      resolutionFilter,
      digestFilter: "all",
      updatedAt: new Date().toISOString(),
    });
  }, [source, sourceMeta, rows, reviewSettings, currentIndex, reviewed, hidden, decisionResolutions, decisionResolutionLog, resolutionFilter, activeSymbol]);

  function move(delta) {
    setCurrentIndex((index) => visibleRows.length ? (index + delta + visibleRows.length) % visibleRows.length : 0);
  }
  function toggleFavorite(row = activeRow) {
    if (!row) return;
    const symbol = row.symbol;
    const next = favoriteSymbols.has(symbol)
      ? favorites.filter((favorite) => String(favorite.symbol).toUpperCase() !== symbol)
      : [createFavoriteFromRow(row, { source: "review" }), ...favorites].slice(0, 300);
    setFavorites(next);
    safeWrite(STORAGE_KEYS.favorites, next);
    if (favoriteSymbols.has(symbol)) {
      deleteFavoriteFromCloud({ symbol }).then((result) => {
        if (result.configured === false) setStatus(`${symbol} eliminado de los favoritos de este dispositivo. La copia en la nube no está activada.`);
        else if (result.ok) setStatus(`${symbol} eliminado de favoritos y sincronizado con la nube.`);
        else {
          console.error("[favoritos] no se pudo sincronizar el borrado con la nube:", result.message);
          setStatus(`${symbol} eliminado en este dispositivo. ${userFacingServiceError(result.message, "No se pudo sincronizar con la nube.")}`);
        }
      });
      setStatus(`${symbol} eliminado de los favoritos de este dispositivo. Sincronizando con la nube...`);
    } else {
      const favorite = next.find((item) => String(item.symbol).toUpperCase() === symbol);
      syncFavoriteToCloud(favorite).then((result) => {
        if (result.configured === false) setStatus(`${symbol} guardado en este dispositivo. La copia en la nube no está activada.`);
        else if (result.ok) setStatus(`${symbol} guardado en favoritos y sincronizado con la nube.`);
        else {
          console.error("[favoritos] no se pudo sincronizar con la nube:", result.message);
          setStatus(`${symbol} guardado en este dispositivo. ${userFacingServiceError(result.message, "No se pudo sincronizar con la nube.")}`);
        }
      });
      setStatus(`${symbol} guardado en los favoritos de este dispositivo. Sincronizando con la nube...`);
    }
  }
  function markReviewed(row = activeRow) {
    if (!row) return;
    setReviewed((prev) => new Set([...prev, row.symbol]));
    move(1);
  }
  function hideActive(row = activeRow) {
    if (!row) return;
    setHidden((prev) => new Set([...prev, row.symbol]));
    setStatus(`${row.symbol} oculto de esta cola`);
    move(1);
  }
  // La nota de la resolución viaja vacía: antes se componía con el veredicto
  // del motor (nextAction/risk) y la clasificación del inversor quedaba
  // registrada con una recomendación pegada. Mismo criterio que la ficha
  // (22-08) y la vista rápida (24-08).
  function resolveActiveDecision(actionKey, row = activeRow) {
    if (!row?.symbol) return;
    const nextReview = applyStockDecisionResolution({
      source,
      sourceLabel: sourceMeta.sourceLabel || "",
      sourceDetail: sourceMeta.sourceDetail || "",
      queueMode: sourceMeta.queueMode || "",
      rows,
      activeSettings: reviewSettings,
      currentIndex,
      selectedSymbol: row.symbol,
      reviewedSymbols: [...reviewed],
      hiddenSymbols: [...hidden],
      decisionResolutions,
      decisionResolutionLog,
      resolutionFilter,
    }, {
      symbol: row.symbol,
      actionKey,
      source: "review",
      note: "",
    });
    setReviewed(new Set(nextReview.reviewedSymbols || []));
    setHidden(new Set(nextReview.hiddenSymbols || []));
    setDecisionResolutions(nextReview.decisionResolutions || {});
    setDecisionResolutionLog(nextReview.decisionResolutionLog || []);
    persistReviewQueue(nextReview);
    const resolution = decisionResolutionForSymbol(nextReview, row.symbol);
    setStatus(`${row.symbol}: ${resolution?.label || "resuelta"} desde Review`);
  }
  function reopenActiveDecision(row = activeRow) {
    if (!row?.symbol) return;
    const nextReview = reopenStockDecisionResolution({
      source,
      sourceLabel: sourceMeta.sourceLabel || "",
      sourceDetail: sourceMeta.sourceDetail || "",
      queueMode: sourceMeta.queueMode || "",
      rows,
      activeSettings: reviewSettings,
      currentIndex,
      selectedSymbol: row.symbol,
      reviewedSymbols: [...reviewed],
      hiddenSymbols: [...hidden],
      decisionResolutions,
      decisionResolutionLog,
      resolutionFilter,
    }, {
      symbol: row.symbol,
      source: "review",
      note: activeResolution?.label ? `Antes: ${activeResolution.label}` : "",
    });
    setReviewed(new Set(nextReview.reviewedSymbols || []));
    setHidden(new Set(nextReview.hiddenSymbols || []));
    setDecisionResolutions(nextReview.decisionResolutions || {});
    setDecisionResolutionLog(nextReview.decisionResolutionLog || []);
    persistReviewQueue(nextReview);
    setStatus(`${row.symbol}: reabierta como pendiente`);
  }
  function applyResolutionFilter(nextFilter) {
    setResolutionFilter(nextFilter);
    setCurrentIndex(0);
  }
  function clearQueueFilters() {
    setResolutionFilter("all");
    setCurrentIndex(0);
  }
  function showResolutionQueue(filterKey = "all") {
    setResolutionFilter(filterKey);
    setCurrentIndex(0);
  }
  function saveStockOpenContext(row = activeRow, index = currentIndex) {
    if (!row?.symbol) return;
    const openedAt = new Date().toISOString();
    const previousSession = safeRead(STORAGE_KEYS.screenerSession, {}) || {};
    const context = buildReviewStockOpenContext(row, {
      settings: reviewSettings,
      source,
      sourceLabel: sourceLabel(source, sourceMeta),
      sourceDetail: sourceMeta.sourceDetail || "",
      queueMode: sourceMeta.queueMode || "",
      digestFilter: "all",
      resolutionFilter,
      rank: Number.isFinite(index) ? index + 1 : null,
      queueSize: visibleRows.length,
      rowsCount: rows.length,
      visibleCount: visibleRows.length,
      hiddenCount: Math.max(0, rows.length - visibleRows.length),
      openedAt,
    });
    safeWrite(STORAGE_KEYS.screenerSession, {
      ...previousSession,
      version: previousSession.version || SCREENER_SESSION_VERSION,
      lastOpenedStockSymbol: row.symbol,
      lastOpenedStockAt: openedAt,
      lastOpenedStockContext: context,
    });
  }
  useEffect(() => {
    function onKeyDown(event) {
      const tag = event.target?.tagName?.toLowerCase();
      if (["input", "textarea", "select", "button"].includes(tag)) return;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") { event.preventDefault(); move(1); }
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") { event.preventDefault(); move(-1); }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFavorite(); }
      if (event.key === "Enter" && activeRow) { event.preventDefault(); saveStockOpenContext(activeRow, currentIndex); window.location.href = stockUrl(activeRow.symbol); }
      if (event.key.toLowerCase() === "t" && activeRow) { event.preventDefault(); window.open(externalLinks(activeRow.symbol, activeRow.exchange).tradingView, "_blank", "noreferrer"); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRow, currentIndex, favorites, favoriteSymbols, reviewSettings, rows.length, source, visibleRows.length]);

  return <main className={`page reviewPage ${queueCollapsed ? "reviewQueueIsCollapsed" : ""}`.trim()}>
    <StorageAlert />
    <section className="card hero">
      <div className="heroTop">
        <div>
          <h1>Vista rápida</h1>
        </div>
        <div className="mobileActions">
          <button className={`btn ${source === "current" ? "btnActive" : ""}`} onClick={() => loadSource("current")}>Cola actual</button>
          <button className={`btn ${source === "latest" ? "btnActive" : ""}`} onClick={() => loadSource("latest")}>Último snapshot</button>
          <button className={`btn ${source === "favorites" ? "btnActive" : ""}`} onClick={() => loadSource("favorites")}>Favoritos</button>
          <a className="btn" href="/">Screener</a>
        </div>
      </div>
    </section>

    <section className="card reviewStatus">
      <div className="kpis">
        <div className="kpi"><b>{visibleRows.length}</b><span>{singleSymbolMode ? "símbolo" : queueFiltersActive ? "acciones filtradas" : "acciones en cola"}</span></div>
        <div className="kpi"><b>{currentIndex + (visibleRows.length ? 1 : 0)}</b><span>posición actual</span></div>
        <div className="kpi"><b>{reviewed.size}</b><span>revisadas</span></div>
        <div className="kpi"><b>{resolvedVisibleCount}</b><span>resueltas ficha</span></div>
        <div className="kpi"><b>{hidden.size}</b><span>ocultas</span></div>
      </div>
      <div className="controls reviewControls">
        <button className="btn" onClick={() => move(-1)} disabled={!visibleRows.length || singleSymbolMode}>Anterior</button>
        <button className="btn btnPrimary" onClick={() => move(1)} disabled={!visibleRows.length || singleSymbolMode}>Siguiente</button>
        <button className="btn" onClick={() => toggleFavorite()} disabled={!activeRow}>{favoriteSymbols.has(activeSymbol) ? "Quitar favorito" : "Favorito"}</button>
        <button className="btn" onClick={() => markReviewed()} disabled={!activeRow}>Revisada</button>
        <button className="btn btnGhost" onClick={() => hideActive()} disabled={!activeRow || singleSymbolMode}>Ocultar</button>
        <button className={`btn btnGhost ${showHidden ? "btnActive" : ""}`} onClick={() => setShowHidden((x) => !x)}>Ver ocultas</button>
        {visibleRows.length > 1 ? (
          <button
            type="button"
            className={`btn btnGhost reviewQueueToggle ${queueCollapsed ? "isCollapsed" : ""}`.trim()}
            onClick={() => setQueueCollapsed((value) => !value)}
            aria-expanded={!queueCollapsed}
            aria-controls="review-queue-panel"
          >
            {queueCollapsed ? "Mostrar cola" : "Ocultar cola"}
          </button>
        ) : null}
      </div>
      <div className={reviewStatusLineClassName}>{investorStatusLabel(reviewStatusText)}</div>
    </section>

    {!visibleRows.length ? <section className={`card emptyState reviewEmptyState ${queueEmptyByFilter ? "filtered" : ""} ${queuePendingComplete ? "complete" : ""}`.trim()}>
      <div className="emptyStateHead">
        <span>{queuePendingComplete ? "Trabajo cerrado" : queueFiltersActive ? "Filtro activo" : "Review"}</span>
        <h2>{queueEmptyTitle}</h2>
        <p className="fine">{queueEmptyDetail}</p>
      </div>
      <div className="reviewEmptyMetrics" aria-label="Resumen de cola vacía">
        <span><b>{baseVisibleRows.length}</b><em>en cola</em></span>
        <span><b>{pendingVisibleCount}</b><em>pendientes</em></span>
        <span><b>{resolvedVisibleCount}</b><em>resueltas</em></span>
      </div>
      <div className="controls reviewEmptyActions">
        {queueCompletionResolution ? <button className="btn btnPrimary" onClick={() => showResolutionQueue(queueCompletionResolution.key)}>{queueCompletionActionLabel}</button> : null}
        {queueFiltersActive ? <button className={`btn ${queueCompletionResolution ? "" : "btnPrimary"}`.trim()} onClick={clearQueueFilters}>Quitar filtros</button> : <a className="btn btnPrimary" href="/">Ir al screener</a>}
        <a className="btn" href="/">Screener</a>
        <a className="btn" href="/research-desk">Research Desk</a>
      </div>
    </section> : <section className={`reviewWorkbench ${queueCollapsed ? "queueCollapsed" : ""}`.trim()}>
      <aside className={`reviewQueue ${queueCollapsed ? "isCollapsed" : ""}`.trim()} id="review-queue-panel" aria-hidden={queueCollapsed}>
        <div className="reviewQueueHead">
          <h2>{sourceLabel(source, sourceMeta)}</h2>
          {sourceMeta.sourceDetail ? <small className="reviewQueueSourceDetail">{sourceMeta.sourceDetail}</small> : null}
          <span>{resolutionFilter === "all" ? `${baseVisibleRows.length} visibles` : `${visibleRows.length}/${baseVisibleRows.length} visibles`}</span>
          <button
            type="button"
            className="btn btnGhost btnSmall reviewQueueCollapseBtn"
            onClick={() => setQueueCollapsed(true)}
            aria-label="Colapsar cola"
          >
            «
          </button>
        </div>
        {resolutionSummary.length > 1 ? <div className="reviewQueueSummary reviewResolutionSummary" aria-label="Resumen de cola por clasificación del inversor">
          {resolutionSummary.map((group) => (
            <button
              type="button"
              key={group.key}
              className={`reviewQueueSummaryChip ${group.tone || "neutral"} ${resolutionFilter === group.key ? "active" : ""}`}
              onClick={() => applyResolutionFilter(group.key)}
              title={group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label}
            >
              <b>{group.count}</b>
              <span>{group.label}</span>
            </button>
          ))}
        </div> : null}
        <div className="reviewQueueList">
          {visibleRows.map((row, index) => {
            const active = activeRow?.symbol === row.symbol;
            const resolution = decisionResolutionForSymbol({ decisionResolutions }, row.symbol);
            const rowRs = reviewRsCell(canonicalRs(row), {
              availableTitle: "RS semanal del universo",
            });
            return <button
              key={row.symbol}
              className={`reviewQueueItem ${active ? "active" : ""} ${resolution ? `resolved-${resolution.key}` : ""}`}
              onClick={() => setCurrentIndex(index)}
              title={resolution ? `${resolution.label} · ${resolution.detail}` : row.companyName || row.symbol}
            >
              <CompanyMark row={row} size="sm" />
              <span className="reviewQueueBody">
                <b>{row.symbol}</b>
                <em>{row.companyName || row.symbol}</em>
                {resolution ? <span className="reviewQueueDecisionLine">
                  <span className={`reviewQueueResolutionBadge ${resolution.tone || "neutral"}`}>{resolution.label}</span>
                </span> : null}
              </span>
              <i className={rowRs.className || undefined} title={rowRs.title || undefined}>{rowRs.text}</i>
            </button>;
          })}
        </div>
      </aside>

      {queueCollapsed && visibleRows.length > 1 ? (
        <button
          type="button"
          className="reviewQueueExpandRail"
          onClick={() => setQueueCollapsed(false)}
          aria-label="Mostrar cola de revisión"
          title="Mostrar cola"
        >
          <span>Cola</span>
          <b>{visibleRows.length}</b>
        </button>
      ) : null}

      <section className="reviewMain">
        <div className="reviewFocus">
          <div className="reviewFocusHeader">
            <span className="reviewIdentity"><CompanyMark row={activeRow} size="lg" /><span><b>{activeRow.symbol}</b><em>{activeRow.companyName || activeRow.symbol}</em></span></span>
            <span className="reviewMeta">{activeRow.country || countryCode(activeRow.symbol)} · {activeRow.theme || activeRow.sector || "Sin sector"}</span>
          </div>
          <ReviewChartPanel row={activeRow} />
          <div className="reviewFloatingNav" aria-label="Navegación de acciones">
            <button type="button" onClick={() => move(-1)} aria-label="Acción anterior" disabled={singleSymbolMode}>↑</button>
            <span>{currentIndex + 1}<em>/</em>{visibleRows.length}</span>
            <button type="button" onClick={() => move(1)} aria-label="Acción siguiente" disabled={singleSymbolMode}>↓</button>
          </div>
          {activeRow.chartPreview?.length ? <div className="reviewSpark"><MiniSparkline bars={activeRow.chartPreview} /></div> : null}
        </div>
      </section>

      <aside className="reviewSide">
        <div className="reviewActionStrip">
          <a className="btn btnPrimary" href={stockUrl(activeRow.symbol)} onPointerDown={() => saveStockOpenContext(activeRow, currentIndex)} onClick={() => saveStockOpenContext(activeRow, currentIndex)}>Ficha</a>
          <a className="btn" href={externalLinks(activeRow.symbol, activeRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
          <button className={`starBtn ${favoriteSymbols.has(activeSymbol) ? "on" : ""}`} onClick={() => toggleFavorite(activeRow)} aria-label={`Favorito ${activeRow.symbol}`}>★</button>
        </div>
        <div className="reviewMetricGrid">
          {buildReviewMetricRows(activeRow).map(({ label, text, title = "", className = "" }) => <span key={label}>
            <b>{label}</b>
            <em className={className || undefined} title={title || undefined}>{text}</em>
          </span>)}
        </div>
        <div className="reviewEvidence">
          <div className="sectionTitle"><h2>Evidencia medible</h2></div>
          {evidenceRows(activeRow).map(([label, metric, title = ""]) => <div className="summaryRow" key={label}><span>{label}</span><b title={title || undefined}>{metric}</b></div>)}
        </div>
        <div className="reviewNotes">
          <div className="summaryRow"><span>Estado local</span><b>{reviewed.has(activeSymbol) ? "Revisada" : "Pendiente"}</b></div>
          {activeResolution ? <div className="summaryRow">
            <span>Clasificación</span>
            <b>{activeResolution.label}</b>
          </div> : null}
          <div className="summaryRow"><span>Favorito local</span><b>{favoriteSymbols.has(activeSymbol) ? "Sí" : "No"}</b></div>
        </div>
        <div className="reviewResolveRail" aria-label="Clasificar desde Review">
          <span>Clasificar</span>
          <div>
            <button
              type="button"
              className={`neutral ${!activeResolution ? "active" : ""}`.trim()}
              onClick={() => reopenActiveDecision(activeRow)}
              title="Vuelve a pendiente"
              disabled={!activeResolution}
            >
              Reabrir
            </button>
            {STOCK_DECISION_ACTIONS.map((item) => <button
              type="button"
              key={item.key}
              className={`${item.tone || ""} ${activeResolution?.key === item.key ? "active" : ""}`.trim()}
              onClick={() => resolveActiveDecision(item.key, activeRow)}
              title={item.detail}
            >
              {item.label}
            </button>)}
          </div>
        </div>
        {activeResolutionHistory.length ? <div className="reviewDecisionHistory">
          <div className="sectionTitle"><h2>Historial decisión</h2></div>
          {activeResolutionHistory.map((entry) => <div className={`decisionHistoryItem ${entry.tone || ""}`} key={`${entry.symbol}-${entry.key}-${entry.updatedAt}-${entry.note}`}>
            <span><b>{entry.label}</b><em>{shortDateTime(entry.updatedAt) || entry.source}</em></span>
            {entry.note ? <p>{entry.note}</p> : <p>{entry.detail}</p>}
          </div>)}
        </div> : null}
      </aside>
    </section>}
  </main>;
}
