/**
 * FILTER-CPU-1 — descomposición por fase de filterAnalyzedRows (investigate only).
 * Replica la estructura de lib/screenerPipeline.js::filterAnalyzedRows con marcas.
 */
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { populationNeedsRescore, canUseScreenPassedFastPath } from "@/lib/screenerFilterFastPath";
import { regimeRejectReason } from "@/lib/scoring";
import { screenerFilterRejectReason } from "@/lib/screenerFilters";
import {
  perfNow,
  sectorize,
  splitByFilter,
  postFilterRejectReason,
  scanDiagnosticsSummary,
  sortRowsForMode,
  filterAnalyzedRows,
} from "@/lib/screenerPipeline";

function splitByPrecomputedScreen(rows = []) {
  const passed = [];
  const rejections = [];
  for (const row of rows) {
    if (row.screenPassed === true) passed.push(row);
    else {
      const field = row.screenRejectField || "";
      rejections.push({
        symbol: row.symbol,
        key: field || "filter",
        label: field || "filter",
        detail: row.screenRejectReason || "No cumple filtro",
        field,
      });
    }
  }
  return { passed, rejections };
}

function markPhase(phases, name, t0) {
  const ms = perfNow() - t0;
  phases[name] = (phases[name] || 0) + ms;
  phases[`${name}__calls`] = (phases[`${name}__calls`] || 0) + 1;
  return perfNow();
}

export function phasedFilterAnalyzedRows(analyzedRows = [], set = {}, context = {}) {
  const phases = {};
  let t0 = perfNow();

  const qualityPassed = [];
  const qualityGateRejections = [];
  for (const row of analyzedRows) {
    const gate = qualityGateForResearchRow(row, set);
    if (!gate.passed) {
      qualityGateRejections.push({
        symbol: row.symbol,
        key: "qualityGate",
        label: "Quality Gate",
        stage: "Pre-scan",
        detail: gate.reasons.join(" · "),
        field: "qualityGate",
      });
    } else {
      qualityPassed.push(row);
    }
  }
  t0 = markPhase(phases, "qualityGate", t0);

  const rescored = populationNeedsRescore(qualityPassed);
  t0 = markPhase(phases, "rescoreCheck", t0);

  const sectorized = rescored ? sectorize(qualityPassed) : qualityPassed;
  t0 = markPhase(phases, "sectorize", t0);

  const usedFastPath = canUseScreenPassedFastPath(sectorized, set, context);
  t0 = markPhase(phases, "fastPathDecision", t0);

  const hardFilterSplit = usedFastPath
    ? splitByPrecomputedScreen(sectorized)
    : splitByFilter(sectorized, set);
  t0 = markPhase(phases, usedFastPath ? "splitPrecomputed" : "splitByFilterRules", t0);

  const ok = hardFilterSplit.passed;
  const regimeRejections = [];
  const afterRegime = [];
  for (const row of ok) {
    const reason = regimeRejectReason(row, context.marketHealth, context.useRegimeFilter, set);
    if (reason) regimeRejections.push({ symbol: row.symbol, ...reason });
    else afterRegime.push(row);
  }
  t0 = markPhase(phases, "regimeFilter", t0);

  const postRejections = [];
  const postPassed = [];
  for (const row of afterRegime) {
    const reason = postFilterRejectReason(row, set);
    if (reason) postRejections.push({ symbol: row.symbol, ...reason });
    else postPassed.push(row);
  }
  t0 = markPhase(phases, "postFilter", t0);

  const finalRows = sortRowsForMode(postPassed, set);
  t0 = markPhase(phases, "sort", t0);

  const diagnostics = scanDiagnosticsSummary({
    symbols: context.symbolsCount ?? context.symbols ?? analyzedRows.length,
    base: context.baseCount ?? context.base ?? analyzedRows.length,
    filterRejections: [...qualityGateRejections, ...hardFilterSplit.rejections],
    providerErrors: context.providerErrors || [],
    regimeRejections,
    postRejections,
    passedBeforeContext: ok.length,
    finalRows,
  });
  markPhase(phases, "diagnostics", t0);

  const totalMs = Object.entries(phases)
    .filter(([k]) => !k.endsWith("__calls"))
    .reduce((s, [, v]) => s + v, 0);

  return {
    rows: finalRows,
    sectorized,
    filterMs: totalMs,
    path: usedFastPath ? "screen-passed" : "rules",
    rescored,
    usedFastPath,
    passCount: finalRows.length,
    phases,
    diagnostics,
  };
}

/** Valida que phased ≈ filterAnalyzedRows oficial (mismo resultado). */
export function validatePhasedAgainstCanon(rows, settings, context) {
  const canon = filterAnalyzedRows(rows, settings, context);
  const phased = phasedFilterAnalyzedRows(rows, settings, context);
  const match = canon.rows.length === phased.rows.length
    && canon.path === phased.path
    && Math.abs(canon.filterMs - phased.filterMs) < canon.filterMs * 0.15 + 5;
  return { canon, phased, match };
}

export function countRuleEvaluations(rows, settings) {
  let evals = 0;
  for (const row of rows) {
    screenerFilterRejectReason(row, settings);
    evals += 1;
  }
  return evals;
}
