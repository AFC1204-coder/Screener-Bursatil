import { countryCode } from "@/lib/symbols";
import { supabaseConfig, supabaseCount, supabaseRequest, textOrNull, toDate } from "@/lib/supabaseServer";

export const SHADOW_REFERENCE_PROVIDER = "esma-firds";
export const SHADOW_RESOLUTION_PROVIDER = "openfigi";

export const WESTERN_PRIORITY_MARKETS = [
  "US",
  "CA",
  "GB",
  "DE",
  "FR",
  "IT",
  "FI",
  "SE",
  "DK",
  "NO",
  "NL",
  "ES",
  "JP",
  "HK",
  "AU",
];

export const DEFERRED_LOW_PRIORITY_MARKETS = ["IN", "IL"];

const PRIMARY_SYMBOL_SUFFIX_BY_MARKET = {
  GB: ".L",
  DE: ".DE",
  FR: ".PA",
  SE: ".ST",
  IT: ".MI",
  FI: ".HE",
  DK: ".CO",
  NO: ".OL",
  NL: ".AS",
  ES: ".MC",
};

const DOMESTIC_ISIN_PREFIX_BY_MARKET = {
  AT: ["AT"],
  BE: ["BE"],
  DE: ["DE"],
  DK: ["DK"],
  ES: ["ES"],
  FI: ["FI"],
  FR: ["FR"],
  GB: ["GB", "JE", "GG", "IM"],
  IE: ["IE"],
  IT: ["IT"],
  NL: ["NL"],
  NO: ["NO"],
  PT: ["PT"],
  SE: ["SE"],
};

const PRIMARY_VENUE_BY_MARKET = {
  AT: ["XWBO"],
  BE: ["XBRU"],
  DE: ["XETR", "XFRA"],
  DK: ["XCSE"],
  ES: ["XMAD", "BMEX"],
  FI: ["XHEL"],
  FR: ["XPAR"],
  GB: ["XLON", "AIMX"],
  IE: ["XDUB"],
  IT: ["XMIL", "MTAA"],
  NL: ["XAMS"],
  NO: ["XOSL", "MERK"],
  PT: ["XLIS"],
  SE: ["XSTO"],
};

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMarket(value = "") {
  return cleanText(value).toUpperCase();
}

function cleanIsin(value = "") {
  const text = cleanText(value).toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(text) ? text : "";
}

function chunk(values = [], size = 500) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function countFreshnessFilter(maxAgeHours) {
  const hours = Number(maxAgeHours);
  if (!Number.isFinite(hours) || hours <= 0) return "";
  return `&updated_at=gte.${encodeURIComponent(new Date(Date.now() - hours * 36e5).toISOString())}`;
}

function supabaseDisabled(status = "supabase-disabled") {
  const config = supabaseConfig();
  return { status, configured: false, missing: config.missing, written: 0, total: 0, byMarket: {} };
}

function marketFromResolution(row = {}) {
  return cleanMarket(row.country || row.market || countryCode(row.symbol) || "");
}

function preferredResolutionRank(row = {}) {
  const market = marketFromResolution(row);
  const symbol = cleanText(row.symbol).toUpperCase();
  const primarySuffix = PRIMARY_SYMBOL_SUFFIX_BY_MARKET[market];
  let rank = 50;
  if (primarySuffix && symbol.endsWith(primarySuffix)) rank = 0;
  else if (countryCode(symbol) === market) rank = 10;
  const score = Number(row.confidence_score ?? row.confidenceScore);
  return { rank, score: Number.isFinite(score) ? score : 0, symbol };
}

