// ¿Cuánto cortarían las reglas candidatas C3 y C6 sobre el universo, sin usar
// etiquetas? Reproduce la carga del arnés v4-universo.mjs (barras >= 2025-09-01).
import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";

const uni = JSON.parse(await fs.readFile(new URL("../resultados/universo-v4.json", import.meta.url),"utf8"));
const marcados = uni.filter(x => x.base);
const cfg = supabaseConfig();
const LBS = [60,80,100,120,140,160,180,200];
const filas = [];
const LOTE = 10;
for (let i = 0; i < marcados.length; i += LOTE) {
  const lote = marcados.slice(i, i + LOTE);
  const rows = await supabaseRequestAll("daily_bars", {
    query: { select: "symbol,trade_date,high,low,close,adj_close,volume", owner_id: `eq.${cfg.ownerId}`,
             symbol: `in.(${lote.map(x=>x.sym).join(",")})`, trade_date: "gte.2025-09-01",
             order: "symbol.asc,trade_date.asc" }, timeoutMs: 45000 }, { maxRows: 40000 });
  const porSym = new Map();
  for (const r of rows) {
    const s = r.symbol; if (!porSym.has(s)) porSym.set(s, []);
    const c = Number(r.adj_close ?? r.close);
    if (c > 0) porSym.get(s).push({ d: String(r.trade_date).slice(0,10), h:+r.high, l:+r.low, c,
      v: r.volume===null?0:+r.volume });
  }
  for (const m of lote) {
    const bars = porSym.get(m.sym) ?? [];
    const r = detectV4(bars);
    if (!r.base) { filas.push({ sym: m.sym, err: "no reproduce" }); continue; }
    const [a,b] = r.fechas[0].split("→");
    const hi = bars.findIndex(x=>x.d===a), lo = bars.findIndex(x=>x.d===b);
    const prof = (bars[hi].h - bars[lo].l)/bars[hi].h*100;
    let peor = 0;
    for (let k = hi+1; k <= lo; k++) { const cae = (bars[k-1].c - bars[k].c)/bars[k-1].c*100; if (cae>peor) peor=cae; }
    const firmas = new Set();
    for (const lb of LBS) { const x = detectV4(bars, { lookback: lb }); if (x.base) firmas.add(x.fechas.join(",")); }
    filas.push({ sym: m.sym, contr: r.contracciones, t1barras: lo-hi, prof:+prof.toFixed(1),
      peor:+peor.toFixed(1), conc:+(peor/prof).toFixed(2), estr: firmas.size,
      red: r.contracciones.length>1 ? +(1 - r.contracciones[1]/r.contracciones[0]).toFixed(2) : null });
  }
}
const ok = filas.filter(f=>!f.err);
const c3 = ok.filter(f=>f.conc>0.35), c6 = ok.filter(f=>f.estr>=3), c4 = ok.filter(f=>f.red!==null && f.red<0.30);
console.log(`marcados por v4: ${marcados.length} · reproducidos aquí: ${ok.length}`);
console.log(`C3 (concentración > 0,35) quitaría ${c3.length} (${(c3.length/ok.length*100).toFixed(0)}%): ${c3.map(f=>f.sym).join(" ")}`);
console.log(`C4 (reducción < 30%)      quitaría ${c4.length} (${(c4.length/ok.length*100).toFixed(0)}%): ${c4.map(f=>f.sym).join(" ")}`);
console.log(`C6 (>=3 estructuras)      quitaría ${c6.length} (${(c6.length/ok.length*100).toFixed(0)}%): ${c6.map(f=>f.sym).join(" ")}`);
const u = new Set([...c3,...c6].map(f=>f.sym));
console.log(`C3+C6 juntas              quitarían ${u.size} (${(u.size/ok.length*100).toFixed(0)}%) → cobertura ${(ok.length-u.size)}/400 = ${((ok.length-u.size)/4).toFixed(1)}%`);
console.log("\ndistribución de la concentración del tramo 1 (los 37 marcados):");
const cs = ok.map(f=>f.conc).sort((a,b)=>a-b);
console.log("  " + cs.join(" "));
console.log(`  mediana ${cs[Math.floor(cs.length/2)]} · p25 ${cs[Math.floor(cs.length*0.25)]} · p75 ${cs[Math.floor(cs.length*0.75)]}`);
console.log("\nlos que C3 quita, con detalle:");
for (const f of c3) console.log(`  ${f.sym.padEnd(7)} [${f.contr.join(" → ")}] t1 ${f.t1barras}b prof ${f.prof}% peor barra ${f.peor}% = ${Math.round(f.conc*100)}%`);
