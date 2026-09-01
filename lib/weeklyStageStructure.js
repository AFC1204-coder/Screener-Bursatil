// lib/weeklyStageStructure.js — subestado estructural semanal (ADR VCP-0).
//
// `lib/weeklyStage.js` responde «¿precio > MM30s y pendiente al alza?».
// Weinstein pide además la fuga del techo de la base (+ HH/HL tras ruptura).
// Este módulo NO reclasifica la etapa: calcula un campo paralelo.
//
// Candidato B de research/contracciones/arneses/etapa-codigo-vs-candidato.mjs
// y docs/auditoria-etapa1-etapa2-2026-09-01.md §3.1 / §6. Umbrales declarados
// (no están en los libros como número único).
//
//   E2_ma_only    — stage2 (o stage1 bajo techo) + caja 26s ≤32% sin fuga 52s-4
//   E2_structural — fuga techo + HH/HL, o tendencia ancha (≥50%) cerca del
//                   techo + HH/HL + stage2
//   n/a           — stage3/4/insufficient_history, histórico corto, o dudoso
//
// `pre_breakout` del ADR se fusiona con E2_ma_only en v1.

import { weeklyBarsFromDaily, weeklyStageForBars } from "@/lib/weeklyStage";

export const STRUCTURE_E2_MA_ONLY = "E2_ma_only";
export const STRUCTURE_E2_STRUCTURAL = "E2_structural";
export const STRUCTURE_NA = "n/a";

export const DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS = {
  lookbackWeeks: 52,
  rightWeeks: 4,
  pivotRadius: 2,
  box26MaxPct: 32,
  trend26MinPct: 50,
  shallowPullPct: -8,
};

const STRUCTURE_LABELS = {
  [STRUCTURE_E2_MA_ONLY]: "Pre-fuga",
  [STRUCTURE_E2_STRUCTURAL]: "Con fuga",
  [STRUCTURE_NA]: "",
};

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function oldestFirst(weeks) {
  return [...weeks].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function pct(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? ((a / b) - 1) * 100 : null;
}

function weeklyPivots(weeksAsc, radius) {
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

function emptyStructure(detail = "") {
  return {
    structure: STRUCTURE_NA,
    label: "",
    resistance: null,
    resistanceDate: "",
    distResistancePct: null,
    rng26Pct: null,
    ruptura: null,
    hh: null,
    hl: null,
    hhhl: null,
    detail,
  };
}

function withLabel(result) {
  return {
    ...result,
    label: STRUCTURE_LABELS[result.structure] || "",
  };
}

/**
 * Candidato B: caja 26s bajo techo = pre-fuga; fuga 52s-4 + HH/HL = estructural;
 * tendencia ancha cerca del techo + HH/HL + stage2 = estructural.
 */
export function weeklyStageStructureForBars(bars = [], options = {}) {
  const config = { ...DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS, ...options };
  const stageState = options.weeklyStageState
    || options.weeklyStage?.state
    || weeklyStageForBars(bars, options).state;
  const weeksDesc = weeklyBarsFromDaily(bars);
  const weeks = oldestFirst(weeksDesc);
  const last = weeks.at(-1);

  if (!last || weeks.length < config.lookbackWeeks + config.rightWeeks) {
    return withLabel(emptyStructure(
      `Histórico semanal corto para ${config.lookbackWeeks}+${config.rightWeeks} semanas de techo.`,
    ));
  }

  if (stageState === "stage3" || stageState === "stage4" || stageState === "insufficient_history") {
    return withLabel({
      ...emptyStructure(`código ${stageState}; el subestado estructural no aplica`),
    });
  }

  const left = weeks.slice(weeks.length - config.lookbackWeeks - config.rightWeeks, weeks.length - config.rightWeeks);
  const resistance = Math.max(...left.map((week) => week.high));
  const resBar = left.reduce((best, week) => (week.high >= best.high ? week : best), left[0]);
  const close = last.close;
  const distResistancePct = pct(close, resistance);
  const ruptura = close > resistance;

  const recent = weeks.slice(-config.lookbackWeeks);
  const { highs, lows } = weeklyPivots(recent, config.pivotRadius);
  const hh = lastTwoRising(highs);
  const hl = lastTwoRising(lows);
  const hhhl = hh === true && hl === true;

  const w26 = weeks.slice(-26);
  const max26 = Math.max(...w26.map((week) => week.high));
  const min26 = Math.min(...w26.map((week) => week.low));
  const rng26Pct = min26 > 0 ? ((max26 / min26) - 1) * 100 : null;
  const tightBox = Number.isFinite(rng26Pct) && rng26Pct <= config.box26MaxPct;
  const wideTrend = Number.isFinite(rng26Pct) && rng26Pct >= config.trend26MinPct;
  const nearHigh = Number.isFinite(distResistancePct) && distResistancePct >= config.shallowPullPct;

  const metrics = {
    resistance,
    resistanceDate: resBar?.date || "",
    distResistancePct,
    rng26Pct,
    ruptura,
    hh,
    hl,
    hhhl,
  };

  let structure = STRUCTURE_NA;
  let detail = "";
  if (stageState === "stage1" && !ruptura) {
    structure = STRUCTURE_E2_MA_ONLY;
    detail = `código ${stageState}; cierre aún bajo techo ${resBar.date}`;
  } else if (tightBox && !ruptura) {
    structure = STRUCTURE_E2_MA_ONLY;
    detail = `caja 26s ${rng26Pct.toFixed(0)}% bajo techo ${resBar.date} (${Number.isFinite(distResistancePct) ? `${distResistancePct.toFixed(1)}%` : "sin dato"}); E2_ma_only, sin fuga`;
  } else if (ruptura && hhhl) {
    structure = STRUCTURE_E2_STRUCTURAL;
    detail = `fuga sobre ${resBar.date} + HH/HL`;
  } else if (wideTrend && nearHigh && hhhl && stageState === "stage2") {
    structure = STRUCTURE_E2_STRUCTURAL;
    detail = `tendencia 26s ${rng26Pct.toFixed(0)}% (no caja), cerca del techo, HH/HL`;
  } else if (ruptura && !hhhl) {
    detail = `fuga sobre ${resBar.date} sin HH/HL`;
  } else if (wideTrend && !nearHigh) {
    detail = `avance 26s ${rng26Pct.toFixed(0)}% pero lejos del techo ${resBar.date}`;
  } else {
    detail = `ni caja ≤${config.box26MaxPct}% ni fuga+HH/HL (rng26=${Number.isFinite(rng26Pct) ? rng26Pct.toFixed(0) : "?"}%)`;
  }

  return withLabel({
    structure,
    ...metrics,
    detail,
  });
}

export function weeklyStageStructureFields(struct = {}) {
  const structure = struct.structure || STRUCTURE_NA;
  return {
    weeklyStageStructure: structure,
    weeklyStageStructureLabel: struct.label || STRUCTURE_LABELS[structure] || "",
    weeklyStageStructureDetail: struct.detail || "",
    weeklyResistance: struct.resistance ?? null,
    weeklyResistanceDate: struct.resistanceDate || "",
    weeklyDistResistancePct: struct.distResistancePct ?? null,
    weeklyRng26Pct: struct.rng26Pct ?? null,
    weeklyRuptura: struct.ruptura ?? null,
    weeklyHhHl: struct.hhhl ?? null,
  };
}
