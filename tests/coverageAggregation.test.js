import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, ownerId: "owner-test", missing: [] })),
  supabaseRpc: vi.fn(),
}));

import { buildScanCoverage, summarizeScanCoverageRows } from "@/lib/coveragePlan";
import { supabaseRpc } from "@/lib/supabaseServer";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function fixtureRows() {
  return [
    {
      symbol: "AAA",
      country: "US",
      total_score: 88,
      metrics: { priceFreshnessDays: 1, dataCoverageScore: 90, objectiveScore: 80 },
      raw: {},
      created_at: "2026-07-09T10:00:00.000Z",
    },
    {
      symbol: "AAA",
      country: "US",
      total_score: 88,
      metrics: { priceFreshnessDays: 7, dataCoverageScore: 90, objectiveScore: 80 },
      raw: {},
      created_at: "2026-07-09T11:00:00.000Z",
    },
    {
      symbol: "BBB",
      country: "DE",
      total_score: 92,
      metrics: { priceFreshnessDays: 2, dataCoverageScore: 39, objectiveScore: 90 },
      raw: {},
      created_at: "2026-07-09T09:00:00.000Z",
    },
    {
      symbol: "CCC",
      country: "",
      total_score: null,
      metrics: { lastDate: "2026-07-07" },
      raw: { country: "JP" },
      created_at: "2026-07-09T08:00:00.000Z",
    },
    {
      symbol: "DDD",
      country: "AU",
      total_score: 70,
      metrics: {},
      raw: { priceFreshnessDays: "2", dataCoverageScore: "80", objectiveScore: 44 },
      created_at: "2026-07-09T07:00:00.000Z",
    },
  ];
}

describe("coverage scan aggregation contract", () => {
  afterEach(() => supabaseRpc.mockReset());

  it("preserva las reglas legacy de latest-by-symbol, freshness, coverage y elegibilidad", () => {
    expect(summarizeScanCoverageRows(fixtureRows(), { nowMs: NOW })).toEqual({
      rowsRead: 5,
      uniqueSymbols: 4,
      fresh: 3,
      qualityOk: 2,
      rankingEligible: 1,
      actionable: 1,
      latestScanAt: "2026-07-09T11:00:00.000Z",
      byMarket: {
        US: { uniqueSymbols: 1, fresh: 0, qualityOk: 0, rankingEligible: 0, actionable: 0 },
        DE: { uniqueSymbols: 1, fresh: 1, qualityOk: 0, rankingEligible: 0, actionable: 0 },
        JP: { uniqueSymbols: 1, fresh: 1, qualityOk: 1, rankingEligible: 1, actionable: 1 },
        AU: { uniqueSymbols: 1, fresh: 1, qualityOk: 1, rankingEligible: 0, actionable: 0 },
      },
    });
  });

  it("usa una sola RPC agregada y no solicita metrics/raw al cliente", async () => {
    supabaseRpc.mockResolvedValue({
      rowsRead: 4000,
      uniqueSymbols: 1200,
      fresh: 900,
      qualityOk: 800,
      rankingEligible: 600,
      actionable: 600,
      latestScanAt: "2026-07-10T10:00:00.000Z",
      byMarket: { US: { uniqueSymbols: 1200, fresh: 900, qualityOk: 800, rankingEligible: 600, actionable: 600 } },
    });

    const signal = new AbortController().signal;
    const result = await buildScanCoverage({ maxRows: 4000, timeoutMs: 2500, signal });

    expect(result.status).toBe("supabase");
    expect(result.rowsRead).toBe(4000);
    expect(result.rankingEligible).toBe(600);
    expect(supabaseRpc).toHaveBeenCalledTimes(1);
    const [name, payload, options] = supabaseRpc.mock.calls[0];
    expect(name).toBe("coverage_scan_summary");
    expect(payload).toMatchObject({
      p_owner_id: "owner-test",
      p_max_rows: 4000,
      p_max_price_freshness_days: 5,
      p_min_coverage_score: 40,
    });
    expect(options).toEqual({ timeoutMs: 2500, signal });
    expect(JSON.stringify(supabaseRpc.mock.calls[0])).not.toContain("select=symbol,country,total_score,metrics,raw");
  });

  it("propaga el aborto global en vez de degradarlo a scanCoverage.error", async () => {
    const controller = new AbortController();
    const timeoutError = new Error("Coverage report timeout");
    supabaseRpc.mockImplementation((_name, _payload, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    const pending = buildScanCoverage({ signal: controller.signal });
    controller.abort(timeoutError);
    await expect(pending).rejects.toBe(timeoutError);
  });
});
