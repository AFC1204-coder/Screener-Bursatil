// scripts/purge-scans.mjs — purga acumulación histórica en dos tablas
// independientes, ejecutable a mano. Sigue el mismo patrón de
// scripts/refresh-bars.mjs: --dry-run POR DEFECTO, --write explícito.
//
// AVISO DE LA TAREA, no se repite en cada función: la instancia Supabase es
// Micro y se ha saturado dos veces — el 9 de agosto, ~700.000 filas escritas
// de golpe la tumbaron cuatro horas. Un borrado masivo de golpe tiene el
// mismo riesgo. Por eso TODO borrado aquí va por tandas pequeñas (--batch-
// size, 5-10 por defecto) con pausa entre tandas (--pause-ms) y una
// verificación ligera tras cada tanda antes de seguir.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/purge-scans.mjs [--dry-run] [--write] \
//     [--retention-days=7] [--batch-size=7] [--weight-cap=3000] \
//     [--pause-ms=2000] [--purge-universe] [--universe-max-age-days=45]
//
// --batch-size sigue siendo el TOPE MÁXIMO de elementos por tanda; el
// tamaño real de cada tanda lo decide --weight-cap (filas hijas acumuladas,
// vía row_count/total_count) — ver la sección "Agrupado por peso" más abajo.
//
// Por defecto corre en --dry-run (reporta qué borraría, no borra nada).
// Borrar de verdad exige --write explícito.
//
// ── TAREA 1 — scans / scan_results ─────────────────────────────────────────
// Decisión ya tomada (no se cuestiona aquí):
//   - Conservar los 7 escaneos NOCTURNOS más recientes (local_id que empieza
//     por "materialized:US:"). Ya tienen su propia retención automática en
//     scripts/scan-universe.mjs (pruneNightlyScans) — este script NUNCA
//     borra uno de estos, los deja pasar intactos sin ni siquiera contarlos
//     contra ningún tope propio, para no duplicar ni pisar esa lógica
//     (restricción explícita de la tarea).
//   - Conservar TODO escaneo de cron (local_id empieza por "materialized:",
//     de cualquier mercado) de los últimos --retention-days días (7 por
//     defecto): el cron de Vercel (SCAN_CRON_GROUPS, vercel.json) sigue
//     corriendo y alimenta otros mercados.
//   - Borrar lo demás: todo escaneo interactivo (local_id "server-scan-*",
//     con o sin deleted_at ya marcado — un soft-delete no libera las filas
//     de scan_results, así que un interactivo ya "borrado" en el producto
//     sigue pesando en Supabase hasta que esto lo borre de verdad) y
//     cualquier escaneo de cron anterior a la ventana de retención.
//
// Borrado por scans.id, nunca por scan_results directamente: la FK
// scan_results.scan_id references scans(id) on delete cascade
// (supabase/schema.sql) limpia las filas hijas sola. row_count en `scans`
// ya lleva la cuenta de filas de cada escaneo (se fija al escribir), así
// que sumarlo evita tener que consultar scan_results sin filtro acotado —
// justo la tabla que el AVISO de la tarea señala como la que se satura.
//
// ── TAREA 2 — universe_snapshots / universe_snapshot_symbols (opt-in) ──────
// Motor: lib/universeEngine.js hace upsert por (owner_id, cache_key) — cada
// combinación de mercados vive en UNA fila que se sobreescribe en el sitio,
// nunca crece por combinación activa. Las instantáneas "muertas" (updated_at
// == created_at, sin tocar en meses) son combinaciones de mercados que ya no
// pide nadie: ni un cron programado ni tráfico real, porque
// getUniverseEngineSnapshot escribe (upsert) cada vez que hay un cache MISS
// o STALE, venga la petición de donde venga (cron programado, job manual, o
// tráfico normal a /api/universe o /api/universe-engine — ninguna de las dos
// rutas exige auth interna). Es decir: un updated_at viejo es, en sí mismo,
// la prueba de que nadie —cron o no— ha pedido esa combinación en toda esa
// ventana; no hace falta enumerar cada posible llamador para confirmarlo.
//
// COMPROBACIÓN DEL PUNTO 9 (dónde se verifica que ninguna candidata
// corresponde a un cron actual), dos capas:
//   1. Estructural: el ÚNICO cron programado que escribe universe_snapshots
//      es "/api/cron/universe-refresh" — confirmado en vercel.json
//      ("crons": [{ "path": "/api/cron/universe-refresh", "schedule": "10 21
//      * * *" }], el único de los 6 crons de ese archivo que toca esta
//      tabla). Ese endpoint pide expandedUniverseCronMarkets()
//      (lib/cronPlan.js:199), que devuelve CRON_UNIVERSE_MARKETS
//      (lib/cronPlan.js:19) normalizado. Antes de marcar cualquier fila como
//      candidata, esta función compara su columna `markets` (ordenada)
//      contra CRON_UNIVERSE_MARKETS (ordenado, vía normalizeMarketList
//      importado de lib/markets.js) y la excluye si coincide, pase lo que
//      pase con su updated_at.
//   2. Empírica: --universe-max-age-days (45 por defecto) es el propio
//      criterio de "muerta" — ver el párrafo de arriba. Cualquier otro
//      llamador no-cron (app/api/jobs/universe-refresh, app/api/coverage vía
//      lib/coveragePlan.js, o tráfico directo a /api/universe*) que hubiera
//      tocado esa combinación en los últimos 45 días ya la habría sacado de
//      la ventana de purga por su propio updated_at reciente — no hace falta
//      una lista exhaustiva de esos llamadores para que la comprobación sea
//      válida.
//
// Borrado por universe_snapshots.id: la FK
// universe_snapshot_symbols.snapshot_id references universe_snapshots(id) on
// delete cascade limpia las filas hijas sola.

