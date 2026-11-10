// lib/reviewRsDisplay.js — copy corto de ausencia RS en ficha Review.
//
// Los lectores (rsCanonical / countryRs / themeRs) ya traen `available`,
// `reason` y `hydrated`. Aquí solo se clasifica el estado y se elige un texto
// corto legible; el motivo completo sigue en `title` (tooltip).
// Tono alineado con avisos del chart («Sin línea RS: …»).

import { isScore } from "@/lib/scoreValue";

export const REVIEW_RS_SHORT = Object.freeze({
  loading: "Cargando…",
  not_ranked: "Sin ranking",
  no_history: "Sin histórico",
  error: "Error",
});

// Copy COMPACTO para celdas estrechas (cinta Caza 40–48 px, cola del modal).
// «Sin histórico» junto a un sparkline con 12 meses de serie confundía: lo
// que falta en esa columna es el RS, y el porqué (serie corta, split sin
// ajustar, fuera del ranking…) va al title. Cargando usa puntos suspensivos.
export const REVIEW_RS_COMPACT = Object.freeze({
  loading: "…",
  not_ranked: "Sin RS",
  no_history: "Sin RS",
  error: "Sin RS",
});

/**
 * Celda RS compacta: mismo contrato que reviewRsCell pero con el copy corto
 * de REVIEW_RS_COMPACT y un title que siempre explica el estado.
 */
export function reviewRsCompactCell(rs = {}, opts = {}) {
  const cell = reviewRsCell(rs, opts);
  if (!cell.missing) return cell;
  const longLabel = REVIEW_RS_SHORT[cell.state] || REVIEW_RS_SHORT.error;
  const title = cell.title
    ? (cell.state === "loading" ? cell.title : `${longLabel} · ${cell.title}`)
    : longLabel;
  return {
    ...cell,
    text: REVIEW_RS_COMPACT[cell.state] || REVIEW_RS_COMPACT.error,
    title,
  };
}

/**
 * Clasifica la ausencia de un resultado RS ({ available, reason, hydrated }).
 * @returns {"available"|"loading"|"not_ranked"|"no_history"|"error"}
 */
export function classifyReviewRsState(rs = {}) {
  if (rs?.available) return "available";

  const reason = String(rs?.reason || "").trim();

  // Fila sin hidratar: el reason canónico habla de «en esta vista».
  if (/en esta vista:\s*la fila no trae cargado/i.test(reason)) {
    return "loading";
  }
  if (!reason) {
    return rs?.hydrated === true ? "error" : "loading";
  }

  // Motivos concretos de histórico / serie (antes del genérico «no entra…»).
  if (
    /no hay suficiente histórico|se necesitan \d+ semanas/i.test(reason)
    || /salto sin ajustar|posible split/i.test(reason)
  ) {
    return "no_history";
  }

  // FX / conversión: error operativo, no ranking.
  if (
    /tipo de cambio|conversión USD|divisa de cotización|serie del tipo de cambio/i.test(reason)
  ) {
    return "error";
  }

  if (
    /no entra en el ranking|no entra en el universo del ranking|no está en el universo|fuera del universo/i.test(reason)
    || /aún no tiene ranking|ya no está en la taxonomía|clasificación residual|sector\/industria/i.test(reason)
    || /menos de \d+ valores computables/i.test(reason)
  ) {
    return "not_ranked";
  }

  return "error";
}

/**
 * Celda RS para ficha / cola Review.
 * @param {{ available?: boolean, value?: number|null, reason?: string, hydrated?: boolean }} rs
 * @param {{ availableTitle?: string }} [opts]
 */
export function reviewRsCell(rs = {}, { availableTitle = "" } = {}) {
  // isScore: un `available` con value null no puede pintarse como «0».
  if (rs?.available && isScore(rs.value)) {
    return {
      state: "available",
      text: Number(rs.value).toFixed(0),
      title: String(availableTitle || ""),
      missing: false,
      className: "",
    };
  }

  const state = classifyReviewRsState({ ...rs, available: false });
  const shortKey = state === "available" ? "error" : state;
  return {
    state: shortKey,
    text: REVIEW_RS_SHORT[shortKey] || REVIEW_RS_SHORT.error,
    title: String(rs?.reason || "").trim(),
    missing: true,
    className: "reviewRsMissing",
  };
}
