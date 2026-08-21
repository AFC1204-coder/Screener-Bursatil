import fs from "node:fs";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";
const cfg = supabaseConfig();
const corpus = JSON.parse(fs.readFileSync(new URL("../corpus-manual.json", import.meta.url), "utf8"));
const LBS = [60,80,100,120,140,160,180,200];
const pad = (s,n)=>String(s).padEnd(n);
console.log(pad("caso",20)+pad("et",5)+pad("v4@140",7)+pad("BASE en",9)+pad("estructuras",13)+"perfil (60→250)");
const filas = [];
for (const c of corpus.casos) {
  const rows = await supabaseRequestAll("daily_bars", {
    query: { select: "trade_date,high,low,close,adj_close,volume", owner_id: `eq.${cfg.ownerId}`,
             symbol: `eq.${c.symbol}`, order: "trade_date.asc" }, timeoutMs: 20000 }, { maxRows: 5000 });
  const bars = rows.map(r => ({ d: String(r.trade_date).slice(0,10), h:+r.high, l:+r.low,
    c:+(r.adj_close ?? r.close), v: r.volume===null?0:+r.volume })).filter(b => b.d <= c.asOf && b.c > 0);
  const firmas = new Map(); let nBase = 0; let perfil = "";
  let ref = null;
  for (const lb of LBS) {
    const r = detectV4(bars, { lookback: lb });
    if (r.base) { nBase++; const f = r.fechas.join(","); firmas.set(f, (firmas.get(f)??0)+1);
      if (lb === 140) ref = f; perfil += "█"; } else perfil += "·";
  }
  const modal = [...firmas.entries()].sort((a,b)=>b[1]-a[1])[0];
  filas.push({ id: c.id, et: c.veredicto, base140: ref !== null, nBase, nEstr: firmas.size,
    coincideModal: ref !== null && modal && modal[0] === ref, perfil });
  console.log(pad(c.id,20)+pad(c.veredicto,5)+pad(ref!==null?"BASE":"no",7)
    +pad(`${nBase}/${LBS.length}`,9)+pad(firmas.size,13)+perfil);
}
const est = filas.filter(f=>f.base140 && f.nBase===LBS.length && f.nEstr===1);
console.log(`\nEstables del todo (BASE en las 15 ventanas y una sola estructura): ${est.length}`);
console.log("  " + est.map(f=>`${f.id}[${f.et}]`).join("  "));
const inest = filas.filter(f=>f.base140 && !(f.nBase===LBS.length && f.nEstr===1));
console.log(`Inestables (base a 140 pero no en todas / varias estructuras): ${inest.length}`);
for (const f of inest) console.log(`  ${pad(f.id,20)} ${pad(f.et,5)} BASE en ${f.nBase}/${LBS.length}, ${f.nEstr} estructuras`);
