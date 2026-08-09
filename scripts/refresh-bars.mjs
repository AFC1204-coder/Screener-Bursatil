// scripts/refresh-bars.mjs — refresca las barras diarias (daily_bars) de
// todo el universo estadounidense investable, ejecutable a mano.
//
// Motivo (docs/barras-desfasadas-2026-08-09.md): el 96,7% de los símbolos
// tiene su última barra con más de 60 días de antigüedad. El cron
// (materializedScanner.js) solo procesa doce símbolos por noche y el
// escaneo interactivo (lib/serverScanRunner.js, desde f823d48) solo
// refresca lo que alguien escanea — ninguno de los dos barre el universo.
// El ranking de RS (scripts/rs-universe.mjs) calcula sus percentiles a
// partir de daily_bars, así que un universo congelado produce un ranking
// que no refleja el mercado actual.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/refresh-bars.mjs [--dry-run] [--write] [--limit=N] \
//     [--concurrency=4] [--stale-days=1]
//
// Por defecto corre en --dry-run (calcula y reporta qué refrescaría, no
// descarga ni escribe). Descargar y escribir en Supabase exige --write
// explícito.
//
// ── REDISEÑO (esta tarea) ───────────────────────────────────────────────
// La versión anterior calculaba la antigüedad de la última barra de TODA
// la población (~5.600 símbolos) en una fase separada, antes de aplicar
// --limit — una consulta por símbolo, siempre sobre el universo completo
// aunque --limit fuera pequeño. Medido: 115,9s incluso con --limit=50,
// porque --limit no acotaba esa fase.
//
// Dato que cambia el diseño: en producción, casi ningún símbolo del
// universo US ha tenido NUNCA una barra (no es un problema de caducidad,
// es de ausencia — los únicos con barras recientes son un puñado de
// símbolos europeos de los escaneos shadow, seis mega-caps y algunos
// visitados a mano). Con eso, precalcular la antigüedad exacta de los
// ~5.600 para poder ordenarlos ya no compra casi nada: la inmensa mayoría
// EMPATA en "nunca descargado" — no hay orden real que extraer sin pagar
// el costo completo.
//
// Opción (a) evaluada y descartada: una función SQL (RPC) que devuelva
// MAX(trade_date) agrupado por símbolo en una sola consulta evitaría el
// N+1, pero PostgREST no hace GROUP BY sin una función en la base, y la
// tarea prohíbe explícitamente crear funciones SQL nuevas en Supabase.
// Habría sido la opción más rápida, pero queda fuera de alcance — otra
// tarea, con el dueño decidiendo si quiere esa función.
//
// Opción (b), la implementada: eliminar la fase de precálculo sobre TODA
// la población. En su lugar:
//   - --write ya no hace una lectura previa propia: usa withDailyBarsCache
//     (lib/dailyBarsCache.js) directamente por símbolo, igual que el cron
//     (fetchChartForScan en materializedScanner.js) — esa función YA lee
//     la caché y decide fresh/stale (readDailyBarsCache + maxAgeDays)
//     antes de descargar; una comprobación previa nuestra sería trabajo
//     duplicado, tal como advierte la tarea.
//   - --dry-run SÍ mantiene una comprobación previa ligera (1 columna,
//     1 fila) por symbol, pero acotada a los símbolos que --limit vaya a
//     procesar — nunca a la población completa salvo que el usuario pida
//     explícitamente un dry-run sin límite. Es una aproximación (mira solo
//     la fecha de la última barra, no la cuenta de barras "suficientes"
//     que sí exige readDailyBarsCache) — suficiente para previsualizar,
//     no pretende ser el mismo cálculo exacto que hace --write.
//
// --stale-days SIGUE funcionando, pero cambia de mecanismo: en vez de
// filtrar una lista precalculada, se pasa como maxAgeDays a
// withDailyBarsCache (--write) o al mismo cálculo de antigüedad acotado
// (--dry-run) — mismo significado ("no toques lo que ya esté a menos de
// N días"), verificado símbolo a símbolo en el momento de procesarlo, no
// por adelantado para toda la población.
//
// Orden: YA NO se ordena por antigüedad exacta — precalcularla para poder
// ordenar es exactamente el costo que se elimina. Con el dato nuevo (casi
// todo el universo empata en "nunca descargado"), ese orden apenas
// aportaba priorización real de todos modos. Se usa en su lugar el orden
// determinista de la instantánea de universo (por id ascendente, el mismo
// que ya devuelve fetchUniverseRows) — reproducible entre corridas, así
// que dos ejecuciones con el mismo --limit tocan los mismos símbolos, y
// si la corrida se corta a mitad, un --limit mayor en la siguiente cubre
// el resto sin reprocesar todo desde cero.
//
// Población: la misma que usa scripts/rs-universe.mjs para su población
// "equity" — instantánea más reciente de universe_snapshot_symbols con
// market='US', passed=true, instrument_type en {equity, listed-vehicle},
// menos los fondos cerrados mal clasificados (mismo patrón de nombre,
// CLOSED_END_FUND_NAME_PATTERN). rs-universe.mjs no exporta sus funciones
// (fetchLatestUsSnapshotId/fetchUniverseRows/buildPopulation no llevan
// `export`), así que "reutilizar tal cual" aquí significa reproducir la
// MISMA consulta y el MISMO patrón de filtro, no importarlos — no se
// modifica rs-universe.mjs para exportarlos (fuera del alcance de esta
// tarea, igual que en la tarea anterior).
//
// Escritura: reutiliza withDailyBarsCache (lib/dailyBarsCache.js), el
// mismo mecanismo que usa el cron. No se escribe SQL propio ni se duplica
// lógica de caché/caducidad.
//
// Robustez: cada símbolo se procesa en su propio try/catch (mismo patrón
// que analyzeOne en lib/materializedScanner.js:1243-1266 — atrapa el
// fallo, lo registra como fila `ok:false`, y el resto de la corrida
// continúa). Un 429 o un fallo de proveedor en un símbolo no aborta nada.

