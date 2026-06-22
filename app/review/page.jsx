"use client";
import "../../styles/review.css";

import { useEffect, useMemo, useRef, useState } from "react";
import RowTrustSignature from "@/app/RowTrustSignature";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { TrustMetric } from "@/app/components/ui/MetricSource";
import { getJson } from "@/lib/clientApi";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import { deleteFavoriteFromCloud, syncFavoriteToCloud } from "@/lib/cloudSyncClient";
import { clamp, num, pct, ratio } from "@/lib/formatters";
import { stdev } from "@/lib/indicators";
import { safeRead, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { objectiveStage } from "@/lib/scoring";
import { DECISION_QUEUE_DIGEST_FILTERS, buildDecisionQueueDigest, buildDecisionQueueDigestSummary, buildDecisionQueueItem, buildDecisionQueueSummary } from "@/lib/screenerExplainability";
import { buildReviewPrioritySummary, buildReviewProfileSummary, decisionProfileForRow, prepareReviewQueueRows, reviewPriorityForRow, reviewProfileMeta } from "@/lib/decisionProfile";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit } from "@/lib/screenerScoreAudit";
import { buildReviewQueueNavigation } from "@/lib/reviewQueueNavigation";
import { buildReviewStockOpenContext } from "@/lib/reviewStockContext";
import { SCREENER_SESSION_VERSION } from "@/lib/screenerConfig";
import { STOCK_DECISION_ACTIONS, applyStockDecisionResolution, buildStockDecisionResolutionSummary, decisionResolutionForSymbol, decisionResolutionHistory, filterRowsByDecisionResolution, reopenStockDecisionResolution, reviewDecisionStateForRows, stockDecisionResolutionFilter } from "@/lib/stockDecisionResolution";
import { createFavoriteFromRow } from "@/lib/stockRows";
import { countryCode, externalLinks, isTradingViewWidgetBlocked, stockUrl } from "@/lib/symbols";
import { vcpReliabilityAudit } from "@/lib/vcpDiagnostics";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";

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
function reviewQueueMetricTruthMeta(row = {}) {
  const status = objectiveMetricAuditStatusForRow(row);
  const audit = status.audit || null;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const usable = items.filter((item) => item?.status === "verified" || item?.status === "traceable");
  const measuredCount = usable.filter((item) => item?.proxy !== true).length;
  const proxyCount = usable.filter((item) => item?.proxy === true).length;
  const detail = [
    status.detail,
    measuredCount ? `${measuredCount} medidas` : "",
    proxyCount ? `${proxyCount} proxy` : "",
  ].filter(Boolean).join(" · ");
  if (status.key === "bad") return { key: "blocked", label: "Bloq.", tone: "bad", detail, measuredCount, proxyCount };
  if (status.key === "warn") return { key: "review", label: "Rev.", tone: "warn", detail, measuredCount, proxyCount };
  if (status.key === "missing") return { key: "missing", label: "Sin audit", tone: "warn", detail: status.detail || "Sin auditoria numerica.", measuredCount: 0, proxyCount: 0 };
  return {
    key: proxyCount ? "mixed" : "measured",
    label: proxyCount ? "Mixto" : "Med.",
    tone: proxyCount ? "neutral" : "good",
    detail,
    measuredCount,
    proxyCount,
  };
}
function ReviewTrustMetric({ row = {}, metricKey = "", label = "", value: displayValue = "-" }) {
  return <TrustMetric row={row} metricKey={metricKey} label={label} value={displayValue} baseClass="reviewTrustMetric" variant="strong" valueTag="em" />;
}
function reviewQueueDataHealthMeta(row = {}, settings = {}) {
  const health = buildScreenerDataHealth(row, settings);
  const key = health.status?.key || "unknown";
  return {
    key,
    label: key === "ready" ? "OK" : key === "blocked" ? "Bloq." : key === "stale" ? "Viejo" : key === "thin" || key === "limited" ? "Parcial" : health.status?.label || "Datos",
    tone: health.status?.tone || "neutral",
    detail: [health.status?.detail, health.topLine].filter(Boolean).join(" · "),
  };
}
function reviewQueueScoreAuditMeta(row = {}) {
  const audit = buildScreenerScoreAudit(row);
  const residualWarn = Number.isFinite(audit?.residual) && Math.abs(audit.residual) >= 4;
  const missing = Array.isArray(audit?.missing) && audit.missing.length;
  const key = residualWarn ? "mismatch" : missing ? "missing" : audit?.integrityTone === "good" ? "clean" : "attention";
  return {
    key,
    label: key === "clean" ? "Traz." : key === "mismatch" ? "Desc." : key === "missing" ? "Inc." : "Rev.",
    tone: key === "clean" ? "good" : "warn",
    detail: [audit?.topLine, Number.isFinite(audit?.residual) ? `Delta ${audit.residual.toFixed(1)}` : ""].filter(Boolean).join(" · "),
  };
}
function reviewQueueFocusMeta({ dataHealth = null, metricTruth = null, scoreAudit = null, evidence = null, methodologyFocus = null, vcp = null } = {}) {
  const candidates = [];
  const add = (item) => { if (item?.key && item?.label) candidates.push(item); };
  if (dataHealth?.key === "blocked") add({ priority: 100, key: "data", label: "Datos", tone: "bad", detail: dataHealth.detail });
  if (metricTruth?.key === "blocked") add({ priority: 95, key: "metrics", label: "Metr.", tone: "bad", detail: metricTruth.detail });
  if (scoreAudit?.key === "mismatch") add({ priority: 86, key: "score", label: "Score", tone: "warn", detail: scoreAudit.detail });
  if (["review", "missing"].includes(metricTruth?.key)) add({ priority: 82, key: "metrics", label: "Metr.", tone: "warn", detail: metricTruth.detail });
  if (["blocked", "inconsistent", "needs-data"].includes(vcp?.key)) add({ priority: vcp.key === "blocked" ? 80 : 70, key: "vcp", label: "VCP", tone: vcp.tone || "warn", detail: vcp.summary || vcp.note });
  if (dataHealth?.key && dataHealth.key !== "ready") add({ priority: 72, key: "data", label: "Datos", tone: dataHealth.tone || "warn", detail: dataHealth.detail });
  if (scoreAudit?.key === "missing") add({ priority: 70, key: "score", label: "Score", tone: "warn", detail: scoreAudit.detail });
  if (evidence?.status === "blocked") add({ priority: 68, key: "evidence", label: "Pruebas", tone: "bad", detail: evidence.summary });
  if (methodologyFocus?.tone === "bad" || methodologyFocus?.tone === "warn") add({ priority: methodologyFocus.tone === "bad" ? 66 : 54, key: "method", label: "Método", tone: methodologyFocus.tone, detail: methodologyFocus.detail || methodologyFocus.label });
  if (evidence?.status === "needs-work") add({ priority: 62, key: "evidence", label: "Pruebas", tone: evidence.tone || "warn", detail: evidence.pending?.[0]?.detail || evidence.pending?.[0]?.label || evidence.summary });
  if (scoreAudit?.key === "attention") add({ priority: 50, key: "score", label: "Score", tone: "warn", detail: scoreAudit.detail });
  return candidates.sort((a, b) => b.priority - a.priority)[0] || null;
}
function ReviewQueueFocusBadge({ focus = null }) {
  if (!focus) return null;
  return <span className={`reviewQueueFocusBadge ${focus.tone || "warn"} focus-${focus.key || "other"}`} title={focus.detail || focus.label}>Foco {focus.label}</span>;
}
function shortDateTime(value = "") {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : String(value).slice(0, 16);
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
function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, item) => sum + item, 0) / xs.length : null;
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
  return getJson(url, { signal, timeoutMs });
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
    const benchmarkRating = rs.benchmarkRating ?? rs.rsRating ?? null;
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
      rsRating: benchmarkRating ?? row.rsRating,
      rsGlobalPct: rs.rsGlobalPct ?? row.rsGlobalPct,
      rsCountryPct: rs.rsCountryPct ?? row.rsCountryPct,
      rsSectorPct: rs.rsSectorPct ?? row.rsSectorPct,
      rsQualityScore: rs.rsQualityScore ?? row.rsQualityScore,
      speculationRiskScore: rs.speculationRiskScore ?? row.speculationRiskScore,
      rs3m: rs.rs3m ?? row.rs3m,
      rs6m: rs.rs6m ?? row.rs6m,
      rs12m: rs.rs12m ?? row.rs12m,
      perf3m: rs.perf3m ?? technical.perf3m ?? row.perf3m,
      perf6m: rs.perf6m ?? technical.perf6m ?? row.perf6m,
      perf12m: rs.perf12m ?? technical.perf12m ?? row.perf12m,
      shortPercentOfFloat: brief.growthMetrics?.shortPercentOfFloat ?? row.shortPercentOfFloat,
      relativeStrength: rs.series || null,
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
  const bars = row?.chartPreview || [];
  const reviewSettings = {
    ...DEFAULT_CHART_SETTINGS,
    range: "6M",
    interval: "D",
    style: "1",
    scale: "price",
    indicators: { ...DEFAULT_CHART_SETTINGS.indicators, rsLine: true },
  };
  if (bars.length > 1) {
    return <div className="reviewChart reviewNativeChart">
      <UniversalPriceChart bars={bars} symbol={row.symbol} currency={row.currency} tradingViewUrl={links.tradingView} settings={reviewSettings} relativeStrength={row.relativeStrength} rsMainScore={row.rsGlobalPct} benchmarkSymbol={row.benchmarkSymbol} height={520} />
    </div>;
  }
  return <div className="reviewChart">
    <div className="previewEmpty">{loading ? "Cargando datos..." : "Sin grafico disponible"}</div>
  </div>;
}
function metricRows(row = {}) {
  return [
    [metricShortLabel("totalScore"), num(value(row, "totalScore")), "totalScore"],
    [metricShortLabel("rsGlobalPct"), num(value(row, "rsGlobalPct")), "rsGlobalPct"],
    [metricShortLabel("rsRating"), num(value(row, "rsRating")), "rsRating"],
    [metricShortLabel("rsCountryPct"), num(value(row, "rsCountryPct")), "rsCountryPct"],
    [metricShortLabel("rsSectorPct"), num(value(row, "rsSectorPct")), "rsSectorPct"],
    [metricShortLabel("adProxyScore"), num(value(row, "adProxyScore")), "adProxyScore"],
    [metricShortLabel("epsGrowthProxyScore"), num(value(row, "epsGrowthProxyScore")), "epsGrowthProxyScore"],
    ["3M", pct(value(row, "perf3m")), "perf3m"],
    ["6M", pct(value(row, "perf6m")), "perf6m"],
    ["12M", pct(value(row, "perf12m")), "perf12m"],
    ["SMA50", pct(value(row, "extSma50")), "extSma50"],
    ["Vol rel 20d", ratio(value(row, "relativeVolume")), "relativeVolume"],
    [metricShortLabel("volumeEffectScore"), num(value(row, "volumeEffectScore")), "volumeEffectScore"],
    [metricShortLabel("shortPercentOfFloat"), pct(value(row, "shortPercentOfFloat")), "shortPercentOfFloat"],
    ["Vol 63d", pct(value(row, "volatility63d")), "volatility63d"],
    ["DD 63d", pct(Number.isFinite(value(row, "maxDrawdown63d")) ? -value(row, "maxDrawdown63d") : null), "maxDrawdown63d"],
    ["R/Vol 3M", ratio(value(row, "returnToVol3m")), "returnToVol3m"],
    ["R/DD 3M", ratio(value(row, "returnToDrawdown3m")), "returnToDrawdown3m"],
  ];
}
function evidenceRows(row = {}) {
  return [
    [metricShortLabel("stage"), objectiveStage(row)],
    ["Distancia 20d high", pct(value(row, "distance20d"))],
    ["Distancia 52w high", pct(value(row, "distance52w"))],
    ["Extension SMA50", pct(value(row, "extSma50"))],
    ["Highs spread", pct(value(row, "highsSpreadPct"))],
    ["Volumen relativo", ratio(value(row, "relativeVolume"))],
    ["Evidencia volumen", value(row, "volumeEvidence") || "-"],
    [metricShortLabel("shortPercentOfFloat"), pct(value(row, "shortPercentOfFloat"))],
    ["Benchmark", value(row, "benchmarkSymbol") || "-"],
    [metricShortLabel("weaknessScore"), num(value(row, "weaknessScore"))],
  ];
}

