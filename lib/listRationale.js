import { num, pct } from "@/lib/formatters";
import { methodologyPivotWatchEligible } from "@/lib/methodologyDisplay";
import { longOpportunityIssue, metricValue, monthsSince, snapshotValue, weaknessScore } from "@/lib/stockRows";

export const LIST_CONTRACTS = {
  favorites: {
    title: "Favoritos",
    tone: "neutral",
    label: "Watchlist manual",
    text: "Selección manual: no implica contrato automático.",
  },
  leaders: {
    title: "Score compuesto",
    tone: "bullish",
    label: "Largo coherente",
    text: "Score compuesto alto con sesgo largo; excluye deterioro técnico y bajismo estructural.",
  },
  rsQuality: {
    title: "RS Quality Leaders",
    tone: "bullish",
    label: "RS de calidad",
    text: "RS Quality y RS universo altos con sesgo largo; excluye deterioro técnico y bajismo estructural.",
  },
  weakness: {
    title: "Deterioro técnico",
    tone: "bearish",
    label: "Deterioro",
    text: "Lista defensiva/bajista: aquí sí tiene sentido ver debilidad observable.",
  },
  weinstein: {
    title: "Weinstein Leaders",
    tone: "bullish",
    label: "Stage 2",
    text: "Estructura Weinstein/Stage 2 y medias coherentes; excluye deterioro técnico.",
  },
  minervini: {
    title: "Minervini Leaders",
    tone: "bullish",
    label: "Trend template",
    text: "Trend template, momentum y cercanía a máximos; excluye deterioro técnico y bajismo estructural.",
  },
  nearPivot: {
    title: "Vigilancia pivot",
    tone: "watch",
    label: "Vigilancia",
    text: "Líder fuerte cerca de pivot observable; vigilancia, no plan automático.",
  },
  ipo: {
    title: "IPO / New Leaders",
    tone: "watch",
    label: "IPO real",
    text: "IPO verificable y fuerza derivada; excluye deterioro técnico y bajismo estructural.",
  },
  extended: {
    title: "Extended but strong",
    tone: "watch",
    label: "Extendida",
    text: "Fuerte pero extendida sobre SMA50; vigilancia, no entrada automática.",
  },
  pullback: {
    title: "Pullback to SMA50",
    tone: "watch",
    label: "Pullback sano",
    text: "Líder con retroceso controlado hacia SMA50 y sesgo largo vigente.",
  },
};

const BULLISH_LISTS = new Set(["leaders", "rsQuality", "weinstein", "minervini", "nearPivot", "ipo", "extended", "pullback"]);
export const GROUP_DRILLDOWN_LIST_KEYS = ["leaders", "minervini", "nearPivot", "extended", "pullback", "weakness"];
export const DEFAULT_LIST_RELIABILITY_CRITERIA = {
  maxPriceFreshnessDays: 5,
  minCoverageScore: 40,
};

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function metric(row = {}, key = "") {
  const value = metricValue(row, key);
  return Number.isFinite(value) ? value : finite(snapshotValue(row, key));
}

function rowValue(row = {}, key = "") {
  return row?.[key] ?? snapshotValue(row, key);
}

function pushMetric(parts, label, value, formatter = num) {
  if (Number.isFinite(value)) parts.push(`${label} ${formatter(value)}`);
}

function trendTemplateOk(row = {}) {
  return !longOpportunityIssue(row, { requireTrendTemplate: true });
}

function longBiasOk(row = {}) {
  return !longOpportunityIssue(row);
}

function sma50ExtensionOk(row = {}, extValue = metric(row, "extSma50"), tolerancePct = 2) {
  const price = metric(row, "price");
  const sma50 = metric(row, "sma50");
  const ext = finite(extValue);
  if (!Number.isFinite(price) || !Number.isFinite(sma50) || !Number.isFinite(ext) || sma50 <= 0) return false;
  const calculated = ((price / sma50) - 1) * 100;
  return Math.abs(calculated - ext) <= tolerancePct;
}

function lowDeteriorationLabel(row = {}) {
  const weak = weaknessScore(row);
  return Number.isFinite(weak) && weak < 35 ? `deterioro bajo ${num(weak)}` : "";
}

function ipoAgeMonths(row = {}) {
  const stored = metric(row, "ipoAgeMonths");
  if (Number.isFinite(stored)) return stored;
  return monthsSince(rowValue(row, "ipoDate"));
}

