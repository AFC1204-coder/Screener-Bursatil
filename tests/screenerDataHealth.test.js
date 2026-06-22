import { describe, expect, it } from "vitest";
import { buildScreenerDataHealth, buildScreenerDataHealthSummary, dataHealthFilterLabel, dataHealthMatchesFilter } from "@/lib/screenerDataHealth";

describe("buildScreenerDataHealth", () => {
  it("marca como apta una fila con precio fresco, cobertura util e historico suficiente", () => {
    const health = buildScreenerDataHealth({
      symbol: "READY",
      price: 120,
      chartBarsCount: 260,
      dataCoverageScore: 84,
      technicalCoverageScore: 88,
      fundamentalCoverageScore: 52,
      profileCoverageScore: 75,
      priceFreshnessOk: true,
      priceFreshnessDays: 1,
      priceFreshnessMaxDays: 4,
      chartProvider: "Yahoo Finance",
    });

    expect(health.status.key).toBe("ready");
    expect(health.status.tone).toBe("good");
    expect(health.coverageScore).toBe(84);
    expect(health.metrics.map((item) => item.key)).toEqual(["coverage", "technical", "fundamental", "profile", "bars"]);
    expect(health.freshness.ok).toBe(true);
    expect(health.provider.label).toBe("Yahoo Finance");
    expect(health.issues).toEqual([]);
    expect(health.topLine).toContain("Cob 84");
  });

  it("bloquea filas con snapshot parcial, precio viejo e historico insuficiente", () => {
    const health = buildScreenerDataHealth({
      symbol: "FRAGILE",
      price: 20,
      chartBarsCount: 35,
      dataCoverageScore: 42,
      technicalCoverageScore: 38,
      fundamentalCoverageScore: 12,
      priceFreshnessOk: false,
      priceFreshnessDays: 9,
      priceFreshnessMaxDays: 4,
      priceFreshnessIssue: "precio viejo: 9d > 4d",
      dataCoverageIssues: ["tecnico parcial", "fundamental parcial"],
      decisionProjectionPartial: true,
      decisionProjectionMissing: ["chartBarsCount", "price"],
      chartProvider: "Proveedor alternativo",
    });

    expect(health.status.key).toBe("blocked");
    expect(health.status.tone).toBe("bad");
    expect(health.freshness.stale).toBe(true);
    expect(health.issues.map((item) => item.key)).toContain("projection-partial");
    expect(health.issues.map((item) => item.key)).toContain("quality-gate");
    expect(health.issues.map((item) => item.key)).toContain("freshness");
    expect(health.metrics.find((item) => item.key === "bars")?.tone).toBe("warn");
  });

  it("usa el umbral de historico reducido en modo IPO reciente", () => {
    const health = buildScreenerDataHealth({
      symbol: "IPO",
      price: 30,
      chartBarsCount: 35,
      dataCoverageScore: 68,
      technicalCoverageScore: 66,
      fundamentalCoverageScore: 20,
      priceFreshnessOk: true,
    }, { setupMode: "ipoRecent" });

    expect(health.gate.passed).toBe(true);
    expect(health.metrics.find((item) => item.key === "bars")?.tone).toBe("good");
    expect(health.status.key).toBe("partial");
  });

  it("expone etiquetas y matching estable para filtros de vista", () => {
    const staleRow = {
      symbol: "STALE",
      price: 30,
      chartBarsCount: 260,
      dataCoverageScore: 70,
      technicalCoverageScore: 74,
      fundamentalCoverageScore: 35,
      priceFreshnessOk: false,
      priceFreshnessDays: 8,
      priceFreshnessMaxDays: 4,
      priceFreshnessIssue: "precio viejo: 8d > 4d",
    };

    expect(dataHealthFilterLabel("stale")).toBe("Precio viejo");
    expect(dataHealthFilterLabel("stale", { compact: true })).toBe("Viejos");
    expect(dataHealthMatchesFilter(staleRow, "stale")).toBe(true);
    expect(dataHealthMatchesFilter(staleRow, "ready")).toBe(false);
    expect(dataHealthMatchesFilter(staleRow, "Todos")).toBe(true);
  });

  it("resume la salud de datos de una vista para navegar incidencias", () => {
    const ready = {
      symbol: "READY",
      price: 90,
      chartBarsCount: 260,
      dataCoverageScore: 86,
      technicalCoverageScore: 90,
      fundamentalCoverageScore: 55,
      priceFreshnessOk: true,
    };
    const stale = {
      ...ready,
      symbol: "STALE",
      priceFreshnessOk: false,
      priceFreshnessDays: 9,
      priceFreshnessMaxDays: 4,
      priceFreshnessIssue: "precio viejo: 9d > 4d",
    };
    const blocked = {
      ...ready,
      symbol: "BLOCK",
      chartBarsCount: 20,
    };

    const summary = buildScreenerDataHealthSummary([ready, stale, blocked], { setupMode: "leader" });

    expect(summary.rows).toBe(3);
    expect(summary.readyCount).toBe(1);
    expect(summary.attentionCount).toBe(2);
    expect(summary.counts).toMatchObject({ ready: 1, stale: 1, blocked: 1 });
    expect(summary.verdict.key).toBe("blocked");
    expect(summary.items.find((item) => item.key === "stale")).toMatchObject({ count: 1, share: "33%", tone: "warn" });
    expect(summary.topIssues.map((item) => item.key)).toContain("freshness");
  });
});