import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer.js";
import { fetchYahooChart } from "@/lib/yahoo.js";
import { withDailyBarsCache } from "@/lib/dailyBarsCache.js";

// Mismo patrón de nombre que scripts/rs-universe.mjs:85 — ver el comentario
// de ese archivo para la justificación completa (cota inferior aproximada,
// no exhaustiva).
const CLOSED_END_FUND_NAME_PATTERN = /\b(FUND|BDC|BUSINESS DEVELOPMENT (CORP(ORATION)?|COMPANY)|CLOSED[- ]END)\b/i;

const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_STALE_DAYS = 1;

// ── CLI args ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    concurrency: DEFAULT_CONCURRENCY,
    staleDays: DEFAULT_STALE_DAYS,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "stale-days") out.staleDays = Math.max(0, Number(rawValue) ?? DEFAULT_STALE_DAYS);
  }
  // Mismo criterio que rs-universe.mjs: --write gana sobre el default
  // dry-run=true, pero --dry-run=true explícito manda sobre --write (más seguro).
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

// ── Población: mismo criterio "equity" que scripts/rs-universe.mjs ────────

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

function buildEquityPopulation(universeRows) {
  const passedEquity = universeRows.filter((row) => row.passed === true && (row.instrument_type === "equity" || row.instrument_type === "listed-vehicle"));
  const closedEndFunds = passedEquity.filter((row) => CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
  const clean = passedEquity.filter((row) => !CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
  return { rows: clean, excludedAsClosedEndFund: closedEndFunds };
}

// ── Concurrencia simple (mismo patrón que mapLimit en rs-universe.mjs) ────

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

// ── Dry-run: comprobación ligera de antigüedad, SOLO sobre los símbolos ───
// que --limit vaya a listar (o toda la población si no hay --limit, bajo
// pedido explícito del usuario). 1 columna, 1 fila — no la lectura
// completa de readDailyBarsCache (que trae hasta cacheLimitForRange*3
// filas por símbolo para poder verificar "barras suficientes").

function ageDaysFrom(dateStr) {
  if (!dateStr) return Infinity; // nunca descargado: el caso más urgente.
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) return Infinity;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

async function fetchLastBarDate(config, symbol) {
  try {
    const rows = await supabaseRequest("daily_bars", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `symbol=eq.${encodeURIComponent(symbol)}`,
        "select=trade_date",
        "order=trade_date.desc",
        "limit=1",
      ].join("&"),
    });
    return rows?.[0]?.trade_date || null;
  } catch {
    return null; // tratado como "nunca descargado".
  }
}

function ageBucket(ageDays) {
  if (ageDays < 1) return "<1d";
  if (ageDays <= 30) return "1-30d";
  if (ageDays <= 60) return "30-60d";
  return ">60d";
}

// ── Escritura: withDailyBarsCache decide fresh/stale al leer, no nosotros ─