function referenceResolutionRank(row = {}) {
  const market = cleanMarket(row.market);
  const isin = cleanIsin(row.isin);
  const domesticPrefixes = DOMESTIC_ISIN_PREFIX_BY_MARKET[market] || [];
  const primaryVenues = PRIMARY_VENUE_BY_MARKET[market] || [];
  const tradingVenue = cleanText(row.trading_venue || row.tradingVenue || row.raw?.tradingVenue || row.raw?.trading_venue).toUpperCase();
  const relevantVenue = cleanText(row.relevant_venue || row.relevantVenue || row.raw?.relevantVenue || row.raw?.relevant_venue).toUpperCase();
  let score = 0;
  if (domesticPrefixes.some((prefix) => isin.startsWith(prefix))) score += 45;
  if (primaryVenues.includes(tradingVenue)) score += 30;
  if (primaryVenues.includes(relevantVenue)) score += 20;
  if (row.currency) score += 2;
  return score;
}

function choosePreferredResolution(rows = []) {
  return rows
    .filter((row) => row?.symbol)
    .sort((a, b) => {
      const ar = preferredResolutionRank(a);
      const br = preferredResolutionRank(b);
      if (ar.rank !== br.rank) return ar.rank - br.rank;
      if (ar.score !== br.score) return br.score - ar.score;
      return ar.symbol.localeCompare(br.symbol);
    })[0];
}

function shadowInstrumentBody(row = {}, provider = SHADOW_REFERENCE_PROVIDER, ownerId = "personal", now = new Date().toISOString()) {
  const market = cleanMarket(row.country || row.market);
  const isin = cleanIsin(row.isin);
  if (!market || !isin) return null;
  return {
    owner_id: ownerId,
    provider,
    market,
    isin,
    name: textOrNull(row.name),
    short_name: textOrNull(row.shortName || row.short_name),
    currency: textOrNull(row.currency),
    cfi_code: textOrNull(row.cfiCode || row.cfi_code),
    issuer_lei: textOrNull(row.issuerLei || row.issuer_lei),
    trading_venue: textOrNull(row.tradingVenue || row.trading_venue),
    relevant_venue: textOrNull(row.relevantVenue || row.relevant_venue),
    relevant_authority: textOrNull(row.relevantAuthority || row.relevant_authority),
    first_trade_date: toDate(row.firstTradeDate || row.first_trade_date),
    termination_date: toDate(row.terminationDate || row.termination_date),
    status: "reference",
    raw: row,
    updated_at: now,
  };
}

function symbolResolutionBody(row = {}, provider = SHADOW_RESOLUTION_PROVIDER, ownerId = "personal", now = new Date().toISOString()) {
  const market = marketFromResolution(row);
  const isin = cleanIsin(row.isin);
  const symbol = cleanText(row.symbol).toUpperCase();
  if (!market || !isin || !symbol) return null;
  const score = Number(row.score || row.confidenceScore || row.confidence_score);
  return {
    owner_id: ownerId,
    provider,
    market,
    isin,
    symbol,
    name: textOrNull(row.name),
    exchange: textOrNull(row.exchange),
    exchange_code: textOrNull(row.exchangeCode || row.exchange_code || row.tradingVenue || row.trading_venue),
    figi: textOrNull(row.figi),
    composite_figi: textOrNull(row.compositeFigi || row.composite_figi),
    share_class_figi: textOrNull(row.shareClassFigi || row.share_class_figi),
    confidence_score: Number.isFinite(score) ? score : null,
    status: "resolved",
    raw: row,
    updated_at: now,
  };
}

async function existingShadowInstrumentStatuses(body = [], provider = SHADOW_REFERENCE_PROVIDER, ownerId = "personal") {
  const out = new Map();
  const byMarket = new Map();
  for (const row of body) {
    const group = byMarket.get(row.market) || [];
    group.push(row.isin);
    byMarket.set(row.market, group);
  }
  for (const [market, isins] of byMarket.entries()) {
    for (const batch of chunk(Array.from(new Set(isins)), 100)) {
      const rows = await supabaseRequest("shadow_instruments", {
        query: [
          `owner_id=eq.${encodeURIComponent(ownerId)}`,
          `provider=eq.${encodeURIComponent(provider)}`,
          `market=eq.${encodeURIComponent(market)}`,
          `isin=in.(${batch.join(",")})`,
          "select=market,isin,status",
        ].join("&"),
      });
      for (const row of rows || []) {
        const key = `${cleanMarket(row.market)}:${cleanIsin(row.isin)}`;
        if (key !== ":") out.set(key, cleanText(row.status) || "reference");
      }
    }
  }
  return out;
}

