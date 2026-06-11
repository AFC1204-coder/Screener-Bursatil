"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ChartPreferences from "@/app/ChartPreferences";
import ScreenerOriginPanel from "@/app/ScreenerOriginPanel";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { DEFAULT_CHART_SETTINGS, readChartSettings, writeChartSettings } from "@/lib/chartSettings";
import { getJson, postJson } from "@/lib/clientApi";
import { getLatestScanFromCloud, getSettingFromCloud, syncAlertsToCloud, syncFavoriteToCloud, syncScanToCloud, syncSettingToCloud } from "@/lib/cloudSyncClient";
import { assetDomainForName, assetDomainForSymbol } from "@/lib/companyAssets";
import { pct } from "@/lib/formatters";
import { avg, avgVolume, clamp } from "@/lib/indicators";
import { safeRead, safeRemove, safeWrite, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { alertsFromScan, mergeAlerts } from "@/lib/methodologyAlerts";
import { methodologyCompactDetailLine, methodologyCompactReasonLine, methodologyDisplayForRow, methodologySetupLabel, methodologyTradePlanEligible } from "@/lib/methodologyDisplay";
import { enrichRowsWithMethodology, findCompatiblePreviousScan, snapshotCompatibilityKey, summarizeMethodology } from "@/lib/methodologyEngine";
import { rowPassesListContract } from "@/lib/listRationale";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { benchmarkSymbolForRow, rsUniverseValue } from "@/lib/relativeStrength";
import { applyRelativeStrength, buildResearchRow, compactBusinessSummary, dataCoverageForRow, domainFromUrl } from "@/lib/researchRow";
import { compositeLabel, gt, gte, ipoAgeMonthsForRow, isStage2, lte, volumeEvidence } from "@/lib/scoring";
import { ASIA, CORE_LAYER_KEYS, DEFAULT_MARKETS, DEFAULT_RESULT_PAGE_SIZE, DEFAULT_SCAN_BATCH_SIZE, DEFAULT_STATUS, DEFAULT_VIEW_LAYERS, EUROPE, FULL_SCAN_PARTIAL_EVERY, GLOBAL_INDEX_TAPE, MARKET_META, MARKET_ORDER, MARKETS, marketExchange, marketName, normalizeSectorStrength, OPTIONAL_LAYER_KEYS, RESULT_PAGE_SIZES, SCAN_BATCH_SIZES, SCREENER_FILTER_SETTING, SCREENER_SESSION_VERSION, SECTOR_STRENGTH_LABELS, SECTOR_STRENGTH_OPTIONS, SERVER_SCAN_POLL_MS, SORT_LABELS, USER_TEMPLATE_LIMIT, VIEW_LAYERS } from "@/lib/screenerConfig";
import { cachedScreenerQuery, cachedScreenerRow, compactRowForSession, compactRowsForSession, failureKind, fastFilterSignature, filterAnalyzedRows, ipoRadarUniverseRows, manualUniverseRows, normalizeFilterTemplates, perfNow, secondsLabel, sectorize, setupModeLabel, shuffle, sortMetric, spreadByInitial, stageLabel, uid, universeScopeKey } from "@/lib/screenerPipeline";
import {
  ALL_FILTER_LAYERS,
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  EXECUTION_LAYERS,
  FILTER_FAMILY_PRESETS,
  FILTER_FIELDS,
  FILTER_GROUPS,
  NEUTRAL_FIELD_VALUES,
  REGIME_LAYER,
  SCREENER_ALL_SYMBOLS_LIMIT as ALL_SYMBOLS_LIMIT,
  SCREENER_FILTER_PRESETS as PRESETS,
  SETTING_LAYER_DEPENDENCIES,
  filterLayersForPreset,
  filterStrictnessForPreset,
  settingsForPreset,
  setupModeDefaults,
  setupModeLayerRequirements,
} from "@/lib/screenerFilterCatalog";
import {
  effectiveSettingsFromLayers,
  fieldLayerKeys,
  inactiveFieldReason,
  inactiveSettingReason,
  isFieldRuleActive,
  settingApplies,
  settingLayerDependency,
} from "@/lib/screenerFilterLayers";
import { buildScreenerFilterExplainPlan } from "@/lib/screenerFilters";
import { buildScreenerContract, buildScreenerStockContext } from "@/lib/screenerContracts";
import { createFavoriteFromRow } from "@/lib/stockRows";
import { countryCode, countryName, externalLinks, isTradingViewWidgetBlocked, marketFlag, stockUrl } from "@/lib/symbols";
import { vcpObjectiveSummary } from "@/lib/vcpDiagnostics";

// app/screenerPanels.jsx — helpers de presentación y componentes del screener,
// extraídos verbatim de app/page.jsx. El import block se hereda de page.jsx;
// los nombres no usados aquí son inofensivos.
const money = (n, currency = "") => Number.isFinite(n) ? `${n >= 100 ? n.toFixed(0) : n.toFixed(2)}${currency ? ` ${currency}` : ""}` : "-";
const cap = (n) => Number.isFinite(n) && n > 0 ? n >= 1000000000000 ? `${(n / 1000000000000).toFixed(2)}T` : n >= 1000000000 ? `${(n / 1000000000).toFixed(1)}B` : n >= 1000000 ? `${(n / 1000000).toFixed(0)}M` : `${n.toFixed(0)}` : "-";
const amount = (n, currency = "") => Number.isFinite(n) && n > 0 ? `${cap(n)}${currency ? ` ${currency}` : ""}` : "-";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const searchText = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function investorStatusLabel(text = "") {
  return String(text || "")
    .replaceAll("Supabase", "nube")
    .replaceAll("localStorage", "modo local")
    .replaceAll("Proveedor", "Datos")
    .replaceAll("proveedor", "datos")
    .replaceAll("Yahoo/mercado", "mercado")
    .replaceAll("Yahoo", "fuente de mercado");
}
function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span aria-hidden="true">i</span>
    <em aria-hidden="true">{text}</em>
  </span>;
}
const ratioLabel = (n) => Number.isFinite(n) ? `${n.toFixed(2)}x` : "-";
function verifiedIpoCategory(row = {}) {
  if (!rowPassesListContract(row, "ipo")) return "";
  return String(row.ipoCategory || row.snapshot?.ipoCategory || "IPO verificable").trim() || "IPO verificable";
}
function ipoVerificationText(row = {}) {
  const category = verifiedIpoCategory(row);
  if (!category) return "No reciente / sin fecha fiable";
  const date = row.ipoDate || row.snapshot?.ipoDate || "";
  const age = ipoAgeMonthsForRow(row);
  const evidence = date || (Number.isFinite(age) ? `${age.toFixed(0)}m` : "verificada");
  return [category, evidence].filter(Boolean).join(" · ");
}
function initials(name = "", symbol = "") { return String(name || symbol).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || String(symbol).slice(0, 2).toUpperCase() || "SE"; }
function shortBusiness(row = {}) {
  return [row.industry, row.sector, row.theme].filter((value, index, arr) => value && value !== "Sin industria" && value !== "Sin sector" && arr.indexOf(value) === index).slice(0, 3).join(" · ") || row.businessEs || row.exchange || "";
}
function quickBusinessDescription(row = {}) {
  const summary = compactBusinessSummary(row.businessSummary, 300);
  if (summary) return summary;
  const activity = shortBusiness(row);
  if (activity) return `${row.companyName || row.symbol} opera en ${activity}.`;
  return "Descripción de negocio no disponible en el proveedor.";
}
function quickBusinessMarket(row = {}) {
  return [marketName(row.country), row.exchange].filter((value, index, arr) => value && value !== "-" && arr.indexOf(value) === index).join(" · ") || "-";
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

function TradingViewPreviewChart({ row, chartSettings = DEFAULT_CHART_SETTINGS }) {
  const ref = useRef(null);
  const tvSymbol = row ? externalLinks(row.symbol, row.exchange).tradingViewSymbol : "";
  const blockedEmbed = row ? isTradingViewWidgetBlocked(row.symbol, tvSymbol) : false;
  const nativeBars = row?.chartPreview || [];
  const hasNativeChart = nativeBars.filter((bar) => Number.isFinite(bar?.close)).length >= 2;
  const interval = chartSettings?.interval || DEFAULT_CHART_SETTINGS.interval;
  const range = chartSettings?.range || DEFAULT_CHART_SETTINGS.range;
  const style = chartSettings?.style || DEFAULT_CHART_SETTINGS.style;
  useEffect(() => {
    if (!ref.current || !tvSymbol || blockedEmbed || hasNativeChart) return;
    const container = ref.current;
    container.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      range,
      timezone: "Etc/UTC",
      theme: "dark",
      style,
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
  }, [tvSymbol, blockedEmbed, hasNativeChart, interval, range, style]);
  if (!row) return <div className="tvPreviewBox"><div className="previewEmpty">Sin dato</div></div>;
  const links = externalLinks(row.symbol, row.exchange);
  if (hasNativeChart || blockedEmbed) {
    return <div className="tvPreviewBox tvPreviewFallback tvPreviewNative">
      <UniversalPriceChart bars={nativeBars} symbol={row.symbol} currency={row.currency} tradingViewUrl={links.tradingView} settings={chartSettings} relativeStrength={row.relativeStrength || row.relativeStrengthSeries} rsMainScore={row.rsGlobalPct} benchmarkSymbol={row.benchmarkSymbol} height={520} />
    </div>;
  }
  return <div className="tvPreviewBox"><div className="tradingview-widget-container" ref={ref} /></div>;
}

function companyLogoDomain(row = {}) {
  return row.logoDomain || domainFromUrl(row.website || "") || assetDomainForSymbol(row.symbol) || assetDomainForName(row.companyName || row.name);
}

function CompanyMark({ row = {}, size = "md" }) {
  const domain = companyLogoDomain(row);
  const logo = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : "";
  const [failedLogo, setFailedLogo] = useState("");
  const canShowLogo = logo && failedLogo !== logo;
  return <span className={`companyMark companyMark-${size}`}>
    {canShowLogo ? <img src={logo} alt="" loading="lazy" onError={() => setFailedLogo(logo)} /> : <b>{initials(row.companyName || row.name, row.symbol)}</b>}
  </span>;
}

function quickSetup(row) {
  if (!row) return "Sin dato";
  return methodologySetupLabel(row);
}

function compactPatternReason(row = {}) {
  return methodologyCompactReasonLine(row);
}

function compactPatternDetail(row = {}) {
  return methodologyCompactDetailLine(row);
}

function LeaderTape({ rows = [], activeRow, onSelect, onFavorite, favoriteSymbols, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const visible = rows.slice(0, 18);
  return <div className="leaderTape">
    <div className="leaderTapeHead">
      <span>Symbol</span><span>{weaknessMode ? metricShortLabel("weaknessScore") : metricShortLabel("totalScore")}</span><span>{metricShortLabel("rsGlobalPct")}</span><span>{metricShortLabel("rsQualityScore")}</span><span>Setup</span><span>{metricShortLabel("volumeEffectScore")}</span>
    </div>
    {visible.map((row) => {
      const active = activeRow?.symbol === row.symbol;
      const rs = rsUniverseValue(row);
      return <div role="button" tabIndex={0} className={`leaderRow ${active ? "active" : ""}`} key={row.symbol} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(row); }}>
        <span className="leaderIdentity">
          <CompanyMark row={row} />
          <span><b>{row.symbol}</b><em>{row.companyName}</em></span>
        </span>
        <span><b className="miniRating">{weaknessMode ? row.weaknessScore?.toFixed(0) || "-" : row.compositeScore?.toFixed(0) || "-"}</b><small>{weaknessMode ? row.weaknessLabel || "Deterioro" : row.compositeLabel || "Watchlist"}</small></span>
        <span className={(rs ?? 0) >= 75 ? "scoreHot" : (rs ?? 0) >= 55 ? "scoreOk" : "scoreWeak"}>{Number.isFinite(rs) ? rs.toFixed(0) : "-"}</span>
        <span className={(row.rsQualityScore || 0) >= 70 ? "scoreHot" : (row.rsQualityScore || 0) >= 55 ? "scoreOk" : "scoreWeak"}>{row.rsQualityScore?.toFixed(0) || "-"}<small>{row.rsQualityLabel || "-"}</small></span>
        <span><i>{quickSetup(row)}</i><small>{row.theme}</small></span>
        <span>{Number.isFinite(row.volumeEffectScore) ? row.volumeEffectScore.toFixed(0) : "-"}<small>{Number.isFinite(row.relativeVolume) ? `${row.relativeVolume.toFixed(2)}x` : pct(row.volumeSurgePct)}</small></span>
        <span className="leaderActions" onClick={(event) => event.stopPropagation()}>
          {onFavorite && <button type="button" className={`starBtn ${favoriteSymbols?.has(row.symbol) ? "on" : ""}`} onClick={() => onFavorite(row)} aria-label={`Guardar favorito ${row.symbol}`}>★</button>}
        </span>
      </div>;
    })}
    {!visible.length && <div className="leaderEmpty">Sin resultados para la cinta.</div>}
  </div>;
}

