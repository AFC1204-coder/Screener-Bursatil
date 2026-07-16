import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, supabaseRequestAll, supabaseRpc, textOrNull } from "@/lib/supabaseServer";
import { businessThemeKey } from "@/lib/businessTheme";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";
import { methodologyVerdictForRow } from "@/lib/methodologyVerdict";
import { applyScreenerFilters, SCREENER_FILTER_QUERY_KEYS, screenerFiltersFromParams } from "@/lib/screenerFilters";
import { buildGroupListDrilldown, rowPassesListContract } from "@/lib/listRationale";
import { isLongOpportunityRow } from "@/lib/stockRows";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const DEFAULT_SCAN_ROWS = 5000;
const DEFAULT_SCAN_READ_TIMEOUT_MS = 12000;
const DEFAULT_MATERIALIZED_READ_TIMEOUT_MS = Number(process.env.LEADERBOARD_CACHE_READ_TIMEOUT_MS || 1500);
const DEFAULT_MIN_COVERAGE = 40;
const DEFAULT_MAX_PRICE_FRESHNESS_DAYS = 5;

export const LEADERBOARD_STRATEGIES = {
  composite: {
    label: "Score compuesto",
    description: "Mejor combinación global sin bonus de VCP/contracciones: tendencia, RS, calidad, liquidez y riesgo.",
  },
  momentum: {
    label: "Momentum",
    description: "Fuerza relativa y rentabilidad reciente, con control de calidad mínimo.",
  },
  return6m: {
    label: "Rentabilidad 6M",
    description: "Mayor avance a seis meses, penalizando baja calidad y baja cobertura.",
  },
  stage2: {
    label: "Weinstein Stage 2",
    description: "Tendencia alcista estructural según medias y score Weinstein.",
  },
  nearPivot: {
    label: "Vigilancia pivot",
    description: "Líderes fuertes en zona de pivot observable; no implica plan automático.",
  },
  rs: {
    label: "RS",
    description: "Mayor fuerza relativa del universo disponible; el benchmark queda como señal secundaria y no sustituye al RS.",
  },
  rsQuality: {
    label: "RS Quality",
    description: "Fuerza relativa de calidad, priorizando RS global alto con estabilidad y control de drawdown.",
  },
  growth: {
    label: "Growth Quality",
    description: "Crecimiento, margen y calidad fundamental cuando el proveedor lo cubre.",
  },
  weakness: {
    label: "Deterioro técnico",
    description: "Debilidad observable para evitar largos o estudiar cortos sin mezclarla con listas de oportunidad larga.",
  },
  minervini: {
    label: "Minervini",
    description: "Trend template, momentum y proximidad a máximos con score Minervini alto.",
  },
  ipo: {
    label: "IPO / New Leaders",
    description: "Compañías recientes con edad IPO verificable y fuerza derivada suficiente.",
  },
  extended: {
    label: "Extended but strong",
    description: "Líderes fuertes pero extendidos sobre SMA50; vigilancia, no entrada automática.",
  },
  pullback: {
    label: "Pullback to SMA50",
    description: "Líderes de calidad cerca de SMA50 y por encima de SMA200 para vigilancia.",
  },
  liquidity: {
    label: "Liquidez",
    description: "Líderes con mayor importe negociado y score suficiente.",
  },
};

export const DEFAULT_LEADERBOARD_SPECS = [
  { key: "global-momentum", title: "Top Momentum Global", strategy: "momentum", scopeType: "global", scopeValue: "" },
  { key: "global-stage2", title: "Top Weinstein Stage 2 Global", strategy: "stage2", scopeType: "global", scopeValue: "" },
  { key: "global-near-pivot", title: "Vigilancia pivot global", strategy: "nearPivot", scopeType: "global", scopeValue: "" },
  { key: "global-rs", title: "Top RS", strategy: "rs", scopeType: "global", scopeValue: "" },
  { key: "global-growth-quality", title: "Growth Quality Global", strategy: "growth", scopeType: "global", scopeValue: "" },
];

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lowerText(value = "") {
  return cleanText(value).toLowerCase();
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === "" || value === null || value === undefined) continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function metric(row = {}, key = "") {
  return firstFinite(row[key], row.metrics?.[key], row.growthMetrics?.[key]);
}

function objectiveMetric(row = {}) {
  return firstFinite(metric(row, "objectiveScore"), metric(row, "totalScore"), metric(row, "compositeScore"));
}

function metricText(row = {}, key = "") {
  return cleanText(row[key] || row.metrics?.[key] || row.growthMetrics?.[key] || "");
}

function metricBool(row = {}, key = "") {
  const value = row[key] ?? row.metrics?.[key] ?? row.growthMetrics?.[key];
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    if (/^(1|true|yes|y)$/i.test(value)) return true;
    if (/^(0|false|no|n)$/i.test(value)) return false;
  }
  return null;
}

function canonicalTheme({ sector = "", industry = "", theme = "", summary = "" } = {}) {
  const cleanSector = cleanText(sector);
  const cleanIndustry = cleanText(industry);
  const hasBusinessTaxonomy = (cleanSector && cleanSector !== "Sin sector") || (cleanIndustry && cleanIndustry !== "Sin industria");
  if (hasBusinessTaxonomy) return businessThemeKey(cleanSector, cleanIndustry, summary);
  return cleanText(theme) || "Sin tematica";
}

function scale(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || max === min) return 0;
  return clamp(((n - min) / (max - min)) * 100);
}

function logScale(value, min = 100000, max = 50000000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return scale(Math.log10(n), Math.log10(min), Math.log10(max));
}

function rsValue(row = {}) {
  return firstFinite(metric(row, "rsGlobalPct"), metric(row, "rsRating"), metric(row, "rsCountryPct"), metric(row, "rsSectorPct"));
}

function rsUniverseValue(row = {}) {
  return firstFinite(metric(row, "rsGlobalPct"));
}

