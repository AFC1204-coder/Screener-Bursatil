import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest,
  supabaseConfig: () => ({ url: "https://example.supabase.co", key: "k", ownerId: "personal", configured: true, missing: [] }),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  toDate: (value) => String(value || "").slice(0, 10),
}));

import { readThemeRsForSymbols } from "@/lib/themeRsHydrate.js";
import { themeRsEngineVersion } from "@/lib/rsEngines.js";

const ENGINE = themeRsEngineVersion("Semis / fotonica");

function snapshotRows(symbols = []) {
  return symbols.map((symbol, index) => ({
    symbol,
    snapshot_date: "2026-09-12",
    week_key: "2026-W37",
    engine_version: ENGINE,
    rank_index: index + 1,
    rs_rating: 70 + index,
    rs_raw: 0.5,
    sample_size: 120,
    metrics: {},
  }));
}

describe("readThemeRsForSymbols · chunks amplios", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("agrupa símbolos del mismo engine en un solo chunk cuando caben en el tope PostgREST", async () => {
    const symbols = Array.from({ length: 200 }, (_, i) => `SYM${i}`);
    const rows = symbols.map((symbol) => ({
      symbol,
      sector: "Technology",
      industry: "Semiconductors",
      theme: "Semis / fotonica",
    }));
    const rowBySymbol = new Map(rows.map((row) => [row.symbol, row]));

    supabaseRequest.mockImplementation(async (_table, opts = {}) => {
      const query = String(opts.query || "");
      if (query.includes("symbol=in.")) {
        const match = /symbol=in\.\(([^)]+)\)/.exec(query);
        const requested = match ? match[1].split(",").map(decodeURIComponent) : [];
        expect(requested.length).toBe(200);
        expect(query).toContain(`limit=${200 * 3}`);
        return snapshotRows(requested);
      }
      return [];
    });

    const result = await readThemeRsForSymbols(symbols, { rowBySymbol });
    expect(result.bySymbol.get("SYM0")?.available).toBe(true);
    expect(result.bySymbol.get("SYM0")?.rsRating).toBe(70);
    expect(supabaseRequest).toHaveBeenCalledTimes(1);
  });

  it("parte en dos chunks cuando el engine supera el tope de 333 símbolos", async () => {
    const symbols = Array.from({ length: 400 }, (_, i) => `SYM${i}`);
    const rows = symbols.map((symbol) => ({
      symbol,
      sector: "Technology",
      industry: "Semiconductors",
      theme: "Semis / fotonica",
    }));
    const rowBySymbol = new Map(rows.map((row) => [row.symbol, row]));
    const chunkSizes = [];

    supabaseRequest.mockImplementation(async (_table, opts = {}) => {
      const query = String(opts.query || "");
      if (query.includes("symbol=in.")) {
        const match = /symbol=in\.\(([^)]+)\)/.exec(query);
        const requested = match ? match[1].split(",").map(decodeURIComponent) : [];
        chunkSizes.push(requested.length);
        return snapshotRows(requested);
      }
      return [];
    });

    await readThemeRsForSymbols(symbols, { rowBySymbol });
    expect(chunkSizes).toEqual([333, 67]);
    expect(supabaseRequest).toHaveBeenCalledTimes(2);
  });
});
