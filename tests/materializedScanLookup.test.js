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
const SCAN_KR_SMALL = scanRow("materialized:KR:2026-08-21:o0:l4", ["KR"], 4, "2026-08-21T22:00:00.000Z");
const SCAN_IN_SMALL = scanRow("materialized:IN:2026-08-21:o0:l8", ["IN"], 8, "2026-08-21T22:00:00.000Z");
const SCAN_CA_SMALL = scanRow("materialized:CA:2026-08-21:o0:l10", ["CA"], 10, "2026-08-21T22:00:00.000Z");
const SCAN_GB_SMALL = scanRow("materialized:GB:2026-08-21:o0:l8", ["GB"], 8, "2026-08-21T22:00:00.000Z");
const SCAN_GB = scanRow("materialized:GB:2026-08-26:o0:l18", ["GB"], 18, "2026-08-26T22:15:00.000Z");
const SCAN_JP_SMALL = scanRow("materialized:JP:2026-08-21:o0:l8", ["JP"], 8, "2026-08-21T22:00:00.000Z");
const SCAN_DK_SMALL = scanRow("materialized:DK:2026-08-21:o0:l6", ["DK"], 6, "2026-08-21T22:00:00.000Z");
const SCAN_HK = scanRow("materialized:HK:2026-08-26:o0:l23", ["HK"], 23, "2026-08-26T22:00:00.000Z");
const SCAN_AU = scanRow("materialized:AU:2026-08-26:o0:l15", ["AU"], 15, "2026-08-26T22:30:00.000Z");

