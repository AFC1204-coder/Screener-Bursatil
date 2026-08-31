// lib/stageHealth.js — índice 0–100 de salud de etapa (MET-5b).
// Suma ponderada de cinco componentes; solo Etapas 2 y 4. Sin scoring.
// Fórmula única compartida con scripts/stage-health-calibrate.mjs.

import { DESCRIPTIVE_ABSENCE } from "@/lib/descriptiveStrip";
import { detectPriceDiscontinuities } from "@/lib/indicators";
import {
  UP_DOWN_VOLUME_RATIO_BALANCED,
  UP_DOWN_VOLUME_THRESHOLD,
} from "@/lib/marketVolume";
import {
  ADVANCE_DEAD_BAND_PP,
  advancePriorPct,
  PRICE_DISCONTINUITY_FACTOR,
  trendSupportFieldsFromBars,
} from "@/lib/trendSupport";
import { weeklyStageForBars } from "@/lib/weeklyStage";

export const STAGE_HEALTH_WEIGHTS = {
  persistence30: 25,
  persistence10: 10,
  acceleration: 20,
  volume: 25,
  extension: 20,
};

export const STAGE_HEALTH_PERSISTENCE_30_SAT = 26;
export const STAGE_HEALTH_PERSISTENCE_10_SAT = 10;
export const STAGE_HEALTH_EXTENSION_GOOD_PCT = 15;
export const STAGE_HEALTH_EXTENSION_BAD_PCT = 50;

export const STAGE_HEALTH_ABSENCE_CODES = {
  STAGE_MISSING: "health-stage-missing",
  NON_TRENDING: "health-non-trending-stage",
  ACCEL_HISTORY: "health-accel-history",
  DISCONTINUOUS: "health-discontinuous",
  VOLUME_COVERAGE: "health-volume-coverage",
};