import { pathToFileURL } from "node:url";

import { supabaseConfig, supabaseRequest, supabaseRequestAll } from "@/lib/supabaseServer.js";
import { CRON_UNIVERSE_MARKETS } from "@/lib/cronPlan.js";
import { normalizeMarketList } from "@/lib/markets.js";

// Mismo patrón que scripts/scan-universe.mjs:130 — reproducido aquí porque
// scan-universe.mjs no lo exporta (y esta tarea prohíbe tocar su retención).
const NIGHTLY_LOCAL_ID_PREFIX = "materialized:US:";
const CRON_LOCAL_ID_PREFIX = "materialized:";

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_BATCH_SIZE = 7; // dentro del rango pedido (5-10) — sigue siendo el TOPE de elementos por tanda (punto 7), el peso manda por debajo de él
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 10;
const DEFAULT_PAUSE_MS = 2000;
const DEFAULT_UNIVERSE_MAX_AGE_DAYS = 45;

// ── Agrupado por peso (punto 4-7) ──────────────────────────────────────────
//
// Lo aprendido purgando producción hoy (ver AVISO arriba): el número de
// escaneos padre no predice el coste de un DELETE — lo predicen las filas
// hijas que arrastra en cascada. Medido contra la instancia Micro real:
//   - 5.062 filas hijas en una tanda: pasó, pero "lenta" (ya en zona de
//     riesgo perceptible).
//   - ~60.000 filas hijas (7 escaneos de ~9.900 cada uno): "canceling
//     statement due to statement timeout".
// DEFAULT_WEIGHT_CAP = 3.000 dejar margen a ambos lados con los dos únicos
// puntos medidos: ~40% por debajo del punto que ya iba lento (5.062), y casi
// 20× por debajo del punto que falló (60.000) — margen, no ajuste fino.
// Un escaneo que por sí solo supera el tope (p.ej. los de ~9.900-9.920 filas
// que pasaron uno-a-uno) va IGUAL solo en su propia tanda (punto 6): el tope
// decide cuándo DEJAR DE ACUMULAR más elementos, nunca excluye a uno.
const DEFAULT_WEIGHT_CAP = 3000;
const MAX_RETRIES = 3; // hasta "dos o tres reintentos" (punto 8)
const MAX_PAUSE_MS = 60000; // techo del backoff (punto 10) — no crecer sin límite

