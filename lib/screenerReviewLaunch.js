import { cleanSymbol } from "@/lib/symbols";

function symbolInRows(symbol = "", rows = []) {
  const clean = cleanSymbol(symbol);
  if (!clean) return "";
  return rows.some((row) => row?.symbol === clean) ? clean : "";
}

export function resolvePrimaryReviewStartSymbol({
  selectedResultSymbol = "",
  selectedSymbol = "",
  rows = [],
} = {}) {
  return symbolInRows(selectedResultSymbol, rows)
    || symbolInRows(selectedSymbol, rows)
    || rows[0]?.symbol
    || "";
}

export function buildReviewPageHref(symbol = "", source = "current") {
  const params = new URLSearchParams();
  params.set("source", source || "current");
  const clean = cleanSymbol(symbol);
  if (clean) params.set("symbol", clean);
  return `/review?${params.toString()}`;
}
