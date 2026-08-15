import { describe, expect, it } from "vitest";
import { buildReviewPrioritySummary, prepareReviewQueueRows, reviewPriorityForRow } from "@/lib/decisionProfile";

const strongRow = {
  symbol: "HIGH",
  price: 50,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 88,
  technicalCoverageScore: 92,
  fundamentalCoverageScore: 72,
  totalScore: 90,
  rsGlobalPct: 94,
  rsSectorPct: 91,
  rsQualityScore: 88,
  weinsteinScore: 90,
  minerviniScore: 88,
  volumeEffectScore: 82,
  adProxyScore: 80,
  growthScore: 78,
  epsGrowthProxyScore: 76,
  riskRewardScore: 82,
  weaknessScore: 5,
  extSma50: 8,
  setupDisplayPlanValid: true,
};

const fragileRow = {
  ...strongRow,
  symbol: "FRAG",
  totalScore: 78,
  rsGlobalPct: 74,
  rsSectorPct: 71,
  rsQualityScore: 52,
  weinsteinScore: 55,
  minerviniScore: 54,
  volumeEffectScore: 69,
  adProxyScore: 50,
  growthScore: 45,
  epsGrowthProxyScore: 45,
  riskRewardScore: 56,
};

const blockedRow = {
  ...strongRow,
  symbol: "BLOCK",
  decisionProjectionPartial: true,
  decisionProjectionMissing: ["price", "chartBarsCount"],
};

describe("review priority", () => {
  it("clasifica la cola en prioridad alta, validacion y bloqueo auditable", () => {
    expect(reviewPriorityForRow(strongRow, { setupMode: "leader" }).key).toBe("focus-now");
    expect(reviewPriorityForRow(fragileRow, { setupMode: "leader" }).key).toBe("validate-first");
    expect(reviewPriorityForRow(blockedRow, { setupMode: "leader" }).key).toBe("blocked");
  });

  it("la cola respeta el orden de llegada: el sistema no reordena por su prioridad", () => {
    // Antes esta función reordenaba por REVIEW_PRIORITY_RANK y la cola abría
    // por el valor que el sistema priorizaba, no por el que el usuario miraba
    // (principio 1: la ordenación debe ser elegible y su criterio, explícito).
    const queue = prepareReviewQueueRows([blockedRow, fragileRow, strongRow], { setupMode: "leader" });

    expect(queue.map((row) => row.symbol)).toEqual(["BLOCK", "FRAG", "HIGH"]);
  });

  it("resume grupos con primer indice sobre el orden de llegada", () => {
    const rows = prepareReviewQueueRows([blockedRow, fragileRow, strongRow], { setupMode: "leader" });
    const summary = buildReviewPrioritySummary(rows, { setupMode: "leader" });

    // Los grupos del resumen conservan su orden propio (meta), pero
    // firstIndex apunta a la posición REAL en la cola del usuario.
    expect(summary.map((group) => [group.key, group.count, group.firstIndex])).toEqual([
      ["focus-now", 1, 2],
      ["validate-first", 1, 1],
      ["blocked", 1, 0],
    ]);
    expect(summary[0].topSymbol).toBe("HIGH");
    expect(summary[0].topScore).toBeGreaterThan(summary[1].topScore);
  });
});
