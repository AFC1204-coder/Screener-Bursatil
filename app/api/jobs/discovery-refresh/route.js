import { buildDiscoveryCacheEntries, DISCOVERY_CACHE_SPECS, writeMaterializedDiscoverySnapshots } from "@/lib/discoveryCache";
import { isInternalRequest } from "@/lib/internalAuth";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

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
        provider: "statsedge-discovery",
        run_type: "discovery-refresh",
        status: "started",
        stats: { specs: DISCOVERY_CACHE_SPECS.map((item) => item.key) },
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
    // Operational logging should not block the snapshot refresh response.
  }
}

function degradedDryRunStats(error) {
  return {
    inputRows: 0,
    degraded: true,
    reason: error?.message || "Discovery source unavailable",
    snapshots: DISCOVERY_CACHE_SPECS.map((spec) => ({
      key: spec.key,
      rows: 0,
      lists: 0,
      groups: 0,
      health: "degraded",
    })),
  };
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dryRun") === "1";
  const run = dryRun ? null : await createRun();
  try {
    const built = await buildDiscoveryCacheEntries();
    if (!built.configured) {
      const stats = { reason: "supabase-disabled" };
      await finishRun(run, "skipped", { stats });
      return Response.json({ ok: true, skipped: true, dryRun, message: built.scanData?.message, saved: 0, stats });
    }
    const stats = {
      inputRows: built.entries[0]?.inputRows || 0,
      snapshots: built.entries.map((entry) => ({
        key: entry.key,
        rows: entry.snapshot?.rows?.length || 0,
        lists: entry.snapshot?.lists?.length || 0,
        groups: Object.values(entry.snapshot?.groups || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
        health: entry.snapshot?.health?.state || "unknown",
      })),
    };
    if (dryRun) return Response.json({ ok: true, dryRun, saved: 0, stats });

    const saved = await writeMaterializedDiscoverySnapshots(built.entries);
    await finishRun(run, "completed", { stats: { ...stats, saved: saved.saved, snapshots: saved.snapshots } });
    return Response.json({ ok: true, dryRun: false, ...saved, stats });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message });
    if (dryRun) {
      return Response.json({ ok: true, dryRun: true, degraded: true, saved: 0, stats: degradedDryRunStats(error) });
    }
    return Response.json({ ok: false, error: error.message || "Discovery refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
