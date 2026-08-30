// lib/countryRsHydrate.js — hidratación server-only del RS país (MET-2b).
// No importar desde componentes cliente; usan lib/countryRs.js (lector puro).

import { countryCode } from "@/lib/symbols";
import { finiteOrNull, supabaseConfig, supabaseRequest, toDate } from "@/lib/supabaseServer";
import {
  countryRsEngineVersionForMarket,
  isCountryRsMarketSupported,
  US_COUNTRY_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";
import { exclusionReasonText, readGlobalRsForSymbols } from "@/lib/globalRs";
import {
  attachWeeklyCountryRs,
  countryExclusionReasonText,
  countryRsMarketForRow,
  COUNTRY_RS_MARKET_UNSUPPORTED_REASON,
  COUNTRY_RS_NOT_RANKED_REASON,
} from "@/lib/countryRs";

const WEEKLY_COUNTRY_RS_SELECT = "symbol,snapshot_date,week_key,engine_version,rank_index,rs_rating,rs_raw,sample_size,metrics";

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function dateTime(value = "") {
  const time = Date.parse(String(value || "").length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : 0;
}

function weeklyCountryRsEntry(row = {}) {
  const rsRating = finiteOrNull(row.rs_rating);
  if (!Number.isFinite(rsRating)) {
    const code = String(row?.metrics?.exclusionReason || "").trim();
    if (!code) return null;
    const detail = String(row?.metrics?.exclusionDetail || "").trim();
    return {
      available: false,
      reason: countryExclusionReasonText(code) || exclusionReasonText(code) || COUNTRY_RS_NOT_RANKED_REASON,
      exclusionReason: code,
      exclusionDetail: detail,
    };
  }
  return {
    available: true,
    rsRating,
    rsRaw: finiteOrNull(row.rs_raw),
    rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
    sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
    asOf: toDate(row.snapshot_date),
    weekKey: row.week_key || "",
    engineVersion: row.engine_version || "",
  };
}

async function readEngineCountryRsForSymbols(symbols = [], engineVersion = "") {
  const config = supabaseConfig();
  const cleanSymbols = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  const bySymbol = new Map();
  if (!config.configured || !cleanSymbols.length || !engineVersion) {
    return { configured: config.configured, bySymbol };
  }
  for (const symbol of cleanSymbols) {
    bySymbol.set(symbol, { available: false, reason: COUNTRY_RS_NOT_RANKED_REASON });
  }
  const chunkSize = 16;
  const rowsPerSymbolCap = 5;
  const chunks = [];
  for (let i = 0; i < cleanSymbols.length; i += chunkSize) chunks.push(cleanSymbols.slice(i, i + chunkSize));
  for (const chunk of chunks) {
    const rows = await supabaseRequest("rs_weekly_items", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `engine_version=eq.${encodeURIComponent(engineVersion)}`,
        `symbol=in.(${chunk.map(encodeURIComponent).join(",")})`,
        `select=${WEEKLY_COUNTRY_RS_SELECT}`,
        "order=symbol.asc,snapshot_date.desc",
        `limit=${Math.min(chunk.length * rowsPerSymbolCap, 1000)}`,
      ].join("&"),
    });
    const latestBySymbol = new Map();
    for (const row of rows || []) {
      const symbol = String(row.symbol || "").trim().toUpperCase();
      if (!latestBySymbol.has(symbol)) latestBySymbol.set(symbol, row);
    }
    for (const [symbol, row] of latestBySymbol) {
      const entry = weeklyCountryRsEntry(row);
      if (entry) bySymbol.set(symbol, entry);
    }
  }
  return { configured: true, bySymbol };
}

