import { describe, expect, it } from "vitest";
import { vcpMinerviniLabel } from "@/lib/vcpMinerviniLabel";

describe("vcpMinerviniLabel", () => {
  it("candidato: huella primera/última y número de contracciones", () => {
    const out = vcpMinerviniLabel({
      contractionCount: 4,
      vcpCandidate: true,
      contraction1DepthPct: 31.2,
      contraction2DepthPct: 15,
      contraction3DepthPct: 8,
      lastContractionDepthPct: 3.4,
      distanceToPivotPct: -2,
    });
    expect(out.label).toBe("31/3 4T");
    expect(out.tone).toBe("neutral");
    expect(out.title).toMatch(/Candidato VCP/);
    expect(out.title).toMatch(/-2%/);
  });

  it("en formación: mismo formato, tono watch y sin jerga form/PV", () => {
    const out = vcpMinerviniLabel({
      contractionCount: 2,
      vcpCandidate: false,
      contraction1DepthPct: 12,
      contraction2DepthPct: 6,
      distanceToPivotPct: -1.5,
    });
    expect(out.label).toBe("12/6 2T");
    expect(out.label).not.toMatch(/form|PV|C·/);
    expect(out.tone).toBe("watch");
  });

  it("sin profundidades guardadas: solo el número de contracciones", () => {
    const out = vcpMinerviniLabel({ contractionCount: 3, vcpCandidate: true });
    expect(out.label).toBe("3T");
    expect(out.tone).toBe("neutral");
  });

  it("NDAQ-like: sin compresión operable", () => {
    expect(vcpMinerviniLabel({ contractionCount: 1, vcpCandidate: false }).label).toBe("");
  });
});