// Agrupa `candidates` (ya ordenados) en tandas acumulando row_count hasta
// `weightCap`, respetando `batchSize` como tope máximo de elementos por
// tanda (punto 7). Un elemento cuyo propio peso ya supera `weightCap` cierra
// su tanda en solitario en cuanto entra (punto 6) — nunca se descarta ni se
// deja fuera.
export function groupByWeight(candidates, { weightCap, batchSize }) {
  const batches = [];
  let current = [];
  let currentWeight = 0;
  for (const item of candidates) {
    const weight = Number(item.rowCount || 0);
    if (current.length > 0 && (currentWeight + weight > weightCap || current.length >= batchSize)) {
      batches.push(current);
      current = [];
      currentWeight = 0;
    }
    current.push(item);
    currentWeight += weight;
    // Punto 6: un elemento que por sí solo ya supera el tope cierra su tanda
    // de inmediato — nunca se acumula junto a otros ni se descarta.
    if (weight > weightCap) {
      batches.push(current);
      current = [];
      currentWeight = 0;
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

function batchWeight(items) {
  return items.reduce((sum, row) => sum + Number(row.rowCount || 0), 0);
}

// Detecta un timeout de statement en Postgres/PostgREST: code 57014
// ("query_canceled"/statement_timeout) o el mensaje textual que devuelve
// PostgREST cuando reenvía el error de Postgres tal cual.
export function isTimeoutError(error) {
  const code = error?.details?.code;
  if (code === "57014") return true;
  const message = String(error?.message || "");
  return /statement timeout|canceling statement|query.?timeout/i.test(message);
}

// ── CLI args ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
    batchSize: DEFAULT_BATCH_SIZE,
    pauseMs: DEFAULT_PAUSE_MS,
    purgeUniverse: false,
    universeMaxAgeDays: DEFAULT_UNIVERSE_MAX_AGE_DAYS,
    weightCap: DEFAULT_WEIGHT_CAP,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "retention-days") {
      const parsed = Number(rawValue);
      // Number.isFinite (no ||) para que --retention-days=0 no caiga al
      // default por ser 0 "falsy" — punto 11 lo necesita para forzar
      // candidatos en dry-run cuando no queda nada fuera de la ventana.
      out.retentionDays = Math.max(0, Number.isFinite(parsed) ? parsed : DEFAULT_RETENTION_DAYS);
    }
    else if (key === "batch-size") out.batchSize = Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Number(rawValue) || DEFAULT_BATCH_SIZE));
    else if (key === "pause-ms") out.pauseMs = Math.max(0, Number(rawValue) || 0);
    else if (key === "purge-universe") out.purgeUniverse = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "universe-max-age-days") out.universeMaxAgeDays = Math.max(1, Number(rawValue) || DEFAULT_UNIVERSE_MAX_AGE_DAYS);
    else if (key === "weight-cap") out.weightCap = Math.max(1, Number(rawValue) || DEFAULT_WEIGHT_CAP);
  }
  // Mismo criterio que refresh-bars.mjs/scan-universe.mjs: --write gana sobre
  // el default dry-run=true, pero --dry-run=true explícito manda sobre
  // --write (más seguro).
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── TAREA 1 — clasificación de scans ───────────────────────────────────────

export async function fetchAllScans(config) {
  return supabaseRequestAll("scans", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      "select=id,local_id,created_at,row_count,deleted_at",
      "order=created_at.asc",
    ].join("&"),
  }, { maxRows: 20000, pageSize: 500 });
}

// Clasifica un escaneo en keep/delete con el motivo. `cutoff` es un
// timestamp epoch ms: now - retentionDays*86400000.
export function classifyScan(row, cutoff) {
  if (row.local_id.startsWith(NIGHTLY_LOCAL_ID_PREFIX)) {
    return { keep: true, reason: "nocturno (materialized:US:*) — retención propia de scan-universe.mjs, no se toca" };
  }
  if (row.local_id.startsWith(CRON_LOCAL_ID_PREFIX)) {
    const ageMs = Date.now() - Date.parse(row.created_at);
    if (Date.parse(row.created_at) >= cutoff) {
      return { keep: true, reason: `cron, dentro de la ventana de retención (${Math.floor(ageMs / 86400000)}d)` };
    }
    return { keep: false, reason: "cron, anterior a la ventana de retención" };
  }
  return { keep: false, reason: "interactivo (server-scan-*) — ya no se genera con el diseño nuevo" };
}

