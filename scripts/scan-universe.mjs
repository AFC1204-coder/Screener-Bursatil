// scripts/scan-universe.mjs — analiza el universo estadounidense completo y
// escribe UN escaneo (scans + scan_results), ejecutable a mano.
//
// ADR: docs/adr-escaneo-nocturno.md — el escaneo del universo se hace UNA VEZ
// POR NOCHE, fuera de Vercel. El usuario no lanza escaneos: aplica filtros
// guardados sobre los datos de la corrida de esta noche. Este script es
// FASE 1 de ese ADR: solo el script a mano. NO monta workflow, NO toca el
// escaneo interactivo (lib/serverScanRunner.js) ni el cron de Vercel
// (SCAN_CRON_GROUPS) — ambos siguen intactos y siguen siendo lo que ve hoy
// el usuario.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/scan-universe.mjs [--dry-run] [--write] [--limit=N] \
//     [--concurrency=4] [--preset=balanced]
//
// Por defecto corre en --dry-run (lista qué símbolos analizaría, no descarga
// ni escribe nada). Escribir en Supabase exige --write explícito.
//
// ── POBLACIÓN: reutiliza la selección de refresh-bars, no la duplica en
// espíritu, sí en código ──────────────────────────────────────────────────
// scripts/refresh-bars.mjs ya resolvió qué población usar (~5.605 símbolos
// US investables) y de dónde sacarla (universe_snapshot_symbols, la misma
// instantánea que usa scripts/rs-universe.mjs). Sus funciones de población
// (fetchLatestUsSnapshotId/fetchUniverseRows/buildEquityPopulation) NO
// llevan `export` — el propio refresh-bars.mjs explica por qué (su cabecera,
// líneas 82-91): rs-universe.mjs tampoco las exporta, y modificar un script
// existente para exportar funciones solo para que otro las importe queda
// fuera del alcance de esa tarea. Se aplica el MISMO criterio aquí, con el
// mismo motivo: "NO modifiques ningún archivo existente salvo que sea
// imprescindible" (restricción de esta tarea) y no lo es — reproducir la
// misma consulta y el mismo patrón de filtro (línea por línea, no solo el
// criterio) es la vía que el propio repo ya eligió dos veces.
//
// ── BLOQUEO ENCONTRADO (Parte A, punto 2) — confirmado citando código, no
// asumido del inventario ──────────────────────────────────────────────────
// El inventario (docs/inventario-obsoleto-2026-08-11.md) afirma que
// runMaterializedScan "se puede invocar directamente desde un script". Es
// cierto, pero NO con el patrón simple de refresh-bars.mjs (`node --loader
// ./scripts/loader.mjs`): ese loader solo resuelve extensiones .js/.json/
// .mjs vía node:fs y no transforma JSX. Import estático confirmado con un
// trace del grafo de imports:
//   lib/materializedScanner.js -> lib/leaderboards.js -> lib/screenerFilters.js
//   -> lib/listRationale.js -> lib/stockRows.js -> lib/methodologyEngine.js
//   -> lib/screenerFormat.js -> app/components/ui/MetricSource.jsx
// scripts/bench-analyze.mjs (líneas 27-49) ya documentó y resolvió este
// mismo bloqueo para benchmarking: arranca la API programática de Vitest
// (`vitest/node`), que sí trae el transform de JSX (vía Vite) que ya usa
// `npm test`. Este script sigue ese mismo precedente para el modo --write
// (que sí importa runMaterializedScan/writeMaterializedScan/
// screenerFiltersFromParams). El modo --dry-run NO lo necesita: solo lee
// universe_snapshot_symbols vía lib/supabaseServer.js, que no toca esa
// cadena de imports — corre con el loader plano, igual que refresh-bars.mjs.
//
// ── PRESET: "balanced", el mismo que el escaneo interactivo por defecto ──
// app/page.jsx inicializa su estado con settingsForPreset("balanced")
// (línea 168). PERO el cron actual (app/api/jobs/scan-refresh/route.js,
// app/api/cron/scan-refresh/route.js) NO aplica ese preset por defecto: si
// no llegan query params de filtro, screenerFiltersFromParams({}) devuelve
// `enabled:false`, y applyScreenerFilters con `enabled:false` es un
// pass-through literal (lib/screenerFilters.js:775) — el cron de hoy guarda
// a todo el que pase baseRejectReason (precio/turnover/market cap/cobertura/
// frescura), sin aplicar los umbrales de tendencia/momentum/cercanía de
// "balanced". Este script SÍ pasa `screenerFiltersFromParams({ filterPreset:
// args.preset })` explícitamente, para cumplir el punto 7 de la tarea al
// pie de la letra.
//
// ── QUÉ SE GUARDA: toda la población, no solo la que pasa ─────────────────
// FASE 1 de docs/adr-universo-precalculado.md. Hasta el 14 de agosto de 2026
// este script guardaba SOLO las filas que pasaban el preset — 62 de 5.608
// analizadas esa noche, un 98,9% del trabajo a la basura. Sin población no
// hay sobre qué filtrar: cualquier criterio distinto del preset obligaba a
// reescanear los ~5.600 desde el navegador, que es lo que muere por timeout.
//
// Ahora se guarda todo lo que llega al filtro:
//   - las que pasan el preset, con la fila COMPLETA (scanResultPayload), sin
//     un solo cambio respecto a antes — la ficha del valor y la auditoría la
//     necesitan entera;
//   - las que no pasan, con la fila LIGERA (lib/scanLightProjection.js):
//     7.233 B frente a 46.481 B medidos, un 84% menos.
// Todas llevan `metrics.screenPassed` para que una consulta pueda
// distinguirlas sin inferirlo de la forma de la fila.
//
// Ninguna señal cambia de valor: las ligeras salen del MISMO array
// `sectorized` que ya alimentaba el filtro, así que los percentiles
// (rsGlobalPct, sectorScore) se calculan sobre exactamente la misma
// población que antes.
//
// ── RETENCIÓN: los 7 nocturnos más recientes ──────────────────────────────
// Decisión ya tomada (docs/orden-y-sector-2026-08-11.md no la cubre; viene
// del prompt de esta tarea): conservar los SIETE escaneos NOCTURNOS más
// recientes, con todos sus símbolos analizados. Los anteriores se borran.
//
// Existe una RPC de retención en el esquema (upsert_scan_newer_wins,
// supabase/schema.sql:230-272) pero NO sirve tal cual: purga TOP-3 POR
// OWNER, mezclando cualquier tipo de escaneo (interactivo, cron, nocturno)
// bajo el mismo owner_id — no distingue nocturno de interactivo, y el
// número (3) tampoco es el que queremos (7). Usarla aquí borraría escaneos
// interactivos/cron que la tarea prohíbe tocar. Además NINGUNO de los tres
// escritores reales (escaneo interactivo vía servidor, cron de Vercel, este
// script) pasa por esa RPC hoy — todos escriben directo a `scans`/
// `scan_results`. Por eso la retención de este script es lógica JS propia
// (pruneNightlyScans, abajo), no una llamada a esa RPC.
//
// Cómo se distingue un escaneo nocturno: local_id empieza por
// "materialized:US:" (mercado exacto ["US"], sin combinar con otros — el
// cron de Vercel, vía SCAN_CRON_GROUPS en lib/cronPlan.js, JAMÁS agrupa "US"
// solo: el único grupo que lo incluye es "US-HK-AU"). Confirmado con datos
// reales: de 92 escaneos existentes en producción (todo el historial de
// `scans`, consultado 2026-08-11), solo 2 local_id empiezan por
// "materialized:US:" — ambos de hoy, ninguno de ningún otro origen.
// CAVEAT real, no solo teórico: app/api/jobs/scan-refresh/route.js (un
// CUARTO escritor, endpoint admin/on-demand, no mencionado en el prompt de
// esta tarea) llama a la MISMA runMaterializedScan y, si alguien lo invoca
// manualmente con `?markets=US`, produciría un local_id con el mismo
// prefijo. No se puede descartar por completo con un simple prefijo de
// texto — se documenta aquí, no se resuelve (añadir una segunda señal, p.ej.
// un mínimo de symbols/row_count, sería sobre-ingeniería para un caso que
// hoy no ocurre en producción y que la tarea no pidió cubrir).
//
// Seguridad (punto 9 de la tarea): la retención corre DESPUÉS de confirmar
// que writeMaterializedScan devolvió saved:true, envuelta en try/catch — si
// el borrado falla, el escaneo recién escrito queda intacto (el error solo
// se reporta, nunca se relanza).
//
// ── maxSavedRows: sin el tope de 500 del cron actual ──────────────────────
// El cron interactivo cae a maxSavedRows=500 por defecto porque solo
// materializa una porción rotativa del universo cada noche. Este script
// analiza el universo COMPLETO en una sola corrida, así que truncar a 500
// perdería resultados reales del preset. Se pasa maxSavedRows =
// toProcess.length (con mínimo 1) para no truncar nada que sí pase el
// preset.

