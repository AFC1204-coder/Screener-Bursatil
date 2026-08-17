// lib/weeklyStage.js — la etapa de Weinstein, criterio estricto.
//
// La etapa se decide SOLO con la relación del precio con su media de 30
// semanas y la pendiente de esa media. Nada más. Esa es la definición de la
// escuela y es lo que el usuario espera al leer "Etapa 2".
//
// Antes había un tercer requisito —precio sobre la media de 10 semanas y esa
// media sobre la de 30— que no es de la metodología: es el Trend Template de
// Minervini, que mide salud de corto plazo, no fase del ciclo. Sigue en el
// producto, con su nombre, como filtro aparte (lib/trendStructure.js).
// Ver docs/diseno-salud-y-cambio-2026-08-16.md (D.14) y
// docs/auditoria-etapas-2026-08-16.md (C-4, C-6, C-7, C-9, C-10).
//
// Las cuatro etapas existen. Antes solo había dos ("stage2"/"stage4") más dos
// categorías que no son etapas ("base"/"mixed") y que se llevaban el 42,5%
// del universo. Distinguir la etapa 1 de la 3 exige saber qué hacía la media
// ANTES de aplanarse: ese es `slowMaPriorSlopePct`, el ingrediente nuevo.
export const DEFAULT_WEEKLY_STAGE_SETTINGS = {
  fastWeeks: 10,
  slowWeeks: 30,
  slopeWeeks: 10,
  // Banda muerta de la pendiente: |pendiente| <= flatPct => la media está
  // plana. Sin banda, una media que se mueve un 0,05% en diez semanas caía en
  // "ascendente" o "descendente" según el signo del ruido, y un valor con la
  // media plana y el precio pegado a ella acababa etiquetado "Etapa 4"
  // (caso ABVX, -0,06%). La escuela no publica ningún número para "plana":
  // este umbral es decisión de producto y es configurable.
  flatPct: 2,
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

function clampFloat(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeWeeklyStageSettings(settings = {}) {
  const fastWeeks = clampInt(settings.stageFastWeeks ?? settings.fastWeeks, DEFAULT_WEEKLY_STAGE_SETTINGS.fastWeeks, 2, 80);
  const rawSlow = clampInt(settings.stageSlowWeeks ?? settings.slowWeeks, DEFAULT_WEEKLY_STAGE_SETTINGS.slowWeeks, 3, 120);
  const slowWeeks = Math.max(rawSlow, fastWeeks + 1);
  const slopeWeeks = clampInt(settings.stageSlopeWeeks ?? settings.slopeWeeks, DEFAULT_WEEKLY_STAGE_SETTINGS.slopeWeeks, 2, 40);
  const flatPct = clampFloat(settings.stageFlatPct ?? settings.flatPct, DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct, 0, 20);
  return { fastWeeks, slowWeeks, slopeWeeks, flatPct };
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

function pctText(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}%` : "sin dato";
}

/**
 * Clasifica la etapa con el criterio estricto. Reglas, en orden:
 *
 *   |pend| <= flatPct            -> media plana
 *        pendAnterior < 0        -> ETAPA 1 (base)     confirmada
 *        pendAnterior > 0        -> ETAPA 3 (techo)    confirmada
 *        pendAnterior sin dato   -> etapa 1 o 3        sin contexto
 *   pend >  flatPct  y  P > MM   -> ETAPA 2 (avance)   confirmada
 *   pend < -flatPct  y  P < MM   -> ETAPA 4 (declive)  confirmada
 *   pend >  flatPct  y  P < MM   -> ETAPA 3            tentativa
 *   pend < -flatPct  y  P > MM   -> ETAPA 1            tentativa
 *
 * Confirmada frente a tentativa = quién ha cambiado primero, el precio o la
 * media. Si la media YA se aplanó, el hecho estructural ocurrió y la etapa 1
 * o 3 está confirmada. Si el precio ha cruzado la media pero la media sigue
 * en la dirección anterior, el precio ha roto y la media todavía no lo ha
 * confirmado: es tentativa. Las etapas 2 y 4 no tienen tentativa por
 * construcción — son los dos estados en los que precio y media apuntan al
 * mismo sitio.
 */
function stageLabel({ price, slowMa, slowMaSlopePct, slowMaPriorSlopePct, slowWeeks, slopeWeeks, flatPct }) {
  if (![price, slowMa, slowMaSlopePct].every(Number.isFinite)) {
    return {
      state: "insufficient_history",
      confirmation: "insufficient_history",
      label: "Historico semanal insuficiente",
      detail: `Requiere al menos ${slowWeeks + slopeWeeks} semanas para clasificar con la media de ${slowWeeks} semanas.`,
    };
  }
  const above = price > slowMa;
  const sideText = above ? `precio sobre la media de ${slowWeeks} semanas` : `precio bajo la media de ${slowWeeks} semanas`;
  const slopeText = `pendiente ${pctText(slowMaSlopePct)} en ${slopeWeeks} semanas`;

  if (Math.abs(slowMaSlopePct) <= flatPct) {
    if (!Number.isFinite(slowMaPriorSlopePct)) {
      return {
        state: above ? "stage1" : "stage3",
        confirmation: "unknown_context",
        label: above ? "Etapa 1 sin contexto" : "Etapa 3 sin contexto",
        detail: `Media de ${slowWeeks} semanas plana (${slopeText}), pero faltan ${slowWeeks + 3 * slopeWeeks} semanas de histórico para saber si viene de subida o de caída.`,
      };
    }
    if (slowMaPriorSlopePct < 0) {
      return {
        state: "stage1",
        confirmation: "confirmed",
        label: "Etapa 1 confirmada",
        detail: `Media de ${slowWeeks} semanas plana (${slopeText}) tras venir cayendo (${pctText(slowMaPriorSlopePct)} en las ${2 * slopeWeeks} semanas anteriores).`,
      };
    }
    return {
      state: "stage3",
      confirmation: "confirmed",
      label: "Etapa 3 confirmada",
      detail: `Media de ${slowWeeks} semanas plana (${slopeText}) tras venir subiendo (${pctText(slowMaPriorSlopePct)} en las ${2 * slopeWeeks} semanas anteriores).`,
    };
  }

  if (slowMaSlopePct > flatPct) {
    if (above) {
      return {
        state: "stage2",
        confirmation: "confirmed",
        label: "Etapa 2 confirmada",
        detail: `Precio sobre la media de ${slowWeeks} semanas y media ascendente (${slopeText}).`,
      };
    }
    return {
      state: "stage3",
      confirmation: "tentative",
      label: "Etapa 3 tentativa",
      detail: `El precio ha perdido la media de ${slowWeeks} semanas, pero la media sigue ascendente (${slopeText}): el precio ha roto y la media aún no lo confirma.`,
    };
  }

  if (!above) {
    return {
      state: "stage4",
      confirmation: "confirmed",
      label: "Etapa 4 confirmada",
      detail: `Precio bajo la media de ${slowWeeks} semanas y media descendente (${slopeText}).`,
    };
  }
  return {
    state: "stage1",
    confirmation: "tentative",
    label: "Etapa 1 tentativa",
    detail: `El precio ha recuperado la media de ${slowWeeks} semanas, pero la media sigue descendente (${slopeText}): el precio ha roto y la media aún no lo confirma.`,
  };
}

function stageAtOffset(weeks = [], offset = 0, config = DEFAULT_WEEKLY_STAGE_SETTINGS) {
  const price = finite(weeks[offset]?.close);
  const fastMa = sma(weeks, config.fastWeeks, offset);
  const slowMa = sma(weeks, config.slowWeeks, offset);
  const slowMaPrevious = sma(weeks, config.slowWeeks, offset + config.slopeWeeks);
  // La media DOS ventanas más atrás: con ella se mide qué hacía la media
  // antes del tramo actual, que es lo único que distingue una etapa 1 (plana
  // tras caer) de una etapa 3 (plana tras subir).
  const slowMaPrior = sma(weeks, config.slowWeeks, offset + 3 * config.slopeWeeks);
  const slowMaSlopePct = Number.isFinite(slowMa) && Number.isFinite(slowMaPrevious) && slowMaPrevious > 0
    ? ((slowMa / slowMaPrevious) - 1) * 100
    : null;
  const slowMaPriorSlopePct = Number.isFinite(slowMaPrevious) && Number.isFinite(slowMaPrior) && slowMaPrior > 0
    ? ((slowMaPrevious / slowMaPrior) - 1) * 100
    : null;
  return {
    price,
    fastMa,
    slowMa,
    slowMaPrevious,
    slowMaPrior,
    slowMaSlopePct,
    slowMaPriorSlopePct,
    classification: stageLabel({ price, slowMa, slowMaSlopePct, slowMaPriorSlopePct, ...config }),
  };
}

function consecutiveWeeksInStage(weeks = [], config = DEFAULT_WEEKLY_STAGE_SETTINGS, currentState = "") {
  if (!currentState || currentState === "insufficient_history") return null;
  let count = 0;
  for (let offset = 0; offset < weeks.length; offset += 1) {
    const state = stageAtOffset(weeks, offset, config).classification.state;
    if (state !== currentState) break;
    count += 1;
  }
  return count || null;
}

export function weeklyStageForBars(bars = [], settings = {}) {
  const config = normalizeWeeklyStageSettings(settings);
  const weeks = weeklyBarsFromDaily(bars);
  const current = stageAtOffset(weeks, 0, config);
  const price = current.price ?? finite(bars[0]?.close);
  const state = current.classification;
  return {
    ...config,
    weeklyBars: weeks.length,
    weeklyPrice: price,
    fastMa: current.fastMa,
    slowMa: current.slowMa,
    slowMaPrevious: current.slowMaPrevious,
    slowMaPrior: current.slowMaPrior,
    slowMaSlopePct: current.slowMaSlopePct,
    slowMaPriorSlopePct: current.slowMaPriorSlopePct,
    distanceFastMaPct: pctDistance(price, current.fastMa),
    distanceSlowMaPct: pctDistance(price, current.slowMa),
    priceAboveFastMa: Number.isFinite(price) && Number.isFinite(current.fastMa) ? price > current.fastMa : null,
    priceAboveSlowMa: Number.isFinite(price) && Number.isFinite(current.slowMa) ? price > current.slowMa : null,
    fastAboveSlowMa: Number.isFinite(current.fastMa) && Number.isFinite(current.slowMa) ? current.fastMa > current.slowMa : null,
    state: state.state,
    confirmation: state.confirmation,
    label: state.label,
    detail: state.detail,
    weekInStage: consecutiveWeeksInStage(weeks, config, state.state),
    asOf: weeks[0]?.date || bars[0]?.date || "",
  };
}

export function weeklyStageFields(stage = {}) {
  const out = {
    weeklyStage: stage,
    weeklyStageState: stage.state || "",
    weeklyStageConfirmation: stage.confirmation || "",
    weeklyStageLabel: stage.label || "",
    weeklyStageWeek: stage.weekInStage ?? null,
    weeklyFastWeeks: stage.fastWeeks ?? null,
    weeklySlowWeeks: stage.slowWeeks ?? null,
    weeklySlopeWeeks: stage.slopeWeeks ?? null,
    weeklyFlatPct: stage.flatPct ?? null,
    weeklyFastMa: stage.fastMa ?? null,
    weeklySlowMa: stage.slowMa ?? null,
    weeklySlowMaSlope: stage.slowMaSlopePct ?? null,
    weeklySlowMaPriorSlope: stage.slowMaPriorSlopePct ?? null,
    weeklyPriceAboveSlowMa: stage.priceAboveSlowMa ?? null,
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
