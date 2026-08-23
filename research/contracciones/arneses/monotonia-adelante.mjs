// Prueba hacia delante: ¿lo que la monotonía relajada añade vale algo?
// Mismo método que `peso-escala.mjs` (tres cortes pasados, horizonte
// proporcional a la duración del patrón), pero comparando tres grupos:
//   común  — lo que marcan v4 y v6 por igual
//   nuevo  — lo que SOLO marca v6 (lo que la regla añade)
//   universo — referencia, horizonte fijo de 50 sesiones
// No usa etiquetas humanas. Solo lee daily_bars.

import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";
import { detectV6 } from "../detector/v6.mjs";

const CORTES = ["2025-12-15", "2026-02-13", "2026-04-15"];
const FWD_MAX = 160;
const SIM = (await fs.readFile(new URL("../resultados/muestra400.txt", import.meta.url), "utf8"))
  .trim().split(",").map((s) => s.trim()).filter(Boolean);
const cfg = supabaseConfig();
const datos = new Map();
for (let i = 0; i < SIM.length; i += 25) {
  const lote = SIM.slice(i, i + 25); let rows;
  try {
    rows = await supabaseRequestAll("daily_bars", { query: {
      select: "symbol,trade_date,open,high,low,close,adj_close,volume", owner_id: `eq.${cfg.ownerId}`,
      symbol: `in.(${lote.join(",")})`, order: "symbol.asc,trade_date.asc" }, timeoutMs: 60000 }, { maxRows: 45000 });
  } catch (e) { continue; }
  for (const r of rows) {
    const c = Number(r.adj_close ?? r.close); if (!Number.isFinite(c) || c <= 0) continue;
    if (!datos.has(r.symbol)) datos.set(r.symbol, []);
    datos.get(r.symbol).push({ d: String(r.trade_date).slice(0, 10), o: +r.open, h: +r.high, l: +r.low, c,
      v: r.volume === null ? 0 : +r.volume });
  }
  process.stderr.write(".");
}
process.stderr.write("\n");

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const vacio = () => ({ ret: [], dd: [], dur: [], H: [], ret50: [], dd50: [], rompio: 0, aguanto: 0, casos: [] });
const G = { comun: vacio(), nuevo: vacio(), "nuevo-con-tope": vacio() };
const universo = { ret: [], dd: [] };

for (const [sym, all] of datos) {
  for (const corte of CORTES) {
    const iCorte = all.findIndex((b) => b.d > corte) - 1;
    if (iCorte < 180 || iCorte + 50 >= all.length) continue;
    const bars = all.slice(0, iCorte + 1);
    const p0 = bars.at(-1).c;
    const f50 = all.slice(iCorte + 1, iCorte + 51);
    universo.ret.push(100 * (f50.at(-1).c / p0 - 1));
    universo.dd.push(100 * (Math.min(...f50.map((b) => b.l)) / p0 - 1));

    const a = detectV4(bars), b = detectV6(bars);
    if (!b.base) continue;                       // v6 es un superconjunto de v4
    const w = detectV6(bars, { topeRepunteEnAncla: true });
    const grupo = a.base ? "comun" : "nuevo";
    const f = b.fechas;
    const durSem = (Date.parse(f.at(-1).split("→")[1]) - Date.parse(f[0].split("→")[0])) / (7 * 864e5);
    const H = Math.max(20, Math.min(FWD_MAX, Math.round(durSem * 5 * 2)));
    const fwd = all.slice(iCorte + 1, iCorte + 1 + H);
    if (fwd.length < H) continue;
    const ret = 100 * (fwd.at(-1).c / p0 - 1);
    const dd = 100 * (Math.min(...fwd.map((x) => x.l)) / p0 - 1);
    const rompio = fwd.some((x) => x.c > b.techo);
    const aguanto = rompio && fwd.at(-1).c > b.techo;
    const g = G[grupo];
    // horizonte FIJO de 50 sesiones, el mismo que el universo: es la única
    // comparación limpia, porque el proporcional da 160 sesiones a los nuevos
    g.ret50.push(100 * (f50.at(-1).c / p0 - 1));
    g.dd50.push(100 * (Math.min(...f50.map((x) => x.l)) / p0 - 1));
    g.ret.push(ret); g.dd.push(dd); g.dur.push(durSem); g.H.push(H);
    g.rompio += rompio ? 1 : 0; g.aguanto += aguanto ? 1 : 0;
    g.casos.push({ sym, corte, contr: b.contracciones, ret: +ret.toFixed(1), dd: +dd.toFixed(1),
      repunte: b.repunteIntermedio, sobreAncla: b.repuntaSobreElAncla });
    if (grupo === "nuevo" && w.base) {           // lo que la variante deja pasar
      const h = G["nuevo-con-tope"];
      h.ret.push(ret); h.dd.push(dd); h.dur.push(durSem); h.H.push(H);
      h.ret50.push(100 * (f50.at(-1).c / p0 - 1));
      h.dd50.push(100 * (Math.min(...f50.map((x) => x.l)) / p0 - 1));
      h.rompio += rompio ? 1 : 0; h.aguanto += aguanto ? 1 : 0; h.casos.push({ sym, corte });
    }
  }
}

