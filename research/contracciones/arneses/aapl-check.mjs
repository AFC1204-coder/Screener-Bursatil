import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV5 } from "../detector/v5.mjs";
const cfg = supabaseConfig();
const rows = await supabaseRequestAll("daily_bars", { query: {
  select:"trade_date,open,high,low,close,adj_close,volume", owner_id:`eq.${cfg.ownerId}`,
  symbol:"eq.AAPL", order:"trade_date.asc" }, timeoutMs:20000 }, { maxRows: 420 });
const all = rows.map(r=>({d:String(r.trade_date).slice(0,10),o:+r.open,h:+r.high,l:+r.low,
  c:Number(r.adj_close??r.close),v:r.volume===null?0:+r.volume})).filter(x=>Number.isFinite(x.c)&&x.c>0);
// Las cuatro barras mensuales residuales conocidas en AAPL
const CORRUPTAS = new Set(["2025-03-01","2025-06-01","2025-09-01","2026-03-01"]);
const conBasura = all.filter(b=>b.d<="2026-06-01");
const limpio    = conBasura.filter(b=>!CORRUPTAS.has(b.d));
console.log("Barras mensuales presentes en la ventana:");
for(const b of conBasura.filter(x=>CORRUPTAS.has(x.d)))
  console.log(`  ${b.d}  max ${b.h.toFixed(2)}  min ${b.l.toFixed(2)}  cierre ${b.c.toFixed(2)}  rango ${(100*(b.h-b.l)/b.c).toFixed(1)}%  vol ${(b.v/1e6).toFixed(0)}M`);
const r1=detectV5(conBasura), r2=detectV5(limpio);
console.log(`\nCON las barras corruptas (${conBasura.length} barras): ${r1.base?"BASE":"no"} — ${r1.reason}` + (r1.contracciones?`  [${r1.contracciones.join(" → ")}]  ${r1.fechas.join("  ")}`:""));
console.log(`SIN las barras corruptas (${limpio.length} barras): ${r2.base?"BASE":"no"} — ${r2.reason}` + (r2.contracciones?`  [${r2.contracciones.join(" → ")}]  ${r2.fechas.join("  ")}`:""));
