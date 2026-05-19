import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

const DEFAULT_MAX_AGE_DAYS = 7;
const PROFILE_PERIOD_TYPE = "profile";
const PROFILE_PROVIDER = "StatsEdge normalized profile";

function canonicalSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ageDays(value = "") {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasFiniteObjectValue(value = {}, depth = 0) {
  if (!value || typeof value !== "object" || depth > 2) return false;
  return Object.values(value).some((item) => (
    numberOrNull(item) !== null
      || (item && typeof item === "object" && hasFiniteObjectValue(item, depth + 1))
  ));
}

function usefulProfile(profile = {}) {
  const sector = String(profile.sector || "").trim();
  const industry = String(profile.industry || "").trim();
  return Boolean(
    numberOrNull(profile.marketCap)
      || (sector && sector !== "Sin sector")
      || (industry && industry !== "Sin industria")
      || String(profile.businessSummary || "").trim()
      || hasFiniteObjectValue(profile.growthMetrics)
      || hasFiniteObjectValue(profile.valuationMetrics)
  );
}

function sourceProviders(profile = {}) {
  return [...new Set([
    profile.valuationMetrics?.source,
    profile.growthMetrics?.source,
    profile.growthMetrics?.shortInterestSource,
    profile.quoteSnapshot?.source,
    profile.shortInterest?.source,
  ].map((item) => String(item || "").trim()).filter(Boolean))];
}

function profileMetrics(profile = {}) {
  return {
    name: profile.name || "",
    sector: profile.sector || "",
    industry: profile.industry || "",
    exchange: profile.exchange || "",
    currency: profile.currency || "",
    ipoDate: profile.ipoDate || "",
    website: profile.website || "",
    city: profile.city || "",
    country: profile.country || "",
    fullTimeEmployees: profile.fullTimeEmployees ?? null,
    businessSummary: profile.businessSummary || "",
    marketCap: numberOrNull(profile.marketCap),
    shortPercentOfFloat: numberOrNull(profile.shortPercentOfFloat),
    sharesPercentSharesOut: numberOrNull(profile.sharesPercentSharesOut),
    shortRatio: numberOrNull(profile.shortRatio),
    sharesShort: numberOrNull(profile.sharesShort),
    sharesShortPriorMonth: numberOrNull(profile.sharesShortPriorMonth),
    floatShares: numberOrNull(profile.floatShares),
    sharesOutstanding: numberOrNull(profile.sharesOutstanding),
    valuationMetrics: profile.valuationMetrics || {},
    quoteSnapshot: profile.quoteSnapshot || {},
    growthMetrics: profile.growthMetrics || {},
    fundamentalsFinancialResults: profile.fundamentalsFinancialResults || null,
    shortInterest: profile.shortInterest || null,
    profileProviderError: profile.profileProviderError || null,
    sourceProviders: sourceProviders(profile),
  };
}

function rowToProfile(row = {}, cache = {}) {
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
  return {
    ...metrics,
    marketCap: numberOrNull(row.market_cap) ?? numberOrNull(metrics.marketCap) ?? 0,
    currency: row.currency || metrics.currency || "",
    fundamentalsCache: {
      status: cache.status || "hit",
      table: "fundamental_snapshots",
      hit: Boolean(cache.hit),
      stale: Boolean(cache.stale),
      latestDate: row.period_end || "",
      updatedAt: row.updated_at || "",
      freshnessDays: cache.freshnessDays ?? null,
      maxAgeDays: cache.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
      provider: row.provider || PROFILE_PROVIDER,
      sourceProviders: metrics.sourceProviders || [],
      fallbackError: cache.fallbackError || "",
    },
  };
}

function cacheSummary(cache = {}) {
  if (!cache) return null;
  return {
    status: cache.status || "unknown",
    table: "fundamental_snapshots",
    hit: Boolean(cache.hit),
    stale: Boolean(cache.stale),
    latestDate: cache.latestDate || "",
    updatedAt: cache.updatedAt || "",
    freshnessDays: cache.freshnessDays ?? null,
    maxAgeDays: cache.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    provider: cache.provider || PROFILE_PROVIDER,
    error: cache.error || "",
  };
}

export async function readProfileCache(symbol, options = {}) {
  const config = supabaseConfig();
  const normalized = canonicalSymbol(symbol);
  const maxAgeDays = Math.max(Number(options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS), 0);

  if (!config.configured) {
    return { status: "disabled", hit: false, row: null, maxAgeDays, error: config.missing.join(", ") };
  }
  if (!normalized) return { status: "missing-symbol", hit: false, row: null, maxAgeDays };

  try {
    const rows = await supabaseRequest("fundamental_snapshots", {
      query: {
        select: "symbol,period_end,period_type,provider,currency,market_cap,metrics,updated_at",
        owner_id: `eq.${config.ownerId}`,
        symbol: `eq.${normalized}`,
        period_type: `eq.${PROFILE_PERIOD_TYPE}`,
        order: "updated_at.desc",
        limit: "1",
      },
    });
    const row = rows?.[0] || null;
    const freshnessDays = row?.updated_at ? ageDays(row.updated_at) : null;
    const hit = Boolean(row && freshnessDays !== null && freshnessDays <= maxAgeDays);
    return {
      status: hit ? "hit" : (row ? "stale" : "miss"),
      hit,
      stale: Boolean(row && !hit),
      row,
      latestDate: row?.period_end || "",
      updatedAt: row?.updated_at || "",
      freshnessDays,
      maxAgeDays,
      provider: row?.provider || PROFILE_PROVIDER,
    };
  } catch (error) {
    return {
      status: "error",
      hit: false,
      row: null,
      maxAgeDays,
      error: error.message || "fundamental_snapshots cache read failed",
    };
  }
}

export async function writeProfileCache(symbol, profile = {}) {
  const config = supabaseConfig();
  const normalized = canonicalSymbol(symbol);
  if (!config.configured) return { status: "disabled", written: false, count: 0, error: config.missing.join(", ") };
  if (!normalized) return { status: "missing-symbol", written: false, count: 0 };
  if (!usefulProfile(profile)) return { status: "skipped-low-signal", written: false, count: 0 };

  const metrics = profileMetrics(profile);
  const periodEnd = today();
  const row = {
    owner_id: config.ownerId,
    symbol: normalized,
    period_end: periodEnd,
    period_type: PROFILE_PERIOD_TYPE,
    provider: PROFILE_PROVIDER,
    currency: metrics.currency || null,
    market_cap: metrics.marketCap,
    metrics,
    raw: {
      cachedBy: "StatsEdge",
      normalizedOnly: true,
      sourceProviders: metrics.sourceProviders,
    },
    updated_at: new Date().toISOString(),
  };

  try {
    await supabaseRequest("fundamental_snapshots", {
      method: "POST",
      query: "on_conflict=owner_id,symbol,period_end,period_type,provider",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [row],
    });
    return { status: "supabase", written: true, count: 1, provider: PROFILE_PROVIDER, periodEnd };
  } catch (error) {
    return { status: "error", written: false, count: 0, error: error.message || "fundamental_snapshots cache write failed" };
  }
}

export async function withProfileCache(symbol, options = {}, fetcher) {
  const useCache = options.useCache !== false;
  let cached = null;

  if (useCache && !options.refresh) {
    cached = await readProfileCache(symbol, options);
    if (cached.hit && cached.row) return rowToProfile(cached.row, cached);
  }

  try {
    const live = await fetcher(symbol, options);
    const write = useCache ? await writeProfileCache(symbol, live) : { status: "skipped-disabled", written: false, count: 0 };
    return {
      ...live,
      fundamentalsCache: {
        read: cacheSummary(cached),
        write,
      },
    };
  } catch (error) {
    if (cached?.row) {
      return rowToProfile(cached.row, {
        ...cached,
        stale: true,
        status: cached.status === "hit" ? "stale-fallback" : cached.status,
        fallbackError: error.message || "live fundamentals provider failed",
      });
    }
    throw error;
  }
}