function rsBenchmarkValue(row = {}) {
  return firstFinite(metric(row, "rsRating"));
}

function weaknessValue(row = {}) {
  const direct = metric(row, "weaknessScore");
  if (Number.isFinite(direct)) return direct;

  let score = 0;
  const rs = rsValue(row) ?? 50;
  const distance52w = metric(row, "distance52w");
  const perf3m = metric(row, "perf3m");
  const extSma50 = metric(row, "extSma50");
  const riskScore = metric(row, "riskScore") ?? 50;

  if (rs < 45) score += 16;
  if (Number.isFinite(distance52w) && distance52w < -30) score += 14;
  if (Number.isFinite(perf3m) && perf3m < 0) score += 12;
  if (Number.isFinite(extSma50) && extSma50 < -8) score += 10;
  if (riskScore < 35) score += 10;
  return clamp(score);
}

function priceFreshness(row = {}, maxDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS) {
  const limit = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : DEFAULT_MAX_PRICE_FRESHNESS_DAYS;
  const storedDays = metric(row, "priceFreshnessDays");
  if (Number.isFinite(storedDays)) {
    return {
      days: storedDays,
      ok: storedDays <= limit,
      label: metricText(row, "priceFreshnessLabel") || (storedDays <= limit ? "fresco" : "viejo"),
      issue: storedDays <= limit ? "" : `precio viejo: ${storedDays}d > ${limit}d`,
    };
  }
  const lastDate = metricText(row, "lastDate");
  const timestamp = Date.parse(lastDate);
  if (!Number.isFinite(timestamp)) return { days: null, ok: false, label: "sin fecha", issue: "precio sin fecha de cierre" };
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  return {
    days,
    ok: days <= limit,
    label: days <= 2 ? "fresco" : days <= limit ? "util" : "viejo",
    issue: days <= limit ? "" : `precio viejo: ${days}d > ${limit}d`,
  };
}

function methodologyReliability(row = {}, maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS) {
  const verdict = methodologyVerdictForRow(row);
  const display = methodologyDisplayForRow(row);
  const freshness = priceFreshness(row, maxPriceFreshnessDays);
  const coverage = metric(row, "dataCoverageScore");
  const status = metricText(row, "patternDataStatus") || "sin dato";
  const eligible = metricBool(row, "patternEligible");
  const issues = [];
  if (!freshness.ok) issues.push(freshness.issue || "precio no fresco");
  if (!Number.isFinite(coverage)) issues.push("cobertura sin dato");
  else if (coverage < 60) issues.push(`cobertura parcial ${Math.round(coverage)}`);
  if (eligible === false) issues.push(status && status !== "sin dato" ? status : "patron no elegible");
  else if (status && !["ok", "partial_volume"].includes(status)) issues.push(status);

  const blocksPatternClaim = issues.length > 0 || verdict.state === "data";
  if (blocksPatternClaim) {
    const reason = issues.join(" | ") || verdict.reason || "No hay datos suficientes para validar setup.";
    return {
      state: "data_limited",
      label: "Datos parciales",
      shortLabel: "Datos",
      tone: "muted",
      reason,
      blocksPatternClaim: true,
      setupVerdictKey: verdict.key,
      setupVerdictState: "data_limited",
      setupVerdictLabel: "Datos parciales",
      setupVerdictShortLabel: "Datos",
      setupPlanValid: false,
      setupActionable: false,
      setupWatch: false,
      setupStrict: false,
      setupDisplayKey: "data_limited",
      setupDisplayState: "data_limited",
      setupDisplayLabel: "Datos parciales",
      setupDisplayShortLabel: "Datos",
      setupDisplayReason: reason,
      setupDisplayEvidence: display.evidence || "",
      setupDisplayLine: reason,
      setupDisplayTone: "muted",
      setupDisplayDataLimited: true,
      setupDisplayBlocksPatternClaim: true,
      setupDisplayPlanValid: false,
      setupDisplayActionable: false,
      setupDisplayObservable: false,
      setupDisplayWatch: false,
      setupDisplayStrict: false,
      setupDisplayTradePlanEligible: false,
      setupDisplayConfidenceKey: display.confidence?.key || verdict.dataConfidence?.key || "",
      setupDisplayConfidenceLabel: display.confidence?.label || verdict.dataConfidence?.label || "",
    };
  }
  const blocked = display.blocksPatternClaim === true || display.dataLimited === true;
  return {
    state: verdict.state || "screened",
    label: verdict.label || "Evaluado",
    shortLabel: verdict.shortLabel || verdict.label || "Evaluado",
    tone: verdict.tone || "neutral",
    reason: verdict.reason || "",
    blocksPatternClaim: blocked,
    setupVerdictKey: verdict.key,
    setupVerdictState: verdict.state,
    setupVerdictLabel: verdict.label,
    setupVerdictShortLabel: verdict.shortLabel,
    setupPlanValid: !blocked && display.actionable === true && display.tradePlanEligible === true,
    setupActionable: !blocked && display.actionable === true,
    setupWatch: !blocked && display.watch === true,
    setupStrict: !blocked && display.strict === true,
    setupDisplayKey: display.key || "",
    setupDisplayState: display.state || "",
    setupDisplayLabel: display.label || "",
    setupDisplayShortLabel: display.shortLabel || "",
    setupDisplayReason: display.reason || "",
    setupDisplayEvidence: display.evidence || "",
    setupDisplayLine: display.line || "",
    setupDisplayTone: display.tone || "",
    setupDisplayDataLimited: display.dataLimited === true,
    setupDisplayBlocksPatternClaim: display.blocksPatternClaim === true,
    setupDisplayPlanValid: !blocked && display.actionable === true && display.tradePlanEligible === true,
    setupDisplayActionable: !blocked && display.actionable === true,
    setupDisplayObservable: !blocked && display.observable === true,
    setupDisplayWatch: !blocked && display.watch === true,
    setupDisplayStrict: !blocked && display.strict === true,
    setupDisplayTradePlanEligible: !blocked && display.tradePlanEligible === true,
    setupDisplayConfidenceKey: display.confidence?.key || verdict.dataConfidence?.key || "",
    setupDisplayConfidenceLabel: display.confidence?.label || verdict.dataConfidence?.label || "",
  };
}

