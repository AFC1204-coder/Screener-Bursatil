// Tests de la migración a scan_coverage_breakdown RPC para /api/scan-coverage.
//
// Patron: igual que tests/coverageAggregation.test.js (cobertura de /api/coverage).
// Verifica dos cosas:
//   1. La referencia legacy pura (summarizeScanCoverageBreakdown) reproduce las
//      reglas de rowShape/latestBySymbol/groupCoverage/avg/topSymbols para el
//      fixture — es el contrato de paridad que la RPC scan_coverage_breakdown debe
//      igualar (validado en tests/integration/scan-coverage-breakdown.real.test.mjs).
//   2. El GET invoca UNA sola RPC scan_coverage_breakdown y NO transfiere
//      metrics/raw (no hay select=...metrics,raw en el payload). Igual que el
//      test equivalente de coverageAggregation.test.js.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  disabledPayload: () => ({ disabled: true }),
  requirePersistenceAuth: () => null,
  supabaseConfig: () => ({ configured: true, ownerId: "owner-test", missing: [] }),
  supabaseRequest: vi.fn(async () => []),
  supabaseRpc: vi.fn(),
}));

import { GET } from "@/app/api/scan-coverage/route";
import { summarizeScanCoverageBreakdown } from "@/app/api/scan-coverage/route";
import { supabaseRpc } from "@/lib/supabaseServer";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

// Mismo fixture que coverageAggregation.test.js, extendido con sector en raw para
// ejercitar bySector (la otra suite no lo probaba porque coveragePlan no agrupa
// por sector). Aquí sí: la RPC scan_coverage_breakdown agrupa por country Y sector.
function fixtureRows() {
  return [
    { symbol: "AAA", country: "US", total_score: 88, metrics: { priceFreshnessDays: 1, dataCoverageScore: 90, objectiveScore: 80 }, raw: { sector: "Technology" }, created_at: "2026-07-09T10:00:00.000Z" },
    { symbol: "AAA", country: "US", total_score: 88, metrics: { priceFreshnessDays: 7, dataCoverageScore: 90, objectiveScore: 80 }, raw: { sector: "Technology" }, created_at: "2026-07-09T11:00:00.000Z" },
    { symbol: "BBB", country: "DE", total_score: 92, metrics: { priceFreshnessDays: 2, dataCoverageScore: 39, objectiveScore: 90 }, raw: { sector: "Energy" }, created_at: "2026-07-09T09:00:00.000Z" },
    { symbol: "CCC", country: "", total_score: null, metrics: { lastDate: "2026-07-07" }, raw: { country: "JP", sector: "Technology" }, created_at: "2026-07-09T08:00:00.000Z" },
    { symbol: "DDD", country: "AU", total_score: 70, metrics: {}, raw: { priceFreshnessDays: "2", dataCoverageScore: "80", objectiveScore: 44, sector: "Energy" }, created_at: "2026-07-09T07:00:00.000Z" },
  ];
}

describe("scan-coverage breakdown · referencia legacy (paridad con RPC)", () => {
  it("reproduce latest-by-symbol, freshness, coverage, elegibilidad, averages y agrupación country+sector", () => {
    const out = summarizeScanCoverageBreakdown(fixtureRows(), { nowMs: NOW, includeTop: false });
    expect(out).toEqual({
      rowsRead: 5,
      uniqueSymbols: 4,
      fresh: 3,
      qualityOk: 2,
      rankingEligible: 1,
      actionable: 1,
      // avg de los 3 coverage finitos (90 + 80 + 39) / 3 = 69.666..., excluyendo el null de CCC.
      avgCoverageScore: 69.66666666666667,
      // avg de los 3 totalScore finitos (88 + 92 + 70) / 3 = 83.333...
      avgTotalScore: 83.33333333333333,
      latestScanAt: "2026-07-09T11:00:00.000Z",
      byCountry: [
        { key: "JP", uniqueSymbols: 1, fresh: 1, freshPct: 100, qualityOk: 1, rankingEligible: 1, actionable: 1, avgCoverageScore: null, avgTotalScore: null },
        { key: "AU", uniqueSymbols: 1, fresh: 1, freshPct: 100, qualityOk: 1, rankingEligible: 0, actionable: 0, avgCoverageScore: 80, avgTotalScore: 70 },
        { key: "DE", uniqueSymbols: 1, fresh: 1, freshPct: 100, qualityOk: 0, rankingEligible: 0, actionable: 0, avgCoverageScore: 39, avgTotalScore: 92 },
        { key: "US", uniqueSymbols: 1, fresh: 0, freshPct: 0, qualityOk: 0, rankingEligible: 0, actionable: 0, avgCoverageScore: 90, avgTotalScore: 88 },
      ],
      bySector: [
        { key: "Technology", uniqueSymbols: 2, fresh: 1, freshPct: 50, qualityOk: 1, rankingEligible: 1, actionable: 1, avgCoverageScore: 90, avgTotalScore: 88 },
        { key: "Energy", uniqueSymbols: 2, fresh: 2, freshPct: 100, qualityOk: 1, rankingEligible: 0, actionable: 0, avgCoverageScore: 59.5, avgTotalScore: 81 },
      ],
    });
  });

  it("includeTop añade topSymbols por grupo (top 5 por objectiveScore)", () => {
    const out = summarizeScanCoverageBreakdown(fixtureRows(), { nowMs: NOW, includeTop: true });
    const tech = out.bySector.find((g) => g.key === "Technology");
    expect(tech.topSymbols).toEqual([
      { symbol: "AAA", score: 80, fresh: false, coverage: 90 },
      { symbol: "CCC", score: null, fresh: true, coverage: null },
    ]);
    const us = out.byCountry.find((g) => g.key === "US");
    expect(us.topSymbols).toEqual([{ symbol: "AAA", score: 80, fresh: false, coverage: 90 }]);
  });
});

