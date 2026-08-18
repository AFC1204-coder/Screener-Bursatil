// Script temporal de verificación: lee los datos de daily_bars / scan_results
// directamente vía PostgREST para confirmar las cifras de referencia.
// No escribe nada.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  let text = "";
  try { text = readFileSync(envPath, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith("#")) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2];
  }
}

loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const owner = process.env.STATSEDGE_OWNER_ID || "personal";
if (!url || !key) {
  console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function query(path, qs = "") {
  const u = `${url}/rest/v1/${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(u, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return res.json();
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "volume") {
  // SPY reciente — verifica el efecto de las barras mensuales
  const symbol = args[1] || "SPY";
  const rows = await query("daily_bars", `owner_id=eq.${owner}&symbol=eq.${symbol}&select=trade_date,close,volume&order=trade_date.desc&limit=20`);
  const recent = rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  console.log(`Últimas 20 barras de ${symbol}:`);
  for (const r of recent) {
    const isFirst = r.trade_date.endsWith("-01") || r.trade_date.endsWith("-02");
    console.log(`  ${r.trade_date}  close=${r.close}  vol=${r.volume}${isFirst ? "  [día 1/2 — candidato barra mensual]" : ""}`);
  }
  // Volumen medio 20 d
  const vols = recent.map((r) => Number(r.volume)).filter((v) => Number.isFinite(v));
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  console.log(`Volumen medio 20d: ${avg.toFixed(0)}`);
  // Últimas 20 incluyendo filtro de mensuales
  const filtered = recent.filter((r) => {
    if (!r.trade_date.endsWith("-01")) return true;
    const median = vols.slice(0, 19).sort((a, b) => a - b)[Math.floor(19 / 2)];
    return Number(r.volume) <= median * 4;
  });
  const avgF = filtered.map((r) => Number(r.volume)).filter((v) => Number.isFinite(v));
  const avgFilt = avgF.reduce((a, b) => a + b, 0) / avgF.length;
  console.log(`Volumen medio 20d (filtrado mensuales): ${avgFilt.toFixed(0)}`);
}

if (cmd === "breadth") {
  // Universo del escaneo nocturno
  const scan = await query("scans", `owner_id=eq.${owner}&local_id=like.materialized:US:*&select=id,local_id,created_at,row_count,preset&order=created_at.desc&limit=1`);
  const s = scan[0];
  console.log(`Último scan: ${s.id} local_id=${s.local_id} created=${s.created_at} rows=${s.row_count} preset=${s.preset}`);
  const coverage = await query(
    "scan_results",
    `owner_id=eq.${owner}&scan_id=eq.${s.id}&select=count&limit=1`,
  );
  console.log(`Filas en scan_results: ${coverage?.length || 0}`);
  // Eliminarlo para mayor claridad
  const total = await query("scan_results", `owner_id=eq.${owner}&scan_id=eq.${s.id}&select=metrics->upDownVolRatio&limit=1`);
  console.log("Sample:", JSON.stringify(total[0], null, 2));
}

if (cmd === "breadth-fields") {
  const scan = await query("scans", `owner_id=eq.${owner}&local_id=like.materialized:US:*&select=id&order=created_at.desc&limit=1`);
  const s = scan[0];
  const fields = ["upDownVolRatio", "relativeVolume", "volumeSurgePct", "volumeDryUpRatio", "avgVolume", "latestVolume"];
  for (const f of fields) {
    const total = await query("scan_results", `owner_id=eq.${owner}&scan_id=eq.${s.id}&select=metrics->${f}&limit=1`);
    const present = await query("scan_results", `owner_id=eq.${owner}&scan_id=eq.${s.id}&select=count&metrics->>${f}=not.is.null&limit=1`);
    const missing = await query("scan_results", `owner_id=eq.${owner}&scan_id=eq.${s.id}&select=count&metrics->>${f}=is.null&limit=1`);
    console.log(`metrics->${f}  present=${present[0]?.count || 0}  missing=${missing[0]?.count || 0}  sample=${JSON.stringify(total[0])}`);
  }
}

if (cmd === "daily_bars") {
  const total = await query("daily_bars", `owner_id=eq.${owner}&select=count&limit=1`);
  console.log("Total daily_bars:", total[0]?.count || 0);
  const symbols = await query("daily_bars", `owner_id=eq.${owner}&trade_date=eq.2026-08-14&select=count&limit=1`);
  console.log("Barras del 2026-08-14:", symbols[0]?.count || 0);
  const bars = await query("daily_bars", `owner_id=eq.${owner}&trade_date=eq.2026-08-01&select=symbol,trade_date,close,volume&limit=25`);
  console.log("Barras del 2026-08-01:", bars.length);
  for (const r of bars) console.log(`  ${r.symbol}  ${r.trade_date}  close=${r.close}  vol=${r.volume}`);
}
