import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPostgrestCountSql,
  buildPostgrestDeleteSql,
  buildPostgrestInsertSql,
  buildPostgrestSelectSql,
  buildScanSymbolHistoryLatestSql,
  isPgRpcSupported,
  normalizePostgrestQuery,
  parseOnConflict,
  parsePreferHeader,
  pgCount,
  pgRequest,
  pgRpc,
} from "@/lib/pgPostgrestAdapter";

describe("pgPostgrestAdapter SQL builder", () => {
  it("traduce eq, is.null, order, limit y select de scans", () => {
    const { sql, values } = buildPostgrestSelectSql("scans", {
      owner_id: "eq.personal",
      preset: "eq.materialized-cache",
      "settings->markets": "cs.[\"US\"]",
      deleted_at: "is.null",
      select: "id,local_id,row_count,created_at",
      order: "created_at.desc",
      limit: "25",
    });
    expect(sql).toContain('FROM "scans"');
    expect(sql).toContain('"owner_id" = $1');
    expect(sql).toContain('"deleted_at" IS NULL');
    expect(sql).toContain('"settings"->\'markets\' @> $');
    expect(sql).toContain('ORDER BY "created_at" DESC');
    expect(sql).toContain("LIMIT $");
    expect(values).toContain("personal");
    expect(values).toContain("materialized-cache");
    expect(values).toContain('["US"]');
    expect(values).toContain(25);
  });

  it("traduce in.(...) para scan_results", () => {
    const { sql, values } = buildPostgrestSelectSql("scan_results", {
      owner_id: "eq.personal",
      scan_id: "in.(scan-a,scan-b)",
      select: "symbol,rank_index",
      order: "rank_index.asc",
      limit: "1000",
      offset: "0",
    });
    expect(sql).toContain('"scan_id" IN ($2, $3)');
    expect(values).toEqual(["personal", "scan-a", "scan-b", 1000, 0]);
  });

  it("traduce gte y like para nightly US", () => {
    const { sql, values } = buildPostgrestSelectSql("scans", [
      "owner_id=eq.personal",
      "local_id=like.materialized:US:*",
      "deleted_at=is.null",
      "select=id,local_id",
      "order=created_at.desc",
      "limit=1",
    ].join("&"));
    expect(sql).toContain('"local_id" LIKE $');
    expect(values).toContain("materialized:US:%");
  });

  it("traduce daily_bars con query objeto (como dailyBarsCache)", () => {
    const query = normalizePostgrestQuery({
      select: "symbol,trade_date,close,adj_close,volume",
      owner_id: "eq.personal",
      symbol: "eq.AAPL",
      order: "trade_date.desc,updated_at.desc",
      limit: "1200",
    });
    const { sql, values } = buildPostgrestSelectSql("daily_bars", query);
    expect(sql).toContain('FROM "daily_bars"');
    expect(sql).toContain('"symbol" = $2');
    expect(sql).toContain('ORDER BY "trade_date" DESC, "updated_at" DESC');
    expect(values).toContain("personal");
    expect(values).toContain("AAPL");
    expect(values).toContain(1200);
  });

  it("traduce COUNT para rs_weekly_items", () => {
    const { sql, values } = buildPostgrestCountSql("rs_weekly_items", {
      owner_id: "eq.personal",
      engine_version: "eq.statsedge-global-rs-usd-v2",
    });
    expect(sql).toContain('SELECT COUNT(*)::int AS count FROM "rs_weekly_items"');
    expect(sql).toContain('"engine_version" = $2');
    expect(values).toEqual(["personal", "statsedge-global-rs-usd-v2"]);
  });

  it("traduce DELETE por scan_id", () => {
    const { sql, values } = buildPostgrestDeleteSql("scan_results", {
      scan_id: "eq.scan-uuid-1",
    });
    expect(sql).toBe('DELETE FROM "scan_results" WHERE "scan_id" = $1');
    expect(values).toEqual(["scan-uuid-1"]);
  });

  it("traduce upsert scans con merge-duplicates y return=representation", () => {
    const { sql, values, returning } = buildPostgrestInsertSql("scans", [{
      owner_id: "personal",
      local_id: "materialized:US:2026-09-05:o0:l10",
      name: "Materialized scan US",
      preset: "materialized-cache",
      settings: { markets: ["US"] },
      market_regime: "batch-cache",
      row_count: 10,
      created_at: "2026-09-05T10:00:00.000Z",
      updated_at: "2026-09-05T10:00:00.000Z",
    }], {
      query: "on_conflict=owner_id,local_id",
      prefer: "resolution=merge-duplicates,return=representation",
    });
    expect(sql).toContain('INSERT INTO "scans"');
    expect(sql).toContain('ON CONFLICT ("owner_id", "local_id") DO UPDATE SET');
    expect(sql).toContain('"settings" = EXCLUDED."settings"');
    expect(sql).not.toContain('"id" = EXCLUDED."id"');
    expect(sql).toContain("RETURNING *");
    expect(returning).toBe(true);
    expect(values[0]).toBe("personal");
    expect(values[3]).toBe("materialized-cache");
    expect(values[4]).toBe('{"markets":["US"]}');
  });

  it("traduce upsert app_settings", () => {
    const { sql } = buildPostgrestInsertSql("app_settings", [{
      owner_id: "personal",
      setting_type: "jobs",
      setting_key: "scan-refresh-cursor",
      value: { markets: { US: { offset: 40 } } },
      updated_at: "2026-09-05T10:00:00.000Z",
    }], {
      query: "on_conflict=owner_id,setting_type,setting_key",
      prefer: "resolution=merge-duplicates,return=representation",
    });
    expect(sql).toContain('ON CONFLICT ("owner_id", "setting_type", "setting_key") DO UPDATE SET');
    expect(sql).toContain('"value" = EXCLUDED."value"');
  });

  it("traduce insert batch scan_results sin on_conflict", () => {
    const { sql, values, returning } = buildPostgrestInsertSql("scan_results", [
      {
        owner_id: "personal",
        scan_id: "scan-1",
        symbol: "AAPL",
        metrics: { passedScreen: true },
        raw: { symbol: "AAPL" },
      },
      {
        owner_id: "personal",
        scan_id: "scan-1",
        symbol: "MSFT",
        metrics: { passedScreen: false },
        raw: {},
      },
    ], { prefer: "return=minimal" });
    expect(sql).toContain('INSERT INTO "scan_results"');
    expect(sql).toContain("VALUES ($1, $2, $3, $4::jsonb, $5::jsonb), ($6, $7, $8, $9::jsonb, $10::jsonb)");
    expect(sql).not.toContain("ON CONFLICT");
    expect(sql).not.toContain("RETURNING");
    expect(returning).toBe(false);
    expect(values).toHaveLength(10);
    expect(values[3]).toBe('{"passedScreen":true}');
  });

  it("parsea on_conflict y prefer", () => {
    expect(parseOnConflict("on_conflict=owner_id,local_id")).toEqual(["owner_id", "local_id"]);
    expect(parsePreferHeader("resolution=merge-duplicates,return=representation")).toMatchObject({
      mergeDuplicates: true,
      returnRepresentation: true,
      returnMinimal: false,
    });
  });

  it("traduce insert scan_symbol_history con change_reasons text[]", () => {
    const { sql, values } = buildPostgrestInsertSql("scan_symbol_history", [{
      owner_id: "personal",
      symbol: "AAPL",
      mic_code: "XNAS",
      observed_at: "2026-09-05T10:00:00.000Z",
      observed_week: "2026-09-01",
      source_scan_id: "7f4e2e8f-bdd8-4652-b23d-c0466b7949d5",
      source_pipeline: "materialized_scan",
      composite_coverage: 0.5,
      composite_partial: true,
      scoring_engine_version: "statsedge-v1",
      data_provider: "yahoo",
      passed_screen: true,
      change_reasons: ["first_appearance"],
    }], {
      query: "on_conflict=owner_id,source_scan_id,mic_code,symbol",
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    expect(sql).toContain('INSERT INTO "scan_symbol_history"');
    expect(sql).toContain('ON CONFLICT ("owner_id", "source_scan_id", "mic_code", "symbol") DO NOTHING');
    expect(sql).not.toContain("::jsonb");
    expect(values).toContainEqual(["first_appearance"]);
  });
});

describe("pgPostgrestAdapter RPC scan_symbol_history_latest_v1", () => {
  it("expone solo scan_symbol_history_latest_v1 como RPC soportada", () => {
    expect(isPgRpcSupported("scan_symbol_history_latest_v1")).toBe(true);
    expect(isPgRpcSupported("finalize_scan_results")).toBe(false);
  });

  it("buildScanSymbolHistoryLatestSql replica DISTINCT ON de la migración", () => {
    const { sql, values } = buildScanSymbolHistoryLatestSql("personal", ["XNAS", "XNYS"]);
    expect(sql).toContain("SELECT DISTINCT ON (h.owner_id, h.mic_code, h.symbol)");
    expect(sql).toContain('FROM "scan_symbol_history" AS h');
    expect(sql).toContain("h.owner_id = $1");
    expect(sql).toContain("h.mic_code = ANY($2::text[])");
    expect(values).toEqual(["personal", ["XNAS", "XNYS"]]);
  });

  it("acepta p_mic_codes null (sin filtro MIC)", () => {
    const { sql, values } = buildScanSymbolHistoryLatestSql("personal", null);
    expect(sql).toContain("$2::text[] IS NULL");
    expect(values).toEqual(["personal", null]);
  });

  it("rechaza owner vacío", () => {
    expect(() => buildScanSymbolHistoryLatestSql("", null))
      .toThrow(/p_owner_id/);
  });
});

describe("pgPostgrestAdapter executor (stub pool)", () => {
  const pool = {
    query: vi.fn(),
  };

  beforeEach(() => {
    pool.query.mockReset();
  });

  it("ejecuta SELECT sobre scans vía stub", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "scan-1", local_id: "materialized:US:2026-09-01:o0:l3319" }],
    });
    const rows = await pgRequest(pool, "scans", {
      query: "owner_id=eq.personal&deleted_at=is.null&select=id,local_id&limit=1",
    });
    expect(rows).toHaveLength(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('FROM "scans"');
    expect(pool.query.mock.calls[0][1]).toContain("personal");
  });

  it("ejecuta COUNT sobre daily_bars vía stub", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: 4285447 }] });
    const total = await pgCount(pool, "daily_bars", {
      query: "owner_id=eq.personal&symbol=eq.AAPL",
    });
    expect(total).toBe(4285447);
    expect(pool.query.mock.calls[0][0]).toContain('SELECT COUNT(*)::int AS count FROM "daily_bars"');
  });

  it("ejecuta upsert scans vía stub", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: "scan-uuid", local_id: "materialized:US:2026-09-05:o0:l10", row_count: 10 }],
    });
    const rows = await pgRequest(pool, "scans", {
      method: "POST",
      query: "on_conflict=owner_id,local_id",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [{
        owner_id: "personal",
        local_id: "materialized:US:2026-09-05:o0:l10",
        name: "test",
        row_count: 10,
      }],
    });
    expect(rows).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain("ON CONFLICT");
    expect(pool.query.mock.calls[0][0]).toContain("RETURNING *");
  });

  it("ejecuta DELETE scan_results vía stub", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await pgRequest(pool, "scan_results", {
      method: "DELETE",
      query: "scan_id=eq.scan-uuid",
    });
    expect(result).toBeNull();
    expect(pool.query.mock.calls[0][0]).toContain('DELETE FROM "scan_results"');
  });

  it("ejecuta insert batch scan_results vía stub", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await pgRequest(pool, "scan_results", {
      method: "POST",
      prefer: "return=minimal",
      body: [{ owner_id: "personal", scan_id: "scan-uuid", symbol: "AAPL", metrics: {}, raw: {} }],
    });
    expect(result).toBeNull();
    expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO "scan_results"');
  });

  it("rechaza métodos no soportados", async () => {
    await expect(pgRequest(pool, "daily_bars", { method: "PUT", body: {} }))
      .rejects.toMatchObject({ code: "PG_WRITE_UNSUPPORTED" });
  });

  it("ejecuta scan_symbol_history_latest_v1 vía pgRpc", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        owner_id: "personal",
        symbol: "AAPL",
        mic_code: "XNAS",
        observed_at: "2026-09-05T10:00:00.000Z",
        change_reasons: ["first_appearance"],
      }],
    });
    const rows = await pgRpc(pool, "scan_symbol_history_latest_v1", {
      p_owner_id: "personal",
      p_mic_codes: ["XNAS"],
    });
    expect(rows).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain("DISTINCT ON");
    expect(pool.query.mock.calls[0][1]).toEqual(["personal", ["XNAS"]]);
  });

  it("pgRpc rechaza RPC no implementada", async () => {
    await expect(pgRpc(pool, "finalize_scan_results", {}))
      .rejects.toMatchObject({ code: "PG_RPC_UNSUPPORTED" });
  });
});
