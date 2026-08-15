import { DEFAULT_PRICE_FRESHNESS_DAYS } from "@/lib/screenerFilterCatalog";

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
// Scope of this module:
//   - ZERO_LEGIT_FIELDS: Set of field names where numeric 0 is a legitimate value.
//   - usefulValue(value, field): predicate that says whether a value is "present".
//   - coveragePct(entries): percentage of [value, field] pairs that are "useful".
//   - priceFreshnessForDate(lastDate, maxDays): freshness bucket for a price date.
//   - dataCoverageForRow(row, profile): the composite coverage score.
//
// dataCoverageForRow unification (docs/duplicados-restantes-2026-08-07.md):
// until that date, researchRow.js and materializedScanner.js each kept a
// byte-for-byte copy of dataCoverageForRow (plus its two helpers above), with
// ONE real difference — researchRow.js's fundamentalCoverageScore included
// `ebitdaMargin`, materializedScanner.js's did not. That divergence was
// unreconciled historical debt, not a deliberate design choice: verified that
// materializedScanner.js's copy is the older one (2026-05-20, `fbe8c03`);
// researchRow.js's copy was created three weeks later by copy-paste
// (2026-06-12, `43ef9f8`) and only grew the `ebitdaMargin` entry later
// (2026-07-06, `7cbbbf2` — the same commit that created this shared module and
// documented the split without arguing for it). `ebitdaMargin` was always
// available to both pipelines (both fetch profile/growthMetrics through the
// same lib/yahoo.js provider layer, cron directly, interactive via the
// lib/marketData.js caching wrapper, which does not filter fields) — no data
// availability gap, no import cycle. The three functions below are now the
// single source; both call sites import them instead of keeping local copies.
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

// coveragePct accepts an array of [value, field] pairs. For backward compatibility
// it also accepts a flat array of values (field will be undefined → no zero-legit).
export function coveragePct(entries = []) {
  if (!entries.length) return 0;
  const pairs = entries.map((e) => Array.isArray(e) ? e : [e, undefined]);
  return Math.round((pairs.filter(([v, f]) => usefulValue(v, f)).length / pairs.length) * 100);
}

export function priceFreshnessForDate(lastDate = "", maxDays = DEFAULT_PRICE_FRESHNESS_DAYS) {
  const limit = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : DEFAULT_PRICE_FRESHNESS_DAYS;
  const timestamp = Date.parse(lastDate);
  if (!Number.isFinite(timestamp)) {
    return {
      priceFreshnessDays: null,
      priceFreshnessMaxDays: limit,
      priceFreshnessOk: false,
      priceFreshnessLabel: "sin fecha",
      priceFreshnessIssue: "precio sin fecha de cierre",
    };
  }
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  const ok = days <= limit;
  return {
    priceFreshnessDays: days,
    priceFreshnessMaxDays: limit,
    priceFreshnessOk: ok,
    priceFreshnessLabel: days <= 2 ? "fresco" : ok ? "útil" : "viejo",
    priceFreshnessIssue: ok ? "" : `precio viejo: ${days}d > ${limit}d`,
  };
}

