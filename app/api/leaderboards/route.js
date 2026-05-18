import { buildGroupedLeaderboards, buildLeaderboard, DEFAULT_LEADERBOARD_SPECS, readMaterializedLeaderboard, readScanRows, writeMaterializedLeaderboards } from "@/lib/leaderboards";
import { requirePersistenceAuth } from "@/lib/supabaseServer";

function paramsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  return {
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
    maxRows: searchParams.get("maxRows") || "",
    sinceDays: searchParams.get("sinceDays") || "",
    cache: searchParams.get("cache") !== "0",
  };
}

function apiPayload(payload = {}) {
  return {
    ok: true,
    legalMode: "derived-signals-only",
    note: "Leaderboards exponen rankings y metricas derivadas desde scans guardados; no publican universos completos ni datasets OHLCV crudos.",
    ...payload,
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

export async function GET(request) {
  const params = paramsFromRequest(request);
  try {
    if (params.cache && params.key && !params.groupBy) {
      const cached = await readMaterializedLeaderboard(params.key).catch(() => null);
      if (cached) return Response.json(apiPayload({ configured: true, leaderboard: cached }));
    }

    const scanData = await readScanRows({ maxRows: params.maxRows, sinceDays: params.sinceDays });
    if (!scanData.configured) return Response.json(apiPayload({ ...scanData, leaderboard: null, leaderboards: [] }));

    if (params.groupBy) {
      const leaderboards = buildGroupedLeaderboards(scanData.rows, params);
      return Response.json(apiPayload({
        configured: true,
        source: "scan_results",
        inputRows: scanData.rows.length,
        leaderboards,
        predefined: DEFAULT_LEADERBOARD_SPECS,
      }));
    }

    const spec = DEFAULT_LEADERBOARD_SPECS.find((item) => item.key === params.key);
    const leaderboard = buildLeaderboard(scanData.rows, mergeSpecParams(spec, params));
    return Response.json(apiPayload({
      configured: true,
      source: "scan_results",
      leaderboard,
      predefined: DEFAULT_LEADERBOARD_SPECS,
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
    const leaderboards = specs.map((spec) => buildLeaderboard(scanData.rows, { limit: body.limit || 25, ...spec }));
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
