import { shadowEuropeCronGroupAt, shadowEuropeCronGroupByKey } from "@/lib/cronPlan";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { envValue } from "@/lib/env";
import { mapOpenFigiIsins } from "@/lib/openfigi";
import { refreshDefaultLeaderboards, runMaterializedScan, writeMaterializedScan } from "@/lib/materializedScanner";
import {
  markShadowInstrumentsStatus,
  markSymbolResolutionPriceStatus,
  readPricedShadowSymbols,
  readShadowInstrumentsForResolution,
  readSymbolResolutionsForPricing,
  upsertSymbolResolutions,
} from "@/lib/shadowUniverseStore";
import { countryCode } from "@/lib/symbols";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { fetchYahooChart } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROTATION_SETTING_TYPE = "jobs";
const ROTATION_SETTING_KEY = "shadow-europe-refresh-cron-rotation";

function authorized(request) {
  const secret = envValue("CRON_SECRET");
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

function boolParam(searchParams, key, fallback = false) {
  const raw = searchParams.get(key);
  if (raw === null) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function numberParam(searchParams, key, fallback, min, max) {
  const raw = searchParams.get(key);
  const n = raw === null || raw === "" ? fallback : Number(raw);
  const value = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(value, min), max);
}

function daysSince(date = "") {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

async function readRotation() {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, value: {} };
  const rows = await supabaseRequest("app_settings", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&setting_type=eq.${ROTATION_SETTING_TYPE}&setting_key=eq.${ROTATION_SETTING_KEY}&select=*&limit=1`,
  });
  const row = rows?.[0] || null;
  return {
    configured: true,
    value: row?.value && typeof row.value === "object" ? row.value : {},
    updatedAt: row?.updated_at || "",
  };
}

async function writeRotation(value = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: false };
  const saved = await supabaseRequest("app_settings", {
    method: "POST",
    query: "on_conflict=owner_id,setting_type,setting_key",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{
      owner_id: config.ownerId,
      setting_type: ROTATION_SETTING_TYPE,
      setting_key: ROTATION_SETTING_KEY,
      value,
      updated_at: new Date().toISOString(),
    }],
  });
  return { configured: true, saved: true, row: saved?.[0] || null };
}

async function createRun(group, options) {
  const config = supabaseConfig();
  if (!config.configured) return null;
  try {
    const [run] = await supabaseRequest("provider_runs", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        owner_id: config.ownerId,
        provider: "statsedge-cron",
        run_type: "cron-shadow-europe-refresh",
        market: options.markets.join(","),
        status: "started",
        stats: { group: group.key, ...options },
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
    // Cron logging must not block the pipeline.
  }
}

function enrichMappedRows(mapped = [], references = [], market = "") {
  const byIsin = new Map(references.map((row) => [row.isin, row]));
  return mapped
    .filter((row) => row?.isin && countryCode(row.symbol) === market)
    .map((row) => {
      const reference = byIsin.get(row.isin) || {};
      return {
        ...row,
        country: market,
        market,
        name: reference.name || row.name,
        currency: reference.currency || row.currency,
        cfiCode: reference.cfi_code || reference.cfiCode,
        tradingVenue: reference.trading_venue || reference.tradingVenue,
        relevantVenue: reference.relevant_venue || reference.relevantVenue,
        relevantAuthority: reference.relevant_authority || reference.relevantAuthority,
        source: "openfigi-isin",
      };
    });
}

function referenceProviderForMarket(market = "") {
  return market === "GB" ? "fca-firds" : "esma-firds";
}

function priceState(symbol = "", chart = {}, options = {}) {
  const bars = Array.isArray(chart.bars) ? chart.bars : [];
  const latest = bars[0] || {};
  const latestDate = latest.date || "";
  const freshnessDays = daysSince(latestDate);
  const enoughBars = bars.length >= options.minBars;
  const fresh = freshnessDays !== null && freshnessDays <= options.maxAgeDays;
  const ok = enoughBars && fresh;
  return {
    status: ok ? "priced" : bars.length ? "stale" : "price-unavailable",
    dataFreshness: {
      stage: "price-freshness-gate",
      symbol,
      latestDate,
      freshnessDays,
      maxAgeDays: options.maxAgeDays,
      bars: bars.length,
      minBars: options.minBars,
      enoughBars,
      priceFreshnessOk: ok,
      issue: ok ? "" : !bars.length ? "sin historico diario" : !enoughBars ? `historico insuficiente ${bars.length}/${options.minBars}` : `precio viejo ${freshnessDays}d > ${options.maxAgeDays}d`,
      provider: chart.meta?.dataProvider || "",
      sourceProvider: chart.meta?.sourceProvider || "",
      cache: chart.meta?.cache || null,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function checkResolution(row = {}, options = {}) {
  try {
    const chart = await withDailyBarsCache(row.symbol, {
      range: options.range,
      interval: "D",
      refresh: options.refreshPrices,
      useCache: true,
      maxAgeDays: options.maxAgeDays,
      minBars: options.minBars,
    }, fetchYahooChart);
    return { ...row, ...priceState(row.symbol, chart, options) };
  } catch (error) {
    return {
      ...row,
      status: "price-unavailable",
      dataFreshness: {
        stage: "price-freshness-gate",
        symbol: row.symbol,
        priceFreshnessOk: false,
        issue: error.message || "precio no disponible",
        checkedAt: new Date().toISOString(),
      },
      error: error.message || "precio no disponible",
    };
  }
}

async function resolveShadowSymbols(options = {}) {
  const rows = [];
  const errors = [];
  for (const market of options.markets) {
    try {
      const referenceProvider = referenceProviderForMarket(market);
      const candidates = await readShadowInstrumentsForResolution({
        market,
        provider: referenceProvider,
        status: "reference",
        limit: options.resolvePerMarket,
      });
      const references = candidates.rows || [];
      const isins = references.map((row) => row.isin).filter(Boolean);
      if (!isins.length) {
        rows.push({ market, referenceProvider, candidateStatus: candidates.status, candidates: 0, mapped: 0, persisted: 0, markedResolved: 0, markedUnresolved: 0 });
        continue;
      }
      const mapped = await mapOpenFigiIsins(isins, { limit: Math.min(isins.length, options.maxMappedPerMarket) });
      const marketMapped = enrichMappedRows(mapped, references, market);
      const matchedIsins = Array.from(new Set(marketMapped.map((row) => row.isin)));
      const unresolvedIsins = isins.filter((isin) => !matchedIsins.includes(isin));
      const write = await upsertSymbolResolutions(marketMapped);
      const resolvedMark = await markShadowInstrumentsStatus(matchedIsins, {
        market,
        provider: referenceProvider,
        status: "resolved",
        raw: { stage: "cron-openfigi-resolution", matched: true, provider: "openfigi" },
      });
      const unresolvedMark = await markShadowInstrumentsStatus(unresolvedIsins, {
        market,
        provider: referenceProvider,
        status: "unresolved",
        raw: { stage: "cron-openfigi-resolution", matched: false, provider: "openfigi", reason: "no-market-symbol" },
      });
      const result = {
        market,
        referenceProvider,
        candidateStatus: candidates.status,
        candidates: isins.length,
        mapped: marketMapped.length,
        persisted: Number(write.written || 0),
        markedResolved: Number(resolvedMark.written || 0),
        markedUnresolved: Number(unresolvedMark.written || 0),
      };
      if (options.includeSymbols) {
        result.symbols = marketMapped.map((row) => ({ symbol: row.symbol, isin: row.isin, name: row.name })).slice(0, 20);
      }
      rows.push(result);
    } catch (error) {
      errors.push({ market, stage: "resolve", error: error.message || "OpenFIGI mapping failed" });
      rows.push({ market, referenceProvider: referenceProviderForMarket(market), candidates: 0, mapped: 0, persisted: 0, markedResolved: 0, markedUnresolved: 0, error: error.message || "OpenFIGI mapping failed" });
    }
  }
  return {
    rows,
    errors,
    candidates: rows.reduce((sum, row) => sum + Number(row.candidates || 0), 0),
    mapped: rows.reduce((sum, row) => sum + Number(row.mapped || 0), 0),
    persisted: rows.reduce((sum, row) => sum + Number(row.persisted || 0), 0),
    markedResolved: rows.reduce((sum, row) => sum + Number(row.markedResolved || 0), 0),
    markedUnresolved: rows.reduce((sum, row) => sum + Number(row.markedUnresolved || 0), 0),
  };
}

async function validateShadowPrices(options = {}) {
  const rows = [];
  const errors = [];
  for (const market of options.markets) {
    try {
      const candidates = await readSymbolResolutionsForPricing({
        market,
        status: "resolved",
        limit: options.pricePerMarket,
      });
      const resolutions = candidates.rows || [];
      if (!resolutions.length) {
        rows.push({ market, candidateStatus: candidates.status, candidates: 0, priced: 0, stale: 0, unavailable: 0, updated: 0 });
        continue;
      }
      const checked = [];
      for (const resolution of resolutions) {
        const result = await checkResolution(resolution, options);
        if (result.error) errors.push({ market, stage: "price", symbol: resolution.symbol, error: result.error });
        checked.push(result);
      }
      const update = await markSymbolResolutionPriceStatus(checked.map((row) => ({
        isin: row.isin,
        market,
        symbol: row.symbol,
        status: row.status,
        dataFreshness: row.dataFreshness,
      })));
      const result = {
        market,
        candidateStatus: candidates.status,
        candidates: resolutions.length,
        priced: checked.filter((row) => row.status === "priced").length,
        stale: checked.filter((row) => row.status === "stale").length,
        unavailable: checked.filter((row) => row.status === "price-unavailable").length,
        updated: Number(update.written || 0),
      };
      if (options.includeSymbols) {
        result.symbols = checked.map((row) => ({
          symbol: row.symbol,
          status: row.status,
          latestDate: row.dataFreshness?.latestDate || "",
          freshnessDays: row.dataFreshness?.freshnessDays ?? null,
          bars: row.dataFreshness?.bars || 0,
          issue: row.dataFreshness?.issue || "",
        }));
      }
      rows.push(result);
    } catch (error) {
      errors.push({ market, stage: "price", error: error.message || "price freshness failed" });
      rows.push({ market, candidates: 0, priced: 0, stale: 0, unavailable: 0, updated: 0, error: error.message || "price freshness failed" });
    }
  }
  return {
    rows,
    errors,
    candidates: rows.reduce((sum, row) => sum + Number(row.candidates || 0), 0),
    priced: rows.reduce((sum, row) => sum + Number(row.priced || 0), 0),
    stale: rows.reduce((sum, row) => sum + Number(row.stale || 0), 0),
    unavailable: rows.reduce((sum, row) => sum + Number(row.unavailable || 0), 0),
    updated: rows.reduce((sum, row) => sum + Number(row.updated || 0), 0),
  };
}

async function scanPricedShadowSymbols(group, options = {}) {
  const priced = await readPricedShadowSymbols({
    markets: options.markets,
    status: "priced",
    perMarket: options.scanPerMarket,
    limit: options.scanLimit,
  });
  const symbols = (priced.rows || []).map((row) => row.symbol).filter(Boolean);
  if (!symbols.length) {
    return { skipped: true, reason: "No priced shadow symbols available.", pricedRows: priced.rows?.length || 0, selected: 0, savedRows: 0 };
  }
  const scanOptions = {
    markets: options.markets,
    symbols,
    limit: symbols.length,
    perMarket: 0,
    concurrency: options.concurrency,
    maxSavedRows: 500,
    maxPriceFreshnessDays: options.maxAgeDays,
    maxFundamentalsAgeDays: 14,
    minBars: options.minBars,
    minPrice: 1,
    minAvgTurnover: 250000,
    minMarketCap: 300000000,
    minCoverageScore: 40,
    cache: true,
    refreshPrices: false,
    refreshProfiles: false,
    shadowSource: {
      enabled: true,
      source: "cron-shadow-europe-refresh",
      group: group.key,
      status: priced.status,
      requestedStatus: "priced",
      rows: priced.rows?.length || 0,
      markets: options.markets,
    },
  };
  const result = await runMaterializedScan(scanOptions);
  const savedScan = await writeMaterializedScan(result.scan);
  const leaderboards = options.refreshLeaderboards && savedScan.saved
    ? await refreshDefaultLeaderboards()
    : { skipped: true, saved: 0 };
  return {
    skipped: false,
    pricedRows: priced.rows?.length || 0,
    selected: result.stats.selected || 0,
    passedBase: result.stats.passedBase || 0,
    savedRows: result.stats.savedRows || 0,
    rejected: result.stats.rejected || 0,
    rejections: result.stats.rejections || [],
    scan: { localId: result.scan.id, rowCount: result.scan.rows.length },
    savedScan,
    leaderboards,
  };
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const rotation = await readRotation().catch(() => ({ value: {} }));
  const manualGroup = shadowEuropeCronGroupByKey(searchParams.get("group"));
  const rotated = shadowEuropeCronGroupAt(rotation.value?.nextIndex || 0);
  const group = manualGroup || rotated.group;
  const groupIndex = manualGroup ? rotated.groups.findIndex((item) => item.key === manualGroup.key) : rotated.index;
  const options = {
    markets: group.markets,
    resolvePerMarket: numberParam(searchParams, "resolvePerMarket", group.resolvePerMarket, 0, 10),
    maxMappedPerMarket: numberParam(searchParams, "maxMappedPerMarket", 30, 1, 80),
    pricePerMarket: numberParam(searchParams, "pricePerMarket", group.pricePerMarket, 0, 20),
    scanPerMarket: numberParam(searchParams, "scanPerMarket", group.scanPerMarket, 1, 20),
    scanLimit: numberParam(searchParams, "scanLimit", group.scanLimit, 1, 60),
    concurrency: numberParam(searchParams, "concurrency", 2, 1, 3),
    maxAgeDays: numberParam(searchParams, "maxAgeDays", 5, 1, 30),
    minBars: numberParam(searchParams, "minBars", 180, 20, 600),
    range: searchParams.get("range") || "2A",
    refreshPrices: boolParam(searchParams, "refreshPrices", false),
    refreshLeaderboards: searchParams.get("leaderboards") !== "0",
    includeSymbols: boolParam(searchParams, "includeSymbols", false),
  };
  if (searchParams.get("dryRun") === "1") {
    return Response.json({
      ok: true,
      dryRun: true,
      job: "cron-shadow-europe-refresh",
      group: { key: group.key, title: group.title, index: groupIndex, nextIndex: rotation.value?.nextIndex || 0 },
      options,
      legalMode: "internal-derived-pipeline-only",
    });
  }
  const run = await createRun(group, options);
  try {
    const resolve = options.resolvePerMarket ? await resolveShadowSymbols(options) : { skipped: true, rows: [], errors: [], candidates: 0, mapped: 0, persisted: 0, markedResolved: 0, markedUnresolved: 0 };
    const price = options.pricePerMarket ? await validateShadowPrices(options) : { skipped: true, rows: [], errors: [], candidates: 0, priced: 0, stale: 0, unavailable: 0, updated: 0 };
    const scan = await scanPricedShadowSymbols(group, options);
    const nextRotation = {
      updatedAt: new Date().toISOString(),
      previousIndex: groupIndex,
      nextIndex: manualGroup ? (rotation.value?.nextIndex || 0) : (groupIndex + 1) % rotated.groups.length,
      lastGroup: group.key,
      lastMarkets: group.markets,
      lastResolved: resolve.markedResolved || 0,
      lastPriced: price.priced || 0,
      lastSavedRows: scan.savedRows || 0,
    };
    const rotationWrite = manualGroup ? { skipped: true } : await writeRotation(nextRotation).catch((error) => ({ saved: false, error: error.message }));
    const errors = [...(resolve.errors || []), ...(price.errors || [])];
    const stats = {
      group: group.key,
      markets: options.markets,
      resolve,
      price,
      scan,
      rotation: {
        saved: Boolean(rotationWrite.saved),
        skipped: Boolean(rotationWrite.skipped),
        error: rotationWrite.error || "",
        nextIndex: nextRotation.nextIndex,
      },
      legalMode: "internal-derived-pipeline-only",
    };
    await finishRun(run, errors.length ? "completed-with-warnings" : scan.savedRows ? "completed" : "partial", { stats });
    return Response.json({
      ok: true,
      job: "cron-shadow-europe-refresh",
      ...stats,
      group: { key: group.key, title: group.title, index: groupIndex },
      errors,
    });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { group: group.key, markets: options.markets } });
    return Response.json({ ok: false, job: "cron-shadow-europe-refresh", group: group.key, error: error.message || "Shadow Europe cron failed" }, { status: 502 });
  }
}

export const POST = GET;
