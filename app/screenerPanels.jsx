"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import RowTrustSignature from "@/app/RowTrustSignature";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { metricSourceFromItem } from "@/app/components/ui/MetricSource";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import { getJson } from "@/lib/clientApi";
import { assetDomainForName, assetDomainForSymbol } from "@/lib/companyAssets";
import { pct } from "@/lib/formatters";
import { clamp } from "@/lib/indicators";
import { metricShortLabel } from "@/lib/metricCatalog";
import { methodologyCompactDetailLine, methodologyCompactReasonLine, methodologySetupLabel, methodologyTradePlanEligible } from "@/lib/methodologyDisplay";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { rowPassesListContract } from "@/lib/listRationale";
import { rsUniverseValue } from "@/lib/relativeStrength";
import { compactBusinessSummary, domainFromUrl } from "@/lib/researchRow";
import { compositeLabel, gt, gte, ipoAgeMonthsForRow, isStage2, lte } from "@/lib/scoring";
import { CORE_LAYER_KEYS, DEFAULT_RESULT_PAGE_SIZE, GLOBAL_INDEX_TAPE, marketName, OPTIONAL_LAYER_KEYS, RESULT_PAGE_SIZES, SORT_LABELS, VIEW_LAYERS } from "@/lib/screenerConfig";
import { buildDecisionEvidenceChecklist, decisionEvidenceFilterLabel, decisionEvidenceMatchesFilter, explainScreenerRank } from "@/lib/screenerExplainability";
import { sortMetric, stageLabel } from "@/lib/screenerPipeline";
import { DEFAULT_FILTER_LAYERS, EXECUTION_LAYERS, FILTER_FAMILY_PRESETS, FILTER_FIELDS, NEUTRAL_FIELD_VALUES, REGIME_LAYER, SCREENER_FILTER_PRESETS as PRESETS, SETTING_LAYER_DEPENDENCIES } from "@/lib/screenerFilterCatalog";
import { fieldLayerKeys, inactiveFieldReason, inactiveSettingReason, isFieldRuleActive, settingApplies } from "@/lib/screenerFilterLayers";
import { buildScreenerFilterExplainPlan } from "@/lib/screenerFilters";
import { auditDecisionRowIssues, decisionConfidenceLabel, decisionConfidenceSummary, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { DECISION_PROFILE_ORDER, buildReviewProfileSummary, decisionProfileForRow, decisionProfileLabel, prepareReviewQueueRows, reviewPriorityForRow, reviewProfileMeta } from "@/lib/decisionProfile";
import { buildScreenerDataHealth, dataHealthFilterLabel, dataHealthMatchesFilter } from "@/lib/screenerDataHealth";
import { buildScreenerDecisionBrief } from "@/lib/screenerDecisionBrief";
import { RELIABILITY_FILTER_ALL, screenerReliabilityMatchesFilter } from "@/lib/screenerReliability";
import {
  applyResultViewFilters,
  decisionConfidenceForRow,
  decisionResolutionForRow,
  opportunityBuckets,
  passesSectorStrength,
  verifiedIpoCategory,
} from "@/lib/screenerResultView";
import { buildScreenerScoreAudit, scoreAuditFilterLabel, scoreAuditMatchesFilter, scoreAuditReviewReasons } from "@/lib/screenerScoreAudit";
import { countryCode, countryName, externalLinks, isTradingViewWidgetBlocked, marketFlag, stockUrl } from "@/lib/symbols";
import { vcpObjectiveSummary, vcpReliabilityAudit } from "@/lib/vcpDiagnostics";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";

// app/screenerPanels.jsx — helpers de presentación y componentes del screener.
// Secciones: tarjetas y charts · móvil · tablas de resultados · paneles de filtros.
// Los helpers de formato viven en lib/screenerFormat.js.
import {
  activeLayerCount,
  amount,
  cap,
  chartPath,
  compactMetricSourceLookup,
  compactPatternDetail,
  compactPatternReason,
  compactTone,
  companyLogoDomain,
  initials,
  investorStatusLabel,
  layerStatusText,
  money,
  objectiveMetricCompactState,
  priorityTooltip,
  quickBusinessDescription,
  quickBusinessMarket,
  quickSetup,
  ratioLabel,
  ruleCountLabel,
  searchText,
  shortBusiness,
  sleep,
} from "@/lib/screenerFormat";
import {
  DecisionConfidenceBadge,
  DecisionOperatingBrief,
  DecisionPriorityBadge,
  DecisionQualityStrip,
  DecisionResolutionBadge,
  DecisionSummaryRail,
  PendingDecisionWorkRail,
} from "@/lib/screenerDomains/decision";
import {
  AuditabilitySummaryRail,
  DecisionEvidenceChecklist,
  DecisionEvidenceSummaryRail,
  ScoreAuditPanel,
  ScoreAuditSummaryRail,
  scoreAuditCompactFilterKey,
} from "@/lib/screenerDomains/audit";
import { DataHealthPanel, DataHealthSummaryRail } from "@/lib/screenerDomains/dataHealth";

function ipoVerificationText(row = {}) {
  const category = verifiedIpoCategory(row);
  if (!category) return "No reciente / sin fecha fiable";
  const date = row.ipoDate || row.snapshot?.ipoDate || "";
  const age = ipoAgeMonthsForRow(row);
  const evidence = date || (Number.isFinite(age) ? `${age.toFixed(0)}m` : "verificada");
  return [category, evidence].filter(Boolean).join(" · ");
}
/* ── Tarjetas, sparklines y charts de preview ── */
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

function CompanyMark({ row = {}, size = "md" }) {
  const domain = companyLogoDomain(row);
  const logo = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : "";
  const [failedLogo, setFailedLogo] = useState("");
  const canShowLogo = logo && failedLogo !== logo;
  return <span className={`companyMark companyMark-${size}`}>
    {canShowLogo ? <img src={logo} alt="" loading="lazy" onError={() => setFailedLogo(logo)} /> : <b>{initials(row.companyName || row.name, row.symbol)}</b>}
  </span>;
}

function LeaderTape({ rows = [], activeRow, onSelect, onFavorite, favoriteSymbols, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const visible = rows.slice(0, 18);
  return <div className="leaderTape">
    <div className="leaderTapeHead">
      <span>Symbol</span><span>{weaknessMode ? metricShortLabel("weaknessScore") : metricShortLabel("objectiveScore")}</span><span>{metricShortLabel("rsGlobalPct")}</span><span>{metricShortLabel("rsQualityScore")}</span><span>Setup</span><span>{metricShortLabel("volumeEffectScore")}</span>
    </div>
    {visible.map((row) => {
      const active = activeRow?.symbol === row.symbol;
      const rs = rsUniverseValue(row);
      const rankExplain = explainScreenerRank(row, {});
      const rowIssues = auditDecisionRowIssues(row, rankExplain);
      const scoreAudit = buildScreenerScoreAudit(row);
      const dataHealth = buildScreenerDataHealth(row, {});
      const metricTruth = objectiveMetricCompactState(row);
      const evidence = buildDecisionEvidenceChecklist(row, rankExplain);
      const vcpReliability = vcpReliabilityAudit(row);
      const trustSignature = buildRowTrustSignature({ dataHealth, metricTruth, scoreAudit, evidence, vcpReliability, rowIssues });
      return <div role="button" tabIndex={0} className={`leaderRow ${active ? "active" : ""}`} key={row.symbol} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(row); }}>
        <span className="leaderIdentity">
          <CompanyMark row={row} />
          <span>
            <b>{row.symbol}</b>
            <em>{row.companyName}</em>
            <RowTrustSignature signature={trustSignature} className="leaderTrustSignature" />
          </span>
        </span>
        <span><b className="miniRating">{weaknessMode ? row.weaknessScore?.toFixed(0) || "-" : row.objectiveScore?.toFixed(0) || row.compositeScore?.toFixed(0) || "-"}</b><small>{weaknessMode ? row.weaknessLabel || "Deterioro" : row.objectiveLabel || row.compositeLabel || "Watchlist"}</small></span>
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
          <span><strong>{row.symbol}</strong><em>{bucket.key === "weakness" ? row.weaknessScore?.toFixed(0) || "-" : row.objectiveScore?.toFixed(0) || row.totalScore?.toFixed(0) || "-"}</em></span>
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

/* ── Superficie móvil (tape, movers, lista de resultados) ── */
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

function MobileResultRow({ row, settings, onReview, onFavorite, isFavorite, onOpenStock, activeIssueKey = "Todos", onDecisionIssueSelect, decisionResolutions = {} }) {
  const change = Number.isFinite(row.perf3m) ? row.perf3m : row.rs3m;
  const filterPlan = buildScreenerFilterExplainPlan(row, settings);
  const rankExplain = explainScreenerRank(row, settings);
  const rowIssues = auditDecisionRowIssues(row, rankExplain);
  const confidence = decisionConfidenceForRow(row, rankExplain);
  const resolution = decisionResolutionForRow(row, decisionResolutions);
  const scoreAudit = buildScreenerScoreAudit(row);
  const dataHealth = buildScreenerDataHealth(row, settings);
  const metricTruth = objectiveMetricCompactState(row);
  const evidence = buildDecisionEvidenceChecklist(row, rankExplain);
  const vcpReliability = vcpReliabilityAudit(row);
  const reviewFocus = buildRowReviewFocus({ dataHealth, metricTruth, scoreAudit, vcpReliability, evidence, rowIssues });
  const trustSignature = buildRowTrustSignature({ dataHealth, metricTruth, scoreAudit, evidence, vcpReliability, rowIssues });
  return <article className={`mobileResultRow ${resolution ? `resolved-${resolution.key}` : ""}`.trim()}>
    <button type="button" className={`mobileResultLogo ${isFavorite ? "fav" : ""}`} onClick={() => onFavorite(row)} aria-label={`Guardar favorito ${row.symbol}`}>
      <CompanyMark row={row} size="lg" />
    </button>
    <div className="mobileResultIdentity">
      <Link href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>
        <b>{row.symbol}</b>
        <span>{row.companyName}</span>
      </Link>
      <div className="mobileResultBadges">
        <DecisionResolutionBadge resolution={resolution} />
        <ReviewFocusPill focus={reviewFocus} />
        <DecisionConfidenceBadge confidence={confidence} compact />
        <DataHealthPanel health={dataHealth} compact />
        <ObjectiveMetricTruthPill state={metricTruth} />
        <ScoreAuditPanel audit={scoreAudit} compact />
        <DecisionIssueBadge issues={rowIssues} compact activeKey={activeIssueKey} onSelect={onDecisionIssueSelect} />
      </div>
      <div className="mobileResultTrustLine" aria-label={`Fiabilidad de ${row.symbol}`}>
        <RowTrustSignature signature={trustSignature} />
      </div>
    </div>
    <button type="button" className="mobileResultSpark" onClick={() => onReview(row.symbol)} aria-label={`Revisar ${row.symbol}`}>
      <MiniSparkline bars={row.chartPreview || []} />
    </button>
    <Link className="mobileResultPrice" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>
      <b>{money(row.price, row.currency)}</b>
      <span className={(change || 0) >= 0 ? "up" : "down"}>{pct(change)}</span>
    </Link>
    <InfoHint text={[rankExplain.text, filterPlan.text].filter(Boolean).join(" · ")} tone={rankExplain.tone === "bad" ? "warn" : filterPlan.tone} />
  </article>;
}

function MobileResultList({ rows = [], settings, totalRows = rows.length, sort, onSort, onReview, onFavorite, favoriteSymbols, onSave, onCsv, onAuditJson, onOpenStock, savingDisabled = false, page = 1, pageSize = DEFAULT_RESULT_PAGE_SIZE, totalPages = 1, onPage, onPageSize, decisionQuality, decisionIssueFilter = "Todos", onDecisionIssueFilter, decisionProfileFilter = "Todos", onDecisionProfileFilter, reviewPriorityFilter = "all", reviewPriorityOptions = [{ key: "all", displayLabel: "Prioridad: Todas" }], onReviewPriorityFilter, reliabilityFilter = RELIABILITY_FILTER_ALL, reliabilityOptions = [{ key: RELIABILITY_FILTER_ALL, displayLabel: "Fiabilidad: Todas" }], onReliabilityFilter, decisionEvidenceSummary = null, decisionEvidenceFilter = "all", onDecisionEvidenceFilter, onDecisionEvidenceReview, readinessSummary = [], readinessFilter = "Todos", onReadinessFilter, confidenceFilter = "Todos", confidenceOptions = ["Todos"], confidenceCounts, onConfidenceFilter, dataHealthSummary = null, dataHealthFilter = "Todos", onDataHealthFilter, scoreAuditSummary = null, scoreAuditFilter = "all", onScoreAuditFilter, onScoreAuditReview, decisionResolutionFilter = "all", decisionResolutionOptions = [{ key: "all", displayLabel: "Resolución: Todas" }], onDecisionResolutionFilter, decisionResolutions = {}, emptyLabel = "Sin resultados todavia. Carga universo y ejecuta el screener." }) {
  const start = totalRows ? ((page - 1) * pageSize) + 1 : 0;
  const end = totalRows ? Math.min(page * pageSize, totalRows) : 0;
  const hasRows = totalRows > 0;
  const confidenceOptionLabel = (value) => value === "Todos"
    ? "Confianza: Todas"
    : `${decisionConfidenceLabel(value)}${confidenceCounts?.get(value) ? ` (${confidenceCounts.get(value)})` : ""}`;
  const mobileFiltersActive = (confidenceFilter !== "Todos" ? 1 : 0)
    + (reviewPriorityFilter !== "all" ? 1 : 0)
    + (reliabilityFilter !== RELIABILITY_FILTER_ALL ? 1 : 0)
    + (decisionResolutionFilter !== "all" ? 1 : 0);
  return <section className="mobileResultList">
    <div className="mobileResultListHead">
      <span>{hasRows ? `${totalRows} resultados · ${start}-${end} · ${SORT_LABELS[sort] || sort}` : "0 resultados"}</span>
      {hasRows ? <div>
        <select value={sort} onChange={(event) => onSort(event.target.value)} aria-label="Orden movil">
          <option value="objectiveScore">Objetivo</option>
          <option value="decisionPriority">Calidad decisión</option>
          <option value="totalScore">Composite</option>
          <option value="rsGlobalPct">{metricShortLabel("rsGlobalPct")}</option>
          <option value="rsRating">{metricShortLabel("rsRating")}</option>
          <option value="volumeEffectScore">Volumen</option>
          <option value="avgTurnover">Liquidez</option>
          <option value="weaknessScore">Deterioro</option>
        </select>
        <button type="button" onClick={onCsv} disabled={!rows.length}>CSV</button>
        <button type="button" onClick={onAuditJson} disabled={!rows.length} title="Exportar JSON compatible con audit:decisions">JSON</button>
        <button type="button" onClick={onSave} disabled={!rows.length || savingDisabled} aria-label="Guardar snapshot de resultados">Guardar</button>
        <button type="button" onClick={() => onReview()} disabled={!rows.length}>Revisar</button>
      </div> : null}
    </div>
    {/* Filtros no redundantes con los rails (mismo criterio que el bloque desktop):
        confianza (único acceso a medium/low), prioridad, fiabilidad y resolución.
        Los selects de pruebas/datos/score se eliminaron: sus rails viven en el
        grupo "Auditoría y datos" y son el control canónico de esos filtros. */}
    {hasRows ? <details className="disclosurePanel compactDisclosure mobileFilterDisclosure">
      <summary><span>Filtros</span><em>{mobileFiltersActive ? `${mobileFiltersActive} activos` : "Sin filtros"}</em></summary>
      <div className="mobileFilterGrid">
        <select value={confidenceFilter} onChange={(event) => onConfidenceFilter?.(event.target.value)} aria-label="Filtrar por confianza de decision">
          {confidenceOptions.map((x) => <option key={x} value={x}>{confidenceOptionLabel(x)}</option>)}
        </select>
        <select value={reviewPriorityFilter} onChange={(event) => onReviewPriorityFilter?.(event.target.value)} aria-label="Filtrar por prioridad de investigacion">
          {reviewPriorityOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel || item.label}</option>)}
        </select>
        <select value={reliabilityFilter} onChange={(event) => onReliabilityFilter?.(event.target.value)} aria-label="Filtrar por fiabilidad de observacion">
          {reliabilityOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel || item.label}</option>)}
        </select>
        <select value={decisionResolutionFilter} onChange={(event) => onDecisionResolutionFilter?.(event.target.value)} aria-label="Filtrar por resolución de decision">
          {decisionResolutionOptions.map((item) => <option key={item.key} value={item.key}>{item.displayLabel || item.label}</option>)}
        </select>
      </div>
    </details> : null}
    {hasRows ? <details className="disclosurePanel resultsDecisionGroup" open>
      <summary><span>Decisiones</span><em>{totalRows}</em></summary>
      <DecisionQualityStrip audit={decisionQuality} compact activeIssueKey={decisionIssueFilter} onIssueSelect={onDecisionIssueFilter} activeProfileKey={decisionProfileFilter} onProfileSelect={onDecisionProfileFilter} />
      <DecisionOperatingBrief audit={decisionQuality} rows={rows} compact onIssueSelect={onDecisionIssueFilter} onReadinessFilter={onReadinessFilter} onConfidenceFilter={onConfidenceFilter} onReview={onReview} />
      <DecisionSummaryRail summary={readinessSummary} activeKey={readinessFilter} onSelect={onReadinessFilter} className="mobile" />
    </details> : null}
    {hasRows ? <details className="disclosurePanel resultsAuditGroup">
      <summary><span>Auditoría y datos</span><em>{totalRows}</em></summary>
      <DecisionEvidenceSummaryRail summary={decisionEvidenceSummary} activeKey={decisionEvidenceFilter} onSelect={onDecisionEvidenceFilter} onReview={onDecisionEvidenceReview} compact />
      <DataHealthSummaryRail summary={dataHealthSummary} activeKey={dataHealthFilter} onSelect={onDataHealthFilter} compact />
      <ScoreAuditSummaryRail summary={scoreAuditSummary} activeKey={scoreAuditFilter} onSelect={onScoreAuditFilter} onReview={onScoreAuditReview} compact />
    </details> : null}
    {hasRows ? <div className="controls" style={{ marginBottom: 10 }}>
      <select value={pageSize} onChange={(event) => onPageSize?.(Number(event.target.value))} aria-label="Acciones por pagina">
        {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / página</option>)}
      </select>
      <button type="button" onClick={() => onPage?.(page - 1)} disabled={page <= 1}>Anterior</button>
      <button type="button" onClick={() => onPage?.(page + 1)} disabled={page >= totalPages}>Siguiente</button>
    </div> : null}
    <div className="mobileRows">
      {rows.length ? rows.map((row) => <MobileResultRow key={row.symbol} row={row} settings={settings} onReview={onReview} onFavorite={onFavorite} onOpenStock={onOpenStock} isFavorite={favoriteSymbols?.has(row.symbol)} activeIssueKey={decisionIssueFilter} onDecisionIssueSelect={onDecisionIssueFilter} decisionResolutions={decisionResolutions} />) : <div className="mobileEmpty">{emptyLabel}</div>}
    </div>
  </section>;
}

