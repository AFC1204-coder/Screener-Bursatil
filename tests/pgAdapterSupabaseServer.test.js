import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pgRequest = vi.fn();
const pgCount = vi.fn();
const pgRpc = vi.fn();
const getPgPool = vi.fn(() => ({ query: vi.fn() }));

vi.mock("@/lib/pgPostgrestAdapter", () => ({
  pgRequest,
  pgCount,
  pgRpc,
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
    pgRpc.mockReset();
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

  it("supabaseRpc delega scan_symbol_history_latest_v1 a pgRpc", async () => {
    pgRpc.mockResolvedValueOnce([{ symbol: "AAPL", mic_code: "XNAS" }]);
    const { supabaseRpc } = await import("@/lib/supabaseServer");
    const rows = await supabaseRpc("scan_symbol_history_latest_v1", {
      p_owner_id: "personal",
      p_mic_codes: ["XNAS"],
    });
    expect(rows).toEqual([{ symbol: "AAPL", mic_code: "XNAS" }]);
    expect(pgRpc).toHaveBeenCalledWith(
      expect.anything(),
      "scan_symbol_history_latest_v1",
      { p_owner_id: "personal", p_mic_codes: ["XNAS"] },
    );
  });

  it("supabaseRpc delega leaderboard_publishable_rows a pgRpc", async () => {
    pgRpc.mockResolvedValueOnce({
      rows: [{ symbol: "MSFT" }],
      rowsRead: 5,
      rowsPublished: 1,
      rowsExcluded: 4,
    });
    const { supabaseRpc } = await import("@/lib/supabaseServer");
    const payload = await supabaseRpc("leaderboard_publishable_rows", {
      p_owner_id: "personal",
      p_max_rows: 5000,
      p_since_days: 45,
    });
    expect(payload.rows).toHaveLength(1);
    expect(pgRpc).toHaveBeenCalledWith(
      expect.anything(),
      "leaderboard_publishable_rows",
      { p_owner_id: "personal", p_max_rows: 5000, p_since_days: 45 },
    );
  });

  it("supabaseRpc delega scan_finalize_inputs y finalize_scan_results a pgRpc", async () => {
    pgRpc.mockResolvedValueOnce({ inputs: [], rowsRead: 0 });
    pgRpc.mockResolvedValueOnce([{ updated_count: 0 }]);
    const { supabaseRpc } = await import("@/lib/supabaseServer");
    const scanId = "7f4e2e8f-bdd8-4652-b23d-c0466b7949d5";
    await supabaseRpc("scan_finalize_inputs", {
      p_owner_id: "personal",
      p_scan_id: scanId,
      p_max_rows: 50,
      p_offset: 0,
    });
    await supabaseRpc("finalize_scan_results", {
      p_owner_id: "personal",
      p_scan_id: scanId,
      p_patches: [],
    });
    expect(pgRpc).toHaveBeenNthCalledWith(1, expect.anything(), "scan_finalize_inputs", {
      p_owner_id: "personal",
      p_scan_id: scanId,
      p_max_rows: 50,
      p_offset: 0,
    });
    expect(pgRpc).toHaveBeenNthCalledWith(2, expect.anything(), "finalize_scan_results", {
      p_owner_id: "personal",
      p_scan_id: scanId,
      p_patches: [],
    });
  });

  it("supabaseRpc lanza error claro para RPC no soportada en modo pg", async () => {
    pgRpc.mockRejectedValueOnce(Object.assign(
      new Error("RPC coverage_scan_summary no disponible en modo pg local"),
      { code: "PG_RPC_UNSUPPORTED" },
    ));
    const { supabaseRpc } = await import("@/lib/supabaseServer");
    await expect(supabaseRpc("coverage_scan_summary", {}))
      .rejects.toMatchObject({ code: "PG_RPC_UNSUPPORTED" });
  });

  it("supabaseRequest delega escrituras POST a pgRequest", async () => {
    pgRequest.mockResolvedValueOnce([{ id: "scan-1", local_id: "materialized:US:2026-09-05:o0:l2" }]);
    const { supabaseRequest } = await import("@/lib/supabaseServer");
    const rows = await supabaseRequest("scans", {
      method: "POST",
      query: "on_conflict=owner_id,local_id",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [{ owner_id: "personal", local_id: "materialized:US:2026-09-05:o0:l2", name: "test", row_count: 2 }],
    });
    expect(rows).toHaveLength(1);
    expect(pgRequest).toHaveBeenCalledWith(
      expect.anything(),
      "scans",
      expect.objectContaining({
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: expect.any(Array),
      }),
    );
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
