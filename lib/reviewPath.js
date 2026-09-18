// lib/reviewPath.js — P7/P8 helpers: path mesa→ficha/Review sin callejón,
// modo 1 símbolo, y default de cola colapsada en Vista rápida.
import { buildReviewPageHref } from "@/lib/screenerReviewLaunch";
import { cleanSymbol, stockUrl } from "@/lib/symbols";

export const REVIEW_QUEUE_COLLAPSE_WIDTH = 1440;
export const REVIEW_QUEUE_COLLAPSE_COUNT = 100;
export const SINGLE_SYMBOL_QUEUE_MODE = "single-symbol";

export function buildSingleSymbolReviewRow(symbol = "") {
  const clean = cleanSymbol(symbol);
  if (!clean) return null;
  return {
    symbol: clean,
    companyName: clean,
    sourceType: SINGLE_SYMBOL_QUEUE_MODE,
  };
}

export function singleSymbolReviewStatus(symbol = "") {
  const clean = cleanSymbol(symbol);
  if (!clean) return "Sin cola del screener";
  return `Sin cola del screener — viendo solo ${clean}`;
}

export function shouldUseSingleSymbolReview({ queueRows = [], symbol = "" } = {}) {
  const hasQueue = Array.isArray(queueRows) && queueRows.length > 0;
  return !hasQueue && Boolean(cleanSymbol(symbol));
}

/**
 * Sin cola del screener pero con ticker conocido.
 * Preferencia de producto: modo 1 símbolo en Review (no bounce a `/`).
 * `preferStock: true` abre la ficha `/stock/SYMBOL` (p. ej. search en mesa vacía).
 */
export function resolveEmptyQueueReviewPath({
  symbol = "",
  preferStock = false,
} = {}) {
  const clean = cleanSymbol(symbol);
  if (!clean) {
    return {
      mode: "empty",
      href: "",
      status: "Sin cola del screener",
      symbol: "",
      queueMode: "",
    };
  }
  if (preferStock) {
    return {
      mode: "stock",
      href: stockUrl(clean),
      status: singleSymbolReviewStatus(clean),
      symbol: clean,
      queueMode: "",
    };
  }
  return {
    mode: "single-review",
    href: buildReviewPageHref(clean, "current"),
    status: singleSymbolReviewStatus(clean),
    symbol: clean,
    queueMode: SINGLE_SYMBOL_QUEUE_MODE,
  };
}

export function singleSymbolReviewLaunchOptions(symbol = "") {
  const clean = cleanSymbol(symbol);
  return {
    sourceLabel: "1 símbolo",
    sourceDetail: singleSymbolReviewStatus(clean),
    queueMode: SINGLE_SYMBOL_QUEUE_MODE,
  };
}

export function defaultReviewQueueCollapsed({
  visibleCount = 0,
  viewportWidth = REVIEW_QUEUE_COLLAPSE_WIDTH,
} = {}) {
  const width = Number.isFinite(Number(viewportWidth))
    ? Number(viewportWidth)
    : REVIEW_QUEUE_COLLAPSE_WIDTH;
  const count = Number.isFinite(Number(visibleCount)) ? Number(visibleCount) : 0;
  return count > REVIEW_QUEUE_COLLAPSE_COUNT || width < REVIEW_QUEUE_COLLAPSE_WIDTH;
}

/** Mesa vacía + ticker resuelto → Enter debe abrir ficha, no solo preview. */
export function shouldOpenStockFromEmptySearch({
  mesaEmpty = false,
  resolvedSymbol = "",
} = {}) {
  if (!mesaEmpty) return false;
  return Boolean(cleanSymbol(resolvedSymbol));
}
