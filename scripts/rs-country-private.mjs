// scripts/rs-country-private.mjs — motor de RS país intl (MET-2b).
//
// Ranking semanal POR MERCADO sobre precios locales, sin FX. US usa
// scripts/rs-universe.mjs (statsedge-us-equity-rs-v1); este script cubre
// GLOBAL_RS_INTL_MARKETS con engine_version sufijado por mercado para no
// tocar el UNIQUE de rs_weekly_snapshots.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/rs-country-private.mjs [--dry-run] [--write] [--limit=N] \
//     [--concurrency=8] [--min-sample=20] [--markets=HK,CA]

import { pathToFileURL } from "node:url";

import { percentileFromSorted } from "@/lib/relativeStrength.js";
import { supabaseConfig, supabaseRequest, finiteOrNull, toDate } from "@/lib/supabaseServer.js";
import { detectPriceDiscontinuities } from "@/lib/indicators.js";
import { intlCountryRsEngineVersion } from "@/lib/rsEngines.js";
import { MARKET_CURRENCY, normalizeCurrencyUnit } from "@/lib/rsFx.js";
import { GLOBAL_RS_INTL_MARKETS, universeFingerprint } from "@/lib/rsGlobalUniverse.js";
import { marketSymbols } from "@/lib/universes.js";

const RETURN_WINDOWS_WEEKS = [13, 26, 39, 52];
const RETURN_WEIGHTS = [0.4, 0.2, 0.2, 0.2];
const TRADING_DAYS_PER_WEEK = 5;
const DEFAULT_MIN_SAMPLE = 20;
const MIN_BARS_REQUIRED = RETURN_WINDOWS_WEEKS.at(-1) * TRADING_DAYS_PER_WEEK + 1;
const DISCONTINUITY_FACTOR_THRESHOLD = 3;
const EXCLUDED_RANK_INDEX = 0;

export const EXCLUSION_REASONS = {
  INSUFFICIENT_BARS: "insufficient-bars",
  DISCONTINUOUS: "discontinuous",
  NOT_IN_UNIVERSE: "not-in-universe",
  MARKET_NOT_SUPPORTED: "market-not-supported",
};

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    concurrency: 8,
    minSample: DEFAULT_MIN_SAMPLE,
    markets: GLOBAL_RS_INTL_MARKETS,
    persistExclusions: true,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "concurrency") out.concurrency = Math.max(1, Number(rawValue) || 8);
    else if (key === "min-sample") out.minSample = Math.max(1, Number(rawValue) || DEFAULT_MIN_SAMPLE);
    else if (key === "markets") {
      out.markets = String(rawValue || "").split(",").map((m) => m.trim().toUpperCase()).filter(Boolean);
    }
    else if (key === "persist-exclusions") out.persistExclusions = rawValue !== "false";
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