function RegimeStrip({ rows = [], marketHealth, presetName, setupName, mode = "leader" }) {
  const weaknessMode = mode === "weakness";
  const elite = rows.filter((r) => (r.objectiveScore ?? r.totalScore ?? 0) >= 75).length;
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

function QuickPanel({ row, settings, onOpenStock }) {
  if (!row) return <div className="quickPanel"><p className="fine">Selecciona una accion para ver sus caracteristicas.</p></div>;
  const rankExplain = explainScreenerRank(row, settings);
  const rowIssues = auditDecisionRowIssues(row, rankExplain);
  const confidence = decisionConfidenceForRow(row, rankExplain);
  const priority = decisionPriorityBreakdown(row, rankExplain);
  const evidence = buildDecisionEvidenceChecklist(row, rankExplain);
  const scoreAudit = buildScreenerScoreAudit(row);
  const dataHealth = buildScreenerDataHealth(row, settings);
  const metricTruth = objectiveMetricCompactState(row);
  const metricSource = compactMetricSourceLookup(row);
  const vcpReliability = vcpReliabilityAudit(row);
  const reviewFocus = buildRowReviewFocus({ dataHealth, metricTruth, scoreAudit, vcpReliability, evidence, rowIssues });
  const trustSignature = buildRowTrustSignature({ dataHealth, metricTruth, scoreAudit, evidence, vcpReliability, rowIssues });
  const quickMetrics = [
    [metricShortLabel("objectiveScore"), row.objectiveScore?.toFixed(0) || row.totalScore?.toFixed(0) || "-", "objectiveScore"],
    [metricShortLabel("totalScore"), row.totalScore?.toFixed(0) || "-", "totalScore"],
    [metricShortLabel("patternScore"), row.patternScore?.toFixed(0) || "-", "patternScore"],
    [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-", "rsGlobalPct"],
    [metricShortLabel("rsQualityScore"), row.rsQualityScore?.toFixed(0) || "-", "rsQualityScore"],
    [metricShortLabel("adProxyScore"), row.adProxyScore?.toFixed(0) || "-", "adProxyScore"],
    [metricShortLabel("epsGrowthProxyScore"), row.epsGrowthProxyScore?.toFixed(0) || "-", "epsGrowthProxyScore"],
    [metricShortLabel("weaknessScore"), row.weaknessScore?.toFixed(0) || "-", "weaknessScore"],
    [metricShortLabel("rsCountryPct"), row.rsCountryPct?.toFixed(0) || "-", "rsCountryPct"],
    [metricShortLabel("rsSectorPct"), row.rsSectorPct?.toFixed(0) || "-", "rsSectorPct"],
    [metricShortLabel("objectiveSetupScore"), row.objectiveSetupScore?.toFixed(0) || "-", "objectiveSetupScore"],
    ["Growth", row.growthScore?.toFixed(0) || "-", "growthScore"],
    ["Cobertura", row.dataCoverageScore?.toFixed(0) || "-", "dataCoverageScore"],
    ["3M", pct(row.perf3m), "perf3m"],
    ["52W", pct(row.distance52w), "distance52w"],
    ["SMA50", pct(row.extSma50), "extSma50"],
    ["RelVol", Number.isFinite(row.relativeVolume) ? `${row.relativeVolume.toFixed(2)}x` : "-", "relativeVolume"],
    ["Vol 5d", pct(row.volumeSurgePct), "volumeSurgePct"],
    ["Imp 20d", amount(row.avgTurnover, row.currency), "avgTurnover"],
    ["Imp sesion", amount(row.latestTurnover, row.currency), "latestTurnover"],
    [metricShortLabel("volumeEffectScore"), row.volumeEffectScore?.toFixed(0) || "-", "volumeEffectScore"],
    ["Up/Down", ratioLabel(row.upDownVolRatio), "upDownVolRatio"],
    [metricShortLabel("shortPercentOfFloat"), pct(row.shortPercentOfFloat), "shortPercentOfFloat"],
    ["Short ratio", ratioLabel(row.shortRatio), "shortRatio"],
    ["Spec Risk", row.speculationRiskScore?.toFixed(0) || "-", "speculationRiskScore"],
    ["DD 3M", Number.isFinite(row.maxDrawdown63d) ? `${row.maxDrawdown63d.toFixed(1)}%` : "-", "maxDrawdown63d"],
    ["Rent/Risk", row.riskRewardScore?.toFixed(0) || "-", "riskRewardScore"],
    ["Bench", row.benchmarkSymbol || "-", ""],
  ];
  return <aside className="quickPanel">
    <div className="quickPanelHead">
      <CompanyMark row={row} size="lg" />
      <div>
        <Link className="ticker" href={stockUrl(row.symbol)} onPointerDown={() => onOpenStock?.(row)} onClick={() => onOpenStock?.(row)}>{row.symbol}</Link>
        <p>{row.companyName}</p>
      </div>
    </div>
    <div className="compactTrustRail quickPanelTrustRail" aria-label={`Confianza de ${row.symbol}`}>
      <RowTrustSignature signature={trustSignature} />
      <ReviewFocusPill focus={reviewFocus} />
      <ObjectiveMetricTruthPill state={metricTruth} />
      <DataHealthPanel health={dataHealth} compact />
      <ScoreAuditPanel audit={scoreAudit} compact />
      <VcpReliabilityPill audit={vcpReliability} />
      <DecisionEvidenceChecklist evidence={evidence} compact />
    </div>
    <div className="quickMetricGrid">
      {quickMetrics.map(([label, value, key]) => <CompactMetric key={`${label}-${key || value}`} label={label} value={value} source={key ? metricSource(key) : null} />)}
    </div>
    <div className={`rankExplainPanel ${rankExplain.tone}`}>
      <div className="rankExplainTitle">
        <span>{rankExplain.title}</span>
        <div className="rankExplainBadges">
          <strong className={`rankActionBadge ${rankExplain.action.tone}`}>{rankExplain.action.label}</strong>
          <strong className={`rankDecisionBadge ${rankExplain.readiness.tone}`}>{rankExplain.readiness.label}</strong>
          <DecisionConfidenceBadge confidence={confidence} compact />
          <DecisionPriorityBadge priority={priority} compact />
          <InfoHint text={[rankExplain.readiness.detail, rankExplain.text].filter(Boolean).join(" · ")} tone={rankExplain.tone === "bad" ? "warn" : ""} />
        </div>
      </div>
      <div className="rankExplainChips">
        {rankExplain.drivers.slice(0, 4).map((item) => <span key={item.key} className={item.tone}>
          <b>{item.label}</b>{item.value ? <em>{item.value}</em> : null}
        </span>)}
      </div>
      {(rankExplain.displayWatch || rankExplain.watch).length ? <div className="rankExplainWatch">
        <span>Revisar</span>
        <p>{(rankExplain.displayWatch || rankExplain.watch).map((item) => item.value ? `${item.label}: ${item.value}` : item.label).slice(0, 3).join(" · ")}</p>
      </div> : null}
      <DecisionEvidenceChecklist evidence={evidence} />
    </div>
    <DataHealthPanel health={dataHealth} />
    <ScoreAuditPanel audit={scoreAudit} />
    {rowIssues.length ? <div className="decisionIssueRail">
      {rowIssues.slice(0, 4).map((issue) => <DecisionIssueBadge key={issue.key} issues={[issue]} />)}
    </div> : null}
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

function PreviewCard({ row, variant = "grid", onFavorite, isFavorite = false, onSelectChart, onOpenStock, decisionResolutions = {} }) {
  const links = externalLinks(row.symbol, row.exchange);
  const compact = variant === "table";
  const summary = variant === "search";
  const showSparkline = !compact && !summary;
  const stage = stageLabel(row);
  const stageClass = stage === "Stage 2" ? "good" : stage === "Stage 4" ? "bad" : "neutral";
  const metricSource = compactMetricSourceLookup(row);
  const stats = compact
    ? [[metricShortLabel("objectiveScore"), row.objectiveScore?.toFixed(0) || row.totalScore?.toFixed(0) || "-", "objectiveScore"], [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-", "rsGlobalPct"], [metricShortLabel("volumeEffectScore"), row.volumeEffectScore?.toFixed(0) || "-", "volumeEffectScore"]]
    : summary
      ? [["Precio", money(row.price, row.currency), ""], [metricShortLabel("objectiveScore"), row.objectiveScore?.toFixed(0) || row.totalScore?.toFixed(0) || "-", "objectiveScore"], [metricShortLabel("totalScore"), row.totalScore?.toFixed(0) || "-", "totalScore"], [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-", "rsGlobalPct"], [metricShortLabel("rsRating"), row.rsRating?.toFixed(0) || "-", "rsRating"], [metricShortLabel("adProxyScore"), row.adProxyScore?.toFixed(0) || "-", "adProxyScore"], [metricShortLabel("epsGrowthProxyScore"), row.epsGrowthProxyScore?.toFixed(0) || "-", "epsGrowthProxyScore"], ["Bench", row.benchmarkSymbol || "-", ""]]
      : [["Precio", money(row.price, row.currency), ""], [metricShortLabel("objectiveScore"), row.objectiveScore?.toFixed(0) || row.totalScore?.toFixed(0) || "-", "objectiveScore"], [metricShortLabel("patternScore"), row.patternScore?.toFixed(0) || "-", "patternScore"], [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-", "rsGlobalPct"], [metricShortLabel("rsRating"), row.rsRating?.toFixed(0) || "-", "rsRating"], [metricShortLabel("rsQualityScore"), row.rsQualityScore?.toFixed(0) || "-", "rsQualityScore"], [metricShortLabel("volumeEffectScore"), row.volumeEffectScore?.toFixed(0) || "-", "volumeEffectScore"], [metricShortLabel("shortPercentOfFloat"), pct(row.shortPercentOfFloat), "shortPercentOfFloat"], ["Imp 20d", amount(row.avgTurnover, row.currency), "avgTurnover"], ["Cob", row.dataCoverageScore?.toFixed(0) || "-", "dataCoverageScore"], ["Bench", row.benchmarkSymbol || "-", ""]];
  const summaryStats = [
    [metricShortLabel("objectiveScore"), row.objectiveScore?.toFixed(0) || row.totalScore?.toFixed(0) || "-", "objectiveScore"],
    [metricShortLabel("totalScore"), row.totalScore?.toFixed(0) || "-", "totalScore"],
    [metricShortLabel("rsGlobalPct"), row.rsGlobalPct?.toFixed(0) || "-", "rsGlobalPct"],
    [metricShortLabel("rsRating"), row.rsRating?.toFixed(0) || "-", "rsRating"],
    [metricShortLabel("adProxyScore"), row.adProxyScore?.toFixed(0) || "-", "adProxyScore"],
    [metricShortLabel("epsGrowthProxyScore"), row.epsGrowthProxyScore?.toFixed(0) || "-", "epsGrowthProxyScore"],
    ["Bench", row.benchmarkSymbol || "-", ""],
  ];
  const resolution = decisionResolutionForRow(row, decisionResolutions);
  const rankExplain = explainScreenerRank(row, {});
  const rowIssues = auditDecisionRowIssues(row, rankExplain);
  const scoreAudit = buildScreenerScoreAudit(row);
  const dataHealth = buildScreenerDataHealth(row, {});
  const metricTruth = objectiveMetricCompactState(row);
  const evidence = buildDecisionEvidenceChecklist(row, rankExplain);
  const vcpReliability = vcpReliabilityAudit(row);
  const trustSignature = buildRowTrustSignature({ dataHealth, metricTruth, scoreAudit, evidence, vcpReliability, rowIssues });
  return <div className={`stockPreview stockPreview-${variant} ${resolution ? `resolved-${resolution.key}` : ""}`.trim()}>
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
        <DecisionResolutionBadge resolution={resolution} />
        <span className={`previewStage ${stageClass}`}>{stage}</span>
      </div> : <span className={`previewStage ${stageClass}`}>{stage}</span>}
    </div>
    {showSparkline && <MiniSparkline bars={row.chartPreview || []} />}
    {summary ? <div className="previewSummaryGrid">
      {summaryStats.map(([label, value, key]) => <CompactMetric className="previewSummaryStat" key={label} label={label} value={value} source={key ? metricSource(key) : null} />)}
    </div> : <div className="previewStats">
      {stats.map(([label, value, key]) => <CompactMetric key={label} label={label} value={value} source={key ? metricSource(key) : null} />)}
    </div>}
    <RowTrustSignature signature={trustSignature} className={`previewTrustSignature ${compact ? "compact" : ""}`.trim()} />
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

function CompactMetric({ label, value, tone = "", source = null, title = "", className = "" }) {
  const sourceClass = source?.key ? `source-${source.key}` : "";
  const sourceTitle = source?.title || "";
  const valueText = value ?? "-";
  const titleText = [title, sourceTitle].filter(Boolean).join(" · ") || undefined;
  const ariaLabel = sourceTitle ? `${label}: ${valueText}. ${sourceTitle}` : undefined;
  return <span className={`compactMetric ${className} ${tone} ${sourceClass}`.trim()} title={titleText} aria-label={ariaLabel}>
    <small>{label}</small>
    <b>{valueText}</b>
    {source?.mark ? <i aria-hidden="true">{source.mark}</i> : null}
  </span>;
}

function compactIssueLabel(label = "", key = "") {
  const text = String(label || key || "").toLowerCase();
  if (/\brs\b|liderazgo rs/.test(text)) return "RS";
  if (/\bscore\b/.test(text)) return "Score";
  if (/\bsma50\b/.test(text)) return "SMA50";
  if (/evidencia|prueba/.test(text)) return "Pruebas";
  if (/\bdatos?\b|\bprecio\b/.test(text)) return "Datos";
  if (/volumen|demanda/.test(text)) return "Demanda";
  if (/riesgo/.test(text)) return "Riesgo";
  if (/setup|vcp/.test(text)) return "Setup";
  if (/operable|candidato|confirmaci/.test(text)) return "Validar";
  return String(label || key || "Revisar").split(/\s+/).slice(0, 2).join(" ");
}

function buildRowReviewFocus({ dataHealth = null, metricTruth = null, scoreAudit = null, vcpReliability = null, evidence = null, rowIssues = [] } = {}) {
  const candidates = [];
  const add = ({ priority = 0, key = "", label = "", tone = "warn", detail = "" } = {}) => {
    if (!key || !label) return;
    candidates.push({ priority, key, label, tone, detail });
  };
  const dataKey = dataHealth?.status?.key || "";
  if (dataKey === "blocked") {
    add({ priority: 100, key: "data", label: "Datos", tone: "bad", detail: dataHealth.status?.detail || dataHealth.topLine || "Datos bloqueados." });
  } else if (["stale", "thin", "limited", "unknown"].includes(dataKey)) {
    add({ priority: 72, key: "data", label: "Datos", tone: dataHealth?.status?.tone || "warn", detail: dataHealth.status?.detail || dataHealth.topLine || "Datos a revisar." });
  }

  const metricKey = metricTruth?.key || "";
  if (metricKey === "blocked") {
    add({ priority: 95, key: "metrics", label: "Metr.", tone: "bad", detail: metricTruth.title || metricTruth.detail || "Métricas bloqueadas." });
  } else if (["review", "missing"].includes(metricKey)) {
    add({ priority: 82, key: "metrics", label: "Metr.", tone: "warn", detail: metricTruth.title || metricTruth.detail || "Métricas a validar." });
  }

  const scoreKey = scoreAuditCompactFilterKey(scoreAudit);
  if (scoreKey === "mismatch") {
    add({ priority: 86, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Score descuadrado." });
  } else if (scoreKey === "missing") {
    add({ priority: 76, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Componentes de score incompletos." });
  } else if (scoreKey === "attention") {
    add({ priority: 58, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Score a revisar." });
  }

  const vcpKey = vcpReliability?.key || "";
  if (vcpKey === "blocked") {
    add({ priority: 80, key: "vcp", label: "VCP", tone: "bad", detail: vcpReliability.summary || vcpReliability.note || "VCP bloqueado." });
  } else if (["inconsistent", "needs-data"].includes(vcpKey)) {
    add({ priority: 70, key: "vcp", label: "VCP", tone: "warn", detail: vcpReliability.summary || vcpReliability.note || "VCP a validar." });
  } else if (["needs-validation", "summary-only"].includes(vcpKey)) {
    add({ priority: 45, key: "vcp", label: "VCP", tone: vcpReliability.tone || "warn", detail: vcpReliability.summary || vcpReliability.note || "Validar patrón." });
  }

  if (evidence?.status === "blocked") {
    add({ priority: 74, key: "evidence", label: "Pruebas", tone: "bad", detail: evidence.summary || "Pruebas bloqueadas." });
  } else if (evidence?.status === "needs-work") {
    const pending = Array.isArray(evidence.pending) ? evidence.pending[0] : null;
    add({ priority: 62, key: "evidence", label: "Pruebas", tone: evidence.tone || "warn", detail: pending?.detail || pending?.label || evidence.summary || "Pruebas pendientes." });
  }

  const issue = Array.isArray(rowIssues) ? rowIssues[0] : null;
  if (issue?.key || issue?.label) {
    add({
      priority: issue.severity === "bad" ? 66 : 52,
      key: "issue",
      label: compactIssueLabel(issue.label, issue.key),
      tone: issue.severity || "warn",
      detail: issue.detail || issue.label || "Revisar incidencia.",
    });
  }

  return candidates.sort((a, b) => b.priority - a.priority)[0] || null;
}

function ReviewFocusPill({ focus = null }) {
  if (!focus) return null;
  return <span className={`reviewFocusPill ${focus.tone || "warn"} focus-${focus.key || "other"}`} title={focus.detail || focus.label}>
    <b>Foco</b>
    <em>{focus.label}</em>
  </span>;
}

function vcpCompactLabel(audit = null) {
  const key = audit?.key || "";
  if (key === "audit-ready") return "Audit.";
  if (key === "needs-validation") return "Valid.";
  if (key === "summary-only") return "Resumen";
  if (key === "needs-data") return "Datos";
  if (key === "inconsistent") return "Rev.";
  if (key === "blocked") return "Bloq.";
  return "VCP";
}

function DecisionIssueBadge({ issues = [], compact = false, activeKey = "Todos", onSelect }) {
  const primary = issues[0];
  if (!primary) return null;
  const active = primary.key && activeKey === primary.key;
  const detail = issues.map((issue) => issue.detail ? `${issue.label}: ${issue.detail}` : issue.label).join(" · ");
  const className = `decisionIssueBadge ${compact ? "compact" : ""} ${primary.severity || "warn"} ${active ? "active" : ""}`;
  const body = <>
    <b>{compact ? compactIssueLabel(primary.label, primary.key) : primary.label}</b>
    {issues.length > 1 ? <em>+{issues.length - 1}</em> : null}
  </>;
  return primary.key && onSelect ? <button
    type="button"
    className={className}
    title={detail}
    onClick={(event) => {
      event.stopPropagation();
      onSelect(active ? "Todos" : primary.key);
    }}
    aria-pressed={active}
  >
    {body}
  </button> : <span className={className} title={detail}>{body}</span>;
}

function VcpReliabilityPill({ audit = null }) {
  if (!audit) return null;
  const title = [
    audit.label,
    Number.isFinite(audit.auditabilityPct) ? `${audit.auditabilityPct}%` : "",
    audit.summary,
    audit.sequence ? `Secuencia ${audit.sequence}` : "",
    audit.note,
  ].filter(Boolean).join(" · ");
  return <span className={`vcpReliabilityPill ${audit.tone || "neutral"}`} title={title}>
    <b>VCP</b>
    <em>{vcpCompactLabel(audit)}</em>
  </span>;
}

function ObjectiveMetricTruthPill({ state = null }) {
  if (!state) return null;
  return <span className={`objectiveMetricTruthPill ${state.tone || "neutral"}`} title={state.title || state.label}>
    <b>Metr.</b>
    <em>{state.label}</em>
  </span>;
}

function ResultFilterChips({ chips = [], hiddenCount = 0, visibleCount = null, totalCount = null, brief = null, onClearAll, onReview }) {
  if (!chips.length && !hiddenCount) return null;
  const hasVisibleCounts = Number.isFinite(visibleCount) && Number.isFinite(totalCount);
  const visibleLabel = hasVisibleCounts ? `${visibleCount}/${totalCount}` : String(Math.max(0, Number(visibleCount) || 0));
  return <div className={`resultFilterChips ${brief ? "withBrief" : ""}`.trim()}>
    <div className="resultViewFocusSummary" aria-label="Resumen de vista de investigacion">
      <span>
        <em>Vista de investigación</em>
        <b>{visibleLabel}</b>
      </span>
      <span>
        <em>filtros</em>
        <b>{chips.length}</b>
      </span>
      <span>
        <em>ocultas</em>
        <b>{hiddenCount}</b>
      </span>
      {onReview && Number(visibleCount) > 0 ? <button type="button" onClick={onReview}>Revisar vista</button> : null}
    </div>
    {brief ? <div className={`resultViewBrief ${brief.tone || "neutral"}`} aria-label="Brief de investigacion de la vista">
      <span className="resultViewBriefIntro" title={brief.detail || undefined}>
        <em>Brief vista</em>
        <b>{brief.label}</b>
      </span>
      <div>
        {(brief.items || []).slice(0, 3).map((item) => <span className={item.tone || "neutral"} key={item.key || item.label} title={item.detail || undefined}>
          <em>{item.label}</em>
          <b>{item.value}</b>
        </span>)}
      </div>
    </div> : null}
    <div className="resultViewChipRail">
      {hiddenCount > 0 ? <div className="resultFilterChipSummary">
        <b>{hiddenCount}</b>
        <span>ocultas por vista</span>
      </div> : null}
      {chips.map((chip) => <button type="button" key={chip.key} className="resultFilterChip" onClick={chip.onClear}>
        <span>{chip.label}</span>
        <b>×</b>
      </button>)}
      {chips.length ? <button type="button" className="resultFilterClear" onClick={onClearAll}>Limpiar vista</button> : null}
    </div>
  </div>;
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

/* ── Tablas de resultados y paneles de filtros ── */
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

function CompactResultsTable({ rows = [], settings, favoriteSymbols, onFavorite, onReview, onOpenStock, rankOffset = 0, emptyLabel = "Ejecuta un scan para ver resultados", decisionIssueFilter = "Todos", onDecisionIssueFilter, decisionEvidenceFilter = "all", onDecisionEvidenceFilter, dataHealthFilter = "Todos", onDataHealthFilter, scoreAuditFilter = "all", onScoreAuditFilter, decisionResolutions = {} }) {
  const headers = ["★", "#", "Compañía", "Gráfico", "Setup", "RS", "Mom.", "Riesgo", "Volumen", "Objetivo"];
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
          const vcpReliability = vcpReliabilityAudit(r);
          const setupInfo = [
            setupObjective.detail,
            `${vcpReliability.label}: ${vcpReliability.auditabilityPct}% · ${vcpReliability.summary}`,
            `Veredicto: ${quickSetup(r)}`,
            setupDetail,
          ].filter(Boolean).join(" · ");
          const filterPlan = buildScreenerFilterExplainPlan(r, settings);
          const rankExplain = explainScreenerRank(r, settings);
          const rowIssues = auditDecisionRowIssues(r, rankExplain);
          const confidence = decisionConfidenceForRow(r, rankExplain);
          const priority = decisionPriorityBreakdown(r, rankExplain);
          const evidence = buildDecisionEvidenceChecklist(r, rankExplain);
          const scoreAudit = buildScreenerScoreAudit(r);
          const dataHealth = buildScreenerDataHealth(r, settings);
          const metricTruth = objectiveMetricCompactState(r);
          const metricSource = compactMetricSourceLookup(r);
          const evidenceFocus = evidence.pending?.[0] || (rankExplain.displayWatch || rankExplain.watch)[0];
          const issueTone = rowIssues.some((issue) => issue.severity === "bad") ? "bad" : rowIssues.length ? "warn" : "";
          const resolution = decisionResolutionForRow(r, decisionResolutions);
          const reviewFocus = buildRowReviewFocus({ dataHealth, metricTruth, scoreAudit, vcpReliability, evidence, rowIssues });
          const trustSignature = buildRowTrustSignature({ dataHealth, metricTruth, scoreAudit, evidence, vcpReliability, rowIssues });
          const compactTrustTitle = [
            trustSignature.title,
            reviewFocus ? `Foco: ${reviewFocus.label}${reviewFocus.detail ? ` (${reviewFocus.detail})` : ""}` : "",
            `Datos: ${dataHealth.status?.label || "sin auditoria"}${dataHealth.topLine ? ` (${dataHealth.topLine})` : ""}`,
            `Metricas: ${metricTruth.title || metricTruth.label}`,
            `Score: ${scoreAudit.topLine || "sin auditoria"}`,
            `VCP: ${vcpReliability.label} ${vcpReliability.auditabilityPct}%`,
            evidenceFocus ? `Revisar: ${evidenceFocus.label}` : rankExplain.readiness.detail,
            rowIssues.length ? `Incidencias: ${rowIssues.map((issue) => issue.label).join(", ")}` : "",
          ].filter(Boolean).join(" · ");
          return <tr key={r.symbol} className={`${issueTone ? `hasDecisionIssue ${issueTone}` : ""} ${resolution ? `resolved-${resolution.key}` : ""}`.trim()} onClick={(e) => { if (!e.target.closest("button, a")) onOpen(); }}>
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
            <td className="compactIdentityCell">
              <CompanyMark row={r} size="sm" />
              <span className="compactIdentityText">
                <span className="compactIdentityTop">
                  <Link className="ticker" href={stockUrl(r.symbol)} onPointerDown={() => onOpenStock?.(r)} onClick={() => onOpenStock?.(r)}>{r.symbol}</Link>
                  <CompactCountryFlag country={country} />
                </span>
                <b title={r.companyName || r.symbol}>{r.companyName || r.symbol}</b>
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
                <small className={`vcpReliabilityLine ${vcpReliability.tone}`} title={vcpReliability.note}>
                  {vcpReliability.label} · {vcpReliability.auditabilityPct}%
                </small>
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="G" value={Number.isFinite(rsValue) ? rsValue.toFixed(0) : "-"} tone={compactTone(rsValue, 75, 45)} source={metricSource("rsGlobalPct")} />
                <CompactMetric label="Grp" value={Number.isFinite(r.rsSectorPct) ? r.rsSectorPct.toFixed(0) : "-"} source={metricSource("rsSectorPct")} />
                <CompactMetric label="Q" value={Number.isFinite(r.rsQualityScore) ? r.rsQualityScore.toFixed(0) : "-"} tone={compactTone(r.rsQualityScore, 70, 40)} source={metricSource("rsQualityScore")} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="3M" value={pct(r.perf3m)} tone={compactTone(r.perf3m, 20, 0)} source={metricSource("perf3m")} />
                <CompactMetric label="6M" value={pct(r.perf6m)} tone={compactTone(r.perf6m, 35, 0)} source={metricSource("perf6m")} />
                <CompactMetric label="52w" value={pct(r.distance52w)} tone={compactTone(r.distance52w, -10, -35)} source={metricSource("distance52w")} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="Ext." value={pct(r.extSma50)} source={metricSource("extSma50")} />
                <CompactMetric label="DD63" value={Number.isFinite(r.maxDrawdown63d) ? `${r.maxDrawdown63d.toFixed(1)}%` : "-"} source={metricSource("maxDrawdown63d")} />
                <CompactMetric label="Short" value={pct(r.shortPercentOfFloat)} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="RV" value={Number.isFinite(r.relativeVolume) ? `${r.relativeVolume.toFixed(2)}x` : "-"} tone={compactTone(r.relativeVolume, 1.5)} source={metricSource("relativeVolume")} />
                <CompactMetric label="A/D" value={Number.isFinite(r.adProxyScore) ? r.adProxyScore.toFixed(0) : "-"} tone={compactTone(r.adProxyScore, 70, 40)} source={metricSource("adProxyScore")} />
                <CompactMetric label="Ef." value={Number.isFinite(r.volumeEffectScore) ? r.volumeEffectScore.toFixed(0) : "-"} />
              </div>
            </td>
            <td className="compactScoreCell">
              <span className="compactScoreHead">
                <b>{Number.isFinite(r.objectiveScore) ? r.objectiveScore.toFixed(0) : Number.isFinite(r.totalScore) ? r.totalScore.toFixed(0) : "-"}</b>
                <em className={`rankActionBadge compact ${rankExplain.action.tone}`}>{rankExplain.action.label}</em>
                <em className={`rankDecisionBadge compact ${rankExplain.readiness.tone}`}>{rankExplain.readiness.label}</em>
                <DecisionResolutionBadge resolution={resolution} />
                <DecisionConfidenceBadge confidence={confidence} compact />
                <DecisionPriorityBadge priority={priority} compact />
                <InfoHint text={[rankExplain.readiness.detail, rankExplain.text, filterPlan.text].filter(Boolean).join(" · ")} tone={rankExplain.tone === "bad" ? "warn" : filterPlan.tone} />
              </span>
              <span className="compactScoreMeta" title={`Comp ${Number.isFinite(r.totalScore) ? r.totalScore.toFixed(0) : "-"} · VCP ${Number.isFinite(r.patternScore) ? r.patternScore.toFixed(0) : "-"} · Weinstein ${Number.isFinite(r.weinsteinScore) ? r.weinsteinScore.toFixed(0) : "-"} · EPS ${Number.isFinite(r.epsGrowthProxyScore) ? r.epsGrowthProxyScore.toFixed(0) : "-"}`}>
                Obj {Number.isFinite(r.objectiveScore) ? r.objectiveScore.toFixed(0) : Number.isFinite(r.totalScore) ? r.totalScore.toFixed(0) : "-"} · Comp {Number.isFinite(r.totalScore) ? r.totalScore.toFixed(0) : "-"}
              </span>
              <div className="compactTrustRail" title={compactTrustTitle} aria-label={`Confianza de ${r.symbol}`}>
                <RowTrustSignature signature={trustSignature} />
                <ReviewFocusPill focus={reviewFocus} />
                <DataHealthPanel health={dataHealth} compact activeKey={dataHealthFilter} onFilter={onDataHealthFilter} />
                <ObjectiveMetricTruthPill state={metricTruth} />
                <ScoreAuditPanel audit={scoreAudit} compact activeKey={scoreAuditFilter} onFilter={onScoreAuditFilter} />
                <VcpReliabilityPill audit={vcpReliability} />
                <DecisionEvidenceChecklist evidence={evidence} compact activeKey={decisionEvidenceFilter} onFilter={onDecisionEvidenceFilter} />
                <DecisionIssueBadge issues={rowIssues} compact activeKey={decisionIssueFilter} onSelect={onDecisionIssueFilter} />
              </div>
            </td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={headers.length} className="emptyResultsCell">{emptyLabel}</td></tr>}
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

export {
  money, cap, amount, sleep, searchText, investorStatusLabel, InfoHint, ratioLabel,
  ipoVerificationText, initials, shortBusiness, quickBusinessDescription,
  quickBusinessMarket, chartPath, MiniSparkline, TradingViewPreviewChart, companyLogoDomain,
  CompanyMark, quickSetup, compactPatternReason, compactPatternDetail, LeaderTape,
  ScoreLine, OpportunityMap, MarketMiniTape, SetupChipRail,
  MobileMoverCard, MobileTopMovers, MobileResultRow, buildRowTrustSignature, RowTrustSignature, DecisionQualityStrip, DecisionOperatingBrief, DecisionSummaryRail, DecisionEvidenceChecklist, DecisionEvidenceSummaryRail, DataHealthPanel, DataHealthSummaryRail, ScoreAuditPanel, ScoreAuditSummaryRail, AuditabilitySummaryRail, MobileResultList, RegimeStrip,
  PendingDecisionWorkRail,
  QuickPanel, PreviewCard, SearchCandidateList, SearchScopeList, compactTone, CompactMetric,
  DecisionIssueBadge, ResultFilterChips, PendingResultsBar, ScreenerContractPanel,
  FilterTemplatePanel, FilterFamilyModal, CompactCountryFlag, CompactResultsTable,
  FilterNumber, FilterToggle, LayerToggleButton, LayerControl, FilterArchitecturePanel,
  FilterDiagnosticsPanel, activeLayerCount, ruleCountLabel, layerStatusText,
  DECISION_PROFILE_ORDER, buildReviewProfileSummary, decisionProfileForRow, decisionProfileLabel, prepareReviewQueueRows, reviewProfileMeta,
};
