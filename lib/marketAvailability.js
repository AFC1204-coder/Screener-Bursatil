// lib/marketAvailability.js — mercados seleccionables en UI y avisos de divergencia
// entre la selección del usuario y los mercados realmente cargados en el scan.
import { ASIA, DEFAULT_MARKETS, EUROPE, MARKET_META, marketName } from "@/lib/screenerConfig";
import {
  EUROPE_PRIORITY_MARKETS,
  EUROPE_SECONDARY_MARKETS,
  normalizeMarketList,
} from "@/lib/markets";
import {
  CURATED_POPULATION_NOTICE_SOURCE,
  curatedFirdsMarketsInScope,
  isCuratedFallbackUniverseCache,
} from "@/lib/firdsCuratedPopulation";
import { isNightlyUsLocalId } from "@/lib/scanLocalId";
import { countryCode } from "@/lib/symbols";

const UNAVAILABLE_MARKETS = {
  TW: "Materializado TW fallido (cron); sin filas publicables.",
};

/** Copy tipificado primero: IE y PT (EUROPA-COVERAGE-TRUTH-1). */
const EUROPE_SECONDARY_COPY_PRIORITY = ["IE", "PT"];

/** Umbral de amplitud Europa (≥ prioridad + al menos un secundario). */
export const EUROPE_BREADTH_MIN_MARKETS = EUROPE_PRIORITY_MARKETS.length + 1;

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
  // Fallback = default de sesión (EE. UU.), no el universo seleccionable entero.
  return filterSelectableMarkets(DEFAULT_MARKETS);
}

function sameMarketSet(a = [], b = []) {
  const left = normalizeMarketList(a, []).slice().sort();
  const right = normalizeMarketList(b, []).slice().sort();
  if (left.length !== right.length) return false;
  return left.every((code, i) => code === right[i]);
}

const EUROPE_SELECTABLE = filterSelectableMarkets(EUROPE);
const EUROPE_SELECTABLE_SET = new Set(EUROPE_SELECTABLE);

/** Selección exacta del preset Europa (15 mercados cargables). */
export function isEuropePresetSelection(markets = []) {
  return sameMarketSet(markets, marketPresetMarkets("europe"));
}

/** Mesa / selección = solo Europa prioritaria (EU1), no Europa-15. */
export function isEuropePriorityOnlyMarkets(markets = []) {
  return sameMarketSet(markets, filterSelectableMarkets(EUROPE_PRIORITY_MARKETS));
}

/**
 * Selección con amplitud Europa: preset completo, o ≥N mercados solo-Europa
 * (prioridad + al menos un secundario).
 */
export function isEuropeBreadthSelection(markets = []) {
  if (isEuropePresetSelection(markets)) return true;
  const selected = normalizeMarketList(markets, []);
  if (!selected.length) return false;
  const europeOnly = selected.every((code) => EUROPE_SELECTABLE_SET.has(code));
  if (!europeOnly) return false;
  return selected.length >= EUROPE_BREADTH_MIN_MARKETS;
}

/** Secundarios Europa presentes en la selección y ausentes en mesa. */
export function missingEuropeSecondaryMarkets(scannedMarkets = [], selectedMarkets = []) {
  const scanned = new Set(normalizeMarketList(scannedMarkets, []));
  const selected = new Set(normalizeMarketList(selectedMarkets, []));
  return EUROPE_SECONDARY_MARKETS.filter((code) => selected.has(code) && !scanned.has(code));
}

/** Orden de copy: IE, PT, luego el resto de EUROPE_SECONDARY. */
export function orderEuropeSecondaryForCopy(codes = []) {
  const set = new Set(
    (Array.isArray(codes) ? codes : [])
      .map((code) => String(code || "").toUpperCase())
      .filter(Boolean),
  );
  const prioritized = EUROPE_SECONDARY_COPY_PRIORITY.filter((code) => set.has(code));
  const rest = EUROPE_SECONDARY_MARKETS.filter(
    (code) => set.has(code) && !EUROPE_SECONDARY_COPY_PRIORITY.includes(code),
  );
  const known = new Set([...prioritized, ...rest]);
  const extra = [...set].filter((code) => !known.has(code)).sort();
  return [...prioritized, ...rest, ...extra];
}

