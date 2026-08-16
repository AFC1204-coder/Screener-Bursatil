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
//     [--concurrency=4] [--stale-days=1] [--max-filas=200000]
//
// Por defecto corre en --dry-run (calcula y reporta qué refrescaría, no
// descarga ni escribe). Descargar y escribir en Supabase exige --write
// explícito.
//
// --write lleva la cuenta de las filas escritas y para ordenadamente al
// llegar a --max-filas (por defecto 200.000) — ver "TOPE DE FILAS
// ESCRITAS" más abajo.
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
//
// ── TOPE DE FILAS ESCRITAS (sustituye al guardián de carga masiva) ───────
// EL INCIDENTE, que no se borra de aquí porque es la razón de que exista
// cualquier freno: el 9 de agosto de 2026 la corrida de carga inicial
// (5.564/5.605 símbolos, ninguno con barra previa) escribió ~700.000
// filas y tumbó la instancia Supabase (Micro, 1 GB) durante cuatro horas.
//
// LO QUE HABÍA: un guardián (countMassLoadCandidates) que, antes de
// escribir nada, contaba cuántos símbolos estaban "caducados" y abortaba
// la corrida entera si pasaban de 1.000 (--max-carga-masiva, con escape
// --permitir-carga-masiva).
//
// POR QUÉ SE QUITA — dos motivos, y ambos se comprobaron en producción:
//   1. Medía lo que no debe. "Caducado" significa "le falta la última
//      sesión", y eso son TODOS los símbolos cada día laborable: el
//      refresco existe justamente para traer la sesión que falta. Abortó
//      la única ejecución real del workflow reportando 5.605 de 5.605.
//      Un umbral sobre esa cifra no distingue una carga inicial de una
//      noche normal, porque en ambas vale lo mismo.
//   2. Costaba ~4 minutos de precálculo por corrida (una consulta de la
//      fecha de la última barra por símbolo, N+1 sobre ~5.600), pagados
//      siempre, incluso para no escribir nada.
//
// QUÉ LO SUSTITUYE, y por qué esto sí: el commit d0a628b hizo que
// writeDailyBarsCache escriba solo el delta — las barras que faltan o que
// cambiaron, no la serie entera. Medido con AAPL: de 400 filas a 0 cuando
// está al día y a 1 cuando falta una sesión. Eso baja una noche normal de
// ~2,24 millones de filas a unas pocas miles, y hace segura la operación
// diaria sin ningún guardián previo. Lo único que queda por proteger es el
// caso excepcional (una carga inicial disfrazada de refresco), y el
// criterio correcto para eso no es "cuántos símbolos parecen caducados"
// sino "cuántas filas llevo escritas": se cuentan las filas realmente
// escritas durante la corrida y, al llegar a --max-filas
// (DEFAULT_MAX_ROWS, ver justificación del número en la constante), se
// deja de tomar símbolos nuevos, se espera a los que están en vuelo y se
// reporta qué quedó pendiente. El script hace trabajo útil hasta el tope
// y para ordenadamente, en vez de negarse a empezar.

import { pathToFileURL } from "node:url";

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

// Tope acumulado de filas escritas en una corrida --write (ver "TOPE DE FILAS
// ESCRITAS" en la cabecera). Valor: 200.000.
//
// Justificación del NÚMERO, no solo del mecanismo — se elige para caer con
// holgura entre las dos magnitudes reales que ya conocemos:
//   - Techo: las ~700.000 filas de la carga inicial del 9 de agosto, que
//     tumbaron la instancia Supabase (Micro, 1 GB) cuatro horas. 200.000 es
//     menos de un tercio de esa cifra, así que ni siquiera una corrida que
//     agote el tope entero reproduce el volumen del incidente.
//   - Suelo: un refresco diario normal post-delta (d0a628b) escribe del orden
//     de unos pocos miles de filas — ~5.600 símbolos × ~1 barra nueva, más los
//     huecos que se rellenen. 200.000 es ~30x ese caso, margen de sobra para
//     un fin de semana largo, un festivo, o una corrida saltada varios días,
//     sin que el tope se dispare por variación normal.
// Es decir: invisible en operación diaria, y activo justo en el escenario que
// hay que frenar (una carga inicial disfrazada de refresco). A 400 barras por
// símbolo nuevo, 200.000 filas dan para ~500 símbolos vírgenes por corrida:
// una carga inicial completa necesitaría ~12 corridas en vez de una sola que
// tumbe la instancia. Eso es el comportamiento buscado, no un efecto colateral.
const DEFAULT_MAX_ROWS = 200000;

