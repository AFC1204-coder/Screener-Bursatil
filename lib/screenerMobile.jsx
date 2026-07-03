"use client";

// lib/screenerMobile.jsx — composición de la superficie móvil del screener:
// cinta de movers, lista de resultados, fila de resultado y franja de régimen.

import Link from "next/link";
import RowTrustSignature from "@/app/RowTrustSignature";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { pct } from "@/lib/formatters";
import { methodologyTradePlanEligible } from "@/lib/methodologyDisplay";
import { metricShortLabel } from "@/lib/metricCatalog";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";
import { auditDecisionRowIssues, decisionConfidenceLabel } from "@/lib/decisionAudit";
import { DEFAULT_RESULT_PAGE_SIZE, RESULT_PAGE_SIZES, SORT_LABELS } from "@/lib/screenerConfig";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildScreenerFilterExplainPlan } from "@/lib/screenerFilters";
import { buildDecisionEvidenceChecklist, explainScreenerRank } from "@/lib/screenerExplainability";
import { buildScreenerScoreAudit } from "@/lib/screenerScoreAudit";
import { RELIABILITY_FILTER_ALL } from "@/lib/screenerReliability";
import { buildRowReviewFocus, decisionConfidenceForRow, decisionResolutionForRow } from "@/lib/screenerResultView";
import { stockUrl } from "@/lib/symbols";
import { vcpReliabilityAudit } from "@/lib/vcpDiagnostics";
import { money, objectiveMetricCompactState } from "@/lib/screenerFormat";
import { ResultsDisclosureGroup } from "@/lib/screenerAtoms";
import {
  CompanyMark,
  DecisionIssueBadge,
  MiniSparkline,
  ObjectiveMetricTruthPill,
  ReviewFocusPill,
} from "@/lib/screenerAtoms";
import { DecisionEvidenceSummaryRail, ScoreAuditPanel, ScoreAuditSummaryRail } from "@/lib/screenerDomains/audit";
import { DataHealthPanel, DataHealthSummaryRail } from "@/lib/screenerDomains/dataHealth";
import {
  DecisionConfidenceBadge,
  DecisionOperatingBrief,
  DecisionQualityStrip,
  DecisionResolutionBadge,
  DecisionSummaryRail,
} from "@/lib/screenerDomains/decision";

export function MobileMoverCard({ row, onSelect }) {
  const change = Number.isFinite(row.perf3m) ? row.perf3m : row.rs3m;
  return <button type="button" className="mobileMoverCard" onClick={() => onSelect(row)}>
    <CompanyMark row={row} size="sm" />
    <span className={(change || 0) >= 0 ? "up" : "down"}>{pct(change)}</span>
    <b>{row.symbol}</b>
    <em>{money(row.price, row.currency)}</em>
    <MiniSparkline bars={row.chartPreview || []} />
  </button>;
}

export function MobileTopMovers({ rows = [], onSelect }) {
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

export function MobileResultRow({ row, settings, onReview, onFavorite, isFavorite, onOpenStock, activeIssueKey = "Todos", onDecisionIssueSelect, decisionResolutions = {} }) {
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

export function MobileResultList({ rows = [], settings, totalRows = rows.length, sort, onSort, onReview, onFavorite, favoriteSymbols, onSave, onCsv, onAuditJson, onOpenStock, savingDisabled = false, page = 1, pageSize = DEFAULT_RESULT_PAGE_SIZE, totalPages = 1, onPage, onPageSize, decisionQuality, decisionIssueFilter = "Todos", onDecisionIssueFilter, decisionProfileFilter = "Todos", onDecisionProfileFilter, reviewPriorityFilter = "all", reviewPriorityOptions = [{ key: "all", displayLabel: "Prioridad: Todas" }], onReviewPriorityFilter, reliabilityFilter = RELIABILITY_FILTER_ALL, reliabilityOptions = [{ key: RELIABILITY_FILTER_ALL, displayLabel: "Fiabilidad: Todas" }], onReliabilityFilter, decisionEvidenceSummary = null, decisionEvidenceFilter = "all", onDecisionEvidenceFilter, onDecisionEvidenceReview, readinessSummary = [], readinessFilter = "Todos", onReadinessFilter, confidenceFilter = "Todos", confidenceOptions = ["Todos"], confidenceCounts, onConfidenceFilter, dataHealthSummary = null, dataHealthFilter = "Todos", onDataHealthFilter, scoreAuditSummary = null, scoreAuditFilter = "all", onScoreAuditFilter, onScoreAuditReview, decisionResolutionFilter = "all", decisionResolutionOptions = [{ key: "all", displayLabel: "Resolución: Todas" }], onDecisionResolutionFilter, decisionResolutions = {}, emptyLabel = "Sin resultados todavia. Carga universo y ejecuta el screener." }) {
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
    {hasRows ? <ResultsDisclosureGroup label="Filtros" count={mobileFiltersActive ? `${mobileFiltersActive} activos` : "Sin filtros"} className="compactDisclosure mobileFilterDisclosure">
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
    </ResultsDisclosureGroup> : null}
    {hasRows ? <ResultsDisclosureGroup label="Decisiones" count={totalRows} defaultOpen storageKey="statsedge.disclosureDecisiones.v1" className="resultsDecisionGroup">
      <DecisionQualityStrip audit={decisionQuality} compact activeIssueKey={decisionIssueFilter} onIssueSelect={onDecisionIssueFilter} activeProfileKey={decisionProfileFilter} onProfileSelect={onDecisionProfileFilter} />
      <DecisionOperatingBrief audit={decisionQuality} rows={rows} compact onIssueSelect={onDecisionIssueFilter} onReadinessFilter={onReadinessFilter} onConfidenceFilter={onConfidenceFilter} onReview={onReview} />
      <DecisionSummaryRail summary={readinessSummary} activeKey={readinessFilter} onSelect={onReadinessFilter} className="mobile" />
    </ResultsDisclosureGroup> : null}
    {hasRows ? <ResultsDisclosureGroup label="Auditoría y datos" count={totalRows} storageKey="statsedge.disclosureAuditoria.v1" className="resultsAuditGroup">
      <DecisionEvidenceSummaryRail summary={decisionEvidenceSummary} activeKey={decisionEvidenceFilter} onSelect={onDecisionEvidenceFilter} onReview={onDecisionEvidenceReview} compact />
      <DataHealthSummaryRail summary={dataHealthSummary} activeKey={dataHealthFilter} onSelect={onDataHealthFilter} compact />
      <ScoreAuditSummaryRail summary={scoreAuditSummary} activeKey={scoreAuditFilter} onSelect={onScoreAuditFilter} onReview={onScoreAuditReview} compact />
    </ResultsDisclosureGroup> : null}
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

export function RegimeStrip({ rows = [], marketHealth, presetName, setupName, mode = "leader" }) {
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
