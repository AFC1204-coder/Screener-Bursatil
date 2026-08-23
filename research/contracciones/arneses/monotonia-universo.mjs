// ¿Cuántos falsos positivos nuevos añade la monotonía relajada?
// Corre v4 y v6 sobre la MISMA muestra de 400 (semilla 'seed2026') y con la
// misma carga de barras que `v4-universo.mjs`, para que la comparación sea
// limpia. Solo lee daily_bars.

import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";
import { detectV6 } from "../detector/v6.mjs";

const SIMBOLOS = (await fs.readFile(new URL("../resultados/muestra400.txt", import.meta.url), "utf8"))
  .trim().split(",").map((s) => s.trim()).filter(Boolean);
const cfg = supabaseConfig();
const LOTE = 25;
const res = [];

for (let i = 0; i < SIMBOLOS.length; i += LOTE) {
  const lote = SIMBOLOS.slice(i, i + LOTE);
  let rows;
  try {
    rows = await supabaseRequestAll("daily_bars", {
      query: { select: "symbol,trade_date,open,high,low,close,adj_close,volume",
               owner_id: `eq.${cfg.ownerId}`, symbol: `in.(${lote.join(",")})`,
               trade_date: "gte.2025-09-01", order: "symbol.asc,trade_date.asc" },
      timeoutMs: 45000 }, { maxRows: 40000 });
  } catch (e) { console.error(`lote ${i}: ${e.message}`); continue; }
  const porSimbolo = new Map();
  for (const r of rows) {
    const c = Number(r.adj_close ?? r.close);
    if (!Number.isFinite(c) || c <= 0) continue;
    if (!porSimbolo.has(r.symbol)) porSimbolo.set(r.symbol, []);
    porSimbolo.get(r.symbol).push({ d: String(r.trade_date).slice(0, 10), o: +r.open,
      h: +r.high, l: +r.low, c, v: r.volume === null ? 0 : +r.volume });
  }
  for (const [sym, bars] of porSimbolo) {
    const a = detectV4(bars), b = detectV6(bars);
    const w = detectV6(bars, { topeRepunteEnAncla: true });   // variante medida
    res.push({ sym, v4: a.base, m4: a.reason, v6: b.base, m6: b.reason, vAncla: w.base, mAncla: w.reason,
      c4: a.contracciones ?? null, c6: b.contracciones ?? null,
      f4: a.fechas ?? null, f6: b.fechas ?? null,
      repunte: b.repunteIntermedio ?? false, sobreAncla: b.repuntaSobreElAncla ?? false,
      primeraEnAtr: b.primeraEnAtr ?? a.primeraEnAtr ?? null });
  }
  process.stderr.write(".");
}
process.stderr.write("\n");
await fs.writeFile(new URL("../resultados/monotonia-universo.json", import.meta.url), JSON.stringify(res, null, 1));

const n = res.length;
const b4 = res.filter((r) => r.v4), b6 = res.filter((r) => r.v6);
const nuevos = res.filter((r) => !r.v4 && r.v6);
const perdidos = res.filter((r) => r.v4 && !r.v6);
const cambianFechas = res.filter((r) => r.v4 && r.v6 && JSON.stringify(r.f4) !== JSON.stringify(r.f6));
const pad = (s, x) => String(s ?? "").padEnd(x);

console.log(`Evaluados: ${n} de ${SIMBOLOS.length}`);
console.log(`v4 marca ${b4.length} (${(100*b4.length/n).toFixed(1)}%) · v6 marca ${b6.length} (${(100*b6.length/n).toFixed(1)}%)`);
console.log(`\nNUEVOS con v6: ${nuevos.length}   ·   PERDIDOS: ${perdidos.length}   ·   misma base con otras fechas: ${cambianFechas.length}`);

console.log("\n### LOS NUEVOS (los que v4 rechazaba por reexpansión y v6 acepta) ###");
for (const r of nuevos) {
  console.log(`  ${pad(r.sym,7)} v4=${pad(r.m4,26)} → [${r.c6.join(" → ")}]  1ª=${r.primeraEnAtr}x` +
    `${r.repunte ? "  repunte" : ""}${r.sobreAncla ? " SOBRE EL ANCLA" : ""}`);
  console.log(`          ${r.f6.join("  ")}`);
}
if (perdidos.length) {
  console.log("\n### LOS PERDIDOS ###");
  for (const r of perdidos) console.log(`  ${pad(r.sym,7)} v4=[${r.c4.join(" → ")}] → v6=${r.m6}`);
}
if (cambianFechas.length) {
  console.log("\n### MISMA DECISIÓN, OTRA ESTRUCTURA ###");
  for (const r of cambianFechas) {
    console.log(`  ${pad(r.sym,7)} v4 [${r.c4.join(" → ")}]  ${r.f4.join(" ")}`);
    console.log(`  ${pad("",7)} v6 [${r.c6.join(" → ")}]  ${r.f6.join(" ")}`);
  }
}
const bA = res.filter((r) => r.vAncla);
console.log(`\n### VARIANTE MEDIDA: acotar el repunte al ancla ###`);
console.log(`  marca ${bA.length} (${(100*bA.length/n).toFixed(1)}%) — quita ${b6.length - bA.length} de los ${b6.length} de v6`);
console.log(`  los que quita: ${res.filter((r) => r.v6 && !r.vAncla).map((r) => r.sym).join(" ")}`);
console.log(`  de ellos, ya los marcaba v4: ${res.filter((r) => r.v6 && !r.vAncla && r.v4).map((r) => r.sym).join(" ") || "ninguno"}`);

const m4 = {}, m6 = {};
for (const r of res) { m4[r.m4] = (m4[r.m4]||0)+1; m6[r.m6] = (m6[r.m6]||0)+1; }
console.log("\n### MOTIVOS, ANTES Y DESPUÉS ###");
const claves = [...new Set([...Object.keys(m4), ...Object.keys(m6)])].sort((a,b)=>(m6[b]??0)-(m6[a]??0));
console.log(pad("motivo",34) + pad("v4",6) + "v6");
for (const k of claves) console.log(pad(k,34) + pad(m4[k] ?? 0,6) + (m6[k] ?? 0));
console.log("\n### REPUNTES ACEPTADOS POR v6 (los que la regla vieja habría matado) ###");
for (const r of b6.filter((x) => x.repunte)) {
  console.log(`  ${pad(r.sym,7)} [${r.c6.join(" → ")}]${r.sobreAncla ? "  ← un tramo supera al ancla" : ""}  ${r.v4 ? "(v4 ya lo marcaba)" : "(NUEVO)"}`);
}