function recentIpoOk(row = {}, maxMonths = 60) {
  const age = ipoAgeMonths(row);
  return Number.isFinite(age) && age >= 0 && age <= maxMonths;
}

export function listContractForKey(key = "") {
  return LIST_CONTRACTS[key] || {
    title: "Lista derivada",
    tone: "neutral",
    label: "Lista derivada",
    text: "Ranking derivado del universo disponible.",
  };
}

export function isBullishListKey(key = "") {
  return BULLISH_LISTS.has(key);
}

export function rowPassesListContract(row = {}, listKey = "leaders", options = {}) {
  const total = metric(row, "objectiveScore") ?? 0;
  const rs = metric(row, "rsGlobalPct") ?? 0;
  const perf3m = metric(row, "perf3m");
  const distance52w = metric(row, "distance52w");
  const extSma50 = metric(row, "extSma50");
  const minervini = metric(row, "minerviniScore") ?? 0;
  const weinstein = metric(row, "weinsteinScore") ?? 0;
  const maxIpoAgeMonths = finite(options.maxIpoAgeMonths) ?? 60;

  if (listKey === "weakness") return weaknessScore(row) >= 45;
  if (isBullishListKey(listKey) && !longBiasOk(row)) return false;

  if (listKey === "minervini") {
    if (!trendTemplateOk(row)) return false;
    if (minervini < 60 || total < 50 || rs < 55) return false;
    if (Number.isFinite(perf3m) && perf3m < 0) return false;
    if (Number.isFinite(distance52w) && distance52w < -25) return false;
    return true;
  }

  if (listKey === "weinstein") return trendTemplateOk(row) && weinstein >= 55 && total >= 55;
  if (listKey === "rsQuality") return (metric(row, "rsQualityScore") ?? 0) >= 55 && rs >= 55;
  if (listKey === "nearPivot") return total >= 55 && rs >= 55 && methodologyPivotWatchEligible(row);
  if (listKey === "ipo") return recentIpoOk(row, maxIpoAgeMonths) && ((metric(row, "ipoScore") ?? 0) >= 45 || total >= 50 || rs >= 55);
  if (listKey === "extended") return total >= 70 && Number.isFinite(extSma50) && sma50ExtensionOk(row, extSma50) && extSma50 >= 15 && (!Number.isFinite(distance52w) || distance52w >= -20);
  if (listKey === "pullback") return total >= 50 && Number.isFinite(extSma50) && sma50ExtensionOk(row, extSma50) && extSma50 >= -3 && extSma50 <= 8;
  return total >= 50;
}

export function enforceListContractRows(rows = [], listKey = "leaders") {
  const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (listKey === "favorites") {
    return { rows: sourceRows, rejectedRows: [], rejectedCount: 0 };
  }
  const accepted = [];
  const rejected = [];
  for (const row of sourceRows) {
    if (rowPassesListContract(row, listKey)) accepted.push(row);
    else rejected.push(row);
  }
  return {
    rows: accepted,
    rejectedRows: rejected,
    rejectedCount: rejected.length,
  };
}

