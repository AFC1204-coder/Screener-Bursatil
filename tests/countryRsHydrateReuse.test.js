import { beforeEach, describe, expect, it, vi } from "vitest";

const { readGlobalRsForSymbols } = vi.hoisted(() => ({
  readGlobalRsForSymbols: vi.fn(async (symbols = []) => ({
    configured: true,
    bySymbol: new Map(symbols.map((symbol) => [symbol, {
      available: true,
      rsRating: 50,
      rsRaw: 0.1,
      rank: 100,
      sampleSize: 3000,
      asOf: "2026-08-01",
      weekKey: "2026-W31",
      engineVersion: "statsedge-us-equity-rs-v1",
    }])),
  })),
}));

vi.mock("@/lib/globalRs", () => ({
  readGlobalRsForSymbols,
  exclusionReasonText: (code) => code,
}));

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest: vi.fn(async () => []),
  supabaseConfig: () => ({ url: "https://example.supabase.co", key: "k", ownerId: "personal", configured: true, missing: [] }),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  toDate: (value) => String(value || "").slice(0, 10),
}));

import { attachWeeklyCountryRs } from "@/lib/countryRs";
import { readCountryRsForSymbols } from "@/lib/countryRsHydrate";
import {
  PRIVATE_GLOBAL_RS_ENGINE_VERSION,
  US_COUNTRY_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";

const US_ENTRY = {
  available: true,
  rsRating: 72,
  rsRaw: 0.42,
  rank: 18,
  sampleSize: 312,
  asOf: "2026-08-01",
  weekKey: "2026-W31",
  engineVersion: US_COUNTRY_RS_ENGINE_VERSION,
};

const GLOBAL_PRIVATE_ENTRY = {
  available: true,
  rsRating: 83,
  rsRaw: 0.61,
  rank: 9,
  sampleSize: 4868,
  asOf: "2026-08-01",
  weekKey: "2026-W31",
  engineVersion: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
};

describe("readCountryRsForSymbols · reuse US global map", () => {
  beforeEach(() => {
    readGlobalRsForSymbols.mockClear();
  });

  it("reutiliza entradas US del mapa global cuando engine_version coincide", async () => {
    const reuseGlobalRsBySymbol = new Map([
      ["NVDA", US_ENTRY],
      ["AAPL", US_ENTRY],
    ]);
    const result = await readCountryRsForSymbols(["NVDA", "AAPL"], { reuseGlobalRsBySymbol });
    expect(readGlobalRsForSymbols).not.toHaveBeenCalled();
    expect(result.bySymbol.get("NVDA")).toEqual(US_ENTRY);
    expect(result.bySymbol.get("AAPL")).toEqual(US_ENTRY);
  });

  it("no reutiliza entradas con engine distinto y pide bulkSnapshot US", async () => {
    const reuseGlobalRsBySymbol = new Map([["NVDA", GLOBAL_PRIVATE_ENTRY]]);
    await readCountryRsForSymbols(["NVDA"], { reuseGlobalRsBySymbol });
    expect(readGlobalRsForSymbols).toHaveBeenCalledTimes(1);
    expect(readGlobalRsForSymbols).toHaveBeenCalledWith(["NVDA"], {
      engineVersion: US_COUNTRY_RS_ENGINE_VERSION,
      bulkSnapshot: true,
    });
  });

  it("no reutiliza exclusiones sin engineVersion (evita colar private global)", async () => {
    const reuseGlobalRsBySymbol = new Map([["NVDA", {
      available: false,
      reason: "Fuera del ranking semanal",
      exclusionReason: "not-ranked",
    }]]);
    await readCountryRsForSymbols(["NVDA"], { reuseGlobalRsBySymbol });
    expect(readGlobalRsForSymbols).toHaveBeenCalledTimes(1);
    expect(readGlobalRsForSymbols).toHaveBeenCalledWith(["NVDA"], {
      engineVersion: US_COUNTRY_RS_ENGINE_VERSION,
      bulkSnapshot: true,
    });
  });

  it("attachWeeklyCountryRs produce mismos weeklyCountryRs* con reuse vs re-read", async () => {
    const row = { symbol: "NVDA", country: "US" };
    const reuseGlobalRsBySymbol = new Map([["NVDA", US_ENTRY]]);
    const reused = await readCountryRsForSymbols(["NVDA"], { reuseGlobalRsBySymbol });
    readGlobalRsForSymbols.mockClear();
    readGlobalRsForSymbols.mockResolvedValueOnce({ configured: true, bySymbol: new Map([["NVDA", US_ENTRY]]) });
    const reread = await readCountryRsForSymbols(["NVDA"]);
    const fromReuse = attachWeeklyCountryRs(row, reused.bySymbol);
    const fromReread = attachWeeklyCountryRs(row, reread.bySymbol);
    expect(fromReuse).toEqual(fromReread);
    expect(fromReuse.weeklyCountryRsRating).toBe(72);
    expect(fromReuse.weeklyCountryRsEngineVersion).toBe(US_COUNTRY_RS_ENGINE_VERSION);
  });
});
