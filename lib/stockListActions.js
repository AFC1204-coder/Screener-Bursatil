import { syncFavoriteToCloud } from "@/lib/cloudSyncClient";
import { readFavorites, writeFavorites, safeRead, STORAGE_KEYS } from "@/lib/localState";
import { createFavoriteFromRow } from "@/lib/stockRows";

/** Destinos de lista curados por el usuario. Hoy solo favoritos (watchlist).
 *  Vistas guardadas (listViews) son filtros de discovery, no colecciones de tickers. */
export const USER_LIST_TARGETS = [
  {
    key: "favorites",
    storageKey: STORAGE_KEYS.favorites,
    label: "Favoritos",
    detail: "Watchlist manual del dispositivo",
  },
];

export function favoriteRowFromStockBrief(symbol = "", data = {}) {
  const rs = data?.relativeStrength || {};
  const q = data?.quoteSnapshot || {};
  const stage = data?.stage || {};
  return {
    symbol: String(symbol || data?.symbol || "").trim().toUpperCase(),
    companyName: data?.name || symbol,
    name: data?.name || symbol,
    sector: data?.sector || "",
    industry: data?.industry || "",
    theme: data?.theme || data?.subsector || "",
    country: data?.country || "",
    price: q?.price ?? null,
    lastDate: data?.dataQuality?.freshness?.priceDate || "",
    rsGlobalPct: rs?.rating ?? null,
    rsRating: rs?.rating ?? null,
    weeklyStageLabel: stage?.label || "",
    weeklyStageState: stage?.weekly?.state || "",
    marketCap: data?.marketCap ?? null,
    logoDomain: data?.visual?.logoDomain || "",
    website: data?.links?.official || "",
  };
}

export function readUserListMembership(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const favorites = safeRead(STORAGE_KEYS.favorites, []);
  return {
    favorites: favorites.some((item) => item.symbol === clean),
  };
}

export function addSymbolToUserList(targetKey = "favorites", symbol = "", data = {}, options = {}) {
  const target = USER_LIST_TARGETS.find((item) => item.key === targetKey);
  if (!target) {
    return { ok: false, reason: "unknown_target", message: "Lista no disponible." };
  }
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) {
    return { ok: false, reason: "missing_symbol", message: "Sin símbolo." };
  }

  if (target.key === "favorites") {
    const favorites = readFavorites();
    if (favorites.some((item) => item.symbol === clean)) {
      return { ok: true, already: true, target: target.key, message: `${clean} ya está en favoritos.` };
    }
    const row = favoriteRowFromStockBrief(clean, data);
    const favorite = createFavoriteFromRow(row, { source: options.source || "stock", marketHealth: options.marketHealth || null });
    const next = [favorite, ...favorites].slice(0, 250);
    writeFavorites(next);
    if (!options.skipCloudSync) {
      syncFavoriteToCloud(favorite).catch((error) => {
        console.error("[ficha] no se pudo sincronizar favorito:", error);
      });
    }
    return { ok: true, already: false, target: target.key, message: `${clean} añadido a favoritos.` };
  }

  return { ok: false, reason: "unsupported", message: "Lista no soportada." };
}

export function addSymbolToUserLists(targetKeys = [], symbol = "", data = {}, options = {}) {
  const keys = [...new Set((Array.isArray(targetKeys) ? targetKeys : [targetKeys]).filter(Boolean))];
  const results = keys.map((key) => addSymbolToUserList(key, symbol, data, { ...options, skipCloudSync: true }));
  const added = results.filter((item) => item.ok && !item.already);
  if (added.length && !options.skipCloudSync) {
    const favorite = readFavorites().find((item) => item.symbol === String(symbol).trim().toUpperCase());
    if (favorite) syncFavoriteToCloud(favorite).catch(() => {});
  }
  return results;
}