function configureBackend(scans) {
  supabaseRequest.mockImplementation(async (path, options) => {
    if (path !== "scans") return [];
    const query = decodeURIComponent(String(options?.query || ""));
    let filtered = scans.filter((scan) => !scan.deleted_at);
    if (query.includes("local_id=like.")) {
      filtered = filtered.filter((scan) => scan.local_id?.startsWith("materialized:US:") && !scan.local_id.startsWith("test:"));
      return filtered.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 1);
    }
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

  it("KR con pocas filas → insufficient-rows", async () => {
    configureBackend([SCAN_KR_SMALL]);

    const result = await readLatestMaterializedScanForMarkets(["KR"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("insufficient-rows");
    expect(result.rejectedScan?.rowCount).toBe(4);
  });

  it("IN con pocas filas → insufficient-rows", async () => {
    configureBackend([SCAN_IN_SMALL]);

    const result = await readLatestMaterializedScanForMarkets(["IN"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("insufficient-rows");
    expect(result.rejectedScan?.rowCount).toBe(8);
  });

  it("CA con pocas filas → insufficient-rows", async () => {
    configureBackend([SCAN_CA_SMALL]);

    const result = await readLatestMaterializedScanForMarkets(["CA"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("insufficient-rows");
    expect(result.rejectedScan?.rowCount).toBe(10);
  });

  it("GB con pocas filas → insufficient-rows", async () => {
    configureBackend([SCAN_GB_SMALL]);

    const result = await readLatestMaterializedScanForMarkets(["GB"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("insufficient-rows");
    expect(result.rejectedScan?.rowCount).toBe(8);
  });

  it("GB con ≥15 filas → publicable", async () => {
    configureBackend([SCAN_GB]);

    const result = await readLatestMaterializedScanForMarkets(["GB"]);

    expect(result.scan?.localId).toBe("materialized:GB:2026-08-26:o0:l18");
    expect(result.reason).toBeNull();
  });

  it("JP con pocas filas → insufficient-rows", async () => {
    configureBackend([SCAN_JP_SMALL]);

    const result = await readLatestMaterializedScanForMarkets(["JP"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("insufficient-rows");
    expect(result.rejectedScan?.rowCount).toBe(8);
  });

  it("DK con pocas filas → insufficient-rows", async () => {
    configureBackend([SCAN_DK_SMALL]);

    const result = await readLatestMaterializedScanForMarkets(["DK"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("insufficient-rows");
    expect(result.rejectedScan?.rowCount).toBe(6);
  });

  it("HK+AU publicables → scan fusionado con metadatos honestos", async () => {
    configureBackend([SCAN_HK, SCAN_AU]);

    const result = await readLatestMaterializedScanForMarkets(["HK", "AU"]);

    expect(result.merged).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.scan?.source).toBe("merged-materialized");
    expect(result.scan?.rowCount).toBe(38);
    expect(result.scan?.markets).toEqual(["AU", "HK"]);
    expect(result.row?.settings?.markets).toEqual(["AU", "HK"]);
    expect(result.row?.settings?.source).toBe("merged-materialized");
    expect(result.sourceScans).toHaveLength(2);
  });

  it("HK+TW → partial-markets sin fusionar (TW no publicable)", async () => {
    configureBackend([SCAN_HK, SCAN_TW_FAILED]);

    const result = await readLatestMaterializedScanForMarkets(["HK", "TW"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("partial-markets");
    expect(result.missingMarkets).toEqual(["TW"]);
  });

  it("US solo → nocturno US (no materializado por settings)", async () => {
    configureBackend([NIGHTLY_US, SCAN_CA]);

    const result = await readLatestMaterializedScanForMarkets(["US"]);

    expect(result.scan?.localId).toBe("materialized:US:2026-08-26:o0:l5609");
    expect(result.scan?.source).toBe("nightly-us");
    expect(result.reason).toBeNull();
  });

  it("US+HK publicables → fusión híbrida nocturno+materializado", async () => {
    configureBackend([NIGHTLY_US, SCAN_HK]);

    const result = await readLatestMaterializedScanForMarkets(["US", "HK"]);

    expect(result.merged).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.scan?.source).toBe("merged-nightly-materialized");
    expect(result.scan?.rowCount).toBe(3319 + 23);
    expect(result.scan?.markets).toEqual(["HK", "US"]);
    expect(result.row?.settings?.source).toBe("merged-nightly-materialized");
    expect(result.sourceScans).toHaveLength(2);
  });

  it("US+HK sin nocturno → partial-markets con US en faltantes", async () => {
    configureBackend([SCAN_HK]);

    const result = await readLatestMaterializedScanForMarkets(["US", "HK"]);

    expect(result.scan).toBeNull();
    expect(result.reason).toBe("partial-markets");
    expect(result.missingMarkets).toEqual(["US"]);
  });
});

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");
const { MARKETS_ANCHOR } = await import("@/lib/scanLocalId");

function scanResultRow(scanId, symbol, rankIndex) {
  return {
    scan_id: scanId,
    rank_index: rankIndex,
    symbol,
    company_name: symbol,
    country: symbol.endsWith(".HK") ? "HK" : "AU",
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
    if (query.includes("local_id=like.")) {
      filtered = filtered.filter((scan) => scan.local_id?.startsWith("materialized:US:") && !scan.local_id.startsWith("test:"));
      return filtered.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 1);
    }
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

  it("HK+AU fusiona filas de ambos materializados", async () => {
    const hkResults = Array.from({ length: 23 }, (_, index) => scanResultRow(SCAN_HK.id, `0700${index}.HK`, index + 1));
    const auResults = Array.from({ length: 15 }, (_, index) => scanResultRow(SCAN_AU.id, `BHP${index}.AX`, index + 1));
    configureBackendWithResults([SCAN_HK, SCAN_AU], {
      [SCAN_HK.id]: hkResults,
      [SCAN_AU.id]: auResults,
    });

    const payload = await (await GET(new Request(`https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=100&anchor=${MARKETS_ANCHOR}&markets=HK,AU`))).json();

    expect(payload.markets).toMatchObject({
      found: true,
      merged: true,
      source: "merged-materialized",
      requested: ["AU", "HK"],
      rowCount: 38,
    });
    expect(payload.scans).toHaveLength(1);
    expect(payload.scans[0].rows).toHaveLength(38);
    expect(payload.scans[0].settings?.markets).toEqual(["AU", "HK"]);
  });

  it("HK+TW → partial-markets, sin sustituir tabla", async () => {
    configureBackend([SCAN_HK, SCAN_TW_FAILED]);

    const payload = await (await GET(new Request(`https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=100&anchor=${MARKETS_ANCHOR}&markets=HK,TW`))).json();

    expect(payload.scans).toEqual([]);
    expect(payload.markets).toMatchObject({
      found: false,
      reason: "partial-markets",
      missingMarkets: ["TW"],
    });
  });

  it("US+HK fusiona nocturno US con materializado HK", async () => {
    const usResults = Array.from({ length: 10 }, (_, index) => scanResultRow(NIGHTLY_US.id, `SYM${index}`, index + 1));
    const hkResults = Array.from({ length: 5 }, (_, index) => scanResultRow(SCAN_HK.id, `0700${index}.HK`, index + 1));
    configureBackendWithResults([NIGHTLY_US, SCAN_HK], {
      [NIGHTLY_US.id]: usResults,
      [SCAN_HK.id]: hkResults,
    });

    const payload = await (await GET(new Request(`https://statsedge.test/api/scans?includeRows=1&limit=1&rowsLimit=100&anchor=${MARKETS_ANCHOR}&markets=US,HK`))).json();

    expect(payload.markets).toMatchObject({
      found: true,
      merged: true,
      source: "merged-nightly-materialized",
      requested: ["HK", "US"],
      rowCount: 15,
    });
    expect(payload.scans).toHaveLength(1);
    expect(payload.scans[0].rows).toHaveLength(15);
    expect(payload.scans[0].settings?.markets).toEqual(["HK", "US"]);
  });
});