export function planScanPurge(scans, { retentionDays }) {
  const cutoff = Date.now() - retentionDays * 86400000;
  const kept = [];
  const candidates = [];
  for (const row of scans) {
    const { keep, reason } = classifyScan(row, cutoff);
    const entry = { id: row.id, localId: row.local_id, createdAt: row.created_at, rowCount: Number(row.row_count || 0), deletedAt: row.deleted_at, reason };
    (keep ? kept : candidates).push(entry);
  }
  // `scans` ya viene ordenado created_at.asc de fetchAllScans, así que
  // `candidates` conserva ese orden: los más viejos primero (punto 4).
  return { kept, candidates, cutoffIso: new Date(cutoff).toISOString() };
}

// ── TAREA 2 — clasificación de universe_snapshots ──────────────────────────

export async function fetchAllUniverseSnapshots(config) {
  return supabaseRequestAll("universe_snapshots", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      "select=id,cache_key,markets,created_at,updated_at,total_count",
      "order=updated_at.asc",
    ].join("&"),
  }, { maxRows: 5000, pageSize: 500 });
}

function marketSetKey(markets) {
  return [...new Set((markets || []).map((m) => String(m).trim().toUpperCase()))].sort().join(",");
}

// Comparación punto 9, capa 1 — ver cabecera del archivo.
const LIVE_CRON_MARKET_SET_KEY = marketSetKey(normalizeMarketList(CRON_UNIVERSE_MARKETS, []));

export function classifyUniverseSnapshot(row, cutoff) {
  const isLiveCronCombo = marketSetKey(row.markets) === LIVE_CRON_MARKET_SET_KEY;
  if (isLiveCronCombo) {
    return { keep: true, reason: "coincide con CRON_UNIVERSE_MARKETS (lib/cronPlan.js) — el cron programado de universe-refresh la pide" };
  }
  const updatedAtMs = Date.parse(row.updated_at);
  if (Number.isFinite(updatedAtMs) && updatedAtMs >= cutoff) {
    const ageDays = Math.floor((Date.now() - updatedAtMs) / 86400000);
    return { keep: true, reason: `updated_at reciente (${ageDays}d) — algo la sigue pidiendo` };
  }
  return { keep: false, reason: "updated_at anterior al umbral, y no coincide con el cron programado" };
}

export function planUniversePurge(snapshots, { universeMaxAgeDays }) {
  const cutoff = Date.now() - universeMaxAgeDays * 86400000;
  const kept = [];
  const candidates = [];
  for (const row of snapshots) {
    const { keep, reason } = classifyUniverseSnapshot(row, cutoff);
    // total_count es el nº de filas escritas en universe_snapshot_symbols
    // para esta instantánea (lib/universeEngine.js writeSupabaseSnapshot:
    // total_count = universe.length + excluded.length = rows.length, y ese
    // mismo `rows` es exactamente lo que se inserta ahí) — mismo patrón que
    // row_count en `scans`, disponible sin consultar la tabla hija.
    const entry = { id: row.id, cacheKey: row.cache_key, markets: row.markets, createdAt: row.created_at, updatedAt: row.updated_at, rowCount: Number(row.total_count || 0), reason };
    (keep ? kept : candidates).push(entry);
  }
  // `snapshots` ya viene ordenado updated_at.asc de fetchAllUniverseSnapshots.
  return { kept, candidates, cutoffIso: new Date(cutoff).toISOString() };
}