function publicMethodologyFields(reliability = {}) {
  return {
    setupVerdictKey: reliability.setupVerdictKey || "",
    setupVerdictState: reliability.setupVerdictState || "",
    setupVerdictLabel: reliability.setupVerdictLabel || "",
    setupVerdictShortLabel: reliability.setupVerdictShortLabel || "",
    setupPlanValid: reliability.setupPlanValid,
    setupActionable: reliability.setupActionable,
    setupWatch: reliability.setupWatch,
    setupStrict: reliability.setupStrict,
    setupDisplayKey: reliability.setupDisplayKey || "",
    setupDisplayState: reliability.setupDisplayState || "",
    setupDisplayLabel: reliability.setupDisplayLabel || "",
    setupDisplayShortLabel: reliability.setupDisplayShortLabel || "",
    setupDisplayReason: reliability.setupDisplayReason || "",
    setupDisplayEvidence: reliability.setupDisplayEvidence || "",
    setupDisplayLine: reliability.setupDisplayLine || "",
    setupDisplayTone: reliability.setupDisplayTone || "",
    setupDisplayDataLimited: reliability.setupDisplayDataLimited,
    setupDisplayBlocksPatternClaim: reliability.setupDisplayBlocksPatternClaim,
    setupDisplayPlanValid: reliability.setupDisplayPlanValid,
    setupDisplayActionable: reliability.setupDisplayActionable,
    setupDisplayObservable: reliability.setupDisplayObservable,
    setupDisplayWatch: reliability.setupDisplayWatch,
    setupDisplayStrict: reliability.setupDisplayStrict,
    setupDisplayTradePlanEligible: reliability.setupDisplayTradePlanEligible,
    setupDisplayConfidenceKey: reliability.setupDisplayConfidenceKey || "",
    setupDisplayConfidenceLabel: reliability.setupDisplayConfidenceLabel || "",
    methodologyReliabilityState: reliability.state,
    methodologyReliabilityLabel: reliability.label,
    methodologyReliabilityReason: reliability.reason,
    methodologyBlocksPatternClaim: reliability.blocksPatternClaim,
  };
}

function isStage2(row = {}) {
  const price = metric(row, "price");
  const sma50 = metric(row, "sma50");
  const sma150 = metric(row, "sma150");
  const sma200 = metric(row, "sma200");
  const slope = metric(row, "sma200Slope");
  if ([price, sma50, sma150, sma200, slope].every(Number.isFinite)) {
    return price > sma50 && price > sma150 && price > sma200 && sma50 > sma150 && sma150 > sma200 && slope > 0;
  }
  return (metric(row, "weinsteinScore") || 0) >= 75 && (metric(row, "minerviniScore") || 0) >= 60;
}

function normalizeStrategy(value = "") {
  const key = cleanText(value || "momentum");
  return LEADERBOARD_STRATEGIES[key] ? key : "momentum";
}

function normalizeScopeType(value = "") {
  const key = cleanText(value || "global");
  return ["global", "country", "sector", "industry", "theme"].includes(key) ? key : "global";
}

function scopeField(scopeType = "global") {
  if (scopeType === "country") return "country";
  if (scopeType === "sector") return "sector";
  if (scopeType === "industry") return "industry";
  if (scopeType === "theme") return "theme";
  return "";
}

function scopeMatches(row = {}, scopeType = "global", scopeValue = "") {
  if (scopeType === "global") return true;
  const field = scopeField(scopeType);
  if (!field) return true;
  const expected = lowerText(scopeValue);
  if (!expected) return true;
  if (scopeType === "country") return lowerText(row.country) === expected;
  return lowerText(row[field]).includes(expected);
}

function rowFromScanResult(item = {}) {
  const raw = item.raw && typeof item.raw === "object" ? item.raw : {};
  const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
  const sector = cleanText(raw.sector || item.sector || "Sin sector");
  const industry = cleanText(raw.industry || item.industry || "Sin industria");
  const summary = cleanText(raw.businessSummary || raw.summary || raw.businessEs || metrics.businessSummary || metrics.summary || metrics.businessEs || "");
  return {
    ...metrics,
    ...raw,
    symbol: cleanText(raw.symbol || item.symbol).toUpperCase(),
    companyName: cleanText(raw.companyName || raw.name || item.company_name || item.symbol),
    country: cleanText(raw.country || item.country),
    sector,
    industry,
    theme: canonicalTheme({ sector, industry, theme: raw.theme || item.theme, summary }),
    objectiveScore: firstFinite(raw.objectiveScore, metrics.objectiveScore),
    totalScore: firstFinite(raw.totalScore, metrics.totalScore, item.total_score),
    compositeScore: firstFinite(raw.compositeScore, metrics.compositeScore, item.total_score),
    weinsteinScore: firstFinite(raw.weinsteinScore, item.weinstein_score),
    minerviniScore: firstFinite(raw.minerviniScore, item.minervini_score),
    riskScore: firstFinite(raw.riskScore, item.risk_score),
    rsGlobalPct: firstFinite(raw.rsGlobalPct, metrics.rsGlobalPct),
    rsRating: firstFinite(raw.rsRating, metrics.rsRating, item.rs_rating),
    sourceScanCreatedAt: item.created_at || raw.createdAt || "",
  };
}

