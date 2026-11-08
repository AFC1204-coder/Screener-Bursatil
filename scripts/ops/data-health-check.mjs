#!/usr/bin/env node
/**
 * Chequeo de salud de datos tras el nocturno — SOLO LECTURA.
 *
 * Auditoría de producto 2026-11 (research/auditoria-producto-2026-11/informe.md,
 * D1, D4 y D5). Ejecuta cuatro comprobaciones contra Postgres y sale con
 * código ≠ 0 si alguna supera su umbral:
 *
 *   a3  Picos de una barra: el cierre sube >40 % y al día siguiente vuelve
 *       >30 % (o al revés), en los símbolos del último nocturno US. Firma de
 *       contrasplits sin ajustar (VEEA, KITT) y de barras basura.     (D5)
 *   a4  Barras de acciones US en días sin sesión NYSE (festivos y fines de
 *       semana), con el calendario calculado de lib/marketCalendar.js, no
 *       con una lista a mano.                                           (D5)
 *   a6  Barras guardadas ANTES de que su sesión quedara asentada (cierre +
 *       30 min en el huso de su mercado: EE. UU., Hong Kong y Europa). Son
 *       velas intradía persistidas como cierres.                        (D4)
 *   a11 Parpadeo de la etapa semanal OFICIAL entre nocturnos que comparten
 *       semana oficial (última semana cerrada): debería ser 0.          (D1)
 *
 * No escribe nada: la conexión abre con default_transaction_read_only=on y
 * todas las consultas van dentro de BEGIN READ ONLY … ROLLBACK. No se instala
 * en el Mini ni está conectado al cron (decisión pendiente del dueño).
 *
 * Uso:
 *   node scripts/ops/data-health-check.mjs                # copia local :55432
 *   node scripts/ops/data-health-check.mjs --since 2025-06-01 --json
 *   STATSEDGE_HEALTH_DATABASE_URL=postgresql://… node scripts/ops/data-health-check.mjs
 *
 * Opciones:
 *   --since YYYY-MM-DD   inicio de la ventana de a3/a4/a6 (por defecto, hoy − 18 meses)
 *   --scans N            nocturnos US que mira a11 (7)
 *   --max-a3 N --max-a4 N --max-a6 N --max-a11 N   umbrales (0 por defecto)
 *   --sample N           filas de ejemplo por comprobación (10)
 *   --json               salida JSON en vez de texto
 *
 * Códigos de salida: 0 todo bajo umbral · 1 alguna comprobación lo supera ·
 * 2 error (conexión, consulta).
 *
 * Conexión: STATSEDGE_HEALTH_DATABASE_URL si existe; si no, la copia local
 * (127.0.0.1:55432, postgres, statsedge_local), como research/…/scripts/q.sh.
 * Nunca imprime credenciales: solo host:puerto/base.
 */

// lib/marketCalendar.js es ESM en un paquete sin "type": "module"; node lo
// detecta solo pero avisa por stderr. Se quita ese aviso (y solo los avisos)
// antes de importarlo, para que la salida del chequeo sea legible.
process.removeAllListeners("warning");

const {
  MARKET_SESSIONS,
  SESSION_SETTLE_BUFFER_MINUTES,
  addDays,
  isLastNyseSessionOfWeek,
  isoWeekMonday,
  nyseNonTradingDays,
  previousNyseSession,
} = await import("../../lib/marketCalendar.js");
const { default: pg } = await import("pg");

// ── Argumentos ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { since: "", scans: 7, sample: 10, json: false, max: { a3: 0, a4: 0, a6: 0, a11: 0 } };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--since") args.since = next();
    else if (a === "--scans") args.scans = Number(next());
    else if (a === "--sample") args.sample = Number(next());
    else if (a === "--json") args.json = true;
    else if (/^--max-a(3|4|6|11)$/.test(a)) args.max[a.slice(6)] = Number(next());
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Opción desconocida: ${a}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  args.today = today;
  if (!args.since) args.since = addDays(today, -548);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.since)) throw new Error(`--since inválido: ${args.since}`);
  return args;
}

function connectionConfig() {
  const url = process.env.STATSEDGE_HEALTH_DATABASE_URL;
  const common = { options: "-c default_transaction_read_only=on", application_name: "statsedge-data-health-check" };
  if (url) {
    let label = "(URL no parseable)";
    try {
      const u = new URL(url.replace(/^postgres(ql)?:/, "http:"));
      label = `${u.hostname}:${u.port || 5432}/${u.pathname.replace(/^\//, "")}`;
    } catch { /* etiqueta genérica */ }
    return { config: { connectionString: url, ...common }, label };
  }
  const host = process.env.STATSEDGE_HEALTH_PGHOST || "127.0.0.1";
  const port = Number(process.env.STATSEDGE_HEALTH_PGPORT || 55432);
  const database = process.env.STATSEDGE_HEALTH_PGDATABASE || "statsedge_local";
  const user = process.env.STATSEDGE_HEALTH_PGUSER || "postgres";
  return { config: { host, port, database, user, ...common }, label: `${host}:${port}/${database}` };
}

