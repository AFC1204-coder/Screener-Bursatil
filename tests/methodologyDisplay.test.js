import { describe, expect, it } from "vitest";
import {
  chartPatternBadgeForRow,
  methodologyDisplayForRow,
  shouldShowChartPatternBadge,
} from "@/lib/methodologyDisplay";

const vcpPattern = {
  patternDataStatus: "partial_volume",
  patternEligible: true,
  consolidationCandidate: true,
  baseDepthPct: 18,
  contractionDepths: [20, 10],
  contractionCount: 2,
  contractionsDecreasing: true,
  contractionStructureStatus: "ok",
  volumeDryUpRatio: 1.05,
  distanceToPivotPct: 5,
  patternQualityScore: 60,
  pivotPrice: 132,
};

describe("shouldShowChartPatternBadge", () => {
  it("oculta el vacío por defecto (Sin validar · Estructura sin dato)", () => {
    const display = methodologyDisplayForRow({});
    expect(display.shortLabel).toBe("Sin validar");
    expect(display.evidence).toBe("Estructura sin dato");
    expect(shouldShowChartPatternBadge(display)).toBe(false);
    expect(chartPatternBadgeForRow(null)).toBeNull();
  });

  it("muestra veredicto con estructura real (compresiones)", () => {
    const display = methodologyDisplayForRow(vcpPattern);
    expect(shouldShowChartPatternBadge(display)).toBe(true);
    expect(chartPatternBadgeForRow(vcpPattern)).not.toBeNull();
    expect(chartPatternBadgeForRow(vcpPattern).evidence).toMatch(/%/);
  });

  it("muestra datos parciales con motivo útil", () => {
    const display = methodologyDisplayForRow({
      methodologyReliabilityState: "data_limited",
      methodologyReliabilityLabel: "Datos parciales",
      methodologyReliabilityReason: "Volumen incompleto en la última sesión",
    });
    expect(shouldShowChartPatternBadge(display)).toBe(true);
  });

  it("muestra rechazo con evidencia (No VCP)", () => {
    const display = methodologyDisplayForRow({
      patternDataStatus: "ok",
      patternEligible: true,
      contractionDepths: [22, 18, 14],
      contractionCount: 3,
      contractionsDecreasing: false,
      patternQualityScore: 40,
      consolidationCandidate: true,
      volumeDryUpRatio: 1.2,
      distanceToPivotPct: 8,
    });
    expect(shouldShowChartPatternBadge(display)).toBe(true);
  });
});
