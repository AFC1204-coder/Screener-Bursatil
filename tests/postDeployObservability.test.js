import { describe, expect, it } from "vitest";
import { buildPostDeployObservabilityReport, compareRcReports } from "@/lib/postDeployObservability";

function report({ ok = true, status = "pass", score = 100, checkState = "pass", statusCode = 200, degraded = false, latencyMs = 100 } = {}) {
  return {
    ok,
    status,
    score,
    targetScore: 95,
    source: { environment: "test", baseUrl: "http://example.test" },
    counts: { blockers: ok ? 0 : 1, warnings: status === "warn" ? 1 : 0 },
    checks: [{
      area: "endpointAvailability",
      name: "Screener shell",
      path: "/",
      state: checkState,
      statusCode,
      degraded,
      latencyMs,
      maxLatencyMs: 1000,
      issues: checkState === "fail" ? [{ severity: "fail", key: "contract-failed", message: "failed" }] : [],
    }],
  };
}

describe("post-deploy observability", () => {
  it("allows a local-only baseline but records a production-url warning", () => {
    const result = buildPostDeployObservabilityReport({
      local: { name: "local", baseUrl: "http://127.0.0.1:3000", report: report() },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("warn");
    expect(result.mode).toBe("local-only");
    expect(result.warnings.some((item) => item.key === "missing-production-url")).toBe(true);
  });

  it("blocks when production regresses from a passing local check", () => {
    const comparison = compareRcReports(report(), report({ ok: false, status: "fail", checkState: "fail" }));

    expect(comparison.blockers.some((item) => item.key === "production-readiness-failed")).toBe(true);
    expect(comparison.blockers.some((item) => item.key === "production-check-regressed")).toBe(true);
  });

  it("blocks HTTP status divergences between local and production", () => {
    const comparison = compareRcReports(report({ statusCode: 200 }), report({ statusCode: 401 }));

    expect(comparison.blockers.some((item) => item.key === "status-divergence")).toBe(true);
  });

  it("warns on large production latency regressions", () => {
    const comparison = compareRcReports(
      report({ latencyMs: 300 }),
      report({ latencyMs: 1400 }),
      { thresholds: { maxLatencyRatio: 2, minLatencyDeltaMs: 500 } }
    );

    expect(comparison.warnings.some((item) => item.key === "latency-regression")).toBe(true);
  });

  it("suppresses latency regression warnings for same-environment validation runs", () => {
    const comparison = compareRcReports(
      report({ latencyMs: 300 }),
      report({ latencyMs: 1400 }),
      { sameEnvironment: true, thresholds: { maxLatencyRatio: 2, minLatencyDeltaMs: 500 } }
    );

    expect(comparison.warnings.some((item) => item.key === "latency-regression")).toBe(false);
  });
});
