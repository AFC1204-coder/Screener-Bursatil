// ¿Cuánta fractalidad hay? Corre el detector sobre la misma muestra de 400
// valores con cuatro ventanas de observación distintas y mide en cuántos
// aparece base a MÁS DE UNA escala, y si las estructuras son la misma o no.
import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";

const SIM = (await fs.readFile(new URL("../resultados/muestra400.txt", import.meta.url),"utf8"))
  .trim().split(",").map(s=>s.trim()).filter(Boolean);
const VENTANAS = [60, 100, 140, 200];   // sesiones de observación
const cfg = supabaseConfig();
const out = [];
for (let i=0;i<SIM.length;i+=25){
  const lote = SIM.slice(i,i+25);
  let rows;
  try { rows = await supabaseRequestAll("daily_bars",{query:{
      select:"symbol,trade_date,open,high,low,close,adj_close,volume",
      owner_id:`eq.${cfg.ownerId}`, symbol:`in.(${lote.join(",")})`,
      trade_date:"gte.2025-09-01", order:"symbol.asc,trade_date.asc"},timeoutMs:45000},{maxRows:40000});
  } catch(e){ continue; }
  const byS=new Map();
  for(const r of rows){ const c=Number(r.adj_close??r.close); if(!Number.isFinite(c)||c<=0) continue;
    if(!byS.has(r.symbol)) byS.set(r.symbol,[]);
    byS.get(r.symbol).push({d:String(r.trade_date).slice(0,10),o:+r.open,h:+r.high,l:+r.low,c,
      v:r.volume===null?0:+r.volume}); }
  for(const [sym,bars] of byS){
    const res={};
    for(const w of VENTANAS){ const r=detectV4(bars,{lookback:w});
      res[w]= r.base ? { seq:r.contracciones, fechas:r.fechas, prof:r.contracciones[0] } : null; }
    out.push({sym,res});
  }
  process.stderr.write(".");
}
process.stderr.write("\n");
await fs.writeFile(new URL("../resultados/fractal.json", import.meta.url), JSON.stringify(out,null,1));

const n=out.length;
const conBase = out.filter(o=>VENTANAS.some(w=>o.res[w]));
const cuantas = (o)=>VENTANAS.filter(w=>o.res[w]).length;
console.log(`\nEvaluados: ${n}`);
console.log(`Con base en AL MENOS una ventana: ${conBase.length} (${(100*conBase.length/n).toFixed(1)}%)`);
for(const k of [1,2,3,4]){
  const c=out.filter(o=>cuantas(o)===k).length;
  console.log(`  base en exactamente ${k} ventana(s): ${c}`);
}
// ¿las estructuras coinciden entre ventanas?
let mismas=0, distintas=0;
for(const o of conBase.filter(o=>cuantas(o)>=2)){
  const ws=VENTANAS.filter(w=>o.res[w]);
  const firmas=new Set(ws.map(w=>o.res[w].fechas.join("|")));
  if(firmas.size===1) mismas++; else distintas++;
}
console.log(`\nDe los que dan base en 2+ ventanas:`);
console.log(`  MISMA estructura en todas: ${mismas}`);
console.log(`  estructuras DISTINTAS según la ventana: ${distintas}`);
// reparto de profundidad de la primera contracción por ventana
console.log(`\nProfundidad de la 1ª contracción, por ventana:`);
for(const w of VENTANAS){
  const ps=out.map(o=>o.res[w]?.prof).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!ps.length){ console.log(`  ${w} sesiones: sin datos`); continue; }
  const med=ps[Math.floor(ps.length/2)];
  console.log(`  ${String(w).padStart(3)} sesiones: ${String(ps.length).padStart(3)} bases · mediana ${med.toFixed(1)}% · rango ${ps[0].toFixed(1)}-${ps.at(-1).toFixed(1)}%`);
}
// ejemplos de anidamiento
console.log(`\nEjemplos con estructuras distintas según la ventana:`);
let e=0;
for(const o of conBase.filter(o=>cuantas(o)>=2)){
  const ws=VENTANAS.filter(w=>o.res[w]);
  if(new Set(ws.map(w=>o.res[w].fechas.join("|"))).size===1) continue;
  console.log(`  ${o.sym}`);
  for(const w of ws) console.log(`      ${String(w).padStart(3)} ses: [${o.res[w].seq.join(" → ")}]  ${o.res[w].fechas[0]} …`);
  if(++e>=6) break;
}
