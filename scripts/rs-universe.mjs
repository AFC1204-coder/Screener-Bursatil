// scripts/rs-universe.mjs — calculador de RS (fuerza relativa) como
// percentil sobre el universo estadounidense. Fase 1 del plan de
// docs/adr-rs-universo-us.md: script ejecutable a mano, sin cron.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/rs-universe.mjs --population=equity [--dry-run] [--write] \
//     [--limit=N] [--concurrency=8] [--min-sample=20] [--as-of=YYYY-MM-DD]
//
// Por defecto corre en --dry-run (calcula y reporta, no escribe). Escribir
// en Supabase exige --write explícito.
//
// --as-of=YYYY-MM-DD (opcional, añadido para medir el coste de un relleno
// histórico — docs/adr-rs-universo-us.md, tarea de medición de UNA semana):
// recorta las barras de cada símbolo a trade_date<=as-of ANTES de calcular
// los rendimientos, así que bars[0] deja de ser el cierre de hoy y pasa a
// ser el cierre más reciente disponible en o antes de esa fecha. No toca
// RETURN_WINDOWS_WEEKS/RETURN_WEIGHTS ni la fórmula de computeReturns: la
// única diferencia es QUÉ barras entran, no cómo se combinan. Sin --as-of,
// el comportamiento es exactamente el de antes (barras completas, fecha de
// hoy). Esto es solo el instrumento de medición: NO implementa el bucle de
// 26 semanas, eso es una tarea aparte.
//
// Reutiliza percentileFromSorted/clamp de lib/relativeStrength.js (no se
// toca ese archivo) y supabaseRequest/supabaseConfig/finiteOrNull/toDate de
// lib/supabaseServer.js — el mismo cliente que usa el resto del proyecto
// server-side.
//
// La fórmula de rs_raw (pesos 40/20/20/20 sobre rendimientos acumulados a
// 13/26/39/52 semanas) fue reconstruida por regresión sobre las filas
// existentes de rs_weekly_items en docs/adr-rs-universo-us.md — no hay
// código original que citar, así que esta es la primera implementación,
// no una migración de una implementación previa.
//
// Además de "barras insuficientes", cada símbolo se filtra por
// detectPriceDiscontinuities() (lib/indicators.js) — series con un salto
// de precio >=3x entre sesiones consecutivas (splits/contrasplits que el
// proveedor no ajusta, ver docs/splits-daily-bars-2026-08-09.md y
// docs/splits-eventos-2026-08-09.md) se EXCLUYEN, nunca se ajustan: no
// hay dato fiable para reconstruir la serie.

import { percentileFromSorted, clamp } from "@/lib/relativeStrength.js";
import { supabaseConfig, supabaseRequest, finiteOrNull, toDate } from "@/lib/supabaseServer.js";
import { detectPriceDiscontinuities } from "@/lib/indicators.js";

// ── Constantes de diseño, citadas y justificadas en el ADR ─────────────

// engine_version nuevo y distinto por población, para no mezclarse con los
// datos europeos de mayo (engine_version "statsedge-global-rs-usd-v1",
// ver docs/adr-rs-universo-us.md Parte A.2). El esquema de rs_weekly_items
// no tiene columna para distinguir acciones de ETFs (ADR A.4), así que la
// separación se hace por engine_version — compatible con el UNIQUE
// (owner_id, snapshot_date, engine_version, base_currency) de
// rs_weekly_snapshots sin tocar el DDL.
const ENGINE_VERSION_BY_POPULATION = {
  equity: "statsedge-us-equity-rs-v1",
  etf: "statsedge-us-etf-rs-v1",
};

// Ventanas en semanas y sus pesos, tal como se reconstruyeron por
// regresión en el ADR (Parte A.1): NOKIA.HE y STMPA.PA en el snapshot
// 2026-W22 cuadran exacto con 40/20/20/20 sobre 13w/26w/39w/52w.
const RETURN_WINDOWS_WEEKS = [13, 26, 39, 52];
const RETURN_WEIGHTS = [0.4, 0.2, 0.2, 0.2];
const TRADING_DAYS_PER_WEEK = 5;

// min_sample por defecto de rs_weekly_snapshots (supabase/schema.sql:1263).
const DEFAULT_MIN_SAMPLE = 20;

