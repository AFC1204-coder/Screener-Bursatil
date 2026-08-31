// lib/trendSupport.js — lecturas de sostén de tendencia (MET-4b).
// Tres muletas descriptivas: persistencia de medias semanales, aceleración
// de precio y reparto de volumen. Funciones puras; la ficha y el scan las
// comparten. No alimentan scoring ni etapa (lib/weeklyStage.js intacto).

import { DESCRIPTIVE_ABSENCE, slopeWord } from "@/lib/descriptiveStrip";
import { detectPriceDiscontinuities, perf, udVol } from "@/lib/indicators";
import {
  UP_DOWN_VOLUME_RATIO_BALANCED,
  UP_DOWN_VOLUME_THRESHOLD,
} from "@/lib/marketVolume";
import {
  DEFAULT_WEEKLY_STAGE_SETTINGS,
  normalizeWeeklyStageSettings,
  weeklyBarsFromDaily,
  weeklyStageForBars,
} from "@/lib/weeklyStage";

export const TREND_SUPPORT_MAX_WEEKS = 104;
export const ADVANCE_DEAD_BAND_PP = 5;
export const PRICE_DISCONTINUITY_FACTOR = 3;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

// Réplica literal de lib/weeklyStage.js:sma — misma convención de barras
// semanales (índice 0 = semana más reciente).
function sma(bars = [], length, offset = 0) {
  return bars.length >= length + offset
    ? avg(bars.slice(offset, offset + length).map((bar) => finite(bar.close)))
    : null;
}

export function formatWeeksCount(count) {
  const n = finite(count);
  if (n === null || n <= 0) return "";
  if (n > TREND_SUPPORT_MAX_WEEKS) return `≥${TREND_SUPPORT_MAX_WEEKS}`;
  return String(Math.round(n));
}

/**
 * Semanas consecutivas con el cierre del mismo lado de la media (encima o
 * debajo), contando desde la última semana cerrada. Un cierre del otro lado
 * resetea el contador.
 */
export function consecutiveWeeksRelativeToMa(weeks = [], maWeeks = 30) {
  const length = Math.round(Number(maWeeks));
  if (!Array.isArray(weeks) || !weeks.length || !Number.isFinite(length) || length < 2) {
    return { count: null, above: null };
  }
  const price0 = finite(weeks[0]?.close);
  const ma0 = sma(weeks, length, 0);
  if (!Number.isFinite(price0) || !Number.isFinite(ma0)) {
    return { count: null, above: null };
  }
  const above = price0 > ma0;
  let count = 0;
  for (let offset = 0; offset < weeks.length; offset += 1) {
    const price = finite(weeks[offset]?.close);
    const ma = sma(weeks, length, offset);
    if (!Number.isFinite(price) || !Number.isFinite(ma)) break;
    if ((price > ma) !== above) break;
    count += 1;
  }
  return { count: count > 0 ? count : null, above };
}

export function advancePriorPct(perf3m, perf6m) {
  const recent = finite(perf3m);
  const six = finite(perf6m);
  if (recent === null || six === null) return null;
  const denom = 1 + recent / 100;
  if (denom <= 0) return null;
  return ((1 + six / 100) / denom - 1) * 100;
}

export function advanceAccelerationWord(recent, prior, deadBand = ADVANCE_DEAD_BAND_PP) {
  const r1 = finite(recent);
  const r0 = finite(prior);
  const band = finite(deadBand) ?? ADVANCE_DEAD_BAND_PP;
  if (r1 === null || r0 === null) return { word: "", delta: null };
  const delta = r1 - r0;
  if (Math.abs(delta) <= band) return { word: "mantiene", delta };
  return { word: delta > 0 ? "acelera" : "se frena", delta };
}

export function volumeSupportWord(ratio) {
  const n = finite(ratio);
  if (n === null) return { word: "", available: false };
  if (n >= UP_DOWN_VOLUME_THRESHOLD) return { word: "acompaña", available: true };
  if (n >= UP_DOWN_VOLUME_RATIO_BALANCED) return { word: "neutro", available: true };
  return { word: "en contra", available: true };
}

function pctSigned(value) {
  const n = finite(value);
  if (n === null) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
}

