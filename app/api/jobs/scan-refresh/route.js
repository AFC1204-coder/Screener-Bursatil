import { envValue } from "@/lib/env";
import { normalizeMarketList } from "@/lib/markets";
import {
  DEFAULT_MATERIALIZED_MARKETS,
  planMaterializedScan,
  readScanBatchCursor,
  refreshDefaultLeaderboards,
  runMaterializedScan,
  writeMaterializedScan,
  writeScanBatchCursor,
} from "@/lib/materializedScanner";
import { screenerFiltersFromSearchParams } from "@/lib/screenerFilters";
import { readPricedShadowSymbols } from "@/lib/shadowUniverseStore";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const DEFAULT_PER_MARKET = 10;
const MAX_CONCURRENCY = 4;

function authorized(request) {
  const secret = envValue("CRON_SECRET");
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

function cleanList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function numberParam(searchParams, key, fallback, min, max) {
  const raw = searchParams.get(key);
  const n = raw === null || raw === "" ? fallback : Number(raw);
  const value = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(value, min), max);
}

function boolParam(searchParams, key, fallback = false) {
  const raw = searchParams.get(key);
  if (raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(raw).toLowerCase());
}

function boolOverride(value, fallback = true) {
  if (value === null || value === undefined || value === "") return fallback;
  return !["0", "false", "no", "n", "off", "cursor"].includes(String(value).toLowerCase());
}

function optionsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  const symbols = cleanList(searchParams.get("symbols"));
  const markets = normalizeMarketList(cleanList(searchParams.get("markets") || searchParams.get("market")), []);
  const offsetProvided = searchParams.has("offset");
  const limit = symbols.length
    ? Math.min(symbols.length, MAX_LIMIT)
    : numberParam(searchParams, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
  const perMarket = symbols.length
    ? 0
    : numberParam(searchParams, "perMarket", markets.length > 1 || !markets.length ? DEFAULT_PER_MARKET : 0, 0, MAX_LIMIT);
  const refreshPrices = boolParam(searchParams, "refreshPrices", false);
  const refreshProfiles = boolParam(searchParams, "refreshProfiles", false);
  const skipRecentOverride = searchParams.get("skipRecent") ?? searchParams.get("skipRecentlyScanned");
  const rescanRecent = boolParam(searchParams, "rescanRecent", false);
  const skipRecentDisabled = ["0", "false", "no", "n"].includes(String(skipRecentOverride || "").toLowerCase());
  const skipRecentlyScanned = !symbols.length
    && !refreshPrices
    && !refreshProfiles
    && !rescanRecent
    && !skipRecentDisabled;
  const recentScanMaxRows = numberParam(searchParams, "recentScanMaxRows", 20000, 1, 50000);
  const priorityOverride = searchParams.get("prioritizeMaterialization") ?? searchParams.get("materializationPriority");
  return {
    symbols,
    markets: markets.length ? markets : DEFAULT_MATERIALIZED_MARKETS,
    limit,
    perMarket,
    offset: numberParam(searchParams, "offset", 0, 0, 100000),
    offsetProvided,
    concurrency: numberParam(searchParams, "concurrency", 2, 1, MAX_CONCURRENCY),
    maxSavedRows: numberParam(searchParams, "maxSavedRows", 500, 1, 2000),
    maxPriceFreshnessDays: numberParam(searchParams, "maxPriceFreshnessDays", 5, 1, 999),
    maxFundamentalsAgeDays: numberParam(searchParams, "maxFundamentalsAgeDays", 14, 1, 365),
    minBars: numberParam(searchParams, "minBars", 180, 20, 1000),
    minPrice: numberParam(searchParams, "minPrice", 1, 0, 100000),
    minAvgTurnover: numberParam(searchParams, "minAvgTurnover", 250000, 0, 1000000000),
    minMarketCap: numberParam(searchParams, "minMarketCap", 300000000, 0, 10000000000000),
    minCoverageScore: numberParam(searchParams, "minCoverageScore", 40, 0, 100),
    refreshUniverse: searchParams.get("refreshUniverse") === "1",
    refreshPrices,
    refreshProfiles,
    cache: searchParams.get("cache") !== "0",
    skipRecentlyScanned,
    recentScanDays: numberParam(searchParams, "recentScanDays", 45, 1, 365),
    recentScanMaxRows,
    materializationLookbackDays: numberParam(searchParams, "materializationLookbackDays", 365, 1, 1095),
    materializationMaxRows: numberParam(searchParams, "materializationMaxRows", recentScanMaxRows, 1, 50000),
    prioritizeMaterialization: !symbols.length && boolOverride(priorityOverride, true),
    useCursor: !symbols.length && !offsetProvided && searchParams.get("cursor") !== "0",
    resetCursor: searchParams.get("resetCursor") === "1",
    refreshLeaderboards: searchParams.get("leaderboards") !== "0",
    includeRows: searchParams.get("includeRows") === "1",
    dryRun: boolParam(searchParams, "dryRun", false),
    shadowPriced: searchParams.get("shadowPriced") === "1",
    shadowStatus: searchParams.get("shadowStatus") || "priced",
    screenerFilters: screenerFiltersFromSearchParams(searchParams),
  };
}