function opportunityBuckets(rows = []) {
  const sorted = (check, key = "totalScore") => rows.filter(check).sort((a, b) => sortMetric(b, key) - sortMetric(a, key));
  const defs = [
    { key: "pivot", title: "Vigilancia pivot", note: "Setup observable", check: (r) => rowPassesListContract(r, "nearPivot") },
    { key: "stage2", title: "Stage 2 temprano", note: "Transición saludable", check: (r) => gt(r.price, r.sma200) && gte(r.sma200Slope, 0) && gte(r.distance52w, -35) && lte(r.extSma50, 18) && !isStage2(r) },
    { key: "pullback", title: "Pullback SMA50", note: "Descanso en tendencia", check: (r) => rowPassesListContract(r, "pullback") },
    { key: "rs", title: "RS", note: "Percentil del lote", check: (r) => (rsUniverseValue(r) ?? 0) >= 75 && gte(r.distance52w, -25) },
    { key: "growth", title: "Growth Quality", note: "Crecimiento + margen", check: (r) => (r.growthScore || 0) >= 70 && (r.totalScore || 0) >= 64 },
    { key: "ipo", title: "IPO reales", note: "Últimos 5 años", check: (r) => rowPassesListContract(r, "ipo") },
    { key: "extended", title: "Extendidas fuertes", note: "Extensión alta", check: (r) => rowPassesListContract(r, "extended") },
    { key: "risk", title: "Riesgo a revisar", note: "Volatilidad/extensión", check: (r) => (r.riskScore || 0) < 45 || gt(r.extSma50, 28) || (r.speculationRiskScore || 0) >= 70 },
    { key: "weakness", title: "Deterioro técnico", note: "Evitar largos / estudiar debilidad", sortKey: "weaknessScore", check: (r) => rowPassesListContract(r, "weakness") },
  ];
  return defs.map((def) => {
    const hits = sorted(def.check, def.sortKey);
    return { ...def, count: hits.length, leaders: hits.slice(0, 5) };
  });
}

function ScoreLine({ label, value }) {
  const n = Number.isFinite(value) ? value : 0;
  return <div className="scoreLine">
    <span>{label}</span>
    <b>{Number.isFinite(value) ? value.toFixed(0) : "-"}</b>
    <i style={{ width: `${clamp(n)}%` }} />
  </div>;
}

function OpportunityMap({ buckets = [], onSelect }) {
  return <div className="opportunityMap">
    {buckets.map((bucket) => <div className={`opportunityLane ${bucket.count ? "" : "empty"}`} key={bucket.key}>
      <div className="opportunityLaneHead">
        <span>{bucket.title}</span>
        <b>{bucket.count}</b>
      </div>
      <p>{bucket.note}</p>
      <div className="opportunityTickers">
        {bucket.leaders.map((row) => <button type="button" key={row.symbol} onClick={() => onSelect?.(row)}>
          <CompanyMark row={row} size="sm" />
          <span><strong>{row.symbol}</strong><em>{bucket.key === "weakness" ? row.weaknessScore?.toFixed(0) || "-" : row.totalScore?.toFixed(0) || "-"}</em></span>
        </button>)}
        {!bucket.leaders.length && <small>Sin candidatos</small>}
      </div>
    </div>)}
  </div>;
}


