import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPostgrestCountSql,
  buildPostgrestSelectSql,
  normalizePostgrestQuery,
  pgCount,
  pgRequest,
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

  it("rechaza escrituras en modo pg", async () => {
    await expect(pgRequest(pool, "daily_bars", { method: "POST", body: {} }))
      .rejects.toMatchObject({ code: "PG_WRITE_UNSUPPORTED" });
  });
});
