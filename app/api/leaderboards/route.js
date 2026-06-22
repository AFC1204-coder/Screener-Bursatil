import { buildGroupedLeaderboards, buildLeaderboard, DEFAULT_LEADERBOARD_SPECS, readMaterializedLeaderboard, readScanRows, writeMaterializedLeaderboards } from "@/lib/leaderboards";
import { SCREENER_FILTER_QUERY_KEYS } from "@/lib/screenerFilters";
import { requirePersistenceAuth } from "@/lib/supabaseServer";

const DEFAULT_LEADERBOARD_SCAN_ROWS = 900;
const DEFAULT_LEADERBOARD_SINCE_DAYS = 21;
const DEFAULT_LEADERBOARD_READ_TIMEOUT_MS = Number(process.env.LEADERBOARD_READ_TIMEOUT_MS || 3500);
const MAX_LEADERBOARD_SCAN_ROWS = Number(process.env.LEADERBOARD_MAX_SCAN_ROWS || DEFAULT_LEADERBOARD_SCAN_ROWS);
const MAX_LEADERBOARD_SINCE_DAYS = Number(process.env.LEADERBOARD_MAX_SINCE_DAYS || DEFAULT_LEADERBOARD_SINCE_DAYS);

function paramsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  const params = {
    key: searchParams.get("key") || searchParams.get("list") || "",
    title: searchParams.get("title") || "",
    strategy: searchParams.get("strategy") || searchParams.get("type") || "",
    scopeType: searchParams.get("scopeType") || searchParams.get("scope") || "",
    scopeValue: searchParams.get("scopeValue") || "",
    country: searchParams.get("country") || searchParams.get("market") || "",
    sector: searchParams.get("sector") || "",
    industry: searchParams.get("industry") || "",
    theme: searchParams.get("theme") || "",
    groupBy: searchParams.get("groupBy") || "",
    limit: searchParams.get("limit") || "",
    groupsLimit: searchParams.get("groupsLimit") || "",
    minGroupSize: searchParams.get("minGroupSize") || "",
    minCoverageScore: searchParams.get("minCoverageScore") || "",
    minTotalScore: searchParams.get("minTotalScore") || "",
    minRs: searchParams.get("minRs") || "",
    minMarketCap: searchParams.get("minMarketCap") || "",
    minAvgTurnover: searchParams.get("minAvgTurnover") || "",
    maxPriceFreshnessDays: searchParams.get("maxPriceFreshnessDays") || "",
    maxRows: searchParams.get("maxRows") || "",
    sinceDays: searchParams.get("sinceDays") || "",
    cache: searchParams.get("cache") !== "0",
  };
  for (const key of SCREENER_FILTER_QUERY_KEYS) {
    if (searchParams.has(key)) params[key] = searchParams.get(key);
  }
  if (searchParams.has("preset") && !params.filterPreset) params.filterPreset = searchParams.get("preset");
  return params;
}

