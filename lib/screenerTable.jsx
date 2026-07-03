// lib/screenerTable.jsx — tabla de resultados compacta y barra de resultados pendientes.
// Feature module: presentación de la tabla de resultados del screener.

import Link from "next/link";
import { InfoHint } from "@/app/components/ui/InfoHint";
import { pct } from "@/lib/formatters";
import { auditDecisionRowIssues, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { rsUniverseValue } from "@/lib/relativeStrength";
import { buildScreenerFilterExplainPlan } from "@/lib/screenerFilters";
import { buildDecisionEvidenceChecklist, explainScreenerRank } from "@/lib/screenerExplainability";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit } from "@/lib/screenerScoreAudit";
import { buildRowReviewFocus, decisionConfidenceForRow, decisionResolutionForRow } from "@/lib/screenerResultView";
import { CompanyMark, CompactMetric } from "@/lib/screenerAtoms";
import { compactMetricSourceLookup, compactTone, objectiveMetricCompactState } from "@/lib/screenerFormat";
import { countryCode, countryName, marketFlag, stockUrl } from "@/lib/symbols";
import { vcpReliabilityAudit } from "@/lib/vcpDiagnostics";

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

export function CompactResultsTable({ rows = [], settings, favoriteSymbols, onFavorite, onReview, onOpenStock, rankOffset = 0, emptyLabel = "Ejecuta un scan para ver resultados", decisionResolutions = {} }) {
  // Tabla compacta (densidad nivel compact). El trust rail colapsa a una badge
  // status agregada que abre QuickReview; el detalle deja de vivir en la fila.
  // Sparkline y bloque setup viven en hover/preview (QuickReview), no en la fila.
  const headers = ["★", "#", "Compañía", "RS", "Mom.", "Volumen", "Objetivo"];
  const isZero = (n) => !Number.isFinite(n) || n === 0;
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
          const vcpReliability = vcpReliabilityAudit(r);
          const issueTone = rowIssues.some((issue) => issue.severity === "bad") ? "bad" : rowIssues.length ? "warn" : "";
          const resolution = decisionResolutionForRow(r, decisionResolutions);
          const reviewFocus = buildRowReviewFocus({ dataHealth, metricTruth, scoreAudit, vcpReliability, evidence, rowIssues });
          // Tono agregado: el más severo entre los 5 ejes de veredicto (bad > warn > neutral).
          // Un único punto de color por fila => jerarquía clara.
          const verdictTones = [
            rankExplain.action.tone,
            rankExplain.readiness.tone,
            confidence.tone,
            resolution?.tone || "",
            priority.tone || "",
          ];
          const aggregateTone = verdictTones.includes("bad") ? "bad"
            : verdictTones.includes("warn") ? "warn"
            : "neutral";
          // Conteo de señales y veredictos para el indicador "+N" de la badge agregada.
          const warnBadVerdicts = verdictTones.filter((t) => t === "warn" || t === "bad").length;
          const signalCount = warnBadVerdicts
            + (rowIssues?.length || 0)
            + (scoreAudit?.missing?.length || 0)
            + (dataHealth?.issues?.length || 0)
            + (evidence?.pending?.length || 0)
            + (reviewFocus ? 1 : 0);
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
              <span className="compactIdentityText" title={r.companyName || r.symbol}>
                <span className="compactIdentityTop">
                  <Link className="ticker" href={stockUrl(r.symbol)} onPointerDown={() => onOpenStock?.(r)} onClick={() => onOpenStock?.(r)}>{r.symbol}</Link>
                  <CompactCountryFlag country={country} />
                </span>
              </span>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="G" value={Number.isFinite(rsValue) ? rsValue.toFixed(0) : "-"} tone={compactTone(rsValue, 75, 45)} source={metricSource("rsGlobalPct")} zero={isZero(rsValue)} />
                <CompactMetric label="Grp" value={Number.isFinite(r.rsSectorPct) ? r.rsSectorPct.toFixed(0) : "-"} source={metricSource("rsSectorPct")} zero={isZero(r.rsSectorPct)} />
                <CompactMetric label="Q" value={Number.isFinite(r.rsQualityScore) ? r.rsQualityScore.toFixed(0) : "-"} tone={compactTone(r.rsQualityScore, 70, 40)} source={metricSource("rsQualityScore")} zero={isZero(r.rsQualityScore)} />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="3M" value={pct(r.perf3m)} tone={compactTone(r.perf3m, 20, 0)} source={metricSource("perf3m")} zero={isZero(r.perf3m)} metricType="price" />
                <CompactMetric label="6M" value={pct(r.perf6m)} tone={compactTone(r.perf6m, 35, 0)} source={metricSource("perf6m")} zero={isZero(r.perf6m)} metricType="price" />
                <CompactMetric label="52w" value={pct(r.distance52w)} tone={compactTone(r.distance52w, -10, -35)} source={metricSource("distance52w")} zero={isZero(r.distance52w)} metricType="price" />
              </div>
            </td>
            <td>
              <div className="compactMetricGrid">
                <CompactMetric label="RV" value={Number.isFinite(r.relativeVolume) ? `${r.relativeVolume.toFixed(2)}x` : "-"} tone={compactTone(r.relativeVolume, 1.5)} source={metricSource("relativeVolume")} zero={isZero(r.relativeVolume)} />
                <CompactMetric label="A/D" value={Number.isFinite(r.adProxyScore) ? r.adProxyScore.toFixed(0) : "-"} tone={compactTone(r.adProxyScore, 70, 40)} source={metricSource("adProxyScore")} zero={isZero(r.adProxyScore)} />
                <CompactMetric label="Ef." value={Number.isFinite(r.volumeEffectScore) ? r.volumeEffectScore.toFixed(0) : "-"} zero={isZero(r.volumeEffectScore)} />
              </div>
            </td>
            <td className="compactScoreCell">
              <span className="compactScoreHead">
                <b>{Number.isFinite(r.objectiveScore) ? r.objectiveScore.toFixed(0) : Number.isFinite(r.totalScore) ? r.totalScore.toFixed(0) : "-"}</b>
                <button
                  type="button"
                  className={`rowTrustBadge ${aggregateTone}`}
                  onClick={(e) => { e.stopPropagation(); onOpen(); }}
                  title="Abrir revisión con el detalle de decisión y confianza"
                  aria-label={`Abrir revisión de ${r.symbol}`}
                >
                  {rankExplain.action.label} · {confidence.label}
                  {signalCount > 0 ? <em>+{signalCount}</em> : null}
                </button>
                <InfoHint text={[rankExplain.readiness.detail, rankExplain.text, filterPlan.text].filter(Boolean).join(" · ")} tone={rankExplain.tone === "bad" ? "warn" : filterPlan.tone} />
              </span>
            </td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={headers.length} className="emptyResultsCell">{emptyLabel}</td></tr>}
      </tbody>
    </table>
  </div>;
}
