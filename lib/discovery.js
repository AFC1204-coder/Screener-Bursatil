import { buildGroupedLeaderboards, buildLeaderboard, LEADERBOARD_STRATEGIES } from "@/lib/leaderboards";
import { buildCoverageAudit } from "@/lib/discoveryAudit";
import { rowPassesListContract, rowReliabilityIssues } from "@/lib/listRationale";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";

const DEFAULT_LIMIT = 25;
const DEFAULT_GROUP_ITEM_LIMIT = 12;
const DEFAULT_GROUPS_LIMIT = 50;
const DEFAULT_MIN_GROUP_SIZE = 2;
const DEFAULT_MIN_COVERAGE = 40;
const DEFAULT_MAX_PRICE_FRESHNESS_DAYS = 5;

export const DISCOVERY_LIST_SPECS = [
  { key: "leaders", title: "Composite Leaders", strategy: "composite" },
  { key: "rsQuality", title: "RS Quality Leaders", strategy: "rsQuality" },
  { key: "weakness", title: "Deterioro técnico", strategy: "weakness" },
  { key: "weinstein", title: "Weinstein Leaders", strategy: "stage2" },
  { key: "minervini", title: "Minervini Leaders", strategy: "minervini" },
  { key: "nearPivot", title: "Vigilancia pivot", strategy: "nearPivot" },
  { key: "ipo", title: "IPO / New Leaders", strategy: "ipo" },
  { key: "extended", title: "Extended but strong", strategy: "extended" },
  { key: "pullback", title: "Pullback to SMA50", strategy: "pullback" },
];