async function resolveShadowPricedOptions(options = {}) {
  if (!options.shadowPriced || options.symbols.length) return options;
  const priced = await readPricedShadowSymbols({
    markets: options.markets,
    status: options.shadowStatus,
    perMarket: options.perMarket || DEFAULT_PER_MARKET,
    limit: options.limit,
  });
  const symbols = (priced.rows || []).map((row) => row.symbol).filter(Boolean);
  return {
    ...options,
    symbols,
    limit: symbols.length ? Math.min(symbols.length, options.limit) : options.limit,
    perMarket: 0,
    useCursor: false,
    shadowSource: {
      enabled: true,
      status: priced.status,
      requestedStatus: options.shadowStatus,
      rows: priced.rows?.length || 0,
      markets: options.markets,
    },
  };
}

function cursorOffsets(cursor = {}, options = {}) {
  if (!options.useCursor) return {};
  const markets = cursor.markets && typeof cursor.markets === "object" ? cursor.markets : {};
  return Object.fromEntries(options.markets.map((market) => [
    market,
    options.resetCursor ? 0 : Math.max(Number(markets[market]?.offset || 0), 0),
  ]));
}

function nextCursorValue(previous = {}, options = {}, result = {}, savedScan = {}) {
  const markets = { ...((previous.markets && typeof previous.markets === "object") ? previous.markets : {}) };
  const selection = result.stats?.selection || {};
  const nextOffsets = selection.nextMarketOffsets || {};
  const selectedByMarket = selection.selectedByMarket || {};
  const marketTotals = selection.marketTotals || {};
  const now = new Date().toISOString();
  for (const market of options.markets) {
    if (!(market in nextOffsets)) continue;
    markets[market] = {
      offset: Math.max(Number(nextOffsets[market] || 0), 0),
      previousOffset: Math.max(Number(selection.marketOffsets?.[market] || 0), 0),
      selected: Number(selectedByMarket[market] || 0),
      universeTotal: Number(marketTotals[market] || 0),
      lastRunAt: now,
      lastScanId: savedScan.localId || savedScan.scanId || "",
    };
  }
  return {
    ...previous,
    updatedAt: now,
    defaultMarkets: options.markets,
    lastRun: {
      at: now,
      markets: options.markets,
      selected: result.stats?.selected || 0,
      savedRows: result.stats?.savedRows || 0,
      localId: savedScan.localId || "",
    },
    markets,
  };
}

