// lib/mergeIpoDiscoveryRows.js — unión scan ∪ vigiladas locales en ficha Radar IPO (IPO-1c).

import { countryCode } from "@/lib/symbols";
import { IPO_DISCOVERY_PRESET_KEY } from "@/lib/ipoDiscoveryView";

export const IPO_WATCH_PLACEHOLDER_PREFIX = "watch:";

function normalizeSymbol(symbol = "") {
  return String(symbol || "").trim().toUpperCase();
}

export function isIpoWatchPlaceholderSymbol(symbol = "") {
  return String(symbol || "").startsWith(IPO_WATCH_PLACEHOLDER_PREFIX);
}

export function ipoWatchRowKey(row = {}) {
  if (row.symbol) return row.symbol;
  if (row.ipoWatchId) return `${IPO_WATCH_PLACEHOLDER_PREFIX}${row.ipoWatchId}`;
  return "";
}

export function ipoWatchItemCountry(item = {}) {
  const symbol = normalizeSymbol(item.symbol);
  return String(item.country || (symbol ? countryCode(symbol) : "")).trim().toUpperCase();
}

export function ipoWatchItemInMarkets(item = {}, markets = []) {
  const active = Array.isArray(markets) ? markets.filter(Boolean) : [];
  if (!active.length) return true;
  const country = ipoWatchItemCountry(item);
  return country ? active.includes(country) : false;
}

export function eligibleIpoWatchItems(watchItems = []) {
  return (Array.isArray(watchItems) ? watchItems : []).filter((item) => (
    item
    && item.includeInScreener
    && item.status !== "passed"
  ));
}

export function watchItemToDiscoveryRow(item = {}) {
  const symbol = normalizeSymbol(item.symbol);
  const country = ipoWatchItemCountry(item);
  return {
    symbol: symbol || `${IPO_WATCH_PLACEHOLDER_PREFIX}${item.id}`,
    ipoWatchOnly: true,
    ipoWatchId: item.id,
    companyName: item.companyName || symbol || "IPO vigilada",
    country,
    exchange: item.exchange || "",
    sector: item.sector || "",
    industry: item.industry || "",
    theme: item.sector || "",
    ipoWatchStatus: item.status || "watch",
    expectedTradeDate: item.expectedTradeDate || "",
    expectedPricingDate: item.expectedPricingDate || "",
    notes: item.notes || "",
  };
}

export function mergeIpoDiscoveryRows(scanRows = [], watchItems = [], { markets = [] } = {}) {
  const scanList = Array.isArray(scanRows) ? scanRows : [];
  const scanBySymbol = new Map();
  for (const row of scanList) {
    const symbol = normalizeSymbol(row?.symbol);
    if (symbol) scanBySymbol.set(symbol, row);
  }

  const merged = [...scanList];
  const seenWatchKeys = new Set();

  for (const item of eligibleIpoWatchItems(watchItems)) {
    if (!ipoWatchItemInMarkets(item, markets)) continue;

    const symbol = normalizeSymbol(item.symbol);
    if (symbol) {
      if (scanBySymbol.has(symbol)) continue;
      if (seenWatchKeys.has(symbol)) continue;
      seenWatchKeys.add(symbol);
      merged.push(watchItemToDiscoveryRow(item));
      continue;
    }

    const watchKey = `${IPO_WATCH_PLACEHOLDER_PREFIX}${item.id}`;
    if (seenWatchKeys.has(watchKey)) continue;
    seenWatchKeys.add(watchKey);
    merged.push(watchItemToDiscoveryRow(item));
  }

  return merged;
}

export function augmentIpoDiscoveryFilteredView(filteredView = {}, { presetKey = "", markets = [], watchItems = [] } = {}) {
  if (presetKey !== IPO_DISCOVERY_PRESET_KEY) return filteredView;
  const rows = mergeIpoDiscoveryRows(filteredView.rows, watchItems, { markets });
  if (rows === filteredView.rows) return filteredView;
  return { ...filteredView, rows };
}
