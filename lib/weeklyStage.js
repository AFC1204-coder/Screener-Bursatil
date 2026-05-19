export const DEFAULT_WEEKLY_STAGE_SETTINGS = {
  fastWeeks: 10,
  slowWeeks: 30,
  slopeWeeks: 10,
};

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function clampInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeWeeklyStageSettings(settings = {}) {
  const fastWeeks = clampInt(settings.stageFastWeeks ?? settings.fastWeeks, DEFAULT_WEEKLY_STAGE_SETTINGS.fastWeeks, 2, 80);
  const rawSlow = clampInt(settings.stageSlowWeeks ?? settings.slowWeeks, DEFAULT_WEEKLY_STAGE_SETTINGS.slowWeeks, 3, 120);
  const slowWeeks = Math.max(rawSlow, fastWeeks + 1);
  const slopeWeeks = clampInt(settings.stageSlopeWeeks ?? settings.slopeWeeks, DEFAULT_WEEKLY_STAGE_SETTINGS.slopeWeeks, 2, 40);
  return { fastWeeks, slowWeeks, slopeWeeks };
}

function weekKey(date = "") {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function weeklyBarsFromDaily(bars = []) {
  const buckets = new Map();
  [...bars]
    .filter((bar) => bar?.date && Number.isFinite(finite(bar.close)))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((bar) => {
      const close = finite(bar.close);
      const high = finite(bar.high) ?? close;
      const low = finite(bar.low) ?? close;
      const key = weekKey(bar.date);
      const bucket = buckets.get(key) || { date: key, close, high, low, volume: 0 };
      bucket.close = close;
      bucket.high = Math.max(bucket.high, high);
      bucket.low = Math.min(bucket.low, low);
      bucket.volume += finite(bar.volume) ?? 0;
      buckets.set(key, bucket);
    });
  return [...buckets.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function sma(bars = [], length, offset = 0) {
  return bars.length >= length + offset ? avg(bars.slice(offset, offset + length).map((bar) => finite(bar.close))) : null;
}

function pctDistance(price, average) {
  return Number.isFinite(price) && Number.isFinite(average) && average > 0 ? ((price / average) - 1) * 100 : null;
}

function stageLabel({ price, fastMa, slowMa, slowMaSlopePct, fastWeeks, slowWeeks }) {
  if (![price, fastMa, slowMa, slowMaSlopePct].every(Number.isFinite)) {
    return {
      state: "insufficient_history",
      label: "Historico semanal insuficiente",
      detail: `Requiere al menos ${slowWeeks} semanas para clasificar con medias ${fastWeeks}W/${slowWeeks}W.`,
    };
  }
  if (price > fastMa && fastMa > slowMa && slowMaSlopePct > 0) {
    return {
      state: "stage2",
      label: "Stage 2 probable",
      detail: `Precio sobre media ${fastWeeks}W, ${fastWeeks}W sobre ${slowWeeks}W y media ${slowWeeks}W ascendente.`,
    };
  }
  if (price < slowMa && slowMaSlopePct < 0) {
    return {
      state: "stage4",
      label: "Stage 4 probable",
      detail: `Precio bajo media ${slowWeeks}W y media ${slowWeeks}W descendente.`,
    };
  }
  if (price > slowMa) {
    return {
      state: "base",
      label: "Base / transicion",
      detail: `Precio sobre media ${slowWeeks}W, pero la alineacion ${fastWeeks}W/${slowWeeks}W aun no confirma Stage 2.`,
    };
  }
  if (price < fastMa && price >= slowMa) {
    return {
      state: "mixed",
      label: "Bajo media rapida",
      detail: `Precio bajo media ${fastWeeks}W, pero aun cerca o sobre media ${slowWeeks}W.`,
    };
  }
  return {
    state: "mixed",
    label: "Debil / mixta",
    detail: `La estructura semanal ${fastWeeks}W/${slowWeeks}W no confirma una etapa clara.`,
  };
}

export function weeklyStageForBars(bars = [], settings = {}) {
  const config = normalizeWeeklyStageSettings(settings);
  const weeks = weeklyBarsFromDaily(bars);
  const price = finite(weeks[0]?.close) ?? finite(bars[0]?.close);
  const fastMa = sma(weeks, config.fastWeeks);
  const slowMa = sma(weeks, config.slowWeeks);
  const slowMaPrevious = sma(weeks, config.slowWeeks, config.slopeWeeks);
  const slowMaSlopePct = Number.isFinite(slowMa) && Number.isFinite(slowMaPrevious) && slowMaPrevious > 0
    ? ((slowMa / slowMaPrevious) - 1) * 100
    : null;
  const state = stageLabel({ price, fastMa, slowMa, slowMaSlopePct, ...config });
  return {
    ...config,
    weeklyBars: weeks.length,
    weeklyPrice: price,
    fastMa,
    slowMa,
    slowMaPrevious,
    slowMaSlopePct,
    distanceFastMaPct: pctDistance(price, fastMa),
    distanceSlowMaPct: pctDistance(price, slowMa),
    priceAboveFastMa: Number.isFinite(price) && Number.isFinite(fastMa) ? price > fastMa : null,
    priceAboveSlowMa: Number.isFinite(price) && Number.isFinite(slowMa) ? price > slowMa : null,
    fastAboveSlowMa: Number.isFinite(fastMa) && Number.isFinite(slowMa) ? fastMa > slowMa : null,
    state: state.state,
    label: state.label,
    detail: state.detail,
    asOf: weeks[0]?.date || bars[0]?.date || "",
  };
}

export function weeklyStageFields(stage = {}) {
  const out = {
    weeklyStage: stage,
    weeklyStageState: stage.state || "",
    weeklyStageLabel: stage.label || "",
    weeklyFastWeeks: stage.fastWeeks ?? null,
    weeklySlowWeeks: stage.slowWeeks ?? null,
    weeklySlopeWeeks: stage.slopeWeeks ?? null,
    weeklyFastMa: stage.fastMa ?? null,
    weeklySlowMa: stage.slowMa ?? null,
    weeklySlowMaSlope: stage.slowMaSlopePct ?? null,
    weeklyDistanceFastMa: stage.distanceFastMaPct ?? null,
    weeklyDistanceSlowMa: stage.distanceSlowMaPct ?? null,
  };
  if (Number.isFinite(stage.fastWeeks)) out[`sma${stage.fastWeeks}w`] = stage.fastMa ?? null;
  if (Number.isFinite(stage.slowWeeks)) {
    out[`sma${stage.slowWeeks}w`] = stage.slowMa ?? null;
    out[`sma${stage.slowWeeks}wSlope`] = stage.slowMaSlopePct ?? null;
    out[`distanceSma${stage.slowWeeks}w`] = stage.distanceSlowMaPct ?? null;
  }
  return out;
}
