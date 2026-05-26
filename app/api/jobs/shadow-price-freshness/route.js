import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { envValue } from "@/lib/env";
import { normalizeMarketList } from "@/lib/markets";
import {
  markSymbolResolutionPriceStatus,
  readSymbolResolutionsForPricing,
} from "@/lib/shadowUniverseStore";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { fetchYahooChart } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_MARKETS = ["GB", "FI", "DK", "NO", "NL", "ES", "SE", "IT", "FR", "DE"];
const SUPPORTED_MARKETS = new Set(["GB", "AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);

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
  const value = raw === null || raw === "" ? fallback : Number(raw);
  return Math.min(Math.max(Number.isFinite(value) ? value : fallback, min), max);
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function daysSince(date = "") {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function optionsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  const markets = normalizeMarketList(searchParams.get("markets") || searchParams.get("market") || DEFAULT_MARKETS, [])
    .filter((market) => SUPPORTED_MARKETS.has(market));
  return {
    markets: markets.length ? markets : DEFAULT_MARKETS,
    dryRun: boolParam(searchParams, "dryRun", false),
    includeSymbols: boolParam(searchParams, "includeSymbols", false),
    refreshPrices: boolParam(searchParams, "refreshPrices", false),
    status: cleanText(searchParams.get("status") || "resolved"),
    perMarket: numberParam(searchParams, "perMarket", 5, 1, 25),
    maxAgeDays: numberParam(searchParams, "maxAgeDays", 5, 1, 30),
    minBars: numberParam(searchParams, "minBars", 180, 20, 600),
    range: cleanText(searchParams.get("range") || "2A"),
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
        provider: "statsedge-price-freshness",
        run_type: "shadow-price-freshness",
        market: options.markets.join(","),
        status: "started",
        stats: options,
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
    // Run logging should never block the freshness job.
  }
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
    return {
      ...row,
      ...priceState(row.symbol, chart, options),
    };
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

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const options = optionsFromRequest(request);
  const run = await createRun(options);
  try {
    const rows = [];
    const errors = [];
    for (const market of options.markets) {
      const candidates = await readSymbolResolutionsForPricing({
        market,
        status: options.status,
        limit: options.perMarket,
      });
      const resolutions = candidates.rows || [];
      if (options.dryRun || !resolutions.length) {
        rows.push({
          market,
          candidateStatus: candidates.status,
          candidates: resolutions.length,
          priced: 0,
          stale: 0,
          unavailable: 0,
          updated: 0,
        });
        continue;
      }
      const checked = [];
      for (const resolution of resolutions) {
        const result = await checkResolution(resolution, options);
        if (result.error) errors.push({ market, symbol: resolution.symbol, error: result.error });
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
    }
    const stats = {
      dryRun: options.dryRun,
      markets: options.markets,
      status: options.status,
      perMarket: options.perMarket,
      maxAgeDays: options.maxAgeDays,
      minBars: options.minBars,
      candidates: rows.reduce((sum, row) => sum + Number(row.candidates || 0), 0),
      priced: rows.reduce((sum, row) => sum + Number(row.priced || 0), 0),
      stale: rows.reduce((sum, row) => sum + Number(row.stale || 0), 0),
      unavailable: rows.reduce((sum, row) => sum + Number(row.unavailable || 0), 0),
      updated: rows.reduce((sum, row) => sum + Number(row.updated || 0), 0),
      errors,
      legalMode: "internal-price-freshness-gate",
    };
    await finishRun(run, options.dryRun ? "dry-run" : errors.length ? "completed-with-warnings" : "completed", { stats });
    return Response.json({
      ok: true,
      job: "shadow-price-freshness",
      message: "Validacion interna de OHLCV fresco para candidatos resueltos.",
      ...stats,
      rows,
    });
  } catch (error) {
    await finishRun(run, "failed", { error: error.message, stats: { markets: options.markets } });
    return Response.json({ ok: false, error: error.message || "Shadow price freshness failed" }, { status: 502 });
  }
}

export const POST = GET;
