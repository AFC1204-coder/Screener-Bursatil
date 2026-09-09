// GET /api/market-health — contrato refresh + persistencia de caché app_settings.
//
// Residual MH: Actualizar debe usar ?refresh=1; tras refresh el upsert debe
// dejar payload nuevo (no seguir sirviendo Aug-17 stale).

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls = [];
let cacheRow = null;

const stalePayload = {
  generatedAt: "2026-08-17T12:00:00.000Z",
  marketScore: 72,
  regime: { label: "Mercado constructivo pero selectivo" },
  breadthProxy: { indexes: 1, above50: 1, above200: 1, above30w: 1 },
  indexes: [{ symbol: "SPY", name: "S&P 500", lastDate: "2026-08-17", weight: 30, score: 72 }],
  sectorTape: [],
  weinsteinTape: { label: "Lectura mixta" },
  sectorSummary: { count: 0 },
  failures: [],
  sectorFailures: [],
};

function dailyBars(count, lastDate = "2026-09-05") {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(lastDate);
    date.setDate(date.getDate() - index);
    const close = 420 + Math.sin(index / 12) * 8;
    return {
      date: date.toISOString().slice(0, 10),
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000,
    };
  });
}

vi.mock("@/lib/marketData", () => ({
  fetchYahooChart: vi.fn(async (symbol) => ({
    bars: dailyBars(260, "2026-09-05"),
    meta: { symbol },
  })),
}));

vi.mock("@/lib/marketBreadth", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readNightlyScanRows: vi.fn(async () => ({
      configured: true,
      rows: [
        { symbol: "AAPL", country: "US", stage: "stage2", priceAboveSlowMa: true, extSma50: 1, lastDate: "2026-09-05" },
        { symbol: "SAP", country: "DE", stage: "stage1", priceAboveSlowMa: true, extSma50: 0.5, lastDate: "2026-09-05" },
      ],
      scan: { id: "scan-1", createdAt: "2026-09-05T03:57:00.000Z" },
      error: null,
    })),
  };
});

vi.mock("@/lib/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabaseConfig: () => ({
      configured: true,
      ownerId: "personal",
      url: "https://x.test",
      key: "k",
      missing: [],
      mode: "postgrest",
    }),
    supabaseRequest: vi.fn(async (path, options = {}) => {
      if (path !== "app_settings") throw new Error(`unexpected supabaseRequest path: ${path}`);
      if (!cacheRow) return [];
      const query = typeof options.query === "string"
        ? options.query
        : new URLSearchParams(options.query || {}).toString();
      if (query.includes("market_health_cache") && query.includes("default")) {
        return [cacheRow];
      }
      return [];
    }),
    supabaseRpc: vi.fn(async (name, payload = {}) => {
      rpcCalls.push({ name, payload });
      if (name !== "upsert_app_setting_newer_wins") throw new Error(`unexpected rpc: ${name}`);
      const incomingAt = payload.p_updated_at;
      const existingAt = cacheRow?.updated_at;
      const existingMs = existingAt ? new Date(existingAt).getTime() : 0;
      const incomingMs = incomingAt ? new Date(incomingAt).getTime() : 0;
      if (existingMs > incomingMs) {
        return [cacheRow];
      }
      cacheRow = {
        owner_id: payload.p_owner_id,
        setting_type: payload.p_setting_type,
        setting_key: payload.p_setting_key,
        value: payload.p_value,
        updated_at: incomingAt,
      };
      return [cacheRow];
    }),
  };
});

const { GET, writeMarketHealthCache, weinsteinTape } = await import("@/app/api/market-health/route");

function getRequest(extra = "") {
  return new Request(`https://statsedge.test/api/market-health${extra}`);
}

beforeEach(() => {
  rpcCalls.length = 0;
  cacheRow = {
    owner_id: "personal",
    setting_type: "market_health_cache",
    setting_key: "default",
    value: {
      version: 1,
      cachedAt: "2026-08-17T12:00:00.000Z",
      payload: stalePayload,
    },
    updated_at: "2026-08-17T12:00:00.000Z",
  };
});

