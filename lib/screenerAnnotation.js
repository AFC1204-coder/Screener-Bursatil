// lib/screenerAnnotation.js — composición única de __screenerAnnotation (sin memo/cache).
// FILTER-ANNOTATION-1 (cache LRU por símbolo) está en HOLD/revertido: no reintroducir aquí.
// Este módulo evita trabajo duplicado dentro del annotate O(pasan) del gesto.
// FILTER-ANNOTATE-MEMO-1: memo por IDENTIDAD de objeto fila (WeakMap), no por símbolo:
// sin invalidación manual (fila nueva = objeto nuevo = miss), sin LRU ni límites,
// el GC libera entradas con el dataset. Ver annotateScreenerRowsMemo.

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

// ── Memo por identidad de fila ───────────────────────────────────────────
// buildScreenerAnnotation solo depende de (contenido de la fila, setupMode) — ver el
// CONTRATO en useResultViewModel. Las filas del dataset son inmutables y filterAnalyzedRows
// devuelve los MISMOS objetos entre gestos (solo cambia qué subconjunto pasa), así que
// la fila anotada se reutiliza tal cual: 0 coste de annotate en filas ya vistas y,
// además, identidad estable para los memos/React.memo aguas abajo.
// Una entrada por modo (setupMode alterna en toggles; evita thrash).
const ANNOTATED_BY_ROW = new WeakMap();

function annotationModeKey(settings) {
  // explainScreenerRank lee settings.values||settings; dataHealth lee settings.setupMode.
  const a = settings?.setupMode;
  const b = settings?.values?.setupMode;
  return `${a == null ? "" : String(a)}|${b == null ? "" : String(b)}`;
}

export function annotateScreenerRowMemo(row, settings = {}) {
  if (row === null || typeof row !== "object") return annotateScreenerRow(row, settings);
  const modeKey = annotationModeKey(settings);
  let perMode = ANNOTATED_BY_ROW.get(row);
  if (!perMode) {
    perMode = new Map();
    ANNOTATED_BY_ROW.set(row, perMode);
  }
  let annotated = perMode.get(modeKey);
  if (!annotated) {
    annotated = annotateScreenerRow(row, settings);
    perMode.set(modeKey, annotated);
  }
  return annotated;
}

export function annotateScreenerRowsMemo(rows = [], settings = {}) {
  return rows.map((row) => annotateScreenerRowMemo(row, settings));
}
