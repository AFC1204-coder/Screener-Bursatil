// scripts/rs-theme-private.mjs — motor de RS tema privado (MET-3b).
// engine_version: statsedge-private-theme-rs-usd-{slug}-v1 por cada una de las
// 12 THEME_RULES. Población = universo MET-1; precios USD vía FX.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/rs-theme-private.mjs [--dry-run] [--write] [--limit=N] \
//     [--concurrency=8] [--min-sample=20] [--markets=HK,CA] [--skip-us] \
//     [--themes=Software / IA,Semis / fotonica]

import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

import { percentileFromSorted } from "@/lib/relativeStrength.js";
import { supabaseConfig, supabaseRequest, finiteOrNull, toDate } from "@/lib/supabaseServer.js";
import { readProfilesForSymbols } from "@/lib/fundamentalsCache.js";
import { FX_BASE_CURRENCY, FX_CURRENCIES, FX_MAX_AGE_SESSIONS } from "@/lib/rsFx.js";
import { themeRsEngineVersion } from "@/lib/rsEngines.js";
import {
  rankableThemeForProfile,
  rankableThemeKeys,
  THEME_SAMPLE_INSUFFICIENT,
} from "@/lib/themeRsAssign.js";
import { GLOBAL_RS_INTL_MARKETS, intlUniverseRows, universeFingerprint } from "@/lib/rsGlobalUniverse.js";
import { computeSymbol, parseArgs as parseGlobalArgs } from "@/scripts/rs-global-private.mjs";

const EXCLUDED_RANK_INDEX = 0;
const DEFAULT_MIN_SAMPLE = 20;

export const EXCLUSION_REASONS = {
  THEME_PROFILE_MISSING: "theme-profile-missing",
  THEME_RESIDUAL: "theme-residual",
  THEME_SAMPLE_INSUFFICIENT,
  NOT_IN_UNIVERSE: "not-in-universe",
};

export function parseArgs(argv) {
  const base = parseGlobalArgs(argv);
  const themes = rankableThemeKeys();
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    if (rawKey.trim() === "themes") {
      const picked = String(rawValue || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (picked.length) base.themes = picked.filter((key) => themes.includes(key));
    }
  }
  if (!base.themes) base.themes = themes;
  return base;
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

const CLOSED_END_FUND_NAME_PATTERN = /\b(FUND|BDC|BUSINESS DEVELOPMENT (CORP(ORATION)?|COMPANY)|CLOSED[- ]END)\b/i;

async function fetchLatestUsSnapshotId(config) {
  const rows = await supabaseRequest("universe_snapshot_symbols", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      "market=eq.US",
      "select=snapshot_id,created_at",
      "order=created_at.desc",
      "limit=1",
    ].join("&"),
  });
  const snapshotId = rows?.[0]?.snapshot_id;
  if (!snapshotId) throw new Error("No hay ninguna instantánea de universe_snapshot_symbols con market='US'.");
  return { snapshotId, asOf: rows[0].created_at };
}

async function fetchUniverseRows(config, snapshotId) {
  const pageSize = 1000;
  const rows = [];
  let lastId = "";
  for (;;) {
    const query = [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `snapshot_id=eq.${encodeURIComponent(snapshotId)}`,
      "market=eq.US",
      "select=id,symbol,name,instrument_type,passed",
      "order=id.asc",
      `limit=${pageSize}`,
      lastId ? `id=gt.${encodeURIComponent(lastId)}` : "",
    ].filter(Boolean).join("&");
    const page = await supabaseRequest("universe_snapshot_symbols", { query });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    lastId = page.at(-1).id;
    if (page.length < pageSize) break;
  }
  return rows;
}

function buildUsPopulation(universeRows) {
  const passedEquity = universeRows.filter((row) => row.passed === true && (row.instrument_type === "equity" || row.instrument_type === "listed-vehicle"));
  const clean = passedEquity
    .filter((row) => !CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""))
    .map((row) => ({
      symbol: String(row.symbol || "").trim().toUpperCase(),
      name: row.name || "",
      market: "US",
      currency: FX_BASE_CURRENCY,
      source: "universe_snapshot_symbols",
    }));
  return { rows: clean };
}