export function listInclusionReasons(row = {}, listKey = "leaders", limit = 4) {
  const reasons = [];
  const weak = weaknessScore(row);
  const perf3m = metric(row, "perf3m");
  const distance52w = metric(row, "distance52w");
  const extSma50 = metric(row, "extSma50");

  if (isBullishListKey(listKey)) {
    const issue = listKey === "weinstein" || listKey === "minervini"
      ? longOpportunityIssue(row, { requireTrendTemplate: true })
      : longOpportunityIssue(row);
    if (issue) reasons.push(`Revisar coherencia: ${issue}`);
  }

  if (listKey === "weakness") {
    pushMetric(reasons, "deterioro", weak);
    if (Number.isFinite(perf3m) && perf3m < 0) pushMetric(reasons, "3M", perf3m, pct);
    if (Number.isFinite(distance52w) && distance52w < -20) pushMetric(reasons, "52w", distance52w, pct);
    pushMetric(reasons, "risk", metric(row, "riskScore"));
    return reasons.slice(0, limit);
  }

  if (listKey === "rsQuality") {
    pushMetric(reasons, "RSQ", metric(row, "rsQualityScore"));
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
    pushMetric(reasons, "R/vol", metric(row, "returnToVol3m"));
    if (longBiasOk(row)) reasons.push("sesgo largo OK");
  } else if (listKey === "weinstein") {
    pushMetric(reasons, "Weinstein", metric(row, "weinsteinScore"));
    if (trendTemplateOk(row)) reasons.push("Stage 2/medias OK");
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
    pushMetric(reasons, "3M", perf3m, pct);
  } else if (listKey === "minervini") {
    pushMetric(reasons, "Minervini", metric(row, "minerviniScore"));
    if (trendTemplateOk(row)) reasons.push("trend template OK");
    pushMetric(reasons, "3M", perf3m, pct);
    pushMetric(reasons, "52w", distance52w, pct);
  } else if (listKey === "nearPivot") {
    pushMetric(reasons, "Score compuesto", metric(row, "objectiveScore"));
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
    pushMetric(reasons, "pivot", metric(row, "distanceToPivotPct"), pct);
    pushMetric(reasons, "SMA50", extSma50, pct);
    if (!methodologyPivotWatchEligible(row)) reasons.push("pivot no validado");
  } else if (listKey === "ipo") {
    pushMetric(reasons, "IPO score", metric(row, "ipoScore"));
    const age = ipoAgeMonths(row);
    if (Number.isFinite(age)) reasons.push(`IPO ${num(age)}m`);
    else reasons.push("IPO no verificada");
    if (Number.isFinite(age) && (age < 0 || age > 60)) reasons.push("fuera de ventana IPO");
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
    pushMetric(reasons, "3M", perf3m, pct);
  } else if (listKey === "extended") {
    pushMetric(reasons, "Score compuesto", metric(row, "objectiveScore"));
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
    pushMetric(reasons, "SMA50", extSma50, pct);
    if (Number.isFinite(extSma50) && !sma50ExtensionOk(row, extSma50)) reasons.push("SMA50 no validada");
    pushMetric(reasons, "52w", distance52w, pct);
  } else if (listKey === "pullback") {
    pushMetric(reasons, "Score compuesto", metric(row, "objectiveScore"));
    pushMetric(reasons, "SMA50", extSma50, pct);
    if (Number.isFinite(extSma50) && !sma50ExtensionOk(row, extSma50)) reasons.push("SMA50 no validada");
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
    pushMetric(reasons, "Weinstein", metric(row, "weinsteinScore"));
  } else if (listKey === "leaders") {
    pushMetric(reasons, "Score compuesto", metric(row, "objectiveScore"));
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
    pushMetric(reasons, "3M", perf3m, pct);
    if (longBiasOk(row)) reasons.push("sesgo largo OK");
  } else {
    pushMetric(reasons, "Score compuesto", metric(row, "objectiveScore"));
    pushMetric(reasons, "RS", metric(row, "rsGlobalPct"));
  }

  const lowWeakness = lowDeteriorationLabel(row);
  if (lowWeakness) reasons.push(lowWeakness);

  return reasons.filter(Boolean).slice(0, limit);
}

export function listInclusionSummary(row = {}, listKey = "leaders", limit = 4) {
  return listInclusionReasons(row, listKey, limit).join(" · ");
}

export function rowReliabilityIssues(row = {}, criteria = {}) {
  const maxPriceFreshnessDays = finite(criteria.maxPriceFreshnessDays) ?? DEFAULT_LIST_RELIABILITY_CRITERIA.maxPriceFreshnessDays;
  const minCoverageScore = finite(criteria.minCoverageScore) ?? DEFAULT_LIST_RELIABILITY_CRITERIA.minCoverageScore;
  const issues = [];
  const priceFreshnessIssue = cleanText(rowValue(row, "priceFreshnessIssue"));
  const priceFreshnessDays = metric(row, "priceFreshnessDays");
  const priceFreshnessOk = rowValue(row, "priceFreshnessOk");
  const coverage = metric(row, "dataCoverageScore");
  const lastDate = cleanText(rowValue(row, "lastDate"));
  const theme = cleanText(rowValue(row, "theme"));
  const sector = cleanText(rowValue(row, "sector"));
  const industry = cleanText(rowValue(row, "industry"));

  if (priceFreshnessIssue) {
    issues.push({ key: "stale", label: priceFreshnessIssue });
  } else if (Number.isFinite(priceFreshnessDays) && priceFreshnessDays > maxPriceFreshnessDays) {
    issues.push({ key: "stale", label: `precio ${num(priceFreshnessDays)}d` });
  } else if (priceFreshnessOk === false) {
    issues.push({ key: "stale", label: "precio no fresco" });
  } else if (!Number.isFinite(priceFreshnessDays) && priceFreshnessOk !== true && !lastDate) {
    issues.push({ key: "stale", label: "precio sin validar" });
  }

  if (!Number.isFinite(coverage)) {
    issues.push({ key: "coverage", label: "cobertura sin validar" });
  } else if (coverage < minCoverageScore) {
    issues.push({ key: "coverage", label: `cobertura ${num(coverage)}` });
  }

  if (rowValue(row, "setupDisplayDataLimited") === true || rowValue(row, "methodologyBlocksPatternClaim") === true || rowValue(row, "setupDisplayBlocksPatternClaim") === true) {
    issues.push({ key: "dataLimited", label: "metodología limitada" });
  }

  if (!theme || !sector || !industry || sector === "Sin sector" || industry === "Sin industria") {
    issues.push({ key: "taxonomy", label: "taxonomía incompleta" });
  }

  return issues;
}

