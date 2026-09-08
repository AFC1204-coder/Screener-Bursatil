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

/** Semanas previas a la fuga para la mediana de volumen (STAGE-4). */
export const BREAKOUT_VOL_PRIOR_WEEKS = 4;

/** Referencia visual Weinstein (~2×); no condiciona el calificador «Con fuga». */
export const BREAKOUT_VOL_REFERENCE_THRESHOLD = 2;

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

function median(values = []) {
  const xs = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function findFirstBreakoutWeekIndex(weeksAsc, resistance, startIndex, endIndex) {
  if (!Number.isFinite(resistance) || resistance <= 0) return null;
  for (let i = startIndex; i <= endIndex; i += 1) {
    const close = finite(weeksAsc[i]?.close);
    if (close !== null && close > resistance) return i;
  }
  return null;
}

/**
 * Ratio volumen semana de fuga / mediana de las 4 semanas previas.
 * No altera structure ni labels.
 */
export function weeklyBreakoutVolMetricsFromWeeks(weeksAsc = [], resistance, options = {}) {
  const config = { ...DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS, ...options };
  const recentStart = Math.max(0, weeksAsc.length - config.lookbackWeeks);
  const endIndex = weeksAsc.length - 1;
  const breakoutIdx = findFirstBreakoutWeekIndex(weeksAsc, resistance, recentStart, endIndex);
  if (breakoutIdx === null) {
    return { ratio: null, weekDate: "", detail: "sin semana de fuga puntual" };
  }
  if (breakoutIdx < BREAKOUT_VOL_PRIOR_WEEKS) {
    return {
      ratio: null,
      weekDate: weeksAsc[breakoutIdx]?.date || "",
      detail: "histórico insuficiente para mediana de 4 semanas previas",
    };
  }
  const priorVols = [];
  for (let offset = 1; offset <= BREAKOUT_VOL_PRIOR_WEEKS; offset += 1) {
    const vol = finite(weeksAsc[breakoutIdx - offset]?.volume);
    if (vol === null || vol <= 0) {
      return {
        ratio: null,
        weekDate: weeksAsc[breakoutIdx]?.date || "",
        detail: "volumen semanal ausente en las 4 semanas previas",
      };
    }
    priorVols.push(vol);
  }
  const breakoutVol = finite(weeksAsc[breakoutIdx]?.volume);
  if (breakoutVol === null || breakoutVol <= 0) {
    return {
      ratio: null,
      weekDate: weeksAsc[breakoutIdx]?.date || "",
      detail: "volumen ausente en la semana de fuga",
    };
  }
  const priorMedian = median(priorVols);
  if (priorMedian === null || priorMedian <= 0) {
    return {
      ratio: null,
      weekDate: weeksAsc[breakoutIdx]?.date || "",
      detail: "mediana de volumen previo no calculable",
    };
  }
  return {
    ratio: breakoutVol / priorMedian,
    weekDate: weeksAsc[breakoutIdx]?.date || "",
    detail: "",
  };
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
    breakoutVolRatio: null,
    breakoutVolWeek: "",
    breakoutVolDetail: "",
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
  let structuralVia = "";
  let detail = "";
  if (stageState === "stage1" && !ruptura) {
    structure = STRUCTURE_E2_MA_ONLY;
    detail = `código ${stageState}; cierre aún bajo techo ${resBar.date}`;
  } else if (tightBox && !ruptura) {
    structure = STRUCTURE_E2_MA_ONLY;
    detail = `caja 26s ${rng26Pct.toFixed(0)}% bajo techo ${resBar.date} (${Number.isFinite(distResistancePct) ? `${distResistancePct.toFixed(1)}%` : "sin dato"}); E2_ma_only, sin fuga`;
  } else if (ruptura && hhhl) {
    structure = STRUCTURE_E2_STRUCTURAL;
    structuralVia = "breakout";
    detail = `fuga sobre ${resBar.date} + HH/HL`;
  } else if (wideTrend && nearHigh && hhhl && stageState === "stage2") {
    structure = STRUCTURE_E2_STRUCTURAL;
    structuralVia = "wide_trend";
    detail = `tendencia 26s ${rng26Pct.toFixed(0)}% (no caja), cerca del techo, HH/HL`;
  } else if (ruptura && !hhhl) {
    detail = `fuga sobre ${resBar.date} sin HH/HL`;
  } else if (wideTrend && !nearHigh) {
    detail = `avance 26s ${rng26Pct.toFixed(0)}% pero lejos del techo ${resBar.date}`;
  } else {
    detail = `ni caja ≤${config.box26MaxPct}% ni fuga+HH/HL (rng26=${Number.isFinite(rng26Pct) ? rng26Pct.toFixed(0) : "?"}%)`;
  }

  let breakoutVolRatio = null;
  let breakoutVolWeek = "";
  let breakoutVolDetail = "";
  if (structure === STRUCTURE_E2_STRUCTURAL) {
    const volMetrics = weeklyBreakoutVolMetricsFromWeeks(weeks, resistance, config);
    if (structuralVia === "wide_trend" && volMetrics.detail === "sin semana de fuga puntual") {
      breakoutVolDetail = volMetrics.detail;
    } else {
      breakoutVolRatio = volMetrics.ratio;
      breakoutVolWeek = volMetrics.weekDate;
      breakoutVolDetail = volMetrics.detail;
    }
  }

  return withLabel({
    structure,
    ...metrics,
    breakoutVolRatio,
    breakoutVolWeek,
    breakoutVolDetail,
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
    weeklyBreakoutVolRatio: struct.breakoutVolRatio ?? null,
    weeklyBreakoutVolWeek: struct.breakoutVolWeek || "",
    weeklyBreakoutVolDetail: struct.breakoutVolDetail || "",
  };
}
