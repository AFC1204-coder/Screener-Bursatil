// Compara weeklyStage (código, sin modificar) contra reglas candidatas de
// E1/E2 operativo: resistencia de base, ruptura y HH/HL semanales.
//
// Solo lee daily_bars. No escribe en Supabase ni toca lib/.
//
// Uso (desde la raíz del repo):
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     research/contracciones/arneses/etapa-codigo-vs-candidato.mjs
//
// SYMBOLS=MSI,APH,...  (coma-separado)  MSI_FROM / MSI_TO  ventana ancla

import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { weeklyStageForBars, weeklyBarsFromDaily } from "@/lib/weeklyStage.js";

const TANDA3 = ["APH", "DELL", "F", "GE", "HPE", "MDLZ", "MMM", "MSI", "NVDA", "SCHW", "STX", "VLO"];
const NOCTURNO = ["KO", "NDSN", "MPC", "SPY", "AMD", "QQQ"];
const DEFAULT_SYMBOLS = [...TANDA3, ...NOCTURNO];
const DIRTY = new Set(["AAPL", "JPM", "MSFT", "TXN", "WELL"]);

const LOOKBACK_WEEKS = 52;
const RIGHT_WEEKS = 4;
const PIVOT_RADIUS = 2;
const BOX26_MAX_PCT = 32;
const TREND26_MIN_PCT = 50;
const SHALLOW_PULL_PCT = -8;
const MSI_FROM = process.env.MSI_FROM || "2025-09-11";
const MSI_TO = process.env.MSI_TO || "2026-08-31";

const SYMBOLS = (process.env.SYMBOLS || DEFAULT_SYMBOLS.join(","))
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const cfg = supabaseConfig();
if (!cfg.configured) {
  console.error("Falta Supabase:", cfg.missing.join(", "));
  process.exit(1);
}

function finite(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function isMonthStartBar(bar, prev20) {
  if (!bar.date.endsWith("-01")) return false;
  const vols = prev20.map((b) => b.volume).filter(Number.isFinite);
  const med = median(vols);
  return Number.isFinite(med) && med > 0 && Number.isFinite(bar.volume) && bar.volume > 4 * med;
}

function dropMonthlyBars(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i += 1) {
    const prev20 = bars.slice(Math.max(0, i - 20), i);
    if (isMonthStartBar(bars[i], prev20)) continue;
    out.push(bars[i]);
  }
  return out;
}