function MarketMiniTape({ marketHealth }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const shouldLoad = typeof window === "undefined" || window.matchMedia("(max-width: 900px)").matches;
    if (!shouldLoad) return undefined;
    async function loadIndexTape() {
      setLoading(true);
      try {
        const cached = typeof sessionStorage !== "undefined" ? JSON.parse(sessionStorage.getItem("statsedge:indexTape:v1") || "null") : null;
        if (cached?.createdAt && Date.now() - cached.createdAt < 5 * 60 * 1000 && Array.isArray(cached.items)) {
          if (!cancelled) setQuotes(cached.items);
          return;
        }
      } catch {}
      const loaded = await Promise.all(GLOBAL_INDEX_TAPE.map(async (meta) => {
        try {
          const chart = await getJson(`/api/chart?symbol=${encodeURIComponent(meta.symbol)}&maxAgeDays=5`);
          const bars = Array.isArray(chart.bars) ? chart.bars : [];
          const latest = bars.find((bar) => Number.isFinite(bar?.close));
          const previous = bars.find((bar) => bar?.date !== latest?.date && Number.isFinite(bar?.close));
          const changePct = latest?.close && previous?.close ? ((latest.close / previous.close) - 1) * 100 : null;
          return { ...meta, price: latest?.close ?? null, changePct, lastDate: latest?.date || "" };
        } catch {
          return { ...meta, price: null, changePct: null, lastDate: "", unavailable: true };
        }
      }));
      if (!cancelled) {
        setQuotes(loaded);
        try { sessionStorage.setItem("statsedge:indexTape:v1", JSON.stringify({ createdAt: Date.now(), items: loaded })); } catch {}
      }
    }
    loadIndexTape().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const healthMap = new Map((marketHealth?.indexes || []).map((item) => [item.symbol, item]));
  const indexes = (quotes.length ? quotes : GLOBAL_INDEX_TAPE.map((item) => ({ ...item, ...(healthMap.get(item.symbol) || {}) })));
  const tapeItems = indexes.map((item) => ({
    ...item,
    price: Number.isFinite(item.price) ? item.price : null,
    changePct: Number.isFinite(item.changePct) ? item.changePct : (Number.isFinite(item.perf1m) ? item.perf1m : null),
  }));
  return <section className="mobileMarketTape">
    <div className="mobileIndexTapeHeader">
      <span>Índices</span>
      <em>{tapeItems.length} mercados</em>
    </div>
    <div className="mobileIndexScreen" aria-label="Cinta de índices globales">
      <div className="mobileIndexRail">
        {tapeItems.map((item) => {
          const up = (item.changePct || 0) >= 0;
          const changeClass = Number.isFinite(item.changePct) ? (up ? "up" : "down") : "";
          return <span className={`mobileIndexTile ${item.unavailable ? "isUnavailable" : ""}`} key={item.symbol}>
            <span className="mobileIndexTileTop">
              <small>{item.market}</small>
              <em className={changeClass}>{Number.isFinite(item.changePct) ? pct(item.changePct) : loading ? "..." : "N/D"}</em>
            </span>
            <b>{item.label || item.name || item.symbol}</b>
            <strong>{Number.isFinite(item.price) ? money(item.price) : "-"}</strong>
          </span>;
        })}
      </div>
    </div>
  </section>;
}

function SetupChipRail({ rows = [], presetKey, setupMode, sort, onPreset, onMode, onSort }) {
  const counts = {
    stage2: rows.filter((row) => rowPassesListContract(row, "weinstein")).length,
    trend: rows.filter((row) => rowPassesListContract(row, "minervini")).length,
    watch: rows.filter((row) => rowPassesListContract(row, "nearPivot")).length,
    rs: rows.filter((row) => (rsUniverseValue(row) ?? 0) >= 75).length,
  };
  const chips = [
    { key: "stage2", label: "Stage 2", count: counts.stage2, active: setupMode === "leader", action: () => onMode("leader") },
    { key: "trend", label: "Trend Template", count: counts.trend, active: presetKey === "strict", action: () => onPreset("strict") },
    { key: "watch", label: "Vigilancia", count: counts.watch, active: setupMode === "nearPivot", action: () => onMode("nearPivot") },
    { key: "rs", label: "RS", count: counts.rs, active: sort === "rsGlobalPct", action: () => onSort("rsGlobalPct") },
  ];
  return <div className="mobileChipRail">
    {chips.map((chip) => <button type="button" key={chip.key} className={chip.active ? "active" : ""} onClick={chip.action}>
      {chip.label} <span>{chip.count}</span>
    </button>)}
  </div>;
}

function MobileMoverCard({ row, onSelect }) {
  const change = Number.isFinite(row.perf3m) ? row.perf3m : row.rs3m;
  return <button type="button" className="mobileMoverCard" onClick={() => onSelect(row)}>
    <CompanyMark row={row} size="sm" />
    <span className={(change || 0) >= 0 ? "up" : "down"}>{pct(change)}</span>
    <b>{row.symbol}</b>
    <em>{money(row.price, row.currency)}</em>
    <MiniSparkline bars={row.chartPreview || []} />
  </button>;
}

function MobileTopMovers({ rows = [], onSelect }) {
  const movers = [...rows].filter((row) => Number.isFinite(row.perf3m)).sort((a, b) => (b.perf3m || 0) - (a.perf3m || 0)).slice(0, 8);
  return <section className="mobileTopMovers">
    <div className="mobileSectionHead">
      <span>Top movers · scan</span>
      <button type="button" onClick={() => document.querySelector(".mobileResultList")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Ver mas</button>
    </div>
    <div className="mobileMoverRail">
      {movers.length ? movers.map((row) => <MobileMoverCard key={row.symbol} row={row} onSelect={onSelect} />) : <div className="mobileEmpty">Ejecuta un scan para llenar esta cinta.</div>}
    </div>
  </section>;
}

function MobileResultRow({ row, settings, onReview, onFavorite, isFavorite, onOpenStock }) {
  const change = Number.isFinite(row.perf3m) ? row.perf3m : row.rs3m;
  const filterPlan = buildScreenerFilterExplainPlan(row, settings);
  return <article className="mobileResultRow">
    <button type="button" className={`mobileResultLogo ${isFavorite ? "fav" : ""}`} onClick={() => onFavorite(row)} aria-label={`Guardar favorito ${row.symbol}`}>
      <CompanyMark row={row} size="lg" />
    </button>
    <Link className="mobileResultIdentity" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>
      <b>{row.symbol}</b>
      <span>{row.companyName}</span>
    </Link>
    <button type="button" className="mobileResultSpark" onClick={() => onReview(row.symbol)} aria-label={`Revisar ${row.symbol}`}>
      <MiniSparkline bars={row.chartPreview || []} />
    </button>
    <Link className="mobileResultPrice" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>
      <b>{money(row.price, row.currency)}</b>
      <span className={(change || 0) >= 0 ? "up" : "down"}>{pct(change)}</span>
    </Link>
    <InfoHint text={filterPlan.text} tone={filterPlan.tone} />
  </article>;
}

function MobileResultList({ rows = [], settings, totalRows = rows.length, sort, onSort, onReview, onFavorite, favoriteSymbols, onSave, onCsv, onOpenStock, savingDisabled = false, page = 1, pageSize = DEFAULT_RESULT_PAGE_SIZE, totalPages = 1, onPage, onPageSize }) {
  const start = totalRows ? ((page - 1) * pageSize) + 1 : 0;
  const end = totalRows ? Math.min(page * pageSize, totalRows) : 0;
  const hasRows = totalRows > 0;
  return <section className="mobileResultList">
    <div className="mobileResultListHead">
      <span>{hasRows ? `${totalRows} resultados · ${start}-${end} · ${SORT_LABELS[sort] || sort}` : "0 resultados"}</span>
      {hasRows ? <div>
        <select value={sort} onChange={(event) => onSort(event.target.value)} aria-label="Orden movil">
          <option value="totalScore">Score</option>
          <option value="rsGlobalPct">{metricShortLabel("rsGlobalPct")}</option>
          <option value="rsRating">{metricShortLabel("rsRating")}</option>
          <option value="volumeEffectScore">Volumen</option>
          <option value="avgTurnover">Liquidez</option>
          <option value="weaknessScore">Deterioro</option>
        </select>
        <button type="button" onClick={onCsv} disabled={!rows.length}>CSV</button>
        <button type="button" onClick={onSave} disabled={!rows.length || savingDisabled} aria-label="Guardar snapshot de resultados">Guardar</button>
        <button type="button" onClick={() => onReview()} disabled={!rows.length}>Revisar</button>
      </div> : null}
    </div>
    {hasRows ? <div className="controls" style={{ marginBottom: 10 }}>
      <select value={pageSize} onChange={(event) => onPageSize?.(Number(event.target.value))} aria-label="Acciones por pagina">
        {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / página</option>)}
      </select>
      <button type="button" onClick={() => onPage?.(page - 1)} disabled={page <= 1}>Anterior</button>
      <button type="button" onClick={() => onPage?.(page + 1)} disabled={page >= totalPages}>Siguiente</button>
    </div> : null}
    <div className="mobileRows">
      {rows.length ? rows.map((row) => <MobileResultRow key={row.symbol} row={row} settings={settings} onReview={onReview} onFavorite={onFavorite} onOpenStock={onOpenStock} isFavorite={favoriteSymbols?.has(row.symbol)} />) : <div className="mobileEmpty">Sin resultados todavia. Carga universo y ejecuta el screener.</div>}
    </div>
  </section>;
}

