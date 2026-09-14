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
const { POST } = await import("@/app/api/scans/chart-preview/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");

const SCAN_ID = "11111111-2222-3333-4444-555555555555";
const preview = [
  { date: "2026-01-01", close: 10, sma50: 9.5, sma200: 9, volume: 1000 },
  { date: "2026-01-02", close: 11, sma50: 9.6, sma200: 9.1, volume: 1100 },
];

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

function resultRow(symbol = "AAA") {
  return {
    scan_id: SCAN_ID,
    rank_index: 1,
    symbol,
    company_name: "Acme",
    country: "US",
    sector: "Tech",
    industry: "Software",
    theme: "Software",
    total_score: 70,
    weinstein_score: 60,
    minervini_score: 55,
    risk_score: 40,
    rs_rating: 80,
    raw: {},
    metrics: { symbol, price: 10, chartPreview: preview },
  };
}

describe("GET /api/scans · chartPreview defer", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
    clearScansApiCache();
  });

  it("compacto default omite chartPreview y marca transport deferred", async () => {
    supabaseRequest.mockImplementation(async (table) => {
      if (table === "scans") return [scanRow()];
      if (table === "scan_results") return [resultRow()];
      return [];
    });
    const response = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=500"));
    const body = await response.json();
    expect(body.chartPreviewTransport).toBe("deferred");
    expect(body.scans[0].rows[0].chartPreview).toBeUndefined();
    expect(body.scans[0].chartPreviewTransport).toBe("deferred");
  });

  it("?chartPreview=1 conserva inline", async () => {
    supabaseRequest.mockImplementation(async (table) => {
      if (table === "scans") return [scanRow()];
      if (table === "scan_results") return [resultRow()];
      return [];
    });
    const response = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=500&chartPreview=1"));
    const body = await response.json();
    expect(body.chartPreviewTransport).toBe("inline");
    expect(body.scans[0].rows[0].chartPreview).toEqual(preview);
  });
});

describe("POST /api/scans/chart-preview", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("devuelve previews compactos por símbolo", async () => {
    supabaseRequest.mockResolvedValueOnce([resultRow("AAA")]);
    const response = await POST(new Request("https://statsedge.test/api/scans/chart-preview", {
      method: "POST",
      body: JSON.stringify({ scanId: SCAN_ID, symbols: ["AAA"] }),
    }));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.previews.AAA).toEqual(preview);
  });
});
