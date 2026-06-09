import { normalizeChartInterval } from "@/lib/chartSettings";
import { supabaseConfig, supabaseRequest, toDate } from "@/lib/supabaseServer";

const DEFAULT_MAX_AGE_DAYS = 5;
const DEFAULT_OWNER_PROVIDER = "StatsEdge normalized daily";

const INTRADAY_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1H", "4H"]);

function canonicalSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function isIntraday(options = {}) {
  return INTRADAY_INTERVALS.has(normalizeChartInterval(options.interval));
}

function cacheLimitForRange(range = "") {
  const key = String(range || "2A").trim().toUpperCase();
  const map = {
    "1D": 10,
    "5D": 20,
    "1M": 45,
    "3M": 90,
    "6M": 160,
    "1A": 280,
    "2A": 560,
    "5A": 1350,
    MAX: 6000,
  };
  return map[key] || map["2A"];
}

function minBarsForRange(range = "") {
  const key = String(range || "").trim().toUpperCase();
  if (key === "1D") return 1;
  if (key === "5D") return 3;
  if (key === "1M") return 10;
  const map = {
    "3M": 30,
    "6M": 60,
    "1A": 120,
    "2A": 250,
    "5A": 500,
    MAX: 500,
  };
  return map[key] || 20;
}

function dateMs(date = "") {
  const clean = toDate(date);
  if (!clean) return NaN;
  return Date.parse(`${clean}T00:00:00Z`);
}