export function trendSupportFieldsFromBars(bars = [], options = {}) {
  const config = normalizeWeeklyStageSettings(options);
  const weeks = weeklyBarsFromDaily(bars);
  const slow = consecutiveWeeksRelativeToMa(weeks, config.slowWeeks);
  const fast = consecutiveWeeksRelativeToMa(weeks, config.fastWeeks);
  const advanceRecentPct = perf(bars, 63);
  const advancePriorPctValue = advancePriorPct(advanceRecentPct, perf(bars, 126));
  return {
    weeksAboveSma30w: slow.count,
    weeksAboveSma30wAbove: slow.above,
    weeksAboveSma10w: fast.count,
    weeksAboveSma10wAbove: fast.above,
    advanceRecentPct,
    advancePriorPct: advancePriorPctValue,
  };
}

function persistenceLine(weeks, weekly, config) {
  const slowWeeks = config.slowWeeks ?? DEFAULT_WEEKLY_STAGE_SETTINGS.slowWeeks;
  const fastWeeks = config.fastWeeks ?? DEFAULT_WEEKLY_STAGE_SETTINGS.fastWeeks;
  const slow = consecutiveWeeksRelativeToMa(weeks, slowWeeks);
  if (weekly?.state === "insufficient_history" || slow.count === null) {
    return {
      key: "persistence",
      available: false,
      text: "",
      reason: DESCRIPTIVE_ABSENCE.supportInsufficientHistory,
    };
  }
  const sideWord = slow.above ? "Sobre" : "Bajo";
  const slope = slopeWord(weekly?.slowMaSlopePct, weekly?.flatPct ?? DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct);
  const slopePart = slope ? ` (media ${slope})` : "";
  let text = `${sideWord} la media de ${slowWeeks} semanas: ${formatWeeksCount(slow.count)} semanas${slopePart}`;
  const fast = consecutiveWeeksRelativeToMa(weeks, fastWeeks);
  if (fast.count === 1 && fast.above === false && slow.above === true) {
    text = `Perdió la media de ${fastWeeks} semanas esta semana`;
  } else if (fast.count !== null && fastWeeks !== slowWeeks && fast.above === false && slow.above === true) {
    text += ` · Bajo la media de ${fastWeeks} semanas: ${formatWeeksCount(fast.count)} semanas`;
  }
  return { key: "persistence", available: true, text, reason: "" };
}

function accelerationLine(bars, row = {}) {
  const discontinuity = detectPriceDiscontinuities(bars, PRICE_DISCONTINUITY_FACTOR);
  if (discontinuity.discontinuous) {
    return {
      key: "acceleration",
      available: false,
      text: "",
      reason: DESCRIPTIVE_ABSENCE.accelDiscontinuous,
    };
  }
  const recent = finite(row.advanceRecentPct) ?? perf(bars, 63);
  const prior = finite(row.advancePriorPct) ?? advancePriorPct(recent, finite(row.perf6m) ?? perf(bars, 126));
  if (recent === null || prior === null) {
    return {
      key: "acceleration",
      available: false,
      text: "",
      reason: DESCRIPTIVE_ABSENCE.accelInsufficientHistory,
    };
  }
  const { word } = advanceAccelerationWord(recent, prior);
  const text = `Avance: ${word} (${pctSigned(recent)} últimos 3 meses vs ${pctSigned(prior)} los 3 anteriores)`;
  return { key: "acceleration", available: true, text, reason: "" };
}

function volumeLine(row = {}, bars = []) {
  const ratio = finite(row.upDownVolRatio) ?? udVol(bars, 50);
  const wordState = volumeSupportWord(ratio);
  if (!wordState.available) {
    return {
      key: "volume",
      available: false,
      text: "",
      reason: DESCRIPTIVE_ABSENCE.volumeCoverage,
    };
  }
  const text = `Volumen: ${wordState.word} (${ratio.toFixed(1).replace(".", ",")}× up/down, 50 sesiones)`;
  return { key: "volume", available: true, text, reason: "" };
}

/**
 * Construye las tres líneas de «Sostén de la tendencia» para la ficha.
 * Acepta barras diarias (descendentes) y campos de fila opcionales.
 */
export function buildTrendSupportLines(bars = [], row = {}, options = {}) {
  const config = normalizeWeeklyStageSettings(options);
  const weeks = weeklyBarsFromDaily(bars);
  const weekly = row.stage?.weekly || weeklyStageForBars(bars, options);
  return {
    title: "Sostén de la tendencia",
    lines: [
      persistenceLine(weeks, weekly, config),
      accelerationLine(bars, row),
      volumeLine(row, bars),
    ],
  };
}
