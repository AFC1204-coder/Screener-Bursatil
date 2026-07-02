// lib/screenerMarket.jsx — tarjetas/charts de preview, leaders y oportunidades.
// Feature module: presentación de superficies de mercado (preview, leaders, cinta).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import RowTrustSignature from "@/app/RowTrustSignature";
import UniversalPriceChart from "@/app/UniversalPriceChart";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";
import { getJson } from "@/lib/clientApi";
import { pct } from "@/lib/formatters";
import { clamp } from "@/lib/indicators";
import { metricShortLabel } from "@/lib/metricCatalog";
import { rsUniverseValue } from "@/lib/relativeStrength";
import { ipoAgeMonthsForRow } from "@/lib/scoring";
import { GLOBAL_INDEX_TAPE } from "@/lib/screenerConfig";
import { buildDecisionEvidenceChecklist, explainScreenerRank } from "@/lib/screenerExplainability";
import { stageLabel } from "@/lib/screenerPipeline";
import { buildRowReviewFocus, decisionConfidenceForRow, decisionResolutionForRow, verifiedIpoCategory } from "@/lib/screenerResultView";
import { auditDecisionRowIssues, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit } from "@/lib/screenerScoreAudit";
import { vcpReliabilityAudit } from "@/lib/vcpDiagnostics";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";
import { externalLinks, isTradingViewWidgetBlocked, stockUrl } from "@/lib/symbols";
import {
  amount,
  compactMetricSourceLookup,
  money,
  objectiveMetricCompactState,
  quickSetup,
  ratioLabel,
} from "@/lib/screenerFormat";
import {
  CompanyMark,
  CompactMetric,
  DecisionIssueBadge,
  MiniSparkline,
  ObjectiveMetricTruthPill,
  ReviewFocusPill,
  VcpReliabilityPill,
} from "@/lib/screenerAtoms";
import {
  DecisionConfidenceBadge,
  DecisionPriorityBadge,
  DecisionResolutionBadge,
} from "@/lib/screenerDomains/decision";
import { DecisionEvidenceChecklist, ScoreAuditPanel } from "@/lib/screenerDomains/audit";
import { DataHealthPanel } from "@/lib/screenerDomains/dataHealth";

export function ipoVerificationText(row = {}) {
  const category = verifiedIpoCategory(row);
  if (!category) return "No reciente / sin fecha fiable";
  const date = row.ipoDate || row.snapshot?.ipoDate || "";
  const age = ipoAgeMonthsForRow(row);
  const evidence = date || (Number.isFinite(age) ? `${age.toFixed(0)}m` : "verificada");
  return [category, evidence].filter(Boolean).join(" · ");
}

export function TradingViewPreviewChart({ row, chartSettings = DEFAULT_CHART_SETTINGS }) {
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

export function LeaderTape({ rows = [], activeRow, onSelect, onFavorite, favoriteSymbols, mode = "leader" }) {
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

export function ScoreLine({ label, value }) {
  const n = Number.isFinite(value) ? value : 0;
  return <div className="scoreLine">
    <span>{label}</span>
    <b>{Number.isFinite(value) ? value.toFixed(0) : "-"}</b>
    <i style={{ width: `${clamp(n)}%` }} />
  </div>;
}

export function OpportunityMap({ buckets = [], onSelect }) {
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

export function MarketMiniTape({ marketHealth }) {
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

export function QuickPanel({ row, settings, onOpenStock }) {
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

export function PreviewCard({ row, variant = "grid", onFavorite, isFavorite = false, onSelectChart, onOpenStock, decisionResolutions = {} }) {
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