async function createRun(options) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  try {
    const [run] = await supabaseRequest("provider_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        provider: "statsedge-materialized-scan",
        run_type: "scan-refresh",
        market: options.markets.join(","),
        status: "started",
        stats: {
          markets: options.markets,
          symbols: options.symbols.length,
          limit: options.limit,
          perMarket: options.perMarket,
          offset: options.offset,
          skipRecentlyScanned: Boolean(options.skipRecentlyScanned),
          recentScanDays: options.recentScanDays,
          materializationLookbackDays: options.materializationLookbackDays,
          prioritizeMaterialization: Boolean(options.prioritizeMaterialization),
          shadowSource: options.shadowSource || null,
          screenerFilters: options.screenerFilters || null,
        },
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
    // Provider run logging must not block the materialized scan.
  }
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const baseOptions = await resolveShadowPricedOptions(optionsFromRequest(request));
  if (baseOptions.shadowSource?.enabled && !baseOptions.symbols.length) {
    return Response.json({
      ok: true,
      dryRun: Boolean(baseOptions.dryRun),
      skipped: true,
      reason: "No priced shadow symbols available for the requested markets/status.",
      scan: { rowCount: 0 },
      shadowSource: baseOptions.shadowSource,
      stats: {
        markets: baseOptions.markets,
        selected: 0,
        savedRows: 0,
        shadowSource: baseOptions.shadowSource,
        screenerFilters: baseOptions.screenerFilters || null,
      },
    });
  }
  const cursor = baseOptions.useCursor ? await readScanBatchCursor().catch((error) => ({ configured: false, value: {}, error: error.message })) : { value: {} };
  const options = {
    ...baseOptions,
    marketOffsets: cursorOffsets(cursor.value || {}, baseOptions),
  };
  if (options.dryRun) {
    const plan = await planMaterializedScan(options);
    return Response.json({
      ok: true,
      dryRun: true,
      plan: {
        markets: plan.markets,
        symbols: plan.symbols,
        selectedRows: options.includeRows ? plan.selectedRows : undefined,
        universeTotal: plan.universeTotal,
        settings: plan.settings,
      },
      stats: {
        ...plan.stats,
        shadowSource: options.shadowSource || null,
        screenerFilters: options.screenerFilters || null,
      },
      cursor: {
        used: Boolean(options.useCursor),
        saved: false,
        skipped: true,
        offsets: plan.stats.selection?.marketOffsets || {},
        nextOffsets: plan.stats.selection?.nextMarketOffsets || {},
      },
    });
  }
  const run = await createRun(options);
  try {
    const result = await runMaterializedScan(options);
    const savedScan = await writeMaterializedScan(result.scan);
    const cursorWrite = options.useCursor && savedScan.saved
      ? await writeScanBatchCursor(nextCursorValue(cursor.value || {}, options, result, savedScan)).catch((error) => ({ saved: false, error: error.message }))
      : { skipped: true };
    const leaderboards = options.refreshLeaderboards && savedScan.saved
      ? await refreshDefaultLeaderboards()
      : { skipped: true, saved: 0 };
    const stats = {
      ...result.stats,
      savedScan,
      cursor: {
        used: Boolean(options.useCursor),
        saved: Boolean(cursorWrite.saved),
        skipped: Boolean(cursorWrite.skipped),
        error: cursorWrite.error || "",
        offsets: result.stats.selection?.marketOffsets || {},
        nextOffsets: result.stats.selection?.nextMarketOffsets || {},
      },
      leaderboards: {
        saved: leaderboards.saved || 0,
        skipped: Boolean(leaderboards.skipped),
      },
      shadowSource: options.shadowSource || null,
    };
    await finishRun(run, result.stats.savedRows ? "completed" : "partial", { stats });
    return Response.json({
      ok: true,
      scan: {
        localId: result.scan.id,
        name: result.scan.name,
        rowCount: result.scan.rows.length,
        rows: options.includeRows ? result.scan.rows : undefined,
      },
      savedScan,
      cursor: {
        used: Boolean(options.useCursor),
        saved: Boolean(cursorWrite.saved),
        skipped: Boolean(cursorWrite.skipped),
        error: cursorWrite.error || "",
        offsets: result.stats.selection?.marketOffsets || {},
        nextOffsets: result.stats.selection?.nextMarketOffsets || {},
      },
      leaderboards,
      stats: {
        ...result.stats,
        shadowSource: options.shadowSource || null,
        screenerFilters: options.screenerFilters || null,
      },
    });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { markets: options.markets, limit: options.limit } });
    return Response.json({ ok: false, error: error.message || "Materialized scan refresh failed" }, { status: 502 });
  }
}

export const POST = GET;
