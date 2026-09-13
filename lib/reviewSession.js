import { screenerSessionDataExpired } from "@/lib/nightlyBoundary";
import { scanSettingsSignature } from "@/lib/screenerPipeline";
import { cleanSymbol } from "@/lib/symbols";

export const REVIEW_SESSION_VERSION = 1;

const REVIEW_FILTER_SIGNATURE_VOLATILE_SETTING_KEYS = [
  "universeTotal",
  "publishedRowCount",
];

function stableReviewFilterSettings(settings = {}) {
  const stable = { ...settings };
  for (const key of REVIEW_FILTER_SIGNATURE_VOLATILE_SETTING_KEYS) {
    delete stable[key];
  }
  return stable;
}

// Firma de filtros para la sesión de Review: igual que fastFilterSignature pero
// sin campos volátiles del escaneo en curso (analyzedRows, materialized id,
// contadores de universo publicados). Mientras el mismo escaneo sigue cargando
// etapas, esos contadores pueden cambiar sin alterar los filtros del usuario.
// El límite de escaneo lo cubre scanScannedAt.
export function reviewFilterSignature(settings = {}, context = {}) {
  return JSON.stringify({
    useRegimeFilter: Boolean(context.useRegimeFilter),
    settings: stableReviewFilterSettings(settings),
  });
}

export function reviewQueueSymbols(review = {}) {
  return (Array.isArray(review?.rows) ? review.rows : [])
    .map((row) => cleanSymbol(row?.symbol))
    .filter(Boolean);
}

function stableJsonSignature(value = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

export function buildReviewSessionIdentity({
  filterSignature = "",
  scanContext = {},
  markets = [],
  manual = "",
  scanMode = "all",
  presetKey = "",
  sort = "",
  sortAsc = false,
  perfPeriod = "",
  viewLayers = {},
  filterLayers = {},
  fieldRules = {},
} = {}) {
  return {
    version: REVIEW_SESSION_VERSION,
    filterSignature,
    scanScannedAt: scanContext?.scannedAt || "",
    scanSignature: scanSettingsSignature(markets, manual, scanMode),
    presetKey,
    sort,
    sortAsc: Boolean(sortAsc),
    perfPeriod,
    viewLayers,
    filterLayers,
    fieldRules,
  };
}

export function reviewSessionIdentityMatches(stored = {}, current = {}) {
  if (!stored?.version || !current?.version) return false;
  const scalarKeys = [
    "filterSignature",
    "scanScannedAt",
    "scanSignature",
    "presetKey",
    "sort",
    "sortAsc",
    "perfPeriod",
  ];
  for (const key of scalarKeys) {
    if (String(stored[key] ?? "") !== String(current[key] ?? "")) return false;
  }
  if (stableJsonSignature(stored.viewLayers || {}) !== stableJsonSignature(current.viewLayers || {})) return false;
  if (stableJsonSignature(stored.filterLayers || {}) !== stableJsonSignature(current.filterLayers || {})) return false;
  if (stableJsonSignature(stored.fieldRules || {}) !== stableJsonSignature(current.fieldRules || {})) return false;
  return true;
}

export function isStoredReviewSessionValid(storedReview = {}, {
  sessionIdentity = {},
  screenerSession = {},
  now = new Date(),
} = {}) {
  if (!Array.isArray(storedReview?.rows) || !storedReview.rows.length) return false;
  if (storedReview.source !== "current") return false;
  if (screenerSessionDataExpired(screenerSession, now)) return false;
  const storedIdentity = storedReview.sessionIdentity || {};
  if (!storedIdentity.version) return false;
  return reviewSessionIdentityMatches(storedIdentity, sessionIdentity);
}

export function resolveReviewFocus(storedReview = {}, requestedSymbol = "") {
  const symbols = reviewQueueSymbols(storedReview);
  const clean = cleanSymbol(requestedSymbol);
  const storedSelected = cleanSymbol(storedReview?.selectedSymbol);

  if (clean && symbols.includes(clean)) {
    return {
      symbol: clean,
      index: symbols.indexOf(clean),
      resolved: "requested",
      inQueue: true,
      requestedMissing: "",
    };
  }

  if (storedSelected && symbols.includes(storedSelected)) {
    return {
      symbol: storedSelected,
      index: symbols.indexOf(storedSelected),
      resolved: clean ? "stored_fallback" : "stored",
      inQueue: true,
      requestedMissing: clean || "",
    };
  }

  const fallbackIndex = Number.isFinite(storedReview?.currentIndex)
    ? Math.max(0, Math.min(storedReview.currentIndex, Math.max(0, symbols.length - 1)))
    : 0;
  const fallbackSymbol = symbols[fallbackIndex] || "";
  return {
    symbol: fallbackSymbol,
    index: fallbackIndex,
    resolved: clean ? "index_fallback" : "index",
    inQueue: Boolean(fallbackSymbol),
    requestedMissing: clean || "",
  };
}

export function reviewFocusStatusMessage(focus = {}, queueSize = 0) {
  if (!focus.requestedMissing) return "";
  if (focus.resolved === "stored_fallback") {
    return `${focus.requestedMissing} no está en la cola (${queueSize}); foco en ${focus.symbol}.`;
  }
  if (focus.resolved === "index_fallback") {
    return `${focus.requestedMissing} no está en la cola (${queueSize}); foco restaurado en posición ${focus.index + 1}.`;
  }
  return "";
}