import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer.js";

const __filename = fileURLToPath(import.meta.url);

// Mismo patrón de nombre que scripts/refresh-bars.mjs:148 / scripts/rs-universe.mjs:85.
const CLOSED_END_FUND_NAME_PATTERN = /\b(FUND|BDC|BUSINESS DEVELOPMENT (CORP(ORATION)?|COMPANY)|CLOSED[- ]END)\b/i;

const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PRESET = "balanced";
// Prefijo de local_id que identifica un escaneo nocturno de este script — ver
// "RETENCIÓN" en la cabecera para el porqué y el caveat conocido.
const NIGHTLY_LOCAL_ID_PREFIX = "materialized:US:";
// Política ya decidida: conservar los 7 escaneos nocturnos más recientes.
const DEFAULT_RETENTION_COUNT = 7;
// Cortesía con la instancia Supabase Micro (ver AVISO en el prompt de la
// tarea: se ha saturado dos veces esta semana): timeout generoso para que
// una corrida --write lenta no aborte a medias con datos parciales.
const VITEST_TEST_TIMEOUT_MS = 900000;

// ── CLI args ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    concurrency: DEFAULT_CONCURRENCY,
    preset: DEFAULT_PRESET,
    skipRetention: false,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "preset") out.preset = String(rawValue || DEFAULT_PRESET).trim() || DEFAULT_PRESET;
    // --sin-retencion: salta la retención (punto 12 de la tarea). Pensada para
    // pruebas — deja intactos los escaneos nocturnos viejos aunque haya más de 7.
    else if (key === "sin-retencion") out.skipRetention = rawValue === undefined ? true : rawValue !== "false";
  }
  // Mismo criterio que refresh-bars.mjs: --write gana sobre el default
  // dry-run=true, pero --dry-run=true explícito manda sobre --write (más seguro).
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

