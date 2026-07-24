import { readScanBatchCursor } from "@/lib/materializedScanner";
import { disabledPayload, requirePersistenceAuth, supabaseConfig, supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";

const DEFAULT_SINCE_DAYS = 45;
const DEFAULT_LIMIT = 10000;
const DEFAULT_MAX_PRICE_FRESHNESS_DAYS = 5;
const DEFAULT_MIN_COVERAGE = 40;

function numberParam(searchParams, key, fallback, min, max) {
  const raw = searchParams.get(key);
  const n = raw === null || raw === "" ? fallback : Number(raw);
  const value = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(value, min), max);
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function boolParam(searchParams, key, fallback = false) {
  const raw = searchParams.get(key);
  if (raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(raw).toLowerCase());
}

function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function numberObject(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Number(item || 0)]));
}

function metric(row = {}, key = "") {
  return firstFinite(row[key], row.metrics?.[key], row.raw?.[key], row.raw?.growthMetrics?.[key]);
}

function metricText(row = {}, key = "") {
  return cleanText(row[key] || row.metrics?.[key] || row.raw?.[key] || "");
}

function priceFreshness(row = {}, maxDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS, nowMs = Date.now()) {
  const stored = metric(row, "priceFreshnessDays");
  if (Number.isFinite(stored)) return { days: stored, ok: stored <= maxDays };
  const lastDate = metricText(row, "lastDate");
  const timestamp = Date.parse(lastDate);
  if (!Number.isFinite(timestamp)) return { days: null, ok: false };
  const days = Math.max(0, Math.floor((nowMs - timestamp) / 86400000));
  return { days, ok: days <= maxDays };
}

// ---------------------------------------------------------------------------
// LEGACY REFERENCE (pure). Estas helpers reproducen exactamente la logica que
// la RPC scan_coverage_breakdown (supabase/migrations/*_scan_coverage_breakdown.sql)
// ejecuta en Postgres. Se mantienen exportadas para:
//   1. tests de paridad (tests/integration/scan-coverage-breakdown.real.test.mjs
//      compara RPC vs summarizeScanCoverageBreakdown sobre el mismo dataset), y
//   2. fallback/documentacion viva del contrato.
// NO se llaman en el path en caliente del GET — el GET consume el payload
// agregado que devuelve la RPC. Mismo patron que scanRowShape/summarizeScanCoverageRows
// en lib/coveragePlan.js para /api/coverage.
// ---------------------------------------------------------------------------

export function rowShape(item = {}, maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS, minCoverage = DEFAULT_MIN_COVERAGE, nowMs = Date.now()) {
  const freshness = priceFreshness(item, maxPriceFreshnessDays, nowMs);
  const coverage = metric(item, "dataCoverageScore");
  const totalScore = firstFinite(item.raw?.totalScore, item.metrics?.totalScore, item.total_score);
  const objectiveScore = firstFinite(item.raw?.objectiveScore, item.metrics?.objectiveScore, totalScore);
  const qualityOk = freshness.ok && (!Number.isFinite(coverage) || coverage >= minCoverage);
  const rankingEligible = qualityOk && (!Number.isFinite(objectiveScore) || objectiveScore >= 45);
  return {
    symbol: cleanText(item.symbol || item.raw?.symbol).toUpperCase(),
    country: cleanText(item.country || item.raw?.country || "US"),
    sector: cleanText(item.sector || item.raw?.sector || "Sin sector"),
    industry: cleanText(item.industry || item.raw?.industry || "Sin industria"),
    theme: cleanText(item.theme || item.raw?.theme || ""),
    objectiveScore,
    totalScore,
    dataCoverageScore: coverage,
    priceFreshnessDays: freshness.days,
    priceFresh: freshness.ok,
    qualityOk,
    rankingEligible,
    actionable: rankingEligible,
    lastDate: metricText(item, "lastDate"),
    chartProvider: metricText(item, "chartProvider"),
    createdAt: item.created_at || "",
  };
}

