import { describe, expect, it } from "vitest";
import { buildRcReadinessReport, normalizeRcCheck, RC_READINESS_AREAS } from "@/lib/rcReadiness";

function passingChecks() {
  return RC_READINESS_AREAS.map((area) => ({
    area: area.key,
    name: `${area.key} pass`,
    ok: true,
    statusCode: area.key === "authProtection" ? 401 : 200,
    expectedStatus: area.key === "authProtection" ? 401 : undefined,
    latencyMs: 100,
    maxLatencyMs: 1000,
  }));
}

describe("RC readiness scoring", () => {
  it("passes a complete release gate above the target score", () => {
    const report = buildRcReadinessReport({ checks: passingChecks() });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("pass");
    expect(report.score).toBe(100);
    expect(report.counts.fail).toBe(0);
  });

  it("fails when an internal endpoint does not return the expected unauthorized status", () => {
    const report = buildRcReadinessReport({
      checks: [
        ...passingChecks().filter((check) => check.area !== "authProtection"),
        {
          area: "authProtection",
          name: "Auth guard",
          ok: false,
          statusCode: 200,
          expectedStatus: 401,
        },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.blockers.some((item) => item.key === "unexpected-status")).toBe(true);
  });

  it("warns but does not block when degraded data is explicit and the score remains high", () => {
    const report = buildRcReadinessReport({
      checks: [
        ...passingChecks(),
        {
          area: "dataClarity",
          name: "Estimated chart",
          ok: true,
          statusCode: 200,
          latencyMs: 100,
          maxLatencyMs: 1000,
          degraded: true,
          explicitDegradation: true,
        },
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("warn");
    expect(report.warnings.some((item) => item.key === "explicit-degradation")).toBe(true);
  });

  it("fails ambiguous degraded payloads", () => {
    const check = normalizeRcCheck({
      area: "dataClarity",
      name: "Ambiguous fallback",
      ok: true,
      statusCode: 200,
      degraded: true,
      explicitDegradation: false,
    });

    expect(check.state).toBe("fail");
    expect(check.issues.some((item) => item.key === "ambiguous-degradation")).toBe(true);
  });
});
