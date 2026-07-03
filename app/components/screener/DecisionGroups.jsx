"use client";

// DecisionGroups — slice presentacional de ScreenerShell.
// Contiene los dos <details> de escritorio "Decisiones" y "Auditoría y datos".
// Recibe SOLO los slices que consume este bloque (no el prop-bag completo).
// Los callbacks openReview*Queue viven en useResultViewModel; aquí se inyectan.

import {
  DecisionOperatingBrief,
  DecisionQualityStrip,
  PendingDecisionWorkRail,
} from "@/lib/screenerDomains/decision";
import {
  AuditabilitySummaryRail,
  DecisionEvidenceSummaryRail,
  ScoreAuditSummaryRail,
} from "@/lib/screenerDomains/audit";
import { DataHealthSummaryRail } from "@/lib/screenerDomains/dataHealth";

export default function DecisionGroups({
  audit,
  filteredCount,
  filteredRows,
  onReviewAll,
  // DecisionQualityStrip / DecisionOperatingBrief
  decisionIssueFilter,
  onDecisionIssueFilter,
  decisionProfileFilter,
  onDecisionProfileFilter,
  onReadinessFilter,
  onConfidenceFilter,
  // PendingDecisionWorkRail
  pendingDecisionWorkSummary,
  pendingDecisionWorkActive,
  onPendingDecisionWorkFocus,
  onPendingDecisionWorkClear,
  onPendingDecisionWorkReview,
  // Auditoría y datos
  decisionEvidenceSummary,
  decisionEvidenceFilter,
  onDecisionEvidenceFilter,
  onReviewDecisionEvidenceQueue,
  dataHealthSummary,
  dataHealthFilter,
  onDataHealthFilter,
  scoreAuditSummary,
  scoreAuditFilter,
  onScoreAuditFilter,
  onReviewScoreAuditQueue,
  auditabilitySummary,
  onReviewMethodologyFocusQueue,
}) {
  return (
    <>
      {/* Grupo "Decisiones": abierto por defecto. La lectura operativa (Brief)
          domina primero; los contadores (Strip) quedan subordinados debajo. */}
      <details className="disclosurePanel resultsDecisionGroup" open>
        <summary><span>Decisiones</span><em>{filteredCount}</em></summary>
        <DecisionOperatingBrief audit={audit} rows={filteredRows} onIssueSelect={onDecisionIssueFilter} onReadinessFilter={onReadinessFilter} onConfidenceFilter={onConfidenceFilter} onReview={onReviewAll} />
        <DecisionQualityStrip audit={audit} activeIssueKey={decisionIssueFilter} onIssueSelect={onDecisionIssueFilter} activeProfileKey={decisionProfileFilter} onProfileSelect={onDecisionProfileFilter} />
        <PendingDecisionWorkRail
          summary={pendingDecisionWorkSummary}
          active={pendingDecisionWorkActive}
          onFocus={onPendingDecisionWorkFocus}
          onClear={onPendingDecisionWorkClear}
          onReview={onPendingDecisionWorkReview}
        />
      </details>

      {/* Grupo "Auditoría y datos": cerrado por defecto. Rails de calidad/pruebas/salud.
          Sus filtros se activan desde aquí; los <select> duplicados se eliminaron. */}
      <details className="disclosurePanel resultsAuditGroup">
        <summary><span>Auditoría y datos</span><em>{filteredCount}</em></summary>
        <DecisionEvidenceSummaryRail summary={decisionEvidenceSummary} activeKey={decisionEvidenceFilter} onSelect={onDecisionEvidenceFilter} onReview={onReviewDecisionEvidenceQueue} />
        <DataHealthSummaryRail summary={dataHealthSummary} activeKey={dataHealthFilter} onSelect={onDataHealthFilter} />
        <ScoreAuditSummaryRail summary={scoreAuditSummary} activeKey={scoreAuditFilter} onSelect={onScoreAuditFilter} onReview={onReviewScoreAuditQueue} />
        <AuditabilitySummaryRail summary={auditabilitySummary} onReviewFocus={onReviewMethodologyFocusQueue} />
      </details>
    </>
  );
}
