import { CORE_COVERAGE_MARKETS } from "@/lib/coveragePlan";
import { isInternalRequest } from "@/lib/internalAuth";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

function requestedMarkets(request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("markets") || searchParams.get("market") || "";
  return raw ? raw.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) : CORE_COVERAGE_MARKETS;
}

function authorized(request) {
  return isInternalRequest(request, { allowCron: true });
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
        provider: "universe-engine",
        run_type: "universe-refresh",
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
    // Job logging should never make the refresh fail.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const markets = requestedMarkets(request);
  const run = await createRun(markets);
  try {
    const snapshot = await getUniverseEngineSnapshot({ markets, refresh: true });
    const stats = {
      markets: snapshot.markets,
      count: snapshot.count,
      totalBeforeGate: snapshot.totalBeforeGate,
      excludedCount: snapshot.excludedCount,
      cache: snapshot.cache,
    };
    await finishRun(run, "completed", { stats });
    return Response.json({ ok: true, ...stats, updatedAt: snapshot.updatedAt });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { markets } });
    return Response.json({ ok: false, error: error.message || "Universe refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
