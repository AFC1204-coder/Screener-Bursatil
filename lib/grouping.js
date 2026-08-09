import { clamp } from "@/lib/formatters";
import { rowPassesListContract } from "@/lib/listRationale";
import { metricValue, rowRsPrimary, rowRsUniverse, weaknessScore } from "@/lib/stockRows";

export const STRENGTH_FILTERS = [
  ["all", "Todos"],
  ["leaders", "Fuertes"],
  ["constructive", "Constructivos"],
  ["weak", "Débiles"],
  ["veryWeak", "Muy débiles"],
];

export function avg(items = [], field) {
  const values = items.map((row) => metricValue(row, field)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// RS semanal si el símbolo está en el ranking US, si no el percentil del
// lote (rowRsUniverse) — igual criterio que la ordenación del screener
// (lib/screenerPipeline.js): para un promedio de grupo, omitir del todo un
// símbolo sin RS semanal dejaría grupos pequeños con muestra insuficiente;
// caer al valor de lote es preferible a excluirlo del promedio por completo.
function weeklyOrBatchRs(row = {}) {
  return row.weeklyRsAvailable === true ? row.weeklyRsRating : rowRsUniverse(row);
}

export function groupRows(rows = [], dimension) {
  const map = new Map();
  for (const row of rows) {
    const key = row[dimension] || "Sin dato";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  return [...map.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => (metricValue(b, "objectiveScore") || 0) - (metricValue(a, "objectiveScore") || 0));
    const avgTotal = avg(items, "objectiveScore");
    const avgRs = items.map(weeklyOrBatchRs).filter(Number.isFinite);
    const avgRsValue = avgRs.length ? avgRs.reduce((sum, value) => sum + value, 0) / avgRs.length : null;
    const avgPrimaryRs = items.map(rowRsPrimary).filter(Number.isFinite);
    const avgPrimaryRsValue = avgPrimaryRs.length ? avgPrimaryRs.reduce((sum, value) => sum + value, 0) / avgPrimaryRs.length : null;
    const avgWeaknessValues = items.map(weaknessScore).filter(Number.isFinite);
    const avgWeakness = avgWeaknessValues.length ? avgWeaknessValues.reduce((sum, value) => sum + value, 0) / avgWeaknessValues.length : null;
    const avg3m = avg(items, "perf3m");
    const avg6m = avg(items, "perf6m");
    const leaders = items.filter((row) => rowPassesListContract(row, "leaders")).length;
    const pivotWatch = items.filter((row) => rowPassesListContract(row, "nearPivot")).length;
    const extended = items.filter((row) => rowPassesListContract(row, "extended")).length;
    const weak = items.filter((row) => rowPassesListContract(row, "weakness")).length;
    const strength = clamp((avgTotal || 0) * .58 + (avgPrimaryRsValue || avgRsValue || 50) * .28 + clamp(avg3m || 0, -20, 40) * .35 + leaders * 4);

    return {
      key,
      items: sorted,
      count: items.length,
      avgTotal,
      avgRs: avgRsValue,
      avgWeakness,
      avg3m,
      avg6m,
      leaders,
      nearPivot: pivotWatch,
      pivotWatch,
      extended,
      weak,
      strength,
      top: sorted.slice(0, 5),
    };
  }).sort((a, b) => b.strength - a.strength);
}

export function filterGroupsByStrength(groups = [], filter = "all") {
  const filtered = groups.filter((group) => {
    if (filter === "leaders") return group.strength >= 70;
    if (filter === "constructive") return group.strength >= 55 && group.strength < 70;
    if (filter === "weak") return group.strength < 55;
    if (filter === "veryWeak") return group.strength < 40;
    return true;
  });
  if (filter === "weak" || filter === "veryWeak") return [...filtered].sort((a, b) => a.strength - b.strength);
  return filtered;
}
