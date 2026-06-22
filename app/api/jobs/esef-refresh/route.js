import { isInternalRequest } from "@/lib/internalAuth";
import { updateEsefFundamentalsForSymbol } from "@/lib/esef";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Allow sufficient time for multiple downloads

const EUROPEAN_MARKETS = ["GB", "FI", "DK", "NO", "NL", "ES", "SE", "IT", "FR", "DE"];

function authorized(request) {
  return isInternalRequest(request, { allowCron: true });
}

async function defaultEuropeanSymbols(limit) {
  const config = supabaseConfig();
  if (!config.configured) return [];
  try {
    const rows = await supabaseRequest("symbol_resolutions", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `market=in.(${EUROPEAN_MARKETS.join(",")})`,
        `status=in.(resolved,priced)`,
        "select=symbol",
        `limit=${limit}`,
      ].join("&"),
    });
    return (rows || []).map((r) => r.symbol).filter(Boolean);
  } catch (error) {
    console.error("[ESEF Job] Failed to fetch default European symbols:", error.message);
    return [];
  }
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
        provider: "esef-filings",
        run_type: "esef-cache-refresh",
        market: "Europe",
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
    // Logging failures should never abort the sync process
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 10), 1), 100);
  const filingLimit = Math.min(Math.max(Number(searchParams.get("filingLimit") || 3), 1), 10);

  const requested = String(searchParams.get("symbols") || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  const symbols = requested.length ? requested : await defaultEuropeanSymbols(limit);

  const run = await createRun({ limit, filingLimit, symbolsRequested: symbols.length, symbols });

  try {
    const results = [];
    for (const symbol of symbols) {
      const res = await updateEsefFundamentalsForSymbol(symbol, { limit: filingLimit });
      results.push(res);
    }

    const stats = {
      symbols: symbols.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      processedSnapshots: results.reduce((sum, r) => sum + (r.processed?.filter((p) => p.written).length || 0), 0),
    };

    await finishRun(run, stats.failed ? "completed-with-warnings" : "completed", { stats });
    return Response.json({ ok: true, stats, results });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message });
    return Response.json({ ok: false, error: error.message || "ESEF refresh job failed" }, { status: 502 });
  }
}

export const POST = GET;
