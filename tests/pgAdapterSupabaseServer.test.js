import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pgRequest = vi.fn();
const pgCount = vi.fn();
const getPgPool = vi.fn(() => ({ query: vi.fn() }));

vi.mock("@/lib/pgPostgrestAdapter", () => ({
  pgRequest,
  pgCount,
  getPgPool,
  buildPostgrestSelectSql: vi.fn(),
  buildPostgrestCountSql: vi.fn(),
  normalizePostgrestQuery: vi.fn(),
  closePgPool: vi.fn(),
}));

describe("supabaseServer en modo pg", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    pgRequest.mockReset();
    pgCount.mockReset();
    getPgPool.mockClear();
    process.env = {
      ...originalEnv,
      STATSEDGE_DB_MODE: "pg",
      DATABASE_URL: "postgresql://statsedge:statsedge_local_2026@127.0.0.1:5432/statsedge",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("supabaseConfig() está configured sin SUPABASE_URL/KEY", async () => {
    const { supabaseConfig } = await import("@/lib/supabaseServer");
    const config = supabaseConfig();
    expect(config.configured).toBe(true);
    expect(config.mode).toBe("pg");
    expect(config.missing).toEqual([]);
    expect(config.databaseUrl).toContain("postgresql://");
  });

  it("supabaseRequest delega lecturas a pgRequest", async () => {
    pgRequest.mockResolvedValueOnce([{ symbol: "AAPL", trade_date: "2026-09-03" }]);
    const { supabaseRequest } = await import("@/lib/supabaseServer");
    const rows = await supabaseRequest("daily_bars", {
      query: {
        select: "symbol,trade_date",
        owner_id: "eq.personal",
        symbol: "eq.AAPL",
        limit: "10",
      },
    });
    expect(rows).toEqual([{ symbol: "AAPL", trade_date: "2026-09-03" }]);
    expect(pgRequest).toHaveBeenCalledWith(
      expect.anything(),
      "daily_bars",
      expect.objectContaining({ query: expect.any(Object) }),
    );
  });

  it("supabaseCount delega a pgCount", async () => {
    pgCount.mockResolvedValueOnce(98);
    const { supabaseCount } = await import("@/lib/supabaseServer");
    const total = await supabaseCount("scans", { query: "owner_id=eq.personal" });
    expect(total).toBe(98);
    expect(pgCount).toHaveBeenCalledWith(expect.anything(), "scans", expect.any(Object));
  });

  it("supabaseRpc lanza error claro en modo pg", async () => {
    const { supabaseRpc } = await import("@/lib/supabaseServer");
    await expect(supabaseRpc("finalize_scan_results", {}))
      .rejects.toMatchObject({ code: "PG_RPC_UNSUPPORTED" });
  });
});

describe("supabaseServer sin flag (PostgREST legado)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      STATSEDGE_DB_MODE: "",
      DATABASE_URL: "",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("supabaseConfig exige SUPABASE_URL y KEY", async () => {
    const { supabaseConfig } = await import("@/lib/supabaseServer");
    const config = supabaseConfig();
    expect(config.mode).toBe("postgrest");
    expect(config.configured).toBe(true);
  });
});
