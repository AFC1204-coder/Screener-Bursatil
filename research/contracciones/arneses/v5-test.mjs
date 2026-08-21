// Mide v4 y v5 contra los 21 casos etiquetados a mano (tandas 1 y 2).
// v5 = v4 + zona de salida de v3 (parámetros calibrados sobre 88.000 eventos,
// no sobre estos 21). Solo lee daily_bars.

import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";
import { detectV5 } from "../detector/v5.mjs";

// TANDA 1 — nueve etiquetas con fechas completas
// TANDA 2 — doce a ciegas; los "sí" del dueño en su lectura
const CASOS = [
  // --- tanda 1 ---
  { sym: "ICE",   asOf: "2026-04-13", et: "BASE", t: 1, nota: "no disparó, −27%" },
  { sym: "GOOGL", asOf: "2026-04-24", et: "BASE", t: 1, nota: "+17,2%" },
  { sym: "PNC",   asOf: "2026-06-08", et: "BASE", t: 1, nota: "+17,6%" },
  { sym: "KO",    asOf: "2026-05-13", et: "BASE", t: 1, nota: "+5,9%" },
  { sym: "MPC",   asOf: "2026-06-02", et: "BASE", t: 1, nota: "ascendente, +41%" },
  { sym: "MPC",   asOf: "2026-03-30", et: "NO",   t: 1, nota: "sierra" },
  { sym: "NDAQ",  asOf: "2025-12-17", et: "NO",   t: 1, nota: "superficial" },
  { sym: "V",     asOf: "2026-07-24", et: "NO",   t: 1, nota: "sin contracción suficiente" },
  { sym: "ORCL",  asOf: "2026-05-28", et: "NO",   t: 1, nota: "contexto etapa 4" },
  // --- tanda 2 (ciega) ---
  { sym: "AMT",   asOf: "2026-08-19", et: "NO",   t: 2, nota: "lateral perpetuo" },
  { sym: "BEKE",  asOf: "2026-08-19", et: "NO",   t: 2, nota: "pequeño dentro de algo mayor" },
  { sym: "CPT",   asOf: "2026-08-19", et: "NO",   t: 2, nota: "intentos sin nada claro" },
  { sym: "DECK",  asOf: "2026-08-19", et: "BASE", t: 2, nota: "intento débil, fracasó" },
  { sym: "ELV",   asOf: "2026-08-19", et: "NO",   t: 2, nota: "ruidoso" },
  { sym: "FCX",   asOf: "2026-08-19", et: "BASE", t: 2, nota: "4-5 contracciones" },
  { sym: "FLG",   asOf: "2026-08-19", et: "BASE", t: 2, nota: "dos bases" },
  { sym: "IP",    asOf: "2026-08-19", et: "BASE", t: 2, nota: "taza con asa / cheat" },
  { sym: "MSGS",  asOf: "2026-08-19", et: "NO",   t: 2, nota: "poca profundidad, errático" },
  { sym: "NDSN",  asOf: "2026-08-19", et: "BASE", t: 2, nota: "con reconfiguración" },
  { sym: "QRVO",  asOf: "2026-08-19", et: "BASE", t: 2, nota: "posible cheat" },
  { sym: "VPG",   asOf: "2026-08-19", et: "NO",   t: 2, nota: "solo tendencias" },
];

const cfg = supabaseConfig();
const cache = new Map();
async function barsFor(sym) {
  if (cache.has(sym)) return cache.get(sym);
  const rows = await supabaseRequestAll("daily_bars", {
    query: { select: "trade_date,open,high,low,close,adj_close,volume",
             owner_id: `eq.${cfg.ownerId}`, symbol: `eq.${sym}`, order: "trade_date.asc" },
    timeoutMs: 20000 }, { maxRows: 420 });
  const bars = rows.map((r) => ({
    d: String(r.trade_date).slice(0, 10), o: Number(r.open), h: Number(r.high),
    l: Number(r.low), c: Number(r.adj_close ?? r.close),
    v: r.volume === null ? 0 : Number(r.volume),
  })).filter((b) => Number.isFinite(b.c) && b.c > 0);
  cache.set(sym, bars);
  return bars;
}

const filas = [];
for (const c of CASOS) {
  const bars = (await barsFor(c.sym)).filter((b) => b.d <= c.asOf);
  const r4 = detectV4(bars), r5 = detectV5(bars);
  filas.push({ ...c, r4, r5,
    ok4: (r4.base && c.et === "BASE") || (!r4.base && c.et === "NO"),
    ok5: (r5.base && c.et === "BASE") || (!r5.base && c.et === "NO") });
}

const pad = (s, n) => String(s).padEnd(n);
console.log("=".repeat(104));
console.log(pad("CASO", 16) + pad("DUEÑO", 6) + pad("v4", 6) + pad("v5", 6) + pad("MOTIVO v5", 26) + "NOTA");
console.log("=".repeat(104));
for (const f of filas) {
  const marca = f.ok4 === f.ok5 ? (f.ok5 ? "  " : "xx") : (f.ok5 ? "->" : "<-");
  console.log(marca + " " + pad(`${f.sym}${f.t === 1 ? "" : "*"}`, 13) + pad(f.et, 6)
    + pad(f.r4.base ? "BASE" : "no", 6) + pad(f.r5.base ? "BASE" : "no", 6)
    + pad(f.r5.reason, 26) + f.nota);
}
const n = filas.length;
const a4 = filas.filter((f) => f.ok4).length, a5 = filas.filter((f) => f.ok5).length;
const fp4 = filas.filter((f) => f.r4.base && f.et === "NO").length;
const fp5 = filas.filter((f) => f.r5.base && f.et === "NO").length;
const fn4 = filas.filter((f) => !f.r4.base && f.et === "BASE").length;
const fn5 = filas.filter((f) => !f.r5.base && f.et === "BASE").length;
console.log("=".repeat(104));
console.log(`v4: ${a4}/${n} aciertos · ${fp4} falsos positivos · ${fn4} falsos negativos`);
console.log(`v5: ${a5}/${n} aciertos · ${fp5} falsos positivos · ${fn5} falsos negativos`);
const cambia = filas.filter((f) => f.r4.base !== f.r5.base);
console.log(`\nCambian de veredicto con la zona de salida: ${cambia.length}`);
for (const f of cambia) {
  console.log(`  ${pad(f.sym, 7)} v4=${f.r4.base ? "BASE" : "no"} -> v5=${f.r5.base ? "BASE" : "no"}  (${f.r5.reason})` +
    (f.r5.salida ? `  salida ${f.r5.salida}` : "") + `   [dueño: ${f.et}]`);
}