export async function readCountryRsForSymbols(symbols = [], options = {}) {
  const config = supabaseConfig();
  const cleanSymbols = [...new Set((symbols || []).map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];
  const bySymbol = new Map();
  if (!config.configured || !cleanSymbols.length) {
    return { configured: config.configured, bySymbol };
  }

  const symbolMarkets = options.symbolMarkets || new Map();
  const usSymbols = [];
  const byEngine = new Map();
  for (const symbol of cleanSymbols) {
    const market = String(symbolMarkets.get(symbol) || countryCode(symbol) || "").trim().toUpperCase();
    if (!isCountryRsMarketSupported(market)) {
      bySymbol.set(symbol, {
        available: false,
        reason: COUNTRY_RS_MARKET_UNSUPPORTED_REASON,
        exclusionReason: "market-not-supported",
        market,
      });
      continue;
    }
    const engineVersion = countryRsEngineVersionForMarket(market);
    if (market === "US") usSymbols.push(symbol);
    else {
      const list = byEngine.get(engineVersion) || [];
      list.push(symbol);
      byEngine.set(engineVersion, list);
    }
  }

  if (usSymbols.length) {
    const us = await readGlobalRsForSymbols(usSymbols, { engineVersion: US_COUNTRY_RS_ENGINE_VERSION, bulkSnapshot: false });
    for (const [symbol, entry] of us.bySymbol || []) {
      bySymbol.set(symbol, entry);
    }
  }
  for (const [engineVersion, engineSymbols] of byEngine) {
    const intl = await readEngineCountryRsForSymbols(engineSymbols, engineVersion);
    for (const [symbol, entry] of intl.bySymbol || []) {
      bySymbol.set(symbol, entry);
    }
  }
  return { configured: true, bySymbol };
}

export { attachWeeklyCountryRs };

/** Serie histórica semanal del RS país para la ficha (un engine por mercado). */
export async function readCountryRsSeriesForSymbol(symbol = "", options = {}) {
  const config = supabaseConfig();
  const clean = cleanSymbol(symbol);
  if (!config.configured || !clean) {
    return { configured: config.configured, series: [], latest: null, market: "" };
  }
  const market = String(countryCode(clean) || "").trim().toUpperCase();
  const engineVersion = countryRsEngineVersionForMarket(market);
  if (!engineVersion) {
    return { configured: true, symbol: clean, market, series: [], latest: null };
  }
  const limit = Math.min(Math.max(Number(options.limit || 180), 1), 260);
  const rows = await supabaseRequest("rs_weekly_items", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `symbol=eq.${encodeURIComponent(clean)}`,
      `engine_version=eq.${encodeURIComponent(engineVersion)}`,
      `select=${WEEKLY_COUNTRY_RS_SELECT},base_currency`,
      "order=snapshot_date.desc",
      `limit=${limit}`,
    ].join("&"),
  });
  const series = (rows || [])
    .map((row) => ({
      date: toDate(row.snapshot_date),
      weekKey: row.week_key || "",
      rsRating: finiteOrNull(row.rs_rating),
      rsRaw: finiteOrNull(row.rs_raw),
      rank: Number.isFinite(Number(row.rank_index)) ? Number(row.rank_index) : null,
      sampleSize: Number.isFinite(Number(row.sample_size)) ? Number(row.sample_size) : null,
      baseCurrency: row.base_currency || "",
      engineVersion: row.engine_version || engineVersion,
      market,
      metrics: row.metrics || {},
    }))
    .filter((row) => row.date && Number.isFinite(row.rsRating))
    .sort((a, b) => dateTime(a.date) - dateTime(b.date));
  return {
    configured: true,
    symbol: clean,
    market,
    engineVersion,
    series,
    latest: series.at(-1) || null,
  };
}

export async function hydrateRowsWithWeeklyCountryRs(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const symbolMarkets = new Map(list.map((row) => [
    String(row?.symbol || "").trim().toUpperCase(),
    countryRsMarketForRow(row),
  ]));
  const symbols = list.map((row) => row?.symbol).filter(Boolean);
  const weekly = await readCountryRsForSymbols(symbols, { symbolMarkets }).catch(() => ({ configured: false, bySymbol: new Map() }));
  return list.map((row) => attachWeeklyCountryRs(row, weekly.bySymbol));
}
