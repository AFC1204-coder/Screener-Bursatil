// F-A2 del ADR "Descubrimiento global curado". La opción interna explícita
// curatedDiscovery cambia solo el orden y la exclusión de contradicciones ya
// materializadas. Las señales del comparador son por símbolo (precio, volumen,
// scores técnicos o rsRating contra benchmark local), por lo que no dependen
// del tamaño ni la composición del batch.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, url: "https://example.supabase.co", ownerId: "owner-test" })),
  supabaseRpc: vi.fn(),
  supabaseRequest: vi.fn(),
  supabaseRequestAll: vi.fn(),
  textOrNull: (v) => (v == null ? null : String(v)),
  finiteOrNull: (v) => (Number.isFinite(v) ? v : null),
  disabledPayload: () => ({ disabled: true }),
}));

import { buildLeaderboard } from "@/lib/leaderboards";

function row(symbol, overrides = {}) {
  return {
    symbol,
    raw: {
      symbol,
      companyName: symbol,
      country: "US",
      sector: "Technology",
      price: 120,
      sma50: 110,
      sma150: 100,
      sma200: 95,
      sma200Slope: 0.4,
      lastDate: new Date().toISOString().slice(0, 10),
      dataCoverageScore: 80,
      avgTurnover: 2_000_000,
      objectiveScore: 65,
      totalScore: 65,
      compositeScore: 65,
      rsGlobalPct: 70,
      rsRating: 70,
      weinsteinScore: 70,
      minerviniScore: 70,
      setupQualityScore: 70,
      perf3m: 12,
      perf6m: 24,
      perf12m: 48,
      distance52w: -8,
      extSma50: 5,
      percentileScope: "batch",
      ...overrides,
    },
  };
}

function curated(rows, params = {}) {
  return buildLeaderboard(rows, { strategy: "momentum", limit: 25, curatedDiscovery: true, ...params });
}

describe("buildLeaderboard · Descubrimiento global curado (F-A2)", () => {
  it("prioriza señales absolutas sobre rsGlobalPct batch y conserva el scope como contexto", () => {
    const a = row("A_BATCH_RS", { rsGlobalPct: 99, rsRating: 55, weinsteinScore: 55, minerviniScore: 55, setupQualityScore: 55, perf3m: 3 });
    const b = row("B_ABSOLUTE", { rsGlobalPct: 45, rsRating: 88, weinsteinScore: 88, minerviniScore: 88, setupQualityScore: 88, perf3m: 20 });
    const board = curated([a, b]);

    expect(board.items.map((item) => item.symbol)).toEqual(["B_ABSOLUTE", "A_BATCH_RS"]);
    expect(board.items.find((item) => item.symbol === "B_ABSOLUTE").percentileScope).toBe("batch");
    expect(board.criteria.curatedDiscovery).toBe(true);
  });

  it("no cambia el orden curado al cambiar solo objectiveScore", () => {
    const baseline = curated([
      row("A", { rsRating: 60, objectiveScore: 70, rsGlobalPct: 70 }),
      row("B", { rsRating: 80, objectiveScore: 60, rsGlobalPct: 60 }),
    ]).items.map((item) => item.symbol);
    const objectiveOnly = curated([
      row("A", { rsRating: 60, objectiveScore: 46, rsGlobalPct: 70 }),
      row("B", { rsRating: 80, objectiveScore: 99, rsGlobalPct: 60 }),
    ]).items.map((item) => item.symbol);

    expect(baseline).toEqual(["B", "A"]);
    expect(objectiveOnly).toEqual(baseline);
  });

  it("no cambia el orden curado al cambiar solo rsGlobalPct batch", () => {
    const baseline = curated([
      row("A", { rsRating: 60, objectiveScore: 65, rsGlobalPct: 70 }),
      row("B", { rsRating: 80, objectiveScore: 65, rsGlobalPct: 60 }),
    ]).items.map((item) => item.symbol);
    const batchPercentileOnly = curated([
      row("A", { rsRating: 60, objectiveScore: 65, rsGlobalPct: 46 }),
      row("B", { rsRating: 80, objectiveScore: 65, rsGlobalPct: 99 }),
    ]).items.map((item) => item.symbol);

    expect(batchPercentileOnly).toEqual(baseline);
  });

  it("resuelve empates absolutos por símbolo, no por el orden de entrada", () => {
    const alpha = row("ALPHA");
    const beta = row("BETA");
    expect(curated([beta, alpha]).items.map((item) => item.symbol)).toEqual(["ALPHA", "BETA"]);
    expect(curated([alpha, beta]).items.map((item) => item.symbol)).toEqual(["ALPHA", "BETA"]);
  });

  it("la variante curada excluye final, acepta batch y trata scope ausente como batch", () => {
    const finalRow = row("FINAL", { percentileScope: "final" });
    const batchRow = row("BATCH", { percentileScope: "batch" });
    const unscoped = row("UNSCOPED");
    delete unscoped.raw.percentileScope;

    expect(curated([finalRow, batchRow, unscoped]).items.map((item) => item.symbol)).toEqual(["BATCH", "UNSCOPED"]);
    expect(curated([finalRow]).items).toEqual([]);
    expect(buildLeaderboard([finalRow, batchRow], { strategy: "momentum", limit: 25 }).items.map((item) => item.symbol)).toEqual(["FINAL", "BATCH"]);
  });

  it("conserva freshness, cobertura, liquidez, estrategia y la exclusión de contradicción presente", () => {
    const pass = row("PASS");
    const stale = row("STALE", { lastDate: "2020-01-01" });
    const lowCoverage = row("COVERAGE", { dataCoverageScore: 39 });
    const illiquid = row("ILLIQUID", { avgTurnover: 99 });
    const strategyFail = row("STRATEGY", { objectiveScore: 44, totalScore: 44, compositeScore: 44 });
    const contradictory = row("CONTRADICTION", { signalContradictions: [{ key: "base-under-distribution", tier: "thesis" }] });
    const cronWithoutField = row("CRON_NO_FIELD");
    delete cronWithoutField.raw.signalContradictions;

    const board = curated([pass, stale, lowCoverage, illiquid, strategyFail, contradictory, cronWithoutField], { minAvgTurnover: 250_000 });
    expect(board.items.map((item) => item.symbol)).toEqual(["CRON_NO_FIELD", "PASS"]);
  });

  it("los leaderboards normales no activan la rama curada", () => {
    const highBatch = row("HIGH_BATCH", { rsGlobalPct: 99, rsRating: 55, objectiveScore: 99 });
    const strongAbsolute = row("STRONG_ABSOLUTE", { rsGlobalPct: 45, rsRating: 88, objectiveScore: 45 });
    const normal = buildLeaderboard([highBatch, strongAbsolute], { strategy: "momentum", limit: 25 });

    expect(normal.items.map((item) => item.symbol)).toEqual(["HIGH_BATCH", "STRONG_ABSOLUTE"]);
    expect(normal.criteria).not.toHaveProperty("curatedDiscovery");
  });
});