// ── Retención: conservar los N nocturnos más recientes ────────────────────
// Lógica JS propia, no la RPC upsert_scan_newer_wins — ver "RETENCIÓN" en la
// cabecera del archivo para el porqué.
//
// Solo lee/borra de `scans`. NO hace falta borrar `scan_results` aparte: la
// FK scan_results.scan_id references scans(id) ON DELETE CASCADE (mismo
// mecanismo que ya usa la purga de upsert_scan_newer_wins, supabase/schema.sql
// líneas 27 y 216-219) limpia las filas hijas automáticamente. `row_count` en
// `scans` ya lleva la cuenta de filas de cada escaneo (se fija en la escritura,
// writeMaterializedScan), así que sumar esa columna evita tener que consultar
// `scan_results` para saber cuántas filas se borraron — importante dado el
// AVISO de la tarea sobre timeouts en scan_results sin filtro acotado.
//
// dryRun:true nunca llama DELETE — reporta `candidates` (lo que se borraría)
// y dejan deletedScanCount/deletedRowCount en 0, para separar claramente
// "esto es lo que pasaría" de "esto pasó".
export async function pruneNightlyScans(config, options = {}) {
  const retentionCount = Number.isFinite(options.retentionCount) && options.retentionCount > 0
    ? Math.floor(options.retentionCount)
    : DEFAULT_RETENTION_COUNT;
  const dryRun = Boolean(options.dryRun);
  if (options.skip) {
    return { skipped: true, dryRun, retentionCount, kept: [], candidates: [], deletedScanCount: 0, deletedRowCount: 0 };
  }
  const rows = await supabaseRequest("scans", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `local_id=like.${encodeURIComponent(`${NIGHTLY_LOCAL_ID_PREFIX}*`)}`,
      "deleted_at=is.null",
      "select=id,local_id,row_count,created_at",
      "order=created_at.desc",
    ].join("&"),
  });
  const nightly = Array.isArray(rows) ? rows : [];
  const kept = nightly.slice(0, retentionCount);
  const overflow = nightly.slice(retentionCount);
  const candidates = overflow.map((row) => ({
    id: row.id,
    localId: row.local_id,
    rowCount: Number(row.row_count || 0),
    createdAt: row.created_at,
  }));
  if (!candidates.length) {
    return { skipped: false, dryRun, retentionCount, kept: kept.map((row) => row.id), candidates: [], deletedScanCount: 0, deletedRowCount: 0 };
  }
  if (dryRun) {
    return { skipped: false, dryRun, retentionCount, kept: kept.map((row) => row.id), candidates, deletedScanCount: 0, deletedRowCount: 0 };
  }
  const ids = overflow.map((row) => row.id);
  await supabaseRequest("scans", {
    method: "DELETE",
    query: `id=in.(${ids.map(encodeURIComponent).join(",")})`,
  });
  const deletedRowCount = candidates.reduce((sum, row) => sum + row.rowCount, 0);
  return { skipped: false, dryRun, retentionCount, kept: kept.map((row) => row.id), candidates, deletedScanCount: candidates.length, deletedRowCount };
}

