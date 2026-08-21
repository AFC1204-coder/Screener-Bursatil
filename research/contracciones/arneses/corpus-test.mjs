import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";
import { detectV5 } from "../detector/v5.mjs";
const CASOS = [
  { id:"brk-b-lower-low-drift",  sym:"BRK-B",  asOf:"2026-06-02", esp:"block", arq:"lower_low_false_positive" },
  { id:"3988-lower-low-drift",   sym:"3988.HK",asOf:"2026-06-03", esp:"block", arq:"lower_low_false_positive" },
  { id:"isrg-lower-low-drift",   sym:"ISRG",   asOf:"2026-06-02", esp:"block", arq:"lower_low_false_positive" },
  { id:"aapl-lower-low-drift",   sym:"AAPL",   asOf:"2026-06-01", esp:"block", arq:"lower_low_false_positive" },
  { id:"meta-reexpansion",       sym:"META",   asOf:"2026-06-02", esp:"block", arq:"depth_reexpansion" },
  { id:"msft-no-base",           sym:"MSFT",   asOf:"2026-06-02", esp:"block", arq:"no_validated_base" },
  { id:"3988-actionable",        sym:"3988.HK",asOf:"2026-05-28", esp:"plan",  arq:"strict_vcp_plan" },
  { id:"cost-constructive",      sym:"COST",   asOf:"2026-05-07", esp:"watch", arq:"constructive_base" },
  { id:"well-vcp-watch",         sym:"WELL",   asOf:"2026-05-14", esp:"watch", arq:"valid_vcp_watch" },
  { id:"nvda-pivot-squeeze",     sym:"NVDA",   asOf:"2024-05-22", esp:"watch", arq:"pivot_squeeze" },
];
const cfg = supabaseConfig(); const cache=new Map();
async function bf(sym){ if(cache.has(sym))return cache.get(sym);
  const rows=await supabaseRequestAll("daily_bars",{query:{select:"trade_date,open,high,low,close,adj_close,volume",
    owner_id:`eq.${cfg.ownerId}`,symbol:`eq.${sym}`,order:"trade_date.asc"},timeoutMs:20000},{maxRows:1300});
  const b=rows.map(r=>({d:String(r.trade_date).slice(0,10),o:+r.open,h:+r.high,l:+r.low,
    c:Number(r.adj_close??r.close),v:r.volume===null?0:+r.volume})).filter(x=>Number.isFinite(x.c)&&x.c>0);
  cache.set(sym,b); return b; }
console.log("id".padEnd(24)+"sym".padEnd(9)+"asOf".padEnd(12)+"esperado".padEnd(9)+"barras".padEnd(8)+"v4".padEnd(6)+"v5".padEnd(6)+"motivo v5");
console.log("-".repeat(110));
for(const c of CASOS){
  const all=await bf(c.sym); const bars=all.filter(b=>b.d<=c.asOf);
  if(bars.length<180){ console.log(c.id.padEnd(24)+c.sym.padEnd(9)+c.asOf.padEnd(12)+c.esp.padEnd(9)+String(bars.length).padEnd(8)+"NO REPRODUCIBLE (historia insuficiente)"); continue; }
  const r4=detectV4(bars), r5=detectV5(bars);
  console.log(c.id.padEnd(24)+c.sym.padEnd(9)+c.asOf.padEnd(12)+c.esp.padEnd(9)+String(bars.length).padEnd(8)
    +(r4.base?"BASE":"no").padEnd(6)+(r5.base?"BASE":"no").padEnd(6)+r5.reason
    +(r5.contracciones?"  ["+r5.contracciones.join(" → ")+"]":""));
}
