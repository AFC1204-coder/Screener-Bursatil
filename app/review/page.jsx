"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clamp, num, pct, ratio } from "@/lib/formatters";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { countryCode, externalLinks, isTradingViewWidgetBlocked, stockUrl } from "@/lib/symbols";

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function value(row = {}, key) {
  return row[key] ?? row.snapshot?.[key] ?? null;
}
function cleanObject(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && !(typeof v === "number" && Number.isNaN(v))));
}
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
function sourceLabel(source) {
  if (source === "favorites") return "Favoritos";
  if (source === "latest") return "Ultimo snapshot";
  if (source === "current") return "Screener actual";
  return "Cola guardada";
}
function rowSource(source, review, scans, favorites) {
  if (source === "favorites") return favoriteRows(favorites);
  if (source === "latest") return normalizeRows(scans[0]?.rows || []);
  if (source === "current" && review?.rows?.length) return normalizeRows(review.rows);
  if (review?.rows?.length) return normalizeRows(review.rows);
  if (scans[0]?.rows?.length) return normalizeRows(scans[0].rows);
  return favoriteRows(favorites);
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
function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, item) => sum + item, 0) / xs.length : null;
}
function stdev(values = []) {
  const mean = avg(values);
  if (!Number.isFinite(mean) || values.length < 2) return null;
  return Math.sqrt(avg(values.map((item) => (item - mean) ** 2)));
}
function barsAsc(bars = []) {
  return [...bars]
    .filter((bar) => bar?.date && Number.isFinite(bar.close))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}