function isoWeekKey(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.round((firstThursday - target.valueOf()) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function buildMarketPopulation(market) {
  const code = String(market || "").trim().toUpperCase();
  if (!GLOBAL_RS_INTL_MARKETS.includes(code)) {
    throw new Error(`Mercado no soportado: ${code}`);
  }
  const currency = MARKET_CURRENCY[code] || "";
  const symbols = marketSymbols(code);
  const rows = symbols.map((symbol) => ({
    symbol: String(symbol || "").trim().toUpperCase(),
    name: "",
    market: code,
    currency,
    source: "lib/universes.js",
  }));
  return { market: code, currency, rows };
}

async function fetchBarsForSymbol(config, symbol) {
  const query = [
    `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
    `symbol=eq.${encodeURIComponent(symbol)}`,
    "select=trade_date,close",
    "order=trade_date.desc",
    `limit=${MIN_BARS_REQUIRED + 50}`,
  ].join("&");
  const rows = await supabaseRequest("daily_bars", { query });
  if (!Array.isArray(rows)) return [];
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.trade_date)) byDate.set(row.trade_date, row);
  }
  return Array.from(byDate.values())
    .map((row) => ({ date: row.trade_date, close: finiteOrNull(row.close) }))
    .filter((row) => row.date && Number.isFinite(row.close))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Fórmula idéntica a rs-universe.mjs sobre precios locales (GBX→GBP antes).
 */
export function computeLocalSymbol(row, bars, options = {}) {
  const minBars = options.minBars || MIN_BARS_REQUIRED;
  if (bars.length < minBars) {
    return { ok: false, exclusionReason: EXCLUSION_REASONS.INSUFFICIENT_BARS, detail: `${bars.length}/${minBars} barras` };
  }
  const discontinuity = detectPriceDiscontinuities(bars, DISCONTINUITY_FACTOR_THRESHOLD);
  if (discontinuity.discontinuous) {
    const { date, factor } = discontinuity.largestJump;
    return {
      ok: false,
      exclusionReason: EXCLUSION_REASONS.DISCONTINUOUS,
      detail: `salto de ${factor.toFixed(1)}x el ${date}`,
    };
  }
  const normalized = normalizeCurrencyUnit(bars[0].close, row.currency || "");
  const nowClose = normalized.price;
  const returns = {};
  for (const weeks of RETURN_WINDOWS_WEEKS) {
    const offset = weeks * TRADING_DAYS_PER_WEEK;
    const pastBar = bars[offset];
    if (!pastBar || !Number.isFinite(pastBar.close) || pastBar.close === 0) {
      return { ok: false, exclusionReason: EXCLUSION_REASONS.INSUFFICIENT_BARS, detail: `sin cierre en offset ${weeks}w` };
    }
    const pastNorm = normalizeCurrencyUnit(pastBar.close, row.currency || "");
    if (!pastNorm.price) {
      return { ok: false, exclusionReason: EXCLUSION_REASONS.INSUFFICIENT_BARS, detail: `cierre inválido en offset ${weeks}w` };
    }
    returns[`${weeks}w`] = ((nowClose / pastNorm.price) - 1) * 100;
  }
  const raw = RETURN_WINDOWS_WEEKS.reduce((sum, weeks, i) => sum + returns[`${weeks}w`] * RETURN_WEIGHTS[i], 0);
  return { ok: true, returns, raw, closeDate: bars[0].date, close: nowClose, barsUsed: bars.length };
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

async function upsertMarketSnapshot(config, {
  engineVersion,
  baseCurrency,
  scopeMarket,
  snapshotDate,
  weekKey,
  minSample,
  ranked,
  excluded,
  stats,
  persistExclusions,
}) {
  const snapshotPayload = {
    owner_id: config.ownerId,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    engine_version: engineVersion,
    base_currency: baseCurrency,
    lookback_weeks: RETURN_WINDOWS_WEEKS,
    weights: Object.fromEntries(RETURN_WINDOWS_WEEKS.map((w, i) => [`${w}w`, RETURN_WEIGHTS[i]])),
    min_sample: minSample,
    symbol_count: ranked.length,
    source: "scripts/rs-country-private.mjs",
    stats,
    generated_at: new Date().toISOString(),
  };
  const snapshotRows = await supabaseRequest("rs_weekly_snapshots", {
    method: "POST",
    query: "on_conflict=owner_id,snapshot_date,engine_version,base_currency",
    prefer: "resolution=merge-duplicates,return=representation",
    body: snapshotPayload,
  });
  const snapshotId = snapshotRows?.[0]?.id;
  if (!snapshotId) throw new Error("El upsert de rs_weekly_snapshots no devolvió id.");

  const rankedPayloads = ranked.map((row) => ({
    owner_id: config.ownerId,
    snapshot_id: snapshotId,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    engine_version: engineVersion,
    base_currency: baseCurrency,
    rank_index: row.rankIndex,
    symbol: row.symbol,
    company_name: row.name || null,
    country: scopeMarket,
    sector: null,
    industry: null,
    theme: null,
    currency: baseCurrency,
    normalized_currency: baseCurrency,
    rs_rating: row.rsRating,
    rs_raw: row.raw,
    usd_close: null,
    local_close: row.close,
    fx_rate: null,
    fx_date: row.closeDate,
    sample_size: ranked.length,
    metrics: { returns: row.returns, closeDate: row.closeDate, scopeMarket },
  }));

  const excludedPayloads = persistExclusions ? excluded.map((row) => ({
    owner_id: config.ownerId,
    snapshot_id: snapshotId,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    engine_version: engineVersion,
    base_currency: baseCurrency,
    rank_index: EXCLUDED_RANK_INDEX,
    symbol: row.symbol,
    company_name: row.name || null,
    country: scopeMarket,
    sector: null,
    industry: null,
    theme: null,
    currency: baseCurrency,
    normalized_currency: baseCurrency,
    rs_rating: null,
    rs_raw: null,
    usd_close: null,
    local_close: null,
    fx_rate: null,
    fx_date: null,
    sample_size: ranked.length,
    metrics: {
      excluded: true,
      exclusionReason: row.exclusionReason,
      exclusionDetail: row.detail || row.reason || "",
      scopeMarket,
    },
  })) : [];

  const itemPayloads = [...rankedPayloads, ...excludedPayloads];
  const batchSize = 500;
  for (let i = 0; i < itemPayloads.length; i += batchSize) {
    await supabaseRequest("rs_weekly_items", {
      method: "POST",
      query: "on_conflict=snapshot_id,symbol",
      prefer: "resolution=merge-duplicates",
      body: itemPayloads.slice(i, i + batchSize),
    });
  }
  return { snapshotId, rankedWritten: ranked.length, excludedWritten: excludedPayloads.length };
}

export async function runMarketRanking(config, market, args, deps = {}) {
  const fetchBars = deps.fetchBarsForSymbol || fetchBarsForSymbol;
  const { market: scopeMarket, currency, rows: populationRows } = buildMarketPopulation(market);
  const requested = args.limit > 0 ? populationRows.slice(0, args.limit) : populationRows;
  const fingerprint = universeFingerprint(populationRows.map((row) => row.symbol));
  const computed = await mapLimit(requested, args.concurrency, async (row) => {
    try {
      const bars = await fetchBars(config, row.symbol);
      return { ...row, ...computeLocalSymbol(row, bars) };
    } catch (error) {
      return { ...row, ok: false, exclusionReason: EXCLUSION_REASONS.INSUFFICIENT_BARS, detail: `lectura fallida: ${error?.message || error}` };
    }
  });
  const included = computed.filter((row) => row.ok);
  const excluded = computed.filter((row) => !row.ok);
  const sortedRaw = included.map((row) => row.raw).sort((a, b) => a - b);
  const ranked = included
    .slice()
    .sort((a, b) => b.raw - a.raw)
    .map((row, index) => ({
      ...row,
      rankIndex: index + 1,
      rsRating: percentileFromSorted(row.raw, sortedRaw, args.minSample),
    }));
  return {
    scopeMarket,
    currency,
    engineVersion: intlCountryRsEngineVersion(scopeMarket),
    populationDefined: populationRows.length,
    populationRequested: requested.length,
    included: included.length,
    excluded,
    ranked,
    fingerprint,
  };
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }
  const targetDate = toDate(new Date().toISOString());
  console.log(`=== rs-country-private.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} mercados=${args.markets.join(",")} ===`);

  const marketReports = [];
  for (const market of args.markets) {
    if (!GLOBAL_RS_INTL_MARKETS.includes(market)) {
      console.error(`Mercado omitido (no soportado): ${market}`);
      continue;
    }
    console.log("");
    console.log(`--- Mercado ${market} ---`);
    const report = await runMarketRanking(config, market, args);
    marketReports.push(report);
    console.log(`Población curada: ${report.populationDefined}${args.limit > 0 ? ` (limitada a ${report.populationRequested})` : ""}`);
    console.log(`Incluidos en ranking: ${report.included}`);
    console.log(`Excluidos: ${report.excluded.length}`);
    console.log(`engine_version: ${report.engineVersion}`);
    console.log(`universe hash: ${report.fingerprint.hash.slice(0, 12)}… (${report.fingerprint.count} símbolos)`);
    for (const row of report.ranked.slice(0, 5)) {
      console.log(`  #${row.rankIndex} ${row.symbol.padEnd(10)} rs=${String(row.rsRating).padStart(3)} raw=${row.raw.toFixed(2)}`);
    }
    if (args.write && !args.dryRun) {
      const weekKey = isoWeekKey(new Date(`${targetDate}T00:00:00Z`));
      const stats = {
        scopeMarket: report.scopeMarket,
        universesGitSha: process.env.STATSEDGE_UNIVERSES_GIT_SHA || null,
        universeFingerprint: report.fingerprint.hash,
        universeSymbolCount: report.fingerprint.count,
        populationDefined: report.populationDefined,
        populationRanked: report.included,
        exclusionCount: report.excluded.length,
        generatedBy: "scripts/rs-country-private.mjs",
      };
      const result = await upsertMarketSnapshot(config, {
        engineVersion: report.engineVersion,
        baseCurrency: report.currency,
        scopeMarket: report.scopeMarket,
        snapshotDate: targetDate,
        weekKey,
        minSample: args.minSample,
        ranked: report.ranked,
        excluded: report.excluded,
        stats,
        persistExclusions: args.persistExclusions,
      });
      console.log(`Escrito ${report.scopeMarket}: snapshot id=${result.snapshotId}, rankeados=${result.rankedWritten}, exclusiones=${result.excludedWritten}`);
    }
  }

  console.log("");
  console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (!args.write || args.dryRun) {
    console.log("Dry-run: no se escribió nada en Supabase. Pasa --write para persistir.");
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Error fatal:", error?.message || error);
    process.exitCode = 1;
  });
}
