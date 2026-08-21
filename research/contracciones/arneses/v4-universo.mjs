// Corrida ciega de la v4 sobre una muestra aleatoria del universo líquido.
// Muestra: 400 valores US con >=300 barras, ultima sesion >= 2026-08-14 y
// >=50M$ de volumen diario medio desde junio. Semilla fija ('seed2026').
// Solo lee daily_bars. No escribe nada.

import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";

const SIMBOLOS = (await fs.readFile(new URL("../resultados/muestra400.txt", import.meta.url), "utf8"))
  .trim().split(",").map((s) => s.trim()).filter(Boolean);

const cfg = supabaseConfig();
const LOTE = 25;
const resultados = [];

for (let i = 0; i < SIMBOLOS.length; i += LOTE) {
  const lote = SIMBOLOS.slice(i, i + LOTE);
  let rows;
  try {
    rows = await supabaseRequestAll("daily_bars", {
      query: {
        select: "symbol,trade_date,open,high,low,close,adj_close,volume",
        owner_id: `eq.${cfg.ownerId}`,
        symbol: `in.(${lote.join(",")})`,
        trade_date: "gte.2025-09-01",
        order: "symbol.asc,trade_date.asc",
      },
      timeoutMs: 45000,
    }, { maxRows: 40000 });
  } catch (e) {
    console.error(`lote ${i}: ${e.message}`);
    continue;
  }
  const porSimbolo = new Map();
  for (const r of rows) {
    const c = Number(r.adj_close ?? r.close);
    if (!Number.isFinite(c) || c <= 0) continue;
    if (!porSimbolo.has(r.symbol)) porSimbolo.set(r.symbol, []);
    porSimbolo.get(r.symbol).push({
      d: String(r.trade_date).slice(0, 10),
      o: Number(r.open), h: Number(r.high), l: Number(r.low), c,
      v: r.volume === null ? 0 : Number(r.volume),
    });
  }
  for (const [sym, bars] of porSimbolo) {
    const r = detectV4(bars);
    resultados.push({ sym, base: r.base, motivo: r.reason, barras: bars.length, ...r });
  }
  process.stderr.write(`.`);
}
process.stderr.write("\n");

await fs.writeFile(new URL("../resultados/universo-v4.json", import.meta.url),
  JSON.stringify(resultados, null, 1));

const total = resultados.length;
const bases = resultados.filter((r) => r.base);
console.log(`\nEvaluados: ${total} de ${SIMBOLOS.length}`);
console.log(`MARCADOS COMO BASE: ${bases.length}  (${(100 * bases.length / total).toFixed(1)}%)\n`);

const motivos = {};
for (const r of resultados) motivos[r.motivo] = (motivos[r.motivo] || 0) + 1;
console.log("Motivos de rechazo:");
for (const [m, n] of Object.entries(motivos).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${(100 * n / total).toFixed(1).padStart(5)}%  ${m}`);
}

console.log("\nLos marcados:");
for (const r of bases.sort((a, b) => b.primeraEnAtr - a.primeraEnAtr)) {
  console.log(`  ${r.sym.padEnd(7)} ${String(r.contracciones.join(" → ")).padEnd(26)} 1ª=${String(r.primeraEnAtr).padStart(4)}x  desp=${String(r.dispRatio).padStart(6)}  sma=${String(r.smaSlopePct).padStart(6)}%  vol=${r.volRatio}`);
}