export function formatEuropeSecondaryGapNames(codes = []) {
  return orderEuropeSecondaryForCopy(codes).map((code) => marketName(code)).join(", ");
}

/**
 * Hueco Europa (secundarios / prioridad-only) para truth line y notice P9.
 * null si no aplica (sin amplitud Europa, sin parcial honesto, o sin huecos secundarios).
 */
/**
 * Población curada/parcial en mercados ESMA/FCA (FIRDS off o curated-fallback).
 * null si no aplica. Sin jerga de flags ni % inventados.
 */
export function describeCuratedPopulationGap({
  scannedMarkets = [],
  selectedMarkets = [],
  universeCache = null,
  providerDiagnostics = null,
  esmaFirdsEnabled = null,
  fcaFirdsEnabled = null,
} = {}) {
  const curatedMarkets = curatedFirdsMarketsInScope({
    scannedMarkets,
    selectedMarkets,
    universeCache,
    providerDiagnostics,
    esmaFirdsEnabled,
    fcaFirdsEnabled,
  });
  if (!curatedMarkets.length) return null;

  const selected = normalizeMarketList(selectedMarkets, []);
  const scanned = normalizeMarketList(scannedMarkets, []);
  const scannedSet = new Set(scanned);
  const curatedOnMesa = curatedMarkets.filter((code) => scannedSet.has(code));
  if (!curatedOnMesa.length) return null;

  const scopeMarkets = selected.length ? selected : scanned;
  const europeScope = isEuropePresetSelection(scopeMarkets)
    || isEuropeBreadthSelection(scopeMarkets)
    || isEuropePriorityOnlyMarkets(scopeMarkets)
    || isEuropePresetSelection(curatedOnMesa)
    || isEuropeBreadthSelection(curatedOnMesa)
    || isEuropePriorityOnlyMarkets(curatedOnMesa);
  const regionLabel = europeScope
    ? "Europa"
    : (formatMarketsProductLabel(curatedMarkets) || curatedMarkets.map((code) => marketName(code)).join(", "));

  const truthSegment = europeScope
    ? "Europa · población curada (parcial)"
    : `${regionLabel} · población curada (parcial)`;
  const peekDetail = europeScope
    ? "Población curada · Europa"
    : `Población curada · ${regionLabel}`;
  const noticeDetail = europeScope
    ? "La mesa usa listas curadas de liquidez en Europa; no representa el mercado completo de cada país."
    : curatedOnMesa.length === 1
      ? `${marketName(curatedOnMesa[0])} usa una lista curada de liquidez; no es cobertura completa del exchange.`
      : `${regionLabel} usan listas curadas de liquidez; no representan el mercado completo de cada país.`;

  return {
    curatedMarkets: curatedOnMesa,
    regionLabel,
    europeScope,
    truthSegment,
    peekDetail,
    noticeDetail,
    reason: isCuratedFallbackUniverseCache(universeCache) ? "curated-fallback" : "firds-off",
  };
}

/** Aviso P9 cuando la población visible es curada/parcial (FIRDS off). */
export function buildCuratedPopulationNotice({
  scannedMarkets = [],
  selectedMarkets = [],
  rowCount = 0,
  universeCache = null,
  providerDiagnostics = null,
  esmaFirdsEnabled = null,
  fcaFirdsEnabled = null,
} = {}) {
  const gap = describeCuratedPopulationGap({
    scannedMarkets,
    selectedMarkets,
    universeCache,
    providerDiagnostics,
    esmaFirdsEnabled,
    fcaFirdsEnabled,
  });
  if (!gap) return null;
  const scanned = normalizeMarketList(scannedMarkets, []);
  if (!scanned.length) return null;
  const rowSuffix = Number(rowCount) > 0 ? ` (${rowCount})` : "";
  const mesaLabel = formatMarketsProductLabel(scanned) || "la mesa";
  return {
    tone: "warn",
    label: "Población parcial",
    detail: `${mesaLabel}${rowSuffix}: ${gap.noticeDetail}`,
    peekDetail: gap.peekDetail,
    bodyDetail: `${mesaLabel}${rowSuffix}: ${gap.noticeDetail}`,
    source: CURATED_POPULATION_NOTICE_SOURCE,
    blocksResults: false,
    showCta: false,
  };
}

