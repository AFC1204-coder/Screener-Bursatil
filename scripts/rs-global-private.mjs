// scripts/rs-global-private.mjs — motor de RS global privado multi-mercado con
// ajuste por divisa (MET-1b, Fase 1). engine_version:
// statsedge-private-global-rs-usd-v1.
//
// Spec: docs/spec-rs-global-multi-mercado-fx.md (aceptado 877c318). No reabre
// metodología: la fórmula, las ventanas, las exclusiones y la convención FX
// vienen cerradas de allí y del addendum §7-§10.
//
// FORK, NO EXTENSIÓN, de scripts/rs-universe.mjs — y por qué:
// rs-universe.mjs es el motor US CONGELADO. El spec (pregunta 6) lo deja como
// base metodológica de MET-2 (RS país US) y como canónico de la línea pública
// US-only; meterle un modo global lo convertiría en dos motores en un archivo,
// con el riesgo de que un cambio pensado para el global mueva el histórico US
// que MET-2 necesita reproducir. La fórmula se reimplementa idéntica (mismas
// constantes, mismos offsets, mismo percentileFromSorted) sobre precios ya
// convertidos.
//
// QUÉ CAMBIA RESPECTO AL MOTOR US
//   1. Población: US investable (misma que el motor US) + 833 símbolos intl
//      curados (lib/rsGlobalUniverse.js).
//   2. priceInBase = localPrice × FX[C→USD]; US fx=1 por contrato (§7.3).
//   3. Una exclusión más: FX no apto (fx-unavailable / fx-stale /
//      fx-discontinuous / fx-currency-unknown).
//   4. El motivo de exclusión se PERSISTE por símbolo/semana, no solo se
//      imprime — ver «PERSISTENCIA DEL MOTIVO» abajo.
//   5. stats del snapshot registra el denominador versionado.
//
// ORDEN DE EXCLUSIONES (spec pregunta 5, literal): (1) barras locales
// insuficientes; (2) discontinuidad ≥3x en la serie LOCAL; (3) FX no apto. La
// discontinuidad se detecta ANTES de convertir, sobre la serie local, para no
// confundir un salto de FX con un split — la serie FX tiene su propio control.
//
// PERSISTENCIA DEL MOTIVO (spec § Superficies, requisito de MET-1b)
// rs_weekly_items no tiene columna exclusion_reason y el DDL no se toca en este
// ticket. Los excluidos se persisten como filas del mismo snapshot con
// rs_rating=null, rs_raw=null y el motivo en metrics.exclusionReason
// (+ metrics.exclusionDetail). rank_index es NOT NULL en el esquema, así que
// esas filas llevan el centinela EXCLUDED_RANK_INDEX (0): ningún rankeado puede
// tener rank 0 (los rangos empiezan en 1), y weeklyRsEntry de lib/globalRs.js ya
// descarta cualquier fila sin rs_rating finito, así que una fila de exclusión
// NUNCA puede colarse como un RS. Lo que sí hace es dar a la lectura el motivo
// exacto en vez del texto genérico "barras insuficientes o serie discontinua".
//
// ANTI-LOOKAHEAD (addendum §8): para cada símbolo se usa el último FX con
// trade_date <= la fecha de su barra de cierre. El cómputo corre tras el cierre
// semanal de todos los mercados, así que todo dato usado llevaba ≥1 día
// público. Yahoo no expone fxPublishedAt: la limitación se declara y, en
// consecuencia, --as-of NO existe en este motor (el backfill histórico as-of
// está PROHIBIDO por el spec bajo este engine_version).
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/rs-global-private.mjs [--dry-run] [--write] [--limit=N] \
//     [--concurrency=8] [--min-sample=20] [--markets=HK,CA] [--skip-us]

import { pathToFileURL } from "node:url";