async function refreshOne(config, symbol, args) {
  // Mismo patrón que analyzeOne (lib/materializedScanner.js:1243-1266): el
  // fallo de un símbolo se atrapa y se reporta, nunca se propaga.
  try {
    const result = await withDailyBarsCache(symbol, { range: "2A", interval: "D", maxAgeDays: args.staleDays }, fetchYahooChart);
    const cache = result?.meta?.cache || {};
    if (cache.hit === true) {
      // readDailyBarsCache encontró una barra a menos de --stale-days:
      // ni se descargó ni se escribió nada — es el "al día, se salta".
      return { symbol, ok: true, skipped: true };
    }
    if (cache.write) {
      if (cache.write.status === "error") {
        return { symbol, ok: false, reason: cache.write.error || "writeDailyBarsCache devolvió status:error" };
      }
      return { symbol, ok: true, skipped: false, barsWritten: cache.write.count || 0 };
    }
    // Ni hit ni write: el proveedor falló y no había caché previa que
    // devolver, o se sirvió una caché vieja de emergencia (stale-fallback)
    // sin escribir nada nuevo.
    return { symbol, ok: false, reason: `sin escritura nueva (status=${cache.status || "desconocido"}; posible fallo de proveedor)` };
  } catch (error) {
    return { symbol, ok: false, reason: error?.message || String(error) };
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  console.log(`=== refresh-bars.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} concurrency=${args.concurrency} stale-days=${args.staleDays}${args.limit > 0 ? ` limit=${args.limit}` : ""} ===`);

  const { snapshotId, asOf } = await fetchLatestUsSnapshotId(config);
  console.log(`Instantánea de universo usada: ${snapshotId} (creada ${asOf})`);

  const universeRows = await fetchUniverseRows(config, snapshotId);
  console.log(`Filas market='US' en la instantánea: ${universeRows.length}`);

  const { rows: population, excludedAsClosedEndFund } = buildEquityPopulation(universeRows);
  console.log(`Población equity investable (passed=true, equity|listed-vehicle, sin fondos cerrados): ${population.length}`);
  console.log(`Excluidos por patrón de fondo cerrado: ${excludedAsClosedEndFund.length}`);

  // Orden determinista de la instantánea (por id, ya viene así de
  // fetchUniverseRows) — NO por antigüedad, ver cabecera del archivo.
  const toProcess = args.limit > 0 ? population.slice(0, args.limit) : population;
  console.log("");
  console.log(`Símbolos a evaluar en esta corrida: ${toProcess.length}${args.limit > 0 ? ` (de ${population.length}, por --limit)` : ""}`);

  if (!toProcess.length) {
    console.log("Nada que hacer: población vacía.");
    return;
  }

  if (args.dryRun) {
    console.log("");
    console.log(`Comprobando antigüedad de la última barra (lectura ligera, 1 fila por símbolo, concurrency=${args.concurrency})...`);
    const withAge = await mapLimit(toProcess, args.concurrency, async (row) => {
      const lastBarDate = await fetchLastBarDate(config, row.symbol);
      return { ...row, lastBarDate, ageDays: ageDaysFrom(lastBarDate) };
    });

    const buckets = { "<1d": 0, "1-30d": 0, "30-60d": 0, ">60d": 0 };
    for (const row of withAge) buckets[ageBucket(row.ageDays)] += 1;
    console.log("");
    console.log(`=== Reparto de antigüedades (${withAge.length} símbolos evaluados) ===`);
    console.log(`  <1 día:    ${buckets["<1d"]}`);
    console.log(`  1-30 días: ${buckets["1-30d"]}`);
    console.log(`  30-60 días:${buckets["30-60d"]}`);
    console.log(`  >60 días:  ${buckets[">60d"]}`);

    const upToDate = withAge.filter((row) => row.ageDays < args.staleDays);
    const candidates = withAge.filter((row) => row.ageDays >= args.staleDays);
    console.log("");
    console.log(`Al día (antigüedad < ${args.staleDays} día(s)), se saltarían: ${upToDate.length}`);
    console.log(`Se refrescarían (antigüedad >= ${args.staleDays} día(s)): ${candidates.length}`);
    console.log("");
    console.log(`Dry-run: lista de hasta 50 símbolos que se refrescarían (de ${candidates.length}), sin descargar ni escribir:`);
    for (const row of candidates.slice(0, 50)) {
      const ageLabel = row.ageDays === Infinity ? "nunca descargado" : `${row.ageDays}d`;
      console.log(`  - ${row.symbol.padEnd(10)} última barra: ${row.lastBarDate || "(ninguna)"} (${ageLabel})`);
    }
    if (candidates.length > 50) console.log(`  ... y ${candidates.length - 50} más (omitidos del detalle, no del conteo).`);
    console.log("");
    console.log("Dry-run: no se descargó ni se escribió nada en Supabase. Pasa --write para persistir.");
    console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return;
  }

  console.log("");
  console.log(`Procesando ${toProcess.length} símbolos vía withDailyBarsCache (decide fresh/stale al leer, concurrency=${args.concurrency})...`);
  const processStartedAt = Date.now();
  const results = await mapLimit(toProcess, args.concurrency, (row) => refreshOne(config, row.symbol, args));
  const processElapsedMs = Date.now() - processStartedAt;

  const skipped = results.filter((r) => r.ok && r.skipped);
  const succeeded = results.filter((r) => r.ok && !r.skipped);
  const failed = results.filter((r) => !r.ok);

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Población: ${population.length}`);
  console.log(`Evaluados en esta corrida: ${toProcess.length}`);
  console.log(`Al día, saltados (sin descargar): ${skipped.length}`);
  console.log(`Refrescados con éxito: ${succeeded.length}`);
  console.log(`Fallidos: ${failed.length}`);
  if (failed.length) {
    for (const row of failed.slice(0, 30)) console.log(`  - ${row.symbol}: ${row.reason}`);
    if (failed.length > 30) console.log(`  ... y ${failed.length - 30} más (omitidos del detalle, no del conteo).`);
  }
  const elapsedMs = Date.now() - startedAt;
  const msPerSymbol = toProcess.length ? processElapsedMs / toProcess.length : 0;
  console.log(`Tiempo de procesamiento (lectura+descarga+escritura): ${(processElapsedMs / 1000).toFixed(1)}s (${msPerSymbol.toFixed(0)} ms/símbolo)`);
  console.log(`Tiempo total: ${(elapsedMs / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error("Error fatal:", error?.message || error);
  process.exitCode = 1;
});