// ── CLI args ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    concurrency: DEFAULT_CONCURRENCY,
    staleDays: DEFAULT_STALE_DAYS,
    maxRows: DEFAULT_MAX_ROWS,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "stale-days") out.staleDays = Math.max(0, Number(rawValue) ?? DEFAULT_STALE_DAYS);
    else if (key === "max-filas") out.maxRows = Math.max(0, Number(rawValue) || 0) || DEFAULT_MAX_ROWS;
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

// ETF de referencia de mercado (decisión 2026-08-16): los índices del producto
// son ETF (SPY/QQQ/IWM/DIA/ACWI, más VTI como mercado total) y necesitan
// histórico en daily_bars como cualquier otro valor. No vienen en
// universe_snapshot_symbols (no son equities del universo investable), así que
// se anclan aquí para que cada corrida los refresque con el resto.
const REFERENCE_ETF_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA", "VTI", "ACWI"];

function buildEquityPopulation(universeRows) {
  const passedEquity = universeRows.filter((row) => row.passed === true && (row.instrument_type === "equity" || row.instrument_type === "listed-vehicle"));
  const closedEndFunds = passedEquity.filter((row) => CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
  const clean = passedEquity.filter((row) => !CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
  const present = new Set(clean.map((row) => String(row.symbol || "").toUpperCase()));
  const referenceRows = REFERENCE_ETF_SYMBOLS
    .filter((symbol) => !present.has(symbol))
    .map((symbol) => ({ symbol, name: `Referencia de mercado (${symbol})`, instrument_type: "reference-etf", passed: true }));
  return { rows: [...referenceRows, ...clean], excludedAsClosedEndFund: closedEndFunds };
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
      // `count` = filas REALMENTE escritas (el delta, tras d0a628b);
      // `candidates` = filas evaluadas antes del delta. El tope se lleva con
      // `count`: es lo que pesa en la instancia, no lo que se miró.
      return { symbol, ok: true, skipped: false, barsWritten: cache.write.count || 0, barsEvaluated: cache.write.candidates || 0 };
    }
    // Ni hit ni write: el proveedor falló y no había caché previa que
    // devolver, o se sirvió una caché vieja de emergencia (stale-fallback)
    // sin escribir nada nuevo.
    return { symbol, ok: false, reason: `sin escritura nueva (status=${cache.status || "desconocido"}; posible fallo de proveedor)` };
  } catch (error) {
    return { symbol, ok: false, reason: error?.message || String(error) };
  }
}

