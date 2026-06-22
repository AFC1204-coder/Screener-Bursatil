import { STOCK_DECISION_RESOLUTION_LOG_LIMIT, buildStockDecisionResolutionSummary, decisionResolutionForSymbol, decisionResolutionHistory, stockDecisionAction } from "./stockDecisionResolution.js";

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

export function traceableSymbol(row = {}) {
  return cleanSymbol(row?.symbol || row?.snapshot?.symbol);
}

export function uniqueTraceableRows(rows = []) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = traceableSymbol(row);
    if (!symbol) continue;
    unique.set(symbol, { ...(row || {}), symbol });
  }
  return [...unique.values()];
}

export function decisionResolutionForRow(row = {}, review = {}) {
  const symbol = traceableSymbol(row);
  const resolution = symbol ? decisionResolutionForSymbol(review, symbol) : null;
  return stockDecisionAction(resolution?.key) ? resolution : null;
}

export function buildDecisionTraceabilitySummary(rows = [], review = {}) {
  const uniqueRows = uniqueTraceableRows(rows);
  const symbols = new Set(uniqueRows.map((row) => row.symbol));
  const groups = buildStockDecisionResolutionSummary(uniqueRows, review);
  const pendingCount = groups.find((group) => group.key === "pending")?.count || 0;
  const resolvedGroups = groups.filter((group) => !["all", "pending"].includes(group.key));
  const resolvedCount = resolvedGroups.reduce((sum, group) => sum + group.count, 0);
  const latest = decisionResolutionHistory(review, { limit: STOCK_DECISION_RESOLUTION_LOG_LIMIT })
    .filter((entry) => symbols.has(entry.symbol))
    .slice(0, 8);
  return {
    rows: uniqueRows.length,
    groups,
    resolvedGroups,
    pendingCount,
    resolvedCount,
    latest,
    source: review?.source || "current",
    updatedAt: review?.updatedAt || "",
  };
}
