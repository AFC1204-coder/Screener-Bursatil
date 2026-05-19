import { clamp } from "@/lib/formatters";
import { compactMethodologySnapshot } from "@/lib/methodologyEngine";
import { countryCode } from "@/lib/symbols";

const FAVORITE_SNAPSHOT_FIELDS = [
  "totalScore",
  "compositeScore",
  "compositeLabel",
  "setupQualityScore",
  "demandScore",
  "growthScore",
  "growthQualityScore",
  "adProxyScore",
  "epsGrowthProxyScore",
  "ratingModel",
  "weinsteinScore",
  "minerviniScore",
  "momentumScore",
  "riskScore",
  "riskRewardScore",
  "volumeScore",
  "volumeEffectScore",
  "volumeEvidence",
  "avgVolume",
  "latestVolume",
  "avgTurnover",
  "latestTurnover",
  "relativeVolume",
  "volumeSurgePct",
  "upDownVolRatio",
  "shortPercentOfFloat",
  "sharesPercentSharesOut",
  "shortRatio",
  "sharesShort",
  "floatShares",
  "liquidityScore",
  "rsRating",
  "rsGlobalPct",
  "rsCountryPct",
  "rsSectorPct",
  "rsQualityScore",
  "rsStabilityScore",
  "speculationRiskScore",
  "rsQualityLabel",
  "dataCoverageScore",
  "technicalCoverageScore",
  "fundamentalCoverageScore",
  "dataCoverageLabel",
  "dataCoverageIssues",
  "priceFreshnessDays",
  "priceFreshnessLabel",
  "priceFreshnessOk",
  "priceFreshnessIssue",
  "weaknessScore",
  "weaknessLabel",
  "weaknessReasons",
  "rsGlobalSample",
  "rsCountrySample",
  "rsSectorSample",
  "rs3m",
  "rs6m",
  "rs12m",
  "benchmarkSymbol",
  "sectorScore",
  "ipoScore",
  "compositeReasons",
  "compositeRisks",
  "perf3m",
  "perf6m",
  "perf12m",
  "volatility63d",
  "downsideVolatility63d",
  "maxDrawdown63d",
  "returnToVol3m",
  "returnToDrawdown3m",
  "price",
  "sma50",
  "sma150",
  "sma200",
  "sma200Slope",
  "distance20d",
  "distance50d",
  "distance52w",
  "extSma50",
  "highsSpreadPct",
  "theme",
  "businessEs",
];

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanObject(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value))));
}

export function snapshotValue(row = {}, key) {
  return row[key] ?? row.snapshot?.[key];
}

export function uniqueRows(rows = []) {
  return Array.from(new Map(rows.filter(Boolean).map((row) => [row.symbol, row])).values());
}

export function rowCountry(row = {}) {
  return row.country || row.snapshot?.country || (row.symbol ? countryCode(row.symbol) : "US");
}

export function rowTheme(row = {}) {
  return row.theme || row.snapshot?.theme || "Sin tematica";
}

export function rowSector(row = {}) {
  return row.sector || row.snapshot?.sector || "Sin sector";
}

export function rowIndustry(row = {}) {
  return row.industry || row.snapshot?.industry || "Sin industria";
}

export function rowCompanyName(row = {}) {
  return row.companyName || row.name || row.snapshot?.companyName || row.symbol;
}

export function rowComposite(row = {}) {
  return snapshotValue(row, "totalScore") ?? snapshotValue(row, "compositeScore") ?? 0;
}

export function rowRsUniverse(row = {}) {
  return snapshotValue(row, "rsGlobalPct") ?? null;
}

export function rowRsBenchmark(row = {}) {
  return snapshotValue(row, "rsRating") ?? null;
}

export function rowRsPrimary(row = {}) {
  return rowRsUniverse(row) ?? rowRsBenchmark(row) ?? null;
}

export function rowRsGlobal(row = {}) {
  return rowRsUniverse(row);
}

export function weaknessScore(row = {}) {
  const direct = snapshotValue(row, "weaknessScore");
  if (Number.isFinite(direct)) return direct;

  let score = 0;
  const rs = rowRsPrimary(row) ?? 50;
  const distance52w = snapshotValue(row, "distance52w");
  const perf3m = snapshotValue(row, "perf3m");
  const extSma50 = snapshotValue(row, "extSma50");
  const riskScore = snapshotValue(row, "riskScore") ?? 50;

  if (rs < 45) score += 16;
  if (Number.isFinite(distance52w) && distance52w < -30) score += 14;
  if (Number.isFinite(perf3m) && perf3m < 0) score += 12;
  if (Number.isFinite(extSma50) && extSma50 < -8) score += 10;
  if (riskScore < 35) score += 10;
  return clamp(score);
}

