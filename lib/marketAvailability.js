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
function missingMarketReasonLabel(code = "", reason = "") {
  const upper = String(code || "").toUpperCase();
  const label = marketName(upper);
  if (upper === "US" || reason === "no-nightly-scan" || reason === "nightly-not-publishable") {
    return reason === "nightly-not-publishable"
      ? "Falta nocturno US (no publicable)"
      : "Falta nocturno US";
  }
  if (reason === "insufficient-rows") return `Falta materializado: ${label} (pocas filas)`;
  if (reason === "materialized-not-publishable") return `Falta materializado: ${label} (no publicable)`;
  if (reason === "no-materialized-scan") return `Falta materializado: ${label}`;
  return `Falta materializado: ${label}`;
}

export function formatMissingMarketsDetail(missingMarkets = [], missingDetails = []) {
  const detailsByMarket = new Map(
    (Array.isArray(missingDetails) ? missingDetails : []).map((item) => [item.market, item.reason]),
  );
  const labels = (Array.isArray(missingMarkets) ? missingMarkets : []).map((code) => {
    const upper = String(code || "").toUpperCase();
    const reason = detailsByMarket.get(upper) || detailsByMarket.get(code);
    return missingMarketReasonLabel(upper, reason);
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

export const MARKETS_MISALIGNMENT_EMPTY_LABEL = "La selección de mercados no coincide con los datos cargados. Pulsa «Cargar datos de la selección» arriba para reintentar.";

export const MARKETS_AUTO_LOAD_LOADING_LABEL = "Actualizando mesa";

/** Tras restore de sesión: si hay filas pero selección ≠ mercados del scan, auto-cargar. */
export function restoreSessionMarketAlignAction({
  restoredMarkets = [],
  scanContext = null,
  analyzedRows = [],
  referencedScan = null,
  hasVisibleRows = false,
} = {}) {
  if (!hasVisibleRows) return null;
  const fromContext = scanContext?.scannedMarkets;
  let scanned = [];
  if (Array.isArray(fromContext) && fromContext.length) {
    scanned = normalizeMarketList(fromContext, []).slice().sort();
  } else if (Array.isArray(analyzedRows) && analyzedRows.length) {
    scanned = scannedMarketsFromScan({ rows: analyzedRows }, analyzedRows);
  } else if (referencedScan?.rows?.length) {
    scanned = scannedMarketsFromScan(referencedScan, referencedScan.rows);
  }
  if (!marketsSelectionMisaligned(scanned, restoredMarkets)) return null;
  return filterSelectableMarkets(restoredMarkets);
}

/** True cuando hay mercados cargados y la selección UI no coincide (keys normalizados). */
export function marketsSelectionMisaligned(scannedMarkets = [], selectedMarkets = []) {
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  if (!scanned.length) return false;
  return scanned.join(",") !== selected.join(",");
}

/** Mesa cubre un subconjunto honesto de la selección (fusión parcial YIELD-1). */
export function marketsSelectionPartialCoverage(scannedMarkets = [], selectedMarkets = []) {
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  if (!scanned.length || scanned.length >= selected.length) return false;
  const selectedSet = new Set(selected);
  return scanned.every((code) => selectedSet.has(code));
}

/** Bloquea mesa cuando los datos incluyen mercados fuera de la selección (UX-NAC-1). */
export function marketsSelectionBlockingMisalignment(scannedMarkets = [], selectedMarkets = []) {
  if (!marketsSelectionMisaligned(scannedMarkets, selectedMarkets)) return false;
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  const selectedSet = new Set(selected);
  return scanned.some((code) => !selectedSet.has(code));
}

/** Códigos cortos de mercado para copy de producto (p. ej. US, HK+CA). */
export function formatMarketCodesShort(markets = []) {
  const codes = normalizeMarketList(markets, []).slice().sort();
  return codes.length ? codes.join("+") : "";
}

/**
 * Fragmentos de mercados para la línea de verdad del screener.
 * Con scan cargado: mesa efectiva; si hay desalineación, datos/selección + aviso corto.
 */
export function buildScreenerTruthMarketSegments({
  scannedMarkets = [],
  selectedMarkets = [],
  marketsMisaligned = false,
  suppressMisalignmentAlarm = false,
} = {}) {
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  if (!scanned.length) return [];

  const segments = [`mesa: ${formatMarketCodesShort(scanned)}`];
  const misaligned = !suppressMisalignmentAlarm
    && (marketsMisaligned || marketsSelectionMisaligned(scannedMarkets, selectedMarkets));
  if (misaligned) {
    const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
    segments.push(`datos: ${formatMarketCodesShort(scanned)} · selección: ${formatMarketCodesShort(selected)}`);
    segments.push("selección ≠ mesa");
  }
  return segments;
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
  if (marketsSelectionPartialCoverage(scannedMarkets, selectedMarkets)) {
    const missingCodes = selected.filter((code) => !scanned.includes(code));
    const missingLabels = missingCodes.map((code) => marketName(code)).join(", ");
    return {
      tone: "warn",
      label: "Cobertura parcial",
      detail: `Datos cargados: ${scannedCodes}${rowSuffix}. Faltan en mesa: ${missingLabels}.`,
      ctaLabel: MARKETS_MISALIGNMENT_CTA,
      source: "markets-partial-coverage",
      blocksResults: false,
      showCta: true,
    };
  }
  return {
    tone: "warn",
    label: "Mercados",
    detail: `Datos cargados: ${scannedCodes}${rowSuffix}. La selección actual (${selectedCodes}) no coincide.`,
    ctaLabel: MARKETS_MISALIGNMENT_CTA,
    source: "markets-stale",
    blocksResults: true,
    showCta: true,
  };
}

/** Copy neutro mientras la mesa se alinea con la selección (UX-NAC-3). */
export function buildMarketsLoadingNotice({ selectedMarkets = [] } = {}) {
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  const selectedCodes = formatMarketCodesShort(selected);
  return {
    tone: "loading",
    label: MARKETS_AUTO_LOAD_LOADING_LABEL,
    detail: selected.length === 1
      ? `Cargando datos de ${marketName(selected[0])}…`
      : `Cargando datos de la selección (${selectedCodes})…`,
    showCta: false,
    source: "markets-loading",
  };
}

/**
 * Aviso de desalineación mercados↔mesa: carga automática en flujo feliz;
 * CTA solo si falló el auto-load (UX-NAC-3).
 */
export function resolveMarketsMisalignmentNotice({
  scannedMarkets = [],
  selectedMarkets = [],
  rowCount = 0,
  restoringScan = false,
  loadFailed = false,
  loadFailedDetail = "",
} = {}) {
  const stale = buildMarketsStaleNotice({ scannedMarkets, selectedMarkets, rowCount });
  if (!stale) return null;

  if (loadFailed) {
    return {
      ...stale,
      tone: "error",
      label: "Mercados",
      detail: loadFailedDetail || stale.detail,
      showCta: true,
      source: `${stale.source}-failed`,
    };
  }

  const loading = buildMarketsLoadingNotice({ selectedMarkets });
  return {
    ...loading,
    blocksResults: stale.blocksResults,
    ctaLabel: stale.ctaLabel,
    source: restoringScan ? "markets-loading" : "markets-pending-load",
  };
}

/** Dispara auto-carga cuando hay mesa cargada y la selección diverge (UX-NAC-3). */
export function shouldAutoLoadMarketSelection({
  marketsStale = false,
  restoringScan = false,
  loadFailed = false,
  hasScannedMarkets = false,
  sessionReady = false,
} = {}) {
  return Boolean(
    sessionReady
    && marketsStale
    && hasScannedMarkets
    && !restoringScan
    && !loadFailed,
  );
}
