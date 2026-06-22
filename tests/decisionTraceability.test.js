import { describe, expect, it } from "vitest";
import { buildDecisionTraceabilitySummary, decisionResolutionForRow, uniqueTraceableRows } from "@/lib/decisionTraceability";

describe("decisionTraceability", () => {
  it("deduplica símbolos y resume resoluciones visibles", () => {
    const review = {
      source: "current",
      decisionResolutions: {
        AAA: { key: "candidate", label: "Candidata", tone: "good", updatedAt: "2026-06-18T08:00:00.000Z" },
        CCC: { key: "watch", label: "Vigilar", tone: "warn", updatedAt: "2026-06-18T09:00:00.000Z" },
      },
      decisionResolutionLog: [
        { symbol: "CCC", key: "watch", label: "Vigilar", tone: "warn", updatedAt: "2026-06-18T09:00:00.000Z" },
        { symbol: "AAA", key: "candidate", label: "Candidata", tone: "good", updatedAt: "2026-06-18T08:00:00.000Z" },
      ],
    };
    const rows = [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "AAA" }, { snapshot: { symbol: "CCC" } }];

    expect(uniqueTraceableRows(rows).map((row) => row.symbol)).toEqual(["AAA", "BBB", "CCC"]);
    expect(decisionResolutionForRow({ symbol: "aaa" }, review)).toMatchObject({ key: "candidate" });

    const summary = buildDecisionTraceabilitySummary(rows, review);
    expect(summary.rows).toBe(3);
    expect(summary.pendingCount).toBe(1);
    expect(summary.resolvedCount).toBe(2);
    expect(summary.resolvedGroups.map((group) => `${group.key}:${group.count}`)).toEqual(["candidate:1", "watch:1"]);
    expect(summary.latest.map((entry) => `${entry.symbol}:${entry.key}`)).toEqual(["CCC:watch", "AAA:candidate"]);
  });

  it("filtra el historial por símbolos del scope antes de recortar eventos recientes", () => {
    const noisyLog = Array.from({ length: 12 }, (_, index) => ({
      symbol: `NOISE${index}`,
      key: "watch",
      label: "Vigilar",
      tone: "warn",
      updatedAt: `2026-06-18T10:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const review = {
      decisionResolutions: {
        TRACE: { key: "candidate", label: "Candidata", tone: "good", updatedAt: "2026-06-18T08:00:00.000Z" },
        BROKEN: { key: "unknown", label: "Fantasma", tone: "bad", updatedAt: "2026-06-18T09:00:00.000Z" },
      },
      decisionResolutionLog: [
        ...noisyLog,
        { symbol: "TRACE", key: "candidate", label: "Candidata", tone: "good", updatedAt: "2026-06-18T08:00:00.000Z" },
      ],
    };

    const summary = buildDecisionTraceabilitySummary([{ symbol: "TRACE" }, { symbol: "BROKEN" }], review);

    expect(decisionResolutionForRow({ symbol: "broken" }, review)).toBeNull();
    expect(summary.latest.map((entry) => `${entry.symbol}:${entry.key}`)).toEqual(["TRACE:candidate"]);
    expect(summary.pendingCount).toBe(1);
    expect(summary.resolvedCount).toBe(1);
  });
});