export function latestBySymbol(rows = []) {
  const bySymbol = new Map();
  for (const row of rows) {
    if (!row.symbol) continue;
    const previous = bySymbol.get(row.symbol);
    const currentTime = Date.parse(row.createdAt || "") || 0;
    const previousTime = Date.parse(previous?.createdAt || "") || 0;
    if (!previous || currentTime >= previousTime) bySymbol.set(row.symbol, row);
  }
  return [...bySymbol.values()];
}

export function topSymbols(rows = [], limit = 5) {
  return [...rows]
    .sort((a, b) => (b.objectiveScore || 0) - (a.objectiveScore || 0))
    .slice(0, limit)
    .map((row) => ({
      symbol: row.symbol,
      score: Number.isFinite(row.objectiveScore) ? Math.round(row.objectiveScore) : null,
      fresh: row.priceFresh,
      coverage: Number.isFinite(row.dataCoverageScore) ? Math.round(row.dataCoverageScore) : null,
    }));
}

export function groupCoverage(rows = [], field = "country", { includeTop = false } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = cleanText(row[field] || "Sin dato");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const fresh = items.filter((row) => row.priceFresh).length;
      const base = {
        key,
        uniqueSymbols: items.length,
        fresh,
        freshPct: pct(fresh, items.length),
        qualityOk: items.filter((row) => row.qualityOk).length,
        rankingEligible: items.filter((row) => row.rankingEligible).length,
        actionable: items.filter((row) => row.rankingEligible).length,
        avgCoverageScore: avg(items.map((row) => row.dataCoverageScore)),
        avgTotalScore: avg(items.map((row) => row.totalScore)),
      };
      if (includeTop) base.topSymbols = topSymbols(items, 5);
      return base;
    })
    .sort((a, b) => b.uniqueSymbols - a.uniqueSymbols || b.actionable - a.actionable || a.key.localeCompare(b.key));
}

function rejectionReason(reason = "") {
  const text = cleanText(reason).toLowerCase();
  if (text.startsWith("precio bajo")) return "precio bajo";
  if (text.startsWith("historico insuficiente") || text.startsWith("histórico insuficiente")) return "historico insuficiente";
  if (text.startsWith("turnover bajo")) return "turnover bajo";
  if (text.startsWith("market cap bajo")) return "market cap bajo";
  return cleanText(reason || "sin clasificar");
}

