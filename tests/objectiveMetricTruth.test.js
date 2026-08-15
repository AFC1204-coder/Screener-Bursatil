import { describe, expect, it } from "vitest";
import { buildObjectiveMetricAudit, addScoredObjectiveMetricAudit, objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { buildResearchRow } from "@/lib/researchRow";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";

function barsFromCloses(closes = [], { volume = 1000 } = {}) {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2026, 0, closes.length - index)).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
    volume: volume + index,
  }));
}

const closesNewestFirst = Array.from({ length: 260 }, (_, index) => 260 - index);
const risingBars = barsFromCloses(closesNewestFirst);
const benchmarkBars = barsFromCloses(closesNewestFirst.map((value) => value * 0.9));

describe("objectiveMetricTruth", () => {
  it("recalcula metricas objetivas desde barras y conserva provenance", () => {
    const row = buildResearchRow("GOLD", { bars: risingBars, meta: { dataProvider: "Fixture" } }, {}, { requireLongHistory: false }, {
      SPY: { bars: benchmarkBars },
    });

    const audit = row.objectiveMetricAudit;
    expect(audit.status).toBe("verified");
    expect(audit.asOf).toBe(risingBars[0].date);
    expect(audit.items.find((item) => item.key === "sma50")).toMatchObject({
      status: "verified",
      source: "Fixture",
      expected: 235.5,
      formula: "avg(close, 50)",
      inputCount: 260,
      minInputCount: 50,
    });
    expect(audit.items.find((item) => item.key === "extSma50").expected).toBeCloseTo(((260 / 235.5) - 1) * 100, 4);
    expect(audit.items.find((item) => item.key === "perf3m").expected).toBeCloseTo(((260 / 197) - 1) * 100, 4);
    expect(audit.items.find((item) => item.key === "rsRating")).toMatchObject({
      status: "verified",
      source: "SPY",
    });
  });

  it("marca mismatch cuando una media movil declarada no coincide con las barras", () => {
    const clean = buildResearchRow("BADMA", { bars: risingBars, meta: { dataProvider: "Fixture" } }, {}, { requireLongHistory: false }, {
      SPY: { bars: benchmarkBars },
    });
    const audit = buildObjectiveMetricAudit({ ...clean, sma50: 999 }, {
      bars: risingBars,
      benchmarkBars,
      source: "Fixture",
      asOf: clean.lastDate,
    });

    expect(audit.status).toBe("bad");
    expect(audit.issues[0]).toMatchObject({
      key: "sma50",
      status: "mismatch",
      severity: "bad",
    });
    expect(objectiveMetricAuditStatusForRow({ objectiveMetricAudit: audit })).toMatchObject({
      key: "bad",
      tone: "bad",
    });
  });

  it("bloquea salud de datos cuando la auditoria objetiva trae un mismatch critico", () => {
    const row = buildResearchRow("BLOCKMA", { bars: risingBars, meta: { dataProvider: "Fixture" } }, {}, { requireLongHistory: false }, {
      SPY: { bars: benchmarkBars },
    });
    const broken = {
      ...row,
      objectiveMetricAudit: buildObjectiveMetricAudit({ ...row, sma50: 999 }, {
        bars: risingBars,
        benchmarkBars,
        source: "Fixture",
        asOf: row.lastDate,
      }),
    };

    const health = buildScreenerDataHealth(broken, { setupMode: "leader" });
    expect(health.status.key).toBe("blocked");
    expect(health.issues.map((item) => item.key)).toContain("objective-metrics");
  });

  it("verifica la formula del score compuesto despues de sectorizar", () => {
    const scored = addScoredObjectiveMetricAudit({
      symbol: "SCORE",
      objectiveSetupScore: 60,
      setupQualityScore: 80,
      rsGlobalPct: 90,
      rsRating: 70,
      rsQualityScore: 75,
      demandScore: 70,
      adProxyScore: 60,
      growthScore: 65,
      epsGrowthProxyScore: 55,
      sectorScore: 72,
      riskRewardScore: 68,
      riskScore: 66,
      momentumScore: 62,
      // ipoScore sigue en la fila (lo consumen las Listas) pero YA NO es
      // término del composite: los tres scores de abajo son los once términos
      // renormalizados sobre .98. Antes eran 71.48 / 71.48 / 68.08, con el
      // término IPO dentro comprimiéndolos un 2%.
      ipoScore: 20,
      totalScore: 72.530612,
      compositeScore: 72.530612,
      objectiveScore: 69.061224,
      rsGlobalSample: 40,
      rsCountryPct: 80,
      rsCountrySample: 10,
      rsSectorPct: 78,
      rsSectorSample: 8,
    });

    expect(scored.objectiveMetricAudit.status).toBe("verified");
    expect(scored.objectiveMetricAudit.items.find((item) => item.key === "totalScore")).toMatchObject({
      status: "verified",
      source: "score-formula",
    });
    expect(scored.objectiveMetricAudit.items.find((item) => item.key === "objectiveScore")).toMatchObject({
      status: "verified",
      source: "score-formula",
    });

    const tampered = addScoredObjectiveMetricAudit({ ...scored, totalScore: 90, compositeScore: 90, objectiveScore: 90 });
    expect(tampered.objectiveMetricAudit.status).toBe("bad");
    expect(tampered.objectiveMetricAudit.issues.map((item) => item.key)).toEqual(expect.arrayContaining(["totalScore", "compositeScore", "objectiveScore"]));
  });
});
