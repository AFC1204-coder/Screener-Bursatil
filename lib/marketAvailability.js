// lib/marketAvailability.js — mercados seleccionables en UI y avisos de divergencia
// entre la selección del usuario y los mercados realmente cargados en el scan.
import { ASIA, DEFAULT_MARKETS, EUROPE, MARKET_META, marketName } from "@/lib/screenerConfig";
import { EUROPE_PRIORITY_MARKETS, normalizeMarketList } from "@/lib/markets";
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
  if (preset === "us-core-intl") {
    return filterSelectableMarkets(["US", ...filterSelectableMarkets(["HK", "CA", ...EUROPE_PRIORITY_MARKETS])]);
  }
  if (preset === "core-intl") return filterSelectableMarkets(["HK", "CA", ...EUROPE_PRIORITY_MARKETS]);
  if (preset === "europe") return filterSelectableMarkets(EUROPE);
  if (preset === "asia") return filterSelectableMarkets(ASIA);
  if (preset === "hk") return ["HK"];
  // Global cargable: US + Core intl (no el universo completo que falla al fusionar).
  if (preset === "global") return marketPresetMarkets("us-core-intl");
  return filterSelectableMarkets(DEFAULT_MARKETS);
}

function marketsFromLocalId(localId = "") {
  const id = String(localId || "");
  if (isNightlyUsLocalId(id)) return ["US"];
  const mergedNightlyMatch = id.match(/^merged-nightly-materialized:([A-Z]{2}(?:-[A-Z]{2})*):/);
  if (mergedNightlyMatch) return mergedNightlyMatch[1].split("-").slice().sort();
  const accumulatedMatch = id.match(/^accumulated-materialized:([A-Z]{2}):/);
  if (accumulatedMatch) return [accumulatedMatch[1]];
  const mergedMatch = id.match(/^merged-materialized:([A-Z]{2}(?:-[A-Z]{2})*):/);
  if (mergedMatch) return mergedMatch[1].split("-").slice().sort();
  const match = id.match(/^materialized:([A-Z]{2}(?:-[A-Z]{2})*):/);
  if (match) return match[1].split("-").slice().sort();
  return [];
}

/** Copy honesto cuando el materializado HK/CA usa official-broad (INT-3). */
export function intlBroadStatusDetail({
  market = "",
  analyzedCount = 0,
  priorityMode = "",
} = {}) {
  if (priorityMode !== "official-broad") return "";
  const upper = String(market || "").toUpperCase();
  if (!upper) return "";
  const label = marketName(upper);
  const count = Number(analyzedCount) || 0;
  return `${label}: ${count} analizadas · universo amplio filtrado (liquidez/cobertura) · rotación nocturna`;
}

/** Copy honesto para materializado acumulado HK/CA (INT-3d). */
export function accumulatedMaterializedStatusDetail({
  market = "",
  accumulatedNights = 0,
  symbolCount = 0,
} = {}) {
  const nights = Number(accumulatedNights) || 0;
  if (nights < 2) return "";
  const upper = String(market || "").toUpperCase();
  if (!upper) return "";
  const label = marketName(upper);
  const count = Number(symbolCount) || 0;
  return `${label} · ${nights} noches · ${count} símbolos`;
}

/** Copy honesto para mercados faltantes en partial-markets (US nocturno o intl materializado). */
export function formatMissingMarketsDetail(missingMarkets = [], missingDetails = []) {
  const detailsByMarket = new Map(
    (Array.isArray(missingDetails) ? missingDetails : []).map((item) => [item.market, item.reason]),
  );
  const labels = (Array.isArray(missingMarkets) ? missingMarkets : []).map((code) => {
    const upper = String(code || "").toUpperCase();
    const reason = detailsByMarket.get(upper) || detailsByMarket.get(code);
    if (upper === "US" || reason === "no-nightly-scan" || reason === "nightly-not-publishable") {
      return "Falta nocturno US";
    }
    return `Falta materializado: ${marketName(upper)}`;
  });
  return labels.length ? labels.join(" · ") : "No hay materializado publicable para todos los mercados seleccionados.";
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

export const MARKETS_MISALIGNMENT_CTA = "Cargar datos de la selección";

/** True cuando hay mercados cargados y la selección UI no coincide (keys normalizados). */
export function marketsSelectionMisaligned(scannedMarkets = [], selectedMarkets = []) {
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  if (!scanned.length) return false;
  return scanned.join(",") !== selected.join(",");
}

export function buildMarketsStaleNotice({
  scannedMarkets = [],
  selectedMarkets = [],
  rowCount = 0,
} = {}) {
  if (!marketsSelectionMisaligned(scannedMarkets, selectedMarkets)) return null;
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  const scannedCodes = scanned.join(", ");
  const selectedCodes = selected.join(", ");
  const rowSuffix = Number(rowCount) > 0 ? ` (${rowCount})` : "";
  return {
    tone: "warn",
    label: "Mercados",
    detail: `Datos cargados: ${scannedCodes}${rowSuffix}. La selección actual (${selectedCodes}) no coincide.`,
    ctaLabel: MARKETS_MISALIGNMENT_CTA,
    source: "markets-stale",
  };
}