function DecisionEvidenceStrip({ evidence = null }) {
  if (!evidence || typeof evidence !== "object") return null;
  const pending = Array.isArray(evidence.pending) ? evidence.pending.filter((item) => item?.label || item?.key) : [];
  const confirmed = Array.isArray(evidence.items) ? evidence.items.filter((item) => item?.status === "confirmed" && (item.label || item.key)) : [];
  const items = (pending.length ? pending : confirmed).slice(0, pending.length ? 3 : 2);
  if (!items.length) return null;
  const ratio = Number.isFinite(Number(evidence.passedCount)) && Number.isFinite(Number(evidence.totalCount))
    ? `${Number(evidence.passedCount)}/${Number(evidence.totalCount)}`
    : "";
  return <div className={`reviewDecisionEvidence ${evidence.tone || ""}`}>
    <span><b>{pending.length ? "Pruebas pendientes" : "Pruebas confirmadas"}</b>{ratio ? <em>{ratio}</em> : null}</span>
    <div>
      {items.map((item) => <small key={item.key || item.label} className={item.tone || ""} title={item.detail || item.label}>
        {item.label || item.key}
      </small>)}
    </div>
  </div>;
}

function ReviewDecisionPanel({ decision = null }) {
  if (!decision) return null;
  const cards = [
    decision.thesis ? { key: "thesis", ...decision.thesis } : null,
    decision.risk ? { key: "risk", ...decision.risk } : null,
    decision.nextAction ? { key: "nextAction", ...decision.nextAction } : null,
  ].filter((item) => item?.value || item?.detail);
  return <div className={`reviewDecisionPanel ${decision.tone || ""}`}>
    <div className="sectionTitle"><h2>Decisión Screener</h2></div>
    {cards.length ? <div className="reviewDecisionCards">
      {cards.map((item) => <span key={item.key} className={item.tone || ""}>
        <em>{item.label || item.key}</em>
        <b title={item.value}>{item.value}</b>
        {item.detail ? <small title={item.detail}>{item.detail}</small> : null}
      </span>)}
    </div> : null}
    <DecisionEvidenceStrip evidence={decision.evidence} />
  </div>;
}