// ── Bucle de escritura con tope acumulado de filas ───────────────────────
//
// Procesa `items` con `concurrency` trabajadores y va sumando las filas
// escritas. Cuando el acumulado alcanza `maxRows`, los trabajadores dejan de
// tomar símbolos NUEVOS; los que ya están en vuelo terminan su símbolo (no se
// cancelan a mitad, para no dejar una escritura parcial sin reportar) y el
// bucle devuelve qué quedó sin procesar.
//
// SOBRE LA CONCURRENCIA — confirmado, no asumido: varios trabajadores suman a
// `rowsWritten`, pero en JavaScript no puede haber condición de carrera sobre
// ese contador. El modelo es de un solo hilo con event loop: `rowsWritten +=
// n` y la comprobación `rowsWritten >= maxRows` son operaciones síncronas, y
// un trabajador solo cede el control en un `await` explícito. Entre la lectura
// y la escritura del contador nunca se intercala otro trabajador, así que no
// hay lectura-modificación-escritura rota ni check-then-act partido en dos.
// No hace falta mutex, atómicos ni SharedArrayBuffer (eso solo aplicaría con
// Worker threads reales, que aquí no hay).
//
// Lo que SÍ ocurre, y es distinto de una carrera: el tope se comprueba ENTRE
// símbolos, no dentro de uno. Cuando un trabajador cruza el umbral, hasta
// `concurrency - 1` trabajadores ya están escribiendo su propio símbolo y
// sumarán después. El exceso está acotado por (concurrency - 1) × writeCap
// (writeCap = 400, o 1.260 si el símbolo está referenciado — ver
// lib/dailyBarsCache.js), es decir unos pocos miles de filas en el peor caso.
// El tope es un freno, no un límite exacto, y no necesita serlo: el margen
// contra las ~700.000 del incidente absorbe ese exceso de sobra.
export async function runWriteLoop(items, { concurrency, maxRows, refresh }) {
  const results = [];
  let rowsWritten = 0;
  let processed = 0;
  let stoppedByCap = false;
  let cursor = 0;

  async function run() {
    for (;;) {
      // Check-then-act síncrono: nadie se intercala aquí (ver nota de arriba).
      if (rowsWritten >= maxRows) {
        stoppedByCap = true;
        return;
      }
      const index = cursor++;
      if (index >= items.length) return;
      const result = await refresh(items[index], index);
      results.push(result);
      processed += 1;
      rowsWritten += result?.barsWritten || 0;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));

  return {
    results,
    rowsWritten,
    processed,
    // Símbolos que nunca se tocaron. Ojo: `cursor` puede haber avanzado más
    // que `processed` solo si un trabajador tomó un índice y falló de forma no
    // atrapada — refreshOne atrapa todo, así que en la práctica coinciden.
    remaining: Math.max(0, items.length - processed),
    stoppedByCap,
  };
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
  console.log(`Procesando ${toProcess.length} símbolos vía withDailyBarsCache (decide fresh/stale al leer, concurrency=${args.concurrency}, tope=${args.maxRows} filas escritas)...`);
  const processStartedAt = Date.now();
  const { results, rowsWritten, processed, remaining, stoppedByCap } = await runWriteLoop(toProcess, {
    concurrency: args.concurrency,
    maxRows: args.maxRows,
    refresh: (row) => refreshOne(config, row.symbol, args),
  });
  const processElapsedMs = Date.now() - processStartedAt;

  const skipped = results.filter((r) => r.ok && r.skipped);
  const succeeded = results.filter((r) => r.ok && !r.skipped);
  const failed = results.filter((r) => !r.ok);

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Población: ${population.length}`);
  console.log(`Seleccionados para esta corrida: ${toProcess.length}`);
  console.log(`Procesados: ${processed}`);
  console.log(`Al día, saltados (sin descargar): ${skipped.length}`);
  console.log(`Refrescados con éxito: ${succeeded.length}`);
  console.log(`Fallidos: ${failed.length}`);
  console.log(`Filas escritas en daily_bars: ${rowsWritten} (tope: ${args.maxRows})`);
  if (failed.length) {
    for (const row of failed.slice(0, 30)) console.log(`  - ${row.symbol}: ${row.reason}`);
    if (failed.length > 30) console.log(`  ... y ${failed.length - 30} más (omitidos del detalle, no del conteo).`);
  }
  const elapsedMs = Date.now() - startedAt;
  const msPerSymbol = processed ? processElapsedMs / processed : 0;
  console.log(`Tiempo de procesamiento (lectura+descarga+escritura): ${(processElapsedMs / 1000).toFixed(1)}s (${msPerSymbol.toFixed(0)} ms/símbolo)`);
  console.log(`Tiempo total: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (stoppedByCap) {
    console.log("");
    console.log(`PARADA POR TOPE: se alcanzaron ${rowsWritten} filas escritas (tope ${args.maxRows}).`);
    console.log(`Quedaron ${remaining} símbolos sin procesar de los ${toProcess.length} seleccionados.`);
    console.log("Los símbolos en vuelo terminaron; no hay escrituras a medias sin reportar.");
    console.log("Este volumen no es el de un refresco diario normal (unas pocas miles de filas tras el delta de d0a628b):");
    console.log("apunta a una carga inicial, un universo recién repoblado o huecos de varios días. Si es intencional,");
    console.log("relanza — el orden de la instantánea es determinista, así que la siguiente corrida retoma el mismo");
    console.log("conjunto y avanza sobre lo que ya quedó escrito — o sube el tope con --max-filas=N a sabiendas.");
    // Código de salida 2, no 1: 1 ya significa "error fatal" (Supabase sin
    // configurar, excepción no atrapada). Parar por el tope NO es un error —
    // el trabajo hecho es válido y está persistido — pero tampoco es un
    // "terminé todo", y en GitHub Actions cualquier código != 0 marca el job
    // en rojo, que es exactamente la visibilidad que se quiere. Un código
    // propio permite distinguir los tres casos sin leer los logs:
    // 0 = corrida completa, 1 = falló, 2 = incompleta por el tope.
    process.exitCode = 2;
  }
}

// Solo se ejecuta cuando el archivo se invoca directamente por CLI. Si se
// importa (los tests importan runWriteLoop/parseArgs), main() no corre y no se
// toca Supabase.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Error fatal:", error?.message || error);
    process.exitCode = 1;
  });
}
