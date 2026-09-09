import { describe, expect, it } from "vitest";
import { weinsteinTape } from "@/app/api/market-health/route";

describe("weinsteinTape · Dist/Acc", () => {
  const indexes = [
    { symbol: "SPY", weight: 30, distributionDays20: 4, accumulationDays20: 2, priceAboveSlowMa: true, stageState: "stage2" },
    { symbol: "QQQ", weight: 30, distributionDays20: 2, accumulationDays20: 3, priceAboveSlowMa: true, stageState: "stage2" },
    { symbol: "IWM", weight: 20, distributionDays20: 6, accumulationDays20: 1, priceAboveSlowMa: false, stageState: "stage4" },
    { symbol: "DIA", weight: 10, distributionDays20: 3, accumulationDays20: 2, priceAboveSlowMa: true, stageState: "stage2" },
    { symbol: "ACWI", weight: 10, distributionDays20: 1, accumulationDays20: 4, priceAboveSlowMa: true, stageState: "stage2" },
  ];

  const sectors = [
    { symbol: "XLK", distributionDays20: 5, accumulationDays20: 1, priceAboveSlowMa: true, stageState: "stage2", group: "Crecimiento", weinsteinScore: 80, score: 70, rs1m: 1, rs3m: 1 },
    { symbol: "XLV", distributionDays20: 7, accumulationDays20: 0, priceAboveSlowMa: false, stageState: "stage4", group: "Defensivo", weinsteinScore: 20, score: 30, rs1m: -1, rs3m: -1 },
  ];

  it("expone Dist/Acc hero como media ponderada de índices, no de sectores", () => {
    const tape = weinsteinTape(indexes, sectors);

    // (4*30 + 2*30 + 6*20 + 3*10 + 1*10) / 100 = 3.4
    expect(tape.distributionDays20Avg).toBe(3.4);
    // (2*30 + 3*30 + 1*20 + 2*10 + 4*10) / 100 = 2.3
    expect(tape.accumulationDays20Avg).toBe(2.3);

    expect(tape.sectorDistributionDays20Avg).toBe(6);
    expect(tape.sectorAccumulationDays20Avg).toBe(0.5);
    expect(tape.distributionDays20Avg).not.toBe(tape.sectorDistributionDays20Avg);
  });

  it("usa presión sectorial para divergencias y etiqueta de confirmación", () => {
    const tape = weinsteinTape(indexes, sectors);

    expect(tape.divergences).toContain("Presión de distribución supera acumulación en sectores.");
    expect(tape.label).not.toBe("Confirmación interna positiva");
  });
});
