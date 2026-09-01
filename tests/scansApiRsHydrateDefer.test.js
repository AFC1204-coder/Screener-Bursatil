import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.fn();
const readCountryRsForSymbols = vi.fn(async () => ({ configured: true, bySymbol: new Map() }));
const readThemeRsForSymbols = vi.fn(async () => ({ configured: true, bySymbol: new Map() }));
const readGlobalRsForSymbols = vi.fn(async () => ({ configured: true, bySymbol: new Map() }));

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest,
  supabaseRpc: vi.fn(async () => []),
  supabaseConfig: () => ({ url: "https://example.supabase.co", key: "k", ownerId: "personal", configured: true, missing: [] }),
  requirePersistenceAuth: () => null,
  disabledPayload: () => ({ configured: false, skipped: true, missing: [], message: "Supabase no configurado" }),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  textOrNull: (value) => {
    const text = String(value || "").trim();
    return text || null;
  },
  toTimestamp: (value) => {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  },
}));

vi.mock("@/lib/globalRs", () => ({
  attachWeeklyRs: (row) => row,
  readGlobalRsForSymbols,
  exclusionReasonText: () => "",
}));

vi.mock("@/lib/countryRsHydrate", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readCountryRsForSymbols };
});

vi.mock("@/lib/themeRsHydrate", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readThemeRsForSymbols };
});

vi.mock("@/lib/fundamentalsCache", () => ({
  attachCachedMarketCap: (row) => row,
  readMarketCapForSymbols: vi.fn(async () => ({ configured: true, bySymbol: new Map() })),
}));

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");

const SCAN_ID = "11111111-2222-3333-4444-555555555555";

const COUNTRY_RS_ENTRY = {
  available: true,
  rsRating: 72,
  rsRaw: 0.42,
  rank: 18,
  sampleSize: 312,
  asOf: "2026-08-01",
  weekKey: "2026-W31",
  engineVersion: "statsedge-private-country-rs-us-v1",
};

const THEME_RS_ENTRY = {
  available: true,
  rsRating: 84,
  rsRaw: 0.55,
  rank: 9,
  sampleSize: 142,
  asOf: "2026-08-01",
  weekKey: "2026-W31",
  engineVersion: "statsedge-private-theme-rs-usd-semis-fotonica-v1",
  themeKey: "Semis / fotonica",
};

function scanRow(rowCount = 1) {
  return {
    id: SCAN_ID,
    local_id: "server-scan-1",
    name: "Scan",
    preset: "balanced",
    settings: {},
    market_score: null,
    market_regime: null,
    row_count: rowCount,
    created_at: "2026-08-12T23:29:35.023Z",
    updated_at: "2026-08-12T23:29:35.023Z",
    deleted_at: null,
  };
}

describe("GET /api/scans · PERF-NAC defer RS país/tema", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
    readCountryRsForSymbols.mockClear();
    readThemeRsForSymbols.mockClear();
    readGlobalRsForSymbols.mockClear();
    readCountryRsForSymbols.mockResolvedValue({
      configured: true,
      bySymbol: new Map([["NVDA", COUNTRY_RS_ENTRY]]),
    });
    readThemeRsForSymbols.mockResolvedValue({
      configured: true,
      bySymbol: new Map([["NVDA", THEME_RS_ENTRY]]),
    });
    clearScansApiCache();
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "scans") return [scanRow(1)];
      if (path === "scan_results") return [{
        scan_id: SCAN_ID,
        rank_index: 1,
        symbol: "NVDA",
        country: "US",
        sector: "Technology",
        industry: "Semiconductors",
        theme: "Semis / fotonica",
        raw: {
          symbol: "NVDA",
          country: "US",
          sector: "Technology",
          industry: "Semiconductors",
          theme: "Semis / fotonica",
        },
      }];
      return [];
    });
  });

  it("compacto no hidrata país/tema y expone rsHydration=core", async () => {
    const response = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=500"));
    const payload = await response.json();
    expect(payload.rsHydration).toBe("core");
    expect(readGlobalRsForSymbols).toHaveBeenCalled();
    expect(readCountryRsForSymbols).not.toHaveBeenCalled();
    expect(readThemeRsForSymbols).not.toHaveBeenCalled();

    const row = payload.scans[0].rows[0];
    expect(row.weeklyCountryRsAvailable).toBe(false);
    expect(row.weeklyCountryRsRating).toBeNull();
    expect(row.weeklyThemeRsAvailable).toBe(false);
    expect(row.weeklyThemeRsRating).toBeNull();
  });

  it("?hydrateRs=1 hidrata extended y rellena weeklyCountryRsRating / weeklyThemeRsRating", async () => {
    const response = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=500&hydrateRs=1"));
    const payload = await response.json();
    expect(payload.rsHydration).toBe("extended");
    expect(readCountryRsForSymbols).toHaveBeenCalled();
    expect(readThemeRsForSymbols).toHaveBeenCalled();

    const row = payload.scans[0].rows[0];
    expect(row.weeklyCountryRsAvailable).toBe(true);
    expect(row.weeklyCountryRsRating).toBe(72);
    expect(row.weeklyThemeRsAvailable).toBe(true);
    expect(row.weeklyThemeRsRating).toBe(84);
  });
});
