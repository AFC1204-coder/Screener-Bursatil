// Test de fractalidad DE VERDAD: escala TODOS los parámetros de duración y
// profundidad a la vez, no solo la ventana de observación.
import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";

const ESCALAS = {
  corta:  { lookback: 60,  maxLegBars: 15, pivotRadius: 2, firstContractionMinAtr: 2.0, lastContractionMaxAtr: 1.5 },
  media:  { lookback: 140, maxLegBars: 45, pivotRadius: 3, firstContractionMinAtr: 3.5, lastContractionMaxAtr: 3.0 },
  larga:  { lookback: 250, maxLegBars: 90, pivotRadius: 5, firstContractionMinAtr: 5.0, lastContractionMaxAtr: 4.5 },
};
const SIM = (await fs.readFile(new URL("../resultados/muestra400.txt", import.meta.url),"utf8"))
  .trim().split(",").map(s=>s.trim()).filter(Boolean);
const cfg = supabaseConfig(); const out=[];
for (let i=0;i<SIM.length;i+=25){
  const lote=SIM.slice(i,i+25); let rows;
  try{ rows=await supabaseRequestAll("daily_bars",{query:{
    select:"symbol,trade_date,open,high,low,close,adj_close,volume",owner_id:`eq.${cfg.ownerId}`,
    symbol:`in.(${lote.join(",")})`,trade_date:"gte.2025-06-01",order:"symbol.asc,trade_date.asc"},
    timeoutMs:45000},{maxRows:40000}); }catch(e){ continue; }
  const byS=new Map();
  for(const r of rows){ const c=Number(r.adj_close??r.close); if(!Number.isFinite(c)||c<=0)continue;
    if(!byS.has(r.symbol))byS.set(r.symbol,[]);
    byS.get(r.symbol).push({d:String(r.trade_date).slice(0,10),o:+r.open,h:+r.high,l:+r.low,c,v:r.volume===null?0:+r.volume});}
  for(const [sym,bars] of byS){
    const res={};
    for(const [nom,p] of Object.entries(ESCALAS)){ const r=detectV4(bars,p);
      res[nom]= r.base ? {seq:r.contracciones, f:r.fechas, dur:r.fechas.length?
        Math.round((Date.parse(r.fechas.at(-1).split("→")[1])-Date.parse(r.fechas[0].split("→")[0]))/(7*864e5)):null} : null; }
    out.push({sym,res});
  }
  process.stderr.write(".");
}
process.stderr.write("\n");
await fs.writeFile(new URL("../resultados/fractal2.json", import.meta.url), JSON.stringify(out,null,1));
const N=out.length, nom=Object.keys(ESCALAS);
console.log(`\nEvaluados: ${N}`);
for(const e of nom){ const c=out.filter(o=>o.res[e]).length;
  const durs=out.map(o=>o.res[e]?.dur).filter(Number.isFinite).sort((a,b)=>a-b);
  const profs=out.map(o=>o.res[e]?.seq[0]).filter(Number.isFinite).sort((a,b)=>a-b);
  console.log(`  ${e.padEnd(7)} ${String(c).padStart(3)} bases (${(100*c/N).toFixed(1)}%)` +
    (durs.length?`  duración mediana ${durs[Math.floor(durs.length/2)]} sem` : "") +
    (profs.length?`  ·  1ª contracción mediana ${profs[Math.floor(profs.length/2)].toFixed(1)}%`:""));
}
const enVarias = out.filter(o=>nom.filter(e=>o.res[e]).length>=2);
console.log(`\nCon base en 2+ escalas: ${enVarias.length}`);
let anidados=0;
for(const o of enVarias){
  const es=nom.filter(e=>o.res[e]);
  if(new Set(es.map(e=>o.res[e].f.join("|"))).size>1) anidados++;
}
console.log(`  de ellos, con estructura DISTINTA según la escala (anidamiento real): ${anidados}`);
console.log(`\nEjemplos de anidamiento:`);
let k=0;
for(const o of enVarias){
  const es=nom.filter(e=>o.res[e]);
  if(new Set(es.map(e=>o.res[e].f.join("|"))).size<=1) continue;
  console.log(`  ${o.sym}`);
  for(const e of es) console.log(`      ${e.padEnd(7)} [${o.res[e].seq.join(" → ")}]  ${o.res[e].dur} sem   ${o.res[e].f[0]} … ${o.res[e].f.at(-1)}`);
  if(++k>=8) break;
}