// ── Borrado por tandas, agrupadas por peso, con reintento adaptativo ──────
//
// `table` es el único parámetro que cambia entre TAREA 1 (scans) y TAREA 2
// (universe_snapshots) — el resto de la lógica de tandas/pausa/verificación
// es idéntica a propósito, para que ambas purgas se comporten igual frente a
// la instancia.
//
// Cola de trabajo en vez de bucle sobre un array fijo: cuando una tanda falla
// por timeout (punto 8) se divide por la mitad y las dos mitades vuelven a la
// cola (no se pierde ningún candidato, solo se reintenta más fino). Si una
// tanda de un solo elemento sigue fallando tras agotar los reintentos, para
// ahí y lo reporta (punto 9). La pausa entre tandas crece tras un fallo y
// vuelve a la normal tras una racha de tandas OK (punto 10).
export async function deleteInBatches(candidates, { table, weightCap, batchSize, pauseMs, label, maxRetries = MAX_RETRIES, maxPauseMs = MAX_PAUSE_MS }) {
  const initialBatches = groupByWeight(candidates, { weightCap, batchSize });
  const queue = initialBatches.map((items) => ({ items, attempt: 0 }));

  const report = { table, batches: [], deletedCount: 0, deletedRowCount: 0, stoppedEarly: false, error: null, failedItem: null };

  let currentPause = pauseMs;
  let consecutiveOk = 0;
  let batchIndex = 0;

  while (queue.length) {
    const { items, attempt } = queue.shift();
    batchIndex += 1;
    const ids = items.map((row) => row.id);
    const weight = batchWeight(items);
    console.log(`  Tanda ${batchIndex} (${label}): borrando ${ids.length} filas de '${table}' (~${weight} filas hijas vía cascade)${attempt ? ` [reintento ${attempt}/${maxRetries}]` : ""}...`);

    let stepFailed = null; // { error, retryable }
    try {
      await supabaseRequest(table, {
        method: "DELETE",
        query: `id=in.(${ids.map(encodeURIComponent).join(",")})`,
      });
      // Verificación ligera (punto 5): re-consulta los mismos IDs por PK, debe
      // volver vacío. Acotada a un puñado de IDs — no un COUNT ni un barrido.
      const stillPresent = await supabaseRequest(table, {
        query: `id=in.(${ids.map(encodeURIComponent).join(",")})&select=id&limit=${ids.length}`,
      });
      if (Array.isArray(stillPresent) && stillPresent.length) {
        const error = new Error(`${stillPresent.length} filas seguían presentes tras el DELETE (verificación falló)`);
        stepFailed = { error, retryable: false };
      }
    } catch (error) {
      stepFailed = { error, retryable: isTimeoutError(error) };
    }

    if (!stepFailed) {
      report.deletedCount += items.length;
      report.deletedRowCount += weight;
      report.batches.push({ index: batchIndex, ids, weight, attempt, verified: true });
      console.log(`  OK: tanda ${batchIndex} verificada (${items.length} filas, ${weight ? `${weight} filas hijas vía cascade` : "sin filas hijas contadas"}).`);

      consecutiveOk += 1;
      if (consecutiveOk >= 3 && currentPause > pauseMs) {
        console.log(`  Racha de ${consecutiveOk} tandas OK seguidas: la pausa vuelve a ${pauseMs}ms.`);
        currentPause = pauseMs;
      }
      if (queue.length && currentPause > 0) {
        console.log(`  Pausa de ${currentPause}ms antes de la siguiente tanda...`);
        await sleep(currentPause);
      }
      continue;
    }

    // Punto 10: tras un fallo, la pausa crece (se dobla, con techo) y la
    // racha de éxitos se reinicia — la base necesita respirar más.
    consecutiveOk = 0;
    currentPause = Math.min(maxPauseMs, Math.max(currentPause * 2, pauseMs * 2));

    if (stepFailed.retryable && attempt < maxRetries && items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      const first = items.slice(0, mid);
      const second = items.slice(mid);
      console.log(`  Tanda ${batchIndex} falló por timeout (${items.length} elementos, ~${weight} filas). Espera ${currentPause}ms y reintenta dividida en ${first.length}+${second.length}.`);
      await sleep(currentPause);
      queue.unshift({ items: second, attempt: attempt + 1 });
      queue.unshift({ items: first, attempt: attempt + 1 });
      continue;
    }

    if (stepFailed.retryable && attempt < maxRetries && items.length === 1) {
      console.log(`  Tanda ${batchIndex} (1 elemento, ~${weight} filas) falló por timeout. Espera ${currentPause}ms y reintenta (${attempt + 1}/${maxRetries}).`);
      await sleep(currentPause);
      queue.unshift({ items, attempt: attempt + 1 });
      continue;
    }

    // Punto 9: un elemento solo que sigue fallando tras agotar los
    // reintentos (o un fallo no reintentable, p.ej. verificación) para todo
    // y lo reporta con detalle.
    const failed = items.length === 1 ? items[0] : null;
    report.error = failed
      ? `Elemento ${failed.localId || failed.cacheKey || failed.id} falló tras ${attempt} reintento(s) (${failed.rowCount || 0} filas hijas): ${stepFailed.error?.message || stepFailed.error}`
      : `Tanda de ${items.length} elementos (~${weight} filas) falló${stepFailed.retryable ? ` tras ${attempt} reintento(s)` : ""}: ${stepFailed.error?.message || stepFailed.error}`;
    report.stoppedEarly = true;
    report.failedItem = failed;
    console.log(`  ERROR: ${report.error}`);
    break;
  }

  return report;
}