import { percentileFromSorted } from "@/lib/relativeStrength.js";
import { supabaseConfig, supabaseRequest, finiteOrNull, toDate } from "@/lib/supabaseServer.js";
import { detectPriceDiscontinuities } from "@/lib/indicators.js";
import { PRIVATE_GLOBAL_RS_ENGINE_VERSION } from "@/lib/rsEngines.js";
import {
  convertToBase,
  currencyForMarket,
  fxPairsFor,
  fxSeriesDiscontinuity,
  FX_BASE_CURRENCY,
  FX_CURRENCIES,
  FX_EXCLUSION_REASONS,
  FX_MAX_AGE_SESSIONS,
  pickFxObservation,
} from "@/lib/rsFx.js";
import { GLOBAL_RS_INTL_MARKETS, intlUniverseRows, universeFingerprint } from "@/lib/rsGlobalUniverse.js";

// ── Constantes de metodología — IDÉNTICAS al motor US, a propósito ────────
// Cambiar cualquiera de estas es cambiar la métrica, y eso exige
// engine_version nuevo (spec, resolución de la identidad §6).
const RETURN_WINDOWS_WEEKS = [13, 26, 39, 52];
const RETURN_WEIGHTS = [0.4, 0.2, 0.2, 0.2];
const TRADING_DAYS_PER_WEEK = 5;
const DEFAULT_MIN_SAMPLE = 20;
const MIN_BARS_REQUIRED = RETURN_WINDOWS_WEEKS.at(-1) * TRADING_DAYS_PER_WEEK + 1;
const DISCONTINUITY_FACTOR_THRESHOLD = 3;
const CLOSED_END_FUND_NAME_PATTERN = /\b(FUND|BDC|BUSINESS DEVELOPMENT (CORP(ORATION)?|COMPANY)|CLOSED[- ]END)\b/i;

// Centinela de rank para las filas de exclusión (ver cabecera). Los rangos
// reales empiezan en 1.
const EXCLUDED_RANK_INDEX = 0;

// Motivos de exclusión. Los de FX vienen de lib/rsFx.js y se enumeran uno a uno
// en vez de con un spread: FX_EXCLUSION_REASONS tiene su propia clave
// DISCONTINUOUS (serie FX corrupta) que NO es la misma que la discontinuidad de
// la serie local (split sin ajustar). Un spread las habría colapsado y el motivo
// persistido habría culpado al split de un fallo del cruce de divisa.
const EXCLUSION_REASONS = {
  INSUFFICIENT_BARS: "insufficient-bars",
  DISCONTINUOUS: "discontinuous",
  FX_CURRENCY_UNKNOWN: FX_EXCLUSION_REASONS.CURRENCY_UNKNOWN,
  FX_UNAVAILABLE: FX_EXCLUSION_REASONS.UNAVAILABLE,
  FX_STALE: FX_EXCLUSION_REASONS.STALE,
  FX_DISCONTINUOUS: FX_EXCLUSION_REASONS.DISCONTINUOUS,
};

// ── CLI ──────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    concurrency: 8,
    minSample: DEFAULT_MIN_SAMPLE,
    markets: GLOBAL_RS_INTL_MARKETS,
    skipUs: false,
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
    else if (key === "markets") out.markets = String(rawValue || "").split(",").map((m) => m.trim().toUpperCase()).filter(Boolean);
    else if (key === "skip-us") out.skipUs = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "persist-exclusions") out.persistExclusions = rawValue !== "false";
    else if (key === "as-of") {
      // Deliberadamente rechazado, no ignorado: el spec PROHÍBE el backfill
      // histórico as-of bajo este engine_version (Yahoo no demuestra
      // disponibilidad temporal del FX). Aceptarlo en silencio produciría un
      // snapshot con lookahead indemostrable y aspecto legítimo.
      console.error("Error: --as-of está prohibido en este motor (spec: backfill histórico as-of no permitido sin fuente con metadatos de publicación FX).");
      process.exit(1);
    }
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