export function summarizeListReliability(rows = [], criteria = {}) {
  const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const summary = {
    state: "empty",
    label: "Sin datos",
    note: "Sin candidatos para validar.",
    rows: sourceRows.length,
    okRows: 0,
    issueRows: 0,
    staleRows: 0,
    lowCoverageRows: 0,
    dataLimitedRows: 0,
    missingTaxonomyRows: 0,
  };

  for (const row of sourceRows) {
    const keys = new Set(rowReliabilityIssues(row, criteria).map((issue) => issue.key));
    if (!keys.size) {
      summary.okRows += 1;
      continue;
    }
    summary.issueRows += 1;
    if (keys.has("stale")) summary.staleRows += 1;
    if (keys.has("coverage")) summary.lowCoverageRows += 1;
    if (keys.has("dataLimited")) summary.dataLimitedRows += 1;
    if (keys.has("taxonomy")) summary.missingTaxonomyRows += 1;
  }

  if (!sourceRows.length) return summary;

  const hardWarnings = [
    summary.staleRows ? `${summary.staleRows} precio viejo` : "",
    summary.lowCoverageRows ? `${summary.lowCoverageRows} cobertura baja` : "",
    summary.missingTaxonomyRows ? `${summary.missingTaxonomyRows} taxonomía incompleta` : "",
  ].filter(Boolean);
  const softWarnings = [
    summary.dataLimitedRows ? `${summary.dataLimitedRows} plan/patrón limitado` : "",
  ].filter(Boolean);

  if (hardWarnings.length) {
    return {
      ...summary,
      state: "warn",
      label: "Revisar datos",
      note: `Revisar ${hardWarnings.join(", ")} antes de confiar en el ranking.`,
    };
  }

  if (softWarnings.length) {
    return {
      ...summary,
      state: "watch",
      label: "Ranking OK",
      note: `Ranking coherente; ${softWarnings.join(", ")} para no inferir setups automáticamente.`,
    };
  }

  return {
    ...summary,
    state: "pass",
    label: "Fiable",
    note: "Precio fresco, cobertura suficiente y taxonomía coherente.",
  };
}

function listSortValue(row = {}, listKey = "leaders") {
  if (listKey === "weakness") return weaknessScore(row);
  if (listKey === "minervini") return metric(row, "minerviniScore") ?? 0;
  if (listKey === "weinstein") return metric(row, "weinsteinScore") ?? 0;
  if (listKey === "rsQuality") return metric(row, "rsQualityScore") ?? 0;
  if (listKey === "ipo") return metric(row, "ipoScore") ?? 0;
  return metric(row, "objectiveScore") ?? 0;
}

export function buildGroupListDrilldown(rows = [], listKeys = GROUP_DRILLDOWN_LIST_KEYS, sampleLimit = 3) {
  const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  return listKeys.map((key) => {
    const contract = listContractForKey(key);
    const matches = sourceRows
      .filter((row) => rowPassesListContract(row, key))
      .sort((a, b) => listSortValue(b, key) - listSortValue(a, key));
    return {
      key,
      title: contract.title,
      label: contract.label,
      tone: contract.tone,
      contract: contract.text,
      count: matches.length,
      reliability: summarizeListReliability(matches),
      sample: matches.slice(0, sampleLimit).map((row) => ({
        symbol: row.symbol,
        companyName: row.companyName || row.name || row.symbol,
        score: listSortValue(row, key),
        reason: listInclusionSummary(row, key, 3),
      })),
    };
  });
}