// ── Comprobaciones ───────────────────────────────────────────────────────

const US_EQUITY = "d.symbol !~ '[.^=]'";

async function latestUsScan(client) {
  const { rows } = await client.query(`
    select id, local_id, created_at from scans
    where local_id ~ '^materialized:US:' and deleted_at is null and row_count > 100
    order by created_at desc limit 1`);
  return rows[0] || null;
}

async function checkA3(client, args) {
  const scan = await latestUsScan(client);
  if (!scan) return { count: 0, note: "sin nocturno US materializado", sample: [] };
  const { rows } = await client.query(`
    with u as (select distinct symbol from scan_results where scan_id = $1),
    b as (
      select d.symbol, d.trade_date, d.close, d.volume,
             lag(d.close) over w pc, lead(d.close) over w nc,
             lag(d.volume) over w pv, lead(d.volume) over w nv
      from daily_bars d join u using (symbol)
      where d.trade_date >= $2::date
      window w as (partition by d.symbol order by d.trade_date))
    select symbol, trade_date::text as fecha, round(pc::numeric, 3) as previo, round(close::numeric, 3) as cierre,
           round(nc::numeric, 3) as siguiente, volume::bigint as volumen,
           (greatest(close / pc, pc / close) >= 5 and greatest(close / nc, nc / close) >= 5
             and volume >= 10 * greatest(pv, nv)) as guard_escala
    from b
    where pc > 0 and nc > 0 and close > 0
      and ((close / pc > 1.4 and nc / close < 0.7) or (close / pc < 0.6 and nc / close > 1.6))
    order by trade_date desc`, [scan.id, args.since]);
  return { count: rows.length, note: `nocturno ${scan.local_id}`, sample: rows };
}

async function checkA4(client, args) {
  const days = nyseNonTradingDays(args.since, args.today);
  const { rows } = await client.query(`
    select d.trade_date::text as fecha, count(*)::int as filas,
           string_agg(d.symbol, ',' order by d.symbol) as simbolos
    from daily_bars d
    where ${US_EQUITY} and d.trade_date = any($1::date[])
    group by 1 order by 1 desc`, [days]);
  const count = rows.reduce((s, r) => s + r.filas, 0);
  return { count, note: `${days.length} días sin sesión NYSE en la ventana`, sample: rows };
}

// Mercados de a6: los que el producto escanea (EE. UU., Hong Kong, Europa).
// La hora de asentamiento sale de MARKET_SESSIONS (cierre + margen), la misma
// fuente que usa lib/dailyBarsCache.js para no persistir la vela en curso.
const A6_MARKETS = [
  { key: "US", filter: "symbol !~ '[.^=]'" },
  { key: "HK", suffix: ".HK" },
  { key: "GB", suffix: ".L" },
  { key: "DE", suffix: ".DE" },
  { key: "FR", suffix: ".PA" },
  { key: "NL", suffix: ".AS" },
  { key: "ES", suffix: ".MC" },
  { key: "IT", suffix: ".MI" },
  { key: "CH", suffix: ".SW" },
  { key: "SE", suffix: ".ST" },
];

