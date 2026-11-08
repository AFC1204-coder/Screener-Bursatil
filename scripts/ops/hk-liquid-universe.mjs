#!/usr/bin/env node
/**
 * Universo líquido de Hong Kong — SOLO LECTURA sobre la base, escribe un JSON.
 *
 * Decisión del usuario (2026-11-08): HK se cubre solo con valores líquidos,
 * no con los ~2.760 del universo. Corte por defecto: mediana diaria de
 * cierre×volumen ≥ 5 M HKD en las últimas 60 sesiones, con al menos 20
 * sesiones con datos. Los símbolos HK curados del RS global (lib/rsGlobalUniverse.js)
 * entran siempre, aunque no lleguen al corte.
 *
 * Plan: research/operacion-diaria-2026-11/plan-hong-kong-liquidos.md
 *
 * Uso (desde la raíz del repo; --loader solo hace falta para incluir los curados):
 *   node --env-file=.env.local --loader ./scripts/loader.mjs scripts/ops/hk-liquid-universe.mjs
 *   node --env-file=.env.local scripts/ops/hk-liquid-universe.mjs --no-curated --json
 *
 * Opciones:
 *   --min-turnover N   HKD/día (5000000)
 *   --sessions N       sesiones para la mediana (60)
 *   --min-sessions N   mínimo de sesiones con datos (20)
 *   --out RUTA         archivo de salida (logs/hk-liquid-universe.json)
 *   --no-curated       no añadir los curados del RS global
 *   --json             imprime el resumen como una línea JSON
 *
 * Conexión: STATSEDGE_HK_LIST_DATABASE_URL o DATABASE_URL, con la sesión en
 * solo lectura. Nunca imprime credenciales.
 * Salida: 0 bien · 2 error · 3 lista vacía o sospechosamente corta (<100).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = { minTurnover: 5_000_000, sessions: 60, minSessions: 20 };
const MIN_PLAUSIBLE = 100;

/** rows = [{ symbol, n, med }] → símbolos líquidos ordenados por liquidez desc. */
export function selectLiquid(rows, { minTurnover = DEFAULTS.minTurnover, minSessions = DEFAULTS.minSessions, curated = [] } = {}) {
  const curatedSet = new Set(curated.map((s) => String(s).trim()).filter(Boolean));
  const picked = [];
  const seen = new Set();
  for (const row of rows) {
    const symbol = String(row.symbol || "").trim();
    if (!symbol || seen.has(symbol)) continue;
    const med = Number(row.med);
    const n = Number(row.n);
    const liquid = Number.isFinite(med) && n >= minSessions && med >= minTurnover;
    if (liquid || curatedSet.has(symbol)) {
      picked.push({ symbol, medianTurnover: Number.isFinite(med) ? Math.round(med) : null, sessions: n || 0, curated: curatedSet.has(symbol) && !liquid });
      seen.add(symbol);
    }
  }
  // Curados sin ninguna fila de barras: entran igualmente (se cargarán).
  for (const symbol of curatedSet) {
    if (!seen.has(symbol)) {
      picked.push({ symbol, medianTurnover: null, sessions: 0, curated: true });
      seen.add(symbol);
    }
  }
  picked.sort((a, b) => (b.medianTurnover ?? -1) - (a.medianTurnover ?? -1) || a.symbol.localeCompare(b.symbol));
  return picked;
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, out: "logs/hk-liquid-universe.json", curated: true, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--min-turnover") args.minTurnover = Number(argv[++i]);
    else if (a === "--sessions") args.sessions = Number(argv[++i]);
    else if (a === "--min-sessions") args.minSessions = Number(argv[++i]);
    else if (a === "--out") args.out = String(argv[++i]);
    else if (a === "--no-curated") args.curated = false;
    else if (a === "--json") args.json = true;
    else throw new Error(`Opción desconocida: ${a}`);
  }
  for (const key of ["minTurnover", "sessions", "minSessions"]) {
    if (!Number.isFinite(args[key]) || args[key] < 0) throw new Error(`--${key} inválido`);
  }
  return args;
}

async function loadCurated() {
  try {
    const mod = await import("@/lib/rsGlobalUniverse.js");
    return mod.intlUniverseRows(["HK"]).map((row) => row.symbol);
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.STATSEDGE_HK_LIST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (o STATSEDGE_HK_LIST_DATABASE_URL)");
  let curated = [];
  let curatedNote = "no incluidos (--no-curated)";
  if (args.curated) {
    const result = await loadCurated();
    if (Array.isArray(result)) {
      curated = result;
      curatedNote = `${curated.length} curados del RS global`;
    } else {
      curatedNote = `no se pudieron cargar (${result.error}); ¿falta --loader ./scripts/loader.mjs?`;
    }
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    options: "-c default_transaction_read_only=on",
    application_name: "statsedge-hk-liquid-universe",
  });
  await client.connect();
  let rows;
  let snapshot;
  try {
    const res = await client.query(
      `with s as (select snapshot_id, max(created_at) ts from universe_snapshot_symbols
                  where market = 'HK' group by snapshot_id order by 2 desc limit 1),
            u as (select distinct symbol from universe_snapshot_symbols
                  where snapshot_id = (select snapshot_id from s) and market = 'HK' and passed is true
                    and instrument_type in ('equity', 'listed-vehicle')),
            r as (select b.symbol, b.close * b.volume as t,
                         row_number() over (partition by b.symbol order by b.trade_date desc) rn
                  from daily_bars b join u using (symbol)
                  where b.close > 0 and b.volume > 0 and b.trade_date >= current_date - 400)
       select symbol, count(*)::int as n,
              percentile_cont(0.5) within group (order by t)::float8 as med
       from r where rn <= $1 group by symbol`,
      [args.sessions],
    );
    rows = res.rows;
    const snap = await client.query(
      "select count(distinct symbol)::int as universe from universe_snapshot_symbols where market = 'HK' and passed is true and snapshot_id = (select snapshot_id from universe_snapshot_symbols where market = 'HK' order by created_at desc limit 1)",
    );
    snapshot = snap.rows[0];
  } finally {
    await client.end();
  }

  const symbols = selectLiquid(rows, { minTurnover: args.minTurnover, minSessions: args.minSessions, curated });
  const payload = {
    generatedAt: new Date().toISOString(),
    market: "HK",
    minTurnoverHKD: args.minTurnover,
    sessions: args.sessions,
    minSessions: args.minSessions,
    universePassed: snapshot?.universe ?? null,
    withBars: rows.length,
    curated: curatedNote,
    count: symbols.length,
    symbols,
  };
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 1));
  fs.renameSync(tmp, outPath);

  const summary = { count: symbols.length, universePassed: payload.universePassed, withBars: rows.length, minTurnoverHKD: args.minTurnover, curated: curatedNote, out: args.out };
  if (args.json) console.log(JSON.stringify(summary));
  else {
    console.log(`Universo HK passed: ${summary.universePassed} · con barras: ${rows.length}`);
    console.log(`Líquidos (mediana ≥ ${args.minTurnover.toLocaleString("es-ES")} HKD en ${args.sessions} sesiones, ≥ ${args.minSessions} con datos): ${symbols.length}`);
    console.log(`Curados: ${curatedNote}`);
    console.log(`Escrito: ${args.out}`);
  }
  return symbols.length >= MIN_PLAUSIBLE ? 0 : 3;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`hk-liquid-universe: ${err.message}`);
      process.exit(2);
    });
}