function RegimeStrip({ rows = [], marketHealth, presetName, setupName, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const elite = rows.filter((r) => (r.totalScore || 0) >= 75).length;
  const actionable = rows.filter(methodologyTradePlanEligible).length;
  const weaknessCount = rows.filter((r) => (r.weaknessScore || 0) >= 65).length;
  const marketScore = marketHealth?.marketScore;
  const regime = marketHealth?.regime?.label || "Sin regimen";
  return <div className="regimeStrip">
    <span><b>{Number.isFinite(marketScore) ? Math.round(marketScore) : "-"}</b><em>{regime}</em></span>
    <span><b>{rows.length}</b><em>pasan filtro</em></span>
    <span><b>{weaknessMode ? weaknessCount : elite}</b><em>{weaknessMode ? "deterioro alto" : "elite/leader"}</em></span>
    <span><b>{weaknessMode ? rows.filter((r) => (r.weaknessReasons || []).includes("bajo SMA200")).length : actionable}</b><em>{weaknessMode ? "bajo SMA200" : "planes validos"}</em></span>
    <span><b>{presetName}</b><em>{setupName}</em></span>
  </div>;
}

function QuickPanel({ row, onOpenStock }) {
  if (!row) return <div className="quickPanel"><p className="fine">Selecciona una accion para ver sus caracteristicas.</p></div>;
  return <aside className="quickPanel">
    <div className="quickPanelHead">
      <CompanyMark row={row} size="lg" />
      <div>
        <Link className="ticker" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>{row.symbol}</Link>
        <p>{row.companyName}</p>
      </div>
    </div>
    <div className="quickMetricGrid">
      <span><b>{metricShortLabel("totalScore")}</b>{row.totalScore?.toFixed(0) || "-"}</span>
      <span><b>{metricShortLabel("rsGlobalPct")}</b>{row.rsGlobalPct?.toFixed(0) || "-"}</span>
      <span><b>{metricShortLabel("rsQualityScore")}</b>{row.rsQualityScore?.toFixed(0) || "-"}</span>
      <span><b>{metricShortLabel("adProxyScore")}</b>{row.adProxyScore?.toFixed(0) || "-"}</span>
      <span><b>{metricShortLabel("epsGrowthProxyScore")}</b>{row.epsGrowthProxyScore?.toFixed(0) || "-"}</span>
      <span><b>{metricShortLabel("weaknessScore")}</b>{row.weaknessScore?.toFixed(0) || "-"}</span>
      <span><b>{metricShortLabel("rsCountryPct")}</b>{row.rsCountryPct?.toFixed(0) || "-"}</span>
      <span><b>{metricShortLabel("rsSectorPct")}</b>{row.rsSectorPct?.toFixed(0) || "-"}</span>
      <span><b>Setup</b>{row.setupQualityScore?.toFixed(0) || "-"}</span>
      <span><b>Growth</b>{row.growthScore?.toFixed(0) || "-"}</span>
      <span><b>Cobertura</b>{row.dataCoverageScore?.toFixed(0) || "-"}</span>
      <span><b>3M</b>{pct(row.perf3m)}</span>
      <span><b>52W</b>{pct(row.distance52w)}</span>
      <span><b>SMA50</b>{pct(row.extSma50)}</span>
      <span><b>RelVol</b>{Number.isFinite(row.relativeVolume) ? `${row.relativeVolume.toFixed(2)}x` : "-"}</span>
      <span><b>Vol 5d</b>{pct(row.volumeSurgePct)}</span>
      <span><b>Imp 20d</b>{amount(row.avgTurnover, row.currency)}</span>
      <span><b>Imp sesion</b>{amount(row.latestTurnover, row.currency)}</span>
      <span><b>{metricShortLabel("volumeEffectScore")}</b>{row.volumeEffectScore?.toFixed(0) || "-"}</span>
      <span><b>Up/Down</b>{ratioLabel(row.upDownVolRatio)}</span>
      <span><b>{metricShortLabel("shortPercentOfFloat")}</b>{pct(row.shortPercentOfFloat)}</span>
      <span><b>Short ratio</b>{ratioLabel(row.shortRatio)}</span>
      <span><b>Spec Risk</b>{row.speculationRiskScore?.toFixed(0) || "-"}</span>
      <span><b>DD 3M</b>{Number.isFinite(row.maxDrawdown63d) ? `${row.maxDrawdown63d.toFixed(1)}%` : "-"}</span>
      <span><b>Rent/Risk</b>{row.riskRewardScore?.toFixed(0) || "-"}</span>
      <span><b>Bench</b>{row.benchmarkSymbol || "-"}</span>
    </div>
    <div className="labelRail compact">{[...(row.compositeReasons || []).slice(0, 2), row.weaknessLabel].filter(Boolean).map((x) => <span key={x}>{x}</span>)}</div>
    <div className="summaryRow"><span>Setup</span><span>{quickSetup(row)}</span></div>
    {row.methodologyReliabilityLabel && <div className="summaryRow"><span>Fiabilidad</span><span>{row.methodologyReliabilityLabel}{row.methodologyReliabilityReason ? ` · ${row.methodologyReliabilityReason}` : ""}</span></div>}
    <div className="summaryRow"><span>Tema</span><span>{row.theme}</span></div>
    <div className="summaryRow"><span>IPO</span><span>{ipoVerificationText(row)}</span></div>
    <div className="summaryRow"><span>Industria</span><span>{row.industry || "Sin dato"}</span></div>
    <div className="leaderPanelActions">
      <Link className="btn btnSmall btnPrimary" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>Ficha</Link>
      <a className="btn btnSmall" href={externalLinks(row.symbol, row.exchange).tradingView} target="_blank" rel="noreferrer">TradingView</a>
    </div>
  </aside>;
}

function PreviewCard({ row, variant = "grid", onFavorite, isFavorite = false, onSelectChart, onOpenStock }) {
  const links = externalLinks(row.symbol, row.exchange);
  const compact = variant === "table";
  const summary = variant === "search";
  const showSparkline = !compact && !summary;
  const stage = stageLabel(row);
  const stageClass = stage === "Stage 2" ? "good" : stage === "Stage 4" ? "bad" : "neutral";
  const stats = compact
    ? [[metricShortLabel("totalScore"), row.totalScore?.toFixed(0) || "-"], [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-"], [metricShortLabel("volumeEffectScore"), row.volumeEffectScore?.toFixed(0) || "-"]]
    : summary
      ? [["Precio", money(row.price, row.currency)], [metricShortLabel("totalScore"), row.totalScore?.toFixed(0) || "-"], [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-"], [metricShortLabel("rsRating"), row.rsRating?.toFixed(0) || "-"], [metricShortLabel("adProxyScore"), row.adProxyScore?.toFixed(0) || "-"], [metricShortLabel("epsGrowthProxyScore"), row.epsGrowthProxyScore?.toFixed(0) || "-"], ["Bench", row.benchmarkSymbol || "-"]]
      : [["Precio", money(row.price, row.currency)], [metricShortLabel("totalScore"), row.totalScore?.toFixed(0) || "-"], [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-"], [metricShortLabel("rsRating"), row.rsRating?.toFixed(0) || "-"], [metricShortLabel("rsQualityScore"), row.rsQualityScore?.toFixed(0) || "-"], [metricShortLabel("volumeEffectScore"), row.volumeEffectScore?.toFixed(0) || "-"], [metricShortLabel("shortPercentOfFloat"), pct(row.shortPercentOfFloat)], ["Imp 20d", amount(row.avgTurnover, row.currency)], ["Cob", row.dataCoverageScore?.toFixed(0) || "-"], ["Bench", row.benchmarkSymbol || "-"]];
  const summaryStats = [
    [metricShortLabel("totalScore"), row.totalScore?.toFixed(0) || "-"],
    [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-"],
    [metricShortLabel("rsRating"), row.rsRating?.toFixed(0) || "-"],
    [metricShortLabel("adProxyScore"), row.adProxyScore?.toFixed(0) || "-"],
    [metricShortLabel("epsGrowthProxyScore"), row.epsGrowthProxyScore?.toFixed(0) || "-"],
    ["Bench", row.benchmarkSymbol || "-"],
  ];
  return <div className={`stockPreview stockPreview-${variant}`}>
    <div className="previewTop">
      <div className="previewIdentity">
        {!compact && <CompanyMark row={row} />}
        <span>
          <Link className="ticker" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>{row.symbol}</Link>
          {!compact && <span className="previewName">{row.companyName}</span>}
        </span>
      </div>
      {summary ? <div className="previewHeaderMeta">
        <strong>{money(row.price, row.currency)}</strong>
        <span className={`previewStage ${stageClass}`}>{stage}</span>
      </div> : <span className={`previewStage ${stageClass}`}>{stage}</span>}
    </div>
    {showSparkline && <MiniSparkline bars={row.chartPreview || []} />}
    {summary ? <div className="previewSummaryGrid">
      {summaryStats.map(([label, value]) => <span className="previewSummaryStat" key={label}><b>{label}</b><em>{value}</em></span>)}
    </div> : <div className="previewStats">
      {stats.map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)}
    </div>}
    {!compact && <div className="previewActions">
      {onSelectChart && <button type="button" className="btn btnSmall btnPrimary" onClick={() => onSelectChart(row)}>Grafico</button>}
      <Link className="btn btnSmall" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>Ficha</Link>
      <a className="btn btnSmall" href={links.tradingView} target="_blank" rel="noreferrer">TradingView</a>
      {onFavorite && <button type="button" className={`starBtn ${isFavorite ? "on" : ""}`} onClick={() => onFavorite(row)} aria-label={`Guardar favorito ${row.symbol}`}>{isFavorite ? "★ Guardada" : "★ Guardar"}</button>}
    </div>}
  </div>;
}

function SearchCandidateList({ candidates = [], activeSymbol = "", onPick }) {
  const secondary = candidates.filter((item) => !activeSymbol || item.symbol !== activeSymbol);
  if (!secondary.length) return null;
  return <div className="searchCandidates">
    <div className="sectionTitle"><h2>Coincidencias</h2></div>
    <div className="searchCandidateGrid">
      {secondary.map((item) => {
        return <button type="button" className="searchCandidate" key={item.symbol} onClick={() => onPick?.(item)}>
          <CompanyMark row={{ symbol: item.symbol, companyName: item.name, name: item.name, logoDomain: item.logoDomain, website: item.website }} />
          <span>
            <b>{item.symbol}</b>
            <em>{item.name}</em>
          </span>
          <small>{item.exchange || "-"} · {item.type || "Equity"} · {cap(item.marketCap)}</small>
        </button>;
      })}
    </div>
  </div>;
}

function SearchScopeList({ items = [], onPick }) {
  if (!items.length) return null;
  return <div className="searchCandidates searchScopePanel">
    <div className="sectionTitle"><h2>Busqueda asistida</h2><span className="fine">Activa vistas sin abrir mas filtros</span></div>
    <div className="searchScopeGrid">
      {items.map((item) => <button type="button" className="searchScopeChip" key={`${item.type}-${item.value}`} onClick={() => onPick?.(item)}>
        <span>{item.icon}</span>
        <b>{item.label}</b>
        <em>{item.detail}</em>
      </button>)}
    </div>
  </div>;
}

function compactTone(value, strongAt, weakBelow = null) {
  if (!Number.isFinite(value)) return "";
  if (value >= strongAt) return "good";
  if (Number.isFinite(weakBelow) && value < weakBelow) return "soft";
  return "";
}

function CompactMetric({ label, value, tone = "" }) {
  return <span className={`compactMetric ${tone}`}>
    <small>{label}</small>
    <b>{value ?? "-"}</b>
  </span>;
}

function ResultFilterChips({ chips = [], hiddenCount = 0, onClearAll }) {
  if (!chips.length && !hiddenCount) return null;
  return <div className="resultFilterChips">
    {hiddenCount > 0 ? <div className="resultFilterChipSummary">
      <b>{hiddenCount}</b>
      <span>ocultas por vista</span>
    </div> : null}
    {chips.map((chip) => <button type="button" key={chip.key} className="resultFilterChip" onClick={chip.onClear}>
      <span>{chip.label}</span>
      <b>×</b>
    </button>)}
    {chips.length ? <button type="button" className="resultFilterClear" onClick={onClearAll}>Limpiar vista</button> : null}
  </div>;
}

function applyResultViewFilters(baseRows = [], filters = {}) {
  let list = [...baseRows];
  if (filters.viewLayers?.country && filters.countryFilter !== "Todos") list = list.filter((row) => (row.country || countryCode(row.symbol)) === filters.countryFilter);
  if (filters.viewLayers?.theme && filters.themeFilter !== "Todos") list = list.filter((row) => row.theme === filters.themeFilter);
  if (filters.viewLayers?.sector && filters.sectorFilter !== "Todos") list = list.filter((row) => row.sector === filters.sectorFilter);
  if (filters.viewLayers?.industry && filters.industryFilter !== "Todos") list = list.filter((row) => row.industry === filters.industryFilter);
  if (filters.viewLayers?.sectorStrength) list = list.filter((row) => passesSectorStrength(row, filters.sectorStrength));
  if (filters.viewLayers?.ipo && filters.ipo !== "Todos") list = list.filter((row) => verifiedIpoCategory(row) === filters.ipo);
  return list;
}

function PendingResultsBar({ pending, visibleCount = 0, filteredCount = 0, onCommit }) {
  if (!pending?.rows?.length && !pending?.diagnostics) return null;
  const pendingCount = Number(pending.filteredCount ?? pending.rows?.length ?? 0);
  const delta = pendingCount - filteredCount;
  return <div className="pendingResultsBar">
    <span>{pending.done ? "Actualización lista" : "Lista congelada"}</span>
    <b>{pendingCount} resultados</b>
    {delta ? <em>{delta > 0 ? `+${delta}` : `${delta}`} vs visibles</em> : <em>{visibleCount} visibles</em>}
    <button type="button" className="btn btnSmall btnPrimary" onClick={onCommit}>Mostrar</button>
  </div>;
}

function ScreenerContractPanel({ contract }) {
  if (!contract) return null;
  const warnings = contract.warnings || [];
  const statsByKey = new Map((contract.stats || []).map((stat) => [stat.key, stat]));
  const visibleStats = ["rules", "results", "scope", "regime"]
    .map((key) => statsByKey.get(key))
    .filter(Boolean);
  const viewStat = statsByKey.get("view");
  if (viewStat?.value && viewStat.value !== "limpia") visibleStats.push(viewStat);
  const infoText = [contract.text, warnings.length ? "" : contract.okText].filter(Boolean).join(" ");
  return <section className={`screenerContractPanel ${contract.tone}`} data-contract-key={contract.key}>
    <div className="screenerContractIntro">
      <span className="screenerContractLabel">{contract.label}</span>
      <div>
        <h2>{contract.title}{infoText ? <InfoHint text={infoText} /> : null}</h2>
      </div>
    </div>
    <div className="screenerContractStats" aria-label="Estado objetivo del filtro">
      {visibleStats.map((stat) => <span key={stat.key}>
        <b>{stat.value}</b>
        <em>{stat.label}</em>
      </span>)}
    </div>
    {warnings.length ? <div className="screenerContractStatus warn">
      {warnings.slice(0, 3).map((warning) => <span key={warning.key}>{warning.text}</span>)}
    </div> : null}
  </section>;
}

function FilterTemplatePanel({
  presetKey,
  savedTemplates = [],
  selectedTemplateId = "",
  templateName = "",
  running = false,
  onPreset,
  onApplySaved,
  onTemplateName,
  onSave,
  onDelete,
  onSaveCloud,
  onLoadCloud,
}) {
  return <section className="filterTemplatePanel">
    <div className="filterTemplateHead">
      <span>Filtro editable</span>
      <em>Base {PRESETS[presetKey]?.name || "personal"}</em>
    </div>

    <details className="templateQuickPresets">
      <summary><span>Bases opcionales</span><em>{Object.keys(PRESETS).length}</em></summary>
      <div className="filterTemplateGrid">
        {Object.entries(PRESETS).map(([key, preset]) => <button
          type="button"
          key={key}
          className={`filterTemplateBtn ${presetKey === key ? "active" : ""}`}
          onClick={() => onPreset?.(key)}
          title={preset.desc}
        >
          <b>{preset.name}</b>
          <small>{preset.desc}</small>
        </button>)}
      </div>
    </details>

    <details className="savedTemplatesDisclosure">
      <summary><span>Mis plantillas</span><em>{savedTemplates.length} guardadas</em></summary>
      <div className="savedTemplateTools">
        <select className="select" value={selectedTemplateId} onChange={(event) => onApplySaved?.(event.target.value)} aria-label="Plantillas guardadas">
          <option value="">Mis plantillas guardadas</option>
          {savedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <input className="input" value={templateName} onChange={(event) => onTemplateName?.(event.target.value)} placeholder="Nombre de plantilla" aria-label="Nombre de plantilla" />
        <div className="savedTemplateActions">
          <button type="button" className="btn btnSmall" onClick={() => onSave?.(false)}>Guardar</button>
          <button type="button" className="btn btnSmall btnGhost" onClick={() => onSave?.(true)}>Copia</button>
          <button type="button" className="btn btnSmall btnGhost" onClick={onDelete} disabled={!selectedTemplateId}>Borrar</button>
        </div>
        <div className="cloudTemplateActions">
          <button type="button" className="btn btnSmall btnGhost" onClick={onSaveCloud} disabled={running}>Guardar nube</button>
          <button type="button" className="btn btnSmall btnGhost" onClick={onLoadCloud} disabled={running}>Cargar nube</button>
        </div>
      </div>
    </details>
  </section>;
}

function FilterFamilyModal({ layerKey, settings, filterLayers, fieldRules, onClose, onToggleLayer, onApplyAction, onUpdateSetting, onToggleFieldRule, onToggleLayeredSetting }) {
  if (!layerKey) return null;
  const layer = EXECUTION_LAYERS.find((item) => item.key === layerKey);
  if (!layer) return null;
  const family = FILTER_FAMILY_PRESETS[layerKey] || { title: layer.label, intro: layer.detail, actions: [] };
  const layerActive = filterLayers[layerKey] !== false;
  const familyFields = FILTER_FIELDS.filter((field) => fieldLayerKeys(field).includes(layerKey));
  const familySettingKeys = Object.entries(SETTING_LAYER_DEPENDENCIES)
    .filter(([, dependency]) => dependency.layer === layerKey)
    .map(([key]) => key);
  const settingLabels = {
    requireStage2: "Stage 2",
    requireUpVolume: "Volumen en vela alcista",
    requireRecentIpo: "IPO real reciente",
    requireContractionsDecreasing: "Contracciones decrecientes",
  };

  return <dialog className="filterFamilyModal stockModal" open onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <div className="filterFamilyInner">
      <header className="filterFamilyHeader">
        <div>
          <span>Familia de filtro</span>
          <h2>{family.title}</h2>
          <p>{family.intro}</p>
        </div>
        <button type="button" className="stockModalClose" onClick={onClose} aria-label="Cerrar">×</button>
      </header>

      <div className="filterFamilyToolbar">
        <button type="button" className={`filterFamilyPower ${layerActive ? "on" : "off"}`} onClick={() => onToggleLayer?.(layerKey)}>
          <b>{layerActive ? "Activa" : "Apagada"}</b>
          <span>{ruleCountLabel(layer.count)}</span>
        </button>
        {family.actions.length ? <div className="filterFamilyPresetRail" aria-label="Ajustes rápidos de exigencia">
          <span>Exigencia</span>
          <div>
            {family.actions.map((action) => <button type="button" className="filterFamilyPreset" key={action.label} onClick={() => onApplyAction?.(layerKey, action)} title={action.detail}>
              {action.label}
            </button>)}
          </div>
        </div> : null}
      </div>

      {layerKey === "trend" ? <div className={`weeklyStageControls modalWeeklyControls ${layerActive ? "" : "isMuted"}`}>
        <label><span>Media rapida semanal</span><input className="input" type="number" min="2" max="80" step="1" value={settings.stageFastWeeks || 10} onChange={(event) => onUpdateSetting?.("stageFastWeeks", Number(event.target.value) || 10)} /></label>
        <label><span>Media lenta semanal</span><input className="input" type="number" min="3" max="120" step="1" value={settings.stageSlowWeeks || 30} onChange={(event) => onUpdateSetting?.("stageSlowWeeks", Number(event.target.value) || 30)} /></label>
        <label><span>Pendiente semanas</span><input className="input" type="number" min="2" max="40" step="1" value={settings.stageSlopeWeeks || 10} onChange={(event) => onUpdateSetting?.("stageSlopeWeeks", Number(event.target.value) || 10)} /></label>
      </div> : null}

      {familySettingKeys.length ? <div className="filterSwitches filterFamilySwitches">
        {familySettingKeys.map((key) => <FilterToggle
          key={key}
          active={settings[key]}
          applies={settingApplies(key, filterLayers)}
          detail={inactiveSettingReason(key, filterLayers)}
          onClick={() => onToggleLayeredSetting?.(key)}
        >
          {settingLabels[key] || key}
        </FilterToggle>)}
      </div> : null}

      <div className="filterFamilyFields">
        <div className="filterFamilySubhead">
          <span>Ajustes finos</span>
          <em>{familyFields.filter((field) => isFieldRuleActive(field, fieldRules, filterLayers)).length}/{familyFields.length}</em>
        </div>
        {familyFields.length ? <div className="filterFields">
          {familyFields.map((field) => <FilterNumber
            key={field.key}
            field={field}
            value={settings[field.key]}
            onChange={onUpdateSetting}
            active={isFieldRuleActive(field, fieldRules, filterLayers)}
            inactiveReason={inactiveFieldReason(field, fieldRules, filterLayers)}
            onToggle={() => onToggleFieldRule?.(field)}
          />)}
        </div> : <p className="filterFamilyEmpty">Esta familia se controla con los botones superiores.</p>}
      </div>
    </div>
  </dialog>;
}

function CompactCountryFlag({ country }) {
  const code = String(country || "").toUpperCase();
  const safeCode = /^[A-Z]{2}$/.test(code) ? code : "XX";
  return <span
    className="compactCountryFlag"
    title={countryName(safeCode)}
    aria-label={countryName(safeCode)}
  >
    {marketFlag(safeCode)}
  </span>;
}

function CompactResultsTable({ rows = [], settings, favoriteSymbols, onFavorite, onReview, onOpenStock, rankOffset = 0 }) {
  const headers = ["★", "#", "Ticker", "Empresa", "Gráfico", "Setup", "RS", "Mom.", "Riesgo", "Volumen", "Score"];
  return <div className="tableWrap compactTableWrap">
    <table className="table compactResultsTable">
      <thead>
        <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const country = r.country || countryCode(r.symbol);
          const rsValue = rsUniverseValue(r);
          const onOpen = () => onReview?.(r.symbol);
          const setupReason = compactPatternReason(r);
          const setupDetail = compactPatternDetail(r);
          const setupObjective = vcpObjectiveSummary(r);
          const setupInfo = [
            setupObjective.detail,
            `Veredicto: ${quickSetup(r)}`,
            setupDetail,
          ].filter(Boolean).join(" · ");
          const filterPlan = buildScreenerFilterExplainPlan(r, settings);
          return <tr key={r.symbol} onClick={(e) => { if (!e.target.closest("button, a")) onOpen(); }}>
            <td>
              <button
                type="button"
                className={`starBtn ${favoriteSymbols?.has(r.symbol) ? "on" : ""}`}
                onClick={(e) => { e.stopPropagation(); onFavorite?.(r); }}
                aria-label={`Guardar favorito ${r.symbol}`}
              >
                ★
              </button>
            </td>
            <td className="rankCell">{rankOffset + i + 1}</td>
            <td className="compactSymbolCell">
              <Link className="ticker" href={stockUrl(r.symbol)} onPointerDown={() => onOpenStock?.(r)} onClick={() => onOpenStock?.(r)}>{r.symbol}</Link>
              <CompactCountryFlag country={country} />
            </td>
            <td className="compactCompanyCell">
              <CompanyMark row={r} size="sm" />
              <span>
                <b>{r.companyName || r.symbol}</b>
              </span>
            </td>
            <td className="compactSparkCell">
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={`Abrir grafico rapido de ${r.symbol}`}>
                <MiniSparkline bars={r.chartPreview || []} />
              </button>
              <span>
                <b>{money(r.price, r.currency)}</b>
                <em className={Number.isFinite(r.perf3m) && r.perf3m < 0 ? "down" : "up"}>{pct(r.perf3m)}</em>
              </span>
            </td>
            <td>
              <div className="compactStack compactSetupStack">
                <span className="compactSetupHead">
                  <b title={setupObjective.primary}>{setupObjective.primary}</b>
                  <InfoHint text={setupInfo} />
                </span>
                <small title={setupObjective.secondary || setupReason}>{setupObjective.secondary || setupReason}</small>
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="G" value={Number.isFinite(rsValue) ? rsValue.toFixed(0) : "-"} tone={compactTone(rsValue, 75, 45)} />
                <CompactMetric label="Grp" value={Number.isFinite(r.rsSectorPct) ? r.rsSectorPct.toFixed(0) : "-"} />
                <CompactMetric label="Q" value={Number.isFinite(r.rsQualityScore) ? r.rsQualityScore.toFixed(0) : "-"} tone={compactTone(r.rsQualityScore, 70, 40)} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="3M" value={pct(r.perf3m)} tone={compactTone(r.perf3m, 20, 0)} />
                <CompactMetric label="6M" value={pct(r.perf6m)} tone={compactTone(r.perf6m, 35, 0)} />
                <CompactMetric label="52w" value={pct(r.distance52w)} tone={compactTone(r.distance52w, -10, -35)} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="Ext." value={pct(r.extSma50)} />
                <CompactMetric label="DD63" value={Number.isFinite(r.maxDrawdown63d) ? `${r.maxDrawdown63d.toFixed(1)}%` : "-"} />
                <CompactMetric label="Short" value={pct(r.shortPercentOfFloat)} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="RV" value={Number.isFinite(r.relativeVolume) ? `${r.relativeVolume.toFixed(2)}x` : "-"} tone={compactTone(r.relativeVolume, 1.5)} />
                <CompactMetric label="A/D" value={Number.isFinite(r.adProxyScore) ? r.adProxyScore.toFixed(0) : "-"} tone={compactTone(r.adProxyScore, 70, 40)} />
                <CompactMetric label="Ef." value={Number.isFinite(r.volumeEffectScore) ? r.volumeEffectScore.toFixed(0) : "-"} />
              </div>
            </td>
            <td className="compactScoreCell">
              <span className="compactScoreHead">
                <b>{Number.isFinite(r.totalScore) ? r.totalScore.toFixed(0) : "-"}</b>
                <InfoHint text={filterPlan.text} tone={filterPlan.tone} />
              </span>
              <span>W {Number.isFinite(r.weinsteinScore) ? r.weinsteinScore.toFixed(0) : "-"} · EPS {Number.isFinite(r.epsGrowthProxyScore) ? r.epsGrowthProxyScore.toFixed(0) : "-"}</span>
            </td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={headers.length} className="emptyResultsCell">Ejecuta un scan para ver resultados</td></tr>}
      </tbody>
    </table>
  </div>;
}

function FilterNumber({ field, value, onChange, active = true, inactiveReason = "", onToggle }) {
  const scale = field.scale || 1;
  const step = field.step || 1;
  const currentValue = Number.isFinite(value) ? value / scale : 0;
  const shown = Number.isFinite(value) ? value / scale : "";
  const neutral = NEUTRAL_FIELD_VALUES[field.key];
  const minValue = Number.isFinite(field.min)
    ? field.min
    : (field.key.startsWith("min") && Number.isFinite(neutral) && neutral < 0 ? neutral / scale : 0);

  const handleDecrement = (e) => {
    e.preventDefault();
    const newValue = Math.max(minValue, currentValue - step);
    onChange(field.key, Number(newValue.toFixed(4)) * scale);
  };

  const handleIncrement = (e) => {
    e.preventDefault();
    const newValue = currentValue + step;
    onChange(field.key, Number(newValue.toFixed(4)) * scale);
  };

  return <div className={`filterField ${active ? "isActive" : "isOff"}`}>
    <label className="filterFieldLabel">
      <span className={`ruleMiniToggle ${active ? "on" : "off"}`} title={active ? "Quitar esta regla del filtro" : inactiveReason || "Activar esta regla"}>
        <input type="checkbox" checked={active} onChange={onToggle} aria-label={`${active ? "Quitar" : "Activar"} ${field.label}`} />
        <span>{active ? "✓" : ""}</span>
      </span>
      <span>{field.label}</span>
      {field.hint && <InfoHint text={field.hint} />}
    </label>
    <div className="filterInputWrap">
      <button type="button" className="filterStepperBtn decrement" onClick={handleDecrement} title="Disminuir" aria-label="Disminuir">-</button>
      <input className="input" type="number" step={step} value={shown} aria-label={field.label} onChange={(e) => onChange(field.key, (Number(e.target.value) || 0) * scale)} />
      {field.unit && <b className="filterUnit">{field.unit}</b>}
      <button type="button" className="filterStepperBtn increment" onClick={handleIncrement} title="Incrementar" aria-label="Incrementar">+</button>
    </div>
  </div>;
}

function FilterToggle({ active, applies = true, detail = "", onClick, children }) {
  const checked = Boolean(active && applies);
  return <label className={`filterToggleLine ${checked ? "on" : ""} ${applies ? "" : "isMuted"}`} title={detail}>
    <input type="checkbox" checked={checked} onChange={onClick} />
    <span>{children}</span>
    {detail ? <small>{detail}</small> : null}
  </label>;
}

function LayerToggleButton({ active, onClick, label, detail, countLabel }) {
  return <button type="button" className={`layerToggle ${active ? "on" : "off"}`} aria-pressed={active} onClick={onClick} title={detail || label}>
    <span className="layerToggleState"><i>{active ? "✓" : "X"}</i><b>{active ? "Activo" : "Quitado"}</b></span>
    <span className="layerToggleText"><strong>{label}</strong></span>
    <span className="layerToggleCount">{countLabel}</span>
  </button>;
}

function LayerControl({ active, onClick, onOpen, label, detail, countLabel }) {
  return <div className={`layerControlRow ${active ? "on" : "off"} ${onOpen ? "" : "simple"}`}>
    <LayerToggleButton active={active} onClick={onClick} label={label} detail={detail} countLabel={countLabel} />
    {detail ? <InfoHint text={detail} /> : null}
    {onOpen ? <button type="button" className="layerEditBtn" onClick={onOpen}>Ajustar</button> : null}
  </div>;
}


function FilterArchitecturePanel({ filterLayers, viewLayers, useRegimeFilter, onToggleLayer, onOpenLayer, onToggleViewLayer, onToggleRegime, executionRuleActive, executionRuleTotal, viewFiltersActive }) {
  const layerByKey = Object.fromEntries(EXECUTION_LAYERS.map((layer) => [layer.key, layer]));
  return <section className="filterArchitecture">
    <div className="filterArchitectureHead">
      <div>
        <span>Filtro activo</span>
        <strong>{executionRuleActive} de {executionRuleTotal} reglas</strong>
      </div>
    </div>
    <div className="filterLayerBlock">
      <h3>Núcleo</h3>
      {CORE_LAYER_KEYS.map((key) => {
        const layer = layerByKey[key];
        return <LayerControl key={key} active={filterLayers[key]} onClick={() => onToggleLayer(key)} onOpen={() => onOpenLayer?.(key)} label={layer.label} detail={layer.detail} countLabel={ruleCountLabel(layer.count)} />;
      })}
    </div>
    <div className="filterLayerBlock">
      <h3>Adicionales</h3>
      {OPTIONAL_LAYER_KEYS.map((key) => {
        const layer = layerByKey[key];
        return <LayerControl key={key} active={filterLayers[key]} onClick={() => onToggleLayer(key)} onOpen={() => onOpenLayer?.(key)} label={layer.label} detail={layer.detail} countLabel={ruleCountLabel(layer.count)} />;
      })}
      <LayerControl active={useRegimeFilter} onClick={onToggleRegime} label={REGIME_LAYER.label} detail={REGIME_LAYER.detail} countLabel={ruleCountLabel(REGIME_LAYER.count)} />
    </div>
    <details className="viewLayerMini">
      <summary><span>Vista de resultados</span><em>{viewFiltersActive} activos</em></summary>
      <div className="viewLayerBar">
        {VIEW_LAYERS.map((layer) => <LayerControl key={layer.key} active={viewLayers[layer.key]} onClick={() => onToggleViewLayer(layer.key)} label={layer.label} detail={layer.detail} countLabel="vista" />)}
      </div>
    </details>
  </section>;
}

function FilterDiagnosticsPanel({ diagnostics, rowsCount, filteredCount, running }) {
  const viewHidden = Math.max(0, rowsCount - filteredCount);
  if (!diagnostics && !running) return <section className="scanDiagnostics empty">
    <div className="scanDiagnosticsHead">
      <span>Embudo del scan</span>
      <strong>Sin diagnóstico</strong>
    </div>
    <div className="scanDiagnosticHint">Ejecuta un scan para ver que bloque corta acciones y que parte solo afecta a la vista.</div>
  </section>;
  const blocks = diagnostics?.blocks || [];
  const analyzed = Number(diagnostics?.analyzed || 0);
  const finalCount = Number(diagnostics?.finalCount || 0);
  const universeTotal = Number(diagnostics?.universeTotal || analyzed || 0);
  const passRate = analyzed > 0 ? (finalCount / analyzed) * 100 : null;
  const sampleRate = universeTotal > 0 ? (analyzed / universeTotal) * 100 : null;
  const limitedSample = universeTotal > analyzed;
  return <section className="scanDiagnostics">
    <div className="scanDiagnosticsHead">
      <span>Embudo del scan</span>
      <strong>{running ? "Analizando..." : `${diagnostics.finalCount}/${diagnostics.analyzed} pasan`}</strong>
    </div>
    <div className="diagnosticStats">
      <span><b>{diagnostics?.analyzed ?? "-"}</b><em>analizadas</em></span>
      <span><b>{Number.isFinite(passRate) ? `${passRate.toFixed(0)}%` : "-"}</b><em>pasan</em></span>
      <span><b>{Number.isFinite(sampleRate) ? `${sampleRate < 10 ? sampleRate.toFixed(1) : sampleRate.toFixed(0)}%` : "-"}</b><em>muestra</em></span>
      <span><b>{diagnostics?.hardRejected ?? "-"}</b><em>filtros duros</em></span>
      <span><b>{diagnostics?.providerRejected ?? "-"}</b><em>datos</em></span>
      <span><b>{diagnostics?.regimeRejected ?? "-"}</b><em>regimen</em></span>
      <span><b>{diagnostics?.postRejected ?? "-"}</b><em>post</em></span>
      <span><b>{viewHidden}</b><em>vista</em></span>
    </div>
    {limitedSample ? <div className="scanSampleNotice">
      Muestra actual: <b>{analyzed}</b> de <b>{universeTotal}</b> acciones ({Number.isFinite(sampleRate) ? `${sampleRate.toFixed(1)}%` : "sin porcentaje"}). Si salen pocos resultados, primero aumenta lotes o usa snapshots/cache antes de endurecer filtros.
    </div> : null}
    {blocks.length ? <div className="diagnosticBlocks">
      {blocks.slice(0, 7).map((block) => <article key={block.key} className="diagnosticBlock">
        <div><span>{block.stage}</span><strong>{block.label}</strong></div>
        <b>{block.count}</b>
        <ul>{block.examples.slice(0, 2).map((example, index) => <li key={`${block.key}-${example.symbol}-${index}`}><em>{example.symbol}</em>{example.detail}</li>)}</ul>
      </article>)}
    </div> : <div className="scanDiagnosticHint">No hay rechazos registrados en el ultimo scan.</div>}
  </section>;
}

function passesSectorStrength(row = {}, mode = "Todos") {
  const score = row.sectorScore ?? row.groupStrengthScore;
  if (mode === "Todos") return true;
  if (!Number.isFinite(score)) return false;
  if (mode === "Fuertes") return score >= 70;
  if (mode === "Constructivos") return score >= 55 && score < 70;
  if (mode === "Debiles" || mode === "Débiles") return score < 55;
  if (mode === "Muy debiles" || mode === "Muy débiles") return score < 40;
  return true;
}

function activeLayerCount(layers = {}) {
  return Object.values(layers).filter(Boolean).length;
}

function ruleCountLabel(count = 0, singular = "regla", plural = "reglas") {
  return `${count} ${count === 1 ? singular : plural}`;
}

function layerStatusText(layers = DEFAULT_FILTER_LAYERS, useRegime = true) {
  const off = EXECUTION_LAYERS.filter((x) => !layers[x.key]).map((x) => x.label.toLowerCase());
  if (!useRegime) off.push("regimen");
  return off.length ? `capas off: ${off.join(", ")}` : "todas las capas activas";
}

export {
  money, cap, amount, sleep, searchText, investorStatusLabel, InfoHint, ratioLabel,
  verifiedIpoCategory, ipoVerificationText, initials, shortBusiness, quickBusinessDescription,
  quickBusinessMarket, chartPath, MiniSparkline, TradingViewPreviewChart, companyLogoDomain,
  CompanyMark, quickSetup, compactPatternReason, compactPatternDetail, LeaderTape,
  opportunityBuckets, ScoreLine, OpportunityMap, MarketMiniTape, SetupChipRail,
  MobileMoverCard, MobileTopMovers, MobileResultRow, MobileResultList, RegimeStrip,
  QuickPanel, PreviewCard, SearchCandidateList, SearchScopeList, compactTone, CompactMetric,
  ResultFilterChips, applyResultViewFilters, PendingResultsBar, ScreenerContractPanel,
  FilterTemplatePanel, FilterFamilyModal, CompactCountryFlag, CompactResultsTable,
  FilterNumber, FilterToggle, LayerToggleButton, LayerControl, FilterArchitecturePanel,
  FilterDiagnosticsPanel, passesSectorStrength, activeLayerCount, ruleCountLabel, layerStatusText,
};
