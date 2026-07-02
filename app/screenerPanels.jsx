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
  compactIssueLabel,
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
  vcpCompactLabel,
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
} from "@/lib/screenerDomains/audit";
import { DataHealthPanel, DataHealthSummaryRail } from "@/lib/screenerDomains/dataHealth";
import { buildRowReviewFocus } from "@/lib/screenerResultView";
import {
  CompanyMark,
  CompactMetric,
  DecisionIssueBadge,
  MiniSparkline,
  ObjectiveMetricTruthPill,
  ReviewFocusPill,
  VcpReliabilityPill,
} from "@/lib/screenerAtoms";
import { CompactCountryFlag, CompactResultsTable, PendingResultsBar } from "@/lib/screenerTable";
import {
  LeaderTape,
  MarketMiniTape,
  OpportunityMap,
  PreviewCard,
  QuickPanel,
  ScoreLine,
  TradingViewPreviewChart,
  ipoVerificationText,
} from "@/lib/screenerMarket";

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
