// lib/themeRs.js — LECTOR del RS tema (ranking semanal intra-ocupación, MET-3b).
//
// Paralelo a lib/countryRs.js y lib/rsCanonical.js. El percentil de lote
// rsSectorPct de enrichRelativePercentiles NO es RS tema de producto.
//
// Solo lectura sobre weeklyThemeRs* ya hidratados. Hidratación en themeRsHydrate.js.

import {
  isRankableThemeKey,
  rankableThemeForProfile,
  THEME_PROFILE_MISSING,
  THEME_RESIDUAL,
} from "@/lib/themeRsAssign";
import { themeRsDisclosure, themeRsEngineVersion } from "@/lib/rsEngines";

export const THEME_RS_SOURCE = "rs_weekly_items";
export const THEME_RS_LABEL = "RS tema";

export const THEME_RS_NOT_HYDRATED_REASON = "Sin RS tema en esta vista: la fila no trae cargado el ranking semanal de su ocupación.";
export const THEME_RS_NOT_RANKED_REASON = "Sin RS tema semanal: este símbolo no entra en el ranking de su ocupación (histórico insuficiente, serie discontinua o fuera del universo curado).";

const THEME_EXCLUSION_TEXT = {
  "theme-profile-missing": "Sin RS tema: no hay sector/industria/summary suficientes para asignar ocupación.",
  "theme-residual": "Sin RS tema: clasificación residual (no es una de las 12 ocupaciones curadas).",
  "theme-sample-insufficient": "Sin RS tema: la ocupación tiene menos de 20 valores computables esta semana.",
  "theme-not-supported": "Sin RS tema: la ocupación ya no está en la taxonomía curada.",
  "not-in-universe": "Sin RS tema: el símbolo no está en el universo privado curado.",
  "insufficient-bars": "Sin RS tema semanal: no hay suficiente histórico de precios (se necesitan 52 semanas).",
  discontinuous: "Sin RS tema semanal: la serie de precios tiene un salto sin ajustar (posible split).",
  "discontinuous-series": "Sin RS tema semanal: la serie de precios tiene un salto sin ajustar (posible split).",
  "fx-unavailable": "Sin RS tema: conversión USD no apta (sin serie FX).",
  "fx-stale": "Sin RS tema: conversión USD no apta (FX obsoleto).",
  "fx-discontinuous": "Sin RS tema: conversión USD no apta (serie FX discontinua).",
  "fx-currency-unknown": "Sin RS tema: conversión USD no apta (divisa desconocida).",
};

export function themeExclusionReasonText(code = "", detail = "") {
  const base = THEME_EXCLUSION_TEXT[String(code || "").trim()] || "";
  if (!base) return "";
  const extra = String(detail || "").trim();
  if (extra && code === "theme-sample-insufficient") return `${base} (${extra})`;
  return base;
}

