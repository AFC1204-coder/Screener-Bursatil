import { describe, expect, it } from "vitest";
import { vcpMinerviniLabel } from "@/lib/vcpMinerviniLabel";

describe("vcpMinerviniLabel", () => {
  it("GOOGL-like: candidato 2C con pivot", () => {
    const out = vcpMinerviniLabel({
      contractionCount: 2,
      vcpCandidate: true,
      distanceToPivotPct: -2,
    });
    expect(out.label).toBe("2C·PV-2%");
    expect(out.tone).toBe("neutral");
  });

  it("FTNT-like: 2C en formación sin candidato", () => {
    const out = vcpMinerviniLabel({
      contractionCount: 2,
      vcpCandidate: false,
      distanceToPivotPct: -1.5,
    });
    expect(out.label).toBe("2C·form·PV-1.5%");
    expect(out.tone).toBe("watch");
  });

  it("NDAQ-like: sin compresión operable", () => {
    const out = vcpMinerviniLabel({ contractionCount: 1, vcpCandidate: false });
    expect(out.label).toBe("");
  });

  it("3C candidato sin pivot", () => {
    const out = vcpMinerviniLabel({ contractionCount: 3, vcpCandidate: true });
    expect(out.label).toBe("3C");
    expect(out.tone).toBe("neutral");
  });
});
