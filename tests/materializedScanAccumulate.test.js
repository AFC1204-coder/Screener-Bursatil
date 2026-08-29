// INT-3d — acumulación de materializados HK/CA en mesa
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  readLatestMaterializedScanForMarkets,
  readLatestSingleMarketMaterializedScan,
  materializedAccumulateNights,
} = await import("@/lib/materializedScanLookup");

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");
const { MARKETS_ANCHOR } = await import("@/lib/scanLocalId");

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

const HK_NIGHT_1 = scanRow("materialized:HK:2026-08-24:o0:l20", ["HK"], 20, "2026-08-24T22:00:00.000Z");
const HK_NIGHT_2 = scanRow("materialized:HK:2026-08-25:o0:l18", ["HK"], 18, "2026-08-25T22:00:00.000Z");
const HK_NIGHT_3 = scanRow("materialized:HK:2026-08-26:o0:l23", ["HK"], 23, "2026-08-26T22:00:00.000Z");
const HK_NIGHT_SMALL = scanRow("materialized:HK:2026-08-20:o0:l8", ["HK"], 8, "2026-08-20T22:00:00.000Z");
const CA_NIGHT_1 = scanRow("materialized:CA:2026-08-25:o0:l16", ["CA"], 16, "2026-08-25T22:00:00.000Z");
const CA_NIGHT_2 = scanRow("materialized:CA:2026-08-26:o0:l22", ["CA"], 22, "2026-08-26T22:00:00.000Z");

function configureBackend(scans) {
  supabaseRequest.mockImplementation(async (path, options) => {
    if (path !== "scans") return [];
    const query = decodeURIComponent(String(options?.query || ""));
    let filtered = scans.filter((scan) => !scan.deleted_at);
    filtered = filtered.filter((scan) => scan.preset === "materialized-cache");
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

function scanResultRow(scanId, symbol, rankIndex) {
  return {
    scan_id: scanId,
    rank_index: rankIndex,
    symbol,
    company_name: symbol,
    country: "HK",
    sector: "Tech",
    industry: "Software",
    theme: null,
    total_score: 80,
    weinstein_score: 70,
    minervini_score: 75,
    risk_score: 20,
    rs_rating: 90,
    metrics: {},
    raw: {},
  };
}

function configureBackendWithResults(scans, resultsByScanId = {}) {
  supabaseRequest.mockImplementation(async (path, options) => {
    if (path === "scan_results") {
      const query = decodeURIComponent(String(options?.query || ""));
      const idMatch = query.match(/scan_id=in\.\(([^)]+)\)/);
      if (!idMatch) return [];
      const ids = idMatch[1].split(",");
      const rows = [];
      for (const id of ids) {
        rows.push(...(resultsByScanId[id] || []));
      }
      return rows.sort((a, b) => (a.rank_index || 0) - (b.rank_index || 0));
    }
    if (path !== "scans") return [];
    const query = decodeURIComponent(String(options?.query || ""));
    let filtered = scans.filter((scan) => !scan.deleted_at);
    filtered = filtered.filter((scan) => scan.preset === "materialized-cache");
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

describe("materializedScanAccumulate · lookup", () => {
  const previousNights = process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS;

  beforeEach(() => {
    supabaseRequest.mockReset();
    delete process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS;
  });

  afterEach(() => {
    if (previousNights === undefined) delete process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS;
    else process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS = previousNights;
  });

  it("HK con 3 noches publicables → acumulado sintético con metadatos", async () => {
    configureBackend([HK_NIGHT_1, HK_NIGHT_2, HK_NIGHT_3, HK_NIGHT_SMALL]);

    const result = await readLatestSingleMarketMaterializedScan(["HK"]);

    expect(result.accumulated).toBe(true);
    expect(result.sourceScans).toHaveLength(3);
    expect(result.scan?.source).toBe("accumulated-materialized");
    expect(result.row?.settings?.source).toBe("accumulated-materialized");
    expect(result.row?.settings?.accumulatedFrom).toHaveLength(3);
    expect(result.row?.settings?.accumulatedFrom?.[0]?.localId).toBe(HK_NIGHT_3.local_id);
    expect(result.scan?.accumulatedNights).toBe(3);
    expect(result.row?.local_id).toMatch(/^accumulated-materialized:HK:/);
  });

  it("N=1 → latest only sin acumular", async () => {
    process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS = "1";
    configureBackend([HK_NIGHT_1, HK_NIGHT_2, HK_NIGHT_3]);

    const result = await readLatestMaterializedScanForMarkets(["HK"]);

    expect(result.accumulated).toBeFalsy();
    expect(result.scan?.localId).toBe(HK_NIGHT_3.local_id);
    expect(result.scan?.rowCount).toBe(23);
    expect(materializedAccumulateNights()).toBe(1);
  });

  it("CA official-broad acumula con el mismo helper genérico", async () => {
    configureBackend([CA_NIGHT_1, CA_NIGHT_2]);

    const result = await readLatestMaterializedScanForMarkets(["CA"]);

    expect(result.accumulated).toBe(true);
    expect(result.sourceScans).toHaveLength(2);
    expect(result.scan?.source).toBe("accumulated-materialized");
  });
});

describe("GET /api/scans · HK acumulado", () => {
  const previousNights = process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS;

  beforeEach(() => {
    supabaseRequest.mockReset();
    clearScansApiCache();
    delete process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS;
  });

  afterEach(() => {
    if (previousNights === undefined) delete process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS;
    else process.env.STATSEDGE_MATERIALIZED_ACCUMULATE_NIGHTS = previousNights;
  });

  it("une filas de 3 noches HK con dedupe por símbolo (gana la noche más reciente)", async () => {
    const night1Rows = [
      scanResultRow(HK_NIGHT_1.id, "0700.HK", 1),
      scanResultRow(HK_NIGHT_1.id, "0005.HK", 2),
      scanResultRow(HK_NIGHT_1.id, "0388.HK", 3),
    ];
    const night2Rows = [
      scanResultRow(HK_NIGHT_2.id, "0700.HK", 1),
      scanResultRow(HK_NIGHT_2.id, "0941.HK", 2),
    ];
    const night3Rows = [
      scanResultRow(HK_NIGHT_3.id, "0700.HK", 1),
      scanResultRow(HK_NIGHT_3.id, "1299.HK", 2),
      scanResultRow(HK_NIGHT_3.id, "2318.HK", 3),
    ];
    configureBackendWithResults([HK_NIGHT_1, HK_NIGHT_2, HK_NIGHT_3], {
      [HK_NIGHT_1.id]: night1Rows,
      [HK_NIGHT_2.id]: night2Rows,
      [HK_NIGHT_3.id]: night3Rows,
    });

    const payload = await (await GET(new Request(`https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=100&anchor=${MARKETS_ANCHOR}&markets=HK`))).json();

    expect(payload.markets).toMatchObject({
      found: true,
      accumulated: true,
      source: "accumulated-materialized",
      accumulatedNights: 3,
    });
    expect(payload.scans).toHaveLength(1);
    const symbols = payload.scans[0].rows.map((row) => row.symbol).sort();
    expect(symbols).toEqual(["0005.HK", "0388.HK", "0700.HK", "0941.HK", "1299.HK", "2318.HK"]);
    expect(payload.scans[0].settings?.accumulatedFrom).toHaveLength(3);
    expect(payload.markets.rowCount).toBe(6);
  });
});
