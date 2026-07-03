import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DecisionGroups from "@/app/components/screener/DecisionGroups";
import { DecisionOperatingBrief } from "@/lib/screenerDomains/decision";

// Test permanente del presupuesto de énfasis: cuenta elementos con
// data-emphasis="E1" en el DecisionGroups renderizado.
// Debe haber exactamente 1 (la lectura operativa). Si hay 0 o >1, falla.
// Esto previene que múltiples componentes compitan por atención E1 simultáneamente.

const baseProps = {
  audit: { rows: 3, decisions: {}, decisionQuality: {} },
  filteredCount: 3,
  filteredRows: [{ symbol: "ALPHA", companyName: "Alpha", objectiveScore: 80, totalScore: 82 }],
  onReviewAll: () => {},
  decisionIssueFilter: "Todos",
  onDecisionIssueFilter: () => {},
  decisionProfileFilter: "Todos",
  onDecisionProfileFilter: () => {},
  onReadinessFilter: () => {},
  onConfidenceFilter: () => {},
  pendingDecisionWorkSummary: null,
  pendingDecisionWorkActive: false,
  onPendingDecisionWorkFocus: () => {},
  onPendingDecisionWorkClear: () => {},
  onPendingDecisionWorkReview: () => {},
  decisionEvidenceSummary: null,
  decisionEvidenceFilter: "all",
  onDecisionEvidenceFilter: () => {},
  onReviewDecisionEvidenceQueue: () => {},
  dataHealthSummary: null,
  dataHealthFilter: "Todos",
  onDataHealthFilter: () => {},
  scoreAuditSummary: null,
  scoreAuditFilter: "all",
  onScoreAuditFilter: () => {},
  onReviewScoreAuditQueue: () => {},
  auditabilitySummary: null,
  onReviewMethodologyFocusQueue: () => {},
};

describe("emphasis budget", () => {
  it("tiene exactamente 1 elemento data-emphasis='E1' en DecisionGroups (la lectura operativa)", () => {
    const html = renderToStaticMarkup(createElement(DecisionGroups, baseProps));
    const e1Count = (html.match(/data-emphasis="E1"/g) || []).length;
    expect(e1Count).toBe(1);
  });

  it("DecisionOperatingBrief fuera de DecisionGroups (sin emphasis='E1') es E2 por defecto", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionOperatingBrief, {
        audit: { rows: 3, decisions: {}, decisionQuality: {} },
        rows: [{ symbol: "ALPHA", objectiveScore: 80, totalScore: 82 }],
      })
    );
    expect(html).toContain('data-emphasis="E2"');
    expect(html).not.toContain('data-emphasis="E1"');
  });
});
