/**
 * FILTER-CPU-1 — fases post-filter del useResultViewModel (sin React).
 */
import { auditDecisionScan } from "@/lib/decisionAudit";
import { annotateScreenerRows, clearScreenerAnnotationCache } from "@/lib/screenerAnnotationCache";
import { buildScreenerDataHealthSummary } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAuditSummary } from "@/lib/screenerScoreAudit";
import { compareRowsForSort, perfNow } from "@/lib/screenerPipeline";

function markPhase(phases, name, t0) {
  const ms = perfNow() - t0;
  phases[name] = (phases[name] || 0) + ms;
  return perfNow();
}

export function phasedViewModelWork(rows = [], activeSettings = {}, options = {}) {
  const phases = {};
  const {
    sort = "perf3m",
    sortAsc = false,
    includeSummaries = true,
  } = options;

  if (options.resetAnnotationCache) clearScreenerAnnotationCache();
  let t0 = perfNow();
  const annotated = annotateScreenerRows(rows, activeSettings);
  t0 = markPhase(phases, "annotateRows", t0);

  // Sin filtros de vista activos (Todos/all): applyResultViewFilters es no-op O(N) barato.
  const viewFiltered = annotated;
  t0 = markPhase(phases, "applyViewFilters", t0);

  const sorted = [...viewFiltered].sort((a, b) => compareRowsForSort(a, b, {
    sort,
    sortAsc,
    settings: activeSettings,
  }));
  t0 = markPhase(phases, "clientSort", t0);

  const arrayCopyMs = perfNow();
  const _copyCheck = [...viewFiltered];
  phases.arrayCopy = perfNow() - arrayCopyMs;
  t0 = markPhase(phases, "arrayCopyProbe", t0);

  if (includeSummaries) {
    auditDecisionScan({ id: "probe", name: "probe", rows: viewFiltered, activeSettings });
    t0 = markPhase(phases, "decisionAuditScan", t0);

    buildScreenerDataHealthSummary(viewFiltered, activeSettings);
    t0 = markPhase(phases, "dataHealthSummary", t0);

    buildScreenerScoreAuditSummary(viewFiltered);
    markPhase(phases, "scoreAuditSummary", t0);
  }

  const totalMs = Object.values(phases).reduce((s, v) => s + v, 0);
  return { phases, totalMs, rowCount: rows.length, outputCount: sorted.length };
}
