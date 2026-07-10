import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { summarizeScanCoverageRows } from "@/lib/coveragePlan";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#") || !value.includes("=")) continue;
    const index = value.indexOf("=");
    const key = value.slice(0, index).trim();
    const parsed = value.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = parsed;
  }
}

const skipIntegration = !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeIf = skipIntegration ? describe.skip : describe;
const OWNER = `coverage-rpc-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const NOW_ISO = "2026-07-10T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

const rows = [
  { symbol: "AAA", country: "US", total_score: 88, metrics: { priceFreshnessDays: 1, dataCoverageScore: 90, objectiveScore: 80 }, raw: {}, created_at: "2026-07-09T10:00:00.000Z" },
  { symbol: "AAA", country: "US", total_score: 88, metrics: { priceFreshnessDays: 7, dataCoverageScore: 90, objectiveScore: 80 }, raw: {}, created_at: "2026-07-09T11:00:00.000Z" },
  { symbol: "BBB", country: "DE", total_score: 92, metrics: { priceFreshnessDays: 2, dataCoverageScore: 39, objectiveScore: 90 }, raw: {}, created_at: "2026-07-09T09:00:00.000Z" },
  { symbol: "CCC", country: "", total_score: null, metrics: { lastDate: "2026-07-07" }, raw: { country: "JP" }, created_at: "2026-07-09T08:00:00.000Z" },
  { symbol: "DDD", country: "AU", total_score: 70, metrics: {}, raw: { priceFreshnessDays: "2", dataCoverageScore: "80", objectiveScore: 44 }, created_at: "2026-07-09T07:00:00.000Z" },
];

describeIf("coverage_scan_summary RPC real", () => {
  let supabaseRequest;
  let supabaseRpc;
  let scanId;

  beforeAll(async () => {
    process.env.STATSEDGE_OWNER_ID = OWNER;
    const server = await import("@/lib/supabaseServer.js");
    supabaseRequest = server.supabaseRequest;
    supabaseRpc = server.supabaseRpc;
    const inserted = await supabaseRequest("scans", {
      method: "POST",
      prefer: "return=representation",
      body: [{ owner_id: OWNER, local_id: OWNER, name: "Coverage RPC fixture", settings: {}, row_count: rows.length }],
    });
    scanId = inserted[0].id;
    await supabaseRequest("scan_results", {
      method: "POST",
      prefer: "return=minimal",
      body: rows.map((row, index) => ({ ...row, owner_id: OWNER, scan_id: scanId, rank_index: index })),
    });
  }, 30_000);

  afterAll(async () => {
    if (!supabaseRequest) return;
    await supabaseRequest("scans", { method: "DELETE", query: `owner_id=eq.${encodeURIComponent(OWNER)}`, prefer: "return=minimal" });
  }, 30_000);

  it("coincide exactamente con el agregador legacy para el mismo dataset", async () => {
    const legacy = summarizeScanCoverageRows(rows, { nowMs: NOW_MS });
    const rpc = await supabaseRpc("coverage_scan_summary", {
      p_owner_id: OWNER,
      p_since: "2026-07-01T00:00:00.000Z",
      p_max_rows: 4000,
      p_max_price_freshness_days: 5,
      p_min_coverage_score: 40,
      p_now: NOW_ISO,
    });
    expect(rpc).toEqual(legacy);
  });

  it("responde dentro del presupuesto anterior de 2.5s con payload agregado pequeño", async () => {
    const started = performance.now();
    const rpc = await supabaseRpc("coverage_scan_summary", {
      p_owner_id: OWNER,
      p_since: "2026-07-01T00:00:00.000Z",
      p_max_rows: 4000,
      p_max_price_freshness_days: 5,
      p_min_coverage_score: 40,
      p_now: NOW_ISO,
    }, { timeoutMs: 2500 });
    const elapsedMs = performance.now() - started;
    console.log(`[coverage-rpc] fixture latency=${elapsedMs.toFixed(1)}ms bytes=${Buffer.byteLength(JSON.stringify(rpc))}`);
    expect(elapsedMs).toBeLessThan(2500);
    expect(Buffer.byteLength(JSON.stringify(rpc))).toBeLessThan(10_000);
  });
});
