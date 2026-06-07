import { clamp } from "@/lib/formatters";
import { methodologyPivotWatchEligible } from "@/lib/methodologyDisplay";
import { metricValue, rowComposite, rowRsPrimary, rowRsUniverse, weaknessScore } from "@/lib/stockRows";

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

export function groupRows(rows = [], dimension) {
  const map = new Map();
  for (const row of rows) {
    const key = row[dimension] || "Sin dato";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  return [...map.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => rowComposite(b) - rowComposite(a));
    const avgTotal = avg(items, "totalScore");
    const avgRs = items.map(rowRsUniverse).filter(Number.isFinite);
    const avgRsValue = avgRs.length ? avgRs.reduce((sum, value) => sum + value, 0) / avgRs.length : null;
    const avgPrimaryRs = items.map(rowRsPrimary).filter(Number.isFinite);
    const avgPrimaryRsValue = avgPrimaryRs.length ? avgPrimaryRs.reduce((sum, value) => sum + value, 0) / avgPrimaryRs.length : null;
    const avgWeaknessValues = items.map(weaknessScore).filter(Number.isFinite);
    const avgWeakness = avgWeaknessValues.length ? avgWeaknessValues.reduce((sum, value) => sum + value, 0) / avgWeaknessValues.length : null;
    const avg3m = avg(items, "perf3m");
    const avg6m = avg(items, "perf6m");
    const leaders = items.filter((row) => rowComposite(row) >= 70 || (rowRsPrimary(row) || 0) >= 75).length;
    const pivotWatch = items.filter(methodologyPivotWatchEligible).length;
    const extended = items.filter((row) => (metricValue(row, "extSma50") ?? 0) >= 15 && rowComposite(row) >= 70).length;
    const weak = items.filter((row) => weaknessScore(row) >= 60).length;
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