function toDaily(rows) {
  return rows
    .map((row) => {
      const close = finite(row.close);
      if (!row.trade_date || !Number.isFinite(close) || close <= 0) return null;
      return {
        date: String(row.trade_date).slice(0, 10),
        open: finite(row.open) ?? close,
        high: finite(row.high) ?? close,
        low: finite(row.low) ?? close,
        close,
        volume: row.volume === null ? 0 : finite(row.volume) ?? 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function oldestFirst(weeks) {
  return [...weeks].sort((a, b) => a.date.localeCompare(b.date));
}

function weeklyPivots(weeksAsc, radius = PIVOT_RADIUS) {
  const highs = [];
  const lows = [];
  for (let i = radius; i < weeksAsc.length - radius; i += 1) {
    let isH = true;
    let isL = true;
    for (let k = 1; k <= radius; k += 1) {
      if (weeksAsc[i].high <= weeksAsc[i - k].high || weeksAsc[i].high <= weeksAsc[i + k].high) isH = false;
      if (weeksAsc[i].low >= weeksAsc[i - k].low || weeksAsc[i].low >= weeksAsc[i + k].low) isL = false;
    }
    if (isH) highs.push({ i, date: weeksAsc[i].date, price: weeksAsc[i].high });
    if (isL) lows.push({ i, date: weeksAsc[i].date, price: weeksAsc[i].low });
  }
  return { highs, lows };
}

function lastTwoRising(points) {
  if (!points || points.length < 2) return null;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return b.price > a.price;
}

function pct(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? ((a / b) - 1) * 100 : null;
}

function fmtPct(n, digits = 1) {
  return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%` : "—";
}

function pad(s, n) {
  return String(s ?? "").padEnd(n);
}

function padL(s, n) {
  return String(s ?? "").padStart(n);
}

function candidateFor(daily) {
  const stage = weeklyStageForBars(daily);
  const weeksDesc = weeklyBarsFromDaily(daily);
  const weeks = oldestFirst(weeksDesc);
  const last = weeks.at(-1);
  if (!last || weeks.length < LOOKBACK_WEEKS + RIGHT_WEEKS) {
    return {
      stage,
      weeks: weeks.length,
      asOf: last?.date || "",
      resistance: null,
      close: last?.close ?? null,
      distResPct: null,
      ruptura: null,
      hh: null,
      hl: null,
      volX: null,
      verdict: "dudoso",
      why: "histórico semanal corto para 52+4 semanas de techo",
    };
  }

  const left = weeks.slice(weeks.length - LOOKBACK_WEEKS - RIGHT_WEEKS, weeks.length - RIGHT_WEEKS);
  const resistance = Math.max(...left.map((w) => w.high));
  const resBar = left.reduce((best, w) => (w.high >= best.high ? w : best), left[0]);
  const close = last.close;
  const distResPct = pct(close, resistance);
  const ruptura = close > resistance;

  const recent = weeks.slice(-LOOKBACK_WEEKS);
  const { highs, lows } = weeklyPivots(recent, PIVOT_RADIUS);
  const hh = lastTwoRising(highs);
  const hl = lastTwoRising(lows);
  const hhhl = hh === true && hl === true;

  const lastVol = last.volume;
  const prevVols = weeks.slice(-5, -1).map((w) => w.volume);
  const volX = Number.isFinite(lastVol) && median(prevVols) > 0 ? lastVol / median(prevVols) : null;

  const w26 = weeks.slice(-26);
  const max26 = Math.max(...w26.map((w) => w.high));
  const min26 = Math.min(...w26.map((w) => w.low));
  const rng26Pct = min26 > 0 ? ((max26 / min26) - 1) * 100 : null;
  const dist26Pct = pct(close, max26);
  const hi52 = recent.reduce((best, w) => (w.high >= best.high ? w : best), recent[0]);
  const weeksSinceHigh = recent.length - 1 - recent.findIndex((w) => w.date === hi52.date);

  // Candidato A: techo 52s excluyendo 4 sem. Estricto; un pullback bajo un ATH
  // reciente sale «E1» aunque el ciclo sea un avance (SPY, DELL).
  let verdictA = "dudoso";
  let whyA = "";
  if (stage.state === "stage4") {
    verdictA = "dudoso";
    whyA = `código ${stage.label}; no es E2 cazable`;
  } else if (!ruptura) {
    verdictA = "E1";
    whyA = `cierre bajo techo 52s-4 (${fmtPct(distResPct)} vs ${resBar.date}); ${stage.state === "stage2" ? "E2_ma_only" : stage.label}`;
  } else if (hhhl) {
    verdictA = "E2";
    whyA = `cierre sobre techo ${resBar.date} y HH/HL`;
  } else {
    verdictA = "dudoso";
    whyA = `cierre sobre techo ${resBar.date}, HH=${yn(hh)} HL=${yn(hl)}`;
  }

  // Candidato B (operativo dueño/Weinstein): caja 26s bajo techo = E1 potencial;
  // fuga 52s-4 + HH/HL = E2; tendencia ancha (rng26>50%) cerca del techo + HH/HL = E2
  // (no es base E1). El resto, dudoso.
  let verdictB = "dudoso";
  let whyB = "";
  const tightBox = Number.isFinite(rng26Pct) && rng26Pct <= BOX26_MAX_PCT;
  const wideTrend = Number.isFinite(rng26Pct) && rng26Pct >= TREND26_MIN_PCT;
  const nearHigh = Number.isFinite(distResPct) && distResPct >= SHALLOW_PULL_PCT;
  if (stage.state === "stage1" && !ruptura) {
    verdictB = "E1";
    whyB = `${stage.label}; cierre aún bajo techo ${resBar.date}`;
  } else if (tightBox && !ruptura) {
    verdictB = "E1";
    whyB = `caja 26s ${rng26Pct.toFixed(0)}% bajo techo ${resBar.date} (${fmtPct(distResPct)}); E2_ma_only, sin fuga`;
  } else if (ruptura && hhhl) {
    verdictB = "E2";
    whyB = `fuga sobre ${resBar.date} + HH/HL`;
  } else if (wideTrend && nearHigh && hhhl && stage.state === "stage2") {
    verdictB = "E2";
    whyB = `tendencia 26s ${rng26Pct.toFixed(0)}% (no caja), cerca del techo ${fmtPct(distResPct)}, HH/HL`;
  } else if (ruptura && !hhhl) {
    verdictB = "dudoso";
    whyB = `fuga sobre ${resBar.date} sin HH/HL`;
  } else if (wideTrend && !nearHigh) {
    verdictB = "dudoso";
    whyB = `avance 26s ${rng26Pct.toFixed(0)}% pero ${fmtPct(distResPct)} del techo ${resBar.date}`;
  } else {
    verdictB = "dudoso";
    whyB = `ni caja ≤${BOX26_MAX_PCT}% ni fuga+HH/HL (rng26=${Number.isFinite(rng26Pct) ? rng26Pct.toFixed(0) : "?"}%, ${fmtPct(distResPct)})`;
  }

  return {
    stage,
    weeks: weeks.length,
    asOf: last.date,
    firstWeek: weeks[0].date,
    resistance,
    resDate: resBar.date,
    close,
    distResPct,
    dist26Pct,
    rng26Pct,
    weeksSinceHigh,
    ruptura,
    hh,
    hl,
    hhhl,
    volX,
    lastHigh: last.high,
    verdictA,
    whyA,
    verdict: verdictB,
    why: whyB,
    weeksAsc: weeks,
  };
}

function yn(v) {
  if (v === true) return "sí";
  if (v === false) return "no";
  return "?";
}

function msiWindow(daily) {
  const weeks = oldestFirst(weeklyBarsFromDaily(daily)).filter((w) => w.date >= MSI_FROM && w.date <= MSI_TO);
  if (!weeks.length) return null;
  const highBar = weeks.reduce((best, w) => (w.high >= best.high ? w : best), weeks[0]);
  const last = weeks.at(-1);
  return {
    n: weeks.length,
    from: weeks[0].date,
    to: last.date,
    high: highBar.high,
    highDate: highBar.date,
    lastClose: last.close,
    lastHigh: last.high,
    distPct: pct(last.close, highBar.high),
    cleared: last.close > highBar.high,
  };
}

async function barsFor(symbol) {
  const rows = await supabaseRequestAll("daily_bars", {
    query: {
      select: "trade_date,open,high,low,close,volume",
      owner_id: `eq.${cfg.ownerId}`,
      symbol: `eq.${symbol}`,
      order: "trade_date.asc",
    },
    timeoutMs: 25000,
  }, { maxRows: 800 });
  return dropMonthlyBars(toDaily(rows));
}

async function main() {
  console.log("etapa-codigo-vs-candidato  (read-only)");
  console.log(`techo = máx weekly high de ${LOOKBACK_WEEKS} sem excluyendo las últimas ${RIGHT_WEEKS}`);
  console.log(`HH/HL = últimos 2 pivotes semanales (radio ${PIVOT_RADIUS}) en ${LOOKBACK_WEEKS} sem`);
  console.log(`candidato B: caja 26s ≤${BOX26_MAX_PCT}% bajo techo → E1; fuga+HH/HL o tendencia ≥${TREND26_MIN_PCT}% cerca del techo+HH/HL → E2`);
  console.log(`símbolos: ${SYMBOLS.join(", ")}`);
  console.log("");

  const rows = [];
  for (const symbol of SYMBOLS) {
    if (DIRTY.has(symbol)) {
      rows.push({ symbol, error: "barras mensuales residuales conocidas; excluido" });
      continue;
    }
    let daily;
    try {
      daily = await barsFor(symbol);
    } catch (error) {
      rows.push({ symbol, error: error.message });
      continue;
    }
    if (daily.length < 200) {
      rows.push({ symbol, error: `pocas barras: ${daily.length}` });
      continue;
    }
    const c = candidateFor(daily);
    const extra = symbol === "MSI" ? msiWindow(daily) : null;
    rows.push({ symbol, dailyN: daily.length, ...c, msi: extra });
  }

  const wSym = Math.max(6, ...rows.map((r) => r.symbol.length));
  console.log(
    `${pad("símbolo", wSym)}  ${pad("etapa código", 22)}  ${pad("A", 8)}  ${pad("B", 8)}  ${pad("rupt.", 5)}  ${pad("HH", 3)}  ${pad("HL", 3)}  ${pad("vs techo", 9)}  ${pad("rng26", 6)}  por qué B`,
  );
  console.log("-".repeat(150));
  for (const r of rows) {
    if (r.error) {
      console.log(`${pad(r.symbol, wSym)}  ERROR  ${r.error}`);
      continue;
    }
    console.log(
      `${pad(r.symbol, wSym)}  ${pad(r.stage.label, 22)}  ${pad(r.verdictA, 8)}  ${pad(r.verdict, 8)}  ${pad(yn(r.ruptura), 5)}  ${pad(yn(r.hh), 3)}  ${pad(yn(r.hl), 3)}  ${padL(fmtPct(r.distResPct), 9)}  ${padL(Number.isFinite(r.rng26Pct) ? `${r.rng26Pct.toFixed(0)}%` : "—", 6)}  ${r.why}`,
    );
  }

  const ok = rows.filter((r) => !r.error);
  const codeE2 = ok.filter((r) => r.stage.state === "stage2");
  const tally = (key) => {
    const e1 = codeE2.filter((r) => r[key] === "E1").length;
    const e2 = codeE2.filter((r) => r[key] === "E2").length;
    const d = codeE2.filter((r) => r[key] === "dudoso").length;
    return { e1, e2, d };
  };
  const a = tally("verdictA");
  const b = tally("verdict");

  console.log("");
  console.log(`medidos=${ok.length}  errores=${rows.length - ok.length}  código stage2=${codeE2.length}`);
  console.log(`candidato A (techo 52s-4): E2=${a.e2}  E1=${a.e1}  dudoso=${a.d}`);
  console.log(`candidato B (caja 26s / tendencia): E2=${b.e2}  E1=${b.e1}  dudoso=${b.d}`);
  if (codeE2.length) {
    console.log(`B: ${(100 * b.e1 / codeE2.length).toFixed(0)}% de los stage2 del código salen E1 potencial (muestra, no universo)`);
  }

  const msi = rows.find((r) => r.symbol === "MSI" && !r.error);
  if (msi?.msi) {
    const w = msi.msi;
    console.log("");
    console.log(`ancla MSI ventana dueño ${MSI_FROM}→${MSI_TO}: ${w.n} sem ${w.from}→${w.to}`);
    console.log(`  techo de la ventana ${w.high.toFixed(2)} el ${w.highDate}; cierre ${w.lastClose.toFixed(2)} (${fmtPct(w.distPct)}); ¿cleared? ${w.cleared ? "sí" : "no"}`);
    console.log(`  código: ${msi.stage.label} · pend MM30s ${fmtPct(msi.stage.slowMaSlopePct)} · dist MM30s ${fmtPct(msi.stage.distanceSlowMaPct)}`);
    console.log(`  A=${msi.verdictA} · B=${msi.verdict} · ${msi.why}`);
  }

  console.log("");
  console.log("markdown:");
  console.log("| símbolo | etapa código | A techo52 | B operativo | ruptura | HH | HL | vs techo | rng26 | una línea |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of ok) {
    const rng = Number.isFinite(r.rng26Pct) ? `${r.rng26Pct.toFixed(0)}%` : "—";
    console.log(
      `| ${r.symbol} | ${r.stage.label} | ${r.verdictA} | ${r.verdict} | ${yn(r.ruptura)} | ${yn(r.hh)} | ${yn(r.hl)} | ${fmtPct(r.distResPct)} | ${rng} | ${r.why} |`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