function basePasses(row = {}, options = {}) {
  if (!row.symbol) return false;
  const maxFreshness = Number.isFinite(options.maxPriceFreshnessDays) ? options.maxPriceFreshnessDays : DEFAULT_MAX_PRICE_FRESHNESS_DAYS;
  if (maxFreshness < 999 && !priceFreshness(row, maxFreshness).ok) return false;
  const minCoverage = Number.isFinite(options.minCoverageScore) ? options.minCoverageScore : DEFAULT_MIN_COVERAGE;
  const coverage = metric(row, "dataCoverageScore");
  if (Number.isFinite(coverage) && coverage < minCoverage) return false;
  if (Number.isFinite(options.minTotalScore) && (objectiveMetric(row) || 0) < options.minTotalScore) return false;
  if (Number.isFinite(options.minRs) && !(Number.isFinite(rsUniverseValue(row)) && rsUniverseValue(row) >= options.minRs)) return false;
  if (Number.isFinite(options.minMarketCap) && (metric(row, "marketCap") || 0) < options.minMarketCap) return false;
  if (Number.isFinite(options.minAvgTurnover) && (metric(row, "avgTurnover") || 0) < options.minAvgTurnover) return false;
  return true;
}

function strategyPasses(row = {}, strategy = "momentum", options = {}) {
  const total = objectiveMetric(row) || 0;
  const rs = rsValue(row) || 0;
  const perf3m = metric(row, "perf3m");
  const perf6m = metric(row, "perf6m");
  const distance52w = metric(row, "distance52w");
  const longStrategy = strategy !== "weakness";
  const strictTrendStrategy = ["stage2", "minervini"].includes(strategy);

  if (longStrategy && !isLongOpportunityRow(row, { requireTrendTemplate: strictTrendStrategy })) return false;

  if (strategy === "stage2") return isStage2(row) && total >= 55;
  if (strategy === "nearPivot") return rowPassesListContract(row, "nearPivot");
  if (strategy === "rs") return Number.isFinite(rsUniverseValue(row)) && rsUniverseValue(row) >= 60;
  if (strategy === "rsQuality") return rowPassesListContract(row, "rsQuality");
  if (strategy === "growth") return (metric(row, "growthScore") || metric(row, "epsGrowthProxyScore") || 0) >= 50 && total >= 50;
  if (strategy === "weakness") return weaknessValue(row) >= 45;
  if (strategy === "minervini") return rowPassesListContract(row, "minervini");
  if (strategy === "ipo") return rowPassesListContract(row, "ipo");
  if (strategy === "extended") return rowPassesListContract(row, "extended");
  if (strategy === "pullback") return rowPassesListContract(row, "pullback");
  if (strategy === "liquidity") return (metric(row, "avgTurnover") || 0) > 0 && total >= 45;
  if (strategy === "return6m") return Number.isFinite(perf6m) && perf6m > 0 && total >= 45;
  if (strategy === "composite") return total >= 50;
  return total >= 45 && rs >= 45 && (!Number.isFinite(distance52w) || distance52w >= -45);
}

function strategyScore(row = {}, strategy = "momentum") {
  const total = objectiveMetric(row) || 0;
  const rs = rsValue(row) || 0;
  const weinstein = metric(row, "weinsteinScore") || 0;
  const minervini = metric(row, "minerviniScore") || 0;
  const perf3m = metric(row, "perf3m");
  const perf6m = metric(row, "perf6m");
  const perf12m = metric(row, "perf12m");
  const extSma50 = metric(row, "extSma50");
  const distance52w = metric(row, "distance52w");
  const distance20d = metric(row, "distance20d");
  const distanceToPivot = metric(row, "distanceToPivotPct");
  const growth = firstFinite(metric(row, "growthScore"), metric(row, "epsGrowthProxyScore"), 0);
  const rsQuality = metric(row, "rsQualityScore") || 0;
  const weakness = weaknessValue(row);

  if (strategy === "composite") return clamp(total);
  if (strategy === "rs") return clamp(rsUniverseValue(row) ?? 0);
  if (strategy === "rsQuality") return clamp(rsQuality * 0.5 + rs * 0.28 + total * 0.14 + scale(metric(row, "returnToDrawdown3m"), 0, 4) * 0.08);
  if (strategy === "return6m") return clamp(scale(perf6m, -10, 90) * 0.55 + rs * 0.25 + total * 0.2);
  if (strategy === "stage2") return clamp(total * 0.28 + weinstein * 0.28 + minervini * 0.2 + rs * 0.2 + scale(metric(row, "sma200Slope"), -2, 8) * 0.04);
  if (strategy === "nearPivot") {
    const proximityDistance = Number.isFinite(distanceToPivot) ? distanceToPivot : distance20d;
    const proximity = Number.isFinite(proximityDistance) ? 100 - Math.min(100, Math.abs(proximityDistance) * 8) : 0;
    const extensionPenalty = Number.isFinite(extSma50) && extSma50 > 18 ? Math.min(25, extSma50 - 18) : 0;
    return clamp(total * 0.32 + rs * 0.26 + weinstein * 0.18 + proximity * 0.24 - extensionPenalty);
  }
  if (strategy === "growth") return clamp(growth * 0.4 + (metric(row, "epsGrowthProxyScore") || 0) * 0.2 + total * 0.25 + rs * 0.15);
  if (strategy === "weakness") return clamp(weakness * 0.66 + scale(-(perf3m || 0), -25, 25) * 0.16 + scale(-(distance52w || 0), -10, 55) * 0.18);
  if (strategy === "minervini") return clamp(minervini * 0.48 + total * 0.24 + rs * 0.18 + scale(metric(row, "distance52w"), -35, 0) * 0.1);
  if (strategy === "ipo") return clamp((metric(row, "ipoScore") || 0) * 0.44 + total * 0.24 + rs * 0.22 + scale(perf3m, -20, 60) * 0.1);
  if (strategy === "extended") return clamp(total * 0.38 + rs * 0.28 + scale(metric(row, "extSma50"), 12, 36) * 0.22 + scale(metric(row, "distance52w"), -25, 0) * 0.12);
  if (strategy === "pullback") return clamp(total * 0.36 + rs * 0.28 + (100 - Math.min(100, Math.abs((metric(row, "extSma50") ?? 99) - 2) * 11)) * 0.24 + weinstein * 0.12);
  if (strategy === "liquidity") return clamp(logScale(metric(row, "avgTurnover")) * 0.45 + total * 0.35 + rs * 0.2);
  return clamp(total * 0.22 + rs * 0.25 + scale(perf6m, -15, 80) * 0.24 + scale(perf3m, -10, 40) * 0.16 + scale(perf12m, -25, 120) * 0.08 + weinstein * 0.05);
}

