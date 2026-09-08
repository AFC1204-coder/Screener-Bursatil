// Leadership pulse desde escaneo nocturno publicable (MH-FILL-3).
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
let scansResponse = [];
let nightlyRows = [];

vi.mock("@/lib/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabaseConfig: () => ({ configured: true, ownerId: "personal", url: "https://x.test", key: "k", missing: [] }),
    supabaseRequest: async (path, options) => {
      calls.push({ path, query: options?.query });
      if (path === "scans") return scansResponse;
      return [];
    },
    supabaseRequestAll: async (path) => {
      calls.push({ path });
      return path === "scan_results" ? nightlyRows : [];
    },
  };
});

const { buildScanPulse, readMarketLeadership } = await import("@/lib/marketLeadership");

const scanRow = (localId, id, createdAt, rowCount) => ({
  id,
  local_id: localId,
  created_at: createdAt,
  row_count: rowCount,
  preset: "materialized-cache",
  market_regime: "Mercado constructivo pero selectivo",
  settings: { progress: { status: "partial" } },
});

function leadershipRow(overrides = {}) {
  return {
    symbol: "AAA",
    companyName: "Alpha Corp",
    country: "US",
    sector: "Technology",
    theme: "Software",
    weeklyRsAvailable: true,
    weeklyRsRating: 88,
    objectiveScore: 82,
    distance52w: -5,
    price: 120,
    sma50: 110,
    sma200: 100,
    sma200Slope: 1,
    weaknessScore: 20,
    rsRating: 75,
    maxDrawdown63d: 10,
    upDownVolRatio: 1.2,
    riskScore: 60,
    speculationRiskScore: 30,
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  scansResponse = [];
  nightlyRows = [];
});

describe("buildScanPulse · agregado puro", () => {
  it("calcula KPIs y listas de liderazgo/deterioro", () => {
    const rows = [
      leadershipRow({ symbol: "AAA", weeklyRsRating: 90, objectiveScore: 85 }),
      leadershipRow({ symbol: "BBB", weeklyRsRating: 35, weaknessScore: 80, price: 80, sma50: 100, sma200: 95 }),
      leadershipRow({ symbol: "CCC", weeklyRsRating: 82, distance52w: -20 }),
    ];
    const pulse = buildScanPulse({ createdAt: "2026-09-08T03:00:00.000Z", preset: "materialized-cache", marketRegime: "ok" }, rows);

    expect(pulse.count).toBe(3);
    expect(pulse.rsLeaderPct).toBeCloseTo((2 / 3) * 100, 5);
    expect(pulse.leaders.map((row) => row.symbol)).toContain("AAA");
    expect(pulse.deterioration.map((row) => row.symbol)).toContain("BBB");
    expect(pulse.countries[0].name).toBe("US");
    expect(pulse.themes.length).toBeGreaterThan(0);
  });

  it("devuelve null sin filas", () => {
    expect(buildScanPulse({ createdAt: "2026-09-08" }, [])).toBeNull();
  });
});

describe("readMarketLeadership · población anclada al nocturno", () => {
  it("pide el escaneo por prefijo de local_id y agrega sus filas", async () => {
    scansResponse = [scanRow("materialized:US:2026-09-08:o0:l5609", "us-16", "2026-09-08T03:57:58.557Z", 3)];
    nightlyRows = [leadershipRow({ symbol: "AAA" }), leadershipRow({ symbol: "BBB", country: "DE" })];

    const payload = await readMarketLeadership({ refresh: true });

    expect(payload.nightly).toMatchObject({ found: true });
    expect(payload.pulse.count).toBe(2);
    expect(payload.pulse.leaders.length).toBeGreaterThan(0);
    const query = decodeURIComponent(String(calls.find((call) => call.path === "scans")?.query || ""));
    expect(query).toContain("local_id=like.materialized:US:*");
    expect(calls.some((call) => call.path === "scan_results")).toBe(true);
  });

  it("sin nocturno declara ausencia honesta", async () => {
    scansResponse = [];

    const payload = await readMarketLeadership({ refresh: true });

    expect(payload.pulse).toBeNull();
    expect(payload.error).toContain("escaneo nocturno de Estados Unidos");
    expect(calls.filter((call) => call.path === "scan_results")).toHaveLength(0);
  });

  it("un nocturno no publicable no se mide", async () => {
    scansResponse = [{ ...scanRow("materialized:US:2026-09-08:o0:l5609", "us-fail", "2026-09-08T03:57:58.557Z", 3), settings: { progress: { status: "failed" } } }];

    const payload = await readMarketLeadership({ refresh: true });

    expect(payload.nightly).toMatchObject({ found: false, reason: "nightly-not-publishable" });
    expect(payload.pulse).toBeNull();
    expect(calls.filter((call) => call.path === "scan_results")).toHaveLength(0);
  });
});
