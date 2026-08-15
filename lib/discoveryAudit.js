import { num, pctShare } from "@/lib/formatters";
import { normalizeStockRows, rowCountry } from "@/lib/stockRows";

export const DEFAULT_DISCOVERY_AUDIT_CRITERIA = {
  minMarketRows: 3,
  minGroupRows: 3,
  minListRows: 3,
  concentrationPct: 70,
  biasDeltaPct: 25,
};

const DIMENSIONS = ["country", "sector", "theme", "industry"];

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function countWithRowsFallback(count, rows = []) {
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  const n = finite(count);
  return Number.isFinite(n) ? Math.max(0, Math.max(Math.round(n), rowCount)) : rowCount;
}

function pctValue(value, total) {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key] ?? row?.raw?.[key] ?? row?.metrics?.[key] ?? row?.snapshot?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function metricValue(row = {}, camelKey = "", snakeKey = "") {
  return finite(firstValue(row, [camelKey, snakeKey || camelKey]));
}

function auditRow(row = {}) {
  const raw = row.raw || {};
  const metrics = row.metrics || {};
  const symbol = cleanText(row.symbol || raw.symbol || metrics.symbol).toUpperCase();
  return {
    ...raw,
    ...metrics,
    ...row,
    symbol,
    companyName: firstValue(row, ["companyName", "company_name", "name"]) || symbol,
    country: cleanText(firstValue(row, ["country", "market"])) || "",
    sector: cleanText(firstValue(row, ["sector"])) || "",
    industry: cleanText(firstValue(row, ["industry"])) || "",
    theme: cleanText(firstValue(row, ["theme"])) || "",
    totalScore: metricValue(row, "totalScore", "total_score"),
    compositeScore: metricValue(row, "compositeScore", "composite_score"),
    rsGlobalPct: metricValue(row, "rsGlobalPct", "rs_rating"),
    rsRating: metricValue(row, "rsRating", "rs_rating"),
    dataCoverageScore: metricValue(row, "dataCoverageScore", "data_coverage_score"),
    priceFreshnessDays: metricValue(row, "priceFreshnessDays", "price_freshness_days"),
    priceFreshnessIssue: cleanText(firstValue(row, ["priceFreshnessIssue", "price_freshness_issue"]) || ""),
  };
}

export function normalizeAuditRows(rows = []) {
  return normalizeStockRows((Array.isArray(rows) ? rows : []).filter(Boolean).map(auditRow));
}

function rowsForScope(rows = [], scopeType = "global", scopeValue = "") {
  const key = cleanText(scopeType || "global");
  const expected = cleanText(scopeValue).toLowerCase();
  if (!expected || key === "global") return rows;
  return rows.filter((row) => {
    if (key === "country") return cleanText(rowCountry(row)).toLowerCase() === expected;
    if (DIMENSIONS.includes(key)) return cleanText(row[key]).toLowerCase() === expected;
    return true;
  });
}