export function describeEuropeCoverageGap({
  scannedMarkets = [],
  selectedMarkets = [],
} = {}) {
  if (!isEuropeBreadthSelection(selectedMarkets)) return null;
  if (!marketsSelectionPartialCoverage(scannedMarkets, selectedMarkets)) return null;
  const missingSecondary = missingEuropeSecondaryMarkets(scannedMarkets, selectedMarkets);
  if (!missingSecondary.length) return null;
  const names = formatEuropeSecondaryGapNames(missingSecondary);
  const priorityOnly = isEuropePriorityOnlyMarkets(scannedMarkets);
  const selectedSecondaryCount = EUROPE_SECONDARY_MARKETS.filter(
    (code) => normalizeMarketList(selectedMarkets, []).includes(code),
  ).length;
  const allSecondaryMissing = priorityOnly
    && selectedSecondaryCount > 0
    && missingSecondary.length >= selectedSecondaryCount;
  return {
    missingSecondary,
    names,
    priorityOnly,
    allSecondaryMissing,
    truthSegment: allSecondaryMissing
      ? `Europa incompleta · faltan secundarios (${names})`
      : `Europa · faltan secundarios (${names})`,
    peekDetail: missingSecondary.length === 1
      ? `Falta secundario ${missingSecondary[0]}`
      : `Faltan ${missingSecondary.length} secundarios Europa`,
  };
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

/** Peek móvil para mercados faltantes sin enumerar países (MOBILE-FIRE-3). */
export function missingMarketsPeekDetail(missingMarkets = []) {
  const count = (Array.isArray(missingMarkets) ? missingMarkets : []).length;
  if (!count) return "Faltan mercados";
  return count === 1 ? "Falta 1 mercado" : `Faltan ${count} mercados`;
}

/** Aviso de fusión materializada con peek corto en móvil (MOBILE-FIRE-3). */
export function buildMergedSnapshotNotice(marketsMeta = {}) {
  if (!marketsMeta?.merged) return null;
  const partial = Boolean(marketsMeta.partial);
  const label = partial ? "Fusión parcial" : "Fusión";
  const detail = partial
    ? `${formatMissingMarketsDetail(marketsMeta.missingMarkets, marketsMeta.missingDetails)}. Mesa con mercados disponibles; percentiles RS del lote de origen.`
    : marketsMeta.source === "merged-nightly-materialized"
      ? "Mezcla de nocturno US y materializados internacionales; los percentiles RS de cada fila son los del lote de origen."
      : "Mezcla de materializados por mercado; los percentiles RS de cada fila son los del lote de origen.";
  const notice = {
    tone: partial ? "warn" : "info",
    label,
    detail,
    source: partial ? "merged-materialized-partial" : (marketsMeta.source || "merged-materialized"),
  };
  if (partial) {
    notice.peekDetail = missingMarketsPeekDetail(marketsMeta.missingMarkets);
    notice.bodyDetail = detail;
  }
  return notice;
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

export const MARKETS_MISALIGNMENT_EMPTY_LABEL = "La selección de mercados no coincide con los datos cargados. Usa «Cargar» o «Quedarme en la mesa» arriba.";

export const MARKETS_AUTO_LOAD_LOADING_LABEL = "Actualizando mesa";

/** A partir de este umbral el copy móvil/peek usa «N mercados» en lugar de listar códigos. */
export const MULTI_MARKET_COMPACT_THRESHOLD = 3;

function marketCountPhrase(count = 0) {
  const n = Number(count) || 0;
  return n === 1 ? "1 mercado" : `${n} mercados`;
}

/**
 * Etiqueta de producto para mercados (P9): EE. UU. / Global / Europa / nombre / códigos.
 * Evita jerga de sistema en truth line y CTAs.
 * Europa-15 = «Europa»; solo prioridad (EU1) = «Europa prioritaria» (nunca «Europa» completa).
 */
export function formatMarketsProductLabel(markets = []) {
  const codes = normalizeMarketList(markets, []).slice().sort();
  if (!codes.length) return "";
  if (codes.length === 1 && codes[0] === "US") return "EE. UU.";
  const global = marketPresetMarkets("global").slice().sort();
  if (codes.length === global.length && codes.every((code, i) => code === global[i])) {
    return "Global";
  }
  if (isEuropePresetSelection(codes)) return "Europa";
  if (isEuropePriorityOnlyMarkets(codes)) return "Europa prioritaria";
  if (codes.length === 1) return marketName(codes[0]);
  if (codes.length > MULTI_MARKET_COMPACT_THRESHOLD) return marketCountPhrase(codes.length);
  return formatMarketCodesShort(codes);
}

/** CTA primaria al divergir selección↔mesa (P9). */
export function marketsMisalignmentLoadCtaLabel(selectedMarkets = []) {
  const label = formatMarketsProductLabel(selectedMarkets);
  if (label === "Global") return "Cargar Global";
  if (label === "EE. UU.") return "Cargar EE. UU.";
  if (label === "Europa") return "Cargar Europa";
  if (label === "Europa prioritaria") return "Cargar Europa prioritaria";
  if (label && !/\d+ mercados/.test(label)) return `Cargar ${label}`;
  return MARKETS_MISALIGNMENT_CTA;
}

/** CTA secundaria: alinear la selección a lo ya cargado (P9). */
export function marketsMisalignmentStayCtaLabel(scannedMarkets = []) {
  const label = formatMarketsProductLabel(scannedMarkets);
  if (!label) return "Quedarme en la mesa";
  return `Quedarme en ${label}`;
}

/** Tras restore de sesión: si hay filas pero selección ≠ mercados del scan, auto-cargar. */
export function restoreSessionMarketAlignAction({
  restoredMarkets = [],
  scanContext = null,
  analyzedRows = [],
  referencedScan = null,
  hasVisibleRows = false,
  selectionLoadSettled = false,
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
  if (
    selectionLoadSettled
    && marketsSelectionPartialCoverage(scanned, restoredMarkets)
    && !marketsSelectionBlockingMisalignment(scanned, restoredMarkets)
  ) {
    return null;
  }
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

/** Mesa de resultados limitada a US (READ-A: ocultar RS país en parrilla). */
export function screenerTableMarketsUsOnly(scannedMarkets = []) {
  const markets = normalizeMarketList(scannedMarkets, []).slice().sort();
  if (!markets.length) return true;
  return markets.length === 1 && markets[0] === "US";
}

/** Códigos cortos de mercado para copy de producto (p. ej. US, HK+CA). */
export function formatMarketCodesShort(markets = []) {
  const codes = normalizeMarketList(markets, []).slice().sort();
  return codes.length ? codes.join("+") : "";
}

/**
 * Fragmentos de mercados para la línea de verdad del screener.
 * Con scan cargado: mesa efectiva; si hay desalineación, copy de decisión (P9).
 * Europa parcial: hueco de secundarios explícito (nunca «Europa completa»).
 */
export function buildScreenerTruthMarketSegments({
  scannedMarkets = [],
  selectedMarkets = [],
  marketsMisaligned = false,
  suppressMisalignmentAlarm = false,
  compact = false,
  europeCoverageHonesty = false,
  curatedPopulationHonesty = false,
  universeCache = null,
  providerDiagnostics = null,
  esmaFirdsEnabled = null,
  fcaFirdsEnabled = null,
} = {}) {
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  if (!scanned.length) return [];

  const misaligned = !suppressMisalignmentAlarm
    && (marketsMisaligned || marketsSelectionMisaligned(scannedMarkets, selectedMarkets));

  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  const mesaLabel = formatMarketsProductLabel(scanned);
  const seleccionLabel = formatMarketsProductLabel(selected);
  const europeGap = describeEuropeCoverageGap({ scannedMarkets: scanned, selectedMarkets: selected });
  const curatedGap = curatedPopulationHonesty
    ? describeCuratedPopulationGap({
      scannedMarkets: scanned,
      selectedMarkets: selected,
      universeCache,
      providerDiagnostics,
      esmaFirdsEnabled,
      fcaFirdsEnabled,
    })
    : null;

  if (curatedGap && !europeGap) {
    const mesaSegment = compact
      ? `${marketCountPhrase(scanned.length)} en mesa`
      : `mesa: ${mesaLabel === "Europa" || mesaLabel === "Europa prioritaria"
        ? mesaLabel
        : formatMarketCodesShort(scanned)}`;
    if (compact) {
      return [
        mesaSegment,
        curatedGap.europeScope
          ? "Europa · población curada (parcial)"
          : curatedGap.peekDetail,
      ];
    }
    return [mesaSegment, curatedGap.truthSegment];
  }

  if (europeCoverageHonesty && europeGap) {
    if (compact) {
      return [
        `${marketCountPhrase(scanned.length)} en mesa`,
        europeGap.priorityOnly
          ? "Europa incompleta · secundarios ausentes"
          : europeGap.peekDetail,
      ];
    }
    return [
      `mesa: ${mesaLabel === "Europa prioritaria" ? "Europa prioritaria" : formatMarketCodesShort(scanned)}`,
      europeGap.truthSegment,
    ];
  }

  if (compact) {
    const segments = [`${marketCountPhrase(scanned.length)} en mesa`];
    if (misaligned) {
      // P9: sin jerga «selección ≠ mesa».
      if (europeGap) {
        segments.push(
          `Mostrando ${mesaLabel} · Europa incompleta (faltan secundarios)`,
        );
      } else {
        segments.push(`Mostrando ${mesaLabel} · selección ${seleccionLabel || "distinta"}`);
      }
    }
    return segments;
  }

  if (misaligned) {
    if (europeGap) {
      return [
        `Mostrando ${mesaLabel} · tu selección es ${seleccionLabel || "Europa"}`,
        europeGap.truthSegment,
      ];
    }
    return [`Mostrando ${mesaLabel} · tu selección es ${seleccionLabel || "otra"}`];
  }

  return [`mesa: ${formatMarketCodesShort(scanned)}`];
}

export function buildMarketsStaleNotice({
  scannedMarkets = [],
  selectedMarkets = [],
  rowCount = 0,
} = {}) {
  if (!marketsSelectionMisaligned(scannedMarkets, selectedMarkets)) return null;
  const scanned = normalizeMarketList(scannedMarkets, []).slice().sort();
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  const mesaLabel = formatMarketsProductLabel(scanned);
  const seleccionLabel = formatMarketsProductLabel(selected);
  const rowSuffix = Number(rowCount) > 0 ? ` (${rowCount})` : "";
  const loadCta = marketsMisalignmentLoadCtaLabel(selected);
  const stayCta = marketsMisalignmentStayCtaLabel(scanned);
  if (marketsSelectionPartialCoverage(scannedMarkets, selectedMarkets)) {
    const missingCodes = selected.filter((code) => !scanned.includes(code));
    const europeGap = describeEuropeCoverageGap({ scannedMarkets: scanned, selectedMarkets: selected });
    let detail;
    let peekDetail = missingMarketsPeekDetail(missingCodes);
    if (europeGap?.allSecondaryMissing) {
      detail = `Mostrando ${mesaLabel}${rowSuffix}. Tu selección es ${seleccionLabel} — no es Europa completa: faltan secundarios (${europeGap.names}).`;
      peekDetail = europeGap.peekDetail;
    } else if (europeGap) {
      const otherMissing = missingCodes.filter((code) => !europeGap.missingSecondary.includes(code));
      const otherLabels = otherMissing.map((code) => marketName(code)).join(", ");
      detail = otherLabels
        ? `Mostrando ${mesaLabel}${rowSuffix}. Tu selección es ${seleccionLabel} — faltan secundarios Europa (${europeGap.names}); también: ${otherLabels}.`
        : `Mostrando ${mesaLabel}${rowSuffix}. Tu selección es ${seleccionLabel} — faltan secundarios Europa (${europeGap.names}).`;
      peekDetail = europeGap.peekDetail;
    } else {
      const missingLabels = missingCodes.map((code) => marketName(code)).join(", ");
      detail = `Mostrando ${mesaLabel}${rowSuffix}. Tu selección es ${seleccionLabel} — faltan en mesa: ${missingLabels}.`;
    }
    return {
      tone: "warn",
      label: "Cobertura parcial",
      detail,
      peekDetail,
      bodyDetail: detail,
      ctaLabel: loadCta,
      stayCtaLabel: stayCta,
      source: "markets-partial-coverage",
      blocksResults: false,
      showCta: true,
    };
  }
  return {
    tone: "warn",
    label: "Mercados",
    detail: `Mostrando ${mesaLabel}${rowSuffix}. Tu selección es ${seleccionLabel}.`,
    ctaLabel: loadCta,
    stayCtaLabel: stayCta,
    source: "markets-stale",
    blocksResults: true,
    showCta: true,
  };
}

/** Copy neutro mientras la mesa se alinea con la selección (UX-NAC-3). */
export function buildMarketsLoadingNotice({ selectedMarkets = [] } = {}) {
  const selected = normalizeMarketList(selectedMarkets, []).slice().sort();
  const selectedCodes = formatMarketCodesShort(selected);
  const count = selected.length;
  if (count === 1) {
    const detail = `Cargando datos de ${marketName(selected[0])}…`;
    return {
      tone: "loading",
      label: MARKETS_AUTO_LOAD_LOADING_LABEL,
      detail,
      peekDetail: detail,
      showCta: false,
      source: "markets-loading",
    };
  }
  const detail = `Cargando datos de la selección (${selectedCodes})…`;
  if (count <= MULTI_MARKET_COMPACT_THRESHOLD) {
    return {
      tone: "loading",
      label: MARKETS_AUTO_LOAD_LOADING_LABEL,
      detail,
      peekDetail: detail,
      showCta: false,
      source: "markets-loading",
    };
  }
  const peekDetail = `Cargando ${count} mercados…`;
  return {
    tone: "loading",
    label: MARKETS_AUTO_LOAD_LOADING_LABEL,
    detail: peekDetail,
    peekDetail,
    bodyDetail: peekDetail,
    showCta: false,
    source: "markets-loading",
  };
}

/**
 * Aviso de desalineación mercados↔mesa: carga automática en flujo feliz;
 * CTA solo si falló el auto-load (UX-NAC-3).
 */
export function marketsSelectionLoadSettled(selectedKey = "", settledKey = "") {
  return Boolean(selectedKey && settledKey && selectedKey === settledKey);
}

export function resolveMarketsMisalignmentNotice({
  scannedMarkets = [],
  selectedMarkets = [],
  rowCount = 0,
  restoringScan = false,
  loadFailed = false,
  loadFailedDetail = "",
  selectionLoadSettled = false,
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

  if (restoringScan) {
    const loading = buildMarketsLoadingNotice({ selectedMarkets });
    return {
      ...loading,
      blocksResults: stale.blocksResults,
      ctaLabel: stale.ctaLabel,
      source: "markets-loading",
    };
  }

  const isPartialCoverage = marketsSelectionPartialCoverage(scannedMarkets, selectedMarkets);
  if (isPartialCoverage && selectionLoadSettled) {
    return {
      ...stale,
      showCta: true,
    };
  }

  const loading = buildMarketsLoadingNotice({ selectedMarkets });
  return {
    ...loading,
    blocksResults: isPartialCoverage ? false : stale.blocksResults,
    ctaLabel: stale.ctaLabel,
    source: "markets-pending-load",
  };
}

/** Dispara auto-carga cuando hay mesa cargada y la selección diverge (UX-NAC-3). */
export function shouldAutoLoadMarketSelection({
  marketsStale = false,
  restoringScan = false,
  loadFailed = false,
  hasScannedMarkets = false,
  sessionReady = false,
  selectionLoadSettled = false,
} = {}) {
  return Boolean(
    sessionReady
    && marketsStale
    && hasScannedMarkets
    && !restoringScan
    && !loadFailed
    && !selectionLoadSettled,
  );
}
