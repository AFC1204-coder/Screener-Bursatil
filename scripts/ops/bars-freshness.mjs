#!/usr/bin/env node
/**
 * Frescura real de las barras del universo US — SOLO LECTURA.
 *
 * El guardián nocturno solo miraba el código de salida de refresh-bars. Si el
 * refresco se paraba por el tope de filas (exit 2), el scan corría con barras
 * viejas y el estado salía «ok». Este chequeo mide el resultado, no el
 * proceso: qué parte del universo US del último snapshot tiene la barra de la
 * última sesión NYSE ya asentada.
 *
 * Uso (desde la raíz del repo, con la base en DATABASE_URL):
 *   node --env-file=.env.local scripts/ops/bars-freshness.mjs
 *   node --env-file=.env.local scripts/ops/bars-freshness.mjs --min-pct 90 --json
 *
 * Opciones:
 *   --min-pct N   % mínimo del universo con la última sesión (90). Un universo sano
 *                 ronda 94-95 %: el resto son deslistados y símbolos sin barras.
 *   --market M    mercado del snapshot y del calendario (US). HK usa solo
 *                 fines de semana como días sin sesión (sin festivos HK).
 *   --list RUTA   en lugar del snapshot, el universo es esta lista JSON
 *                 (p. ej. logs/hk-liquid-universe.json de hk-liquid-universe.mjs)
 *   --now ISO     instante de referencia (pruebas)
 *   --json        una línea JSON en vez de texto
 *
 * Salida: 0 por encima del umbral · 1 por debajo · 2 error (conexión, consulta).
 * Conexión: STATSEDGE_FRESHNESS_DATABASE_URL o DATABASE_URL. Nunca imprime
 * credenciales. La sesión abre con default_transaction_read_only=on.
 *
 * Las funciones puras (expectedSession, summarizeFreshness) se exportan para
 * los tests; la parte que toca la base solo corre si se ejecuta el script.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning");

const { addDays, isTradingDay, sessionSettleInstant } = await import("../../lib/marketCalendar.js");

/** Última sesión NYSE ya asentada (cierre + margen) en el instante `now`. */
export function expectedSession(now = new Date(), market = "US") {
  const ms = now instanceof Date ? now.getTime() : Date.parse(now);
  const today = new Date(ms).toISOString().slice(0, 10);
  for (let back = 0; back <= 10; back += 1) {
    const date = addDays(today, -back);
    if (!isTradingDay(market, date)) continue;
    const settle = sessionSettleInstant(market, date);
    const settleMs = settle instanceof Date ? settle.getTime() : Number(settle);
    if (ms >= settleMs) return date;
  }
  return null;
}

/** filas = [{ last: 'YYYY-MM-DD' | null, n }] → resumen con porcentajes. */
export function summarizeFreshness(rows, expected, minPct = 90) {
  let universe = 0;
  let upToDate = 0;
  let noBars = 0;
  for (const row of rows) {
    const n = Number(row.n) || 0;
    universe += n;
    if (!row.last) noBars += n;
    else if (expected && String(row.last).slice(0, 10) >= expected) upToDate += n;
  }
  const pct = universe > 0 ? Math.round((upToDate / universe) * 1000) / 10 : 0;
  return {
    expected,
    universe,
    upToDate,
    stale: universe - upToDate - noBars,
    noBars,
    pct,
    minPct,
    ok: universe > 0 && pct >= minPct,
  };
}

function parseArgs(argv) {
  const args = { minPct: 90, market: "US", now: null, json: false, list: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--min-pct") args.minPct = Number(argv[++i]);
    else if (a === "--market") args.market = String(argv[++i] || "US");
    else if (a === "--list") args.list = String(argv[++i] || "");
    else if (a === "--now") args.now = argv[++i];
    else if (a === "--json") args.json = true;
    else throw new Error(`Opción desconocida: ${a}`);
  }
  if (!Number.isFinite(args.minPct)) throw new Error("--min-pct inválido");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.STATSEDGE_FRESHNESS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (o STATSEDGE_FRESHNESS_DATABASE_URL)");
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    options: "-c default_transaction_read_only=on",
    application_name: "statsedge-bars-freshness",
  });
  await client.connect();
  try {
    const expected = expectedSession(args.now ? new Date(args.now) : new Date(), args.market);
    let rows;
    if (args.list) {
      const payload = JSON.parse(fs.readFileSync(args.list, "utf8"));
      const symbols = (payload.symbols || []).map((r) => String(r.symbol || "").trim()).filter(Boolean);
      const res = await client.query(
        `select u.symbol, b.d::text as last
           from unnest($1::text[]) as u(symbol)
           left join (select symbol, max(trade_date) d from daily_bars where symbol = any($1::text[]) group by symbol) b using (symbol)`,
        [symbols],
      );
      const byDate = new Map();
      for (const r of res.rows) byDate.set(r.last ?? null, (byDate.get(r.last ?? null) || 0) + 1);
      rows = [...byDate].map(([last, n]) => ({ last, n }));
    } else {
      const res = await client.query(
        `with s as (select snapshot_id from universe_snapshot_symbols order by created_at desc limit 1),
              u as (select distinct symbol from universe_snapshot_symbols
                    where snapshot_id = (select snapshot_id from s) and market = $1 and passed is true),
              b as (select symbol, max(trade_date) d from daily_bars group by symbol)
         select b.d::text as last, count(*)::int as n from u left join b using (symbol) group by 1`,
        [args.market],
      );
      rows = res.rows;
    }
    const summary = summarizeFreshness(
      rows.map((r) => ({ last: r.last ? String(r.last).slice(0, 10) : null, n: Number(r.n) })),
      expected,
      args.minPct,
    );
    if (args.json) console.log(JSON.stringify(summary));
    else {
      console.log(`Última sesión asentada: ${summary.expected}`);
      console.log(`Universo ${args.market}: ${summary.universe} · al día ${summary.upToDate} (${summary.pct} %) · atrasados ${summary.stale} · sin barras ${summary.noBars}`);
      console.log(summary.ok ? `OK (umbral ${summary.minPct} %)` : `POR DEBAJO del umbral (${summary.minPct} %)`);
    }
    return summary.ok ? 0 : 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`bars-freshness: ${err.message}`);
      process.exit(2);
    });
}