export function metricValue(row = {}, key) {
  if (key === "weaknessScore") return weaknessScore(row);
  if (key === "totalScore" || key === "compositeScore") return rowComposite(row);
  if (key === "rsGlobalPct") return rowRsUniverse(row);
  if (key === "rsRating") return rowRsBenchmark(row);
  return snapshotValue(row, key) ?? null;
}

export function sortByMetric(rows = [], key) {
  return [...rows].sort((a, b) => (metricValue(b, key) || 0) - (metricValue(a, key) || 0));
}

export function shortBusiness(row = {}) {
  return [rowIndustry(row), rowSector(row), rowTheme(row)]
    .filter((value, index, arr) => value && value !== "Sin industria" && value !== "Sin sector" && value !== "Sin tematica" && arr.indexOf(value) === index)
    .slice(0, 3)
    .join(" · ") || row.source || "";
}

export function monthsSince(dateLike) {
  if (!dateLike) return null;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  return (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth();
}

export function isRecentIpo(row = {}, maxMonths = 60) {
  const months = monthsSince(row.ipoDate || row.snapshot?.ipoDate);
  return Number.isFinite(months) && months >= 0 && months <= maxMonths;
}

export function favoriteSnapshotFromRow(row = {}) {
  const methodologySnapshot = compactMethodologySnapshot(row);
  const metrics = Object.fromEntries(FAVORITE_SNAPSHOT_FIELDS.map((key) => [key, snapshotValue(row, key)]));
  return cleanObject({
    ...methodologySnapshot,
    ...metrics,
    stageState: methodologySnapshot.stageState,
    stageLabel: methodologySnapshot.stageLabel,
    riskState: methodologySnapshot.riskState,
    dataQualityState: methodologySnapshot.dataQualityState,
  });
}

export function createFavoriteFromRow(row = {}, options = {}) {
  const marketHealth = options.marketHealth || null;
  const market = options.market || null;
  const scan = options.scan || null;
  const price = snapshotValue(row, "price");
  const marketScore = options.marketScore ?? scan?.marketScore ?? market?.marketScore ?? marketHealth?.marketScore ?? null;
  const marketRegime = options.marketRegime ?? scan?.marketRegime ?? market?.regime?.label ?? marketHealth?.regime?.label ?? "sin dato";

  return cleanObject({
    id: options.id || uid(),
    symbol: row.symbol,
    companyName: rowCompanyName(row),
    country: rowCountry(row),
    sector: rowSector(row),
    industry: rowIndustry(row),
    addedAt: options.addedAt || new Date().toISOString(),
    entryPrice: Number.isFinite(price) ? price : null,
    lastPrice: Number.isFinite(price) ? price : null,
    lastDate: row.lastDate || row.snapshot?.lastDate || null,
    source: options.source || "screener",
    notes: options.notes || "",
    marketScore,
    marketRegime,
    snapshot: favoriteSnapshotFromRow(row),
  });
}

export function favoriteToRow(favorite = {}) {
  const snapshot = favorite.snapshot || {};
  return normalizeStockRow({
    ...snapshot,
    symbol: favorite.symbol || snapshot.symbol,
    companyName: favorite.companyName || snapshot.companyName || favorite.symbol,
    notes: favorite.notes,
    source: "favorite",
    snapshot,
  });
}

export function normalizeStockRow(row = {}) {
  const rsUniverse = rowRsUniverse(row);
  const rsBenchmark = rowRsBenchmark(row);
  const normalized = {
    ...row,
    symbol: row.symbol,
    companyName: rowCompanyName(row),
    theme: rowTheme(row),
    sector: rowSector(row),
    industry: rowIndustry(row),
    country: rowCountry(row),
    totalScore: finiteOrNull(rowComposite(row)),
    rsGlobalPct: finiteOrNull(rsUniverse),
    rsRating: finiteOrNull(rsBenchmark),
    weaknessScore: finiteOrNull(weaknessScore(row)),
  };

  return normalized;
}

export function normalizeStockRows(rows = []) {
  return uniqueRows(rows).map(normalizeStockRow);
}