function freshnessDays(date = "") {
  const ms = dateMs(date);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeCachedBar(row = {}) {
  const close = numberOrNull(row.adj_close ?? row.close);
  const rawClose = numberOrNull(row.close);
  const date = toDate(row.trade_date);
  if (!date || !Number.isFinite(close) || close <= 0) return null;
  return {
    date,
    open: numberOrNull(row.open) ?? close,
    high: numberOrNull(row.high) ?? close,
    low: numberOrNull(row.low) ?? close,
    close,
    rawClose,
    adjClose: close,
    volume: numberOrNull(row.volume),
    currency: row.currency || "",
    provider: row.provider || "",
    updatedAt: row.updated_at || "",
  };
}

function dedupeBars(rows = []) {
  const byDate = new Map();
  for (const row of rows) {
    const bar = normalizeCachedBar(row);
    if (!bar) continue;
    const existing = byDate.get(bar.date);
    if (!existing || String(bar.updatedAt || "") > String(existing.updatedAt || "")) byDate.set(bar.date, bar);
  }
  return [...byDate.values()].sort((a, b) => dateMs(b.date) - dateMs(a.date));
}

function barsThroughAsOf(bars = [], asOfDate = "") {
  const asOf = toDate(asOfDate);
  if (!asOf) return bars;
  const cutoff = dateMs(asOf);
  if (!Number.isFinite(cutoff)) return bars;
  return bars.filter((bar) => {
    const ms = dateMs(bar.date);
    return Number.isFinite(ms) && ms <= cutoff;
  });
}

function cacheSummary(cache = {}) {
  if (!cache) return null;
  return {
    status: cache.status || "unknown",
    table: "daily_bars",
    hit: Boolean(cache.hit),
    stale: Boolean(cache.stale),
    rows: cache.bars?.length || cache.rows || 0,
    latestDate: cache.latestDate || "",
    freshnessDays: cache.freshnessDays ?? null,
    maxAgeDays: cache.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    minBars: cache.minBars ?? null,
    asOfDate: cache.asOfDate || "",
    asOfRows: cache.asOfRows ?? null,
    provider: cache.provider || "",
    error: cache.error || "",
  };
}

function chartFromCache(symbol, cache, options = {}, extras = {}) {
  const latest = cache.bars?.[0] || {};
  return {
    bars: cache.bars || [],
    meta: {
      symbol: canonicalSymbol(symbol),
      regularMarketPrice: latest.close ?? null,
      currency: latest.currency || cache.currency || "",
      dataProvider: cache.stale ? "StatsEdge daily_bars stale cache" : "StatsEdge daily_bars cache",
      sourceProvider: latest.provider || cache.provider || "",
      requestedInterval: normalizeChartInterval(options.interval),
      requestedRange: options.range || "2A",
      cache: {
        ...cacheSummary(cache),
        fallbackError: extras.fallbackError || "",
      },
    },
  };
}

function providerFromChart(chart = {}) {
  return String(chart.meta?.dataProvider || chart.provider || DEFAULT_OWNER_PROVIDER).trim() || DEFAULT_OWNER_PROVIDER;
}

function cleanWriteBar(symbol, bar = {}, chart = {}) {
  const tradeDate = toDate(bar.date);
  const close = numberOrNull(bar.close ?? bar.adjClose);
  if (!tradeDate || !Number.isFinite(close) || close <= 0) return null;
  const provider = String(bar.provider || providerFromChart(chart)).trim() || DEFAULT_OWNER_PROVIDER;
  return {
    symbol: canonicalSymbol(bar.symbol || chart.meta?.symbol || symbol),
    trade_date: tradeDate,
    open: numberOrNull(bar.open) ?? close,
    high: numberOrNull(bar.high) ?? close,
    low: numberOrNull(bar.low) ?? close,
    close: numberOrNull(bar.rawClose ?? bar.close) ?? close,
    adj_close: numberOrNull(bar.adjClose ?? bar.close) ?? close,
    volume: numberOrNull(bar.volume),
    currency: String(bar.currency || chart.meta?.currency || "").trim() || null,
    provider,
    raw: {
      sourceProvider: provider,
      sourceTime: bar.time ?? null,
      cachedBy: "StatsEdge",
    },
    updated_at: new Date().toISOString(),
  };
}

export async function readDailyBarsCache(symbol, options = {}) {
  const config = supabaseConfig();
  const normalized = canonicalSymbol(symbol);
  const limit = Math.min(Math.max(Number(options.limit || cacheLimitForRange(options.range)), 1), 6000);
  const maxAgeDays = Math.max(Number(options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS), 0);
  const minBars = Math.max(Number(options.minBars ?? minBarsForRange(options.range)), 1);
  const asOfDate = toDate(options.asOfDate || options.asOf || "");

  if (!config.configured) {
    return { status: "disabled", hit: false, bars: [], rows: 0, maxAgeDays, minBars, asOfDate, asOfRows: 0, error: config.missing.join(", ") };
  }
  if (!normalized) return { status: "missing-symbol", hit: false, bars: [], rows: 0, maxAgeDays, minBars, asOfDate, asOfRows: 0 };

  try {
    const rows = await supabaseRequest("daily_bars", {
      query: {
        select: "symbol,trade_date,open,high,low,close,adj_close,volume,currency,provider,updated_at",
        owner_id: `eq.${config.ownerId}`,
        symbol: `eq.${normalized}`,
        order: "trade_date.desc,updated_at.desc",
        limit: String(limit * 3),
      },
    });
    const bars = dedupeBars(rows).slice(0, limit);
    const asOfBars = barsThroughAsOf(bars, asOfDate);
    const latest = bars[0] || {};
    const age = freshnessDays(latest.date);
    const enough = asOfBars.length >= minBars;
    const fresh = enough && age !== null && age <= maxAgeDays;
    return {
      status: fresh ? "hit" : (bars.length ? (enough ? "stale" : "miss") : "miss"),
      hit: fresh,
      stale: enough && age !== null && age > maxAgeDays,
      bars,
      rows: bars.length,
      latestDate: latest.date || "",
      freshnessDays: age,
      maxAgeDays,
      minBars,
      asOfDate,
      asOfRows: asOfBars.length,
      provider: latest.provider || "",
      currency: latest.currency || "",
    };
  } catch (error) {
    return {
      status: "error",
      hit: false,
      bars: [],
      rows: 0,
      maxAgeDays,
      minBars,
      asOfDate,
      asOfRows: 0,
      error: error.message || "daily_bars cache read failed",
    };
  }
}

export async function writeDailyBarsCache(symbol, chart = {}, options = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { status: "disabled", written: false, count: 0, error: config.missing.join(", ") };
  if (isIntraday(options)) return { status: "skipped-intraday", written: false, count: 0 };

  const rows = (chart.bars || [])
    .map((bar) => cleanWriteBar(symbol, bar, chart))
    .filter(Boolean)
    .map((row) => ({ owner_id: config.ownerId, ...row }));

  if (!rows.length) return { status: "empty", written: false, count: 0 };

  try {
    for (let i = 0; i < rows.length; i += 500) {
      await supabaseRequest("daily_bars", {
        method: "POST",
        query: "on_conflict=owner_id,symbol,trade_date,provider",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: rows.slice(i, i + 500),
      });
    }
    return { status: "supabase", written: true, count: rows.length, provider: rows[0]?.provider || "" };
  } catch (error) {
    return { status: "error", written: false, count: 0, error: error.message || "daily_bars cache write failed" };
  }
}

export async function withDailyBarsCache(symbol, options = {}, fetcher) {
  const cacheable = !isIntraday(options);
  const useCache = options.useCache !== false && cacheable;
  let cached = null;

  if (useCache && !options.refresh) {
    cached = await readDailyBarsCache(symbol, options);
    if (cached.hit) return chartFromCache(symbol, cached, options);
  }

  try {
    const live = await fetcher(symbol, options);
    const write = useCache ? await writeDailyBarsCache(symbol, live, options) : { status: cacheable ? "skipped-disabled" : "skipped-intraday", written: false, count: 0 };
    return {
      ...live,
      meta: {
        ...(live.meta || {}),
        cache: {
          read: cacheSummary(cached),
          write,
        },
      },
    };
  } catch (error) {
    if (cached?.bars?.length) {
      return chartFromCache(symbol, { ...cached, stale: true, status: cached.status === "hit" ? "stale-fallback" : cached.status }, options, {
        fallbackError: error.message || "live provider failed",
      });
    }
    throw error;
  }
}
