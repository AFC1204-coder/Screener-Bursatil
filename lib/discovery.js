import { buildGroupedLeaderboards, buildLeaderboard, LEADERBOARD_STRATEGIES, rowFromScanResult } from "@/lib/leaderboards";
import { buildDataAgeNotice } from "@/lib/dataAge";
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
  { key: "leaders", title: "Score compuesto", strategy: "composite" },
  { key: "rsQuality", title: "RS Quality Leaders", strategy: "rsQuality" },
  { key: "weakness", title: "Deterioro técnico", strategy: "weakness" },
  { key: "weinstein", title: "Tendencia establecida", strategy: "stage2" },
  { key: "minervini", title: "Rupturas con contracción", strategy: "minervini" },
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
      const previousScore = finiteNumber(previous.objectiveScore ?? previous.totalScore ?? previous.score) ?? 0;
      const nextScore = finiteNumber(next.objectiveScore ?? next.totalScore ?? next.score) ?? 0;
      bySymbol.set(symbol, nextScore >= previousScore ? { ...previous, ...next } : previous);
    }
  }
  return [...bySymbol.values()].sort((a, b) => (finiteNumber(b.objectiveScore ?? b.totalScore ?? b.score) ?? 0) - (finiteNumber(a.objectiveScore ?? a.totalScore ?? a.score) ?? 0));
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
    emptyReason: listEmptyReason(leaderboard, baseParams),
    strategyLabel: leaderboard.strategyLabel,
    description: leaderboard.criteria?.description || LEADERBOARD_STRATEGIES[strategy]?.description || "",
    count: leaderboard.count || 0,
    criteria: leaderboard.criteria,
    input: leaderboard.input,
    generatedAt: leaderboard.generatedAt,
    items: leaderboard.items || [],
  };
}

// Por qué una lista sale vacía, en una frase y con su causa: frescura, falta
// de datos o criterio. Una lista con filas devuelve null. Antes la pantalla
// solo decía «0 acciones» y no había forma de saber si era el mercado, el
// dato o el filtro (auditoría de producto 2026-11, D6).
export function listEmptyReason(leaderboard = {}, params = {}) {
  if ((leaderboard.count || 0) > 0) return null;
  const input = leaderboard.input || {};
  const read = Number(input.deduped ?? input.rowsRead) || 0;
  // Candidatas = filas que cumplen la estrategia antes de mirar la frescura.
  const eligible = Number(input.candidates ?? input.eligible) || 0;
  const fresh = Number(input.freshnessRejected) || 0;
  const missing = Number(input.missingDataRejected) || 0;
  const maxDays = finiteNumber(params.maxPriceFreshnessDays);
  const limit = Number.isFinite(maxDays) && maxDays < 999 ? `de más de ${maxDays} días` : "atrasado";
  const n = (value) => value.toLocaleString("es-ES");
  if (!read) return { key: "no-data", text: "Sin datos: el escaneo nocturno no trae filas para esta lista." };
  if (!eligible) return { key: "criteria", text: `Ninguno de los ${n(read)} valores analizados cumple el criterio de esta lista.` };
  if (fresh > 0 && fresh >= eligible) return { key: "freshness", text: `Las ${n(eligible)} candidatas tienen el precio ${limit}.` };
  if (missing > 0 && missing + fresh >= eligible) return { key: "no-data", text: `A las ${n(eligible)} candidatas les falta algún dato que exige el filtro (${n(missing)} sin dato${fresh ? `, ${n(fresh)} con precio ${limit}` : ""}).` };
  return { key: "criteria", text: `Ninguna de las ${n(eligible)} candidatas pasa el filtro de la lista${fresh ? ` (${n(fresh)} por precio ${limit})` : ""}.` };
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
    avgTotal: avg(items, "objectiveScore"),
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
    reliabilityMaxPriceFreshnessDays: options.reliabilityMaxPriceFreshnessDays,
  });
  return boards.map(groupFromLeaderboard);
}

