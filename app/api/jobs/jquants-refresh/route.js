import { isInternalRequest } from "@/lib/internalAuth";
import { fetchJquantsDailyBars, fetchJquantsFundamentals, jquantsStatus, writeJquantsBars, writeJquantsFundamentals } from "@/lib/jquants";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function authorized(request) {
  return isInternalRequest(request, { allowCron: true });
}

function requestedSymbols(request) {
  const { searchParams } = new URL(request.url);
  return String(searchParams.get("symbols") || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function optionsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  return {
    limit: Math.min(Math.max(Number(searchParams.get("limit") || DEFAULT_LIMIT), 1), MAX_LIMIT),
    days: Math.min(Math.max(Number(searchParams.get("days") || 390), 30), 1400),
    fundamentals: searchParams.get("fundamentals") !== "0",
    refreshUniverse: searchParams.get("refreshUniverse") === "1",
  };
}

async function defaultSymbols(limit, refreshUniverse = false) {
  const snapshot = await getUniverseEngineSnapshot({ markets: ["JP"], refresh: refreshUniverse, maxAgeHours: 168 });
  return (snapshot.universe || []).map((row) => row.symbol).filter(Boolean).slice(0, limit);
}

async function createRun(opts = {}) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  try {
    const [run] = await supabaseRequest("provider_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        provider: "jquants",
        run_type: "jp-cache-refresh",
        market: "JP",
        status: "started",
        stats: opts,
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
    // Provider run logs should never make the refresh fail.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const status = jquantsStatus();
  const opts = optionsFromRequest(request);
  const run = await createRun({ ...opts, mode: status.mode });

  if (!status.configured) {
    const stats = { skipped: true, reason: "missing-jquants-credentials", mode: status.mode };
    await finishRun(run, "skipped", { stats });
    return Response.json({
      ok: true,
      skipped: true,
      provider: "J-Quants",
      message: "Falta JQUANTS_API_KEY o JQUANTS_REFRESH_TOKEN/JQUANTS_ID_TOKEN. El conector queda listo y no hace llamadas externas.",
      status,
    });
  }

  try {
    const requested = requestedSymbols(request);
    const symbols = (requested.length ? requested : await defaultSymbols(opts.limit, opts.refreshUniverse)).slice(0, opts.limit);
    const results = [];
    for (const symbol of symbols) {
      const item = { symbol, bars: 0, fundamentals: 0, ok: false };
      try {
        const bars = await fetchJquantsDailyBars(symbol, { days: opts.days });
        const barsWrite = await writeJquantsBars(symbol, bars);
        item.bars = barsWrite.count || bars.length;
        if (opts.fundamentals) {
          const fundamentals = await fetchJquantsFundamentals(symbol);
          const fundamentalsWrite = await writeJquantsFundamentals(symbol, fundamentals);
          item.fundamentals = fundamentalsWrite.count || fundamentals.length;
        }
        item.ok = true;
      } catch (error) {
        item.error = error.message || "J-Quants symbol refresh failed";
        item.httpStatus = error.status || null;
      }
      results.push(item);
    }
    const stats = {
      provider: "J-Quants",
      mode: status.mode,
      symbols: symbols.length,
      ok: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      bars: results.reduce((sum, item) => sum + (item.bars || 0), 0),
      fundamentals: results.reduce((sum, item) => sum + (item.fundamentals || 0), 0),
      limit: opts.limit,
      days: opts.days,
    };
    await finishRun(run, stats.failed ? "partial" : "completed", { stats });
    return Response.json({ ok: true, ...stats, results });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message });
    return Response.json({ ok: false, error: error.message || "J-Quants refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