function distribution(rows = [], dimension = "country", limit = 8) {
  const map = new Map();
  for (const row of rows) {
    const key = dimension === "country" ? rowCountry(row) : cleanText(row[dimension]) || "Sin dato";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count, sharePct: pctValue(count, rows.length) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function distributionMap(items = []) {
  return new Map(items.map((item) => [item.key, item]));
}

function normalizedLists(lists = []) {
  return (Array.isArray(lists) ? lists : []).map((list) => {
    const rows = list.items || list.rows || [];
    return {
      key: list.key || list.title || "lista",
      title: list.title || list.key || "Lista",
      count: countWithRowsFallback(list.count, rows),
      rows,
    };
  });
}

function normalizedGroups(groups = {}) {
  if (Array.isArray(groups)) return groups.map((group) => ({ ...group, dimension: group.dimension || "" }));
  return Object.entries(groups || {}).flatMap(([dimension, values]) => (
    Array.isArray(values) ? values.map((group) => ({ ...group, dimension })) : []
  ));
}

function topLabel(items = [], empty = "Sin dato") {
  const top = items[0];
  return top ? `${top.key} ${pctShare(top.sharePct, 1)}` : empty;
}

function noteForAudit(audit = {}) {
  if (audit.state === "empty") return "Sin universo suficiente para auditar sesgo o cobertura.";
  const parts = [];
  if (audit.coverageGaps.uncoveredMarkets.length) parts.push(`${audit.coverageGaps.uncoveredMarkets.length} mercados sin candidatos visibles`);
  if (audit.coverageGaps.underrepresentedMarkets.length) parts.push(`${audit.coverageGaps.underrepresentedMarkets.length} mercados infrarepresentados`);
  if (audit.concentration.market?.sharePct >= audit.criteria.concentrationPct) parts.push(`concentracion en ${audit.concentration.market.key}`);
  if (audit.listHealth.emptyLists.length) parts.push(`${audit.listHealth.emptyLists.length} listas vacias`);
  if (audit.groupHealth.strongThinGroups.length) parts.push(`${audit.groupHealth.strongThinGroups.length} grupos fuertes con muestra estrecha`);
  if (parts.length) return `Revisar ${parts.join(", ")} antes de interpretar ranking sectorial/listas como lectura global.`;
  if (audit.listHealth.thinLists.length || audit.groupHealth.thinGroups.length) return "Cobertura útil, con algunas listas o grupos de muestra pequeña.";
  return "Cobertura balanceada para interpretar rankings derivados con cautela normal.";
}

export function buildCoverageAudit({
  inputRows = [],
  rankedRows = [],
  lists = [],
  groups = {},
  scopeType = "global",
  scopeValue = "",
  criteria = {},
} = {}) {
  const auditCriteria = { ...DEFAULT_DISCOVERY_AUDIT_CRITERIA, ...(criteria || {}) };
  const universeRows = rowsForScope(normalizeAuditRows(inputRows), scopeType, scopeValue);
  const ranked = normalizeAuditRows(rankedRows.length ? rankedRows : normalizedLists(lists).flatMap((list) => list.rows));
  const scopedRanked = rowsForScope(ranked, scopeType, scopeValue);
  const listRows = normalizedLists(lists);
  const groupRows = normalizedGroups(groups);
  const universeMarkets = distribution(universeRows, "country");
  const rankedMarkets = distribution(scopedRanked, "country");
  const universeSectors = distribution(universeRows, "sector");
  const rankedSectors = distribution(scopedRanked, "sector");
  const rankedMarketMap = distributionMap(rankedMarkets);

  const uncoveredMarkets = universeMarkets
    .filter((item) => item.count >= auditCriteria.minMarketRows && !rankedMarketMap.has(item.key))
    .slice(0, 6);
  const underrepresentedMarkets = universeMarkets
    .map((item) => {
      const rankedItem = rankedMarketMap.get(item.key) || { count: 0, sharePct: 0 };
      return {
        key: item.key,
        universeCount: item.count,
        rankedCount: rankedItem.count,
        universeSharePct: item.sharePct,
        rankedSharePct: rankedItem.sharePct,
        deltaPct: Math.round((item.sharePct - rankedItem.sharePct) * 10) / 10,
      };
    })
    .filter((item) => item.universeCount >= auditCriteria.minMarketRows && item.deltaPct >= auditCriteria.biasDeltaPct)
    .slice(0, 6);

  const listSummaries = listRows.map((list) => ({
    key: list.key,
    title: list.title,
    count: list.count,
    shareOfUniversePct: pctValue(list.count, universeRows.length),
  }));
  const emptyLists = listSummaries.filter((list) => list.count === 0);
  const thinLists = listSummaries.filter((list) => list.count > 0 && list.count < auditCriteria.minListRows);

  const groupSummaries = groupRows.map((group) => {
    const count = countWithRowsFallback(group.count, group.items || []);
    const sampleRows = Array.isArray(group.items) ? group.items.length : 0;
    return {
      key: group.key || "Sin dato",
      dimension: group.dimension || "",
      count,
      sampleRows,
      strength: finite(group.strength),
    };
  }).filter((group) => group.count > 0);
  const thinGroups = groupSummaries
    .filter((group) => group.count < auditCriteria.minGroupRows)
    .sort((a, b) => (b.strength || 0) - (a.strength || 0))
    .slice(0, 8);
  const strongThinGroups = thinGroups.filter((group) => (group.strength || 0) >= 65);
  const truncatedGroups = groupSummaries
    .filter((group) => group.sampleRows > 0 && group.count > group.sampleRows)
    .sort((a, b) => (b.count - b.sampleRows) - (a.count - a.sampleRows))
    .slice(0, 8);

  const concentration = {
    market: rankedMarkets[0] || null,
    sector: rankedSectors[0] || null,
  };
  const hardIssues = [
    uncoveredMarkets.length,
    underrepresentedMarkets.length,
    concentration.market && rankedMarkets.length > 1 && concentration.market.sharePct >= auditCriteria.concentrationPct ? 1 : 0,
    strongThinGroups.length,
  ].reduce((sum, value) => sum + (value || 0), 0);
  const softIssues = emptyLists.length + thinLists.length + thinGroups.length + truncatedGroups.length;
  const state = !universeRows.length ? "empty" : hardIssues ? "warn" : softIssues ? "watch" : "pass";

  const audit = {
    state,
    label: state === "empty" ? "Sin auditoría" : state === "warn" ? "Revisar sesgo" : state === "watch" ? "Cobertura parcial" : "Cobertura OK",
    criteria: auditCriteria,
    scope: { type: scopeType || "global", value: scopeValue || "" },
    universeRows: universeRows.length,
    rankedRows: scopedRanked.length,
    rankingCoveragePct: pctValue(scopedRanked.length, universeRows.length),
    marketCount: universeMarkets.length,
    rankedMarketCount: rankedMarkets.length,
    sectorCount: universeSectors.length,
    rankedSectorCount: rankedSectors.length,
    topMarkets: rankedMarkets.slice(0, 5),
    topSectors: rankedSectors.slice(0, 5),
    universeMarkets: universeMarkets.slice(0, 5),
    universeSectors: universeSectors.slice(0, 5),
    concentration,
    coverageGaps: { uncoveredMarkets, underrepresentedMarkets },
    listHealth: { emptyLists, thinLists, lists: listSummaries },
    groupHealth: { thinGroups, strongThinGroups, truncatedGroups },
    summaryLine: `${scopedRanked.length}/${universeRows.length} rankeadas · ${topLabel(rankedMarkets, "sin mercado")} · ${emptyLists.length} listas vacias`,
  };

  return {
    ...audit,
    note: noteForAudit(audit),
  };
}

export function auditIssueLabels(audit = {}, limit = 4) {
  const labels = [
    ...(audit.coverageGaps?.uncoveredMarkets || []).map((item) => `${item.key} sin candidatos`),
    ...(audit.coverageGaps?.underrepresentedMarkets || []).map((item) => `${item.key} infra ${num(item.deltaPct)}pp`),
    ...(audit.groupHealth?.strongThinGroups || []).map((item) => `${item.key} muestra ${item.count}`),
    ...(audit.listHealth?.emptyLists || []).map((item) => `${item.title} vacía`),
  ];
  return labels.slice(0, limit);
}