function chartPreviewFromBars(bars = [], limit = 180) {
  const asc = barsAsc(bars);
  const enriched = asc.map((bar, index) => {
    const windowAvg = (n) => index >= n - 1 ? avg(asc.slice(index - n + 1, index + 1).map((x) => x.close)) : null;
    return {
      date: bar.date,
      close: bar.close,
      volume: Number.isFinite(bar.volume) ? bar.volume : 0,
      sma50: windowAvg(50),
      sma200: windowAvg(200),
    };
  });
  return enriched.slice(-limit);
}
function deriveTechnicalFromBars(bars = []) {
  const asc = barsAsc(bars);
  const latest = asc.at(-1);
  if (!latest) return {};
  const close = latest.close;
  const slice = (n, offset = 0) => asc.slice(Math.max(0, asc.length - offset - n), asc.length - offset);
  const sma = (n, offset = 0) => avg(slice(n, offset).map((bar) => bar.close));
  const highDistance = (n) => {
    const high = Math.max(...slice(n).map((bar) => Number.isFinite(bar.high) ? bar.high : bar.close).filter(Number.isFinite));
    return Number.isFinite(high) && high > 0 ? ((close / high) - 1) * 100 : null;
  };
  const perfDays = (n) => {
    const previous = asc.at(-1 - n)?.close;
    return Number.isFinite(previous) && previous > 0 ? ((close / previous) - 1) * 100 : null;
  };
  const returns = [];
  for (let i = Math.max(1, asc.length - 63); i < asc.length; i += 1) {
    const now = asc[i]?.close;
    const prev = asc[i - 1]?.close;
    if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) returns.push((now / prev) - 1);
  }
  const volatility63d = Number.isFinite(stdev(returns)) ? stdev(returns) * Math.sqrt(252) * 100 : null;
  const drawdownRows = slice(63);
  let peak = drawdownRows[0]?.close || close;
  let maxDrawdown63d = 0;
  for (const bar of drawdownRows) {
    peak = Math.max(peak, bar.close);
    if (peak > 0) maxDrawdown63d = Math.max(maxDrawdown63d, ((peak - bar.close) / peak) * 100);
  }
  const avgVol20 = avg(slice(20, 1).map((bar) => bar.volume));
  const avgVol5 = avg(slice(5).map((bar) => bar.volume));
  const prevVol20 = avg(slice(20, 5).map((bar) => bar.volume));
  const relativeVolume = Number.isFinite(avgVol20) && avgVol20 > 0 ? (latest.volume || 0) / avgVol20 : null;
  const volumeSurgePct = Number.isFinite(avgVol5) && Number.isFinite(prevVol20) && prevVol20 > 0 ? ((avgVol5 / prevVol20) - 1) * 100 : null;
  const s50 = sma(50);
  const s150 = sma(150);
  const s200 = sma(200);
  const s200Prev = sma(200, 30);
  const perf3m = perfDays(63);
  const volumeEffectScore = Number.isFinite(relativeVolume) || Number.isFinite(volumeSurgePct)
    ? clamp(Math.max(0, ((relativeVolume || 1) - 1) * 35) + Math.max(0, volumeSurgePct || 0) * .4 + (asc.at(-1)?.close >= asc.at(-2)?.close ? 15 : 0), 0, 100)
    : null;
  return cleanObject({
    price: close,
    lastDate: latest.date,
    chartPreview: chartPreviewFromBars(asc),
    sma50: s50,
    sma150: s150,
    sma200: s200,
    sma200Slope: Number.isFinite(s200) && Number.isFinite(s200Prev) && s200Prev > 0 ? ((s200 / s200Prev) - 1) * 100 : null,
    extSma50: Number.isFinite(s50) && s50 > 0 ? ((close / s50) - 1) * 100 : null,
    distance20d: highDistance(20),
    distance50d: highDistance(50),
    distance52w: highDistance(252),
    highsSpreadPct: Number.isFinite(highDistance(20)) && Number.isFinite(highDistance(50)) ? Math.abs(highDistance(20) - highDistance(50)) : null,
    perf3m,
    perf6m: perfDays(126),
    perf12m: perfDays(252),
    avgVolume: avgVol20,
    latestVolume: latest.volume,
    relativeVolume,
    volumeSurgePct,
    volumeEffectScore,
    volatility63d,
    maxDrawdown63d,
    returnToVol3m: Number.isFinite(perf3m) && Number.isFinite(volatility63d) && volatility63d > 0 ? perf3m / volatility63d : null,
    returnToDrawdown3m: Number.isFinite(perf3m) && maxDrawdown63d > 0 ? perf3m / maxDrawdown63d : null,
  });
}
async function fetchJson(url, signal, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!text.trim()) throw new Error("Proveedor sin respuesta");
    const data = JSON.parse(text);
    if (data?.error) throw new Error(data.error);
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abort);
  }
}
async function hydrateReviewRow(row = {}, signal) {
  const symbol = row.symbol;
  let brief = null;
  try {
    brief = await fetchJson(`/api/company-brief?symbol=${encodeURIComponent(symbol)}`, signal, 14000);
  } catch {}
  if (brief) {
    const technical = deriveTechnicalFromBars(brief.chartBars || []);
    const rs = brief.relativeStrength || {};
    return cleanObject({
      ...technical,
      companyName: brief.name || row.companyName,
      sector: brief.sector || row.sector,
      industry: brief.industry || row.industry,
      exchange: brief.exchange || row.exchange,
      currency: brief.currency || row.currency,
      country: brief.country || row.country,
      theme: brief.theme || row.theme,
      logoDomain: brief.visual?.domain || row.logoDomain,
      website: brief.links?.official || row.website,
      benchmarkSymbol: rs.benchmarkSymbol || row.benchmarkSymbol,
      rsRating: rs.rating ?? row.rsRating,
      rsGlobalPct: rs.rating ?? row.rsGlobalPct,
      rsQualityScore: rs.rsQualityScore ?? row.rsQualityScore,
      speculationRiskScore: rs.speculationRiskScore ?? row.speculationRiskScore,
      rs3m: rs.rs3m ?? row.rs3m,
      rs6m: rs.rs6m ?? row.rs6m,
      rs12m: rs.rs12m ?? row.rs12m,
      perf3m: rs.perf3m ?? technical.perf3m ?? row.perf3m,
      perf6m: rs.perf6m ?? technical.perf6m ?? row.perf6m,
      perf12m: rs.perf12m ?? technical.perf12m ?? row.perf12m,
      shortPercentOfFloat: brief.growthMetrics?.shortPercentOfFloat ?? row.shortPercentOfFloat,
    });
  }
  const chart = await fetchJson(`/api/chart?symbol=${encodeURIComponent(symbol)}`, signal, 9000);
  return deriveTechnicalFromBars(chart.bars || []);
}
function MiniSparkline({ bars = [] }) {
  const points = bars.filter((x) => Number.isFinite(x.close));
  if (points.length < 2) return <div className="previewEmpty">Sin dato</div>;
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
  return <svg className={`miniSparkline ${trendClass}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grafico tecnico compacto">
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
function TradingViewPanel({ row }) {
  const ref = useRef(null);
  const tvSymbol = row ? externalLinks(row.symbol, row.exchange).tradingViewSymbol : "";
  useEffect(() => {
    if (!ref.current || !tvSymbol) return;
    const container = ref.current;
    container.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: "D",
      range: "6M",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "es",
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);
    return () => {
      script.remove();
      container.innerHTML = "";
    };
  }, [tvSymbol]);
  return <div className="reviewChart reviewTvChart"><div className="tradingview-widget-container" ref={ref} /></div>;
}
function ReviewChartPanel({ row, loading = false }) {
  const links = row ? externalLinks(row.symbol, row.exchange) : {};
  const tvSymbol = links.tradingViewSymbol || "";
  const useTradingView = row && tvSymbol && !isTradingViewWidgetBlocked(row.symbol, tvSymbol);
  if (useTradingView) return <TradingViewPanel row={row} />;
  const bars = row?.chartPreview || [];
  return <div className="reviewChart">
    {bars.length > 1 ? <MiniSparkline bars={bars} /> : <div className="previewEmpty">{loading ? "Cargando datos..." : "Sin grafico disponible"}</div>}
  </div>;
}
function objectiveStage(row = {}) {
  const price = value(row, "price");
  const sma50 = value(row, "sma50");
  const sma150 = value(row, "sma150");
  const sma200 = value(row, "sma200");
  const slope = value(row, "sma200Slope");
  if ([price, sma50, sma150, sma200].every(Number.isFinite) && price > sma50 && sma50 > sma150 && sma150 > sma200 && slope > 0) return "Precio > SMA50 > SMA150 > SMA200";
  if (Number.isFinite(price) && Number.isFinite(sma200) && price < sma200) return "Precio < SMA200";
  if (Number.isFinite(price) && Number.isFinite(sma50) && price < sma50) return "Precio < SMA50";
  if (Number.isFinite(price) && Number.isFinite(sma200) && price > sma200) return "Precio > SMA200";
  return "Historico insuficiente";
}
function snapshotForFavorite(row = {}) {
  const keys = ["totalScore", "compositeScore", "setupQualityScore", "demandScore", "growthScore", "weinsteinScore", "minerviniScore", "momentumScore", "riskScore", "riskRewardScore", "volumeScore", "volumeEffectScore", "volumeEvidence", "avgVolume", "latestVolume", "avgTurnover", "latestTurnover", "relativeVolume", "volumeSurgePct", "upDownVolRatio", "shortPercentOfFloat", "shortRatio", "sharesShort", "floatShares", "liquidityScore", "rsRating", "rsGlobalPct", "rsCountryPct", "rsSectorPct", "rsQualityScore", "weaknessScore", "weaknessLabel", "weaknessReasons", "sectorScore", "perf3m", "perf6m", "perf12m", "distance20d", "distance50d", "distance52w", "extSma50", "volatility63d", "maxDrawdown63d", "returnToVol3m", "returnToDrawdown3m", "theme", "businessEs"];
  return Object.fromEntries(keys.map((key) => [key, value(row, key)]).filter(([, v]) => v !== undefined && v !== null));
}
function favoriteFromRow(row = {}) {
  return {
    id: uid(),
    symbol: row.symbol,
    companyName: row.companyName || row.symbol,
    country: row.country || countryCode(row.symbol),
    sector: row.sector,
    industry: row.industry,
    addedAt: new Date().toISOString(),
    entryPrice: Number.isFinite(value(row, "price")) ? value(row, "price") : null,
    lastPrice: Number.isFinite(value(row, "price")) ? value(row, "price") : null,
    lastDate: row.lastDate || null,
    source: "review",
    notes: "",
    snapshot: snapshotForFavorite(row),
  };
}
function metricRows(row = {}) {
  return [
    ["RS global", `p${num(value(row, "rsGlobalPct") ?? value(row, "rsRating"))}`],
    ["RS pais", `p${num(value(row, "rsCountryPct"))}`],
    ["RS sector", `p${num(value(row, "rsSectorPct"))}`],
    ["3M", pct(value(row, "perf3m"))],
    ["6M", pct(value(row, "perf6m"))],
    ["12M", pct(value(row, "perf12m"))],
    ["SMA50", pct(value(row, "extSma50"))],
    ["Vol rel 20d", ratio(value(row, "relativeVolume"))],
    ["Volume effect", num(value(row, "volumeEffectScore"))],
    ["Short float", pct(value(row, "shortPercentOfFloat"))],
    ["Vol 63d", pct(value(row, "volatility63d"))],
    ["DD 63d", pct(Number.isFinite(value(row, "maxDrawdown63d")) ? -value(row, "maxDrawdown63d") : null)],
    ["R/Vol 3M", ratio(value(row, "returnToVol3m"))],
    ["R/DD 3M", ratio(value(row, "returnToDrawdown3m"))],
  ];
}
function evidenceRows(row = {}) {
  return [
    ["Estructura", objectiveStage(row)],
    ["Distancia 20d high", pct(value(row, "distance20d"))],
    ["Distancia 52w high", pct(value(row, "distance52w"))],
    ["Extension SMA50", pct(value(row, "extSma50"))],
    ["Highs spread", pct(value(row, "highsSpreadPct"))],
    ["Volumen relativo", ratio(value(row, "relativeVolume"))],
    ["Evidencia volumen", value(row, "volumeEvidence") || "-"],
    ["Flota en corto", pct(value(row, "shortPercentOfFloat"))],
    ["Benchmark", value(row, "benchmarkSymbol") || "-"],
    ["Deterioro tecnico", num(value(row, "weaknessScore"))],
  ];
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
  const [hydration, setHydration] = useState({});

  function loadSource(nextSource = source, keepState = false, startSymbol = "") {
    const review = safeRead(STORAGE_KEYS.review, {});
    const scans = safeRead(STORAGE_KEYS.scans, []);
    const favs = safeRead(STORAGE_KEYS.favorites, []);
    const nextRows = rowSource(nextSource, review, scans, favs);
    const symbolIndex = startSymbol ? nextRows.findIndex((row) => row.symbol === String(startSymbol).toUpperCase()) : -1;
    setSource(nextSource);
    setRows(nextRows);
    setFavorites(favs);
    setCurrentIndex(symbolIndex >= 0 ? symbolIndex : keepState ? clamp(review.currentIndex || 0, 0, Math.max(0, nextRows.length - 1)) : 0);
    setReviewed(new Set(keepState ? review.reviewedSymbols || [] : []));
    setHidden(new Set(keepState ? review.hiddenSymbols || [] : []));
    setStatus(`${sourceLabel(nextSource)} · ${nextRows.length} acciones`);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const review = safeRead(STORAGE_KEYS.review, {});
    loadSource(params.get("source") || review.source || "current", true, params.get("symbol") || review.selectedSymbol || "");
  }, []);

  const favoriteSymbols = useMemo(() => new Set(favorites.map((f) => String(f.symbol).toUpperCase())), [favorites]);
  const visibleRows = useMemo(() => showHidden ? rows : rows.filter((row) => !hidden.has(row.symbol)), [rows, hidden, showHidden]);
  const activeBaseRow = visibleRows[currentIndex] || visibleRows[0] || null;
  const activeHydration = activeBaseRow ? hydration[activeBaseRow.symbol] : null;
  const activeRow = useMemo(() => activeBaseRow ? normalizeRow({ ...activeBaseRow, ...(activeHydration?.row || {}) }) : null, [activeBaseRow, activeHydration]);
  const activeSymbol = activeRow?.symbol || "";
  const activeHydrating = activeHydration?.status === "loading";

  useEffect(() => {
    if (currentIndex >= visibleRows.length) setCurrentIndex(Math.max(0, visibleRows.length - 1));
  }, [currentIndex, visibleRows.length]);

  useEffect(() => {
    if (!activeBaseRow?.symbol) return;
    const symbol = activeBaseRow.symbol;
    const alreadyUsable = activeBaseRow.chartPreview?.length > 1
      && Number.isFinite(value(activeBaseRow, "perf3m"))
      && Number.isFinite(value(activeBaseRow, "relativeVolume"));
    if (alreadyUsable || hydration[symbol]?.status === "loading" || hydration[symbol]?.status === "ready") return;
    const controller = new AbortController();
    setHydration((prev) => ({ ...prev, [symbol]: { status: "loading" } }));
    hydrateReviewRow(activeBaseRow, controller.signal)
      .then((patch) => {
        if (!patch || controller.signal.aborted) return;
        setHydration((prev) => ({ ...prev, [symbol]: { status: "ready", row: patch } }));
        setRows((prev) => prev.map((row) => row.symbol === symbol ? normalizeRow({ ...row, ...patch, snapshot: { ...(row.snapshot || {}), ...patch } }) : row));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setHydration((prev) => ({ ...prev, [symbol]: { status: "error", error: error.message || "Proveedor no disponible" } }));
      });
    return () => controller.abort();
  }, [activeBaseRow?.symbol]);

  useEffect(() => {
    if (!rows.length) return;
    safeWrite(STORAGE_KEYS.review, {
      source,
      rows,
      currentIndex,
      selectedSymbol: activeSymbol,
      reviewedSymbols: [...reviewed],
      hiddenSymbols: [...hidden],
      updatedAt: new Date().toISOString(),
    });
  }, [source, rows, currentIndex, reviewed, hidden]);

  function move(delta) {
    setCurrentIndex((index) => visibleRows.length ? (index + delta + visibleRows.length) % visibleRows.length : 0);
  }
  function toggleFavorite(row = activeRow) {
    if (!row) return;
    const symbol = row.symbol;
    const next = favoriteSymbols.has(symbol)
      ? favorites.filter((favorite) => String(favorite.symbol).toUpperCase() !== symbol)
      : [favoriteFromRow(row), ...favorites].slice(0, 300);
    setFavorites(next);
    safeWrite(STORAGE_KEYS.favorites, next);
    setStatus(favoriteSymbols.has(symbol) ? `${symbol} eliminado de favoritos locales` : `${symbol} guardado en favoritos locales`);
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

  useEffect(() => {
    function onKeyDown(event) {
      const tag = event.target?.tagName?.toLowerCase();
      if (["input", "textarea", "select", "button"].includes(tag)) return;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") { event.preventDefault(); move(1); }
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") { event.preventDefault(); move(-1); }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFavorite(); }
      if (event.key === "Enter" && activeRow) { event.preventDefault(); window.location.href = stockUrl(activeRow.symbol); }
      if (event.key.toLowerCase() === "t" && activeRow) { event.preventDefault(); window.open(externalLinks(activeRow.symbol, activeRow.exchange).tradingView, "_blank", "noreferrer"); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRow, favorites, favoriteSymbols, visibleRows.length]);

  return <main className="page reviewPage">
    <section className="card hero">
      <div className="heroTop">
        <div>
          <div className="badge">STATS EDGE · Rapid Review</div>
          <h1>Vista rapida</h1>
        </div>
        <div className="mobileActions">
          <button className={`btn ${source === "current" ? "btnActive" : ""}`} onClick={() => loadSource("current")}>Cola actual</button>
          <button className={`btn ${source === "latest" ? "btnActive" : ""}`} onClick={() => loadSource("latest")}>Ultimo snapshot</button>
          <button className={`btn ${source === "favorites" ? "btnActive" : ""}`} onClick={() => loadSource("favorites")}>Favoritos</button>
          <a className="btn" href="/">Screener</a>
        </div>
      </div>
    </section>

    <section className="card reviewStatus">
      <div className="kpis">
        <div className="kpi"><b>{visibleRows.length}</b><span>acciones en cola</span></div>
        <div className="kpi"><b>{currentIndex + (visibleRows.length ? 1 : 0)}</b><span>posicion actual</span></div>
        <div className="kpi"><b>{reviewed.size}</b><span>revisadas</span></div>
        <div className="kpi"><b>{hidden.size}</b><span>ocultas</span></div>
      </div>
      <div className="controls reviewControls">
        <button className="btn" onClick={() => move(-1)} disabled={!visibleRows.length}>Anterior</button>
        <button className="btn btnPrimary" onClick={() => move(1)} disabled={!visibleRows.length}>Siguiente</button>
        <button className="btn" onClick={() => toggleFavorite()} disabled={!activeRow}>{favoriteSymbols.has(activeSymbol) ? "Quitar favorito" : "Favorito"}</button>
        <button className="btn" onClick={() => markReviewed()} disabled={!activeRow}>Revisada</button>
        <button className="btn btnGhost" onClick={() => hideActive()} disabled={!activeRow}>Ocultar</button>
        <button className={`btn btnGhost ${showHidden ? "btnActive" : ""}`} onClick={() => setShowHidden((x) => !x)}>Ver ocultas</button>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>{status}</div>
    </section>

    {!visibleRows.length ? <section className="card emptyState">
      <h2>Sin cola de revision</h2>
      <div className="controls"><a className="btn btnPrimary" href="/">Ir al screener</a><a className="btn" href="/research-desk">Research Desk</a></div>
    </section> : <section className="reviewWorkbench">
      <aside className="reviewQueue">
        <div className="reviewQueueHead">
          <h2>{sourceLabel(source)}</h2>
          <span>{visibleRows.length} visibles</span>
        </div>
        <div className="reviewQueueList">
          {visibleRows.map((row, index) => {
            const active = activeRow?.symbol === row.symbol;
            return <button key={row.symbol} className={`reviewQueueItem ${active ? "active" : ""}`} onClick={() => setCurrentIndex(index)}>
              <CompanyMark row={row} size="sm" />
              <span><b>{row.symbol}</b><em>{row.companyName || row.symbol}</em></span>
              <i>{num(value(row, "totalScore") ?? value(row, "compositeScore"))}</i>
            </button>;
          })}
        </div>
      </aside>

      <section className="reviewMain">
        <div className="reviewFocus">
          <div className="reviewFocusHeader">
            <span className="reviewIdentity"><CompanyMark row={activeRow} size="lg" /><span><b>{activeRow.symbol}</b><em>{activeRow.companyName || activeRow.symbol}</em></span></span>
            <span className="reviewMeta">{activeRow.country || countryCode(activeRow.symbol)} · {activeRow.theme || activeRow.sector || "Sin sector"}</span>
          </div>
          <ReviewChartPanel row={activeRow} loading={activeHydrating} />
          <div className="reviewFloatingNav" aria-label="Navegacion de acciones">
            <button type="button" onClick={() => move(-1)} aria-label="Accion anterior">↑</button>
            <span>{currentIndex + 1}<em>/</em>{visibleRows.length}</span>
            <button type="button" onClick={() => move(1)} aria-label="Accion siguiente">↓</button>
          </div>
          {activeRow.chartPreview?.length ? <div className="reviewSpark"><MiniSparkline bars={activeRow.chartPreview} /></div> : null}
        </div>
      </section>

      <aside className="reviewSide">
        <div className="reviewActionStrip">
          <a className="btn btnPrimary" href={stockUrl(activeRow.symbol)}>Ficha</a>
          <a className="btn" href={externalLinks(activeRow.symbol, activeRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
          <button className={`starBtn ${favoriteSymbols.has(activeSymbol) ? "on" : ""}`} onClick={() => toggleFavorite(activeRow)} aria-label={`Favorito ${activeRow.symbol}`}>★</button>
        </div>
        {activeHydrating && <div className="dataNote" style={{ marginBottom: 10 }}>Cargando historico y metricas...</div>}
        <div className="reviewMetricGrid">
          {metricRows(activeRow).map(([label, metric]) => <span key={label}><b>{label}</b>{metric}</span>)}
        </div>
        <div className="reviewEvidence">
          <div className="sectionTitle"><h2>Evidencia medible</h2></div>
          {evidenceRows(activeRow).map(([label, metric]) => <div className="summaryRow" key={label}><span>{label}</span><b>{metric}</b></div>)}
        </div>
        <div className="reviewNotes">
          <div className="summaryRow"><span>Estado local</span><b>{reviewed.has(activeSymbol) ? "Revisada" : "Pendiente"}</b></div>
          <div className="summaryRow"><span>Favorito local</span><b>{favoriteSymbols.has(activeSymbol) ? "Si" : "No"}</b></div>
        </div>
      </aside>
    </section>}
  </main>;
}
