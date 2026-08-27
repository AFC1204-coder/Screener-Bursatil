// Tests de lib/materializedScanLookup.js y GET /api/scans?anchor=markets
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.fn();

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
  toTimestamp: (value) => (value ? new Date(value).toISOString() : new Date().toISOString()),
}));

const {
  marketsSettingsMatch,
  readLatestMaterializedScanForMarkets,
  sortedMarketsForLookup,
} = await import("@/lib/materializedScanLookup");

function scanRow(localId, markets, rowCount, createdAt, status = "partial") {
  return {
    id: `id-${localId}`,
    local_id: localId,
    name: `Materialized scan ${markets.join(",")}`,
    preset: "materialized-cache",
    settings: { markets, progress: { status } },
    market_score: null,
    market_regime: null,
    row_count: rowCount,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
  };
}

const NIGHTLY_US = scanRow("materialized:US:2026-08-26:o0:l5609", ["US"], 3319, "2026-08-26T03:57:58.557Z");
const SCAN_CA = scanRow("materialized:CA:2026-08-26:o0:l100", ["CA"], 22, "2026-08-26T22:00:00.000Z");
const SCAN_TW_FAILED = scanRow("materialized:TW:2026-08-25:o0:l0", ["TW"], 0, "2026-08-25T22:00:00.000Z", "failed");
const SCAN_HK_SMALL = scanRow("materialized:HK:2026-08-21:o0:l12", ["HK"], 2, "2026-08-21T22:00:00.000Z");

function configureBackend(scans) {
  supabaseRequest.mockImplementation(async (path, options) => {
    if (path !== "scans") return [];
    const query = decodeURIComponent(String(options?.query || ""));
    let filtered = scans.filter((scan) => scan.preset === "materialized-cache" && !scan.deleted_at);
    if (query.includes("settings->markets=cs.")) {
      const marketMatch = query.match(/settings->markets=cs\.(\[[^\]]+\])/);
      if (marketMatch) {
        const wanted = JSON.parse(marketMatch[1]);
        filtered = filtered.filter((scan) => {
          const stored = scan.settings?.markets || [];
          return wanted.every((code) => stored.includes(code));
        });
      }
    }
    return filtered.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  });
}

describe("materializedScanLookup · matching de mercados", () => {
  it("normaliza y ordena mercados para lookup", () => {
    expect(sortedMarketsForLookup(["JP", "CA"])).toEqual(["CA", "JP"]);
    expect(marketsSettingsMatch(["FI", "DK", "NO", "SE"], ["SE", "FI", "NO", "DK"])).toBe(true);
  });
});

describe("readLatestMaterializedScanForMarkets", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("devuelve el scan CA aunque exista un US más reciente en la base", async () => {
    configureBackend([NIGHTLY_US, SCAN_CA]);

    const result = await readLatestMaterializedScanForMarkets(["CA"]);

    expect(result.scan?.localId).toBe("materialized:CA:2026-08-26:o0:l100");
    expect(result.scan?.rowCount).toBe(22);
    expect(result.reason).toBeNull();
  });

  it("TW failed → found false vía reason materialized-not-publishable", async () => {
    configureBackend([SCAN_TW_FAILED]);

    const result = await readLatestMaterializedScanForMarkets(["TW"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("materialized-not-publishable");
  });

  it("HK con pocas filas → insufficient-rows", async () => {
    configureBackend([SCAN_HK_SMALL]);

    const result = await readLatestMaterializedScanForMarkets(["HK"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("insufficient-rows");
    expect(result.rejectedScan?.rowCount).toBe(2);
  });
});

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");
const { MARKETS_ANCHOR } = await import("@/lib/scanLocalId");

describe("GET /api/scans?anchor=markets", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
    clearScansApiCache();
  });

  it("CA gana sobre US más reciente cuando anchor=markets&markets=CA", async () => {
    configureBackend([NIGHTLY_US, SCAN_CA]);

    const payload = await (await GET(new Request(`https://statsedge.test/api/scans?includeRows=0&limit=1&rowsLimit=100&anchor=${MARKETS_ANCHOR}&markets=CA`))).json();

    expect(payload.markets).toMatchObject({ found: true, rowCount: 22, requested: ["CA"] });
    expect(payload.scans).toHaveLength(1);
    expect(payload.scans[0].id).toBe("materialized:CA:2026-08-26:o0:l100");
  });

  it("TW failed → found false, sin filas", async () => {
    configureBackend([SCAN_TW_FAILED]);

    const payload = await (await GET(new Request(`https://statsedge.test/api/scans?includeRows=0&limit=1&rowsLimit=100&anchor=${MARKETS_ANCHOR}&markets=TW`))).json();

    expect(payload.scans).toEqual([]);
    expect(payload.markets).toMatchObject({ found: false, reason: "materialized-not-publishable" });
  });
});
