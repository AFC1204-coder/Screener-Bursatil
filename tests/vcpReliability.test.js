import { describe, expect, it } from "vitest";
import { vcpDiagnosticSnapshot, vcpReliabilityAudit } from "@/lib/vcpDiagnostics";

const fullPattern = {
  patternEligible: true,
  patternDataStatus: "ok",
  patternBarsCount: 260,
  patternMinBars: 90,
  patternCoveragePct: 100,
  patternOhlcCoveragePct: 100,
  patternVolumeCoveragePct: 100,
  patternVolumeEligible: true,
  contractionStructureStatus: "ok",
  contractionCount: 3,
  contractionsDecreasing: true,
  contractionSwings: [
    { high: 100, low: 84, depthPct: 16, bars: 8 },
    { high: 99, low: 90, depthPct: 9.0909090909, bars: 7 },
    { high: 98, low: 93, depthPct: 5.1020408163, bars: 6 },
  ],
  contractionDepths: [16, 9.0909090909, 5.1020408163],
  distanceToPivotPct: -2.5,
  volumeDryUpRatio: 0.76,
  baseDepthPct: 24,
};

const planDisplay = {
  key: "actionable_vcp",
  label: "VCP plan valido",
  actionable: true,
  tradePlanEligible: true,
  blocksPatternClaim: false,
};

describe("vcpReliabilityAudit", () => {
  it("marca como auditable un VCP con datos, secuencia y profundidades recomputables", () => {
    const audit = vcpReliabilityAudit(fullPattern, planDisplay);
    expect(audit.key).toBe("audit-ready");
    expect(audit.patternClaimReliable).toBe(true);
    expect(audit.auditabilityPct).toBeGreaterThanOrEqual(85);
    expect(audit.components.find((item) => item.key === "math")).toMatchObject({ state: "pass" });
    expect(audit.depthChecks.every((item) => item.ok)).toBe(true);
  });

  it("bloquea un falso positivo por lower-low sin convertirlo en contradiccion", () => {
    const audit = vcpReliabilityAudit({
      ...fullPattern,
      contractionStructureStatus: "lower_low_drift",
      contractionsDecreasing: false,
      rejectedContractionDepthPct: 8,
    }, {
      key: "not_actionable",
      label: "No VCP claro",
      observable: false,
      watch: false,
      actionable: false,
      tradePlanEligible: false,
      blocksPatternClaim: false,
      reason: "mínimos no sostienen la base",
    });
    expect(audit.key).toBe("blocked");
    expect(audit.claimLevel).toBe("block");
    expect(audit.contradictions).toEqual([]);
    expect(audit.components.find((item) => item.key === "sequence")).toMatchObject({ state: "fail" });
  });

  it("detecta una contradiccion si una estructura invalida pretende salir como plan", () => {
    const audit = vcpReliabilityAudit({
      ...fullPattern,
      contractionStructureStatus: "depth_reexpansion",
      contractionsDecreasing: false,
    }, planDisplay);
    expect(audit.key).toBe("inconsistent");
    expect(audit.patternClaimReliable).toBe(false);
    expect(audit.contradictions.join(" ")).toMatch(/secuencia/i);
    expect(audit.auditabilityPct).toBeLessThanOrEqual(35);
  });

  it("degrada a resumen cuando solo sobreviven profundidades persistidas sin high/low", () => {
    const audit = vcpReliabilityAudit({
      ...fullPattern,
      contractionSwings: [],
      contractionDepths: [16, 9, 5],
    }, {
      ...planDisplay,
      actionable: false,
      tradePlanEligible: false,
      watch: true,
    });
    expect(audit.key).toBe("summary-only");
    expect(audit.patternClaimReliable).toBe(false);
    expect(audit.components.find((item) => item.key === "math")).toMatchObject({ state: "watch" });
  });

  it("marca datos insuficientes sin permitir claim fiable", () => {
    const audit = vcpReliabilityAudit({
      patternEligible: false,
      patternDataStatus: "insufficient_history",
      patternBarsCount: 64,
      patternMinBars: 90,
      contractionStructureStatus: "data_blocked",
      contractionCount: 0,
      contractionDepths: [],
    }, {
      key: "data_limited",
      label: "Datos parciales",
      blocksPatternClaim: true,
      dataLimited: true,
      actionable: false,
      tradePlanEligible: false,
    });
    expect(audit.key).toBe("needs-data");
    expect(audit.patternClaimReliable).toBe(false);
    expect(audit.components.find((item) => item.key === "data")).toMatchObject({ state: "fail" });
  });

  it("incluye la auditoria dentro del snapshot diagnostico", () => {
    const diagnostic = vcpDiagnosticSnapshot(fullPattern);
    expect(diagnostic.reliability).toMatchObject({
      key: expect.any(String),
      auditabilityPct: expect.any(Number),
      note: expect.stringMatching(/Auditabilidad interna/),
    });
  });
});
