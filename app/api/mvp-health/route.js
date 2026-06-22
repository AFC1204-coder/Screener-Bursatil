import { readMethodologyHealth } from "@/lib/methodologyHealth";
import { requirePersistenceAuth, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

const DISCOVERY_CACHE_KEY = "discovery:interactive:v1";
const LEADERBOARD_CACHE_KEY = "global-momentum";
const MAX_CACHE_AGE_HOURS = Number(process.env.MVP_HEALTH_MAX_CACHE_AGE_HOURS || 24);
const HEALTH_READ_TIMEOUT_MS = Number(process.env.MVP_HEALTH_READ_TIMEOUT_MS || 3000);

function ageHours(value = "") {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 36e5;
}

function stateForCache(snapshot = null, error = "") {
  if (error) return { state: "warn", label: "lectura degradada", ageHours: null, error };
  if (!snapshot) return { state: "warn", label: "sin snapshot", ageHours: null };
  const age = ageHours(snapshot.generatedAt || snapshot.updatedAt);
  if (!Number.isFinite(age)) return { state: "warn", label: "sin fecha", ageHours: null };
  if (age > MAX_CACHE_AGE_HOURS) return { state: "warn", label: "snapshot viejo", ageHours: age };
  return { state: "pass", label: "snapshot reciente", ageHours: age };
}

function aggregateState(checks = []) {
  if (checks.some((item) => item.state === "fail")) return "fail";
  if (checks.some((item) => item.state === "warn")) return "warn";
  return "pass";
}

async function latestRuns() {
  const config = supabaseConfig();
  if (!config.configured) return [];
  try {
    return await supabaseRequest("provider_runs", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&select=provider,run_type,status,started_at,finished_at,stats,error&order=started_at.desc&limit=12`,
      timeoutMs: HEALTH_READ_TIMEOUT_MS,
    });
  } catch {
    return [];
  }
}

async function readSnapshotMeta(key = "") {
  const config = supabaseConfig();
  if (!config.configured || !key) return null;
  const rows = await supabaseRequest("leaderboard_snapshots", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&leaderboard_key=eq.${encodeURIComponent(key)}&select=leaderboard_key,title,strategy,item_count,generated_at,updated_at,source&order=generated_at.desc&limit=1`,
    timeoutMs: HEALTH_READ_TIMEOUT_MS,
  });
  const row = rows?.[0];
  if (!row) return null;
  return {
    key: row.leaderboard_key,
    title: row.title,
    count: Number(row.item_count || 0),
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    strategy: row.strategy || "",
    source: row.source || "leaderboard_snapshots",
  };
}

async function safeReadSnapshotMeta(key = "") {
  try {
    return { snapshot: await readSnapshotMeta(key), error: "" };
  } catch (error) {
    return { snapshot: null, error: error.message || "snapshot read failed" };
  }
}

function runSummary(runs = [], provider = "") {
  const run = runs.find((item) => item.provider === provider);
  if (!run) return { state: "warn", label: "sin ejecucion", provider };
  return {
    state: run.status === "completed" ? "pass" : run.status === "started" ? "warn" : "fail",
    label: run.status,
    provider,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    error: run.error || "",
    stats: run.stats || {},
  };
}

export async function GET(request) {
  const authError = requirePersistenceAuth(request);
  if (authError) return authError;

  const startedAt = Date.now();
  const config = supabaseConfig();
  const [discoveryResult, leaderboardResult, methodology, runs] = await Promise.all([
    safeReadSnapshotMeta(DISCOVERY_CACHE_KEY),
    safeReadSnapshotMeta(LEADERBOARD_CACHE_KEY),
    readMethodologyHealth().catch((error) => ({ ok: false, status: "error", detail: error.message })),
    latestRuns(),
  ]);

  const discovery = discoveryResult.snapshot;
  const leaderboard = leaderboardResult.snapshot;
  const discoveryCache = stateForCache(discovery, discoveryResult.error);
  const leaderboardCache = stateForCache(leaderboard, leaderboardResult.error);
  const methodologyCheck = {
    state: methodology.status === "pass" ? "pass" : methodology.status === "fail" || methodology.status === "error" ? "fail" : "warn",
    label: methodology.label || methodology.status || "metodologia",
    detail: methodology.detail || "",
    totals: methodology.totals || null,
    calibration: methodology.calibration || null,
  };
  const checks = [
    { area: "supabase", state: config.configured ? "pass" : "warn", label: config.configured ? "configurado" : "sin configurar", missing: config.missing },
    { area: "discovery-cache", ...discoveryCache, key: DISCOVERY_CACHE_KEY, rows: discovery?.count || 0 },
    { area: "leaderboards-cache", ...leaderboardCache, key: LEADERBOARD_CACHE_KEY, rows: leaderboard?.count || 0 },
    { area: "methodology", ...methodologyCheck },
    { area: "job-discovery", ...runSummary(runs, "statsedge-discovery") },
    { area: "job-leaderboards", ...runSummary(runs, "statsedge-leaderboards") },
  ];
  const status = aggregateState(checks);

  return Response.json({
    ok: status !== "fail",
    status,
    label: status === "pass" ? "MVP operativo" : status === "warn" ? "MVP degradado" : "MVP bloqueado",
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    thresholds: { maxCacheAgeHours: MAX_CACHE_AGE_HOURS, readTimeoutMs: HEALTH_READ_TIMEOUT_MS },
    checks,
    latestRuns: runs.slice(0, 6),
  });
}