// ── Población US: misma consulta y mismo filtro que el motor US ───────────
// rs-universe.mjs no exporta sus funciones, así que se reproduce la MISMA
// consulta y el MISMO patrón (igual que hizo refresh-bars.mjs) en vez de
// modificar el motor congelado para exportarlas.

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
  const closedEndFunds = passedEquity.filter((row) => CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
  const clean = passedEquity
    .filter((row) => !CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""))
    .map((row) => ({ symbol: String(row.symbol || "").trim().toUpperCase(), name: row.name || "", market: "US", currency: FX_BASE_CURRENCY, source: "universe_snapshot_symbols" }));
  return { rows: clean, excludedAsClosedEndFund: closedEndFunds };
}

// ── Barras ───────────────────────────────────────────────────────────────

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
  // Una fila por trade_date (daily_bars admite varios proveedores por fecha):
  // la primera vista, dado el orden desc. Misma simplificación explícita que el
  // motor US.
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.trade_date)) byDate.set(row.trade_date, row);
  }
  return Array.from(byDate.values())
    .map((row) => ({ date: row.trade_date, close: finiteOrNull(row.close) }))
    .filter((row) => row.date && Number.isFinite(row.close))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Series FX cargadas una vez por corrida (10 divisas), no por símbolo: 833
// símbolos intl compartiendo diez series no pueden pagar una lectura cada uno.
async function loadFxSeries(config) {
  const byCurrency = new Map();
  for (const currency of FX_CURRENCIES) {
    const [direct, inverse] = fxPairsFor(currency);
    let bars = await fetchBarsForSymbol(config, direct).catch(() => []);
    let usedPair = direct;
    let isInverse = false;
    if (bars.length < MIN_BARS_REQUIRED) {
      const inverseBars = await fetchBarsForSymbol(config, inverse).catch(() => []);
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

// ── Cálculo por símbolo ──────────────────────────────────────────────────

/**
 * Aplica las tres exclusiones en el orden del spec y devuelve o el resultado
 * computable o el motivo. Exportada para test unitario: es la función donde
 * vive toda la política, y probarla no debe exigir Supabase.
 */
export function computeSymbol(row, bars, fxSeriesByCurrency, options = {}) {
  const minBars = options.minBars || MIN_BARS_REQUIRED;

  // (1) Barras locales insuficientes.
  if (bars.length < minBars) {
    return { ok: false, exclusionReason: EXCLUSION_REASONS.INSUFFICIENT_BARS, detail: `${bars.length}/${minBars} barras` };
  }

  // (2) Discontinuidad en la serie LOCAL, antes de convertir (spec pregunta 5).
  const discontinuity = detectPriceDiscontinuities(bars, DISCONTINUITY_FACTOR_THRESHOLD);
  if (discontinuity.discontinuous) {
    const { date, factor } = discontinuity.largestJump;
    return { ok: false, exclusionReason: EXCLUSION_REASONS.DISCONTINUOUS, detail: `salto de ${factor.toFixed(1)}x el ${date}` };
  }

  // (3) FX. El precio de CADA barra que entra en los rendimientos se convierte
  // con el FX de SU fecha — no con el FX de hoy aplicado a toda la serie. Esa
  // distinción es la métrica: el rendimiento sobre priceInBase compone
  // rendimiento local × rendimiento FX, que es exactamente el ajuste por divisa
  // que pide el spec. Aplicar una sola tasa a numerador y denominador la
  // cancelaría y devolvería el rendimiento local puro (la alternativa
  // "FX-hedged" que el spec RECHAZA).
  const currency = row.currency || currencyForMarket(row.market);
  const isBase = currency === FX_BASE_CURRENCY;
  const fxEntry = isBase ? null : fxSeriesByCurrency.get(currency === "GBX" ? "GBP" : currency);

  if (!isBase) {
    if (!fxEntry || !fxEntry.bars?.length) {
      return { ok: false, exclusionReason: EXCLUSION_REASONS.FX_UNAVAILABLE, detail: `sin serie FX para ${currency}` };
    }
    if (fxEntry.discontinuity?.discontinuous) {
      return {
        ok: false,
        exclusionReason: EXCLUSION_REASONS.FX_DISCONTINUOUS,
        detail: `serie FX ${fxEntry.pair} discontinua: ${fxEntry.discontinuity.factor?.toFixed?.(1)}x el ${fxEntry.discontinuity.date}`,
      };
    }
  }

  const offsets = [0, ...RETURN_WINDOWS_WEEKS.map((weeks) => weeks * TRADING_DAYS_PER_WEEK)];
  const converted = {};
  for (const offset of offsets) {
    const bar = bars[offset];
    if (!bar || !Number.isFinite(bar.close) || bar.close === 0) {
      return { ok: false, exclusionReason: EXCLUSION_REASONS.INSUFFICIENT_BARS, detail: `sin cierre en offset ${offset}` };
    }
    let fx = null;
    if (!isBase) {
      const picked = pickFxObservation(fxEntry.bars, bar.date, { maxAgeSessions: options.fxMaxAge || FX_MAX_AGE_SESSIONS });
      if (!picked.ok) {
        return { ok: false, exclusionReason: picked.exclusionReason, detail: `${picked.reason} (offset ${offset})` };
      }
      fx = { rate: picked.rate, inverse: fxEntry.inverse, fxDate: picked.fxDate };
    }
    const conversion = convertToBase(bar.close, currency, fx);
    if (!conversion.ok) {
      return { ok: false, exclusionReason: conversion.exclusionReason, detail: conversion.reason };
    }
    converted[offset] = { ...conversion, date: bar.date, fxDate: fx?.fxDate || bar.date };
  }

  const now = converted[0];
  const returns = {};
  for (const weeks of RETURN_WINDOWS_WEEKS) {
    const past = converted[weeks * TRADING_DAYS_PER_WEEK];
    if (!past || past.priceInBase === 0) {
      return { ok: false, exclusionReason: EXCLUSION_REASONS.INSUFFICIENT_BARS, detail: `sin precio convertido a ${weeks} semanas` };
    }
    returns[`${weeks}w`] = ((now.priceInBase / past.priceInBase) - 1) * 100;
  }
  const raw = RETURN_WINDOWS_WEEKS.reduce((sum, weeks, i) => sum + returns[`${weeks}w`] * RETURN_WEIGHTS[i], 0);

  return {
    ok: true,
    raw,
    returns,
    closeDate: now.date,
    priceInBase: now.priceInBase,
    localClose: now.localPrice,
    normalizedCurrency: now.normalizedCurrency,
    fxRate: now.fxRate,
    fxDate: now.fxDate,
    unitDivisor: now.unitDivisor,
    barsUsed: bars.length,
  };
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

// ── Escritura ────────────────────────────────────────────────────────────

async function upsertSnapshotAndItems(config, { snapshotDate, weekKey, minSample, ranked, excluded, stats, persistExclusions }) {
  const snapshotPayload = {
    owner_id: config.ownerId,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    engine_version: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
    base_currency: FX_BASE_CURRENCY,
    lookback_weeks: RETURN_WINDOWS_WEEKS,
    weights: Object.fromEntries(RETURN_WINDOWS_WEEKS.map((w, i) => [`${w}w`, RETURN_WEIGHTS[i]])),
    min_sample: minSample,
    symbol_count: ranked.length,
    source: "scripts/rs-global-private.mjs",
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
    engine_version: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
    base_currency: FX_BASE_CURRENCY,
    symbol: row.symbol,
    company_name: row.name || null,
    country: row.market || null,
    sector: null,
    industry: null,
    theme: null,
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
      unitDivisor: row.unitDivisor,
      barsUsed: row.barsUsed,
    },
  }));

  // Filas de exclusión: rs_rating null + motivo en metrics (ver cabecera).
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
        exclusionDetail: row.detail || "",
        market: row.market,
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

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  const targetDate = toDate(new Date().toISOString());
  console.log(`=== rs-global-private.mjs — engine=${PRIVATE_GLOBAL_RS_ENGINE_VERSION} modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} ===`);
  console.log(`Base: ${FX_BASE_CURRENCY} · fxMaxAge=${FX_MAX_AGE_SESSIONS} sesiones · min-sample=${args.minSample}`);

  // Universo: US + intl curado.
  let usRows = [];
  let usSnapshotId = "";
  if (!args.skipUs) {
    const { snapshotId, asOf } = await fetchLatestUsSnapshotId(config);
    usSnapshotId = snapshotId;
    console.log(`Instantánea de universo US: ${snapshotId} (creada ${asOf})`);
    const universeRows = await fetchUniverseRows(config, snapshotId);
    const built = buildUsPopulation(universeRows);
    usRows = built.rows;
    console.log(`US equity investable: ${usRows.length} (excluidos por patrón de fondo cerrado: ${built.excludedAsClosedEndFund.length})`);
  } else {
    console.log("US omitido por --skip-us (corrida de diagnóstico intl; el snapshot resultante NO es el ranking de producto).");
  }

  const intlRows = intlUniverseRows(args.markets);
  console.log(`Intl curado (${args.markets.length} mercados): ${intlRows.length}`);

  const universe = [...usRows, ...intlRows];
  const population = args.limit > 0 ? universe.slice(0, args.limit) : universe;
  console.log(`Universo total: ${universe.length}${args.limit > 0 ? ` (limitado a ${population.length} por --limit)` : ""}`);

  const fingerprint = universeFingerprint(universe.map((row) => row.symbol));
  console.log(`Huella del universo: ${fingerprint.hash} (${fingerprint.count} símbolos únicos)`);

  console.log("");
  console.log(`Cargando ${FX_CURRENCIES.length} series FX...`);
  const fxSeries = await loadFxSeries(config);
  for (const currency of FX_CURRENCIES) {
    const entry = fxSeries.get(currency);
    const flag = entry.bars.length >= MIN_BARS_REQUIRED ? "OK" : "INSUFICIENTE";
    const disc = entry.discontinuity?.discontinuous ? ` DISCONTINUA(${entry.discontinuity.factor?.toFixed?.(1)}x el ${entry.discontinuity.date})` : "";
    console.log(`  ${currency} ${entry.pair}${entry.inverse ? " (inverso)" : ""} barras=${entry.bars.length} última=${entry.bars[0]?.date || "-"} ${flag}${disc}`);
  }

  console.log("");
  console.log(`Calculando ${population.length} símbolos (concurrency=${args.concurrency})...`);
  const computed = await mapLimit(population, args.concurrency, async (row) => {
    try {
      const bars = await fetchBarsForSymbol(config, row.symbol);
      return { ...row, ...computeSymbol(row, bars, fxSeries) };
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
    .map((row, index) => ({ ...row, rankIndex: index + 1, rsRating: percentileFromSorted(row.raw, sortedRaw, args.minSample) }));

  // ── Cobertura por mercado: el denominador declarado, no amputado ────────
  const coverage = {};
  for (const row of computed) {
    const market = row.market || "?";
    coverage[market] = coverage[market] || { definidos: 0, computables: 0, motivos: {} };
    coverage[market].definidos += 1;
    if (row.ok) coverage[market].computables += 1;
    else coverage[market].motivos[row.exclusionReason] = (coverage[market].motivos[row.exclusionReason] || 0) + 1;
  }

  const reasonTotals = {};
  for (const row of excluded) reasonTotals[row.exclusionReason] = (reasonTotals[row.exclusionReason] || 0) + 1;

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Universo evaluado: ${population.length}`);
  console.log(`Rankeados: ${ranked.length}`);
  console.log(`Excluidos: ${excluded.length}`);
  console.log(`Motivos: ${JSON.stringify(reasonTotals)}`);
  console.log("");
  console.log("Cobertura por mercado (computables/definidos):");
  for (const market of Object.keys(coverage).sort()) {
    const stat = coverage[market];
    const pct = stat.definidos ? ((stat.computables / stat.definidos) * 100).toFixed(0) : "0";
    const motivos = Object.keys(stat.motivos).length ? ` motivos=${JSON.stringify(stat.motivos)}` : "";
    console.log(`  ${market.padEnd(3)} ${String(stat.computables).padStart(5)}/${String(stat.definidos).padEnd(5)} (${pct}%)${motivos}`);
  }

  if (ranked.length < args.minSample) {
    console.log("");
    console.log(`AVISO: muestra (${ranked.length}) por debajo de min-sample (${args.minSample}) — percentileFromSorted devolverá null para todas las filas.`);
  }

  console.log("");
  console.log(`Top 20 (de ${ranked.length}):`);
  for (const row of ranked.slice(0, 20)) {
    console.log(`  #${String(row.rankIndex).padStart(4)} ${row.symbol.padEnd(12)} ${String(row.market).padEnd(3)} rs=${String(row.rsRating).padStart(3)} raw=${row.raw.toFixed(2).padStart(9)} usd=${row.priceInBase?.toFixed(2)} fx=${row.fxRate?.toFixed(5)}`);
  }
  console.log("");
  console.log("Fondo del ranking (5):");
  for (const row of ranked.slice(-5)) {
    console.log(`  #${String(row.rankIndex).padStart(4)} ${row.symbol.padEnd(12)} ${String(row.market).padEnd(3)} rs=${String(row.rsRating).padStart(3)} raw=${row.raw.toFixed(2).padStart(9)} usd=${row.priceInBase?.toFixed(2)}`);
  }

  // Muestra intl explícita: el objetivo del ticket es que HK/CA/EU dejen de
  // mostrar "–". Verlo en el reporte evita tener que ir a la UI para saberlo.
  const intlRanked = ranked.filter((row) => row.market !== "US");
  console.log("");
  console.log(`Intl rankeados: ${intlRanked.length}. Muestra:`);
  for (const row of intlRanked.slice(0, 10)) {
    console.log(`  #${String(row.rankIndex).padStart(4)} ${row.symbol.padEnd(12)} ${String(row.market).padEnd(3)} rs=${String(row.rsRating).padStart(3)} local=${row.localClose?.toFixed(2)} ${row.currency} → usd=${row.priceInBase?.toFixed(2)} (fx=${row.fxRate?.toFixed(5)} ${row.fxDate})`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log("");
  console.log(`Tiempo total: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (args.write && !args.dryRun) {
    const weekKey = isoWeekKey(new Date(`${targetDate}T00:00:00Z`));
    const stats = {
      usUniverseSnapshotId: usSnapshotId || null,
      universeFingerprint: fingerprint.hash,
      universeSymbolCount: fingerprint.count,
      intlMarkets: args.markets,
      intlSymbolCount: intlRows.length,
      usSymbolCount: usRows.length,
      coverageByMarket: coverage,
      exclusionReasonTotals: reasonTotals,
      fxMaxAgeSessions: FX_MAX_AGE_SESSIONS,
      fxPairs: Object.fromEntries(FX_CURRENCIES.map((c) => [c, fxSeries.get(c)?.pair || null])),
      baseCurrency: FX_BASE_CURRENCY,
      generatedBy: "scripts/rs-global-private.mjs",
      // Git SHA de lib/universes.js: el spec exige versionar el denominador
      // (invariante 10). Se resuelve fuera del script y se pasa por entorno para
      // no ejecutar git desde aquí; si falta, se declara ausente en vez de
      // inventarlo.
      universesGitSha: process.env.STATSEDGE_UNIVERSES_GIT_SHA || null,
    };
    console.log("");
    console.log(`Escribiendo snapshot ${weekKey} (${targetDate})...`);
    const result = await upsertSnapshotAndItems(config, {
      snapshotDate: targetDate,
      weekKey,
      minSample: args.minSample,
      ranked,
      excluded,
      stats,
      persistExclusions: args.persistExclusions,
    });
    console.log(`Escrito. rs_weekly_snapshots.id=${result.snapshotId}`);
    console.log(`  filas rankeadas: ${result.rankedWritten}`);
    console.log(`  filas de exclusión (rs_rating null + motivo en metrics): ${result.excludedWritten}`);
    console.log("");
    console.log("NOTA: el RS visible NO cambia por esta escritura. El pin de lib/rsEngines.js es el interruptor.");
  } else {
    console.log("");
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
