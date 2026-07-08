// lib/screenerPipeline.js — pipeline de filtrado/diagnóstico del scan y helpers de
// universo/sesión, extraído verbatim de app/page.jsx.
import { normalizeCachedScreenerRow } from "@/lib/cachedScreenerRows";
import { chartRangeBars } from "@/lib/chartSettings";
import { decisionPriorityScore } from "@/lib/decisionAudit";
import { avg, clamp, firstFinite } from "@/lib/indicators";
import { safeRead, STORAGE_KEYS } from "@/lib/localState";
import { metricShortLabel } from "@/lib/metricCatalog";
import { addScoredObjectiveMetricAudit } from "@/lib/objectiveMetricTruth";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { compactChartPreview as contractCompactChartPreview, compactResearchRow, compactResearchRows } from "@/lib/researchRowContract";
import { enrichRelativePercentiles, rsBenchmarkValue, rsUniverseValue, scoreRsQuality } from "@/lib/relativeStrength";
import { compositeLabel, compositeNarrative, computeSignal, gt, lt, REJECTION_META, regimeRejectReason, rejectReason, scoreAdProxy, scoreCompositeValue, scoreDemandQuality, scoreEpsGrowthProxy, scoreGrowthQuality, scoreIpo, scoreObjectiveSetupQuality, scorePatternContribution, scorePatternQuality, scoreSetupQuality, scoreWeakness } from "@/lib/scoring";
import { SCREENER_FILTER_QUERY_KEYS, SETUP_MODES } from "@/lib/screenerFilterCatalog";
import { screenerFilterRejectReason as sharedScreenerFilterRejectReason } from "@/lib/screenerFilters";
import { USER_TEMPLATE_LIMIT } from "@/lib/screenerConfig";
import { countryCode } from "@/lib/symbols";