function publicItem(row = {}, rank, strategy = "momentum", maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS) {
  const score = strategyScore(row, strategy);
  const freshness = priceFreshness(row, maxPriceFreshnessDays);
  const rsUniverse = rsUniverseValue(row);
  const rsBenchmark = rsBenchmarkValue(row);
  const reliability = methodologyReliability(row, maxPriceFreshnessDays);
  return {
    rank,
    symbol: row.symbol,
    companyName: row.companyName || row.name || row.symbol,
    country: row.country || "",
    sector: row.sector || "",
    industry: row.industry || "",
    theme: row.theme || "",
    score: Math.round(score),
    objectiveScore: finiteOrNull(objectiveMetric(row)),
    totalScore: finiteOrNull(metric(row, "totalScore")),
    compositeScore: finiteOrNull(metric(row, "compositeScore")),
    rsGlobalPct: finiteOrNull(rsUniverse),
    rsRating: finiteOrNull(rsBenchmark),
    rsCountryPct: finiteOrNull(metric(row, "rsCountryPct")),
    rsSectorPct: finiteOrNull(metric(row, "rsSectorPct")),
    rsQualityScore: finiteOrNull(metric(row, "rsQualityScore")),
    weinsteinScore: finiteOrNull(metric(row, "weinsteinScore")),
    minerviniScore: finiteOrNull(metric(row, "minerviniScore")),
    riskScore: finiteOrNull(metric(row, "riskScore")),
    weaknessScore: finiteOrNull(weaknessValue(row)),
    dataCoverageScore: finiteOrNull(metric(row, "dataCoverageScore")),
    percentileScope: metricText(row, "percentileScope") || "batch",
    lastDate: metricText(row, "lastDate"),
    priceFreshnessDays: finiteOrNull(freshness.days),
    priceFreshnessLabel: freshness.label,
    priceFreshnessIssue: freshness.issue,
    price: finiteOrNull(metric(row, "price")),
    sma50: finiteOrNull(metric(row, "sma50")),
    sma150: finiteOrNull(metric(row, "sma150")),
    sma200: finiteOrNull(metric(row, "sma200")),
    sma200Slope: finiteOrNull(metric(row, "sma200Slope")),
    perf3m: finiteOrNull(metric(row, "perf3m")),
    perf6m: finiteOrNull(metric(row, "perf6m")),
    perf12m: finiteOrNull(metric(row, "perf12m")),
    distance20d: finiteOrNull(metric(row, "distance20d")),
    distance50d: finiteOrNull(metric(row, "distance50d")),
    distance52w: finiteOrNull(metric(row, "distance52w")),
    extSma50: finiteOrNull(metric(row, "extSma50")),
    avgTurnover: finiteOrNull(metric(row, "avgTurnover")),
    marketCap: finiteOrNull(metric(row, "marketCap")),
    currency: metricText(row, "currency"),
    ipoScore: finiteOrNull(metric(row, "ipoScore")),
    ipoDate: metricText(row, "ipoDate"),
    chartProvider: metricText(row, "chartProvider"),
    setupQualityScore: finiteOrNull(metric(row, "setupQualityScore")),
    patternQualityScore: finiteOrNull(metric(row, "patternQualityScore")),
    patternDataStatus: metricText(row, "patternDataStatus") || "sin dato",
    patternEligible: metricBool(row, "patternEligible"),
    patternFamily: metricText(row, "patternFamily"),
    patternMaturity: metricText(row, "patternMaturity"),
    ...publicMethodologyFields(reliability),
    vcpCandidate: metricBool(row, "vcpCandidate"),
    breakoutAttempt: metricBool(row, "breakoutAttempt"),
    pivotSqueeze: metricBool(row, "pivotSqueeze"),
    failedBreakout: metricBool(row, "failedBreakout"),
    distanceToPivotPct: finiteOrNull(metric(row, "distanceToPivotPct")),
    baseDepthPct: finiteOrNull(metric(row, "baseDepthPct")),
    contractionCount: finiteOrNull(metric(row, "contractionCount")),
    volumeDryUpRatio: finiteOrNull(metric(row, "volumeDryUpRatio")),
    sourceScanCreatedAt: row.sourceScanCreatedAt || "",
  };
}

function dedupeRows(rows = []) {
  const bySymbol = new Map();
  for (const row of rows) {
    if (!row.symbol) continue;
    const previous = bySymbol.get(row.symbol);
    if (!previous) {
      bySymbol.set(row.symbol, row);
      continue;
    }
    const prevTime = Date.parse(previous.sourceScanCreatedAt || "") || 0;
    const nextTime = Date.parse(row.sourceScanCreatedAt || "") || 0;
    if (nextTime > prevTime) bySymbol.set(row.symbol, row);
    else if (nextTime === prevTime && (objectiveMetric(row) || 0) > (objectiveMetric(previous) || 0)) bySymbol.set(row.symbol, row);
  }
  return [...bySymbol.values()];
}