export async function upsertShadowInstruments(rows = [], { provider = SHADOW_REFERENCE_PROVIDER, preserveStatus = true } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return supabaseDisabled();
  const now = new Date().toISOString();
  const body = rows
    .map((row) => shadowInstrumentBody(row, provider, config.ownerId, now))
    .filter(Boolean);
  if (!body.length) return { status: "empty", configured: true, written: 0 };
  if (preserveStatus) {
    const existing = await existingShadowInstrumentStatuses(body, provider, config.ownerId);
    for (const row of body) {
      const status = existing.get(`${row.market}:${row.isin}`);
      if (status && status !== "reference") row.status = status;
    }
  }
  for (const batch of chunk(body)) {
    await supabaseRequest("shadow_instruments", {
      method: "POST",
      query: "on_conflict=owner_id,provider,market,isin",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: batch,
    });
  }
  return { status: "supabase", configured: true, written: body.length };
}

export async function upsertSymbolResolutions(rows = [], { provider = SHADOW_RESOLUTION_PROVIDER } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return supabaseDisabled();
  const now = new Date().toISOString();
  const body = rows
    .map((row) => symbolResolutionBody(row, provider, config.ownerId, now))
    .filter(Boolean);
  if (!body.length) return { status: "empty", configured: true, written: 0 };
  for (const batch of chunk(body)) {
    await supabaseRequest("symbol_resolutions", {
      method: "POST",
      query: "on_conflict=owner_id,provider,isin,symbol",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: batch,
    });
  }
  return { status: "supabase", configured: true, written: body.length };
}

export async function readCachedSymbolResolutions({ market = "", provider = SHADOW_RESOLUTION_PROVIDER, isins = [], statuses = ["resolved", "priced"] } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { ...supabaseDisabled(), rows: [] };
  const clean = cleanMarket(market);
  const values = Array.from(new Set(isins.map(cleanIsin).filter(Boolean)));
  const statusValues = (Array.isArray(statuses) ? statuses : [statuses])
    .map(cleanText)
    .filter(Boolean);
  if (!clean || !values.length || !statusValues.length) return { status: "empty", configured: true, rows: [] };
  const rows = [];
  for (const batch of chunk(values, 100)) {
    const cached = await supabaseRequest("symbol_resolutions", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `provider=eq.${encodeURIComponent(provider)}`,
        `market=eq.${encodeURIComponent(clean)}`,
        `isin=in.(${batch.join(",")})`,
        `status=in.(${statusValues.join(",")})`,
        "select=isin,market,symbol,name,exchange,exchange_code,figi,composite_figi,share_class_figi,confidence_score,status,data_freshness,raw",
        "order=confidence_score.desc,symbol.asc",
      ].join("&"),
    });
    rows.push(...(cached || []));
  }
  const byIsin = new Map();
  for (const row of rows) {
    const key = cleanIsin(row.isin);
    if (!key) continue;
    const group = byIsin.get(key) || [];
    group.push(row);
    byIsin.set(key, group);
  }
  const preferred = Array.from(byIsin.values()).map(choosePreferredResolution).filter(Boolean);
  return { status: "supabase", configured: true, rows: preferred };
}