console.log(`\nPares valor-fecha evaluados: ${universo.ret.length}  (${CORTES.length} cortes)`);
const fila = (nom, n, dur, H, ret, dd, ro, ag) =>
  console.log(`${nom.padEnd(10)}${String(n).padStart(5)}${dur.padStart(9)}${H.padStart(11)}${ret.padStart(13)}${dd.padStart(12)}${ro.padStart(9)}${ag.padStart(9)}`);
console.log(`\n${"grupo".padEnd(10)}${"n".padStart(5)}${"dur.med".padStart(9)}${"horiz.".padStart(11)}${"rendim.".padStart(13)}${"caída máx".padStart(12)}${"rompió".padStart(9)}${"aguantó".padStart(9)}`);
console.log("-".repeat(78));
fila("universo", universo.ret.length, "—", "50 ses", med(universo.ret).toFixed(2) + "%", med(universo.dd).toFixed(2) + "%", "", "");
for (const [nom, g] of Object.entries(G)) {
  if (!g.ret.length) { console.log(`${nom.padEnd(10)}    0   sin detecciones`); continue; }
  fila(nom, g.ret.length, med(g.dur).toFixed(0) + " sem", med(g.H).toFixed(0) + " ses",
    med(g.ret).toFixed(2) + "%", med(g.dd).toFixed(2) + "%",
    (100 * g.rompio / g.ret.length).toFixed(0) + "%", (100 * g.aguanto / g.ret.length).toFixed(0) + "%");
}
console.log("\nDiferencia contra el universo (mediana):");
for (const [nom, g] of Object.entries(G)) {
  if (!g.ret.length) continue;
  const dr = med(g.ret) - med(universo.ret), dd = med(g.dd) - med(universo.dd);
  console.log(`  ${nom.padEnd(7)} rendimiento ${dr >= 0 ? "+" : ""}${dr.toFixed(2)} pts · caída máx ${dd >= 0 ? "+" : ""}${dd.toFixed(2)} pts (positivo = cae menos)`);
}
console.log("\nY con el MISMO horizonte que el universo (50 sesiones fijas):");
console.log(`  ${"universo".padEnd(9)} n ${String(universo.ret.length).padStart(4)}  rendimiento ${med(universo.ret).toFixed(2)}%  caída máx ${med(universo.dd).toFixed(2)}%`);
for (const [nom, g] of Object.entries(G)) {
  if (!g.ret50.length) continue;
  const dr = med(g.ret50) - med(universo.ret), dd = med(g.dd50) - med(universo.dd);
  console.log(`  ${nom.padEnd(9)} n ${String(g.ret50.length).padStart(4)}  rendimiento ${med(g.ret50).toFixed(2)}%  caída máx ${med(g.dd50).toFixed(2)}%` +
    `   →  ${dr >= 0 ? "+" : ""}${dr.toFixed(2)} pts y ${dd >= 0 ? "+" : ""}${dd.toFixed(2)} pts contra el universo`);
}

console.log("\n### LO QUE AÑADE LA REGLA, UNO A UNO ###");
for (const c of G.nuevo.casos.sort((x, y) => x.ret - y.ret)) {
  console.log(`  ${c.sym.padEnd(7)} ${c.corte}  [${c.contr.join(" → ")}]  ret ${String(c.ret).padStart(6)}%  caída ${String(c.dd).padStart(6)}%` +
    `${c.sobreAncla ? "  ← un tramo supera al ancla" : ""}`);
}
const sobre = G.nuevo.casos.filter((c) => c.sobreAncla);
if (sobre.length) {
  console.log(`\nDe los ${G.nuevo.casos.length} nuevos, ${sobre.length} tienen un tramo más profundo que el ancla.`);
  console.log(`  rendimiento mediano de esos: ${med(sobre.map((c) => c.ret)).toFixed(2)}%`);
  const resto = G.nuevo.casos.filter((c) => !c.sobreAncla);
  if (resto.length) console.log(`  y el de los otros ${resto.length}: ${med(resto.map((c) => c.ret)).toFixed(2)}%`);
}
