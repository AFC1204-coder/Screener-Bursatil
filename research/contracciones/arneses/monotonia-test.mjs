// v4 frente a v6 (monotonía relajada) sobre los 21 casos del corpus.
// Compara veredicto Y fechas: un cambio de estructura sin cambio de veredicto
// también cuenta, porque es lo que la medición del 21-ago señaló como el
// defecto que el marcador sí/no escondía. Solo lee daily_bars.

import fs from "node:fs";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";
import { detectV6 } from "../detector/v6.mjs";

const corpus = JSON.parse(fs.readFileSync(new URL("../corpus-manual.json", import.meta.url), "utf8"));
const cfg = supabaseConfig();

async function barsFor(sym) {
  const rows = await supabaseRequestAll("daily_bars", {
    query: { select: "trade_date,high,low,close,adj_close,volume", owner_id: `eq.${cfg.ownerId}`,
             symbol: `eq.${sym}`, order: "trade_date.asc" }, timeoutMs: 20000 }, { maxRows: 5000 });
  return rows.map((r) => ({ d: String(r.trade_date).slice(0, 10), h: +r.high, l: +r.low,
    c: +(r.adj_close ?? r.close), v: r.volume === null ? 0 : +r.volume })).filter((b) => b.c > 0);
}

const idxDe = (bars, f) => {
  if (!f) return null;
  let mejor = null;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].d.startsWith(String(f).slice(0, 10))) return i;
    if (bars[i].d < f) mejor = i;
  }
  return mejor;
};

// distancia del ancla y solape contra la etiqueta, igual que en medicion-corpus.mjs
function contraEtiqueta(bars, r, tramos) {
  if (!r.base || !r.fechas || !tramos?.length || !tramos[0].max) return null;
  const hi0 = bars.findIndex((x) => x.d === r.fechas[0].split("→")[0]);
  const lo1 = bars.findIndex((x) => x.d === r.fechas.at(-1).split("→")[1]);
  const b0 = idxDe(bars, tramos[0].max), b1 = idxDe(bars, tramos.at(-1).min);
  if (hi0 < 0 || lo1 < 0 || b0 === null || b1 === null) return null;
  const inter = Math.max(0, Math.min(lo1, b1) - Math.max(hi0, b0));
  const union = Math.max(lo1, b1) - Math.min(hi0, b0);
  return { ancla: hi0 - b0, solape: union > 0 ? +(inter / union).toFixed(2) : null, nDet: r.fechas.length, nEt: tramos.length };
}

const filas = [];
for (const c of corpus.casos) {
  const bars = (await barsFor(c.symbol)).filter((b) => b.d <= c.asOf);
  const r4 = detectV4(bars), r6 = detectV6(bars);
  const ok = (r) => (r.base && c.veredicto === "BASE") || (!r.base && c.veredicto === "NO");
  filas.push({ id: c.id, et: c.veredicto, r4, r6, ok4: ok(r4), ok6: ok(r6),
    cmp4: contraEtiqueta(bars, r4, c.tramos), cmp6: contraEtiqueta(bars, r6, c.tramos),
    mismasFechas: JSON.stringify(r4.fechas ?? null) === JSON.stringify(r6.fechas ?? null),
    mismoMotivo: r4.reason === r6.reason });
}

const pad = (s, n) => String(s ?? "").padEnd(n);
const est = (r) => r.base ? `[${r.contracciones.join(" → ")}]` : `(${r.reason})`;

console.log("### v4 FRENTE A v6, CASO POR CASO ###\n");
console.log(pad("caso", 20) + pad("dueño", 6) + pad("v4", 6) + pad("v6", 6) + "qué cambia");
for (const f of filas) {
  const marca = f.ok4 !== f.ok6 ? (f.ok6 ? "MEJORA" : "EMPEORA")
    : !f.mismasFechas ? "≠ FECHAS" : !f.mismoMotivo ? `≠ motivo: ${f.r4.reason} → ${f.r6.reason}` : "=";
  console.log(pad(f.id, 20) + pad(f.et, 6) + pad(f.r4.base ? "BASE" : "no", 6)
    + pad(f.r6.base ? "BASE" : "no", 6) + marca);
}

const a4 = filas.filter((f) => f.ok4).length, a6 = filas.filter((f) => f.ok6).length;
console.log(`\nv4: ${a4}/21 · ${filas.filter(f=>f.r4.base&&f.et==="NO").length} FP · ${filas.filter(f=>!f.r4.base&&f.et==="BASE").length} FN`);
console.log(`v6: ${a6}/21 · ${filas.filter(f=>f.r6.base&&f.et==="NO").length} FP · ${filas.filter(f=>!f.r6.base&&f.et==="BASE").length} FN`);

console.log("\n### DETALLE DE TODO LO QUE CAMBIA ###");
for (const f of filas) {
  if (f.ok4 === f.ok6 && f.mismasFechas && f.mismoMotivo) continue;
  console.log(`\n${f.id}  (dueño: ${f.et})`);
  console.log(`  v4: ${pad(f.r4.base ? "BASE" : "no", 5)} ${est(f.r4)}  ${f.r4.fechas ? f.r4.fechas.join("  ") : (f.r4.seq ? `seq=[${f.r4.seq}] corta=${f.r4.corta}` : "")}`);
  console.log(`  v6: ${pad(f.r6.base ? "BASE" : "no", 5)} ${est(f.r6)}  ${f.r6.fechas ? f.r6.fechas.join("  ") : (f.r6.seq ? `seq=[${f.r6.seq}] ultima=${f.r6.ultima} masSuperficial=${f.r6.masSuperficial}` : "")}`);
  if (f.r6.base && f.r6.repunteIntermedio) console.log(`      ↑ tiene repunte intermedio${f.r6.repuntaSobreElAncla ? " Y un tramo MÁS PROFUNDO QUE EL ANCLA" : ""}`);
  if (f.cmp4) console.log(`  contra la etiqueta, v4: ancla ${f.cmp4.ancla >= 0 ? "+" : ""}${f.cmp4.ancla} ses, solape ${f.cmp4.solape}, n ${f.cmp4.nDet} vs ${f.cmp4.nEt}`);
  if (f.cmp6) console.log(`  contra la etiqueta, v6: ancla ${f.cmp6.ancla >= 0 ? "+" : ""}${f.cmp6.ancla} ses, solape ${f.cmp6.solape}, n ${f.cmp6.nDet} vs ${f.cmp6.nEt}`);
}

console.log("\n### REPUNTES INTERMEDIOS ACEPTADOS POR v6 ###");
for (const f of filas) {
  if (!f.r6.base) continue;
  if (f.r6.repunteIntermedio) console.log(`  ${pad(f.id, 20)} ${pad(f.et, 5)} [${f.r6.contracciones.join(" → ")}]${f.r6.repuntaSobreElAncla ? "  ← supera el ancla" : ""}`);
}