export async function readShadowInstrumentsForResolution({ market = "", provider = SHADOW_REFERENCE_PROVIDER, status = "reference", limit = 10 } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { ...supabaseDisabled(), rows: [] };
  const clean = cleanMarket(market);
  const max = Math.max(1, Math.min(Number(limit || 10), 250));
  if (!clean) return { status: "empty", configured: true, rows: [] };
  const fetchLimit = Math.min(Math.max(max * 6, max), 250);
  const baseQuery = [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `provider=eq.${encodeURIComponent(provider)}`,
      `market=eq.${encodeURIComponent(clean)}`,
      `status=eq.${encodeURIComponent(cleanText(status) || "reference")}`,
  ];
  const readRows = (extra = [], rowLimit = fetchLimit) => supabaseRequest("shadow_instruments", {
    query: [
      ...baseQuery,
      ...extra,
      "select=isin,market,name,short_name,currency,cfi_code,trading_venue,relevant_venue,relevant_authority,first_trade_date,raw",
      "order=name.asc",
      `limit=${rowLimit}`,
    ].join("&"),
  });

  const rows = [];
  const seen = new Set();
  const addRows = (items = []) => {
    for (const row of items || []) {
      const key = `${cleanMarket(row.market)}:${cleanIsin(row.isin)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  };

  const domesticPrefixes = DOMESTIC_ISIN_PREFIX_BY_MARKET[clean] || [];
  for (const prefix of domesticPrefixes) {
    if (rows.length >= fetchLimit) break;
    addRows(await readRows([`isin=like.${encodeURIComponent(`${prefix}*`)}`], fetchLimit));
  }
  if (rows.length < fetchLimit) addRows(await readRows([], fetchLimit));

  const ranked = rows
    .sort((a, b) => referenceResolutionRank(b) - referenceResolutionRank(a) || cleanText(a.name).localeCompare(cleanText(b.name)))
    .slice(0, max);
  return { status: "supabase", configured: true, rows: ranked };
}

export async function markShadowInstrumentsStatus(isins = [], { market = "", provider = SHADOW_REFERENCE_PROVIDER, status = "reference", raw = {} } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return supabaseDisabled();
  const clean = cleanMarket(market);
  const values = Array.from(new Set(isins.map(cleanIsin).filter(Boolean)));
  if (!clean || !values.length) return { status: "empty", configured: true, written: 0 };
  let written = 0;
  for (const batch of chunk(values, 100)) {
    await supabaseRequest("shadow_instruments", {
      method: "PATCH",
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `provider=eq.${encodeURIComponent(provider)}`,
        `market=eq.${encodeURIComponent(clean)}`,
        `isin=in.(${batch.join(",")})`,
      ].join("&"),
      prefer: "return=minimal",
      body: {
        status,
        quality_gate: raw,
        updated_at: new Date().toISOString(),
      },
    });
    written += batch.length;
  }
  return { status: "supabase", configured: true, written };
}

export async function readSymbolResolutionsForPricing({ market = "", provider = SHADOW_RESOLUTION_PROVIDER, status = "resolved", limit = 10 } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { ...supabaseDisabled(), rows: [] };
  const clean = cleanMarket(market);
  const max = Math.max(1, Math.min(Number(limit || 10), 100));
  if (!clean) return { status: "empty", configured: true, rows: [] };
  const rows = await supabaseRequest("symbol_resolutions", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `provider=eq.${encodeURIComponent(provider)}`,
      `market=eq.${encodeURIComponent(clean)}`,
      `status=eq.${encodeURIComponent(cleanText(status) || "resolved")}`,
      "select=isin,market,symbol,name,exchange,exchange_code,confidence_score,status,data_freshness,raw",
      "order=updated_at.asc,symbol.asc",
      `limit=${max}`,
    ].join("&"),
  });
  return { status: "supabase", configured: true, rows: rows || [] };
}

export async function markSymbolResolutionPriceStatus(rows = [], { provider = SHADOW_RESOLUTION_PROVIDER } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return supabaseDisabled();
  const body = rows
    .map((row) => ({
      isin: cleanIsin(row.isin),
      market: cleanMarket(row.market),
      symbol: cleanText(row.symbol).toUpperCase(),
      status: cleanText(row.status || "resolved"),
      dataFreshness: row.dataFreshness && typeof row.dataFreshness === "object" ? row.dataFreshness : {},
    }))
    .filter((row) => row.isin && row.market && row.symbol);
  if (!body.length) return { status: "empty", configured: true, written: 0 };
  let written = 0;
  for (const row of body) {
    await supabaseRequest("symbol_resolutions", {
      method: "PATCH",
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `provider=eq.${encodeURIComponent(provider)}`,
        `market=eq.${encodeURIComponent(row.market)}`,
        `isin=eq.${encodeURIComponent(row.isin)}`,
        `symbol=eq.${encodeURIComponent(row.symbol)}`,
      ].join("&"),
      prefer: "return=minimal",
      body: {
        status: row.status,
        data_freshness: row.dataFreshness,
        updated_at: new Date().toISOString(),
      },
    });
    written += 1;
  }
  return { status: "supabase", configured: true, written };
}

export async function readPricedShadowSymbols({ markets = [], provider = SHADOW_RESOLUTION_PROVIDER, status = "priced", perMarket = 10, limit = 50 } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { ...supabaseDisabled(), rows: [] };
  const normalizedMarkets = markets.map(cleanMarket).filter(Boolean);
  const maxPerMarket = Math.max(1, Math.min(Number(perMarket || 10), 50));
  const maxTotal = Math.max(1, Math.min(Number(limit || 50), 200));
  const rows = [];
  for (const market of normalizedMarkets) {
    const marketRows = await supabaseRequest("symbol_resolutions", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `provider=eq.${encodeURIComponent(provider)}`,
        `market=eq.${encodeURIComponent(market)}`,
        `status=eq.${encodeURIComponent(cleanText(status) || "priced")}`,
        "select=isin,market,symbol,name,status,data_freshness,confidence_score",
        "order=updated_at.asc,symbol.asc",
        `limit=${Math.min(maxPerMarket * 3, 100)}`,
      ].join("&"),
    });
    const byIsin = new Map();
    for (const row of marketRows || []) {
      const key = cleanIsin(row.isin) || cleanText(row.symbol).toUpperCase();
      if (!key) continue;
      const group = byIsin.get(key) || [];
      group.push(row);
      byIsin.set(key, group);
    }
    const preferred = Array.from(byIsin.values())
      .map(choosePreferredResolution)
      .filter(Boolean)
      .slice(0, maxPerMarket);
    rows.push(...preferred);
    if (rows.length >= maxTotal) break;
  }
  const deduped = Array.from(new Map(rows.map((row) => [row.symbol, row])).values()).slice(0, maxTotal);
  return { status: "supabase", configured: true, rows: deduped };
}

export async function readShadowReferenceCounts({ markets = [], provider = SHADOW_REFERENCE_PROVIDER, maxAgeHours = 0 } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return supabaseDisabled();
  const byMarket = {};
  try {
    for (const rawMarket of markets) {
      const market = cleanMarket(rawMarket);
      if (!market) continue;
      const query = [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `provider=eq.${encodeURIComponent(provider)}`,
        `market=eq.${encodeURIComponent(market)}`,
        "select=id",
      ].join("&") + countFreshnessFilter(maxAgeHours);
      byMarket[market] = await supabaseCount("shadow_instruments", { query });
    }
    return {
      status: "supabase",
      configured: true,
      byMarket,
      total: Object.values(byMarket).reduce((sum, count) => sum + Number(count || 0), 0),
    };
  } catch (error) {
    return { status: "error", configured: true, error: error.message, byMarket, total: 0 };
  }
}

export async function readSymbolResolutionCounts({ markets = [], provider = SHADOW_RESOLUTION_PROVIDER, maxAgeHours = 0 } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return supabaseDisabled();
  const byMarket = {};
  try {
    for (const rawMarket of markets) {
      const market = cleanMarket(rawMarket);
      if (!market) continue;
      const query = [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `provider=eq.${encodeURIComponent(provider)}`,
        `market=eq.${encodeURIComponent(market)}`,
        "select=id",
      ].join("&") + countFreshnessFilter(maxAgeHours);
      byMarket[market] = await supabaseCount("symbol_resolutions", { query });
    }
    return {
      status: "supabase",
      configured: true,
      byMarket,
      total: Object.values(byMarket).reduce((sum, count) => sum + Number(count || 0), 0),
    };
  } catch (error) {
    return { status: "error", configured: true, error: error.message, byMarket, total: 0 };
  }
}
