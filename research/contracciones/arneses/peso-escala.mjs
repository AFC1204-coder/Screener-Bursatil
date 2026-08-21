// ¿Pesa más una base de escala mayor? Prueba hacia delante: detectar a tres
// fechas pasadas en cada escala y medir 50 sesiones después.
// No depende de etiquetas humanas. Solo lee daily_bars.
import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";

const ESCALAS = {
  corta: { lookback:60,  maxLegBars:15, pivotRadius:2, firstContractionMinAtr:2.0, lastContractionMaxAtr:1.5 },
  media: { lookback:140, maxLegBars:45, pivotRadius:3, firstContractionMinAtr:3.5, lastContractionMaxAtr:3.0 },
  larga: { lookback:250, maxLegBars:90, pivotRadius:5, firstContractionMinAtr:5.0, lastContractionMaxAtr:4.5 },
};
const CORTES = ["2025-12-15","2026-02-13","2026-04-15"];
const FWD_MAX = 160;   // tope de barras que hay que reservar por delante
const SIM = (await fs.readFile(new URL("../resultados/muestra400.txt", import.meta.url),"utf8"))
  .trim().split(",").map(s=>s.trim()).filter(Boolean);
const cfg=supabaseConfig(); const datos=new Map();
for(let i=0;i<SIM.length;i+=25){
  const lote=SIM.slice(i,i+25); let rows;
  try{ rows=await supabaseRequestAll("daily_bars",{query:{
    select:"symbol,trade_date,open,high,low,close,adj_close,volume",owner_id:`eq.${cfg.ownerId}`,
    symbol:`in.(${lote.join(",")})`,order:"symbol.asc,trade_date.asc"},timeoutMs:60000},{maxRows:45000});
  }catch(e){ continue; }
  for(const r of rows){ const c=Number(r.adj_close??r.close); if(!Number.isFinite(c)||c<=0)continue;
    if(!datos.has(r.symbol))datos.set(r.symbol,[]);
    datos.get(r.symbol).push({d:String(r.trade_date).slice(0,10),o:+r.open,h:+r.high,l:+r.low,c,v:r.volume===null?0:+r.volume}); }
  process.stderr.write(".");
}
process.stderr.write("\n");

const med=(a)=>{ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y);
  return s.length%2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2; };
const res={}; for(const e of Object.keys(ESCALAS)) res[e]={ret:[],dd:[],dur:[]};
const universo={ret:[],dd:[]};

for(const [sym,all] of datos){
  for(const corte of CORTES){
    const iCorte = all.findIndex(b=>b.d>corte)-1;
    if(iCorte<180 || iCorte+50>=all.length) continue;   // el universo solo necesita 50
    const bars=all.slice(0,iCorte+1);
    const p0=bars.at(-1).c;
    // referencia del universo: horizonte fijo de 50, solo para comparar
    const f50=all.slice(iCorte+1, iCorte+51);
    universo.ret.push(100*(f50.at(-1).c/p0-1));
    universo.dd.push(100*(Math.min(...f50.map(b=>b.l))/p0-1));
    for(const [nom,par] of Object.entries(ESCALAS)){
      const r=detectV4(bars,par);
      if(!r.base) continue;
      const f=r.fechas;
      const durSem=(Date.parse(f.at(-1).split("→")[1])-Date.parse(f[0].split("→")[0]))/(7*864e5);
      // HORIZONTE PROPORCIONAL: dos veces la duración del propio patrón
      const H=Math.max(20, Math.min(FWD_MAX, Math.round(durSem*5*2)));
      const fwd=all.slice(iCorte+1, iCorte+1+H);
      if(fwd.length<H) continue;   // esta escala no cabe en los datos: se salta
      const ret=100*(fwd.at(-1).c/p0-1);
      const dd =100*(Math.min(...fwd.map(b=>b.l))/p0-1);
      // ¿rompió el techo del patrón y aguantó hasta el final del horizonte?
      const techo=r.techo;
      const rompio=fwd.some(b=>b.c>techo);
      const aguanto=rompio && fwd.at(-1).c>techo;
      res[nom].ret.push(ret); res[nom].dd.push(dd); res[nom].dur.push(durSem);
      res[nom].H=(res[nom].H||[]); res[nom].H.push(H);
      res[nom].rompio=(res[nom].rompio||0)+(rompio?1:0);
      res[nom].aguanto=(res[nom].aguanto||0)+(aguanto?1:0);
    }
  }
}
console.log(`\nPares valor-fecha evaluados: ${universo.ret.length}  (${CORTES.length} cortes)`);
console.log(`\n${"escala".padEnd(9)}${"n".padStart(5)}${"dur.med".padStart(9)}${"horizonte".padStart(11)}${"rendimiento".padStart(13)}${"caída máx".padStart(12)}${"rompió".padStart(9)}${"aguantó".padStart(9)}`);
console.log("-".repeat(80));
console.log(`${"universo".padEnd(9)}${String(universo.ret.length).padStart(5)}${"—".padStart(9)}${"50 ses".padStart(11)}${(med(universo.ret)?.toFixed(2)+"%").padStart(13)}${(med(universo.dd)?.toFixed(2)+"%").padStart(12)}`);
for(const e of Object.keys(ESCALAS)){
  const r=res[e];
  if(!r.ret.length){ console.log(`${e.padEnd(9)}${"0".padStart(5)}  sin detecciones`); continue; }
  console.log(`${e.padEnd(9)}${String(r.ret.length).padStart(5)}${(med(r.dur)?.toFixed(0)+" sem").padStart(9)}${(med(r.H)?.toFixed(0)+" ses").padStart(11)}${(med(r.ret).toFixed(2)+"%").padStart(13)}${(med(r.dd).toFixed(2)+"%").padStart(12)}${((100*r.rompio/r.ret.length).toFixed(0)+"%").padStart(9)}${((100*r.aguanto/r.ret.length).toFixed(0)+"%").padStart(9)}`);
}
console.log(`\nDiferencia contra el universo (mediana):`);
for(const e of Object.keys(ESCALAS)){
  const r=res[e]; if(!r.ret.length) continue;
  console.log(`  ${e.padEnd(7)} rendimiento ${(med(r.ret)-med(universo.ret)>=0?"+":"")}${(med(r.ret)-med(universo.ret)).toFixed(2)} pts  ·  caída máx ${(med(r.dd)-med(universo.dd)>=0?"+":"")}${(med(r.dd)-med(universo.dd)).toFixed(2)} pts (positivo = cae menos)`);
}