const GROUP_DIMENSIONS = ["theme", "sector", "industry"];

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function intParam(value, fallback, min, max) {
  const n = finiteNumber(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function numberParam(value, fallback) {
  const n = finiteNumber(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(items = [], key = "") {
  const values = items.map((item) => finiteNumber(item?.[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function setupClaimState(row = {}) {
  const display = methodologyDisplayForRow(row);
  const blocks = display.blocksPatternClaim === true || display.dataLimited === true;
  return {
    planValid: !blocks && display.actionable === true && display.tradePlanEligible === true,
    watch: !blocks && display.watch === true,
  };
}

function normalizeScopeType(value = "") {
  const key = cleanText(value || "global");
  return ["global", "country", "sector", "industry", "theme"].includes(key) ? key : "global";
}

function scopeParams(params = {}) {
  const scopeType = normalizeScopeType(params.scopeType || params.groupType || params.scope);
  const scopeValue = cleanText(params.scopeValue || params.group || "");
  if (!scopeValue || scopeType === "global") return { scopeType: "global", scopeValue: "" };
  return { scopeType, scopeValue };
}

function dedupeDiscoveryRows(lists = []) {
  const bySymbol = new Map();
  for (const list of lists) {
    for (const item of list.items || []) {
      if (!item?.symbol) continue;
      const symbol = cleanText(item.symbol).toUpperCase();
      const previous = bySymbol.get(symbol);
      const next = {
        ...item,
        symbol,
        sourceListKeys: [...new Set([...(previous?.sourceListKeys || []), list.key])],
      };
      if (!previous) {
        bySymbol.set(symbol, next);
        continue;
      }
      const previousScore = finiteNumber(previous.totalScore ?? previous.score) ?? 0;
      const nextScore = finiteNumber(next.totalScore ?? next.score) ?? 0;
      bySymbol.set(symbol, nextScore >= previousScore ? { ...previous, ...next } : previous);
    }
  }
  return [...bySymbol.values()].sort((a, b) => (finiteNumber(b.totalScore ?? b.score) ?? 0) - (finiteNumber(a.totalScore ?? a.score) ?? 0));
}

function discoveryList(scanRows = [], spec = {}, baseParams = {}) {
  const strategy = LEADERBOARD_STRATEGIES[spec.strategy] ? spec.strategy : "momentum";
  const leaderboard = buildLeaderboard(scanRows, {
    ...baseParams,
    key: `discovery-${spec.key}`,
    title: spec.title,
    strategy,
  });
  return {
    key: spec.key,
    title: spec.title,
    strategy,
    strategyLabel: leaderboard.strategyLabel,
    description: leaderboard.criteria?.description || LEADERBOARD_STRATEGIES[strategy]?.description || "",
    count: leaderboard.count || 0,
    criteria: leaderboard.criteria,
    input: leaderboard.input,
    generatedAt: leaderboard.generatedAt,
    items: leaderboard.items || [],
  };
}

function groupFromLeaderboard(board = {}) {
  const items = board.items || [];
  const leaders = items.filter((item) => rowPassesListContract(item, "leaders")).length;
  const pivotWatch = items.filter((item) => rowPassesListContract(item, "nearPivot")).length;
  const extended = items.filter((item) => rowPassesListContract(item, "extended")).length;
  const weak = items.filter((item) => rowPassesListContract(item, "weakness")).length;
  return {
    key: board.scopeValue || cleanText(board.title || "").replace(/^[^-]+-\s*/, "") || "Sin dato",
    count: board.input?.eligible ?? board.count ?? items.length,
    strength: Math.round(finiteNumber(items[0]?.score) ?? avg(items, "score") ?? 0),
    avgTotal: avg(items, "totalScore"),
    avgRs: avg(items, "rsGlobalPct"),
    avgWeakness: avg(items, "weaknessScore"),
    avg3m: avg(items, "perf3m"),
    avg6m: avg(items, "perf6m"),
    leaders,
    nearPivot: pivotWatch,
    pivotWatch,
    extended,
    weak,
    top: items.slice(0, 5),
    items,
    contractScopeRows: board.contractScopeRows ?? board.input?.eligible ?? items.length,
    contractDrilldown: board.contractDrilldown || [],
    source: "discovery-api",
  };
}

function discoveryGroups(scanRows = [], dimension = "theme", options = {}) {
  const boards = buildGroupedLeaderboards(scanRows, {
    groupBy: dimension,
    strategy: "composite",
    limit: options.groupItemLimit,
    groupsLimit: options.groupsLimit,
    minGroupSize: options.minGroupSize,
    minCoverageScore: options.minCoverageScore,
    maxPriceFreshnessDays: options.maxPriceFreshnessDays,
  });
  return boards.map(groupFromLeaderboard);
}

function discoveryHealth(rows = [], lists = [], groups = {}, criteria = {}) {
  const rowIssueKeys = rows.map((row) => new Set(rowReliabilityIssues(row, criteria).map((issue) => issue.key)));
  const setupClaims = rows.map((row) => setupClaimState(row));
  const staleRows = rowIssueKeys.filter((keys) => keys.has("stale")).length;
  const lowCoverageRows = rowIssueKeys.filter((keys) => keys.has("coverage")).length;
  const dataLimitedRows = rowIssueKeys.filter((keys) => keys.has("dataLimited")).length;
  const planClaims = setupClaims.filter((claim) => claim.planValid).length;
  const watchRows = setupClaims.filter((claim) => claim.watch).length;
  const missingTaxonomyRows = rowIssueKeys.filter((keys) => keys.has("taxonomy")).length;
  const groupCount = GROUP_DIMENSIONS.reduce((sum, key) => sum + (groups[key]?.length || 0), 0);
  const listItemCount = lists.reduce((sum, list) => sum + (list.items?.length || 0), 0);
  const hardIssues = staleRows + lowCoverageRows + missingTaxonomyRows;
  const state = !rows.length ? "empty" : hardIssues ? "warn" : dataLimitedRows ? "watch" : "pass";
  const issueNotes = [
    staleRows ? `${staleRows} precio sin validar/viejo` : "",
    lowCoverageRows ? `${lowCoverageRows} cobertura baja/sin validar` : "",
    missingTaxonomyRows ? `${missingTaxonomyRows} taxonomía incompleta` : "",
    dataLimitedRows && !hardIssues ? `${dataLimitedRows} setups con datos técnicos limitados` : "",
  ].filter(Boolean);

  return {
    state,
    rows: rows.length,
    listItemCount,
    groupCount,
    staleRows,
    lowCoverageRows,
    dataLimitedRows,
    missingTaxonomyRows,
    planClaims,
    watchRows,
    sourceLabel: "Scan results derivados",
    note: rows.length
      ? issueNotes.length
        ? `Revisar ${issueNotes.join(", ")} antes de confiar en discovery.`
        : `Listas con frescura <= ${criteria.maxPriceFreshnessDays}d y cobertura minima ${criteria.minCoverageScore}.`
      : "Sin filas derivadas suficientes; la UI debe declarar fallback local si existe.",
  };
}

export function buildDiscoverySnapshot(scanRows = [], params = {}) {
  const limit = intParam(params.limit, DEFAULT_LIMIT, 1, 50);
  const groupItemLimit = intParam(params.groupItemLimit, DEFAULT_GROUP_ITEM_LIMIT, 1, 30);
  const groupsLimit = intParam(params.groupsLimit, DEFAULT_GROUPS_LIMIT, 1, 100);
  const minGroupSize = intParam(params.minGroupSize, DEFAULT_MIN_GROUP_SIZE, 1, 50);
  const minCoverageScore = numberParam(params.minCoverageScore, DEFAULT_MIN_COVERAGE);
  const maxPriceFreshnessDays = numberParam(params.maxPriceFreshnessDays, DEFAULT_MAX_PRICE_FRESHNESS_DAYS);
  const scope = scopeParams(params);
  const baseParams = {
    limit,
    minCoverageScore,
    maxPriceFreshnessDays,
    ...(scope.scopeType !== "global" ? scope : {}),
  };
  const lists = DISCOVERY_LIST_SPECS.map((spec) => discoveryList(scanRows, spec, baseParams));
  const rows = dedupeDiscoveryRows(lists);
  const groupOptions = { groupItemLimit, groupsLimit, minGroupSize, minCoverageScore, maxPriceFreshnessDays };
  const groups = Object.fromEntries(GROUP_DIMENSIONS.map((dimension) => [dimension, discoveryGroups(scanRows, dimension, groupOptions)]));
  const criteria = {
    derivedOnly: true,
    limit,
    groupItemLimit,
    groupsLimit,
    minGroupSize,
    minCoverageScore,
    maxPriceFreshnessDays,
    scopeType: scope.scopeType,
    scopeValue: scope.scopeValue,
  };
  const audit = buildCoverageAudit({
    inputRows: scanRows,
    rankedRows: rows,
    lists,
    groups,
    scopeType: scope.scopeType,
    scopeValue: scope.scopeValue,
  });

  return {
    legalMode: "derived-signals-only",
    source: "scan_results",
    generatedAt: new Date().toISOString(),
    inputRows: scanRows.length,
    criteria,
    lists,
    rows,
    groups,
    audit,
    health: discoveryHealth(rows, lists, groups, criteria),
  };
}