// ── Reportes ────────────────────────────────────────────────────────────

function logScanPlan(plan, args) {
  console.log("");
  console.log(`=== TAREA 1 — scans (retención cron: ${args.retentionDays} días, corte: ${plan.cutoffIso}) ===`);
  const totalRows = plan.kept.reduce((s, r) => s + r.rowCount, 0) + plan.candidates.reduce((s, r) => s + r.rowCount, 0);
  console.log(`Escaneos totales: ${plan.kept.length + plan.candidates.length} (${totalRows} filas de scan_results, por row_count)`);
  console.log(`Se conservan: ${plan.kept.length} (${plan.kept.reduce((s, r) => s + r.rowCount, 0)} filas)`);
  const nightlyKept = plan.kept.filter((r) => r.reason.startsWith("nocturno"));
  const cronKept = plan.kept.filter((r) => r.reason.startsWith("cron"));
  console.log(`  - nocturnos (materialized:US:*): ${nightlyKept.length}`);
  console.log(`  - cron dentro de ${args.retentionDays}d: ${cronKept.length}`);
  console.log(`${args.dryRun ? "Se borrarían" : "Se borran"}: ${plan.candidates.length} (${plan.candidates.reduce((s, r) => s + r.rowCount, 0)} filas de scan_results vía cascade)`);
  const cronDelete = plan.candidates.filter((r) => r.reason.startsWith("cron"));
  const interactiveDelete = plan.candidates.filter((r) => r.reason.startsWith("interactivo"));
  console.log(`  - cron fuera de ventana: ${cronDelete.length} (${cronDelete.reduce((s, r) => s + r.rowCount, 0)} filas)`);
  console.log(`  - interactivos (server-scan-*): ${interactiveDelete.length} (${interactiveDelete.reduce((s, r) => s + r.rowCount, 0)} filas)`);
  if (plan.candidates.length) {
    console.log("");
    console.log(`Detalle de candidatos a borrar (orden ascendente por fecha, hasta 100 de ${plan.candidates.length}):`);
    for (const c of plan.candidates.slice(0, 100)) {
      console.log(`  - ${c.localId.padEnd(55)} ${c.createdAt}  ${String(c.rowCount).padStart(6)} filas  [${c.reason}]${c.deletedAt ? "  (ya soft-deleted en producto)" : ""}`);
    }
    if (plan.candidates.length > 100) console.log(`  ... y ${plan.candidates.length - 100} más (omitidos del detalle, no del conteo).`);
  }
}

function logUniversePlan(plan, args) {
  console.log("");
  console.log(`=== TAREA 2 — universe_snapshots (umbral: ${args.universeMaxAgeDays} días, corte: ${plan.cutoffIso}) ===`);
  console.log(`Instantáneas totales: ${plan.kept.length + plan.candidates.length}`);
  console.log(`Se conservan: ${plan.kept.length}`);
  for (const k of plan.kept) console.log(`  - ${(k.cacheKey || "").slice(0, 70).padEnd(70)} updated_at=${k.updatedAt}  [${k.reason}]`);
  console.log(`${args.dryRun ? "Se borrarían" : "Se borran"}: ${plan.candidates.length}`);
  if (plan.candidates.length) {
    console.log("");
    console.log(`Detalle de candidatas a borrar (orden ascendente por updated_at, hasta 100 de ${plan.candidates.length}):`);
    for (const c of plan.candidates.slice(0, 100)) {
      console.log(`  - ${(c.cacheKey || "").slice(0, 70).padEnd(70)} updated_at=${c.updatedAt} creado=${c.createdAt}`);
    }
    if (plan.candidates.length > 100) console.log(`  ... y ${plan.candidates.length - 100} más (omitidos del detalle, no del conteo).`);
  }
}