function pick(row, key) {
  if (!row || typeof row !== "object") return undefined;
  if (row[key] !== undefined && row[key] !== null) return row[key];
  if (row.snapshot?.[key] !== undefined && row.snapshot?.[key] !== null) return row.snapshot[key];
  if (row.metrics?.[key] !== undefined && row.metrics?.[key] !== null) return row.metrics[key];
  if (row.raw?.[key] !== undefined && row.raw?.[key] !== null) return row.raw[key];
  return undefined;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hydrationFlag(row) {
  const flat = row?.weeklyThemeRsAvailable;
  if (flat === true || flat === false) return flat;
  const nested = row?.snapshot?.weeklyThemeRsAvailable
    ?? row?.metrics?.weeklyThemeRsAvailable
    ?? row?.raw?.weeklyThemeRsAvailable;
  if (nested === true || nested === false) return nested;
  return undefined;
}

export function themeProfileFromRow(row = {}) {
  return {
    sector: String(pick(row, "sector") || "").trim(),
    industry: String(pick(row, "industry") || "").trim(),
    summary: String(pick(row, "businessSummary") || "").trim(),
  };
}

export function themeKeyForRow(row = {}) {
  const uiTheme = String(pick(row, "theme") || "").trim();
  if (isRankableThemeKey(uiTheme)) return uiTheme;
  const { sector, industry, summary } = themeProfileFromRow(row);
  const ranked = rankableThemeForProfile(sector, industry, summary);
  if (ranked.themeKey) return ranked.themeKey;
  return null;
}

export function themeRsAssignmentForRow(row = {}) {
  // Preferir theme de producto ya en la fila (screener/lista ligera) cuando es
  // una de las 12 THEME_RULES. Sin esto, filas con theme curado pero sin
  // sector/summary en proyección ligera caen en theme-profile-missing y nunca
  // hidratan el ranking semanal aunque exista en rs_weekly_items.
  const uiTheme = String(pick(row, "theme") || "").trim();
  if (isRankableThemeKey(uiTheme)) {
    return { themeKey: uiTheme, exclusionReason: null, exclusionDetail: "" };
  }
  const { sector, industry, summary } = themeProfileFromRow(row);
  const ranked = rankableThemeForProfile(sector, industry, summary);
  if (ranked.themeKey) {
    return { themeKey: ranked.themeKey, exclusionReason: null, exclusionDetail: "" };
  }
  if (ranked.exclusionReason === THEME_PROFILE_MISSING) {
    return { themeKey: null, exclusionReason: THEME_PROFILE_MISSING, exclusionDetail: "" };
  }
  return { themeKey: null, exclusionReason: THEME_RESIDUAL, exclusionDetail: uiTheme };
}

/**
 * @returns {{available: boolean, value: number|null, reason: string, hydrated: boolean,
 *   asOf: string, weekKey: string, rank: number|null, sampleSize: number|null,
 *   themeKey: string, engineVersion: string, source: string}}
 */
export function themeRs(row = {}) {
  const assignment = themeRsAssignmentForRow(row);
  const themeKey = assignment.themeKey || "";
  const flag = hydrationFlag(row);
  const value = finite(pick(row, "weeklyThemeRsRating"));

  if (assignment.exclusionReason === THEME_PROFILE_MISSING || assignment.exclusionReason === THEME_RESIDUAL) {
    return {
      available: false,
      value: null,
      reason: themeExclusionReasonText(assignment.exclusionReason) || THEME_RS_NOT_RANKED_REASON,
      hydrated: flag !== undefined,
      asOf: "",
      weekKey: "",
      rank: null,
      sampleSize: null,
      themeKey: "",
      engineVersion: "",
      source: THEME_RS_SOURCE,
    };
  }

  if (flag === true && value !== null) {
    const resolvedTheme = String(pick(row, "weeklyThemeRsThemeKey") || themeKey || "");
    return {
      available: true,
      value,
      reason: "",
      hydrated: true,
      asOf: String(pick(row, "weeklyThemeRsAsOf") || ""),
      weekKey: String(pick(row, "weeklyThemeRsWeekKey") || ""),
      rank: finite(pick(row, "weeklyThemeRsRank")),
      sampleSize: finite(pick(row, "weeklyThemeRsSampleSize")),
      themeKey: resolvedTheme,
      engineVersion: String(pick(row, "weeklyThemeRsEngineVersion") || themeRsEngineVersion(resolvedTheme)),
      source: THEME_RS_SOURCE,
    };
  }

  const hydrated = flag !== undefined;
  const persistedCode = String(pick(row, "weeklyThemeRsExclusionReason") || "").trim();
  const persistedDetail = String(pick(row, "weeklyThemeRsExclusionDetail") || "").trim();
  const persistedReason = String(pick(row, "weeklyThemeRsReason") || "");
  const reasonFromCode = themeExclusionReasonText(persistedCode, persistedDetail);
  return {
    available: false,
    value: null,
    reason: hydrated
      ? (reasonFromCode || persistedReason || THEME_RS_NOT_RANKED_REASON)
      : THEME_RS_NOT_HYDRATED_REASON,
    hydrated,
    asOf: "",
    weekKey: "",
    rank: null,
    sampleSize: null,
    themeKey: themeKey || String(pick(row, "weeklyThemeRsThemeKey") || ""),
    engineVersion: "",
    source: THEME_RS_SOURCE,
  };
}

export function themeRsValue(row = {}) {
  return themeRs(row).value;
}

export function themeRsReason(row = {}) {
  return themeRs(row).reason;
}

export const THEME_RS_SORT_ABSENT = -1;

export function themeRsSortValue(row = {}) {
  const value = themeRsValue(row);
  return value === null ? THEME_RS_SORT_ABSENT : value;
}

/** Adjunta campos weeklyThemeRs* a una fila (puro; usable en tests y server). */
export function attachWeeklyThemeRs(row, weeklyThemeRsBySymbol) {
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  const entry = weeklyThemeRsBySymbol?.get(symbol);
  const assignment = themeRsAssignmentForRow(row);
  const themeKey = assignment.themeKey || entry?.themeKey || "";

  if (assignment.exclusionReason === THEME_PROFILE_MISSING || assignment.exclusionReason === THEME_RESIDUAL) {
    return {
      ...row,
      weeklyThemeRsAvailable: false,
      weeklyThemeRsRating: null,
      weeklyThemeRsRaw: null,
      weeklyThemeRsRank: null,
      weeklyThemeRsSampleSize: null,
      weeklyThemeRsAsOf: null,
      weeklyThemeRsWeekKey: null,
      weeklyThemeRsEngineVersion: null,
      weeklyThemeRsThemeKey: null,
      weeklyThemeRsReason: themeExclusionReasonText(assignment.exclusionReason) || null,
      weeklyThemeRsExclusionReason: assignment.exclusionReason,
      weeklyThemeRsExclusionDetail: assignment.exclusionDetail || null,
    };
  }

  if (entry?.available) {
    return {
      ...row,
      weeklyThemeRsAvailable: true,
      weeklyThemeRsRating: entry.rsRating,
      weeklyThemeRsRaw: entry.rsRaw,
      weeklyThemeRsRank: entry.rank,
      weeklyThemeRsSampleSize: entry.sampleSize,
      weeklyThemeRsAsOf: entry.asOf,
      weeklyThemeRsWeekKey: entry.weekKey,
      weeklyThemeRsEngineVersion: entry.engineVersion || themeRsEngineVersion(themeKey),
      weeklyThemeRsThemeKey: entry.themeKey || themeKey,
      weeklyThemeRsReason: null,
      weeklyThemeRsExclusionReason: null,
      weeklyThemeRsExclusionDetail: null,
    };
  }

  const code = entry?.exclusionReason || "";
  const detail = entry?.exclusionDetail || "";
  return {
    ...row,
    weeklyThemeRsAvailable: false,
    weeklyThemeRsRating: null,
    weeklyThemeRsRaw: null,
    weeklyThemeRsRank: null,
    weeklyThemeRsSampleSize: null,
    weeklyThemeRsAsOf: null,
    weeklyThemeRsWeekKey: null,
    weeklyThemeRsEngineVersion: null,
    weeklyThemeRsThemeKey: themeKey || null,
    weeklyThemeRsReason: entry?.reason || themeExclusionReasonText(code, detail) || null,
    weeklyThemeRsExclusionReason: code || null,
    weeklyThemeRsExclusionDetail: detail || null,
  };
}

export { themeRsDisclosure };