// ── Población: mismo criterio "equity" que scripts/refresh-bars.mjs ───────
// (reproducido, no importado — ver cabecera).

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

// ── Modo --write: bootstrap de Vitest (ver "BLOQUEO ENCONTRADO" arriba) ───
// Mismo mecanismo que scripts/bench-analyze.mjs: este mismo archivo se
// re-ejecuta una segunda vez como "test file" bajo la API programática de
// Vitest (que sí transforma JSX), detectado por SCAN_UNIVERSE_MODE. La
// primera pasada (bootstrap, este proceso) le pasa los parámetros por
// variables de entorno y lee el resultado de un JSON temporal fuera del
// repo. No se reimplementa ninguna lógica de escaneo ni de escritura.

async function runAsVitestChild() {
  const { test } = await import("vitest");
  test("scan-universe-write", async () => {
    const { runMaterializedScan, writeMaterializedScan } = await import("@/lib/materializedScanner.js");
    const { screenerFiltersFromParams } = await import("@/lib/screenerFilters.js");

    const symbols = String(process.env.SCAN_UNIVERSE_SYMBOLS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const concurrency = Number(process.env.SCAN_UNIVERSE_CONCURRENCY || DEFAULT_CONCURRENCY);
    const preset = process.env.SCAN_UNIVERSE_PRESET || DEFAULT_PRESET;
    const screenerFilters = screenerFiltersFromParams({ filterPreset: preset });

    const startedAt = Date.now();
    const result = await runMaterializedScan({
      symbols,
      concurrency,
      markets: ["US"],
      cache: true,
      maxSavedRows: Math.max(symbols.length, 1),
      maxPriceFreshnessDays: 5,
      maxFundamentalsAgeDays: 14,
      minBars: 180,
      minPrice: 1,
      minAvgTurnover: 250000,
      minMarketCap: 300000000,
      minCoverageScore: 40,
      screenerFilters,
    });
    const scanElapsedMs = Date.now() - startedAt;

    const savedScan = await writeMaterializedScan(result.scan);
    const totalElapsedMs = Date.now() - startedAt;

    fs.writeFileSync(
      process.env.SCAN_UNIVERSE_RESULT_FILE,
      JSON.stringify({
        scanElapsedMs,
        totalElapsedMs,
        scan: {
          id: result.scan.id,
          name: result.scan.name,
          rowCount: result.scan.rows.length,
          lightRowCount: result.scan.lightRows?.length || 0,
          population: result.scan.settings?.population || null,
        },
        stats: result.stats,
        savedScan,
        screenerFilters: { preset: screenerFilters.preset, enabled: screenerFilters.enabled, activeCount: screenerFilters.active.length },
      }),
    );
  }, VITEST_TEST_TIMEOUT_MS);
}

async function runWriteViaVitestChild({ symbols, concurrency, preset }) {
  const resultFile = path.join(os.tmpdir(), `scan-universe-write-result-${process.pid}.json`);
  process.env.SCAN_UNIVERSE_MODE = "vitest-child";
  process.env.SCAN_UNIVERSE_SYMBOLS = symbols.join(",");
  process.env.SCAN_UNIVERSE_CONCURRENCY = String(concurrency);
  process.env.SCAN_UNIVERSE_PRESET = preset;
  process.env.SCAN_UNIVERSE_RESULT_FILE = resultFile;

  const { startVitest } = await import("vitest/node");
  const vitest = await startVitest("test", [], {
    run: true,
    include: [pathToFileURL(__filename).href.replace("file://", "")],
    root: path.resolve(path.dirname(__filename), ".."),
    testTimeout: VITEST_TEST_TIMEOUT_MS,
    watch: false,
  });
  await vitest?.close();

  if (!fs.existsSync(resultFile)) {
    throw new Error("La corrida bajo Vitest no produjo el archivo de resultados (revisa el output de Vitest arriba por errores).");
  }
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  fs.unlinkSync(resultFile);
  return payload;
}

// Seam de test para el punto 9 (seguridad): la retención solo debe correr si
// writeMaterializedScan confirmó la escritura. Extraído a función propia
// (en vez de inline en main(), que no es invocable en tests sin arrancar el
// bootstrap de Vitest completo) para poder testear la condición de guarda
// sola, sin red ni Supabase.
export function shouldPruneAfterWrite(savedScan) {
  return Boolean(savedScan?.saved);
}

// El muro de la escritura no es el número de filas: es el statement_timeout
// de 8s del rol `authenticator` de Supabase. Lo que decide si una tanda cabe
// es cuántos MB de JSON viajan en la petición. El escaneo del universo ya
// murió una vez por esto (commit eb74eff), y el modo de fallo es un timeout a
// medias, no un error limpio — por eso se mide cada tanda en vez de suponerlo.
const STATEMENT_TIMEOUT_MS = 8000;

function logWriteBatches(batches) {
  if (!Array.isArray(batches) || !batches.length) return;
  const worst = batches.reduce((max, b) => (b.ms > max.ms ? b : max), batches[0]);
  const totalMs = batches.reduce((sum, b) => sum + b.ms, 0);
  console.log("");
  console.log(`Escritura: ${batches.length} tandas, ${(totalMs / 1000).toFixed(1)}s en total.`);
  for (const b of batches) {
    const mb = (b.bytes / 1048576).toFixed(2);
    const pct = ((b.ms / STATEMENT_TIMEOUT_MS) * 100).toFixed(0);
    console.log(`  - ${b.kind.padEnd(5)} ${String(b.rows).padStart(4)} filas · ${mb.padStart(6)} MB · ${String(b.ms).padStart(5)} ms · ${pct}% del presupuesto de ${STATEMENT_TIMEOUT_MS} ms`);
  }
  const worstPct = (worst.ms / STATEMENT_TIMEOUT_MS) * 100;
  console.log(`  Peor tanda: ${worst.ms} ms (${worstPct.toFixed(0)}% del statement_timeout de ${STATEMENT_TIMEOUT_MS} ms) — ${worstPct >= 100 ? "SE PASA" : worstPct >= 60 ? "ajustado, revisar" : "cabe con margen"}.`);
}

// Reporta el resultado de pruneNightlyScans, en dry-run (candidatos, nada
// borrado) o en real (candidatos == lo que se borró).
function logRetentionReport(retention) {
  if (retention.skipped) {
    console.log("Retención saltada (--sin-retencion).");
    return;
  }
  console.log(`Escaneos nocturnos conservados (de los ${retention.retentionCount} más recientes): ${retention.kept.length}`);
  if (!retention.candidates.length) {
    console.log(retention.dryRun ? "No hay escaneos nocturnos de sobra: nada que borraría." : "No había escaneos nocturnos de sobra: no se borró nada.");
    return;
  }
  console.log(`${retention.dryRun ? "Se borrarían" : "Se borraron"} ${retention.candidates.length} escaneos nocturnos, ${retention.dryRun ? "sumando" : "sumaron"} ${retention.candidates.reduce((sum, c) => sum + c.rowCount, 0)} filas de scan_results (vía cascade desde 'scans'):`);
  for (const candidate of retention.candidates) {
    console.log(`  - ${candidate.localId} (${candidate.rowCount} filas, creado ${candidate.createdAt})`);
  }
}

// ── Main (bootstrap) ───────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  console.log(`=== scan-universe.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} concurrency=${args.concurrency} preset=${args.preset}${args.limit > 0 ? ` limit=${args.limit}` : ""}${args.skipRetention ? " sin-retencion" : ""} ===`);
  console.log(`Retención: conserva los ${DEFAULT_RETENTION_COUNT} escaneos nocturnos (local_id "${NIGHTLY_LOCAL_ID_PREFIX}*") más recientes${args.skipRetention ? " — SALTADA por --sin-retencion" : ""}.`);
  console.log("");

  const { snapshotId, asOf } = await fetchLatestUsSnapshotId(config);
  console.log(`Instantánea de universo usada: ${snapshotId} (creada ${asOf})`);

  const universeRows = await fetchUniverseRows(config, snapshotId);
  console.log(`Filas market='US' en la instantánea: ${universeRows.length}`);

  const { rows: population, excludedAsClosedEndFund } = buildEquityPopulation(universeRows);
  console.log(`Población equity investable (passed=true, equity|listed-vehicle, sin fondos cerrados): ${population.length}`);
  console.log(`Excluidos por patrón de fondo cerrado: ${excludedAsClosedEndFund.length}`);

  const toProcess = args.limit > 0 ? population.slice(0, args.limit) : population;
  console.log("");
  console.log(`Símbolos a analizar en esta corrida: ${toProcess.length}${args.limit > 0 ? ` (de ${population.length}, por --limit)` : ""}`);

  if (!toProcess.length) {
    console.log("Nada que hacer: población vacía.");
    return;
  }

  if (args.dryRun) {
    console.log("");
    console.log(`Dry-run: lista de hasta 50 símbolos que se analizarían (de ${toProcess.length}), sin descargar ni escribir:`);
    for (const row of toProcess.slice(0, 50)) console.log(`  - ${row.symbol.padEnd(10)} ${row.name || ""}`);
    if (toProcess.length > 50) console.log(`  ... y ${toProcess.length - 50} más (omitidos del detalle, no del conteo).`);
    console.log("");
    console.log(`Preset a aplicar en una corrida real: ${args.preset}`);
    console.log("");
    console.log("Filas que escribiría una corrida real con estos parámetros:");
    console.log(`  Techo: ${toProcess.length} filas, una por símbolo analizado.`);
    console.log("  Las que pasen el preset se guardan COMPLETAS; el resto, LIGERAS");
    console.log("  (proyección de lib/scanLightProjection.js, 7,2 KB frente a 46,5 KB).");
    console.log("  El reparto exacto no es predecible sin descargar los datos: depende");
    console.log("  de cuántos símbolos superen el cribado base (histórico, precio,");
    console.log("  turnover, capitalización, cobertura) y de cuántos de esos pasen el");
    console.log("  preset. Ambos números se reportan en la corrida real y quedan");
    console.log("  persistidos en scans.settings.population.");
    console.log("Dry-run: no se descargó ni se escribió nada en Supabase. Pasa --write para persistir.");

    console.log("");
    console.log("=== RETENCIÓN (vista previa, no borra nada) ===");
    const retentionPreview = await pruneNightlyScans(config, { dryRun: true, skip: args.skipRetention, retentionCount: DEFAULT_RETENTION_COUNT });
    logRetentionReport(retentionPreview);

    console.log("");
    console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return;
  }

  console.log("");
  console.log(`Procesando ${toProcess.length} símbolos vía runMaterializedScan (concurrency=${args.concurrency}, preset=${args.preset})...`);
  console.log("(arranca la API programática de Vitest para poder importar la cadena de imports que llega a JSX — ver cabecera del script)");

  const payload = await runWriteViaVitestChild({
    symbols: toProcess.map((row) => row.symbol),
    concurrency: args.concurrency,
    preset: args.preset,
  });

  const { stats, scan, savedScan, scanElapsedMs, totalElapsedMs, screenerFilters } = payload;

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Población total (universo US investable): ${population.length}`);
  console.log(`Seleccionados para esta corrida: ${stats.selected}`);
  console.log(`Analizados (con o sin éxito): ${stats.selected}`);
  console.log(`Pasaron el cribado base (histórico/precio/turnover/coverage/frescura): ${stats.passedBase}`);
  console.log(`Fallidos en el cribado base: ${stats.rejected}`);
  if (stats.rejections?.length) {
    for (const r of stats.rejections.slice(0, 30)) console.log(`  - ${r.symbol}: ${r.reason}`);
    if (stats.rejections.length > 30) console.log(`  ... y ${stats.rejected - 30} más (omitidos del detalle, no del conteo).`);
  }
  console.log(`Preset aplicado: ${screenerFilters.preset || "(ninguno, enabled=false)"} — ${screenerFilters.activeCount} reglas activas`);
  console.log(`Pasan el preset "${args.preset}": ${stats.passedFilters}`);
  console.log("");
  console.log(`Filas guardadas en scan_results: ${savedScan.totalRows ?? savedScan.rows ?? 0}`);
  console.log(`  - completas (pasan el preset): ${savedScan.rows || 0}`);
  console.log(`  - ligeras (población, no pasan): ${savedScan.lightRows || 0}`);
  if (stats.droppedByMaxLightRows) {
    console.log(`  - AVISO: ${stats.droppedByMaxLightRows} filas ligeras descartadas por el tope maxLightRows.`);
  }
  logWriteBatches(savedScan.batches);
  console.log("");
  console.log(`Escaneo creado en 'scans': id=${savedScan.scanId} local_id=${savedScan.localId}`);
  console.log(`Nombre: ${scan.name}`);

  // Retención DESPUÉS de confirmar la escritura (punto 9 de la tarea): si
  // savedScan.saved no es true, el escaneo no se persistió y no hay nada que
  // retener sobre — no se llama a pruneNightlyScans. Si saved sí es true pero
  // la retención falla, el error se atrapa y se reporta: el escaneo recién
  // escrito NUNCA se pierde por un fallo de borrado.
  console.log("");
  console.log("=== RETENCIÓN ===");
  if (!shouldPruneAfterWrite(savedScan)) {
    console.log("Escaneo no confirmado como guardado (savedScan.saved !== true) — retención omitida por seguridad.");
  } else {
    try {
      const retention = await pruneNightlyScans(config, { dryRun: false, skip: args.skipRetention, retentionCount: DEFAULT_RETENTION_COUNT });
      logRetentionReport(retention);
    } catch (error) {
      console.log(`AVISO: la retención falló y se omitió (el escaneo recién escrito NO se ve afectado): ${error?.message || error}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const msPerSymbol = stats.selected ? scanElapsedMs / stats.selected : 0;
  console.log("");
  console.log(`Tiempo de escaneo (runMaterializedScan, dentro del proceso Vitest): ${(scanElapsedMs / 1000).toFixed(1)}s`);
  console.log(`Tiempo de escaneo + escritura (runMaterializedScan + writeMaterializedScan): ${(totalElapsedMs / 1000).toFixed(1)}s`);
  console.log(`Ritmo: ${msPerSymbol.toFixed(0)} ms/símbolo (${(1000 / msPerSymbol || 0).toFixed(3)} símbolos/seg)`);
  console.log(`Tiempo total del script: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (msPerSymbol > 0) {
    const estimatedFullMs = msPerSymbol * population.length;
    console.log("");
    console.log(`Estimación corrida completa (${population.length} símbolos, extrapolando el ritmo medido): ${(estimatedFullMs / 1000 / 60).toFixed(1)} min`);
  }
}

// ── Entrypoint: bootstrap normal, o segunda pasada como test de Vitest ────

if (process.env.SCAN_UNIVERSE_MODE === "vitest-child") {
  await runAsVitestChild();
} else {
  const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
  if (invokedDirectly) {
    main().catch((error) => {
      console.error("Error fatal:", error?.message || error);
      process.exitCode = 1;
    });
  }
}