describe("GET /api/market-health · caché stale sin refresh", () => {
  it("sirve el payload cacheado aunque esté caducado (sin live)", async () => {
    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.marketScore).toBe(72);
    expect(body.indexes[0].lastDate).toBe("2026-08-17");
    expect(body.freshness.cacheStale).toBe(true);
    expect(body.freshness.cacheHit).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("GET /api/market-health · refresh=1", () => {
  it("recalcula en vivo, persiste caché y deja de servir Aug-17 en lecturas posteriores", async () => {
    const refreshRes = await GET(getRequest("?refresh=1"));
    const refreshBody = await refreshRes.json();

    expect(refreshRes.status).toBe(200);
    expect(refreshBody.indexes[0].lastDate).toBe("2026-09-05");
    expect(refreshBody.freshness.cacheWritten).toBe(true);
    expect(refreshBody.freshness.cacheWriteError).toBeFalsy();
    const spyRow = refreshBody.indexes.find((row) => row.symbol === "SPY");
    expect(refreshBody.weinsteinTape.indexSymbol).toBe("SPY");
    expect(refreshBody.weinsteinTape.indexDistributionDays20).toBe(spyRow.distributionDays20);
    expect(refreshBody.weinsteinTape.indexAccumulationDays20).toBe(spyRow.accumulationDays20);
    expect(refreshBody.heroScope).toBe("US");
    expect(refreshBody.regimes?.US?.etf).toBe("SPY");
    expect(refreshBody.regimes?.EU?.etf).toBe("FEZ");
    expect(refreshBody.regimes?.JP?.etf).toBe("EWJ");
    expect(refreshBody.regimes?.HK?.etf).toBe("EWH");
    expect(refreshBody.regimes?.US?.breadth?.population).toBe(1);
    expect(rpcCalls).toHaveLength(1);
    expect(cacheRow.value.payload.indexes[0].lastDate).toBe("2026-09-05");

    const cachedRes = await GET(getRequest());
    const cachedBody = await cachedRes.json();

    expect(cachedBody.indexes[0].lastDate).toBe("2026-09-05");
    expect(cachedBody.freshness.cacheHit).toBe(true);
  });

  it("expone cacheWritten=false si upsert_app_setting_newer_wins no guarda fila más nueva", async () => {
    const { supabaseRpc } = await import("@/lib/supabaseServer");

    vi.mocked(supabaseRpc).mockImplementationOnce(async (name, payload = {}) => {
      rpcCalls.push({ name, payload });
      // Debe ser estrictamente posterior a p_updated_at (Date.now) para que
      // settingSyncSummary marque skippedStale — no usar una fecha de calendario fija.
      return [{
        ...cacheRow,
        updated_at: "2099-01-01T00:00:00.000Z",
      }];
    });

    const res = await GET(getRequest("?refresh=1"));
    const body = await res.json();

    expect(body.indexes[0].lastDate).toBe("2026-09-05");
    expect(body.freshness.cacheWritten).toBe(false);
    expect(body.freshness.cacheWriteError).toMatch(/skipped|no saved row/i);
  });
});

describe("writeMarketHealthCache", () => {
  it("confirma escritura solo cuando upsert devuelve fila guardada", async () => {
    const payload = {
      generatedAt: "2026-09-08T12:00:00.000Z",
      marketScore: 80,
      indexes: [],
    };

    const ok = await writeMarketHealthCache(payload);
    expect(ok.written).toBe(true);
    expect(ok.cachedAt).toBeTruthy();
    expect(cacheRow.value.payload.generatedAt).toBe(payload.generatedAt);
  });
});

describe("weinsteinTape · Dist/Acc honestos", () => {
  it("expone conteo del índice de referencia (SPY) separado del promedio sectorial", () => {
    const indexes = [
      { symbol: "SPY", distributionDays20: 4, accumulationDays20: 2 },
      { symbol: "QQQ", distributionDays20: 1, accumulationDays20: 5 },
    ];
    const sectors = [
      { symbol: "XLK", distributionDays20: 6, accumulationDays20: 1 },
      { symbol: "XLF", distributionDays20: 2, accumulationDays20: 3 },
    ];
    const tape = weinsteinTape(indexes, sectors);

    expect(tape.indexSymbol).toBe("SPY");
    expect(tape.indexDistributionDays20).toBe(4);
    expect(tape.indexAccumulationDays20).toBe(2);
    expect(tape.distributionDays20Avg).toBe(4);
    expect(tape.accumulationDays20Avg).toBe(2);
  });

  it("cae al primer índice si SPY no está en la muestra", () => {
    const indexes = [{ symbol: "QQQ", distributionDays20: 3, accumulationDays20: 7 }];
    const tape = weinsteinTape(indexes, []);

    expect(tape.indexSymbol).toBe("QQQ");
    expect(tape.indexDistributionDays20).toBe(3);
    expect(tape.indexAccumulationDays20).toBe(7);
  });
});
