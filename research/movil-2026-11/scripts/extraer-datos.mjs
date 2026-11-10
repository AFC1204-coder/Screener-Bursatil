// Extrae datos reales de ejemplo para el prototipo (solo lecturas).
// Uso: node extraer-datos.mjs <scans.json> <orden.json|-> <salida data.js>
//  - scans.json: respuesta de GET /api/scans?includeRows=1&anchor=nightly-us&hydrateRs=1 (dev :3320, base local)
//  - orden.json: lista de símbolos en el orden que pinta la lista móvil real (o "-")
//  - Barras y RS: SELECT contra la Postgres local 127.0.0.1:55432/statsedge_local
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [scansPath, ordenPath, outPath] = process.argv.slice(2);
const j = JSON.parse(readFileSync(scansPath, "utf8"));
const rows = j.scans[0].rows;
const bySym = new Map(rows.map((r) => [r.symbol, r]));
let order = ordenPath !== "-" ? JSON.parse(readFileSync(ordenPath, "utf8")) : rows.filter((r) => r.weeklyStageState === "stage2").sort((a, b) => (b.perf3m || 0) - (a.perf3m || 0)).map((r) => r.symbol);
order = order.filter((s) => bySym.has(s)).slice(0, 40);
const extra = ["AAPL", "ANF", "AVTR", "WPP", "CBLL"]; // filas con RS y VCP para vistas alternativas
const syms = [...new Set([...order, ...extra])];
const psql = (sql) => execFileSync("psql", ["-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "-d", "statsedge_local", "-At", "-F", "\t", "-c", sql], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || "postgres" }, maxBuffer: 64 << 20 }).toString().trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
const list = syms.map((s) => `'${s.replace(/'/g, "")}'`).join(",");
// Cierre semanal (último cierre de cada semana ISO) de las últimas 52 semanas.
const weekly = psql(`select symbol, to_char(date_trunc('week', trade_date),'YYYY-MM-DD') wk, (array_agg(close order by trade_date desc))[1] from daily_bars where symbol in (${list}) and trade_date > date '2025-10-01' and trade_date <= date '2026-10-18' and extract(isodow from trade_date) between 1 and 5 group by 1,2 order by 1,2`);
const spark = {};
for (const [s, , c] of weekly) (spark[s] ||= []).push(+(+c).toFixed(2));
for (const s of Object.keys(spark)) spark[s] = spark[s].slice(-52);
const fp = (r) => { const d = [r.contraction1DepthPct, r.contraction2DepthPct, r.contraction3DepthPct].map(Number).filter(Number.isFinite); return d.length ? { txt: `${Math.round(d[0])}/${Math.round(d[d.length - 1])} ${d.length}T`, ts: d.map((x) => Math.round(x)) } : null; };
const pick = (r) => ({
  s: r.symbol, n: r.companyName, c: r.country, t: r.theme || r.sector || "", ind: r.industry || "",
  rs: Number.isFinite(r.weeklyRsRating) ? r.weeklyRsRating : null, rsWk: r.weeklyRsWeekKey || null, rsAsOf: r.weeklyRsAsOf || null, rsReason: r.weeklyRsReason || "",
  st: (String(r.weeklyStageState || "").match(/stage(\d)/) || [])[1] || null, stw: r.weeklyStageWeek ?? null, stc: r.weeklyStageConfirmation || "", sts: r.weeklyStageStructureLabel || "",
  vcp: fp(r), d52: r.distance52w ?? null, p3: r.perf3m ?? null, mc: r.marketCap ?? null, px: r.price ?? null, ld: r.lastDate || null,
  spark: spark[r.symbol] || [],
});
const lista = order.map((s) => pick(bySym.get(s)));
const extras = extra.filter((s) => bySym.has(s)).map((s) => pick(bySym.get(s)));
// Ficha: MRNA (RS 99, Etapa 2) — barras diarias de 1 año + RS del motor fijado.
const FICHA = "MRNA";
const bars = psql(`select to_char(trade_date,'YYYY-MM-DD'), open, high, low, close, volume from daily_bars where symbol='${FICHA}' and trade_date > date '2025-10-15' and trade_date <= date '2026-10-18' and extract(isodow from trade_date) between 1 and 5 order by trade_date`).map(([d, o, h, l, c, v]) => [d, +(+o).toFixed(2), +(+h).toFixed(2), +(+l).toFixed(2), +(+c).toFixed(2), +v]);
const rsPinned = psql(`select to_char(snapshot_date,'YYYY-MM-DD'), rs_rating from rs_weekly_items where symbol='${FICHA}' and engine_version='statsedge-private-global-rs-usd-v1' order by snapshot_date`).map(([d, v]) => [d, +v]);
// Conteos de las vistas (resumen del nocturno US 18-oct): por etapa, total.
const counts = { total: rows.length, stage2: rows.filter((r) => r.weeklyStageState === "stage2").length, cercaMax: rows.filter((r) => r.weeklyStageState === "stage2" && r.distance52w > -5).length };
const meta = { nightly: j.nightly, rsAsOf: rows.find((r) => r.weeklyRsAsOf)?.weeklyRsAsOf, lastDates: rows.reduce((m, r) => { m[r.lastDate] = (m[r.lastDate] || 0) + 1; return m; }, {}) };
const data = { meta, counts, lista, extras, ficha: { ...pick(bySym.get(FICHA)), bars, rsPinned } };
writeFileSync(outPath, `// Generado por scripts/extraer-datos.mjs — datos reales de la base local (nocturno US 18-oct-2026)\nwindow.SE_DATA = ${JSON.stringify(data)};\n`);
console.log("filas", lista.length, "con spark", lista.filter((r) => r.spark.length > 10).length, "barras ficha", bars.length, "rs fijado", rsPinned.length, counts);
