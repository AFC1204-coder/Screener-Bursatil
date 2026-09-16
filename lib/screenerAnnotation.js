// lib/screenerAnnotation.js — composición única de __screenerAnnotation (sin memo/cache).
// FILTER-ANNOTATION-1 (cache LRU por símbolo) está en HOLD/revertido: no reintroducir aquí.
// Este módulo solo evita trabajo duplicado dentro del annotate O(pasan) del gesto.

import { auditDecisionRowIssues, decisionConfidenceSummary, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { decisionProfileForRow } from "@/lib/decisionProfile";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { explainScreenerRank } from "@/lib/screenerExplainability";

/**
 * Construye el bloque de anotación de una fila.
 * Reutiliza explanation/issues/confidence entre campos (profile recibe explanation,
 * no activeSettings — pasar settings recalcularía explain+issues+confidence).
 */
export function buildScreenerAnnotation(row = {}, settings = {}) {
  const explanation = explainScreenerRank(row, settings);
  const issues = auditDecisionRowIssues(row, explanation);
  const confidence = decisionConfidenceSummary(row, explanation, issues);
  return {
    explanation,
    confidence,
    dataHealth: buildScreenerDataHealth(row, settings),
    priority: decisionPriorityBreakdown(row, explanation, issues),
    profile: decisionProfileForRow(row, explanation),
    issues,
  };
}

export function annotateScreenerRow(row = {}, settings = {}) {
  return {
    ...row,
    __screenerAnnotation: buildScreenerAnnotation(row, settings),
  };
}

export function annotateScreenerRows(rows = [], settings = {}) {
  return rows.map((row) => annotateScreenerRow(row, settings));
}