function apiPayload(payload = {}) {
  return {
    ok: true,
    legalMode: "derived-signals-only",
    note: "Leaderboards exponen rankings y metricas derivadas desde scans guardados; no publican universos completos ni datasets OHLCV crudos.",
    ...payload,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boundedInt(value, fallback, max) {
  const n = numberOrNull(value);
  const normalized = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(Math.round(normalized), 1), Math.max(Math.round(max || fallback), 1));
}

function readOptions(params = {}) {
  const requestedMaxRows = numberOrNull(params.maxRows);
  const requestedSinceDays = numberOrNull(params.sinceDays);
  const maxRows = boundedInt(params.maxRows, DEFAULT_LEADERBOARD_SCAN_ROWS, MAX_LEADERBOARD_SCAN_ROWS);
  const sinceDays = boundedInt(params.sinceDays, DEFAULT_LEADERBOARD_SINCE_DAYS, MAX_LEADERBOARD_SINCE_DAYS);
  return {
    maxRows,
    sinceDays,
    timeoutMs: DEFAULT_LEADERBOARD_READ_TIMEOUT_MS,
    bounded: (Number.isFinite(requestedMaxRows) && requestedMaxRows > maxRows)
      || (Number.isFinite(requestedSinceDays) && requestedSinceDays > sinceDays),
  };
}

function limitCachedLeaderboard(leaderboard = null, limitValue = "") {
  if (!leaderboard) return leaderboard;
  const limit = Number(limitValue);
  if (!Number.isFinite(limit) || limit <= 0) return leaderboard;
  const items = (leaderboard.items || []).slice(0, Math.min(Math.round(limit), 50)).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
  return {
    ...leaderboard,
    count: items.length,
    items,
    cache: {
      ...(leaderboard.cache || {}),
      originalCount: leaderboard.count,
    },
  };
}

function mergeSpecParams(spec, params) {
  if (!spec) return params;
  return {
    ...params,
    key: spec.key,
    title: params.title || spec.title,
    strategy: params.strategy || spec.strategy,
    scopeType: params.scopeType || spec.scopeType,
    scopeValue: params.scopeValue || spec.scopeValue,
  };
}

function recoverableReadError(error = {}) {
  const status = Number(error.status || 0);
  const text = `${error.message || ""} ${JSON.stringify(error.details || "")}`.toLowerCase();
  return status >= 500
    || text.includes("timeout")
    || text.includes("fetch failed")
    || text.includes("cloudflare")
    || text.includes("web server is down")
    || text.includes("error code 521");
}

export async function GET(request) {
  const params = paramsFromRequest(request);
  try {
    const hasScreenerFilterParams = SCREENER_FILTER_QUERY_KEYS.some((key) => params[key] !== undefined && params[key] !== "");
    const cacheSpec = DEFAULT_LEADERBOARD_SPECS.find((item) => item.key === params.key)
      || (!params.key ? DEFAULT_LEADERBOARD_SPECS.find((item) => item.strategy === params.strategy) : null);
    const canUseMaterialized = params.cache && cacheSpec && !params.groupBy && !params.maxPriceFreshnessDays
      && !params.minCoverageScore && !params.minTotalScore && !params.minRs && !params.minMarketCap && !params.minAvgTurnover
      && !params.country && !params.sector && !params.industry && !params.theme && !params.scopeValue && !hasScreenerFilterParams;
    if (canUseMaterialized) {
      const cached = await readMaterializedLeaderboard(cacheSpec.key).catch(() => null);
      if (cached?.criteria && Object.hasOwn(cached.criteria, "maxPriceFreshnessDays")) {
        return Response.json(apiPayload({
          configured: true,
          source: "leaderboard_snapshots",
          leaderboard: limitCachedLeaderboard(cached, params.limit),
          predefined: DEFAULT_LEADERBOARD_SPECS,
        }));
      }
    }

    let scanData;
    const read = readOptions(params);
    try {
      scanData = await readScanRows(read);
    } catch (error) {
      if (!recoverableReadError(error)) throw error;
      const spec = DEFAULT_LEADERBOARD_SPECS.find((item) => item.key === params.key) || cacheSpec;
      const cached = spec ? await readMaterializedLeaderboard(spec.key).catch(() => null) : null;
      if (cached) {
        return Response.json(apiPayload({
          configured: true,
          source: "leaderboard_snapshots",
          degraded: true,
          fallback: { reason: error.message || "Supabase scan_results unavailable", read },
          leaderboard: limitCachedLeaderboard(cached, params.limit),
          predefined: DEFAULT_LEADERBOARD_SPECS,
        }));
      }
      const leaderboard = buildLeaderboard([], mergeSpecParams(spec, params));
      return Response.json(apiPayload({
        configured: true,
        source: "scan_results_unavailable",
        degraded: true,
        fallback: { reason: error.message || "Supabase scan_results unavailable", read },
        leaderboard,
        predefined: DEFAULT_LEADERBOARD_SPECS,
      }));
    }
    if (!scanData.configured) return Response.json(apiPayload({ ...scanData, leaderboard: null, leaderboards: [] }));

    if (params.groupBy) {
      const leaderboards = buildGroupedLeaderboards(scanData.rows, params);
      return Response.json(apiPayload({
        configured: true,
        source: "scan_results",
        inputRows: scanData.rows.length,
        leaderboards,
        predefined: DEFAULT_LEADERBOARD_SPECS,
        effectiveRead: read,
      }));
    }

    const spec = DEFAULT_LEADERBOARD_SPECS.find((item) => item.key === params.key);
    const leaderboard = buildLeaderboard(scanData.rows, mergeSpecParams(spec, params));
    return Response.json(apiPayload({
      configured: true,
      source: "scan_results",
      inputRows: scanData.rows.length,
      leaderboard,
      predefined: DEFAULT_LEADERBOARD_SPECS,
      effectiveRead: read,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Leaderboards unavailable", details: error.details || null }, { status: 500 });
  }
}

export async function POST(request) {
  const authError = requirePersistenceAuth(request);
  if (authError) return authError;
  try {
    const body = await request.json().catch(() => ({}));
    const specs = Array.isArray(body.specs) && body.specs.length ? body.specs : DEFAULT_LEADERBOARD_SPECS;
    const scanData = await readScanRows({ maxRows: body.maxRows, sinceDays: body.sinceDays });
    if (!scanData.configured) return Response.json(apiPayload({ ...scanData, saved: 0 }));
    const bodyFilters = Object.fromEntries(SCREENER_FILTER_QUERY_KEYS.filter((key) => body[key] !== undefined && body[key] !== "").map((key) => [key, body[key]]));
    const leaderboards = specs.map((spec) => buildLeaderboard(scanData.rows, { limit: body.limit || 25, ...bodyFilters, ...spec }));
    const saved = await writeMaterializedLeaderboards(leaderboards);
    return Response.json(apiPayload({
      configured: true,
      source: "scan_results",
      inputRows: scanData.rows.length,
      ...saved,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Leaderboards refresh failed", details: error.details || null }, { status: 500 });
  }
}