const ABSENCE_REASONS = {
  [STAGE_HEALTH_ABSENCE_CODES.STAGE_MISSING]: DESCRIPTIVE_ABSENCE.healthStageMissing,
  [STAGE_HEALTH_ABSENCE_CODES.NON_TRENDING]: DESCRIPTIVE_ABSENCE.healthNonTrendingStage,
  [STAGE_HEALTH_ABSENCE_CODES.ACCEL_HISTORY]: DESCRIPTIVE_ABSENCE.healthAccelHistory,
  [STAGE_HEALTH_ABSENCE_CODES.DISCONTINUOUS]: DESCRIPTIVE_ABSENCE.healthDiscontinuous,
  [STAGE_HEALTH_ABSENCE_CODES.VOLUME_COVERAGE]: DESCRIPTIVE_ABSENCE.healthVolumeCoverage,
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stageSideAbove(stageState) {
  return stageState === "stage2";
}

export function persistence30Subscore(weeks) {
  const n = finite(weeks);
  if (n === null || n <= 0) return null;
  return Math.min(n / STAGE_HEALTH_PERSISTENCE_30_SAT, 1);
}

export function persistence10Subscore(weeks, weeksAbove, stageState) {
  const n = finite(weeks);
  const above = weeksAbove;
  const expectedAbove = stageSideAbove(stageState);
  if (n === null || n <= 0 || above === null) return null;
  if (above !== expectedAbove) return 0;
  return Math.min(n / STAGE_HEALTH_PERSISTENCE_10_SAT, 1);
}

export function accelerationSubscore(recent, prior, stageState) {
  const r1 = finite(recent);
  const r0 = finite(prior);
  if (r1 === null || r0 === null) return null;
  const delta = r1 - r0;
  const directed = stageState === "stage4" ? -delta : delta;
  if (directed > ADVANCE_DEAD_BAND_PP) return 1;
  if (Math.abs(directed) <= ADVANCE_DEAD_BAND_PP) return 0.75;
  return 0;
}

export function volumeSubscore(ratio, stageState) {
  const n = finite(ratio);
  if (n === null) return null;
  if (stageState === "stage2") {
    if (n >= UP_DOWN_VOLUME_THRESHOLD) return 1;
    if (n >= UP_DOWN_VOLUME_RATIO_BALANCED) return 0.6;
    return 0;
  }
  if (n < UP_DOWN_VOLUME_RATIO_BALANCED) return 1;
  if (n < UP_DOWN_VOLUME_THRESHOLD) return 0.6;
  return 0;
}

export function extensionSubscore(distanceSlowMaPct) {
  const e = Math.abs(finite(distanceSlowMaPct) ?? NaN);
  if (!Number.isFinite(e)) return null;
  if (e <= STAGE_HEALTH_EXTENSION_GOOD_PCT) return 1;
  if (e >= STAGE_HEALTH_EXTENSION_BAD_PCT) return 0;
  return (STAGE_HEALTH_EXTENSION_BAD_PCT - e)
    / (STAGE_HEALTH_EXTENSION_BAD_PCT - STAGE_HEALTH_EXTENSION_GOOD_PCT);
}

function distanceSlowMaPctFromRow(row = {}) {
  return finite(row.distanceSma30w)
    ?? finite(row.weeklyDistanceSlowMa)
    ?? finite(row.weeklyStage?.distanceSlowMaPct);
}

function trendFieldsFromRow(row = {}, bars = [], options = {}) {
  const fromRow = {
    weeksAboveSma30w: row.weeksAboveSma30w,
    weeksAboveSma30wAbove: row.weeksAboveSma30wAbove,
    weeksAboveSma10w: row.weeksAboveSma10w,
    weeksAboveSma10wAbove: row.weeksAboveSma10wAbove,
    advanceRecentPct: row.advanceRecentPct,
    advancePriorPct: row.advancePriorPct,
  };
  const hasTrend = Object.values(fromRow).some((value) => value !== undefined && value !== null);
  if (hasTrend) return fromRow;
  return trendSupportFieldsFromBars(bars, options);
}

function absenceResult(code) {
  return {
    available: false,
    score: null,
    absenceCode: code,
    reason: ABSENCE_REASONS[code] || "",
  };
}

/**
 * Calcula salud de etapa. Todo-o-nada: si falta un componente, no hay índice.
 */
export function computeStageHealth(row = {}, trend = {}, bars = []) {
  const stageState = String(row.weeklyStageState || "").trim();

  if (stageState === "insufficient_history" || !stageState) {
    return absenceResult(STAGE_HEALTH_ABSENCE_CODES.STAGE_MISSING);
  }
  if (stageState !== "stage2" && stageState !== "stage4") {
    return absenceResult(STAGE_HEALTH_ABSENCE_CODES.NON_TRENDING);
  }

  const discontinuity = detectPriceDiscontinuities(bars, PRICE_DISCONTINUITY_FACTOR);
  if (discontinuity.discontinuous) {
    return absenceResult(STAGE_HEALTH_ABSENCE_CODES.DISCONTINUOUS);
  }

  const recent = finite(row.perf3m) ?? finite(trend.advanceRecentPct) ?? finite(row.advanceRecentPct);
  const prior = finite(trend.advancePriorPct)
    ?? finite(row.advancePriorPct)
    ?? advancePriorPct(recent, finite(row.perf6m));
  if (recent === null || prior === null) {
    return absenceResult(STAGE_HEALTH_ABSENCE_CODES.ACCEL_HISTORY);
  }

  const volumeRatio = finite(row.upDownVolRatio) ?? finite(trend.upDownVolRatio);
  if (volumeRatio === null) {
    return absenceResult(STAGE_HEALTH_ABSENCE_CODES.VOLUME_COVERAGE);
  }

  const distance = distanceSlowMaPctFromRow(row);
  const components = {
    persistence30: persistence30Subscore(trend.weeksAboveSma30w),
    persistence10: persistence10Subscore(
      trend.weeksAboveSma10w,
      trend.weeksAboveSma10wAbove,
      stageState,
    ),
    acceleration: accelerationSubscore(recent, prior, stageState),
    volume: volumeSubscore(volumeRatio, stageState),
    extension: extensionSubscore(distance),
  };

  const missing = Object.entries(components).filter(([, value]) => value === null).map(([key]) => key);
  if (missing.length) {
    if (missing.includes("acceleration")) {
      return { ...absenceResult(STAGE_HEALTH_ABSENCE_CODES.ACCEL_HISTORY), components };
    }
    if (missing.includes("volume")) {
      return { ...absenceResult(STAGE_HEALTH_ABSENCE_CODES.VOLUME_COVERAGE), components };
    }
    return { ...absenceResult(STAGE_HEALTH_ABSENCE_CODES.STAGE_MISSING), components };
  }

  const points = {
    persistence30: components.persistence30 * STAGE_HEALTH_WEIGHTS.persistence30,
    persistence10: components.persistence10 * STAGE_HEALTH_WEIGHTS.persistence10,
    acceleration: components.acceleration * STAGE_HEALTH_WEIGHTS.acceleration,
    volume: components.volume * STAGE_HEALTH_WEIGHTS.volume,
    extension: components.extension * STAGE_HEALTH_WEIGHTS.extension,
  };
  const score = Math.round(
    points.persistence30
    + points.persistence10
    + points.acceleration
    + points.volume
    + points.extension,
  );

  return {
    available: true,
    stageState,
    score,
    absenceCode: null,
    reason: "",
    components,
    points,
  };
}

export function formatStageHealthBreakdown(health = {}) {
  if (!health.available || !health.points) return "";
  const p = health.points;
  const w = STAGE_HEALTH_WEIGHTS;
  return [
    `media 30 sem ${p.persistence30.toFixed(1)} de ${w.persistence30}`,
    `media 10 sem ${p.persistence10.toFixed(1)} de ${w.persistence10}`,
    `avance ${p.acceleration.toFixed(1)} de ${w.acceleration}`,
    `volumen ${p.volume.toFixed(1)} de ${w.volume}`,
    `extensión ${p.extension.toFixed(1)} de ${w.extension}`,
  ].join(" · ");
}

export function stageHealthFieldsFromBars(bars = [], row = {}, options = {}) {
  const weekly = row.stage?.weekly || weeklyStageForBars(bars, options);
  const trend = trendFieldsFromRow(row, bars, options);
  const healthRow = {
    weeklyStageState: row.weeklyStageState || weekly.state || "",
    perf3m: row.perf3m,
    perf6m: row.perf6m,
    upDownVolRatio: row.upDownVolRatio,
    distanceSma30w: distanceSlowMaPctFromRow({ ...row, weeklyStage: weekly }),
    weeklyDistanceSlowMa: weekly.distanceSlowMaPct,
    advanceRecentPct: row.advanceRecentPct,
    advancePriorPct: row.advancePriorPct,
  };
  const health = computeStageHealth(healthRow, trend, bars);
  return {
    stageHealthScore: health.available ? health.score : null,
    stageHealthAbsenceCode: health.absenceCode,
  };
}

/**
 * Línea de ficha: número + desglose accesible; ausencias honestas.
 */
export function buildStageHealthLine(bars = [], row = {}, options = {}) {
  const weekly = row.stage?.weekly || weeklyStageForBars(bars, options);
  const trend = trendFieldsFromRow(row, bars, options);
  const healthRow = {
    weeklyStageState: row.weeklyStageState || weekly.state || "",
    perf3m: row.perf3m ?? row.advanceRecentPct,
    perf6m: row.perf6m,
    upDownVolRatio: row.upDownVolRatio,
    distanceSma30w: distanceSlowMaPctFromRow({ ...row, weeklyStage: weekly }),
    weeklyDistanceSlowMa: weekly.distanceSlowMaPct,
    advanceRecentPct: row.advanceRecentPct,
    advancePriorPct: row.advancePriorPct,
  };
  const health = computeStageHealth(healthRow, trend, bars);
  return {
    available: health.available,
    score: health.score,
    breakdown: formatStageHealthBreakdown(health),
    reason: health.reason,
    absenceCode: health.absenceCode,
  };
}

export const STAGE_HEALTH_METHODOLOGY = {
  title: "Salud de etapa",
  question: "¿Con qué solidez sostiene el valor la etapa en la que está?",
  scope: "Solo Etapas 2 y 4. Entero 0–100, suma ponderada; sin semáforo ni categorías con nombre.",
  formula: "salud = redondeo(25·persistencia30 + 10·persistencia10 + 20·aceleración + 25·volumen + 20·extensión)",
  components: [
    {
      key: "persistence30",
      label: "Persistencia media 30 sem",
      weight: STAGE_HEALTH_WEIGHTS.persistence30,
      ramp: `min(semanas en lado de etapa / ${STAGE_HEALTH_PERSISTENCE_30_SAT}, 1)`,
    },
    {
      key: "persistence10",
      label: "Persistencia media 10 sem",
      weight: STAGE_HEALTH_WEIGHTS.persistence10,
      ramp: `si el cierre está en el lado de etapa: min(semanas / ${STAGE_HEALTH_PERSISTENCE_10_SAT}, 1); si no, 0`,
    },
    {
      key: "acceleration",
      label: "Aceleración",
      weight: STAGE_HEALTH_WEIGHTS.acceleration,
      ramp: `delta' = avance reciente − previo (invertido en Etapa 4); > ${ADVANCE_DEAD_BAND_PP} pp → 1 · |delta'| ≤ ${ADVANCE_DEAD_BAND_PP} pp → 0,75 · < −${ADVANCE_DEAD_BAND_PP} pp → 0`,
    },
    {
      key: "volume",
      label: "Volumen up/down 50 sesiones",
      weight: STAGE_HEALTH_WEIGHTS.volume,
      ramp: `Etapa 2: ≥ ${UP_DOWN_VOLUME_THRESHOLD} → 1 · ${UP_DOWN_VOLUME_RATIO_BALANCED}–${UP_DOWN_VOLUME_THRESHOLD} → 0,6 · < ${UP_DOWN_VOLUME_RATIO_BALANCED} → 0. Etapa 4: espejo con las mismas constantes.`,
    },
    {
      key: "extension",
      label: "Extensión sobre media 30 sem",
      weight: STAGE_HEALTH_WEIGHTS.extension,
      ramp: `e = |distancia|; e ≤ ${STAGE_HEALTH_EXTENSION_GOOD_PCT}% → 1 · ${STAGE_HEALTH_EXTENSION_GOOD_PCT}% < e < ${STAGE_HEALTH_EXTENSION_BAD_PCT}% → (${STAGE_HEALTH_EXTENSION_BAD_PCT} − e) / ${STAGE_HEALTH_EXTENSION_BAD_PCT - STAGE_HEALTH_EXTENSION_GOOD_PCT} · e ≥ ${STAGE_HEALTH_EXTENSION_BAD_PCT}% → 0`,
    },
  ],
  mirrorStage4: "En Etapa 4 los mismos números se leen en la dirección del declive: aceleración con signo invertido y volumen con umbrales espejo.",
  workedExample: {
    stage: "Etapa 2 confirmada",
    inputs: "23 sem sobre media 30 · 8 sem sobre media 10 · avance mantiene · volumen 1,4× · extensión +12%",
    breakdown: "22,1 + 8 + 15 + 25 + 20",
    score: 90,
  },
  allOrNothing: "Si falta cualquier componente, no hay índice — solo motivo de ausencia. Sin renormalizar ni imputar neutros.",
};
