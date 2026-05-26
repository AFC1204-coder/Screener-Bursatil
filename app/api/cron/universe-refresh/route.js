import { expandedUniverseCronMarkets } from "@/lib/cronPlan";
import { envValue } from "@/lib/env";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request) {
  const secret = envValue("CRON_SECRET");
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

async function createRun(markets) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  try {
    const [run] = await supabaseRequest("provider_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        provider: "statsedge-cron",
        run_type: "cron-universe-refresh",
        market: markets.join(","),
        status: "started",
        stats: { markets },
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
    // Cron logging should never block the refresh itself.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const markets = expandedUniverseCronMarkets();
  if (searchParams.get("dryRun") === "1") {
    return Response.json({ ok: true, dryRun: true, markets });
  }
  const run = await createRun(markets);
  try {
    const snapshot = await getUniverseEngineSnapshot({ markets, refresh: true });
    const stats = {
      markets: snapshot.markets,
      count: snapshot.count,
      totalBeforeGate: snapshot.totalBeforeGate,
      excludedCount: snapshot.excludedCount,
      cache: snapshot.cache,
      coverage: {
        byMarket: snapshot.coverage?.byMarket || {},
        bySource: snapshot.coverage?.bySource || {},
        byInstrumentType: snapshot.coverage?.byInstrumentType || {},
      },
    };
    await finishRun(run, "completed", { stats });
    return Response.json({ ok: true, ...stats, updatedAt: snapshot.updatedAt });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { markets } });
    return Response.json({ ok: false, error: error.message || "Cron universe refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