function manualUniverseRows(value = "") {
  return String(value || "")
    .split(/[\n,;\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
    .map((symbol) => ({ symbol, name: symbol, country: countryCode(symbol), source: "manual" }));
}
function universeScopeKey(marketsValue = [], manualValue = "") {
  const marketPart = (Array.isArray(marketsValue) ? marketsValue : []).filter(Boolean).join(",");
  const manualPart = manualUniverseRows(manualValue).map((x) => x.symbol).join(",");
  return `${marketPart}::${manualPart}`;
}

// scanSettingsSignature: hash estable y determinista de las TRES variables que
// determinan el universo real de símbolos escaneado (markets, manual, scanMode).
// De ellas deriva universeScopeKey(markets, manual); scanMode controla el alcance
// (todo el universo vs. lote vs. aleatorio) — un cambio en cualquiera de las
// tres hace que el scan mostrado quede desactualizado respecto al nuevo universo.
//
// Lo que NO entra aquí (por diseño verificado): activeSettings, filterLayers,
// fieldRules, useRegimeFilter, marketHealth — son post-filtrado en cliente sobre
// analyzedRows ya en memoria (vía filterAnalyzedRows) y nunca producen staleness.
//
// Orden-independiente: markets y los símbolos manuales se ordenan antes de hashear,
// de modo que el mismo conjunto en distinto orden devuelva el mismo hash.
function scanSettingsSignature(marketsValue = [], manualValue = "", scanModeValue = "all") {
  const marketsPart = (Array.isArray(marketsValue) ? marketsValue : [])
    .filter(Boolean)
    .map((code) => String(code || "").toUpperCase())
    .sort()
    .join(",");
  const manualPart = manualUniverseRows(manualValue)
    .map((x) => x.symbol)
    .sort()
    .join(",");
  const modePart = String(scanModeValue || "all");
  return `v1|markets=${marketsPart}|manual=${manualPart}|mode=${modePart}`;
}
function cachedScreenerRow(item = {}) {
  return normalizeCachedScreenerRow(item);
}
function cachedScreenerQuery(settings = {}, selectedMarkets = []) {
  const params = new URLSearchParams({ strategy: "composite", limit: "50", maxRows: "120", sinceDays: "14" });
  for (const key of SCREENER_FILTER_QUERY_KEYS) {
    const value = settings[key];
    if (value === undefined || value === null || value === "") continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    params.set(key, String(value));
  }
  if (selectedMarkets.length === 1) params.set("country", selectedMarkets[0]);
  return params;
}
function sortMetric(row = {}, key, settings = {}) {
  if (key === "decisionPriority") return decisionPriorityScore(row, settings);
  if (key === "objectiveScore") return firstFinite(row.objectiveScore, row.totalScore, row.compositeScore) ?? 0;
  if (key === "rsGlobalPct") return rsUniverseValue(row) ?? 0;
  if (key === "rsRating") return rsBenchmarkValue(row) ?? 0;
  return firstFinite(row[key]) ?? 0;
}

function defaultSortForSettings(set = {}) {
  return set.setupMode === "weakness" ? "weaknessScore" : "objectiveScore";
}

function sortRowsForMode(list, set = {}, key = "") {
  const sortKey = key || defaultSortForSettings(set);
  return [...list].sort((a, b) => sortMetric(b, sortKey, set) - sortMetric(a, sortKey, set));
}
function perfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
function secondsLabel(ms) {
  if (!Number.isFinite(ms)) return "-";
  const seconds = ms / 1000;
  return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`;
}
function listCount(value) {
  if (Array.isArray(value)) return value.length;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function filterAnalyzedRows(analyzedRows = [], set = {}, context = {}) {
  const startedAt = perfNow();
  const qualityPassed = [];
  const qualityGateRejections = [];
  for (const row of analyzedRows) {
    const gate = qualityGateForResearchRow(row, set);
    if (!gate.passed) {
      qualityGateRejections.push({
        symbol: row.symbol,
        key: "qualityGate",
        label: "Quality Gate",
        stage: "Pre-scan",
        detail: gate.reasons.join(" · "),
        field: "qualityGate",
      });
    } else {
      qualityPassed.push({ ...row, qualityGate: gate });
    }
  }
  const sectorized = sectorize(qualityPassed);
  const hardFilterSplit = splitByFilter(sectorized, set);
  const ok = hardFilterSplit.passed;
  const regimeRejections = [];
  const afterRegime = [];
  for (const row of ok) {
    const reason = regimeRejectReason(row, context.marketHealth, context.useRegimeFilter, set);
    if (reason) regimeRejections.push({ symbol: row.symbol, ...reason });
    else afterRegime.push(row);
  }
  const postRejections = [];
  const postPassed = [];
  for (const row of afterRegime) {
    const reason = postFilterRejectReason(row, set);
    if (reason) postRejections.push({ symbol: row.symbol, ...reason });
    else postPassed.push(row);
  }
  const finalRows = sortRowsForMode(postPassed, set);
  const filterMs = perfNow() - startedAt;
  return {
    rows: finalRows,
    sectorized,
    filterMs,
    diagnostics: scanDiagnosticsSummary({
      symbols: context.symbolsCount ?? context.symbols ?? analyzedRows.length,
      base: context.baseCount ?? context.base ?? analyzedRows.length,
      filterRejections: [...qualityGateRejections, ...hardFilterSplit.rejections],
      providerErrors: context.providerErrors || [],
      regimeRejections,
      postRejections,
      passedBeforeContext: ok.length,
      finalRows,
    }),
  };
}
function fastFilterSignature(analyzedRows = [], set = {}, context = {}) {
  return JSON.stringify({
    id: context.id || "",
    analyzed: analyzedRows.length,
    useRegimeFilter: Boolean(context.useRegimeFilter),
    marketScore: context.marketHealth?.marketScore ?? null,
    settings: set,
  });
}
function ipoRadarUniverseRows() {
  return safeRead(STORAGE_KEYS.ipoRadar, [])
    .filter((item) => item?.includeInScreener && item?.symbol && item.status !== "passed")
    .map((item) => {
      const symbol = String(item.symbol || "").trim().toUpperCase();
      return { symbol, name: item.companyName || symbol, country: item.country || countryCode(symbol), source: "ipo-radar" };
    });
}
function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function normalizeFilterTemplates(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && item.id && item.name && item.config)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name).trim().slice(0, 48) || "Mi filtro",
      updatedAt: item.updatedAt || new Date().toISOString(),
      config: item.config,
    }))
    .slice(0, USER_TEMPLATE_LIMIT);
}
// Proyección compacta canónica: delega en el contrato de ResearchRow para que
// sessionStorage y /api/scans compartan exactamente la misma forma compacta.
function compactChartPreview(chartPreview = []) {
  return contractCompactChartPreview(chartPreview);
}
function compactRowForSession(row = null) {
  if (!row || typeof row !== "object") return row;
  return compactResearchRow(row);
}
function compactRowsForSession(rows = []) {
  return compactResearchRows(rows);
}
function failureKind(reason = "") {
  const text = String(reason).toLowerCase();
  if (text.includes("historico insuficiente")) return { key: "history", title: "Histórico insuficiente", fix: "Reducir requisito de histórico, ampliar proveedor de precios o excluir tickers muy recientes del screener técnico largo." };
  if (text.includes("http 404") || text.includes("no found") || text.includes("not found") || text.includes("sin historico")) return { key: "symbol", title: "Ticker sin histórico", fix: "Revisar sufijo Yahoo/mercado, ticker delisted o mapping TradingView/Yahoo." };
  if (text.includes("429") || text.includes("too many") || text.includes("rate")) return { key: "rate", title: "Rate limit proveedor", fix: "Añadir cache persistente/Supabase y espaciar llamadas por lotes." };
  if (text.includes("provider") || text.includes("proveedor") || text.includes("http")) return { key: "provider", title: "Proveedor no disponible", fix: "Reintentar, cachear respuesta o cubrir con proveedor secundario." };
  return { key: "other", title: "Otros datos incompletos", fix: "Revisar caso manual y normalizar símbolo/perfil." };
}

function chartPreviewForRange(bars = [], range = "1A") {
  return bars.slice(-Math.min(chartRangeBars(range), bars.length));
}

function stageLabel(r) {
  if (r?.weeklyStageLabel) return r.weeklyStageLabel.replace(/\s+probable$/i, "");
  if (!r || !Number.isFinite(r.price) || !Number.isFinite(r.sma200)) return "Sin dato";
  if (gt(r.price, r.sma50) && gt(r.sma50, r.sma150) && gt(r.sma150, r.sma200) && gt(r.sma200Slope, 0)) return "Stage 2";
  if (lt(r.price, r.sma200) && lt(r.sma200Slope, 0)) return "Stage 4";
  if (gt(r.price, r.sma200)) return "Base / transicion";
  return "Debil / mixta";
}


function setupModeLabel(value) {
  return SETUP_MODES.find(([key]) => key === value)?.[1] || "Exploratorio";
}




function sharedRejectKey(field = "") {
  if (["minPrice", "minMarketCap", "minAvgVolume", "minAvgTurnover", "minLiquidityScore"].includes(field)) return "liquidity";
  if (["maxPriceFreshnessDays", "minDataCoverageScore", "minTechnicalCoverageScore", "minFundamentalCoverageScore"].includes(field)) return "coverage";
  if (["minRsRating", "minRsBenchmarkRating", "minRsCountryPct", "minRsSectorPct", "minRsQualityScore", "minSectorScore"].includes(field)) return "relativeStrength";
  if (["minLatestVolume", "minLatestTurnover", "minRelativeVolume", "minVolumeSurgePct", "minUpDownVolRatio", "minVolumeEffectScore", "requireUpVolume", "minAdProxyScore"].includes(field)) return "volumeSurge";
  if (["minShortFloatPct", "maxShortFloatPct"].includes(field)) return "shortInterest";
  if (["minRiskRewardScore", "minReturnToVol3m", "minReturnToDrawdown3m"].includes(field)) return "riskReward";
  if (["maxDailyMove20dPct", "maxDailyRange20dPct", "maxRange63dPct", "maxVolatility63d", "maxDrawdown63d"].includes(field)) return "volatility";
  if (["patternDataStatus", "contractionStructureStatus", "requireContractionsDecreasing", "minContractionCount", "maxContraction1DepthPct", "maxContraction2DepthPct", "maxContraction3DepthPct", "maxLastContractionDepthPct", "maxBaseDepthPct", "minBaseWeeks", "maxBaseWeeks", "maxAbsDistanceToPivotPct", "maxVolumeDryUpRatio", "maxTightness10dPct", "minPatternQualityScore"].includes(field)) return "pattern";
  if (["requireStage2", "requireSma200Up", "requirePriceAboveSma50", "longBiasFloor", "minWeinsteinScore", "minMinerviniScore"].includes(field)) return "trend";
  if (["maxDistance20dHigh", "maxDistance50dHigh", "maxDistance52w", "maxDistanceATH", "maxHighsSpreadPct", "maxExtensionSma50", "minRiskScore"].includes(field)) return "proximity";
  if (["minPerf3m", "minPerf6m", "minPerf12m", "minMomentumScore"].includes(field)) return "momentum";
  if (["minVolumeScore", "minTotalScore", "minEpsGrowthProxyScore"].includes(field)) return "score";
  if (["requireRecentIpo", "maxIpoAgeMonths"].includes(field)) return "ipo";
  if (field === "minWeaknessScore") return "weakness";
  if (field === "setupMode") return "mode";
  return "post";
}

function filterRejectReason(row, set) {
  const reason = sharedScreenerFilterRejectReason(row, set);
  if (!reason) return null;
  const field = reason.field || reason.key || "";
  return rejectReason(sharedRejectKey(field), reason.reason || reason.detail || "No cumple filtro", field);
}

function splitByFilter(rows, set) {
  const passed = [];
  const rejections = [];
  rows.forEach((row) => {
    const reason = filterRejectReason(row, set);
    if (reason) rejections.push({ symbol: row.symbol, ...reason });
    else passed.push(row);
  });
  return { passed, rejections };
}

function postFilterRejectReason(row, set) {
  if (set.setupMode === "weakness") return (row.weaknessScore || 0) >= (set.minWeaknessScore || 0) ? null : rejectReason("weakness", `Deterioro ${(row.weaknessScore || 0).toFixed(0)} < ${set.minWeaknessScore || 0}`, "minWeaknessScore");
  if ((set.minRsCountryPct || 0) > 0 && (!Number.isFinite(row.rsCountryPct) || row.rsCountryPct < set.minRsCountryPct)) return rejectReason("relativeStrength", `RS Pais ${row.rsCountryPct?.toFixed?.(0) || "sin dato"} < ${set.minRsCountryPct || 0}`, "minRsCountryPct");
  if ((set.minRsSectorPct || 0) > 0 && (!Number.isFinite(row.rsSectorPct) || row.rsSectorPct < set.minRsSectorPct)) return rejectReason("relativeStrength", `${metricShortLabel("rsSectorPct")} ${row.rsSectorPct?.toFixed?.(0) || "sin dato"} < ${set.minRsSectorPct || 0}`, "minRsSectorPct");
  if ((set.minRsQualityScore || 0) > 0 && (!Number.isFinite(row.rsQualityScore) || row.rsQualityScore < set.minRsQualityScore)) return rejectReason("relativeStrength", `RS Quality ${row.rsQualityScore?.toFixed?.(0) || "sin dato"} < ${set.minRsQualityScore || 0}`, "minRsQualityScore");
  if ((set.minSectorScore || 0) > 0 && (!Number.isFinite(row.sectorScore) || row.sectorScore < set.minSectorScore)) return rejectReason("relativeStrength", `Fuerza grupo ${row.sectorScore?.toFixed?.(0) || "sin dato"} < ${set.minSectorScore || 0}`, "minSectorScore");
  const objectiveScore = firstFinite(row.objectiveScore, row.totalScore, row.compositeScore);
  if ((set.minTotalScore || 0) > 0 && (!Number.isFinite(objectiveScore) || objectiveScore < set.minTotalScore)) return rejectReason("score", `Score compuesto ${objectiveScore?.toFixed?.(0) || "sin dato"} < ${set.minTotalScore || 0}`, "minTotalScore");
  return null;
}

function summarizeRejections(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const key = item.key || "provider";
    const meta = REJECTION_META[key] || {};
    const bucket = map.get(key) || { key, label: item.label || meta.label || key, stage: item.stage || meta.stage || "Filtro", count: 0, examples: [] };
    bucket.count += 1;
    if (bucket.examples.length < 4) bucket.examples.push({ symbol: item.symbol, detail: item.detail || item.reason || "Sin detalle" });
    map.set(key, bucket);
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function scanDiagnosticsSummary({ symbols = [], base = [], filterRejections = [], providerErrors = [], regimeRejections = [], postRejections = [], passedBeforeContext = 0, finalRows = [] }) {
  const providerItems = providerErrors.map((x) => ({ key: "provider", label: "Datos proveedor", stage: "Datos", symbol: x.symbol, detail: x.reason || "Proveedor no disponible" }));
  const all = [...filterRejections, ...providerItems, ...regimeRejections, ...postRejections];
  return {
    analyzed: listCount(symbols),
    universeTotal: listCount(base),
    candidatesBeforeContext: passedBeforeContext,
    finalCount: finalRows.length,
    hardRejected: filterRejections.length,
    providerRejected: providerItems.length,
    regimeRejected: regimeRejections.length,
    postRejected: postRejections.length,
    blocks: summarizeRejections(all),
  };
}

function sectorize(list) {
  const groups = {};
  for (const r of list) (groups[r.theme] ??= []).push(r);
  const sectorScores = {};
  Object.entries(groups).forEach(([k, a]) => {
    const avg3 = avg(a.map((x) => x.perf3m || 0));
    const avg6 = avg(a.map((x) => x.perf6m || 0));
    const leaders = a.filter((x) => x.weinsteinScore >= 80 || x.minerviniScore >= 80).length;
    sectorScores[k] = clamp(clamp(a.length * 10, 0, 25) + clamp(avg3, 0, 20) + clamp(avg6 / 2, 0, 20) + clamp(leaders * 7, 0, 15) + (/Semis|fotonica|Defensa|Software|Energia|Automatizacion/.test(k) ? 20 : 10));
  });
  return enrichRelativePercentiles(list).map((r) => {
    const sectorScore = sectorScores[r.theme] || 40;
    // signalCoverage: extend sidecar from buildRow with composite-level signals.
    const baseSignalCoverage = r.signalCoverage || {};
    const _ip = computeSignal({ ...r, sectorScore }, "ipoScore");       const ipoScore = _ip.value; baseSignalCoverage.ipoScore = { coverage: _ip.coverage, partial: _ip.partial };
    const _os = computeSignal(r, "objectiveSetupScore");               const objectiveSetupScore = _os.value; baseSignalCoverage.objectiveSetupScore = { coverage: _os.coverage, partial: _os.partial };
    const _pc = computeSignal(r, "patternContributionScore");           const patternContributionScore = _pc.value; baseSignalCoverage.patternContributionScore = { coverage: _pc.coverage, partial: _pc.partial };
    const _ps = computeSignal(r, "patternScore");                       const patternScore = _ps.value; baseSignalCoverage.patternScore = { coverage: _ps.coverage, partial: _ps.partial };
    const _sq = computeSignal(r, "setupQualityScore");                  const setupQualityScore = _sq.value; baseSignalCoverage.setupQualityScore = { coverage: _sq.coverage, partial: _sq.partial };
    const _dq = computeSignal(r, "demandScore");                        const demandScore = _dq.value; baseSignalCoverage.demandScore = { coverage: _dq.coverage, partial: _dq.partial };
    const _gs = computeSignal(r, "growthScore");                        const growthScore = _gs.value; baseSignalCoverage.growthScore = { coverage: _gs.coverage, partial: _gs.partial };
    // adProxyScore/epsGrowthProxyScore: prefer pre-computed value from buildRow;
    // computeSignal still runs to populate coverage metadata (idempotent compute).
    const _ad = computeSignal(r, "adProxyScore");                       const adProxyScore = Number.isFinite(r.adProxyScore) ? r.adProxyScore : _ad.value; baseSignalCoverage.adProxyScore = { coverage: _ad.coverage, partial: _ad.partial };
    const _eg = computeSignal(r, "epsGrowthProxyScore");                 const epsGrowthProxyScore = Number.isFinite(r.epsGrowthProxyScore) ? r.epsGrowthProxyScore : _eg.value; baseSignalCoverage.epsGrowthProxyScore = { coverage: _eg.coverage, partial: _eg.partial };
    const riskRewardScore = Number.isFinite(r.riskRewardScore) ? r.riskRewardScore : 45;
    const rsAnchor = Number.isFinite(r.rsGlobalPct) ? r.rsGlobalPct : (r.rsRating || 50);
    const rsQuality = scoreRsQuality({ ...r, riskRewardScore });
    const rsQualityScore = Number.isFinite(rsQuality?.rsQualityScore) ? rsQuality.rsQualityScore : rsAnchor;
    const epsAnchor = Number.isFinite(epsGrowthProxyScore) ? epsGrowthProxyScore : growthScore;
    const legacyTotalScore = r.weinsteinScore * .15 + r.minerviniScore * .17 + rsAnchor * .15 + rsQualityScore * .04 + r.momentumScore * .1 + sectorScore * .1 + r.riskScore * .05 + riskRewardScore * .06 + r.volumeScore * .04 + adProxyScore * .05 + epsAnchor * .07 + r.liquidityScore * .04 + ipoScore * .02;
    const objectiveScore = scoreCompositeValue({ setupQualityScore: objectiveSetupScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: r.riskScore, momentumScore: r.momentumScore, ipoScore });
    const compositeScore = scoreCompositeValue({ setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: r.riskScore, momentumScore: r.momentumScore, ipoScore });
    const ratingModel = {
      version: "statsedge-transparent-v2",
      rs: "RS es el percentil del lote con muestra minima; RS Benchmark es fuerza secundaria frente a SPY/QQQ/ACWI.",
      adProxy: "Up/down volume, volumen relativo, volumen 5d y cierre con volumen.",
      epsGrowthProxy: "Crecimiento de beneficios/ventas, margenes, ROE/ROA y balance si el proveedor devuelve datos.",
      composite: "Composite legacy: setup + RS + demanda + crecimiento + grupo + rentabilidad/riesgo.",
      objective: "Ranking limpio: setup objetivo sin bonus de contracciones/VCP + RS + demanda + crecimiento + grupo + rentabilidad/riesgo.",
      pattern: "VCP/contracciones quedan como capa separada: no elevan objectiveScore.",
    };
    // weaknessScore coverage: scoreWeakness(scoredBase) ensambla los campos planos
    // abajo; computeSignal aporta coverage/partial al sidecar. Doble invocación
    // consistente con los guards condicionales existentes.
    const _wk = computeSignal(r, "weaknessScore");
    baseSignalCoverage.weaknessScore = { coverage: _wk.coverage, partial: _wk.partial };
    const scoredBase = addScoredObjectiveMetricAudit({ ...r, ...rsQuality, signalCoverage: baseSignalCoverage, sectorScore, groupStrengthScore: sectorScore, ipoScore, objectiveSetupScore, patternContributionScore, patternScore, setupQualityScore, demandScore, growthScore, adProxyScore, epsGrowthProxyScore, ratingModel, legacyTotalScore, objectiveScore, compositeScore, totalScore: compositeScore, compositeLabel: compositeLabel(compositeScore), objectiveLabel: compositeLabel(objectiveScore) });
    const scored = { ...scoredBase, ...scoreWeakness(scoredBase) };
    const story = compositeNarrative(scored);
    return { ...scored, compositeReasons: story.reasons, compositeRisks: story.risks };
  });
}
function shuffle(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
function spreadByInitial(list) {
  const groups = new Map();
  for (const item of list) {
    const symbol = item.symbol || item;
    const key = /^[A-Z]/.test(symbol?.[0]) ? symbol[0] : "#";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const buckets = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => items);
  const out = [];
  let index = 0;
  while (out.length < list.length) {
    let added = false;
    for (const bucket of buckets) {
      if (bucket[index]) {
        out.push(bucket[index]);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  return out;
}

export {
  manualUniverseRows,
  universeScopeKey,
  scanSettingsSignature,
  cachedScreenerRow,
  cachedScreenerQuery,
  sortMetric,
  defaultSortForSettings,
  sortRowsForMode,
  perfNow,
  secondsLabel,
  listCount,
  filterAnalyzedRows,
  fastFilterSignature,
  ipoRadarUniverseRows,
  uid,
  normalizeFilterTemplates,
  compactChartPreview,
  compactRowForSession,
  compactRowsForSession,
  failureKind,
  chartPreviewForRange,
  stageLabel,
  setupModeLabel,
  sharedRejectKey,
  filterRejectReason,
  splitByFilter,
  postFilterRejectReason,
  summarizeRejections,
  scanDiagnosticsSummary,
  sectorize,
  shuffle,
  spreadByInitial,
};
