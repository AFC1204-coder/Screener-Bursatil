import { describe, expect, it } from "vitest";
import { buildScreenerDecisionBrief } from "@/lib/screenerDecisionBrief";

describe("screenerDecisionBrief", () => {
  it("declara una lectura fiable cuando predominan filas de alta confianza sin bloqueos relevantes", () => {
    const brief = buildScreenerDecisionBrief({
      audit: {
        rows: 10,
        decisions: { operable: 5, watch: 3, audit: 1 },
        decisionQuality: {
          confidence: [
            { key: "high", count: 6 },
            { key: "medium", count: 2 },
          ],
          topIssues: [
            { key: "overextended-sma50", label: "Extendida sobre SMA50", severity: "warn", count: 1, share: "10.0%" },
          ],
          longCandidateRiskCount: 0,
          operableConfidenceRiskCount: 1,
        },
      },
    });

    expect(brief.verdict).toMatchObject({ key: "reliable", tone: "good" });
    expect(brief.metrics.find((item) => item.key === "confidence")).toMatchObject({ value: 6, share: "60%" });
    expect(brief.actions.map((item) => item.key)).toContain("high-confidence");
  });

  it("marca lectura frágil cuando domina una incidencia severa o falta confianza alta", () => {
    const brief = buildScreenerDecisionBrief({
      audit: {
        rows: 8,
        decisions: { watch: 3, audit: 4, reject: 1 },
        decisionQuality: {
          confidence: [
            { key: "high", count: 0 },
            { key: "low", count: 5 },
          ],
          topIssues: [
            { key: "missing-global-rs", label: "Sin liderazgo RS global", severity: "bad", count: 4, share: "50.0%" },
          ],
          longCandidateRiskCount: 3,
          operableConfidenceRiskCount: 0,
        },
      },
    });

    expect(brief.verdict).toMatchObject({ key: "fragile", tone: "bad" });
    expect(brief.primaryIssue).toMatchObject({ key: "missing-global-rs", count: 4 });
    expect(brief.actions.map((item) => item.key)).toEqual(expect.arrayContaining(["audit", "primary-issue"]));
  });

  it("devuelve una lectura vacía cuando no hay resultados", () => {
    const brief = buildScreenerDecisionBrief({ audit: null, rows: [] });

    expect(brief.rows).toBe(0);
    expect(brief.verdict.key).toBe("empty");
    expect(brief.actions).toEqual([]);
  });
});
