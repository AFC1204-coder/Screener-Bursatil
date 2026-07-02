// lib/screenerTable.jsx — tabla de resultados compacta y barra de resultados pendientes.
// Feature module: presentación de la tabla de resultados del screener.

import Link from "next/link";
import RowTrustSignature from "@/app/RowTrustSignature";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { pct } from "@/lib/formatters";
import { auditDecisionRowIssues, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { rsUniverseValue } from "@/lib/relativeStrength";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";
import { buildScreenerFilterExplainPlan } from "@/lib/screenerFilters";
import { buildDecisionEvidenceChecklist, explainScreenerRank } from "@/lib/screenerExplainability";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit } from "@/lib/screenerScoreAudit";
import { buildRowReviewFocus, decisionConfidenceForRow, decisionResolutionForRow } from "@/lib/screenerResultView";
import {
  CompanyMark,
  CompactMetric,
  DecisionIssueBadge,
  MiniSparkline,
  ObjectiveMetricTruthPill,
  ReviewFocusPill,
  VcpReliabilityPill,
} from "@/lib/screenerAtoms";
import { DecisionConfidenceBadge, DecisionPriorityBadge, DecisionResolutionBadge } from "@/lib/screenerDomains/decision";
import { DataHealthPanel } from "@/lib/screenerDomains/dataHealth";
import { DecisionEvidenceChecklist, ScoreAuditPanel } from "@/lib/screenerDomains/audit";
import {
  compactMetricSourceLookup,
  compactPatternDetail,
  compactPatternReason,
  compactTone,
  money,
  objectiveMetricCompactState,
  quickSetup,
} from "@/lib/screenerFormat";
import { countryCode, countryName, marketFlag, stockUrl } from "@/lib/symbols";
import { vcpObjectiveSummary, vcpReliabilityAudit } from "@/lib/vcpDiagnostics";

export function CompactCountryFlag({ country }) {
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

export function PendingResultsBar({ pending, visibleCount = 0, filteredCount = 0, onCommit }) {
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

export function CompactResultsTable({ rows = [], settings, favoriteSymbols, onFavorite, onReview, onOpenStock, rankOffset = 0, emptyLabel = "Ejecuta un scan para ver resultados", decisionIssueFilter = "Todos", onDecisionIssueFilter, decisionEvidenceFilter = "all", onDecisionEvidenceFilter, dataHealthFilter = "Todos", onDataHealthFilter, scoreAuditFilter = "all", onScoreAuditFilter, decisionResolutions = {} }) {
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
