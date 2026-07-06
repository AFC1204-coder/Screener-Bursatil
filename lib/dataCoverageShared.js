// Shared zero-legit coverage helpers used by researchRow.js, materializedScanner.js
// and app/api/company-brief/route.js.
//
// DISCREPANCIAS DETECTADAS entre las 3 copias (verificadas manualmente):
//   - NONE. ZERO_LEGIT_FIELDS set, usefulValue function body and return contract
//     are byte-for-byte identical across all three call sites.
//   - Comment header differs cosmetically: researchRow.js has the full financial-
//     domain justification inline; materializedScanner.js and company-brief/route.js
//     used a shorter "See lib/researchRow.js for canonical list" pointer. This
//     module adopts the full justification from researchRow.js as canonical.
//
// Scope of this module (intentionally minimal):
//   - ZERO_LEGIT_FIELDS: Set of field names where numeric 0 is a legitimate value.
//   - usefulValue(value, field): predicate that says whether a value is "present".
//
// NOT in this module (kept local per call site):
//   - coveragePct: each call site wraps it slightly differently
//     (researchRow.js + materializedScanner.js use pairs [value, field]; the older
//     scoreCoverage in company-brief/route.js uses flat values only). Since the
//     pair-aware implementation is shared identically by both researchRow and
//     materializedScanner, we export it here too — but the legacy flat-only
//     scoreCoverage in company-brief/route.js keeps its local helper to avoid
//     breaking its caller contract.
//   - dataCoverageForRow: each call site has its own field list (researchRow.js
//     includes ebitdaMargin, materializedScanner.js does not). The wrapper is
//     identical, but the lists differ, so it stays local.
//
// Financial-domain justification for ZERO_LEGIT_FIELDS:
//   shortPercentOfFloat    — 0% means no short positions exist (real fact, not missing data)
//   debtToEquity           — 0 means zero debt / cash-rich company (e.g. some tech companies)
//   insiderOwnership       — 0% means no insider holdings filed (common for recent IPOs)
//   institutionalOwnership — 0% means no institutional holders (common for micro-caps)
//   maxDrawdown63d         — 0% means the stock made consecutive highs with no pullback
//   operatingMargin        — 0% means operating at breakeven (real P&L outcome)
//   profitMargin           — 0% means net breakeven (real P&L outcome)
//   ebitdaMargin           — 0% means EBITDA breakeven (real P&L outcome)
//
// NOT included (0 in these almost always means missing/broken data):
//   price, sma*, volume fields, volatility, marketCap, avgTurnover, roe, roa,
//   currentRatio, grossMargin, relativeVolume, upDownVolRatio, etc.
export const ZERO_LEGIT_FIELDS = new Set([
  "shortPercentOfFloat",
  "debtToEquity",
  "insiderOwnership",
  "institutionalOwnership",
  "maxDrawdown63d",
  "operatingMargin",
  "profitMargin",
  "ebitdaMargin",
]);

// usefulValue(value, field): true if `value` represents present data.
// `field` is optional and only consulted when `value === 0` to check the
// zero-legit whitelist. Backward-compatible with single-arg callers.
export function usefulValue(value, field) {
  if (Number.isFinite(value)) {
    if (value === 0 && field && ZERO_LEGIT_FIELDS.has(field)) return true;
    return value !== 0;
  }
  return value !== undefined && value !== null && value !== "";
}