// F-A2 — "Descubrimiento global curado" ordena cada símbolo por señales que
// ya son absolutas para ese símbolo. Ninguna de estas lecturas depende de la
// composición o del tamaño del lote: rsRating compara contra el benchmark
// local del símbolo y el resto procede de su precio, volumen o señales ya
// calculadas. En particular, no leer objectiveScore ni rsGlobalPct aquí evita
// usar sectorScore o percentiles batch como orden o como desempate.
const CURATED_ABSOLUTE_ORDER = [
  ["rsRating", "desc"],
  ["weinsteinScore", "desc"],
  ["minerviniScore", "desc"],
  ["setupQualityScore", "desc"],
  ["perf3m", "desc"],
  ["perf6m", "desc"],
  ["perf12m", "desc"],
  ["distance52w", "desc"],
  ["extSma50", "asc"],
  ["avgTurnover", "desc"],
];

function compareCuratedAbsoluteRows(a = {}, b = {}) {
  for (const [key, direction] of CURATED_ABSOLUTE_ORDER) {
    const aValue = metric(a, key);
    const bValue = metric(b, key);
    // Datos presentes van antes que la ausencia; no se sintetizan percentiles
    // ni scores para rellenar una señal no disponible.
    if (Number.isFinite(aValue) !== Number.isFinite(bValue)) return Number.isFinite(aValue) ? -1 : 1;
    if (!Number.isFinite(aValue) || aValue === bValue) continue;
    return direction === "desc" ? bValue - aValue : aValue - bValue;
  }
  // El símbolo es un desempate estable, independiente del orden de entrada.
  return String(a.symbol || "").localeCompare(String(b.symbol || ""));
}

function hasPresentSignalContradiction(row = {}) {
  const contradictions = row.signalContradictions ?? row.metrics?.signalContradictions;
  // Las filas del cron no llevan el campo hasta que exista finalización: la
  // ausencia no afirma que no haya contradicciones y, por contrato, no excluye.
  // Una contradicción ya materializada sí es grave para esta vista curada.
  return Array.isArray(contradictions) && contradictions.length > 0;
}

