// Clasificador para la tanda de etiquetado manual.
//
// Ejecuta el detector de PRODUCCIÓN (lib/setupPatterns.js) sobre un conjunto de
// candidatos líquidos y los reparte en tres grupos según cuántas de sus puertas
// fallan. Las seis puertas reconstruyen exactamente `vcpCandidate`:
//
//   G1 datos      : patternEligible
//   G2 consolida  : consolidationCandidate
//   G3 estructura : contractionStructureStatus==='ok' && contractionsDecreasing
//   G4 >=3 contr. : contractionCount >= 3
//   G5 vol seco   : volumeDryUpRatio <= 0.85
//   G6 prof <=35% : baseDepthPct <= 35
//
// (vcpCandidate = G1 && G2 && G3 && G4 && G5 && G6 en setupPatterns.js:487)
//
// No escribe en Supabase: solo lee daily_bars.

import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { setupPatternForBars } from "@/lib/setupPatterns";

const CANDIDATES = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(",").map((s) => s.trim()).filter(Boolean)
  : [
    "NVDA","TSLA","AMZN","GOOGL","META","AVGO","ORCL","CRM","AMD","INTC","NFLX","DIS","NKE","MCD",
    "SBUX","BA","CAT","GE","IBM","QCOM","MU","ADBE","UBER","ABNB","PLTR","NOW","INTU","AMAT","LRCX",
    "KLAC","DAL","UAL","F","GM","T","VZ","TMUS","PFE","BMY","AMGN","GILD","CVS","GS","MS","BAC",
    "WFC","C","SCHW","BLK","AXP","LOW","TGT","TJX","DG","KR","DE","HON","LMT","RTX","NOC","UNP",
    "CSX","FDX","UPS","WM","NEE","DUK","SO","PLD","AMT","SPG","O","DLR","LNG","FANG","OXY","SLB",
    "COP","PSX","VLO","MPC","NEM","FCX","NUE","STLD","DOW","SHW","ECL","APD","LIN","MDT","SYK",
    "BSX","ISRG","VRTX","REGN","ZTS","CL","KMB","GIS","HSY","MMC","AON","PGR","TRV","ALL","CB",
    "MET","PRU","BK","STT","TFC","USB","PNC","COF","DFS","V","MA","UNH","JNJ","PG","HD","COST",
    "WMT","XOM","CVX","LLY","ABBV","MRK","PEP","KO",
  ];

// Excluidos por barras mensuales residuales todavía presentes en daily_bars
// (verificado 2026-08-20: AAPL/JPM/MSFT/TXN/WELL conservan 8 filas con rango
// intradía del 10-22% y volumen 20-80x, por debajo del umbral de la limpieza).
const DIRTY = new Set(["AAPL", "JPM", "MSFT", "TXN", "WELL"]);

function toBars(rows = []) {
  return rows
    .map((row) => {
      const close = Number(row.adj_close ?? row.close);
      if (!row.trade_date || !Number.isFinite(close) || close <= 0) return null;
      return {
        date: String(row.trade_date).slice(0, 10),
        open: Number(row.open ?? close),
        high: Number(row.high ?? close),
        low: Number(row.low ?? close),
        close,
        volume: row.volume === null ? null : Number(row.volume),
      };
    })
    .filter(Boolean);
}

function gatesFor(p) {
  return [
    { id: "G1_datos", ok: p.patternEligible === true, detail: p.patternDataStatus },
    { id: "G2_consolidacion", ok: p.consolidationCandidate === true, detail: p.baseContextStatus },
    {
      id: "G3_estructura",
      ok: p.contractionStructureStatus === "ok" && p.contractionsDecreasing === true,
      detail: p.contractionStructureStatus === "ok"
        ? (p.contractionsDecreasing ? "ok" : "no_decreciente")
        : p.contractionStructureStatus,
    },
    { id: "G4_tres_contracciones", ok: (p.contractionCount ?? 0) >= 3, detail: `n=${p.contractionCount ?? 0}` },
    {
      id: "G5_volumen_seco",
      ok: Number.isFinite(p.volumeDryUpRatio) && p.volumeDryUpRatio <= 0.85,
      detail: Number.isFinite(p.volumeDryUpRatio) ? p.volumeDryUpRatio.toFixed(2) : "n/a",
    },
    {
      id: "G6_profundidad",
      ok: Number.isFinite(p.baseDepthPct) && p.baseDepthPct <= 35,
      detail: Number.isFinite(p.baseDepthPct) ? `${p.baseDepthPct.toFixed(1)}%` : "n/a",
    },
  ];
}

