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

vi.mock("@/lib/countryRsHydrate", () => ({
  attachWeeklyCountryRs: (row) => row,
  readCountryRsForSymbols,
}));

vi.mock("@/lib/themeRsHydrate", () => ({
  attachWeeklyThemeRs: (row) => row,
  readThemeRsForSymbols,
}));

vi.mock("@/lib/fundamentalsCache", () => ({
  attachCachedMarketCap: (row) => row,
  readMarketCapForSymbols: vi.fn(async () => ({ configured: true, bySymbol: new Map() })),
}));

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");

const SCAN_ID = "11111111-2222-3333-4444-555555555555";

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
    clearScansApiCache();
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "scans") return [scanRow(1)];
      if (path === "scan_results") return [{
        scan_id: SCAN_ID,
        rank_index: 1,
        symbol: "AAPL",
        raw: { symbol: "AAPL" },
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
  });

  it("?hydrateRs=1 hidrata extended", async () => {
    const response = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=500&hydrateRs=1"));
    const payload = await response.json();
    expect(payload.rsHydration).toBe("extended");
    expect(readCountryRsForSymbols).toHaveBeenCalled();
    expect(readThemeRsForSymbols).toHaveBeenCalled();
  });
});