function rejectionSummary(rejections = []) {
  if (!Array.isArray(rejections)) return [];
  const counts = new Map();
  for (const item of rejections) {
    const reason = rejectionReason(item?.reason || item);
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function sanitizeRunStats(stats = {}) {
  const selection = stats.selection && typeof stats.selection === "object" ? stats.selection : {};
  const cursor = stats.cursor && typeof stats.cursor === "object" ? stats.cursor : null;
  const cache = stats.cache && typeof stats.cache === "object" ? stats.cache : null;
  const leaderboards = stats.leaderboards && typeof stats.leaderboards === "object" ? stats.leaderboards : null;
  const savedScan = stats.savedScan && typeof stats.savedScan === "object" ? stats.savedScan : null;
  const recentScanExclusion = stats.recentScanExclusion && typeof stats.recentScanExclusion === "object" ? stats.recentScanExclusion : null;
  return {
    markets: Array.isArray(stats.markets) ? stats.markets.map(cleanText).filter(Boolean) : [],
    universeTotal: Number(stats.universeTotal || 0),
    selected: Number(stats.selected || 0),
    passedBase: Number(stats.passedBase || 0),
    savedRows: Number(stats.savedRows || 0),
    rejected: Number(stats.rejected || 0),
    rejectionReasons: rejectionSummary(stats.rejections),
    selection: {
      marketTotals: numberObject(selection.marketTotals),
      selectedByMarket: numberObject(selection.selectedByMarket),
      marketOffsets: numberObject(selection.marketOffsets),
      nextMarketOffsets: numberObject(selection.nextMarketOffsets),
      skippedRecent: Number(selection.skippedRecent || 0),
      skippedRecentByMarket: numberObject(selection.skippedRecentByMarket),
    },
    recentScanExclusion: recentScanExclusion ? {
      enabled: Boolean(recentScanExclusion.enabled),
      skipped: Boolean(recentScanExclusion.skipped),
      days: Number(recentScanExclusion.days || 0),
      rowsRead: Number(recentScanExclusion.rowsRead || 0),
      count: Number(recentScanExclusion.count || 0),
      byMarket: numberObject(recentScanExclusion.byMarket),
      error: cleanText(recentScanExclusion.error || ""),
    } : null,
    cursor: cursor ? {
      used: Boolean(cursor.used),
      saved: Boolean(cursor.saved),
      skipped: Boolean(cursor.skipped),
      offsets: numberObject(cursor.offsets),
      nextOffsets: numberObject(cursor.nextOffsets),
    } : null,
    leaderboards: leaderboards ? {
      saved: Number(leaderboards.saved || 0),
      skipped: Boolean(leaderboards.skipped),
    } : null,
    savedScan: savedScan ? {
      saved: Boolean(savedScan.saved),
      rows: Number(savedScan.rows || 0),
    } : null,
    cache: cache ? {
      hit: Boolean(cache.hit),
      status: cleanText(cache.status),
      written: Boolean(cache.written),
    } : null,
  };
}

// Referencia pura de paridad: aplica las mismas reglas (rowShape → latestBySymbol
// → groupCoverage por country y sector → totals/avg) que la RPC ejecuta en
// Postgres. El test real compara esta salida contra scan_coverage_breakdown para
// el mismo dataset. Shape identica a la del payload RPC (jsonb_build_object).
export function summarizeScanCoverageBreakdown(rows = [], { maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS, minCoverageScore = DEFAULT_MIN_COVERAGE, includeTop = false, nowMs = Date.now() } = {}) {
  const shaped = latestBySymbol((rows || []).map((row) => rowShape(row, maxPriceFreshnessDays, minCoverageScore, nowMs)));
  const fresh = shaped.filter((row) => row.priceFresh).length;
  const qualityOk = shaped.filter((row) => row.qualityOk).length;
  const rankingEligible = shaped.filter((row) => row.rankingEligible).length;
  const latestScanAt = shaped.map((row) => Date.parse(row.createdAt || "") || 0).sort((a, b) => b - a)[0];
  return {
    rowsRead: rows?.length || 0,
    uniqueSymbols: shaped.length,
    fresh,
    qualityOk,
    rankingEligible,
    actionable: rankingEligible,
    avgCoverageScore: avg(shaped.map((row) => row.dataCoverageScore)),
    avgTotalScore: avg(shaped.map((row) => row.totalScore)),
    latestScanAt: latestScanAt ? new Date(latestScanAt).toISOString() : "",
    byCountry: groupCoverage(shaped, "country", { includeTop }),
    bySector: groupCoverage(shaped, "sector", { includeTop }).slice(0, 25),
  };
}

// Lee el desglose agregado via RPC (scan_coverage_breakdown) en vez de transferir
// metrics/raw completos de scan_results. Devuelve el payload agregado chico.
async function readScanCoverageBreakdown(config, { sinceDays, limit, maxPriceFreshnessDays, minCoverageScore, includeTop }) {
  const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString();
  const now = new Date();
  const payload = await supabaseRpc("scan_coverage_breakdown", {
    p_owner_id: config.ownerId,
    p_since: since,
    p_max_rows: limit,
    p_max_price_freshness_days: maxPriceFreshnessDays,
    p_min_coverage_score: minCoverageScore,
    p_include_top: Boolean(includeTop),
    p_now: now.toISOString(),
  });
  return Array.isArray(payload) ? payload[0] || {} : payload || {};
}

async function readLeaderboards(config) {
  return supabaseRequest("leaderboard_snapshots", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&select=leaderboard_key,title,strategy,scope_type,scope_value,item_count,generated_at,updated_at&order=generated_at.desc&limit=50`,
  });
}

async function readProviderRuns(config) {
  return supabaseRequest("provider_runs", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&select=provider,run_type,market,status,started_at,finished_at,stats,error&order=started_at.desc&limit=20`,
  });
}

export async function settleScanCoverageDependency(area, promise, fallback) {
  try {
    return { area, value: await promise, failure: null };
  } catch (error) {
    return {
      area,
      value: fallback,
      failure: { area, message: error.message || `${area} unavailable` },
    };
  }
}

export async function GET(request) {
  const authError = requirePersistenceAuth(request);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), ok: true });
  const { searchParams } = new URL(request.url);
  const sinceDays = numberParam(searchParams, "sinceDays", DEFAULT_SINCE_DAYS, 1, 365);
  const limit = numberParam(searchParams, "limit", DEFAULT_LIMIT, 1, 20000);
  const maxPriceFreshnessDays = numberParam(searchParams, "maxPriceFreshnessDays", DEFAULT_MAX_PRICE_FRESHNESS_DAYS, 1, 999);
  const minCoverageScore = numberParam(searchParams, "minCoverageScore", DEFAULT_MIN_COVERAGE, 0, 100);
  const includeTop = boolParam(searchParams, "includeTop", false);

  try {
    const [breakdown, leaderboardsResult, providerRunsResult, cursorResult] = await Promise.all([
      readScanCoverageBreakdown(config, { sinceDays, limit, maxPriceFreshnessDays, minCoverageScore, includeTop }),
      settleScanCoverageDependency("leaderboards", readLeaderboards(config), []),
      settleScanCoverageDependency("provider-runs", readProviderRuns(config), []),
      settleScanCoverageDependency("scan-cursor", readScanBatchCursor(), { value: {}, updatedAt: "" }),
    ]);
    const leaderboards = leaderboardsResult.value;
    const providerRuns = providerRunsResult.value;
    const cursor = cursorResult.value;
    const failures = [leaderboardsResult.failure, providerRunsResult.failure, cursorResult.failure].filter(Boolean);
    // La RPC ya aplicó latestBySymbol + freshness/coverage/eligibility + agrupado
    // por country y sector en Postgres. Solo derivamos los *Pct de summary sobre
    // uniqueSymbols (igual que antes con pct()).
    const uniqueSymbols = Number(breakdown.uniqueSymbols || 0);
    const fresh = Number(breakdown.fresh || 0);
    const qualityOk = Number(breakdown.qualityOk || 0);
    const rankingEligible = Number(breakdown.rankingEligible || 0);
    const actionable = rankingEligible;

    return Response.json({
      ok: true,
      configured: true,
      degraded: failures.length > 0,
      status: failures.length ? "partial-secondary-dependencies" : "complete",
      failures,
      legalMode: includeTop ? "derived-aggregate-with-limited-top-samples" : "derived-aggregate-only",
      generatedAt: new Date().toISOString(),
      window: { sinceDays, rowsRead: Number(breakdown.rowsRead || 0), maxRows: limit },
      thresholds: { maxPriceFreshnessDays, minCoverageScore },
      summary: {
        uniqueSymbols,
        fresh,
        freshPct: pct(fresh, uniqueSymbols),
        qualityOk,
        qualityPct: pct(qualityOk, uniqueSymbols),
        rankingEligible,
        rankingEligiblePct: pct(rankingEligible, uniqueSymbols),
        actionable,
        actionablePct: pct(actionable, uniqueSymbols),
        avgCoverageScore: breakdown.avgCoverageScore ?? null,
        avgTotalScore: breakdown.avgTotalScore ?? null,
        latestScanAt: breakdown.latestScanAt || "",
      },
      byCountry: breakdown.byCountry || [],
      bySector: (breakdown.bySector || []).slice(0, 25),
      leaderboards: {
        count: leaderboards.length,
        populated: leaderboards.filter((item) => Number(item.item_count || 0) > 0).length,
        latest: leaderboards.slice(0, 10).map((item) => ({
          key: item.leaderboard_key,
          title: item.title,
          strategy: item.strategy,
          count: Number(item.item_count || 0),
          generatedAt: item.generated_at,
        })),
      },
      cursor: {
        updatedAt: cursor.updatedAt || cursor.value?.updatedAt || "",
        markets: cursor.value?.markets || {},
        lastRun: cursor.value?.lastRun || null,
      },
      providerRuns: providerRuns.slice(0, 10).map((run) => ({
        provider: run.provider,
        runType: run.run_type,
        market: run.market,
        status: run.status,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        error: run.error || "",
        stats: sanitizeRunStats(run.stats || {}),
      })),
    });
  } catch (error) {
    return Response.json({ ok: false, configured: true, error: error.message || "Scan coverage unavailable", details: error.details || null }, { status: 500 });
  }
}