function settleTime(close) {
  const [h, m] = close.split(":").map(Number);
  const total = h * 60 + m + SESSION_SETTLE_BUFFER_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function checkA6(client, args) {
  const byMarket = [];
  for (const market of A6_MARKETS) {
    const session = MARKET_SESSIONS[market.key];
    const where = market.filter || `symbol like '%' || $4`;
    const params = [args.since, settleTime(session.close), session.tz];
    if (market.suffix) params.push(market.suffix);
    const { rows } = await client.query(`
      select trade_date::text as fecha, count(*)::int as filas,
             min(to_char(updated_at at time zone $3, 'HH24:MI')) as primera_hora_local,
             string_agg(symbol, ',' order by symbol) as simbolos
      from daily_bars
      where ${where} and trade_date >= $1::date
        and updated_at < ((trade_date::timestamp + $2::time) at time zone $3)
      group by 1 order by 1 desc`, params);
    const count = rows.reduce((s, r) => s + r.filas, 0);
    if (count) byMarket.push({ mercado: market.key, filas: count, porFecha: rows });
  }
  const count = byMarket.reduce((s, m) => s + m.filas, 0);
  return { count, note: `asentamiento = cierre + ${SESSION_SETTLE_BUFFER_MINUTES} min (lib/marketCalendar.js)`, sample: byMarket };
}

// Semana oficial de un nocturno: el nocturno de la madrugada del día D (hora
// de Madrid, fecha del local_id) trae la última sesión NYSE anterior a D. La
// etapa oficial se calcula sobre la última semana CERRADA: la de esa sesión
// si es la última de su semana; si no, la anterior.
function officialWeekForScan(localId = "") {
  const day = String(localId).split(":")[2] || "";
  const session = previousNyseSession(day);
  if (!session) return { session: "", week: "" };
  const monday = isoWeekMonday(session);
  return { session, week: isLastNyseSessionOfWeek(session) ? monday : addDays(monday, -7) };
}

async function checkA11(client, args) {
  const { rows: scans } = await client.query(`
    select id, local_id, created_at from scans
    where local_id ~ '^materialized:US:' and deleted_at is null and row_count > 100
    order by created_at desc limit $1`, [args.scans]);
  scans.reverse();
  const pairs = [];
  for (let i = 1; i < scans.length; i += 1) {
    const a = { ...scans[i - 1], ...officialWeekForScan(scans[i - 1].local_id) };
    const b = { ...scans[i], ...officialWeekForScan(scans[i].local_id) };
    if (!a.week || a.week !== b.week) continue;
    const { rows } = await client.query(`
      select count(*)::int as pares,
             count(*) filter (where ra.metrics->>'weeklyStageState' is distinct from rb.metrics->>'weeklyStageState')::int as cambian,
             count(*) filter (where ra.metrics->>'weeklyStageState' = 'stage2' and rb.metrics->>'weeklyStageState' is distinct from 'stage2')::int as salen_e2,
             count(*) filter (where ra.metrics->>'weeklyStageState' is distinct from 'stage2' and rb.metrics->>'weeklyStageState' = 'stage2')::int as entran_e2
      from scan_results ra join scan_results rb on rb.symbol = ra.symbol
      where ra.scan_id = $1 and rb.scan_id = $2`, [a.id, b.id]);
    pairs.push({ desde: a.local_id, hasta: b.local_id, semana_oficial: a.week, sesiones: `${a.session} → ${b.session}`, ...rows[0] });
  }
  const count = pairs.reduce((s, p) => s + p.cambian, 0);
  return { count, note: `${scans.length} nocturnos, ${pairs.length} pares con la misma semana oficial`, sample: pairs };
}

// ── Salida ───────────────────────────────────────────────────────────────

function table(rows, limit) {
  if (!rows.length) return "    (sin filas)";
  const shown = rows.slice(0, limit).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (s.length > 70) s = `${s.slice(0, 67)}…`;
    return [k, s];
  })));
  const cols = Object.keys(shown[0]);
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...shown.map((r) => r[c].length))]));
  const line = (r) => `    ${cols.map((c) => r[c].padEnd(width[c])).join("  ")}`;
  const out = [line(Object.fromEntries(cols.map((c) => [c, c]))), `    ${cols.map((c) => "-".repeat(width[c])).join("  ")}`, ...shown.map(line)];
  if (rows.length > limit) out.push(`    … y ${rows.length - limit} más`);
  return out.join("\n");
}

const TITLES = {
  a3: "a3  Picos de una barra (D5)",
  a4: "a4  Barras US en días sin sesión NYSE (D5)",
  a6: "a6  Barras guardadas antes del cierre + margen (D4)",
  a11: "a11 Parpadeo de la etapa oficial en la misma semana (D1)",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Uso: node scripts/ops/data-health-check.mjs [--since YYYY-MM-DD] [--scans N] [--max-a3 N …] [--json]");
    return 0;
  }
  const { config, label } = connectionConfig();
  const client = new pg.Client(config);
  await client.connect();
  const results = {};
  try {
    await client.query("BEGIN READ ONLY");
    results.a3 = await checkA3(client, args);
    results.a4 = await checkA4(client, args);
    results.a6 = await checkA6(client, args);
    results.a11 = await checkA11(client, args);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }

  const failed = Object.entries(results).filter(([key, r]) => r.count > args.max[key]).map(([key]) => key);
  if (args.json) {
    console.log(JSON.stringify({ base: label, desde: args.since, hoy: args.today, umbrales: args.max, fallan: failed, resultados: results }, null, 2));
    return failed.length ? 1 : 0;
  }

  console.log(`Chequeo de salud de datos · base ${label} · ventana ${args.since} → ${args.today} · solo lectura`);
  for (const [key, r] of Object.entries(results)) {
    const ok = r.count <= args.max[key];
    console.log(`\n[${ok ? "OK  " : "FALLA"}] ${TITLES[key]}: ${r.count} (umbral ${args.max[key]}) — ${r.note}`);
    if (key === "a6") {
      for (const m of r.sample) {
        console.log(`  ${m.mercado}: ${m.filas} filas`);
        console.log(table(m.porFecha, args.sample));
      }
    } else if (r.count || key === "a11") {
      console.log(table(r.sample, args.sample));
    }
  }
  console.log(`\nResultado: ${failed.length ? `FALLA (${failed.join(", ")})` : "OK"}`);
  return failed.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`data-health-check: error: ${error?.message || error}`);
    process.exit(2);
  });
