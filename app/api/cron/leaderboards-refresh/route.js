// GET /api/cron/leaderboards-refresh — refresco de leaderboards materializados
// (leaderboard_snapshots/leaderboard_items), cadencia baja (cada 6h).
//
// Antes, scan-refresh y shadow-europe-refresh llamaban a
// refreshDefaultLeaderboards() inline en cada invocación, con sinceDays=45,
// maxRows=10000. Eso disparaba la RPC leaderboard_publishable_rows con un
// JOIN + jsonb_agg sobre hasta 10.000 filas en una sola sentencia, sin
// filtrar por mercado/cohort, en CADA corrida de esos crons — causa del
// "canceling statement due to statement timeout" en shadow-europe-refresh.
// app/api/leaderboards/route.js ya lee leaderboard_snapshots (cache-first)
// para los leaderboards predefinidos sin filtros custom, así que nada
// consume estos datos en tiempo real: desacoplar el refresco a un cron
// propio de cadencia baja es seguro. sinceDays=21/maxRows=2000 igualan los
// defaults que la propia ruta pública ya usa para construir leaderboards
// filtrados al vuelo (DEFAULT_LEADERBOARD_SCAN_ROWS/SINCE_DAYS).
import { isInternalRequest } from "@/lib/internalAuth";
import { refreshDefaultLeaderboards } from "@/lib/materializedScanner";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SINCE_DAYS = 21;
const MAX_ROWS = 2000;

function authorized(request) {
  return isInternalRequest(request, { allowCron: true });
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
        provider: "statsedge-cron",
        run_type: "cron-leaderboards-refresh",
        market: "GLOBAL",
        status: "started",
        stats: { sinceDays: SINCE_DAYS, maxRows: MAX_ROWS },
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
    // Cron logging must not block the leaderboards refresh.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  if (searchParams.get("dryRun") === "1") {
    return Response.json({ ok: true, dryRun: true, job: "cron-leaderboards-refresh", sinceDays: SINCE_DAYS, maxRows: MAX_ROWS });
  }
  const run = await createRun();
  try {
    const result = await refreshDefaultLeaderboards({ sinceDays: SINCE_DAYS, maxRows: MAX_ROWS });
    const stats = { sinceDays: SINCE_DAYS, maxRows: MAX_ROWS, ...result };
    await finishRun(run, result.skipped ? "partial" : "completed", { stats });
    return Response.json({ ok: true, job: "cron-leaderboards-refresh", ...stats });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { sinceDays: SINCE_DAYS, maxRows: MAX_ROWS } });
    return Response.json({ ok: false, job: "cron-leaderboards-refresh", error: error.message || "Leaderboards cron failed" }, { status: 502 });
  }
}

export const POST = GET;
