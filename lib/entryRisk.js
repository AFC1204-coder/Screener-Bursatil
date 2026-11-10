// lib/entryRisk.js — «decidir la entrada» (auditoría de producto 2026-11,
// propuesta 2). Funciones puras: pivote, distancia al pivote, stop de
// referencia, % de riesgo hasta el stop y tamaño de posición.
//
// Solo hechos, nunca una señal: no hay «comprar», ni colores de compra, ni
// puntuación. Todo sale de campos que el sistema ya calcula:
//   - pivote               → `pivotPrice` (lib/setupPatterns.js: máximo de las
//                            65 sesiones previas). No se calcula otro.
//   - distancia al pivote  → `distanceToPivotPct` tal cual viene en la fila.
//   - stop de referencia   → el mínimo de la última contracción
//                            (`lastContractionLow`, o el último `low` válido de
//                            `contractionSwings`, el mismo criterio que
//                            lib/tradePlan.js) y, si no existe, la media de 10
//                            semanas (`weeklyFastMa`, solo si es de 10 semanas).
//   - % de riesgo          → (precio − stop) / precio.
// Si falta cualquiera de los datos, el valor es null y la interfaz pinta «—»:
// ningún stop inventado, ningún 0 en lugar de un dato ausente
// (lib/scoreValue.js → isScore).

import { isScore } from "@/lib/scoreValue";
import { num, pct, pctShare, priceMoney } from "@/lib/formatters";

/** Zona de entrada (dato neutro): del pivote hasta +5 %. */
export const ENTRY_ZONE_PCT = 5;
/** Aviso de la calculadora: la posición supera este % del capital. */
export const POSITION_WARN_PCT_OF_CAPITAL = 25;
/** Aviso: el riesgo hasta el stop supera este %. */
export const STOP_RISK_WARN_PCT = 10;
/** Riesgo por operación por defecto en la calculadora (% del capital). */
export const DEFAULT_RISK_PER_TRADE_PCT = 1;
/** Semanas de la media que hace de stop alternativo. */
export const STOP_MA_WEEKS = 10;

export const STOP_SOURCES = Object.freeze({
  contraction: {
    key: "contraction",
    short: "mín. última contracción",
    title: "Stop de referencia: mínimo de la última contracción de la base",
  },
  ma10w: {
    key: "ma10w",
    short: "MM10s",
    title: "Stop de referencia: media móvil de 10 semanas (no hay mínimo de la última contracción)",
  },
});

export const ENTRY_ABSENT = "—";