export function buildLeaderboard(rows = [], params = {}) {
  const strategy = normalizeStrategy(params.strategy || params.type);
  const curatedDiscovery = params.curatedDiscovery === true;
  const scopeType = normalizeScopeType(params.scopeType || params.scope || (params.country ? "country" : params.sector ? "sector" : "global"));
  const scopeValue = cleanText(params.scopeValue || params.country || params.sector || params.industry || params.theme || "");
  const limit = Math.min(Math.max(Number(params.limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
  const options = {
    minCoverageScore: firstFinite(params.minCoverageScore),
    minTotalScore: firstFinite(params.minTotalScore),
    minRs: firstFinite(params.minRs),
    minMarketCap: firstFinite(params.minMarketCap),
    minAvgTurnover: firstFinite(params.minAvgTurnover),
    maxPriceFreshnessDays: firstFinite(params.maxPriceFreshnessDays) ?? DEFAULT_MAX_PRICE_FRESHNESS_DAYS,
  };
  const screenerFilterParams = strategy === "weakness"
    ? { ...params, setupMode: "weakness", minWeaknessScore: firstFinite(params.minWeaknessScore) ?? 45 }
    : params;
  const screenerFilters = screenerFiltersFromParams(screenerFilterParams);
  const all = dedupeRows(rows.map(rowFromScanResult));
  const eligible = all
    // F-A3: la vista curada publica exclusivamente filas batch. El scope
    // ausente conserva el default histórico "batch"; las filas final siguen
    // disponibles para leaderboards normales, pero no pertenecen a esta capa.
    .filter((row) => !curatedDiscovery || (metricText(row, "percentileScope") || "batch") === "batch")
    .filter((row) => scopeMatches(row, scopeType, scopeValue))
    .filter((row) => basePasses(row, options))
    .filter((row) => strategyPasses(row, strategy, options))
    .filter((row) => !curatedDiscovery || !hasPresentSignalContradiction(row));
  const filtered = applyScreenerFilters(eligible, screenerFilters);
  const ranked = filtered.rows
    .map((row, index) => ({ row, score: strategyScore(row, strategy), sourceIndex: index }))
    .sort((a, b) => curatedDiscovery
      ? compareCuratedAbsoluteRows(a.row, b.row)
      : (b.score - a.score)
        || ((objectiveMetric(b.row) || 0) - (objectiveMetric(a.row) || 0))
        || ((a.row.percentileScope === "final" ? 0 : 1) - (b.row.percentileScope === "final" ? 0 : 1))
        || (a.sourceIndex - b.sourceIndex))
    .slice(0, limit)
    .map(({ row }, index) => publicItem(row, index + 1, strategy, options.maxPriceFreshnessDays));

  const scopeLabel = scopeType === "global" ? "Global" : scopeValue || scopeType;
  const strategyMeta = LEADERBOARD_STRATEGIES[strategy];
  return {
    key: params.key || `${scopeType}:${scopeValue || "global"}:${strategy}`,
    title: params.title || `${strategyMeta.label} - ${scopeLabel}`,
    strategy,
    strategyLabel: strategyMeta.label,
    scopeType,
    scopeValue,
    criteria: {
      derivedOnly: true,
      minCoverageScore: options.minCoverageScore ?? DEFAULT_MIN_COVERAGE,
      minTotalScore: options.minTotalScore ?? null,
      minRs: options.minRs ?? null,
      minMarketCap: options.minMarketCap ?? null,
      minAvgTurnover: options.minAvgTurnover ?? null,
      maxPriceFreshnessDays: options.maxPriceFreshnessDays,
      screenerFilters: filtered.summary,
      description: strategyMeta.description,
      ...(curatedDiscovery ? { curatedDiscovery: true } : {}),
    },
    source: "Supabase scan_results derived signals",
    input: {
      rowsRead: rows.length,
      deduped: all.length,
      eligible: eligible.length,
      passedFilters: filtered.rows.length,
      filterRejections: filtered.rejections.length,
    },
    count: ranked.length,
    generatedAt: new Date().toISOString(),
    items: ranked,
  };
}

export { SCREENER_FILTER_QUERY_KEYS };

export function buildGroupedLeaderboards(rows = [], params = {}) {
  const groupBy = normalizeScopeType(params.groupBy || "country");
  const field = scopeField(groupBy);
  if (!field) return [buildLeaderboard(rows, params)];
  const limit = Math.min(Math.max(Number(params.limit || 10), 1), MAX_LIMIT);
  const groupsLimit = Math.min(Math.max(Number(params.groupsLimit || 20), 1), 100);
  const minGroupSize = Math.max(Number(params.minGroupSize || 2), 1);
  const baseRows = dedupeRows(rows.map(rowFromScanResult)).filter((row) => cleanText(row[field]));
  const groups = new Map();
  for (const row of baseRows) {
    const key = cleanText(row[field]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.entries()]
    .filter(([, groupRows]) => groupRows.length >= minGroupSize)
    .map(([value, groupRows]) => {
      const leaderboard = buildLeaderboard(groupRows.map((row) => ({ raw: row, created_at: row.sourceScanCreatedAt })), {
        ...params,
        groupBy: "",
        scopeType: groupBy,
        scopeValue: value,
        limit,
        key: `${groupBy}:${value}:${normalizeStrategy(params.strategy || params.type)}`,
        title: `${LEADERBOARD_STRATEGIES[normalizeStrategy(params.strategy || params.type)].label} - ${value}`,
      });
      return {
        ...leaderboard,
        contractScopeRows: groupRows.length,
        contractDrilldown: buildGroupListDrilldown(groupRows),
      };
    })
    .filter((leaderboard) => leaderboard.count > 0)
    .sort((a, b) => ((b.items[0]?.score || 0) - (a.items[0]?.score || 0)) || (b.input.eligible - a.input.eligible))
    .slice(0, groupsLimit);
}

export async function readScanRows({ maxRows = DEFAULT_SCAN_ROWS, sinceDays = 45, timeoutMs = DEFAULT_SCAN_READ_TIMEOUT_MS } = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, ...disabledPayload(), rows: [] };
  const limit = Math.min(Math.max(Number(maxRows || DEFAULT_SCAN_ROWS), 1), 10000);
  const since = Math.max(Number(sinceDays || 45), 1);
  // Filtra por estado del scan padre: SOLO filas cuyo `progress.status` ∈
  // {complete, partial, done} se devuelven (RPC leaderboard_publishable_rows).
  // done se incluye por retrocompat con snapshots legacy. failed/error/cancelled
  // nunca publican. Ver docs/reliability-audit-2026-07-10.md §"Terminal done
  // can mean zero successful scan rows".
  const rpcPayload = await supabaseRpc(
    "leaderboard_publishable_rows",
    {
      p_owner_id: config.ownerId,
      p_max_rows: limit,
      p_since_days: since,
    },
    { timeoutMs },
  );
  const result = rpcPayload && typeof rpcPayload === "object" && !Array.isArray(rpcPayload)
    ? rpcPayload
    : (Array.isArray(rpcPayload) ? rpcPayload[0] || {} : {});
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return {
    configured: true,
    rows,
    ownerId: config.ownerId,
    rowsRead: Number(result.rowsRead || rows.length),
    rowsPublished: Number(result.rowsPublished || rows.length),
    rowsExcluded: Number(result.rowsExcluded || 0),
  };
}

export async function readMaterializedLeaderboard(key = "", { timeoutMs = DEFAULT_MATERIALIZED_READ_TIMEOUT_MS } = {}) {
  const config = supabaseConfig();
  if (!config.configured || !key) return null;
  const snapshots = await supabaseRequest("leaderboard_snapshots", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&leaderboard_key=eq.${encodeURIComponent(key)}&select=*&order=generated_at.desc&limit=1`,
    timeoutMs,
  });
  const snapshot = snapshots?.[0];
  if (!snapshot) return null;
  const items = await supabaseRequest("leaderboard_items", {
    query: `snapshot_id=eq.${encodeURIComponent(snapshot.id)}&select=*&order=rank_index.asc`,
    timeoutMs,
  });
  return {
    key: snapshot.leaderboard_key,
    title: snapshot.title,
    strategy: snapshot.strategy,
    scopeType: snapshot.scope_type,
    scopeValue: snapshot.scope_value || "",
    criteria: snapshot.criteria || {},
    source: snapshot.source || "leaderboard_snapshots",
    count: Number(snapshot.item_count || items?.length || 0),
    generatedAt: snapshot.generated_at,
    items: (items || []).map((item) => sanitizeMaterializedLeaderboardItem(item, snapshot.criteria || {})),
    cache: { hit: true, status: "supabase" },
  };
}

export function sanitizeMaterializedLeaderboardItem(item = {}, criteria = {}) {
  const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
  const sector = cleanText(metrics.sector || item.sector || "Sin sector");
  const industry = cleanText(metrics.industry || item.industry || "Sin industria");
  const summary = cleanText(metrics.businessSummary || metrics.summary || metrics.businessEs || "");
  const row = {
    ...metrics,
    symbol: cleanText(metrics.symbol || item.symbol).toUpperCase(),
    companyName: cleanText(metrics.companyName || metrics.name || item.company_name || item.symbol),
    country: cleanText(metrics.country || item.country),
    sector,
    industry,
    theme: canonicalTheme({ sector, industry, theme: metrics.theme || item.theme, summary }),
    score: finiteOrNull(item.score ?? metrics.score),
  };
  const maxPriceFreshnessDays = firstFinite(criteria.maxPriceFreshnessDays) ?? DEFAULT_MAX_PRICE_FRESHNESS_DAYS;
  const reliability = methodologyReliability(row, maxPriceFreshnessDays);
  return {
    rank: item.rank_index,
    symbol: row.symbol,
    companyName: row.companyName,
    country: row.country,
    sector: row.sector,
    industry: row.industry,
    theme: row.theme,
    score: row.score,
    ...metrics,
    ...publicMethodologyFields(reliability),
  };
}

export async function writeMaterializedLeaderboards(leaderboards = []) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: 0, ...disabledPayload() };
  const saved = [];
  for (const leaderboard of leaderboards) {
    const [snapshot] = await supabaseRequest("leaderboard_snapshots", {
      method: "POST",
      query: "on_conflict=owner_id,leaderboard_key",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [{
        owner_id: config.ownerId,
        leaderboard_key: leaderboard.key,
        scope_type: leaderboard.scopeType,
        scope_value: leaderboard.scopeValue || null,
        strategy: leaderboard.strategy,
        title: leaderboard.title,
        criteria: leaderboard.criteria || {},
        item_count: leaderboard.items?.length || 0,
        source: leaderboard.source,
        generated_at: new Date().toISOString(),
      }],
    });
    await supabaseRequest("leaderboard_items", {
      method: "DELETE",
      query: `snapshot_id=eq.${encodeURIComponent(snapshot.id)}`,
    });
    const items = leaderboard.items || [];
    if (items.length) {
      await supabaseRequest("leaderboard_items", {
        method: "POST",
        prefer: "return=minimal",
        body: items.map((item) => ({
          owner_id: config.ownerId,
          snapshot_id: snapshot.id,
          rank_index: item.rank,
          symbol: item.symbol,
          company_name: textOrNull(item.companyName),
          country: textOrNull(item.country),
          sector: textOrNull(item.sector),
          industry: textOrNull(item.industry),
          theme: textOrNull(item.theme),
          score: finiteOrNull(item.score),
          metrics: {
            totalScore: item.totalScore ?? null,
            rsGlobalPct: item.rsGlobalPct ?? null,
            rsRating: item.rsRating ?? null,
            rsCountryPct: item.rsCountryPct ?? null,
            rsSectorPct: item.rsSectorPct ?? null,
            rsQualityScore: item.rsQualityScore ?? null,
            weinsteinScore: item.weinsteinScore ?? null,
            minerviniScore: item.minerviniScore ?? null,
            dataCoverageScore: item.dataCoverageScore ?? null,
            lastDate: item.lastDate || "",
            priceFreshnessDays: item.priceFreshnessDays ?? null,
            priceFreshnessLabel: item.priceFreshnessLabel || "",
            priceFreshnessIssue: item.priceFreshnessIssue || "",
            perf3m: item.perf3m ?? null,
            perf6m: item.perf6m ?? null,
            perf12m: item.perf12m ?? null,
            distance20d: item.distance20d ?? null,
            distance52w: item.distance52w ?? null,
            avgTurnover: item.avgTurnover ?? null,
            marketCap: item.marketCap ?? null,
            currency: item.currency || "",
            chartProvider: item.chartProvider || "",
            setupQualityScore: item.setupQualityScore ?? null,
            patternQualityScore: item.patternQualityScore ?? null,
            patternDataStatus: item.patternDataStatus || "",
            patternEligible: item.patternEligible ?? null,
            patternFamily: item.patternFamily || "",
            patternMaturity: item.patternMaturity || "",
            setupVerdictKey: item.setupVerdictKey || "",
            setupVerdictState: item.setupVerdictState || "",
            setupVerdictLabel: item.setupVerdictLabel || "",
            setupVerdictShortLabel: item.setupVerdictShortLabel || "",
            setupPlanValid: item.setupPlanValid ?? null,
            setupActionable: item.setupActionable ?? null,
            setupWatch: item.setupWatch ?? null,
            setupStrict: item.setupStrict ?? null,
            setupDisplayKey: item.setupDisplayKey || "",
            setupDisplayState: item.setupDisplayState || "",
            setupDisplayLabel: item.setupDisplayLabel || "",
            setupDisplayShortLabel: item.setupDisplayShortLabel || "",
            setupDisplayReason: item.setupDisplayReason || "",
            setupDisplayEvidence: item.setupDisplayEvidence || "",
            setupDisplayLine: item.setupDisplayLine || "",
            setupDisplayTone: item.setupDisplayTone || "",
            setupDisplayDataLimited: item.setupDisplayDataLimited ?? null,
            setupDisplayBlocksPatternClaim: item.setupDisplayBlocksPatternClaim ?? null,
            setupDisplayPlanValid: item.setupDisplayPlanValid ?? null,
            setupDisplayActionable: item.setupDisplayActionable ?? null,
            setupDisplayObservable: item.setupDisplayObservable ?? null,
            setupDisplayWatch: item.setupDisplayWatch ?? null,
            setupDisplayStrict: item.setupDisplayStrict ?? null,
            setupDisplayTradePlanEligible: item.setupDisplayTradePlanEligible ?? null,
            setupDisplayConfidenceKey: item.setupDisplayConfidenceKey || "",
            setupDisplayConfidenceLabel: item.setupDisplayConfidenceLabel || "",
            methodologyReliabilityState: item.methodologyReliabilityState || "",
            methodologyReliabilityLabel: item.methodologyReliabilityLabel || "",
            methodologyReliabilityReason: item.methodologyReliabilityReason || "",
            methodologyBlocksPatternClaim: item.methodologyBlocksPatternClaim ?? null,
            vcpCandidate: item.vcpCandidate ?? null,
            breakoutAttempt: item.breakoutAttempt ?? null,
            pivotSqueeze: item.pivotSqueeze ?? null,
            failedBreakout: item.failedBreakout ?? null,
            distanceToPivotPct: item.distanceToPivotPct ?? null,
            baseDepthPct: item.baseDepthPct ?? null,
            contractionCount: item.contractionCount ?? null,
            volumeDryUpRatio: item.volumeDryUpRatio ?? null,
            sourceScanCreatedAt: item.sourceScanCreatedAt || "",
          },
        })),
      });
    }
    saved.push({ key: leaderboard.key, count: items.length, snapshotId: snapshot.id });
  }
  return { configured: true, ok: true, saved: saved.length, leaderboards: saved };
}