function ReviewPriorityPanel({ priority = null }) {
  if (!priority) return null;
  const components = Array.isArray(priority.priority?.components) ? priority.priority.components.slice(0, 4) : [];
  const penalties = Array.isArray(priority.priority?.penalties) ? priority.priority.penalties.slice(0, 3) : [];
  return <div className={`reviewPriorityPanel ${priority.tone || ""}`} aria-label="Prioridad de investigacion">
    <div className="reviewPriorityHead">
      <span><b>{priority.label}</b><em>{priority.reason}</em></span>
      <strong>{Math.round(priority.score || 0)}</strong>
    </div>
    {components.length ? <div className="reviewPriorityComponents">
      {components.map((item) => <span key={item.key} title={item.detail || item.label}>
        <em>{item.label}</em>
        <b>{Math.round(item.value || 0)}</b>
      </span>)}
    </div> : null}
    {penalties.length ? <div className="reviewPriorityPenalties">
      {penalties.map((item) => <small className={item.severity || "warn"} key={item.key}>-{Math.round(item.value || 0)} {item.label}</small>)}
    </div> : null}
  </div>;
}

function QueueDecisionDigest({ digest = null }) {
  if (!digest) return null;
  const evidenceLine = digest.checkLine || digest.actionDetail || digest.risk || "";
  return <span className={`reviewQueueDigest ${digest.state || ""}`.trim()}>
    <em>{digest.ratio ? `${digest.stateLabel} ${digest.ratio}` : digest.stateLabel}</em>
    <b title={digest.thesis}>{digest.thesis || digest.headline || "Sin tesis clara"}</b>
    <small title={evidenceLine}>{evidenceLine || "Sin pruebas destacadas"}</small>
  </span>;
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
  const [digestFilter, setDigestFilter] = useState("all");
  const [sourceMeta, setSourceMeta] = useState({});
  const [hydration, setHydration] = useState({});
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
    const nextRows = prepareReviewQueueRows(rowSource(nextSource, review, scans, favs), nextSettings || {});
    const decisionState = reviewDecisionStateForRows(review, nextRows);
    const nextResolutionFilter = keepState ? review.resolutionFilter || "all" : "all";
    const nextDigestFilter = keepState ? review.digestFilter || "all" : "all";
    const nextSourceMeta = sourceMetaForReview(nextSource, review);
    const navigation = buildReviewQueueNavigation({
      ...review,
      source: nextSource,
      rows: nextRows,
      activeSettings: nextSettings || {},
      hiddenSymbols: decisionState.hiddenSymbols,
      decisionResolutions: decisionState.decisionResolutions,
      resolutionFilter: nextResolutionFilter,
      digestFilter: nextDigestFilter,
    }, startSymbol || review.selectedSymbol || "");
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
    setDigestFilter(nextDigestFilter);
    setStatus(`${sourceLabel(nextSource, nextSourceMeta)} · ${nextRows.length} acciones`);
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
            digestFilter: nextDigestFilter,
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
  const resolutionRows = useMemo(() => filterRowsByDecisionResolution(baseVisibleRows, { decisionResolutions }, resolutionFilter), [baseVisibleRows, decisionResolutions, resolutionFilter]);
  const resolvedVisibleCount = useMemo(() => {
    const all = resolutionSummary.find((item) => item.key === "all")?.count || 0;
    const pending = resolutionSummary.find((item) => item.key === "pending")?.count || 0;
    return Math.max(0, all - pending);
  }, [resolutionSummary]);
  const resolutionDecisionItems = useMemo(() => resolutionRows.map((row) => {
    const item = buildDecisionQueueItem(row, reviewSettings);
    const profileKey = decisionProfileForRow(row, reviewSettings);
    const profile = reviewProfileMeta(profileKey);
    const reviewPriority = reviewPriorityForRow(row, reviewSettings);
    const metricTruth = reviewQueueMetricTruthMeta(row);
    const dataHealth = reviewQueueDataHealthMeta(row, reviewSettings);
    const scoreAudit = reviewQueueScoreAuditMeta(row);
    const vcp = vcpReliabilityAudit(row);
    const focus = reviewQueueFocusMeta({ dataHealth, metricTruth, scoreAudit, evidence: item.evidence, methodologyFocus: item.methodologyFocus, vcp });
    const trustSignature = buildRowTrustSignature({ dataHealth, metricTruth, scoreAudit, evidence: item.evidence, vcpReliability: vcp });
    return {
      ...item,
      row,
      profileKey,
      profileLabel: profile.label,
      profileTone: profile.tone,
      reviewPriority,
      metricTruth,
      dataHealth,
      scoreAudit,
      focus,
      trustSignature,
      digest: buildDecisionQueueDigest(item),
    };
  }), [resolutionRows, reviewSettings]);
  const digestSummary = useMemo(() => buildDecisionQueueDigestSummary(resolutionDecisionItems), [resolutionDecisionItems]);
  const visibleDecisionItems = useMemo(() => digestFilter === "all"
    ? resolutionDecisionItems
    : resolutionDecisionItems.filter((item) => item.digest?.state === digestFilter),
  [resolutionDecisionItems, digestFilter]);
  const visibleRows = useMemo(() => visibleDecisionItems.map((item) => item.row).filter(Boolean), [visibleDecisionItems]);
  const visiblePrioritySummary = useMemo(() => buildReviewPrioritySummary(visibleDecisionItems), [visibleDecisionItems]);
  const visibleDecisionSummary = useMemo(() => buildDecisionQueueSummary(visibleDecisionItems), [visibleDecisionItems]);
  const visibleProfileSummary = useMemo(() => buildReviewProfileSummary(visibleDecisionItems), [visibleDecisionItems]);
  const activeResolutionFilter = useMemo(() => stockDecisionResolutionFilter(resolutionFilter), [resolutionFilter]);
  const activeDigestFilter = useMemo(
    () => DECISION_QUEUE_DIGEST_FILTERS.find((item) => item.key === digestFilter) || DECISION_QUEUE_DIGEST_FILTERS[0],
    [digestFilter],
  );
  const activeQueueFilterLabels = [
    resolutionFilter !== "all" ? activeResolutionFilter.label : "",
    digestFilter !== "all" ? activeDigestFilter.label : "",
  ].filter(Boolean);
  const queueFiltersActive = activeQueueFilterLabels.length > 0;
  const pendingVisibleCount = resolutionSummary.find((item) => item.key === "pending")?.count || 0;
  const queueEmptyByFilter = queueFiltersActive && baseVisibleRows.length > 0 && !visibleRows.length;
  const queuePendingComplete = queueEmptyByFilter && resolutionFilter === "pending" && !pendingVisibleCount;
  const queueEmptyTitle = queuePendingComplete
    ? "Cola pendiente completada"
    : queueEmptyByFilter
      ? "Sin acciones para este filtro"
      : "Sin cola de revision";
  const queueEmptyDetail = queuePendingComplete
    ? `${sourceLabel(source, sourceMeta)} · no quedan acciones pendientes en esta cola.`
    : queueEmptyByFilter
      ? `${sourceLabel(source, sourceMeta)} · ${activeQueueFilterLabels.join(" · ")} no tiene resultados ahora.`
      : "Carga una cola desde el Screener o recupera un snapshot para iniciar la revision.";
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
      ? `${sourceLabel(source, sourceMeta)} · ${activeQueueFilterLabels.join(" · ")} · 0/${baseVisibleRows.length} visibles`
      : queueFiltersActive
        ? `${sourceLabel(source, sourceMeta)} · ${activeQueueFilterLabels.join(" · ")} · ${visibleRows.length}/${baseVisibleRows.length} visibles`
        : status;
  const reviewStatusLineClassName = [
    "reviewStatusLine",
    queueFiltersActive ? "filtered" : "",
    queueEmptyByFilter ? "empty" : "",
    queuePendingComplete ? "complete" : "",
  ].filter(Boolean).join(" ");
  const activeBaseRow = visibleRows[currentIndex] || visibleRows[0] || null;
  const activeHydration = activeBaseRow ? hydration[activeBaseRow.symbol] : null;
  const activeRow = useMemo(() => activeBaseRow ? normalizeRow({ ...activeBaseRow, ...(activeHydration?.row || {}) }) : null, [activeBaseRow, activeHydration]);
  const activeSymbol = activeRow?.symbol || "";
  const activeHydrating = activeHydration?.status === "loading";
  const activeResolution = useMemo(() => decisionResolutionForSymbol({ decisionResolutions }, activeSymbol), [decisionResolutions, activeSymbol]);
  const activeResolutionHistory = useMemo(
    () => decisionResolutionHistory({ decisionResolutions, decisionResolutionLog }, { symbol: activeSymbol, limit: 4 }),
    [decisionResolutions, decisionResolutionLog, activeSymbol],
  );
  const activeDecision = useMemo(() => {
    if (!activeRow) return null;
    const item = buildDecisionQueueItem(activeRow, reviewSettings);
    const profileKey = decisionProfileForRow(activeRow, reviewSettings);
    const profile = reviewProfileMeta(profileKey);
    const reviewPriority = reviewPriorityForRow(activeRow, reviewSettings);
    return {
      ...item,
      profileKey,
      profileLabel: profile.label,
      profileTone: profile.tone,
      reviewPriority,
    };
  }, [activeRow, reviewSettings]);

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
      digestFilter,
      updatedAt: new Date().toISOString(),
    });
  }, [source, sourceMeta, rows, reviewSettings, currentIndex, reviewed, hidden, decisionResolutions, decisionResolutionLog, resolutionFilter, digestFilter, activeSymbol]);

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
        if (result.configured === false) setStatus(`${symbol} eliminado de favoritos locales. Supabase no configurado.`);
        else if (result.ok) setStatus(`${symbol} eliminado de favoritos y Supabase.`);
        else setStatus(`${symbol} eliminado localmente. Supabase: ${result.message}`);
      });
      setStatus(`${symbol} eliminado de favoritos locales. Sincronizando Supabase...`);
    } else {
      const favorite = next.find((item) => String(item.symbol).toUpperCase() === symbol);
      syncFavoriteToCloud(favorite).then((result) => {
        if (result.configured === false) setStatus(`${symbol} guardado localmente. Supabase no configurado.`);
        else if (result.ok) setStatus(`${symbol} guardado en favoritos y Supabase.`);
        else setStatus(`${symbol} guardado localmente. Supabase: ${result.message}`);
      });
      setStatus(`${symbol} guardado en favoritos locales. Sincronizando Supabase...`);
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
  function resolveActiveDecision(actionKey, row = activeRow) {
    if (!row?.symbol) return;
    const note = [
      activeDecision?.nextAction?.value || "",
      activeDecision?.risk?.value || "",
    ].filter(Boolean).join(" · ");
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
      note,
    });
    setReviewed(new Set(nextReview.reviewedSymbols || []));
    setHidden(new Set(nextReview.hiddenSymbols || []));
    setDecisionResolutions(nextReview.decisionResolutions || {});
    setDecisionResolutionLog(nextReview.decisionResolutionLog || []);
    safeWrite(STORAGE_KEYS.review, nextReview);
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
    safeWrite(STORAGE_KEYS.review, nextReview);
    setStatus(`${row.symbol}: reabierta como pendiente`);
  }
  function applyResolutionFilter(nextFilter) {
    setResolutionFilter(nextFilter);
    setCurrentIndex(0);
  }
  function applyDigestFilter(nextFilter) {
    setDigestFilter(nextFilter);
    setCurrentIndex(0);
  }
  function clearQueueFilters() {
    setResolutionFilter("all");
    setDigestFilter("all");
    setCurrentIndex(0);
  }
  function showResolutionQueue(filterKey = "all") {
    setResolutionFilter(filterKey);
    setDigestFilter("all");
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
      digestFilter,
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

  return <main className="page reviewPage">
    <section className="card hero">
      <div className="heroTop">
        <div>
          <div className="badge">StatsEdge · Rapid Review</div>
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
        <div className="kpi"><b>{visibleRows.length}</b><span>{queueFiltersActive ? "acciones filtradas" : "acciones en cola"}</span></div>
        <div className="kpi"><b>{currentIndex + (visibleRows.length ? 1 : 0)}</b><span>posicion actual</span></div>
        <div className="kpi"><b>{reviewed.size}</b><span>revisadas</span></div>
        <div className="kpi"><b>{resolvedVisibleCount}</b><span>resueltas ficha</span></div>
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
      <div className={reviewStatusLineClassName}>{investorStatusLabel(reviewStatusText)}</div>
    </section>

    {!visibleRows.length ? <section className={`card emptyState reviewEmptyState ${queueEmptyByFilter ? "filtered" : ""} ${queuePendingComplete ? "complete" : ""}`.trim()}>
      <div className="emptyStateHead">
        <span>{queuePendingComplete ? "Trabajo cerrado" : queueFiltersActive ? "Filtro activo" : "Review"}</span>
        <h2>{queueEmptyTitle}</h2>
        <p className="fine">{queueEmptyDetail}</p>
      </div>
      <div className="reviewEmptyMetrics" aria-label="Resumen de cola vacia">
        <span><b>{baseVisibleRows.length}</b><em>base visible</em></span>
        <span><b>{pendingVisibleCount}</b><em>pendientes</em></span>
        <span><b>{resolvedVisibleCount}</b><em>resueltas</em></span>
      </div>
      <div className="controls reviewEmptyActions">
        {queueCompletionResolution ? <button className="btn btnPrimary" onClick={() => showResolutionQueue(queueCompletionResolution.key)}>{queueCompletionActionLabel}</button> : null}
        {queueFiltersActive ? <button className={`btn ${queueCompletionResolution ? "" : "btnPrimary"}`.trim()} onClick={clearQueueFilters}>Quitar filtros</button> : <a className="btn btnPrimary" href="/">Ir al screener</a>}
        <a className="btn" href="/">Screener</a>
        <a className="btn" href="/research-desk">Research Desk</a>
      </div>
    </section> : <section className="reviewWorkbench">
      <aside className="reviewQueue">
        <div className="reviewQueueHead">
          <h2>{sourceLabel(source, sourceMeta)}</h2>
          {sourceMeta.sourceDetail ? <small className="reviewQueueSourceDetail">{sourceMeta.sourceDetail}</small> : null}
          <span>{resolutionFilter === "all" && digestFilter === "all" ? `${baseVisibleRows.length} visibles` : `${visibleRows.length}/${baseVisibleRows.length} visibles`}</span>
        </div>
        {resolutionSummary.length > 1 ? <div className="reviewQueueSummary reviewResolutionSummary" aria-label="Resumen de cola por resolucion de ficha">
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
        {digestSummary.length > 1 ? <div className="reviewQueueSummary reviewDigestSummary" aria-label="Resumen de cola por estado de pruebas">
          {digestSummary.map((group) => (
            <button
              type="button"
              key={group.key}
              className={`reviewQueueSummaryChip ${group.tone || "neutral"} ${digestFilter === group.key ? "active" : ""}`}
              onClick={() => applyDigestFilter(group.key)}
              title={group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label}
            >
              <b>{group.count}</b>
              <span>{group.label}</span>
            </button>
          ))}
        </div> : null}
        {visiblePrioritySummary.length ? <div className="reviewQueueSummary reviewPrioritySummary" aria-label="Prioridad de investigacion">
          {visiblePrioritySummary.map((group) => (
            <button
              type="button"
              key={group.key}
              className={`reviewQueueSummaryChip priority-${group.key} ${group.tone || "neutral"} ${visibleDecisionItems[currentIndex]?.reviewPriority?.key === group.key ? "active" : ""}`}
              onClick={() => setCurrentIndex(group.firstIndex)}
              title={[group.topSymbol ? `${group.topSymbol} · ${Math.round(group.topScore || 0)}` : "", group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label].filter(Boolean).join(" · ")}
            >
              <b>{group.count}</b>
              <span>{group.shortLabel || group.label}</span>
            </button>
          ))}
        </div> : null}
        {visibleProfileSummary.length ? <div className="reviewQueueSummary reviewQueueProfileSummary" aria-label="Prioridad de cola por perfil">
          {visibleProfileSummary.map((group) => (
            <button
              type="button"
              key={group.key}
              className={`reviewQueueSummaryChip profile-${group.key} ${group.tone || "neutral"} ${visibleDecisionItems[currentIndex]?.profileKey === group.key ? "active" : ""}`}
              onClick={() => setCurrentIndex(group.firstIndex)}
              title={group.sampleSymbols.length ? group.sampleSymbols.join(", ") : group.label}
            >
              <b>{group.count}</b>
              <span>{group.label}</span>
            </button>
          ))}
        </div> : null}
        {visibleDecisionSummary.groups.length ? <div className="reviewQueueSummary" aria-label="Resumen de cola por decision">
          {visibleDecisionSummary.groups.map((group) => (
            <button
              type="button"
              key={group.key}
              className={`reviewQueueSummaryChip ${group.tone || "neutral"} ${visibleDecisionItems[currentIndex]?.readiness?.key === group.key ? "active" : ""}`}
              onClick={() => setCurrentIndex(group.firstIndex)}
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
            const decision = visibleDecisionItems[index] || buildDecisionQueueItem(row, reviewSettings);
            const resolution = decisionResolutionForSymbol({ decisionResolutions }, row.symbol);
            return <button
              key={row.symbol}
              className={`reviewQueueItem ${active ? "active" : ""} decision-${decision.readiness?.key || "unknown"} data-health-${decision.dataHealth?.key || "unknown"} score-audit-${decision.scoreAudit?.key || "unknown"} metric-truth-${decision.metricTruth?.key || "unknown"} focus-${decision.focus?.key || "none"} ${resolution ? `resolved-${resolution.key}` : ""}`}
              onClick={() => setCurrentIndex(index)}
              title={resolution ? `${resolution.label} · ${resolution.detail}` : [decision.focus ? `Foco ${decision.focus.label}: ${decision.focus.detail || ""}` : "", decision.digest?.tooltip || `${decision.nextAction?.value || "Revisar"} · ${decision.risk?.value || row.symbol}`].filter(Boolean).join(" · ")}
            >
              <CompanyMark row={row} size="sm" />
              <span className="reviewQueueBody">
                <b>{row.symbol}</b>
                <em>{row.companyName || row.symbol}</em>
                <RowTrustSignature signature={decision.trustSignature} className="reviewQueueTrustSignature" />
                <span className="reviewQueueDecisionLine">
                  <span className={`reviewQueueDecisionBadge ${decision.tone || "neutral"}`}>{decision.nextAction?.value || decision.action?.label || "Revisar"}</span>
                  {resolution ? <span className={`reviewQueueResolutionBadge ${resolution.tone || "neutral"}`}>{resolution.label}</span> : null}
                  <ReviewQueueFocusBadge focus={decision.focus} />
                  {decision.dataHealth ? <span className={`reviewQueueDataHealthBadge ${decision.dataHealth.tone || "neutral"} data-${decision.dataHealth.key || "unknown"}`} title={decision.dataHealth.detail || decision.dataHealth.label}>{decision.dataHealth.label}</span> : null}
                  {decision.reviewPriority ? <span className={`reviewQueuePriorityBadge ${decision.reviewPriority.tone || "neutral"}`} title={decision.reviewPriority.reason}>{decision.reviewPriority.shortLabel || decision.reviewPriority.label}</span> : null}
                  {decision.profileKey && decision.profileKey !== "other" ? <span className={`reviewQueueProfileBadge ${decision.profileTone || "neutral"}`}>{decision.profileLabel}</span> : null}
                  {decision.metricTruth ? <span className={`reviewQueueMetricTruthBadge ${decision.metricTruth.tone || "neutral"} metric-${decision.metricTruth.key || "unknown"}`} title={decision.metricTruth.detail || decision.metricTruth.label}>{decision.metricTruth.label}</span> : null}
                  {decision.scoreAudit ? <span className={`reviewQueueScoreAuditBadge ${decision.scoreAudit.tone || "neutral"} score-${decision.scoreAudit.key || "unknown"}`} title={decision.scoreAudit.detail || decision.scoreAudit.label}>{decision.scoreAudit.label}</span> : null}
                  {decision.risk?.value ? <small>{decision.risk.value}</small> : null}
                </span>
                <QueueDecisionDigest digest={decision.digest} />
              </span>
              <i>{decision.score ?? num(value(row, "totalScore") ?? value(row, "compositeScore"))}</i>
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
          <a className="btn btnPrimary" href={stockUrl(activeRow.symbol)} onPointerDown={() => saveStockOpenContext(activeRow, currentIndex)} onClick={() => saveStockOpenContext(activeRow, currentIndex)}>Ficha</a>
          <a className="btn" href={externalLinks(activeRow.symbol, activeRow.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
          <button className={`starBtn ${favoriteSymbols.has(activeSymbol) ? "on" : ""}`} onClick={() => toggleFavorite(activeRow)} aria-label={`Favorito ${activeRow.symbol}`}>★</button>
        </div>
        {activeHydrating && <div className="dataNote" style={{ marginBottom: 10 }}>Cargando historico y metricas...</div>}
        <ReviewPriorityPanel priority={activeDecision?.reviewPriority} />
        <ReviewDecisionPanel decision={activeDecision} />
        <div className="reviewMetricGrid">
          {metricRows(activeRow).map(([label, metric, key]) => <span key={label}>
            <b>{label}</b>
            <ReviewTrustMetric row={activeRow} metricKey={key} label={label} value={metric} />
          </span>)}
        </div>
        <div className="reviewEvidence">
          <div className="sectionTitle"><h2>Evidencia medible</h2></div>
          {evidenceRows(activeRow).map(([label, metric]) => <div className="summaryRow" key={label}><span>{label}</span><b>{metric}</b></div>)}
        </div>
        <div className="reviewNotes">
          <div className="summaryRow"><span>Estado local</span><b>{reviewed.has(activeSymbol) ? "Revisada" : "Pendiente"}</b></div>
          {activeResolution ? <div className="summaryRow">
            <span>Resolución ficha</span>
            <b>{activeResolution.label}</b>
          </div> : null}
          <div className="summaryRow"><span>Favorito local</span><b>{favoriteSymbols.has(activeSymbol) ? "Si" : "No"}</b></div>
        </div>
        <div className="reviewResolveRail" aria-label="Resolver decision desde Review">
          <span>Resolver desde Review</span>
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