describe("scan-coverage GET · usa RPC agregada scan_coverage_breakdown", () => {
  afterEach(() => supabaseRpc.mockReset());

  function buildRequest(search = "") {
    return new Request(`http://localhost/api/scan-coverage${search}`);
  }

  it("invoca una sola RPC scan_coverage_breakdown y deriva summary/byCountry/bySector de su payload", async () => {
    // Payload simulado de la RPC (shape del jsonb_build_object de la migración).
    supabaseRpc.mockResolvedValue({
      rowsRead: 4000,
      uniqueSymbols: 1200,
      fresh: 900,
      qualityOk: 800,
      rankingEligible: 600,
      actionable: 600,
      avgCoverageScore: 71.2,
      avgTotalScore: 84.5,
      latestScanAt: "2026-07-10T10:00:00.000Z",
      byCountry: [{ key: "US", uniqueSymbols: 1200, fresh: 900, freshPct: 75, qualityOk: 800, rankingEligible: 600, actionable: 600, avgCoverageScore: 71.2, avgTotalScore: 84.5 }],
      bySector: [{ key: "Technology", uniqueSymbols: 500, fresh: 400, freshPct: 80, qualityOk: 350, rankingEligible: 250, actionable: 250, avgCoverageScore: 80, avgTotalScore: 85 }],
    });

    const res = await GET(buildRequest());
    const body = await res.json();

    // 1 sola RPC, nombre correcto.
    expect(supabaseRpc).toHaveBeenCalledTimes(1);
    const [rpcName, payload] = supabaseRpc.mock.calls[0];
    expect(rpcName).toBe("scan_coverage_breakdown");
    expect(payload).toMatchObject({
      p_owner_id: "owner-test",
      p_max_rows: 10000,
      p_max_price_freshness_days: 5,
      p_min_coverage_score: 40,
      p_include_top: false,
    });
    // El payload NO pide metrics/raw (no es un select REST; es una RPC). El
    // contrato es que la llamada no contenga la firma del select legacy.
    expect(JSON.stringify(supabaseRpc.mock.calls[0])).not.toContain("select=symbol,country");

    // El summary deriva los *Pct sobre uniqueSymbols (igual que antes con pct()).
    expect(body.summary).toEqual({
      uniqueSymbols: 1200,
      fresh: 900,
      freshPct: 75, // round(900/1200*100)
      qualityOk: 800,
      qualityPct: 67, // round(800/1200*100)
      rankingEligible: 600,
      rankingEligiblePct: 50,
      actionable: 600,
      actionablePct: 50,
      avgCoverageScore: 71.2,
      avgTotalScore: 84.5,
      latestScanAt: "2026-07-10T10:00:00.000Z",
    });
    expect(body.byCountry).toHaveLength(1);
    expect(body.bySector).toHaveLength(1);
    expect(body.window.rowsRead).toBe(4000);
    expect(body.legalMode).toBe("derived-aggregate-only");
  });

  it("includeTop=1 propaga el flag a la RPC y ajusta legalMode", async () => {
    supabaseRpc.mockResolvedValue({
      rowsRead: 10, uniqueSymbols: 5, fresh: 5, qualityOk: 5, rankingEligible: 5, actionable: 5,
      avgCoverageScore: 90, avgTotalScore: 80, latestScanAt: "2026-07-10T10:00:00.000Z",
      byCountry: [{ key: "US", uniqueSymbols: 5, fresh: 5, freshPct: 100, qualityOk: 5, rankingEligible: 5, actionable: 5, avgCoverageScore: 90, avgTotalScore: 80, topSymbols: [{ symbol: "AAA", score: 88, fresh: true, coverage: 90 }] }],
      bySector: [],
    });

    const res = await GET(buildRequest("?includeTop=1"));
    const body = await res.json();

    expect(supabaseRpc.mock.calls[0][1].p_include_top).toBe(true);
    expect(body.legalMode).toBe("derived-aggregate-with-limited-top-samples");
    expect(body.byCountry[0].topSymbols).toEqual([{ symbol: "AAA", score: 88, fresh: true, coverage: 90 }]);
  });

  it("RPC lanza → 500 con el error (sin degradar a fallback parcial)", async () => {
    supabaseRpc.mockRejectedValue(new Error("scan coverage breakdown unavailable"));
    const res = await GET(buildRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("scan coverage breakdown unavailable");
  });
});