function positive(value) {
  if (!isScore(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/**
 * Mínimo de la última contracción: el campo escalar del nocturno si existe;
 * si no, el último `low` válido de `contractionSwings` (filas completas).
 * Las contracciones van de la más antigua a la más reciente.
 */
export function lastContractionLowFromRow(row = {}) {
  const direct = positive(row?.lastContractionLow);
  if (direct != null) return direct;
  const swings = Array.isArray(row?.contractionSwings) ? row.contractionSwings : [];
  for (let i = swings.length - 1; i >= 0; i -= 1) {
    const low = positive(swings[i]?.low);
    if (low != null) return low;
  }
  return null;
}

/**
 * Media de 10 semanas de la fila. `weeklyFastMa` es la media rápida del motor
 * de etapas; solo cuenta si es de 10 semanas (`weeklyFastWeeks` 10 o ausente).
 * `sma10w` es el alias que escribe weeklyStageFields.
 */
export function weeklyMa10FromRow(row = {}) {
  const weeks = row?.weeklyFastWeeks;
  const fastIs10 = !isScore(weeks) || Number(weeks) === STOP_MA_WEEKS;
  if (fastIs10) {
    const fast = positive(row?.weeklyFastMa);
    if (fast != null) return fast;
  }
  return positive(row?.sma10w);
}

/**
 * Stop de referencia y su origen. No compara con el precio: eso lo decide
 * entryRiskForRow (un stop por encima del precio no es un stop).
 * @returns {{ value: number, source: "contraction"|"ma10w" }|null}
 */
export function stopReferenceForRow(row = {}) {
  const low = lastContractionLowFromRow(row);
  if (low != null) return { value: low, source: "contraction" };
  const ma = weeklyMa10FromRow(row);
  if (ma != null) return { value: ma, source: "ma10w" };
  return null;
}

/** % de riesgo desde el precio hasta el stop. Null si no es medible. */
export function riskToStopPct(price, stop) {
  const p = positive(price);
  const s = positive(stop);
  if (p == null || s == null || s >= p) return null;
  return ((p - s) / p) * 100;
}

/**
 * Lectura de entrada de una fila. Cada campo es null si falta su dato.
 * - stop: null también si el stop de referencia está en o por encima del
 *   precio (no hay riesgo medible); `stopReference` lo conserva para el title.
 * - inEntryZone: true/false solo con distancia; null sin ella.
 */
export function entryRiskForRow(row = {}) {
  const price = positive(row?.price);
  const pivot = positive(row?.pivotPrice);
  const distanceToPivotPct = isScore(row?.distanceToPivotPct) ? Number(row.distanceToPivotPct) : null;
  const reference = stopReferenceForRow(row);
  const stopUsable = Boolean(reference && price != null && reference.value < price);
  const stop = stopUsable ? reference.value : null;
  const riskPct = stopUsable ? riskToStopPct(price, stop) : null;
  const zoneHigh = pivot != null ? pivot * (1 + ENTRY_ZONE_PCT / 100) : null;
  let inEntryZone = null;
  if (distanceToPivotPct != null) inEntryZone = distanceToPivotPct >= 0 && distanceToPivotPct <= ENTRY_ZONE_PCT;
  let stopIssue = "";
  if (!reference) stopIssue = "missing";
  else if (price == null) stopIssue = "no-price";
  else if (!stopUsable) stopIssue = "at-or-above-price";
  return {
    price,
    pivot,
    distanceToPivotPct,
    zoneLow: pivot,
    zoneHigh,
    inEntryZone,
    stop,
    stopSource: stopUsable ? reference.source : null,
    stopReference: reference,
    stopIssue,
    riskPct,
    riskOverLimit: riskPct != null ? riskPct > STOP_RISK_WARN_PCT : false,
  };
}

// ── Formato (lib/formatters, es-ES; mismo criterio que la cinta: «-4,0%») ──

function signedPct(n, digits = 1) {
  return Number.isFinite(n) ? pct(n, digits) : ENTRY_ABSENT;
}

function plainPct(n, digits = 1) {
  return Number.isFinite(n) ? pctShare(n, digits) : ENTRY_ABSENT;
}

/** Precio con la divisa SOLO si la fila la trae; si no, sin símbolo. */
export function entryPrice(n, currency = "") {
  return Number.isFinite(n) ? priceMoney(n, String(currency || "").trim()) : ENTRY_ABSENT;
}

export function formatEntryPct(n) {
  return signedPct(n);
}

export function formatRiskPct(n) {
  return plainPct(n);
}

/** Texto del origen del stop para títulos: «mín. última contracción» / «MM10s». */
export function stopSourceLabel(source) {
  return STOP_SOURCES[source]?.short || "";
}

function stopMissingTitle(entry, currency) {
  if (entry.stopIssue === "missing") return "sin stop: no hay mínimo de la última contracción ni media de 10 semanas";
  if (entry.stopIssue === "no-price") return "sin precio: riesgo no medible";
  if (entry.stopIssue === "at-or-above-price" && entry.stopReference) {
    return `riesgo no medible: el precio está en o por debajo de la referencia ${entryPrice(entry.stopReference.value, currency)} (${stopSourceLabel(entry.stopReference.source)})`;
  }
  return "";
}

/**
 * Chip de la cinta: «-4,0% · R 6,8%». Distancia o riesgo ausentes → «—» en su
 * hueco; sin ninguno de los dos → solo «—». El title lo cuenta entero:
 * «Pivote 218,40 · a -4,0% del pivote · riesgo 6,8% al stop 203,50 (mín. última contracción)».
 */
export function entryChipForRow(row = {}) {
  const entry = entryRiskForRow(row);
  const currency = row?.currency || "";
  const distText = entry.distanceToPivotPct != null ? signedPct(entry.distanceToPivotPct) : ENTRY_ABSENT;
  const riskText = entry.riskPct != null ? plainPct(entry.riskPct) : ENTRY_ABSENT;
  const hasDist = entry.distanceToPivotPct != null;
  const hasRisk = entry.riskPct != null;
  const titleParts = [];
  titleParts.push(entry.pivot != null ? `Pivote ${entryPrice(entry.pivot, currency)}` : "Sin pivote");
  if (hasDist) titleParts.push(`a ${distText} del pivote`);
  if (hasRisk) {
    titleParts.push(`riesgo ${riskText} al stop ${entryPrice(entry.stop, currency)} (${stopSourceLabel(entry.stopSource)})`);
  } else {
    const why = stopMissingTitle(entry, currency);
    if (why) titleParts.push(why);
  }
  if (entry.inEntryZone === true) titleParts.push(`dentro de la zona pivote–+${ENTRY_ZONE_PCT}%`);
  return {
    entry,
    empty: !hasDist && !hasRisk,
    distText,
    riskText,
    hasDist,
    hasRisk,
    text: !hasDist && !hasRisk ? ENTRY_ABSENT : `${distText} · R ${riskText}`,
    title: titleParts.join(" · "),
  };
}

// ── Calculadora de posición ────────────────────────────────────────────────

/**
 * Número escrito por el usuario (es-ES o en): «10.000», «10.000,5», «1,5»,
 * «1.5», «2500». Vacío o no numérico → null.
 */
export function parseDecimalInput(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "").trim().replace(/[\s %]/g, "");
  if (!text) return null;
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  if (!/^-?\d*(\.\d+)?$/.test(text) || text === "" || text === "-") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tamaño de posición: acciones = (capital × riesgo %) / (precio − stop),
 * redondeado hacia abajo. Devuelve { ok:false, reason } si falta algo.
 * Avisos: posición > 25 % del capital; riesgo al stop > 10 %.
 */
export function positionSize({ capital, riskPerTradePct, price, stop } = {}) {
  const cap = positive(capital);
  const r = positive(riskPerTradePct);
  const p = positive(price);
  const s = positive(stop);
  if (cap == null) return { ok: false, reason: "capital" };
  if (r == null || r > 100) return { ok: false, reason: "risk" };
  if (p == null) return { ok: false, reason: "price" };
  if (s == null) return { ok: false, reason: "stop" };
  if (s >= p) return { ok: false, reason: "stop-above-price" };
  const riskPerShare = p - s;
  const riskBudget = cap * (r / 100);
  const shares = Math.floor(riskBudget / riskPerShare);
  const positionValue = shares * p;
  const pctOfCapital = (positionValue / cap) * 100;
  const stopRiskPct = (riskPerShare / p) * 100;
  const warnings = [];
  if (pctOfCapital > POSITION_WARN_PCT_OF_CAPITAL) warnings.push("position-over-25");
  if (stopRiskPct > STOP_RISK_WARN_PCT) warnings.push("risk-over-10");
  return {
    ok: true,
    shares,
    positionValue,
    pctOfCapital,
    riskBudget,
    riskPerShare,
    stopRiskPct,
    warnings,
  };
}

export const POSITION_WARNING_COPY = Object.freeze({
  "position-over-25": `La posición supera el ${POSITION_WARN_PCT_OF_CAPITAL}% del capital.`,
  "risk-over-10": `El riesgo hasta el stop supera el ${STOP_RISK_WARN_PCT}%.`,
});

export const POSITION_REASON_COPY = Object.freeze({
  capital: "Indica el capital.",
  risk: "Indica el % de riesgo por operación (mayor que 0 y hasta 100).",
  price: "Sin precio: no se puede calcular.",
  stop: "Sin stop de referencia: no se puede calcular.",
  "stop-above-price": "El stop de referencia no está por debajo del precio: no se puede calcular.",
});

export function formatShares(n) {
  return Number.isFinite(n) ? num(n, 0) : ENTRY_ABSENT;
}

// ── Preferencias de la calculadora (localStorage, vía lib/localState) ─────

export const POSITION_CALC_STORAGE_KEY = "statsedge.positionCalc.v1";

/**
 * Lo guardado puede venir corrupto o con otra forma: solo se aceptan números
 * positivos; el riesgo, hasta 100. Lo demás vuelve al valor por defecto.
 */
export function sanitizePositionCalcSettings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const capital = positive(source.capital);
  const risk = positive(source.riskPerTradePct);
  return {
    capital: capital != null && capital < 1e13 ? capital : null,
    riskPerTradePct: risk != null && risk <= 100 ? risk : DEFAULT_RISK_PER_TRADE_PCT,
  };
}