function discoveryHealth(rows = [], lists = [], groups = {}, criteria = {}, { freshnessSuspended = false, dataAge = null } = {}) {
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

  const suspendedNote = freshnessSuspended && dataAge
    ? `${dataAge.label}: llevan ${dataAge.dataAgeMissedWeekdays} sesiones sin actualizarse. Mientras no lleguen precios nuevos, el filtro de frescura no recorta: las listas se calculan con los precios de esa fecha.`
    : "";
  const baseNote = rows.length
    ? issueNotes.length
      ? `Revisar ${issueNotes.join(", ")} antes de confiar en discovery.`
      : `Listas con frescura <= ${criteria.maxPriceFreshnessDays}d y cobertura mínima ${criteria.minCoverageScore}.`
    : "Sin filas derivadas suficientes; la UI debe declarar fallback local si existe.";
  return {
    state,
    freshnessSuspended: Boolean(freshnessSuspended),
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
    note: suspendedNote ? `${suspendedNote} ${baseNote}` : baseNote,
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
  // Una sola lectura de cada fila (con la fecha corregida, lib/scanPriceDateRepair.js)
  // para las 9 listas y las 3 dimensiones de grupos; mismo envoltorio
  // { raw, created_at } que ya usa buildGroupedLeaderboards.
  const readRows = scanRows.map(rowFromScanResult);
  const leaderboardInput = readRows.map((row) => ({ raw: row, created_at: row.sourceScanCreatedAt }));
  // Opción B, la MISMA regla que el screener (lib/dataAge.js →
  // datasetPriceIsStale, lib/screenerPipeline.js): si TODO el nocturno va
  // atrasado (mediana de lastDate a ≥2 sesiones), el filtro de frescura no
  // recorta; si el conjunto es mixto, sí. La fiabilidad de cada fila sigue
  // diciendo «precio viejo».
  const freshnessActive = Number.isFinite(maxPriceFreshnessDays) && maxPriceFreshnessDays < 999;
  const dataAge = buildDataAgeNotice(readRows, params.now || new Date());
  const freshnessSuspended = freshnessActive && dataAge !== null;
  const effectiveMaxPriceFreshnessDays = freshnessSuspended ? 999 : maxPriceFreshnessDays;
  const baseParams = {
    limit,
    minCoverageScore,
    maxPriceFreshnessDays: effectiveMaxPriceFreshnessDays,
    reliabilityMaxPriceFreshnessDays: maxPriceFreshnessDays,
    ...(scope.scopeType !== "global" ? scope : {}),
  };
  const lists = DISCOVERY_LIST_SPECS.map((spec) => discoveryList(leaderboardInput, spec, baseParams));
  const rows = dedupeDiscoveryRows(lists);
  const groupOptions = { groupItemLimit, groupsLimit, minGroupSize, minCoverageScore, maxPriceFreshnessDays: effectiveMaxPriceFreshnessDays, reliabilityMaxPriceFreshnessDays: maxPriceFreshnessDays };
  const groups = Object.fromEntries(GROUP_DIMENSIONS.map((dimension) => [dimension, discoveryGroups(leaderboardInput, dimension, groupOptions)]));
  const criteria = {
    derivedOnly: true,
    limit,
    groupItemLimit,
    groupsLimit,
    minGroupSize,
    minCoverageScore,
    maxPriceFreshnessDays,
    effectiveMaxPriceFreshnessDays,
    freshnessSuspended,
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
    freshnessSuspended,
    dataAge: dataAge ? { lastDate: dataAge.dataAgeLastDate, missedWeekdays: dataAge.dataAgeMissedWeekdays, label: dataAge.label, detail: dataAge.detail } : null,
    criteria,
    lists,
    rows,
    groups,
    audit,
    health: discoveryHealth(rows, lists, groups, criteria, { freshnessSuspended, dataAge }),
  };
}

// De cuándo son los DATOS, no de cuándo se calculó la respuesta. generatedAt
// contesta lo segundo y era lo único que viajaba, así que las pantallas no
// tenían con qué contestar lo primero.
// Se toma el cierre MÁS ANTIGUO de las filas publicadas: es el que acota lo
// que se puede afirmar. Con la fuente anclada al nocturno todas comparten
// fecha y da igual, pero si alguna vez vuelven a mezclarse, esto lo enseña en
// vez de esconderlo tras la más reciente.
export function dataAsOfFrom(snapshot = {}) {
  const fechas = new Set();
  for (const list of snapshot.lists || []) {
    for (const item of list.items || []) if (item?.lastDate) fechas.add(String(item.lastDate));
  }
  for (const item of snapshot.rows || []) if (item?.lastDate) fechas.add(String(item.lastDate));
  if (!fechas.size) return null;
  const ordenadas = [...fechas].sort();
  return { date: ordenadas[0], latest: ordenadas.at(-1), mixed: ordenadas.length > 1, dates: ordenadas };
}

// El RS es semanal y su corte NO coincide con el de las barras: hoy son el 9
// y el 12 de agosto. Enseñar una sola fecha para los dos sería mentir sobre
// uno de ellos, así que viaja aparte y la franja lo dice por separado.
export function rsAsOfFrom(snapshot = {}) {
  let asOf = "";
  let sampleSize = null;
  for (const list of snapshot.lists || []) {
    for (const item of list.items || []) {
      if (!item?.weeklyRsAvailable || !item.weeklyRsAsOf) continue;
      const fecha = String(item.weeklyRsAsOf);
      if (fecha > asOf) { asOf = fecha; sampleSize = item.weeklyRsSampleSize ?? null; }
    }
  }
  return asOf ? { date: asOf, sampleSize } : null;
}
