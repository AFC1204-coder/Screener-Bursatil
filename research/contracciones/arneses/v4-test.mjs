// Corre el detector v4 contra las nueve etiquetas manuales del dueño,
// con corte en la fecha en que cada base estaba viva (no el veredicto de hoy).
// Solo lee daily_bars.

import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";

// asOf = fecha en que la estructura estaba completa pero aún no resuelta.
const CASOS = [
  { sym: "ICE",   asOf: "2026-04-13", etiqueta: "BASE",  desenlace: "no disparó, −27%" },
  { sym: "GOOGL", asOf: "2026-04-24", etiqueta: "BASE",  desenlace: "+17,2%" },
  { sym: "PNC",   asOf: "2026-06-08", etiqueta: "BASE",  desenlace: "+17,6%" },
  { sym: "KO",    asOf: "2026-05-13", etiqueta: "BASE",  desenlace: "+5,9%" },
  { sym: "MPC",   asOf: "2026-06-02", etiqueta: "BASE",  desenlace: "+41%", nota: "ascendente" },
  { sym: "MPC",   asOf: "2026-03-30", etiqueta: "NO",    desenlace: "—", nota: "sierra" },
  { sym: "NDAQ",  asOf: "2025-12-17", etiqueta: "NO",    desenlace: "+7,8% y luego −24%" },
  { sym: "V",     asOf: "2026-07-24", etiqueta: "NO",    desenlace: "—" },
  { sym: "ORCL",  asOf: "2026-05-28", etiqueta: "NO",    desenlace: "rompió y −45%", nota: "contexto" },
];

const cfg = supabaseConfig();
const cache = new Map();

async function barsFor(sym) {
  if (cache.has(sym)) return cache.get(sym);
  const rows = await supabaseRequestAll("daily_bars", {
    query: {
      select: "trade_date,open,high,low,close,adj_close,volume",
      owner_id: `eq.${cfg.ownerId}`, symbol: `eq.${sym}`, order: "trade_date.asc",
    },
    timeoutMs: 20000,
  }, { maxRows: 420 });
  const bars = rows.map((r) => ({
    d: String(r.trade_date).slice(0, 10),
    o: Number(r.open), h: Number(r.high), l: Number(r.low),
    c: Number(r.adj_close ?? r.close), v: r.volume === null ? 0 : Number(r.volume),
  })).filter((b) => Number.isFinite(b.c) && b.c > 0);
  cache.set(sym, bars);
  return bars;
}

let aciertosEstructura = 0, aciertosProducto = 0;
const filas = [];

for (const caso of CASOS) {
  const all = await barsFor(caso.sym);
  const bars = all.filter((b) => b.d <= caso.asOf);
  const r = detectV4(bars);
  const nombre = caso.nota ? `${caso.sym} (${caso.nota})` : caso.sym;

  // ¿coincide con la etiqueta ESTRUCTURAL del dueño?
  const estructuraOk = (r.base && caso.etiqueta === "BASE") || (!r.base && caso.etiqueta === "NO");
  // ¿coincide con lo que el PRODUCTO debería enseñar? (base + funcionó)
  const deberiaMostrar = caso.etiqueta === "BASE" && !caso.desenlace.startsWith("no disparó");
  const productoOk = r.base === deberiaMostrar;
  if (estructuraOk) aciertosEstructura++;
  if (productoOk) aciertosProducto++;

  filas.push({ nombre, asOf: caso.asOf, etiqueta: caso.etiqueta, v4: r.base ? "BASE" : "NO",
    motivo: r.reason, estructuraOk, deberiaMostrar, productoOk, r, desenlace: caso.desenlace });
}

console.log("=".repeat(100));
console.log("DETECTOR v4 vs LAS NUEVE ETIQUETAS");
console.log("=".repeat(100));
for (const f of filas) {
  const marca = f.estructuraOk ? "OK " : "DIF";
  console.log(`\n[${marca}] ${f.nombre.padEnd(16)} corte ${f.asOf}   dueño=${f.etiqueta.padEnd(4)}  v4=${f.v4.padEnd(4)}  (${f.motivo})`);
  if (f.r.base) {
    console.log(`        contracciones ${f.r.contracciones.join(" → ")}  |  1ª=${f.r.primeraEnAtr}x ATR  |  desplaz=${f.r.dispRatio}  |  vol=${f.r.volRatio}  |  sma=${f.r.smaSlopePct}%`);
    console.log(`        ${f.r.fechas.join("   ")}`);
  } else {
    const d = [];
    if (f.r.smaSlopePct !== undefined) d.push(`sma=${f.r.smaSlopePct}%`);
    if (f.r.mejor !== undefined) d.push(`mejor contracción=${f.r.mejor}x ATR`);
    if (f.r.dispRatio !== undefined) d.push(`desplaz=${f.r.dispRatio}`);
    if (f.r.seq) d.push(`secuencia=${f.r.seq.join("→")} corta con ${f.r.corta}`);
    if (f.r.volRatio !== undefined) d.push(`vol=${f.r.volRatio}`);
    if (f.r.ultima !== undefined) d.push(`última=${f.r.ultima}x ATR`);
    if (f.r.ultimaLeg) d.push(`última=${f.r.ultimaLeg}`);
    if (d.length) console.log(`        ${d.join("  |  ")}`);
    if (f.r.legs) console.log(`        TRAMOS HALLADOS: ${f.r.legs.join("   ")}`);
  }
  console.log(`        desenlace real: ${f.desenlace}`);
}

console.log("\n" + "=".repeat(100));
console.log(`Coincidencia con la etiqueta ESTRUCTURAL del dueño: ${aciertosEstructura}/9`);
console.log(`Coincidencia con "¿debería mostrarlo el producto?":  ${aciertosProducto}/9`);
console.log("=".repeat(100));