async function fetchBarsForSymbol(config, symbol) {
  const query = [
    `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
    `symbol=eq.${encodeURIComponent(symbol)}`,
    "select=trade_date,close",
    "order=trade_date.desc",
    "limit=320",
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

async function loadFxSeries(config, deps) {
  const fetchBars = deps.fetchBarsForSymbol || fetchBarsForSymbol;
  const byCurrency = new Map();
  for (const currency of FX_CURRENCIES) {
    const { fxPairsFor, fxSeriesDiscontinuity } = await import("@/lib/rsFx.js");
    const [direct, inverse] = fxPairsFor(currency);
    let bars = await fetchBars(config, direct).catch(() => []);
    let usedPair = direct;
    let isInverse = false;
    if (bars.length < 261) {
      const inverseBars = await fetchBars(config, inverse).catch(() => []);
      if (inverseBars.length > bars.length) {
        bars = inverseBars;
        usedPair = inverse;
        isInverse = true;
      }
    }
    const discontinuity = fxSeriesDiscontinuity(bars);
    byCurrency.set(currency, { currency, pair: usedPair, inverse: isInverse, bars, discontinuity });
  }
  return byCurrency;
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

function themeRulesSha() {
  const keys = rankableThemeKeys().join("\n");
  return createHash("sha256").update(keys).digest("hex");
}

async function upsertThemeSnapshot(config, {
  engineVersion,
  themeKey,
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
    base_currency: FX_BASE_CURRENCY,
    lookback_weeks: [13, 26, 39, 52],
    weights: { "13w": 0.4, "26w": 0.2, "39w": 0.2, "52w": 0.2 },
    min_sample: minSample,
    symbol_count: ranked.length,
    source: "scripts/rs-theme-private.mjs",
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

  const base = (row) => ({
    owner_id: config.ownerId,
    snapshot_id: snapshotId,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    engine_version: engineVersion,
    base_currency: FX_BASE_CURRENCY,
    symbol: row.symbol,
    company_name: row.name || null,
    country: row.market || null,
    sector: row.sector || null,
    industry: row.industry || null,
    theme: themeKey,
  });

  const rankedPayloads = ranked.map((row) => ({
    ...base(row),
    rank_index: row.rankIndex,
    currency: row.currency || null,
    normalized_currency: row.normalizedCurrency || null,
    rs_rating: row.rsRating,
    rs_raw: row.raw,
    usd_close: row.priceInBase,
    local_close: row.localClose,
    fx_rate: row.fxRate,
    fx_date: row.fxDate,
    sample_size: ranked.length,
    metrics: {
      returns: row.returns,
      closeDate: row.closeDate,
      market: row.market,
      scopeTheme: themeKey,
      unitDivisor: row.unitDivisor,
      barsUsed: row.barsUsed,
      ...(row.sampleInsufficient ? {
        excluded: true,
        exclusionReason: THEME_SAMPLE_INSUFFICIENT,
        exclusionDetail: row.detail || `N=${ranked.length}`,
      } : {}),
    },
  }));

  const excludedPayloads = persistExclusions
    ? excluded.map((row) => ({
      ...base(row),
      rank_index: EXCLUDED_RANK_INDEX,
      currency: row.currency || null,
      normalized_currency: null,
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
        market: row.market,
        scopeTheme: themeKey,
      },
    }))
    : [];

  const payloads = [...rankedPayloads, ...excludedPayloads];
  const batchSize = 500;
  for (let i = 0; i < payloads.length; i += batchSize) {
    await supabaseRequest("rs_weekly_items", {
      method: "POST",
      query: "on_conflict=snapshot_id,symbol",
      prefer: "resolution=merge-duplicates",
      body: payloads.slice(i, i + batchSize),
    });
  }
  return { snapshotId, rankedWritten: rankedPayloads.length, excludedWritten: excludedPayloads.length };
}

export async function runThemeRanking(config, themeKey, population, args, deps = {}) {
  const fetchBars = deps.fetchBarsForSymbol || fetchBarsForSymbol;
  const fxSeries = deps.fxSeriesByCurrency;
  const requested = args.limit > 0 ? population.slice(0, args.limit) : population;
  const computed = await mapLimit(requested, args.concurrency, async (row) => {
    try {
      const bars = await fetchBars(config, row.symbol);
      const result = computeSymbol(row, bars, fxSeries);
      return { ...row, ...result };
    } catch (error) {
      return {
        ...row,
        ok: false,
        exclusionReason: "insufficient-bars",
        detail: `lectura fallida: ${error?.message || error}`,
      };
    }
  });

  const included = computed.filter((row) => row.ok);
  const excluded = computed.filter((row) => !row.ok);
  const sampleInsufficient = included.length < args.minSample;
  const sortedRaw = included.map((row) => row.raw).sort((a, b) => a - b);
  const ranked = included
    .slice()
    .sort((a, b) => b.raw - a.raw)
    .map((row, index) => ({
      ...row,
      rankIndex: index + 1,
      rsRating: sampleInsufficient
        ? null
        : percentileFromSorted(row.raw, sortedRaw, args.minSample),
    }));

  if (sampleInsufficient) {
    for (const row of ranked) {
      row.sampleInsufficient = true;
      row.exclusionReason = THEME_SAMPLE_INSUFFICIENT;
      row.detail = `N=${included.length}`;
    }
  }

  return {
    themeKey,
    engineVersion: themeRsEngineVersion(themeKey),
    populationDefined: population.length,
    populationRequested: requested.length,
    included: included.length,
    excluded,
    ranked,
    sampleInsufficient,
    fingerprint: universeFingerprint(population.map((row) => row.symbol)),
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
  console.log(`=== rs-theme-private.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} themes=${args.themes.length} ===`);

  let usRows = [];
  let usSnapshotId = "";
  if (!args.skipUs) {
    const { snapshotId } = await fetchLatestUsSnapshotId(config);
    usSnapshotId = snapshotId;
    const universeRows = await fetchUniverseRows(config, snapshotId);
    usRows = buildUsPopulation(universeRows).rows;
    console.log(`US equity investable: ${usRows.length}`);
  }

  const intlRows = intlUniverseRows(args.markets);
  const universe = [...usRows, ...intlRows];
  console.log(`Intl curado: ${intlRows.length} · Universo total: ${universe.length}`);

  const profiles = await readProfilesForSymbols(universe.map((row) => row.symbol), { concurrency: 4 });
  const assigned = universe.map((row) => {
    const profile = profiles.bySymbol.get(row.symbol) || {};
    const sector = profile.sector || "";
    const industry = profile.industry || "";
    const summary = profile.businessSummary || "";
    const themeAssign = rankableThemeForProfile(sector, industry, summary);
    return {
      ...row,
      sector,
      industry,
      businessSummary: summary,
      themeKey: themeAssign.themeKey,
      themeExclusion: themeAssign.exclusionReason,
    };
  });

  const fxSeries = await loadFxSeries(config, {});
  console.log(`Series FX cargadas: ${FX_CURRENCIES.length}`);

  const themeReports = [];
  for (const themeKey of args.themes) {
    const population = assigned.filter((row) => row.themeKey === themeKey);
    console.log("");
    console.log(`--- Theme: ${themeKey} (${population.length} en universo) ---`);
    if (!population.length) {
      console.log("Sin población en universo para este theme — no se genera snapshot.");
      continue;
    }
    const report = await runThemeRanking(config, themeKey, population, args, { fxSeriesByCurrency: fxSeries });
    themeReports.push(report);
    console.log(`Computables: ${report.included}/${report.populationDefined}`);
    console.log(`Excluidos técnicos: ${report.excluded.length}`);
    console.log(`engine_version: ${report.engineVersion}`);
    if (report.sampleInsufficient) {
      console.log(`AVISO: muestra ${report.included} < min-sample ${args.minSample} → theme-sample-insufficient`);
    }
    for (const row of report.ranked.slice(0, 5)) {
      console.log(`  #${row.rankIndex} ${row.symbol.padEnd(12)} rs=${String(row.rsRating).padStart(4)} raw=${row.raw?.toFixed?.(2) || "-"}`);
    }

    if (args.write && !args.dryRun) {
      const weekKey = isoWeekKey(new Date(`${targetDate}T00:00:00Z`));
      const stats = {
        scopeTheme: themeKey,
        themeRulesSha: themeRulesSha(),
        universesGitSha: process.env.STATSEDGE_UNIVERSES_GIT_SHA || null,
        businessThemeGitSha: process.env.STATSEDGE_BUSINESS_THEME_GIT_SHA || null,
        usUniverseSnapshotId: usSnapshotId || null,
        universeFingerprint: report.fingerprint.hash,
        universeSymbolCount: report.fingerprint.count,
        themePopulationDefined: report.populationDefined,
        themePopulationRanked: report.included,
        sampleInsufficient: report.sampleInsufficient,
        exclusionCount: report.excluded.length,
        fxMaxAgeSessions: FX_MAX_AGE_SESSIONS,
        baseCurrency: FX_BASE_CURRENCY,
        generatedBy: "scripts/rs-theme-private.mjs",
      };
      const result = await upsertThemeSnapshot(config, {
        engineVersion: report.engineVersion,
        themeKey,
        snapshotDate: targetDate,
        weekKey,
        minSample: args.minSample,
        ranked: report.ranked,
        excluded: report.excluded,
        stats,
        persistExclusions: args.persistExclusions,
      });
      console.log(`Escrito theme ${themeKey}: snapshot id=${result.snapshotId}, rankeados=${result.rankedWritten}, exclusiones=${result.excludedWritten}`);
    }
  }

  const residual = assigned.filter((row) => row.themeExclusion === EXCLUSION_REASONS.THEME_RESIDUAL).length;
  const profileMissing = assigned.filter((row) => row.themeExclusion === EXCLUSION_REASONS.THEME_PROFILE_MISSING).length;
  console.log("");
  console.log(`Residual (sin ranking): ${residual} · Perfil insuficiente: ${profileMissing}`);
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
