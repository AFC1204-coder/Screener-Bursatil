import { describe, expect, it } from "vitest";
import { defaultSortForSettings, sortMetric, sortRowsForMode } from "@/lib/screenerPipeline";

const cleanCandidate = {
  symbol: "CLEAN",
  price: 50,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
  totalScore: 82,
  rsGlobalPct: 90,
  rsSectorPct: 82,
  rsQualityScore: 78,
  weinsteinScore: 86,
  minerviniScore: 82,
  volumeEffectScore: 76,
  adProxyScore: 74,
  growthScore: 70,
  epsGrowthProxyScore: 68,
  riskRewardScore: 72,
  weaknessScore: 12,
  extSma50: 10,
  setupDisplayPlanValid: true,
};

describe("screener pipeline sorting", () => {
  it("ordena por calidad de decision usando el contexto activo", () => {
    const riskyHigherScore = {
      ...cleanCandidate,
      symbol: "RISKY",
      totalScore: 96,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    };

    const leaderScore = sortMetric(cleanCandidate, "decisionPriority", { setupMode: "leader" });
    const weaknessScore = sortMetric(cleanCandidate, "decisionPriority", { setupMode: "weakness" });
    const sorted = sortRowsForMode([riskyHigherScore, cleanCandidate], { setupMode: "leader" }, "decisionPriority");

    expect(leaderScore).toBeGreaterThan(weaknessScore);
    expect(sorted.map((row) => row.symbol)).toEqual(["CLEAN", "RISKY"]);
  });

  it("usa calidad objetiva como ranking por defecto en modos largos", () => {
    const riskyHigherScore = {
      ...cleanCandidate,
      symbol: "RISKY",
      totalScore: 96,
      rsGlobalPct: 55,
      extSma50: 24,
      riskRewardScore: 42,
    };

    expect(defaultSortForSettings({ setupMode: "leader" })).toBe("objectiveScore");
    expect(defaultSortForSettings({ setupMode: "weakness" })).toBe("weaknessScore");
    expect(sortRowsForMode([
      { ...riskyHigherScore, objectiveScore: 70 },
      { ...cleanCandidate, objectiveScore: 82 },
    ], { setupMode: "leader" }).map((row) => row.symbol)).toEqual(["CLEAN", "RISKY"]);
  });

  it("no deja que un VCP suba el ranking objetivo principal", () => {
    const objectiveLeader = {
      ...cleanCandidate,
      symbol: "OBJ",
      objectiveScore: 81,
      totalScore: 81,
      patternScore: 0,
      setupDisplayPlanValid: false,
    };
    const vcpBoosted = {
      ...cleanCandidate,
      symbol: "VCP",
      objectiveScore: 67,
      totalScore: 92,
      patternScore: 95,
      setupDisplayPlanValid: true,
    };

    expect(sortMetric(vcpBoosted, "objectiveScore", { setupMode: "leader" })).toBe(67);
    expect(sortMetric(vcpBoosted, "totalScore", { setupMode: "leader" })).toBe(92);
    expect(sortRowsForMode([vcpBoosted, objectiveLeader], { setupMode: "leader" }).map((row) => row.symbol)).toEqual(["OBJ", "VCP"]);
  });
});
