// lib/countryRs.js — LECTOR del RS país (ranking semanal intra-mercado, MET-2b).
//
// Paralelo a lib/rsCanonical.js (RS global pinneado). El percentil de lote
// rsCountryPct de enrichRelativePercentiles NO es RS país de producto: cambia
// con cada escaneo y mezcla poblaciones en presets multi-mercado.
//
// Este módulo es SOLO lectura pura sobre campos weeklyCountryRs* ya hidratados.
// La hidratación Supabase vive en lib/countryRsHydrate.js (server-only) para
// no arrastrar node:crypto / supabaseServer al bundle del cliente.

import { countryCode, countryName } from "@/lib/symbols";
import {
  countryRsEngineVersionForMarket,
  isCountryRsMarketSupported,
} from "@/lib/rsEngines";

export const COUNTRY_RS_SOURCE = "rs_weekly_items";
export const COUNTRY_RS_LABEL = "RS país";

export const COUNTRY_RS_NOT_HYDRATED_REASON = "Sin RS país en esta vista: la fila no trae cargado el ranking semanal del mercado del valor.";
export const COUNTRY_RS_NOT_RANKED_REASON = "Sin RS país semanal: este símbolo no entra en el ranking de su mercado (histórico insuficiente, serie discontinua o fuera del universo curado).";
export const COUNTRY_RS_MARKET_UNSUPPORTED_REASON = "Sin RS país: el mercado de este símbolo aún no tiene ranking semanal de país.";

const COUNTRY_EXCLUSION_TEXT = {
  "insufficient-bars": "Sin RS país semanal: no hay suficiente histórico de precios locales (se necesitan 52 semanas).",
  discontinuous: "Sin RS país semanal: la serie de precios local tiene un salto sin ajustar (posible split).",
  "discontinuous-series": "Sin RS país semanal: la serie de precios local tiene un salto sin ajustar (posible split).",
  "not-in-universe": "Sin RS país semanal: el símbolo no está en el universo curado de su mercado.",
  "market-not-supported": COUNTRY_RS_MARKET_UNSUPPORTED_REASON,
};

export function countryExclusionReasonText(code = "") {
  return COUNTRY_EXCLUSION_TEXT[String(code || "").trim()] || "";
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
  const flat = row?.weeklyCountryRsAvailable;
  if (flat === true || flat === false) return flat;
  const nested = row?.snapshot?.weeklyCountryRsAvailable
    ?? row?.metrics?.weeklyCountryRsAvailable
    ?? row?.raw?.weeklyCountryRsAvailable;
  if (nested === true || nested === false) return nested;
  return undefined;
}

export function countryRsMarketForRow(row = {}) {
  return String(row.country || countryCode(row.symbol) || "").trim().toUpperCase();
}

export function countryRsDisclosure(market = "", sampleSize = null, weekKey = "") {
  const code = String(market || "").trim().toUpperCase();
  const name = countryName(code) || code || "mercado";
  const parts = [`RS país · ${name} · universo privado curado`];
  if (Number.isFinite(sampleSize) && sampleSize > 0) parts.push(`${sampleSize} símbolos`);
  if (weekKey) parts.push(`semana ${weekKey}`);
  return parts.join(" · ");
}

/**
 * @returns {{available: boolean, value: number|null, reason: string, hydrated: boolean,
 *   asOf: string, weekKey: string, rank: number|null, sampleSize: number|null,
 *   market: string, engineVersion: string, source: string}}
 */
export function countryRs(row = {}) {
  const market = countryRsMarketForRow(row);
  if (!isCountryRsMarketSupported(market)) {
    return {
      available: false,
      value: null,
      reason: COUNTRY_RS_MARKET_UNSUPPORTED_REASON,
      hydrated: hydrationFlag(row) !== undefined,
      asOf: "",
      weekKey: "",
      rank: null,
      sampleSize: null,
      market,
      engineVersion: "",
      source: COUNTRY_RS_SOURCE,
    };
  }
  const flag = hydrationFlag(row);
  const value = finite(pick(row, "weeklyCountryRsRating"));
  if (flag === true && value !== null) {
    return {
      available: true,
      value,
      reason: "",
      hydrated: true,
      asOf: String(pick(row, "weeklyCountryRsAsOf") || ""),
      weekKey: String(pick(row, "weeklyCountryRsWeekKey") || ""),
      rank: finite(pick(row, "weeklyCountryRsRank")),
      sampleSize: finite(pick(row, "weeklyCountryRsSampleSize")),
      market,
      engineVersion: String(pick(row, "weeklyCountryRsEngineVersion") || countryRsEngineVersionForMarket(market)),
      source: COUNTRY_RS_SOURCE,
    };
  }
  const hydrated = flag !== undefined;
  const persistedReason = String(pick(row, "weeklyCountryRsReason") || "");
  return {
    available: false,
    value: null,
    reason: hydrated ? (persistedReason || COUNTRY_RS_NOT_RANKED_REASON) : COUNTRY_RS_NOT_HYDRATED_REASON,
    hydrated,
    asOf: "",
    weekKey: "",
    rank: null,
    sampleSize: null,
    market,
    engineVersion: "",
    source: COUNTRY_RS_SOURCE,
  };
}

export function countryRsValue(row = {}) {
  return countryRs(row).value;
}

export function countryRsReason(row = {}) {
  return countryRs(row).reason;
}

export const COUNTRY_RS_SORT_ABSENT = -1;

export function countryRsSortValue(row = {}) {
  const value = countryRsValue(row);
  return value === null ? COUNTRY_RS_SORT_ABSENT : value;
}

/** Adjunta campos weeklyCountryRs* a una fila (puro; usable en tests y server). */
export function attachWeeklyCountryRs(row, weeklyCountryRsBySymbol) {
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  const entry = weeklyCountryRsBySymbol?.get(symbol);
  const market = countryRsMarketForRow(row);
  if (entry?.available) {
    return {
      ...row,
      weeklyCountryRsAvailable: true,
      weeklyCountryRsRating: entry.rsRating,
      weeklyCountryRsRaw: entry.rsRaw,
      weeklyCountryRsRank: entry.rank,
      weeklyCountryRsSampleSize: entry.sampleSize,
      weeklyCountryRsAsOf: entry.asOf,
      weeklyCountryRsWeekKey: entry.weekKey,
      weeklyCountryRsEngineVersion: entry.engineVersion || countryRsEngineVersionForMarket(market),
      weeklyCountryRsReason: null,
      weeklyCountryRsMarket: market,
    };
  }
  return {
    ...row,
    weeklyCountryRsAvailable: false,
    weeklyCountryRsRating: null,
    weeklyCountryRsRaw: null,
    weeklyCountryRsRank: null,
    weeklyCountryRsSampleSize: null,
    weeklyCountryRsAsOf: null,
    weeklyCountryRsWeekKey: null,
    weeklyCountryRsEngineVersion: null,
    weeklyCountryRsReason: entry?.reason || null,
    weeklyCountryRsMarket: market,
  };
}
