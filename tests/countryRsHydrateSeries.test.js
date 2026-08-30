import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: () => ({
    configured: true,
    ownerId: "personal",
    url: "https://example.supabase.co",
    key: "test-key",
    missing: [],
  }),
  supabaseRequest: vi.fn(),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  toDate: (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  },
}));

vi.mock("@/lib/globalRs", () => ({
  exclusionReasonText: () => "",
  readGlobalRsForSymbols: vi.fn(),
}));

import { supabaseRequest } from "@/lib/supabaseServer";
import { readCountryRsSeriesForSymbol } from "@/lib/countryRsHydrate";
import { US_COUNTRY_RS_ENGINE_VERSION } from "@/lib/rsEngines";

describe("readCountryRsSeriesForSymbol", () => {
  it("dedupe por weekKey: dos filas W32 conservan la de snapshot_date más reciente", async () => {
    supabaseRequest.mockResolvedValueOnce([
      {
        symbol: "AAPL",
        snapshot_date: "2026-08-29",
        week_key: "2026-W35",
        engine_version: US_COUNTRY_RS_ENGINE_VERSION,
        rank_index: 120,
        rs_rating: 64,
        rs_raw: 50,
        sample_size: 4200,
        metrics: {},
        base_currency: "USD",
      },
      {
        symbol: "AAPL",
        snapshot_date: "2026-08-08",
        week_key: "2026-W32",
        engine_version: US_COUNTRY_RS_ENGINE_VERSION,
        rank_index: 80,
        rs_rating: 70,
        rs_raw: 55,
        sample_size: 4200,
        metrics: {},
        base_currency: "USD",
      },
      {
        symbol: "AAPL",
        snapshot_date: "2026-08-01",
        week_key: "2026-W32",
        engine_version: US_COUNTRY_RS_ENGINE_VERSION,
        rank_index: 90,
        rs_rating: 80,
        rs_raw: 60,
        sample_size: 4200,
        metrics: {},
        base_currency: "USD",
      },
    ]);

    const result = await readCountryRsSeriesForSymbol("AAPL");

    expect(result.series).toHaveLength(2);
    expect(result.series.map((p) => p.weekKey)).toEqual(["2026-W32", "2026-W35"]);
    expect(result.series[0].rsRating).toBe(70);
    expect(result.latest).toMatchObject({ weekKey: "2026-W35", rsRating: 64 });
  });
});
