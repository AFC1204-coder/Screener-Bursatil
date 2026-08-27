// lib/marketAvailability.js — mercados seleccionables en UI y avisos de divergencia
// entre la selección del usuario y los mercados realmente cargados en el scan.
import { ASIA, DEFAULT_MARKETS, EUROPE, MARKET_META, marketName } from "@/lib/screenerConfig";
import { normalizeMarketList } from "@/lib/markets";
import { isNightlyUsLocalId } from "@/lib/scanLocalId";
import { countryCode } from "@/lib/symbols";

const UNAVAILABLE_MARKETS = {
  TW: "Materializado TW fallido (cron); sin filas publicables.",
};

export function marketUnavailabilityReason(code = "") {
  const upper = String(code || "").toUpperCase();
  return UNAVAILABLE_MARKETS[upper] || MARKET_META[upper]?.unavailabilityReason || null;
}

export function isMarketSelectable(code = "") {
  const upper = String(code || "").toUpperCase();
  if (!upper || !MARKET_META[upper]) return false;
  if (MARKET_META[upper]?.selectable === false) return false;
  return !UNAVAILABLE_MARKETS[upper];
}

export function filterSelectableMarkets(markets = []) {
  return (Array.isArray(markets) ? markets : []).filter(isMarketSelectable);
}

export function marketPresetMarkets(preset) {
  if (preset === "us") return ["US"];
  if (preset === "europe") return filterSelectableMarkets(EUROPE);
  if (preset === "asia") return filterSelectableMarkets(ASIA);
  if (preset === "hk") return ["HK"];
  return filterSelectableMarkets(DEFAULT_MARKETS);
}

function marketsFromLocalId(localId = "") {
  const id = String(localId || "");
  if (isNightlyUsLocalId(id)) return ["US"];
  const match = id.match(/^materialized:([A-Z]{2}(?:-[A-Z]{2})*):/);
  if (match) return match[1].split("-").slice().sort();
  return [];
}

/** Mercados que cubre realmente un snapshot cargado (settings, local_id o filas). */
export function scannedMarketsFromScan(scan = {}, analyzedRows = []) {
  const settingsMarkets = scan?.settings?.markets;
  if (Array.isArray(settingsMarkets) && settingsMarkets.length) {
    return normalizeMarketList(settingsMarkets, []).slice().sort();
  }
  const fromId = marketsFromLocalId(scan?.id || scan?.localId || scan?.local_id);
  if (fromId.length) return fromId;
  const rows = Array.isArray(analyzedRows) && analyzedRows.length
    ? analyzedRows
    : (Array.isArray(scan?.rows) ? scan.rows : []);
  if (!rows.length) return [];
  const covered = new Set();
  for (const row of rows) {
    const code = row?.country || countryCode(row?.symbol);
    if (code) covered.add(code);
  }
  return covered.size ? [...covered].sort() : [];
}

export function buildMarketsStaleNotice({
  scannedMarkets = [],
  selectedMarkets = [],
  rowCount = 0,
} = {}) {
  const scanned = (Array.isArray(scannedMarkets) ? scannedMarkets : []).slice().sort();
  const selected = (Array.isArray(selectedMarkets) ? selectedMarkets : []).slice().sort();
  if (!scanned.length || scanned.join(",") === selected.join(",")) return null;
  const scannedCodes = scanned.join(", ");
  const rowSuffix = Number(rowCount) > 0 ? ` (${rowCount})` : "";
  return {
    tone: "warn",
    label: "Mercados",
    detail: `Datos cargados: ${scannedCodes}${rowSuffix}. La selección de mercados no coincide — elige un solo mercado para cargar su materializado, o deja la selección alineada con el scan.`,
    source: "markets-stale",
  };
}