// Necesitamos bars[0] (precio actual) y bars[52*5] (precio hace 52
// semanas) — es decir, al menos 261 barras para poder calcular las 4
// ventanas. Si un símbolo tiene menos, se excluye del ranking (la tarea
// pide excluir, no descargar, en esta fase).
const MIN_BARS_REQUIRED = RETURN_WINDOWS_WEEKS.at(-1) * TRADING_DAYS_PER_WEEK + 1;

// Umbral de salto anómalo decidido en docs/splits-eventos-2026-08-09.md:
// un factor >=3 entre dos sesiones CONSECUTIVAS (no fechas de calendario
// consecutivas) marca la serie como discontinua. Se detecta y se excluye
// — no se ajusta, porque no hay dato fiable para reconstruir la serie
// (los eventos de split de Yahoo existen para 6/10 casos verificados pero
// ninguno coincide con el salto real, ver ese documento Parte B).
const DISCONTINUITY_FACTOR_THRESHOLD = 3;

// Criterio para identificar fondos cerrados clasificados como "equity" por
// instrumentTypeFor() (lib/universeEngine.js:66-79, NO modificado aquí).
// Esa función solo reconoce "fund" cuando el nombre trae una marca de ETF
// (ETF/ETFS/ETC/ETN/INDEX FUND/VANGUARD/BETASHARES/ISHARES/GLOBALX/VANECK)
// — un fondo cerrado como "Credit Suisse High Yield Credit Fund Common
// Stock" no matchea eso, matchea la regla de "equity" por la palabra
// COMMON. El ADR (Parte B.1) contó 260 símbolos así por patrón de nombre,
// con la advertencia explícita de que es una cota inferior aproximada (no
// captura CEFs/BDCs sin "FUND"/"BDC" en el nombre, ej. algunos que solo
// dicen "... Capital Corp"). Aquí replico ese mismo patrón, ampliado con
// BDC/closed-end para reducir falsos negativos frente al conteo original
// del ADR, sin pretender que sea exhaustivo — ver el reporte final.
const CLOSED_END_FUND_NAME_PATTERN = /\b(FUND|BDC|BUSINESS DEVELOPMENT (CORP(ORATION)?|COMPANY)|CLOSED[- ]END)\b/i;

// ── CLI args ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    population: "",
    dryRun: true,
    write: false,
    limit: 0,
    concurrency: 8,
    minSample: DEFAULT_MIN_SAMPLE,
    asOf: "",
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "population") out.population = String(rawValue || "").trim().toLowerCase();
    else if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "concurrency") out.concurrency = Math.max(1, Number(rawValue) || 8);
    else if (key === "min-sample") out.minSample = Math.max(1, Number(rawValue) || DEFAULT_MIN_SAMPLE);
    else if (key === "as-of") out.asOf = String(rawValue || "").trim();
  }
  // --write gana sobre el default dry-run=true, pero si además se pasa
  // --dry-run=true explícito junto a --write, dry-run manda (más seguro).
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

function usageAndExit(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error([
    "Uso:",
    "  node --env-file=.env.local --loader ./scripts/loader.mjs scripts/rs-universe.mjs \\",
    "    --population=equity|etf [--dry-run] [--write] [--limit=N] [--concurrency=8] [--min-sample=20] [--as-of=YYYY-MM-DD]",
    "",
    "Por defecto corre en --dry-run (no escribe). --write exige confirmarlo explícitamente.",
  ].join("\n"));
  process.exit(1);
}

// ── Utilidades de fecha (solo para metadatos del snapshot, no para el cálculo) ──

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

// ── Población: universo US más reciente, menos fondos cerrados mal clasificados ──

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
  // Paginación por keyset ascendente sobre id, igual que en la auditoría de
  // datos previa (docs/universo-us-rs-2026-08-08.md) — este script habla
  // directo con PostgREST vía service role, no pasa por la herramienta MCP
  // de solo lectura (esa tiene tope de 200 filas por diseño para MIS
  // consultas de esta sesión; el script es un cliente distinto), así que
  // uso páginas de 1000 para menos round-trips, pero mantengo keyset por
  // higiene frente a tablas grandes.
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

