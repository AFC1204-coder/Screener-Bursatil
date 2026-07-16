// Contrato de observabilidad para /api/jobs/scan-refresh.
// Todo Supabase y el scanner se sustituyen por mocks: no hay red ni escrituras.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internalAuth", () => ({
  isInternalRequest: vi.fn(() => true),
}));
vi.mock("@/lib/markets", () => ({
  normalizeMarketList: (markets, fallback) => markets?.length ? markets : fallback,
}));
vi.mock("@/lib/symbols", () => ({ countryCode: () => "US" }));
vi.mock("@/lib/screenerFilters", () => ({ screenerFiltersFromSearchParams: () => null }));
vi.mock("@/lib/shadowUniverseStore", () => ({ readPricedShadowSymbols: vi.fn() }));
vi.mock("@/lib/universes", () => ({ marketSymbols: vi.fn(() => []) }));
vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, ownerId: "owner-test" })),
  supabaseRequest: vi.fn(),
}));
vi.mock("@/lib/materializedScanner", () => ({
  DEFAULT_MATERIALIZED_MARKETS: ["US", "HK"],
  planMaterializedScan: vi.fn(),
  readScanBatchCursor: vi.fn(),
  refreshDefaultLeaderboards: vi.fn(),
  runMaterializedScan: vi.fn(),
  writeMaterializedScan: vi.fn(),
  writeScanBatchCursor: vi.fn(),
}));

import { isInternalRequest } from "@/lib/internalAuth";
import {
  readScanBatchCursor,
  refreshDefaultLeaderboards,
  runMaterializedScan,
  writeMaterializedScan,
  writeScanBatchCursor,
} from "@/lib/materializedScanner";
import { supabaseRequest } from "@/lib/supabaseServer";
import { GET } from "@/app/api/jobs/scan-refresh/route";

function request(query = "") {
  return new Request(`http://localhost/api/jobs/scan-refresh${query}`);
}

function failedRunPatch() {
  return supabaseRequest.mock.calls
    .find(([table, options]) => table === "provider_runs" && options?.method === "PATCH" && options.body?.status === "failed")?.[1]?.body;
}

function successfulScan() {
  return {
    scan: { id: "materialized:test", name: "Materialized scan", rows: [] },
    stats: { savedRows: 0, selection: {} },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isInternalRequest.mockReturnValue(true);
  readScanBatchCursor.mockResolvedValue({ value: {} });
  supabaseRequest.mockImplementation(async (table, options = {}) => {
    if (table === "provider_runs" && options.method === "POST") return [{ id: "run-test" }];
    return [];
  });
  writeMaterializedScan.mockResolvedValue({ saved: true, scanId: "scan-test", localId: "materialized:test", rows: 0 });
  writeScanBatchCursor.mockResolvedValue({ saved: true });
  refreshDefaultLeaderboards.mockResolvedValue({ saved: 0 });
});

describe("GET /api/jobs/scan-refresh · observabilidad de fase", () => {
  it("persiste y devuelve universe_select conservando el error original", async () => {
    runMaterializedScan.mockImplementation(async (options) => {
      options.onPhase("universe_select");
      throw new Error("canceling statement due to statement timeout");
    });

    const response = await GET(request("?symbols=AAA&leaderboards=0"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "canceling statement due to statement timeout",
      phase: "universe_select",
    });
    expect(failedRunPatch()).toMatchObject({
      status: "failed",
      error: "canceling statement due to statement timeout",
      stats: { phase: "universe_select" },
    });
  });

  it("persiste y devuelve materialized_scan cuando falla después de seleccionar universo", async () => {
    runMaterializedScan.mockImplementation(async (options) => {
      options.onPhase("universe_select");
      options.onPhase("materialized_scan");
      throw new Error("benchmark cache timeout");
    });

    const response = await GET(request("?symbols=AAA&leaderboards=0"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "benchmark cache timeout", phase: "materialized_scan" });
    expect(failedRunPatch()).toMatchObject({ error: "benchmark cache timeout", stats: { phase: "materialized_scan" } });
  });

  it("en éxito conserva el payload y no añade phase", async () => {
    runMaterializedScan.mockImplementation(async (options) => {
      options.onPhase("universe_select");
      options.onPhase("materialized_scan");
      return successfulScan();
    });

    const response = await GET(request("?symbols=AAA&leaderboards=0"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("phase");
    expect(body.savedScan).toMatchObject({ saved: true, scanId: "scan-test" });
    expect(body.stats.savedRows).toBe(0);
  });

  it("acota el refresco de leaderboards del scan materializado", async () => {
    runMaterializedScan.mockImplementation(async (options) => {
      options.onPhase("universe_select");
      options.onPhase("materialized_scan");
      return successfulScan();
    });

    const response = await GET(request("?symbols=AAA"));

    expect(response.status).toBe(200);
    expect(refreshDefaultLeaderboards).toHaveBeenCalledWith({ sinceDays: 21, maxRows: 2000 });
  });

  it("un error recuperable de cursor no queda registrado como fallo terminal", async () => {
    readScanBatchCursor.mockRejectedValueOnce(new Error("cursor read timeout"));
    runMaterializedScan.mockImplementation(async (options) => {
      options.onPhase("universe_select");
      options.onPhase("materialized_scan");
      return successfulScan();
    });

    const response = await GET(request("?limit=1&leaderboards=0"));

    expect(response.status).toBe(200);
    expect(failedRunPatch()).toBeUndefined();
  });

  it("mantiene autenticación y límites existentes", async () => {
    isInternalRequest.mockReturnValueOnce(false);
    const unauthorized = await GET(request());
    expect(unauthorized.status).toBe(401);

    runMaterializedScan.mockImplementation(async (options) => {
      options.onPhase("universe_select");
      options.onPhase("materialized_scan");
      return successfulScan();
    });
    const response = await GET(request("?symbols=AAA&limit=999&perMarket=999&concurrency=999&leaderboards=0"));

    expect(response.status).toBe(200);
    expect(runMaterializedScan).toHaveBeenCalledWith(expect.objectContaining({ limit: 1, perMarket: 0, concurrency: 4 }));
  });
});
