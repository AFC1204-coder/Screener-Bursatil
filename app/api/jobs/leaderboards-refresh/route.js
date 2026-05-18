import { envValue } from "@/lib/env";
import { buildLeaderboard, DEFAULT_LEADERBOARD_SPECS, readScanRows, writeMaterializedLeaderboards } from "@/lib/leaderboards";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

function authorized(request) {
  const secret = envValue("CRON_SECRET");
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

async function createRun() {
  const config = supabaseConfig();
  if (!config.configured) return null;
  try {
    const [run] = await supabaseRequest("provider_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        provider: "statsedge-leaderboards",
        run_type: "leaderboards-refresh",
        status: "started",
        stats: { specs: DEFAULT_LEADERBOARD_SPECS.map((item) => item.key) },
      }],
    });
    return run;
  } catch {
    return null;
  }
}

async function finishRun(run, status, payload = {}) {
  if (!run?.id) return;
  try {
    await supabaseRequest("provider_runs", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(run.id)}`,
      prefer: "return=minimal",
      body: {
        status,
        finished_at: new Date().toISOString(),
        stats: payload.stats || {},
        error: payload.error || null,
      },
    });
  } catch {
    // Job logging must not block the derived snapshot refresh.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const run = await createRun();
  try {
    const scanData = await readScanRows();
    if (!scanData.configured) {
      await finishRun(run, "skipped", { stats: { reason: "supabase-disabled" } });
      return Response.json({ ok: true, skipped: true, message: scanData.message, saved: 0 });
    }
    const leaderboards = DEFAULT_LEADERBOARD_SPECS.map((spec) => buildLeaderboard(scanData.rows, spec));
    const saved = await writeMaterializedLeaderboards(leaderboards);
    const stats = {
      inputRows: scanData.rows.length,
      saved: saved.saved,
      leaderboards: saved.leaderboards,
    };
    await finishRun(run, "completed", { stats });
    return Response.json({ ok: true, ...stats });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message });
    return Response.json({ ok: false, error: error.message || "Leaderboards refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
