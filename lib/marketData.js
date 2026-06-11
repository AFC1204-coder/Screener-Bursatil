// lib/marketData.js — fachada cacheada sobre lib/yahoo.js.
//
// Estrategia de mínimo diff: NO se toca lib/yahoo.js (61 KB). Las rutas API
// cambian su import de "@/lib/yahoo" a "@/lib/marketData" y obtienen caché
// TTL + deduplicación gratis. Las firmas son idénticas.
//
// Archivos que deben cambiar el import (5):
//   app/api/chart/route.js
//   app/api/profile/route.js
//   app/api/similar/route.js
//   app/api/market-health/route.js
//   app/api/company-brief/route.js   (fetchYahooCompanyExtras se re-exporta igual)

import {
  fetchYahooChart as rawFetchYahooChart,
  fetchYahooProfile as rawFetchYahooProfile,
  fetchYahooCompanyExtras as rawFetchYahooCompanyExtras,
} from "@/lib/yahoo";
import { marketCache, TTL } from "@/lib/serverCache";

function normalizeSymbol(symbol = "") {
  return String(symbol || "").trim().toUpperCase();
}

function isIntraday(options = {}) {
  const interval = String(options.interval || "").toLowerCase();
  return Boolean(interval) && !["1d", "1wk", "1mo"].includes(interval);
}

export async function fetchYahooChart(symbol, options = {}) {
  const s = normalizeSymbol(symbol);
  const range = options.range || "";
  const interval = options.interval || "";
  const key = `chart:${s}:${range}:${interval}`;
  const ttl = isIntraday(options) ? TTL.CHART_INTRADAY : TTL.CHART_DAILY;
  return marketCache.cached(key, ttl, () => rawFetchYahooChart(s, options));
}

export async function fetchYahooProfile(symbol) {
  const s = normalizeSymbol(symbol);
  return marketCache.cached(`profile:${s}`, TTL.PROFILE, () => rawFetchYahooProfile(s));
}

export async function fetchYahooCompanyExtras(symbol, ...rest) {
  const s = normalizeSymbol(symbol);
  // Extras (noticias, eventos) caducan antes que el perfil.
  return marketCache.cached(`extras:${s}`, TTL.CHART_DAILY, () =>
    rawFetchYahooCompanyExtras(s, ...rest)
  );
}

// Visibilidad operativa: añade esto a /api/data-providers o a un endpoint nuevo
// si quieres ver hit-rate en producción.
export function marketCacheStats() {
  return marketCache.stats();
}
