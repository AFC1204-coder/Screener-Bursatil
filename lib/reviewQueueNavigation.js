import { buildDecisionQueueDigest, buildDecisionQueueItem, DECISION_QUEUE_DIGEST_FILTERS } from "@/lib/screenerExplainability";
import { filterRowsByDecisionResolution, stockDecisionResolutionFilter } from "@/lib/stockDecisionResolution";
import { cleanSymbol, stockUrl } from "@/lib/symbols";

function normalizeRow(row = {}) {
  const snapshot = row?.snapshot || {};
  const symbol = cleanSymbol(row?.symbol || snapshot.symbol);
  if (!symbol) return null;
  return { ...snapshot, ...row, snapshot, symbol };
}

function normalizeRows(rows = []) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeRow(row);
    if (normalized) unique.set(normalized.symbol, normalized);
  }
  return [...unique.values()];
}

function uniqueSymbols(values = []) {
  return new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanSymbol(value))
    .filter(Boolean));
}

function reviewSettings(review = {}) {
  return review?.activeSettings || review?.settings?.activeSettings || review?.settings || {};
}

function digestFilterMeta(key = "all") {
  return DECISION_QUEUE_DIGEST_FILTERS.find((item) => item.key === key) || DECISION_QUEUE_DIGEST_FILTERS[0];
}

export function reviewQueueSourceLabel(source = "current", review = {}) {
  const customLabel = source === "current" ? String(review?.sourceLabel || "").trim() : "";
  if (customLabel) return customLabel;
  if (source === "favorites") return "Favoritos";
  if (source === "latest") return "Último snapshot";
  if (source === "current") return "Screener actual";
  return "Cola guardada";
}

function reviewHrefFor({ source = "current", symbol = "" } = {}) {
  const params = new URLSearchParams();
  params.set("source", source || "current");
  const clean = cleanSymbol(symbol);
  if (clean) params.set("symbol", clean);
  return `/review?${params.toString()}`;
}

export function buildReviewQueueNavigation(review = {}, currentSymbol = "") {
  const source = review?.source || "current";
  const settings = reviewSettings(review);
  const rows = normalizeRows(review?.rows || []);
  const hiddenSymbols = uniqueSymbols(review?.hiddenSymbols);
  const baseRows = rows.filter((row) => !hiddenSymbols.has(row.symbol));
  const resolutionFilter = stockDecisionResolutionFilter(review?.resolutionFilter || "all");
  const digestFilter = digestFilterMeta(review?.digestFilter || "all");
  const resolutionRows = filterRowsByDecisionResolution(baseRows, {
    decisionResolutions: review?.decisionResolutions || {},
  }, resolutionFilter.key);
  const resolutionItems = resolutionRows.map((row, baseIndex) => {
    const item = buildDecisionQueueItem(row, settings);
    return {
      ...item,
      row,
      symbol: row.symbol,
      baseIndex,
      digest: buildDecisionQueueDigest(item),
    };
  });
  const filteredItems = digestFilter.key === "all"
    ? resolutionItems
    : resolutionItems.filter((item) => item.digest?.state === digestFilter.key);
  const items = filteredItems.map((item, index) => ({
    ...item,
    index,
    href: stockUrl(item.symbol),
  }));
  const current = cleanSymbol(currentSymbol || review?.selectedSymbol);
  const currentIndex = current ? items.findIndex((item) => item.symbol === current) : -1;
  const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;
  const currentItem = currentIndex >= 0 ? items[currentIndex] : null;
  const nextItem = currentIndex >= 0
    ? (items.length > 1 ? items[(currentIndex + 1) % items.length] : null)
    : (items[0] || null);
  const previousItem = currentIndex >= 0 && items.length > 1
    ? items[(currentIndex - 1 + items.length) % items.length]
    : null;
  const targetForReview = currentItem || items[fallbackIndex] || null;
  const activeFilterLabels = [
    resolutionFilter.key !== "all" ? resolutionFilter.label : "",
    digestFilter.key !== "all" ? digestFilter.label : "",
  ].filter(Boolean);

  return {
    schemaVersion: 1,
    source,
    sourceLabel: reviewQueueSourceLabel(source, review),
    sourceDetail: source === "current" ? String(review?.sourceDetail || "").trim() : "",
    queueMode: source === "current" ? String(review?.queueMode || "").trim() : "",
    settings,
    resolutionFilter: resolutionFilter.key,
    digestFilter: digestFilter.key,
    filterLabel: activeFilterLabels.join(" · ") || "Cola completa",
    hasFilters: activeFilterLabels.length > 0,
    totalRows: rows.length,
    baseVisibleCount: baseRows.length,
    resolutionVisibleCount: resolutionRows.length,
    visibleCount: items.length,
    hiddenCount: Math.max(0, rows.length - baseRows.length),
    filteredOutCount: Math.max(0, rows.length - items.length),
    currentSymbol: current,
    currentIndex,
    currentRow: currentItem?.row || null,
    position: currentIndex >= 0 ? currentIndex + 1 : 0,
    positionLabel: currentIndex >= 0 ? `${currentIndex + 1}/${items.length}` : items.length ? `${items.length} en filtro` : "sin cola",
    isCurrentVisible: currentIndex >= 0,
    nextSymbol: nextItem?.symbol || "",
    nextRow: nextItem?.row || null,
    nextHref: nextItem?.href || "",
    previousSymbol: previousItem?.symbol || "",
    previousRow: previousItem?.row || null,
    previousHref: previousItem?.href || "",
    reviewHref: reviewHrefFor({ source, symbol: currentItem?.symbol || targetForReview?.symbol || current || "" }),
    items,
  };
}
