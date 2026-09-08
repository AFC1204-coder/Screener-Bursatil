import { pct, ratio } from "@/lib/formatters";
import { objectiveStage } from "@/lib/scoring";
import { STAGE_MISSING_REASON, stageDisplayForRow, stageSummaryText } from "@/lib/stageDisplay";

function value(row = {}, key) {
  return row[key] ?? row.snapshot?.[key] ?? null;
}

/** Filas de «Evidencia medible» en /review: etapa Weinstein + lectura diaria aparte. */
export function evidenceRows(row = {}) {
  const stageDisplay = stageDisplayForRow(row);
  const stageText = stageSummaryText(row) ?? "-";
  const stageTitle = stageDisplay?.title || STAGE_MISSING_REASON;
  return [
    ["Etapa", stageText, stageTitle],
    ["Estructura diaria", objectiveStage(row)],
    ["Distancia 20d high", pct(value(row, "distance20d"))],
    ["Distancia 52w high", pct(value(row, "distance52w"))],
    ["Extension SMA50", pct(value(row, "extSma50"))],
    ["Highs spread", pct(value(row, "highsSpreadPct"))],
    ["Volumen relativo", ratio(value(row, "relativeVolume"))],
    ["Benchmark", value(row, "benchmarkSymbol") || "-"],
  ];
}
