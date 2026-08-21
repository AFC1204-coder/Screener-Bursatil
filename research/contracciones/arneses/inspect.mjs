import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
const cfg = supabaseConfig();
const [sym, desde, hasta] = process.argv.slice(2);
const rows = await supabaseRequestAll("daily_bars", {
  query: { select: "trade_date,open,high,low,close,adj_close,volume",
           owner_id: `eq.${cfg.ownerId}`, symbol: `eq.${sym}`, order: "trade_date.asc" },
  timeoutMs: 20000 }, { maxRows: 5000 });
const bars = rows.map(r => ({ d: String(r.trade_date).slice(0,10), o:+r.open, h:+r.high, l:+r.low,
  c:+(r.adj_close ?? r.close), v: r.volume===null?0:+r.volume })).filter(b => b.d >= desde && b.d <= hasta);
// resumen semanal
const sem = new Map();
for (const b of bars) {
  const dt = new Date(b.d + "T00:00:00Z");
  const yr = dt.getUTCFullYear(); const on = Math.floor((dt - new Date(Date.UTC(yr,0,1)))/86400000);
  const wk = `${yr}-W${String(Math.floor((on + new Date(Date.UTC(yr,0,1)).getUTCDay())/7)).padStart(2,"0")}`;
  if (!sem.has(wk)) sem.set(wk, { wk, ini: b.d, fin: b.d, h: b.h, l: b.l, c: b.c, v: 0, n: 0 });
  const s = sem.get(wk); s.fin = b.d; s.h = Math.max(s.h, b.h); s.l = Math.min(s.l, b.l); s.c = b.c; s.v += b.v; s.n++;
}
const arr = [...sem.values()];
const maxH = Math.max(...arr.map(s=>s.h)), minL = Math.min(...arr.map(s=>s.l));
const avgV = arr.reduce((a,s)=>a+s.v/s.n,0)/arr.length;
console.log(`${sym}  ${bars[0]?.d} → ${bars.at(-1)?.d}  (${bars.length} sesiones)  máx ${maxH.toFixed(2)} mín ${minL.toFixed(2)}`);
for (const s of arr) {
  const a = Math.round((s.l - minL)/(maxH-minL)*46), b = Math.round((s.h - minL)/(maxH-minL)*46);
  const barra = " ".repeat(a) + "█".repeat(Math.max(1, b-a));
  console.log(`${s.ini}  h${s.h.toFixed(2).padStart(8)} l${s.l.toFixed(2).padStart(8)} c${s.c.toFixed(2).padStart(8)}  v${(s.v/s.n/avgV).toFixed(2)}x  |${barra.padEnd(47)}|`);
}
