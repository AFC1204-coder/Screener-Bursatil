import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.fn();

vi.mock("@/lib/globalRs", () => ({
  attachWeeklyRs: (row) => row,
  readGlobalRsForSymbols: vi.fn(async () => ({ configured: true, bySymbol: new Map() })),
  exclusionReasonText: () => "",
}));

vi.mock("@/lib/countryRsHydrate", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readCountryRsForSymbols: vi.fn(async () => ({ configured: true, bySymbol: new Map() })) };
});

vi.mock("@/lib/themeRsHydrate", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readThemeRsForSymbols: vi.fn(async () => ({ configured: true, bySymbol: new Map() })) };
});

vi.mock("@/lib/fundamentalsCache", () => ({
  attachCachedMarketCap: (row) => row,
  readMarketCapForSymbols: vi.fn(async () => ({ configured: true, bySymbol: new Map() })),
}));

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

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");

const SCAN_ID = "11111111-2222-3333-4444-555555555555";

function scanRow() {
  return {
    id: SCAN_ID,
    local_id: "server-scan-1",
    name: "Scan",
    preset: "balanced",
    settings: {},
    market_score: null,
    market_regime: null,
    row_count: 80,
    created_at: "2026-08-12T23:29:35.023Z",
    updated_at: "2026-08-12T23:29:35.023Z",
    deleted_at: null,
  };
}

function resultRows() {
  return Array.from({ length: 80 }, (_, index) => ({
    scan_id: SCAN_ID,
    rank_index: index + 1,
    symbol: `S${index}`,
    company_name: `Company ${index}`,
    country: "US",
    sector: "Technology",
    industry: "Software",
    theme: "",
    raw: { symbol: `S${index}`, country: "US" },
    metrics: { rsGlobalPct: index, chartPreview: Array.from({ length: 12 }, (__, j) => j) },
  }));
}

describe("GET /api/scans · transporte gzip", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
    clearScansApiCache();
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "scans") return [scanRow()];
      if (path === "scan_results") return resultRows();
      return [];
    });
  });

  it("sin Accept-Encoding el JSON lógico se parsea y no declara Content-Encoding", async () => {
    const response = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=80"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.projection).toBe("compact");
    expect(payload.scans[0].rows).toHaveLength(80);
  });

  it("con gzip el wire se reduce y el JSON descomprimido es el mismo contrato", async () => {
    const identity = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=80"));
    const logical = await identity.json();

    const compressed = await GET(new Request("https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=80", {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    }));
    expect(compressed.status).toBe(200);
    expect(compressed.headers.get("content-encoding")).toBe("gzip");
    const wire = Buffer.from(await compressed.arrayBuffer());
    const decoded = JSON.parse(gunzipSync(wire).toString("utf8"));
    expect(wire.length).toBeLessThan(Buffer.byteLength(JSON.stringify(logical)));
    expect(decoded).toEqual(logical);
    expect(decoded.scans[0].rows.map((row) => row.symbol)).toEqual(logical.scans[0].rows.map((row) => row.symbol));
  });
});