// Vista previa de cómo se agruparían las tandas por peso (punto 11): corre
// tanto en dry-run como antes de borrar de verdad, así se puede comprobar
// la agrupación sin necesidad de --write.
function logBatchPreview(candidates, { weightCap, batchSize, label }) {
  if (!candidates.length) return;
  const batches = groupByWeight(candidates, { weightCap, batchSize });
  console.log("");
  console.log(`Tandas por peso (${label}, tope=${weightCap} filas hijas, máx ${batchSize} elementos/tanda): ${batches.length} tanda(s)`);
  batches.forEach((items, i) => {
    const weight = batchWeight(items);
    const flag = weight > weightCap ? "  [supera el tope — elemento único que va solo]" : "";
    console.log(`  - Tanda ${i + 1}: ${items.length} elemento(s), ${weight} filas hijas${flag}`);
  });
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

  console.log(`=== purge-scans.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} retention-days=${args.retentionDays} batch-size=${args.batchSize} weight-cap=${args.weightCap} pause-ms=${args.pauseMs}${args.purgeUniverse ? ` purge-universe universe-max-age-days=${args.universeMaxAgeDays}` : ""} ===`);

  // ── TAREA 1 ──────────────────────────────────────────────────────────
  console.log("");
  console.log("Leyendo scans...");
  const scans = await fetchAllScans(config);
  const scanPlan = planScanPurge(scans, { retentionDays: args.retentionDays });
  logScanPlan(scanPlan, args);
  logBatchPreview(scanPlan.candidates, { weightCap: args.weightCap, batchSize: args.batchSize, label: "scans" });

  if (!args.dryRun) {
    if (scanPlan.candidates.length) {
      console.log("");
      console.log(`Borrando ${scanPlan.candidates.length} escaneos...`);
      const report = await deleteInBatches(scanPlan.candidates, {
        table: "scans",
        weightCap: args.weightCap,
        batchSize: args.batchSize,
        pauseMs: args.pauseMs,
        label: "scans",
      });
      console.log("");
      console.log(`TAREA 1 — borrados: ${report.deletedCount}/${scanPlan.candidates.length} escaneos (${report.deletedRowCount} filas de scan_results vía cascade).`);
      if (report.stoppedEarly) console.log(`TAREA 1 — PARADA ANTICIPADA: ${report.error}`);
    } else {
      console.log("");
      console.log("TAREA 1 — nada que borrar.");
    }
  }

  // ── TAREA 2 (opt-in) ─────────────────────────────────────────────────
  if (args.purgeUniverse) {
    console.log("");
    console.log("Leyendo universe_snapshots...");
    const snapshots = await fetchAllUniverseSnapshots(config);
    const universePlan = planUniversePurge(snapshots, { universeMaxAgeDays: args.universeMaxAgeDays });
    logUniversePlan(universePlan, args);
    logBatchPreview(universePlan.candidates, { weightCap: args.weightCap, batchSize: args.batchSize, label: "universe_snapshots" });

    if (!args.dryRun) {
      if (universePlan.candidates.length) {
        console.log("");
        console.log(`Borrando ${universePlan.candidates.length} instantáneas...`);
        const report = await deleteInBatches(universePlan.candidates, {
          table: "universe_snapshots",
          weightCap: args.weightCap,
          batchSize: args.batchSize,
          pauseMs: args.pauseMs,
          label: "universe_snapshots",
        });
        console.log("");
        console.log(`TAREA 2 — borradas: ${report.deletedCount}/${universePlan.candidates.length} instantáneas (universe_snapshot_symbols limpiado vía cascade).`);
        if (report.stoppedEarly) console.log(`TAREA 2 — PARADA ANTICIPADA: ${report.error}`);
      } else {
        console.log("");
        console.log("TAREA 2 — nada que borrar.");
      }
    }
  } else {
    console.log("");
    console.log("TAREA 2 — omitida (pasa --purge-universe para incluirla).");
  }

  if (args.dryRun) {
    console.log("");
    console.log("Dry-run: no se borró nada en Supabase. Pasa --write para ejecutar de verdad.");
  }
  console.log("");
  console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

// Solo se ejecuta cuando el archivo se invoca directamente por CLI. Si se
// importa (los tests importan parseArgs/classifyScan/planScanPurge/…),
// main() no corre y no se toca Supabase.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Error fatal:", error?.message || error);
    process.exitCode = 1;
  });
}