// dataCoverageForRow(row, profile): fusión de las dos copias previas
// (researchRow.js/materializedScanner.js). Field list = la superset de
// researchRow.js (incluye ebitdaMargin en fundamentalCoverageScore) — ver
// comentario de cabecera del módulo para la justificación.
export function dataCoverageForRow(row = {}, profile = {}) {
  const gm = profile.growthMetrics || row.growthMetrics || {};
  const freshness = row.priceFreshnessOk === undefined ? priceFreshnessForDate(row.lastDate) : {
    priceFreshnessDays: row.priceFreshnessDays ?? null,
    priceFreshnessMaxDays: row.priceFreshnessMaxDays ?? DEFAULT_PRICE_FRESHNESS_DAYS,
    priceFreshnessOk: row.priceFreshnessOk === true,
    priceFreshnessLabel: row.priceFreshnessLabel || (row.priceFreshnessOk ? "fresco" : "viejo"),
    priceFreshnessIssue: row.priceFreshnessIssue || "",
  };
  const technicalCoverageScore = coveragePct([
    [freshness.priceFreshnessOk ? 100 : null, "priceFreshness"],
    [Number.isFinite(row.chartBarsCount) && row.chartBarsCount >= 180 ? row.chartBarsCount : null, "chartBarsCount"],
    [row.price, "price"],
    [row.sma50, "sma50"],
    [row.sma150, "sma150"],
    [row.sma200, "sma200"],
    [row.sma200Slope, "sma200Slope"],
    [row.distance20d, "distance20d"],
    [row.distance50d, "distance50d"],
    [row.distance52w, "distance52w"],
    [row.distanceATH, "distanceATH"],
    [row.highsSpreadPct, "highsSpreadPct"],
    [row.perf3m, "perf3m"],
    [row.perf6m, "perf6m"],
    [row.perf12m, "perf12m"],
    [row.extSma50, "extSma50"],
    [row.avgVolume, "avgVolume"],
    [row.avgTurnover, "avgTurnover"],
    [row.latestVolume, "latestVolume"],
    [row.latestTurnover, "latestTurnover"],
    [row.relativeVolume, "relativeVolume"],
    [row.volumeSurgePct, "volumeSurgePct"],
    [row.upDownVolRatio, "upDownVolRatio"],
    [row.volumeEffectScore, "volumeEffectScore"],
    [row.shortPercentOfFloat, "shortPercentOfFloat"],
    [row.maxDailyMove20dPct, "maxDailyMove20dPct"],
    [row.maxDailyRange20dPct, "maxDailyRange20dPct"],
    [row.range63dPct, "range63dPct"],
    [row.volatility63d, "volatility63d"],
    [row.maxDrawdown63d, "maxDrawdown63d"],
    [row.rsRating, "rsRating"],
    [row.rs3m, "rs3m"],
    [row.rs6m, "rs6m"],
    [row.rs12m, "rs12m"],
  ]);
  const profileCoverageScore = coveragePct([
    [row.companyName && row.companyName !== row.symbol ? row.companyName : "", "companyName"],
    [row.exchange && row.exchange !== "-" ? row.exchange : "", "exchange"],
    [row.country, "country"],
    [row.currency, "currency"],
    [row.marketCap, "marketCap"],
    [row.sector && row.sector !== "Sin sector" ? row.sector : "", "sector"],
    [row.industry && row.industry !== "Sin industria" ? row.industry : "", "industry"],
    [row.website, "website"],
    [profile.businessSummary, "businessSummary"],
    [row.ipoDate, "ipoDate"],
  ]);
  const fundamentalCoverageScore = coveragePct([
    [gm.revenueGrowth, "revenueGrowth"],
    [gm.earningsGrowth, "earningsGrowth"],
    [gm.grossMargin, "grossMargin"],
    [gm.operatingMargin, "operatingMargin"],
    [gm.profitMargin, "profitMargin"],
    [gm.ebitdaMargin, "ebitdaMargin"],
    [gm.roe, "roe"],
    [gm.roa, "roa"],
    [gm.debtToEquity, "debtToEquity"],
    [gm.currentRatio, "currentRatio"],
    [gm.institutionalOwnership, "institutionalOwnership"],
    [gm.insiderOwnership, "insiderOwnership"],
    [gm.shortPercentOfFloat, "shortPercentOfFloat"],
  ]);
  const stalePenalty = freshness.priceFreshnessOk ? 0 : 18;
  const dataCoverageScore = Math.max(0, Math.round(technicalCoverageScore * .68 + profileCoverageScore * .22 + fundamentalCoverageScore * .1 - stalePenalty));
  const issues = [];
  if (!freshness.priceFreshnessOk) issues.push(freshness.priceFreshnessIssue || "precio no fresco");
  if (technicalCoverageScore < 70) issues.push("técnico parcial");
  if (profileCoverageScore < 55) issues.push("perfil parcial");
  if (fundamentalCoverageScore < 35) issues.push("fundamental parcial");
  return {
    ...freshness,
    dataCoverageScore,
    technicalCoverageScore,
    profileCoverageScore,
    fundamentalCoverageScore,
    dataCoverageLabel: dataCoverageScore >= 80 ? "alta" : dataCoverageScore >= 60 ? "útil" : dataCoverageScore >= 40 ? "parcial" : "baja",
    dataCoverageIssues: issues,
  };
}