function buildPopulation(universeRows, populationType) {
  if (populationType === "equity") {
    const passedEquity = universeRows.filter((row) => row.passed === true && (row.instrument_type === "equity" || row.instrument_type === "listed-vehicle"));
    const closedEndFunds = passedEquity.filter((row) => CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
    const clean = passedEquity.filter((row) => !CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
    return { rows: clean, excludedAsClosedEndFund: closedEndFunds };
  }
  if (populationType === "etf") {
    // instrument_type='fund' es la única señal disponible hoy en el
    // universo (lib/universeEngine.js:69 — reconoce marcas de ETF/ETN por
    // nombre: ETF/ETFS/ETC/ETN/INDEX FUND/VANGUARD/BETASHARES/ISHARES/
    // GLOBALX/VANECK). Esto NO es una lista curada de ETFs de país/sector
    // — es un subconjunto pequeño e incompleto (15 símbolos en el
    // snapshot auditado en el ADR). Lo reporto como limitación conocida,
    // no lo disfrazo de población completa de ETFs.
    const rows = universeRows.filter((row) => row.instrument_type === "fund");
    return { rows, excludedAsClosedEndFund: [] };
  }
  throw new Error(`Población desconocida: ${populationType}`);
}

// ── Barras y rendimientos ───────────────────────────────────────────────

async function fetchBarsForSymbol(config, symbol, asOfDate = "") {
  // Con --as-of, la única diferencia es este filtro adicional: barras hasta
  // (e incluyendo) esa fecha, mismo orden desc, mismo límite. bars[0] pasa a
  // ser el cierre más reciente <= asOfDate en vez de el de hoy. Todo lo que
  // pasa después (computeReturns, ventanas, pesos) es idéntico.
  const query = [
    `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
    `symbol=eq.${encodeURIComponent(symbol)}`,
    asOfDate ? `trade_date=lte.${encodeURIComponent(asOfDate)}` : "",
    "select=trade_date,close,updated_at",
    "order=trade_date.desc",
    `limit=${MIN_BARS_REQUIRED + 50}`,
  ].filter(Boolean).join("&");
  const rows = await supabaseRequest("daily_bars", { query });
  if (!Array.isArray(rows)) return [];
  // daily_bars tiene unique(owner_id, symbol, trade_date, provider) — puede
  // haber más de una fila por fecha si hubo más de un proveedor. Nos
  // quedamos con una fila por trade_date (la primera vista, dado el orden
  // desc de la consulta) — no hay forma de saber cuál proveedor es
  // "mejor" sin más contexto, así que esto es una simplificación explícita,
  // no una regla de negocio verificada.
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.trade_date)) byDate.set(row.trade_date, row);
  }
  return Array.from(byDate.values())
    .map((row) => ({ date: row.trade_date, close: finiteOrNull(row.close) }))
    .filter((row) => row.date && Number.isFinite(row.close))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // desc, bars[0] = más reciente
}

function computeReturns(bars) {
  if (bars.length < MIN_BARS_REQUIRED) {
    return { ok: false, exclusionReason: "insufficient-bars", reason: `barras insuficientes (${bars.length}/${MIN_BARS_REQUIRED})` };
  }
  // La detección de discontinuidad va sobre TODAS las barras disponibles
  // (no solo la ventana de 52 semanas que usan los rendimientos) — un
  // salto fuera de esa ventana igual corrompe sma/drawdown/volatilidad en
  // otros consumidores (docs/splits-daily-bars-2026-08-09.md Parte C.9),
  // así que un símbolo con serie discontinua se excluye aunque el salto
  // caiga, por ejemplo, en la barra 300 y las ventanas de RS (hasta 260)
  // no lo toquen directamente.
  const discontinuity = detectPriceDiscontinuities(bars, DISCONTINUITY_FACTOR_THRESHOLD);
  if (discontinuity.discontinuous) {
    const { date, factor } = discontinuity.largestJump;
    return {
      ok: false,
      exclusionReason: "discontinuous-series",
      reason: `serie discontinua: salto de ${factor.toFixed(1)}x el ${date}`,
      discontinuity,
    };
  }
  const nowClose = bars[0].close;
  const returns = {};
  for (const weeks of RETURN_WINDOWS_WEEKS) {
    const offset = weeks * TRADING_DAYS_PER_WEEK;
    const pastClose = bars[offset]?.close;
    if (!Number.isFinite(pastClose) || pastClose === 0) {
      return { ok: false, reason: `sin cierre en offset de ${weeks} semanas (índice ${offset})` };
    }
    returns[`${weeks}w`] = ((nowClose / pastClose) - 1) * 100;
  }
  const raw = RETURN_WINDOWS_WEEKS.reduce((sum, weeks, i) => sum + returns[`${weeks}w`] * RETURN_WEIGHTS[i], 0);
  return { ok: true, returns, raw, closeDate: bars[0].date, close: nowClose, barsUsed: bars.length };
}

// ── Concurrencia simple ──────────────────────────────────────────────────

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

// ── Escritura (implementada, NO ejecutada en esta tarea salvo --write explícito) ──

async function upsertSnapshotAndItems(config, { engineVersion, snapshotDate, weekKey, minSample, included }) {
  const snapshotPayload = {
    owner_id: config.ownerId,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    engine_version: engineVersion,
    base_currency: "USD",
    lookback_weeks: RETURN_WINDOWS_WEEKS,
    weights: Object.fromEntries(RETURN_WINDOWS_WEEKS.map((w, i) => [`${w}w`, RETURN_WEIGHTS[i]])),
    min_sample: minSample,
    symbol_count: included.length,
    source: "scripts/rs-universe.mjs",
    stats: { closedEndFundsExcluded: undefined }, // se completa en main() antes de llamar
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

  const itemPayloads = included.map((row) => ({
    owner_id: config.ownerId,
    snapshot_id: snapshotId,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    engine_version: engineVersion,
    base_currency: "USD",
    rank_index: row.rankIndex,
    symbol: row.symbol,
    company_name: row.name || null,
    country: "US",
    sector: null,
    industry: null,
    theme: null,
    currency: "USD",
    normalized_currency: "USD",
    rs_rating: row.rsRating,
    rs_raw: row.raw,
    usd_close: row.close,
    local_close: row.close,
    fx_rate: 1,
    fx_date: row.closeDate,
    sample_size: included.length,
    metrics: { returns: row.returns, closeDate: row.closeDate },
  }));

  const batchSize = 500;
  for (let i = 0; i < itemPayloads.length; i += batchSize) {
    const batch = itemPayloads.slice(i, i + batchSize);
    await supabaseRequest("rs_weekly_items", {
      method: "POST",
      query: "on_conflict=snapshot_id,symbol",
      prefer: "resolution=merge-duplicates",
      body: batch,
    });
  }
  return snapshotId;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  if (!ENGINE_VERSION_BY_POPULATION[args.population]) {
    usageAndExit(`--population debe ser "equity" o "etf" (recibido: "${args.population || "(vacío)"}")`);
  }
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  // targetDate gobierna tres cosas: el recorte de barras (fetchBarsForSymbol),
  // y snapshot_date/week_key si se escribe. Sin --as-of es hoy, exactamente
  // el comportamiento previo a este parámetro.
  let targetDate = toDate(new Date().toISOString());
  if (args.asOf) {
    targetDate = toDate(args.asOf);
    if (!targetDate) usageAndExit(`--as-of no es una fecha válida: "${args.asOf}"`);
  }

  console.log(`=== rs-universe.mjs — población=${args.population} modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"}${args.asOf ? ` as-of=${targetDate}` : ""} ===`);

  const { snapshotId: universeSnapshotId, asOf } = await fetchLatestUsSnapshotId(config);
  console.log(`Instantánea de universo usada: ${universeSnapshotId} (creada ${asOf})`);

  const universeRows = await fetchUniverseRows(config, universeSnapshotId);
  console.log(`Filas market='US' en la instantánea: ${universeRows.length}`);

  const { rows: populationRows, excludedAsClosedEndFund } = buildPopulation(universeRows, args.population);
  const requestedPopulation = args.limit > 0 ? populationRows.slice(0, args.limit) : populationRows;
  console.log(`Población "${args.population}" tras filtro: ${populationRows.length}${args.limit > 0 ? ` (limitada a ${requestedPopulation.length} por --limit)` : ""}`);
  if (args.population === "equity") {
    console.log(`Excluidos por patrón de fondo cerrado (${CLOSED_END_FUND_NAME_PATTERN}): ${excludedAsClosedEndFund.length}`);
  }
  if (args.population === "etf") {
    console.log("AVISO: la población 'etf' usa instrument_type='fund' del universo, que solo reconoce ETFs/ETNs por marca de nombre (ver lib/universeEngine.js:69). No es una lista curada de ETFs de país/sector — es probable que esté muy incompleta.");
  }

  // La población (qué símbolos entran) sigue viniendo de la instantánea de
  // universo MÁS RECIENTE aunque se pida --as-of pasado: es la misma
  // simplificación que ya tenía el script sin este parámetro (no hay
  // instantánea histórica de universo que consultar). Se reporta como
  // limitación conocida, no se resuelve aquí — ver informe final.
  const computed = await mapLimit(requestedPopulation, args.concurrency, async (row) => {
    const bars = await fetchBarsForSymbol(config, row.symbol, args.asOf ? targetDate : "");
    const result = computeReturns(bars);
    return { ...row, ...result };
  });

  const included = computed.filter((row) => row.ok);
  const excludedForBars = computed.filter((row) => !row.ok && row.exclusionReason === "insufficient-bars");
  const excludedForDiscontinuity = computed.filter((row) => !row.ok && row.exclusionReason === "discontinuous-series");

  const sortedRaw = included.map((row) => row.raw).sort((a, b) => a - b);
  const ranked = included
    .slice()
    .sort((a, b) => b.raw - a.raw)
    .map((row, index) => ({
      ...row,
      rankIndex: index + 1,
      rsRating: percentileFromSorted(row.raw, sortedRaw, args.minSample),
    }));

  const elapsedMs = Date.now() - startedAt;

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Población solicitada: ${requestedPopulation.length}`);
  console.log(`Incluidos en el ranking (barras suficientes y serie continua): ${included.length}`);
  console.log(`Excluidos por barras insuficientes (<${MIN_BARS_REQUIRED}): ${excludedForBars.length}`);
  if (excludedForBars.length) {
    const sample = excludedForBars.slice(0, 15);
    for (const row of sample) console.log(`  - ${row.symbol}: ${row.reason}`);
    if (excludedForBars.length > sample.length) console.log(`  ... y ${excludedForBars.length - sample.length} más (omitidos del detalle, no del conteo)`);
  }
  console.log(`Excluidos por serie discontinua (salto de precio >=${DISCONTINUITY_FACTOR_THRESHOLD}x entre sesiones consecutivas): ${excludedForDiscontinuity.length}`);
  if (excludedForDiscontinuity.length) {
    const sample = excludedForDiscontinuity.slice(0, 10);
    for (const row of sample) console.log(`  - ${row.symbol}: ${row.reason}`);
    if (excludedForDiscontinuity.length > sample.length) console.log(`  ... y ${excludedForDiscontinuity.length - sample.length} más (omitidos del detalle, no del conteo)`);
  }
  console.log(`Tiempo total: ${(elapsedMs / 1000).toFixed(1)}s`);
  if (included.length < args.minSample) {
    console.log(`AVISO: muestra (${included.length}) por debajo de min-sample (${args.minSample}) — percentileFromSorted devolverá null para todas las filas.`);
  }

  console.log("");
  console.log(`Top 20 (de ${ranked.length}):`);
  for (const row of ranked.slice(0, 20)) {
    console.log(`  #${row.rankIndex} ${row.symbol.padEnd(8)} rs_rating=${String(row.rsRating).padStart(3)} raw=${row.raw.toFixed(2).padStart(8)} close=${row.close}`);
  }
  console.log("");
  console.log(`Fondo del ranking (5, para verificación de coherencia):`);
  for (const row of ranked.slice(-5)) {
    console.log(`  #${row.rankIndex} ${row.symbol.padEnd(8)} rs_rating=${String(row.rsRating).padStart(3)} raw=${row.raw.toFixed(2).padStart(8)} close=${row.close}`);
  }

  if (args.write && !args.dryRun) {
    const snapshotDate = targetDate;
    const weekKey = isoWeekKey(new Date(`${targetDate}T00:00:00Z`));
    const engineVersion = ENGINE_VERSION_BY_POPULATION[args.population];
    console.log("");
    console.log(`Escribiendo snapshot ${weekKey} (${snapshotDate}) engine_version=${engineVersion}${args.asOf ? " [as-of]" : ""} ...`);
    const snapshotId = await upsertSnapshotAndItems(config, {
      engineVersion,
      snapshotDate,
      weekKey,
      minSample: args.minSample,
      included: ranked,
    });
    console.log(`Escrito. rs_weekly_snapshots.id=${snapshotId}, ${ranked.length} filas en rs_weekly_items.`);
  } else {
    console.log("");
    console.log("Dry-run: no se escribió nada en Supabase. Pasa --write para persistir.");
  }
}

main().catch((error) => {
  console.error("Error fatal:", error?.message || error);
  process.exitCode = 1;
});
