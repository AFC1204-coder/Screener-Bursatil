// Caducidad del régimen de mercado (auditoría de producto 2026-11, D3).
//
// /api/market-health sirve la caché que haya aunque tenga semanas
// (`freshness.cacheStale`), y ningún componente lo miraba: la cabecera de
// Mercado, el «Estado sectorial» de Sectores y el filtro «Régimen» del
// screener presentaban un veredicto del 22 de septiembre como actual.
//
// Única regla para todos los consumidores, pura y sin red:
//   - La fecha que manda es la de los DATOS (el último cierre de los índices),
//     no la de la caché: `cacheStale` se enciende a las 4 horas y apagaría el
//     régimen cada tarde aunque los cierres fueran de ayer.
//   - Caducado = DATA_AGE_MAX_MISSED_WEEKDAYS (2) sesiones hábiles completas
//     sin cierre nuevo, el mismo umbral que el aviso de precios del screener
//     (lib/dataAge.js). Caducado ⇒ sin adjetivo, sin color y sin score.
//   - Sin payload, payload degradado (proveedor caído, régimen neutral
//     inventado) o sin fecha que juzgar ⇒ «Sin datos de mercado».

import { DATA_AGE_MAX_MISSED_WEEKDAYS, missedWeekdays } from "@/lib/dataAge";

export const MARKET_NO_DATA_TEXT = "Sin datos de mercado";
export const REGIME_MAX_MISSED_SESSIONS = DATA_AGE_MAX_MISSED_WEEKDAYS;

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function isoDay(value) {
  const match = ISO_DAY.exec(String(value || ""));
  return match ? match[0] : "";
}

/** «22 sep» a partir de YYYY-MM-DD. */
export function shortDayEs(isoDate) {
  const match = ISO_DAY.exec(String(isoDate || ""));
  if (!match) return "";
  return `${Number(match[3])} ${MONTHS_ES[Number(match[2]) - 1]}`;
}

/** Último cierre (YYYY-MM-DD) de una lista de instrumentos con `lastDate`. */
export function latestLastDate(items = []) {
  let latest = "";
  for (const item of Array.isArray(items) ? items : []) {
    const day = isoDay(item?.lastDate);
    if (day && day > latest) latest = day;
  }
  return latest;
}

/**
 * Frescura de una fecha de datos: { asOf, asOfLabel, missedSessions, stale }.
 * Sin fecha → asOf "" y stale true (no se puede presentar como actual).
 */
export function dataDateFreshness(isoDate, now = new Date()) {
  const asOf = isoDay(isoDate);
  if (!asOf) return { asOf: "", asOfLabel: "", missedSessions: null, stale: true };
  const missed = missedWeekdays(asOf, now);
  return {
    asOf,
    asOfLabel: shortDayEs(asOf),
    missedSessions: missed,
    stale: missed >= REGIME_MAX_MISSED_SESSIONS,
  };
}

function isDegraded(payload) {
  return !payload || typeof payload !== "object" || payload.degraded === true;
}

/**
 * Lectura del régimen principal lista para pintar.
 * status: "fresh" | "stale" | "missing". Solo "fresh" trae etiqueta, color y
 * score; los otros dos devuelven null en esos campos para que ningún consumidor
 * pueda pintarlos por descuido.
 */
export function assessMarketRegime(payload, { now = new Date() } = {}) {
  const missing = {
    status: "missing",
    usable: false,
    asOf: "",
    asOfLabel: "",
    missedSessions: null,
    dateText: "",
    headline: MARKET_NO_DATA_TEXT,
    stance: "No hay una lectura de índices con la que juzgar el régimen.",
    regimeLabel: null,
    regimeColor: null,
    marketScore: null,
    tone: "humo",
  };
  if (isDegraded(payload)) return missing;
  const freshness = dataDateFreshness(latestLastDate(payload.indexes), now);
  if (!freshness.asOf) return missing;
  const base = {
    asOf: freshness.asOf,
    asOfLabel: freshness.asOfLabel,
    missedSessions: freshness.missedSessions,
    dateText: `Índices al ${freshness.asOfLabel}`,
  };
  if (freshness.stale) {
    return {
      ...base,
      status: "stale",
      usable: false,
      headline: `Régimen sin actualizar desde el ${freshness.asOfLabel}`,
      stance: `Los índices llevan ${freshness.missedSessions} sesiones sin cierre nuevo; el veredicto de esa fecha no se muestra como actual.`,
      regimeLabel: null,
      regimeColor: null,
      marketScore: null,
      tone: "humo",
    };
  }
  const label = payload.regime?.label || "";
  const score = Number(payload.marketScore);
  return {
    ...base,
    status: label ? "fresh" : "missing",
    usable: Boolean(label),
    headline: label || MARKET_NO_DATA_TEXT,
    stance: payload.regime?.stance || "",
    regimeLabel: label || null,
    regimeColor: payload.regime?.color || null,
    marketScore: Number.isFinite(score) ? score : null,
    tone: null,
  };
}

/** El payload solo si su régimen es vigente; si no, null (filtro, sellos). */
export function usableMarketHealth(payload, options = {}) {
  return assessMarketRegime(payload, options).usable ? payload : null;
}

/** Sello de régimen para snapshots y favoritos: nunca un veredicto caducado. */
export function regimeStamp(payload, options = {}) {
  const read = assessMarketRegime(payload, options);
  return read.usable
    ? { marketScore: read.marketScore, marketRegime: read.regimeLabel }
    : { marketScore: null, marketRegime: "sin dato" };
}

/** Nota discreta de la fila «Régimen» del filtro: "" si el filtro aplica o está apagado. */
export function regimeFilterNote(payload, enabled, options = {}) {
  if (!enabled) return "";
  const read = assessMarketRegime(payload, options);
  if (read.usable) return "";
  if (read.status === "stale") return `sin aplicar: régimen sin actualizar desde el ${read.asOfLabel}`;
  return "sin aplicar: sin datos de mercado";
}

/** Fecha y estado propios de la cinta sectorial (ETF SPDR) del mismo payload. */
export function assessSectorTape(payload, { now = new Date() } = {}) {
  const sectors = Array.isArray(payload?.sectorTape) ? payload.sectorTape : [];
  if (isDegraded(payload) || !sectors.length) {
    return { status: "missing", asOf: "", asOfLabel: "", dateText: "", note: MARKET_NO_DATA_TEXT };
  }
  const freshness = dataDateFreshness(latestLastDate(sectors), now);
  if (!freshness.asOf) return { status: "missing", asOf: "", asOfLabel: "", dateText: "", note: MARKET_NO_DATA_TEXT };
  return {
    status: freshness.stale ? "stale" : "fresh",
    asOf: freshness.asOf,
    asOfLabel: freshness.asOfLabel,
    dateText: freshness.stale
      ? `Sin actualizar desde el ${freshness.asOfLabel}`
      : `ETF sectoriales al ${freshness.asOfLabel}`,
    note: "",
  };
}