async function main() {
  const cfg = supabaseConfig();
  if (!cfg.configured) throw new Error(`Supabase no configurado: ${cfg.missing.join(", ")}`);

  const out = [];
  for (const symbol of CANDIDATES) {
    if (DIRTY.has(symbol)) continue;
    let rows;
    try {
      rows = await supabaseRequestAll("daily_bars", {
        query: {
          select: "trade_date,open,high,low,close,adj_close,volume",
          owner_id: `eq.${cfg.ownerId}`,
          symbol: `eq.${symbol}`,
          order: "trade_date.desc",
        },
        timeoutMs: 20000,
      }, { maxRows: 420 });
    } catch (error) {
      out.push({ symbol, error: error.message });
      continue;
    }
    const bars = toBars(rows);
    if (bars.length < 150) {
      out.push({ symbol, error: `pocas barras: ${bars.length}` });
      continue;
    }
    const p = setupPatternForBars(bars, { rawBars: bars });
    const gates = gatesFor(p);
    const failed = gates.filter((g) => !g.ok);
    out.push({
      symbol,
      bars: bars.length,
      latest: bars[0].date,
      vcpCandidate: p.vcpCandidate === true,
      nFailed: failed.length,
      failed: failed.map((g) => `${g.id}(${g.detail})`),
      family: p.patternFamily,
      maturity: p.patternMaturity,
      // consolidationContext NO exporta `persistentAdvance` como campo suelto
      // (setupPatterns.js:334-354): el único sitio donde sobrevive es
      // baseContextStatus. Leerlo de p.persistentAdvance daba siempre false.
      baseContextStatus: p.baseContextStatus,
      persistentAdvance: p.baseContextStatus === "persistent_advance",
      baseDepthPct: p.baseDepthPct,
      contractionCount: p.contractionCount,
      contractionDepths: (p.contractionDepths || []).map((d) => Number(d?.toFixed?.(1) ?? d)),
      contractionsDecreasing: p.contractionsDecreasing,
      structureStatus: p.contractionStructureStatus,
      volumeDryUpRatio: p.volumeDryUpRatio,
      distanceToPivotPct: p.distanceToPivotPct,
      qualityScore: p.patternQualityScore,
      verdictKey: p.setupVerdictKey,
      displayLabel: p.setupDisplayLabel,
      swings: (p.contractionSwings || []).map((s) => ({
        from: s.fromDate, to: s.toDate, depth: Number(s.depthPct?.toFixed?.(1) ?? s.depthPct),
      })),
    });
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  await fs.writeFile(process.env.OUT || "/tmp/classify.json", JSON.stringify(out, null, 2));

  const ok = out.filter((r) => !r.error);
  const A = ok.filter((r) => r.vcpCandidate);
  const B = ok.filter((r) => !r.vcpCandidate && r.nFailed === 1);
  const C = ok.filter((r) => r.nFailed >= 3);
  const staircase = C.filter((r) => r.persistentAdvance);
  console.log(`total=${ok.length} errores=${out.length - ok.length}`);
  console.log(`\n== A · base con contracciones (0 puertas falladas): ${A.length}`);
  for (const r of A) console.log(`  ${r.symbol.padEnd(6)} prof=${r.baseDepthPct?.toFixed(1)}% n=${r.contractionCount} [${r.contractionDepths}] vol=${r.volumeDryUpRatio?.toFixed(2)} q=${r.qualityScore?.toFixed(0)} ${r.family}`);
  console.log(`\n== B · falla UNA sola puerta: ${B.length}`);
  for (const r of B) console.log(`  ${r.symbol.padEnd(6)} ${r.failed[0].padEnd(34)} prof=${r.baseDepthPct?.toFixed(1)}% n=${r.contractionCount} [${r.contractionDepths}] ${r.family}`);
  console.log(`\n== C · falla 3+ puertas: ${C.length} (de ellas persistentAdvance=${staircase.length})`);
  for (const r of C) console.log(`  ${r.symbol.padEnd(6)} nFail=${r.nFailed} adv=${r.persistentAdvance ? "SI" : "no"} ${r.family.padEnd(22)} ${r.failed.join(" ")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
