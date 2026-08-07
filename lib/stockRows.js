import { businessThemeKey } from "@/lib/businessTheme";
import { compactMethodologySnapshot } from "@/lib/methodologyEngine";
import { scoreWeakness } from "@/lib/scoringEngine";
import { countryCode } from "@/lib/symbols";
import { dailyLeaderTrendIssue, dailyLongBiasIssue } from "@/lib/trendStructure";

const FAVORITE_SNAPSHOT_FIELDS = [
  "totalScore",
  "compositeScore",
  "compositeLabel",
  "objectiveScore",
  "objectiveLabel",
  "objectiveSetupScore",
  "patternScore",
  "patternContributionScore",
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
  "lastDate",
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
  "setupVerdictKey",
  "setupVerdictState",
  "setupVerdictLabel",
  "setupVerdictShortLabel",
  "setupVerdictReason",
  "setupVerdictEvidence",
  "setupVerdictTone",
  "setupDataConfidenceKey",
  "setupDataConfidenceLabel",
  "setupPlanValid",
  "setupActionable",
  "setupObservable",
  "setupWatch",
  "setupStrict",
  "setupDisplayKey",
  "setupDisplayState",
  "setupDisplayLabel",
  "setupDisplayShortLabel",
  "setupDisplayReason",
  "setupDisplayEvidence",
  "setupDisplayLine",
  "setupDisplayTone",
  "setupDisplayDataLimited",
  "setupDisplayBlocksPatternClaim",
  "setupDisplayPlanValid",
  "setupDisplayActionable",
  "setupDisplayObservable",
  "setupDisplayWatch",
  "setupDisplayStrict",
  "setupDisplayTradePlanEligible",
  "setupDisplayConfidenceKey",
  "setupDisplayConfidenceLabel",
  "patternDataStatus",
  "patternEligible",
  "patternIssues",
  "patternFamily",
  "patternMaturity",
  "patternQualityScore",
  "vcpCandidate",
  "breakoutAttempt",
  "pivotSqueeze",
  "failedBreakout",
  "consolidationCandidate",
  "baseContextStatus",
  "baseDepthPct",
  "baseWeeks",
  "distanceToPivotPct",
  "volumeDryUpRatio",
  "contractionDepths",
  "contractionCount",
  "contractionsDecreasing",
  "theme",
  "businessEs",
  // ── Cobertura y contradicciones de señales (Tasks 11-17 de scoring) ──
  // signalCoverage: objeto { [signalKey]: { coverage, partial } } poblado por
  // los 3 pipelines (materializedScanner, researchRow, screenerPipeline) y
  // finalizado junto a los percentiles RS. Se copia verbatim — puede
  // recomputarse en el futuro si se añade un botón "recalcular señales por
  // símbolo" (fuera de scope). Por ahora, snapshot congelado al guardar.
  "signalCoverage",
  // signalContradictions/contradictionsSkipped: arrays producidos por
  // evaluateContradictions (reglas C1-C6) en la finalización server-side.
  // Se copian verbatim y se etiquetan como "detectadas al momento de guardar"
  // (congeladas con fecha vía capturedAt). NO se recomputan en el snapshot.
  // contradictionsSkipped se incluye por consistencia: si una regla se omitió
  // por partial, el snapshot debe poder mostrarlo también.
  "signalContradictions",
  "contradictionsSkipped",
  // percentileScope: "batch" o "final" — heredado del row. Indica si los
  // percentiles RS del snapshot son el valor final (recalculado sobre el
  // universo completo del scan) o un valor parcial de batch. Informativo.
  "percentileScope",
  // universeSize NO se captura aquí: no existe como campo del row hoy. El
  // equivalente semántico más cercano es rsGlobalSample (tamaño del universo
  // global usado para el percentil RS), que ya está en la lista (línea 65).
  // Si en el futuro se añade universeSize al row, añadirlo aquí.
];

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanObject(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value))));
}

function textValue(value, fallback = "") {
  if (typeof value === "string") return value || fallback;
  if (value && typeof value === "object") return value.label || value.key || value.name || fallback;
  return value == null ? fallback : String(value);
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
  const sector = rowSector(row);
  const industry = rowIndustry(row);
  const hasBusinessTaxonomy = (sector && sector !== "Sin sector") || (industry && industry !== "Sin industria");
  if (hasBusinessTaxonomy) {
    return businessThemeKey(
      sector,
      industry,
      row.businessSummary || row.summary || row.businessEs || row.snapshot?.businessSummary || row.snapshot?.summary || row.snapshot?.businessEs || "",
    );
  }
  return textValue(row.theme, textValue(row.snapshot?.theme, "Sin tematica"));
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
  return finiteOrNull(snapshotValue(row, "totalScore")) ?? finiteOrNull(snapshotValue(row, "compositeScore"));
}

export function rowRsUniverse(row = {}) {
  return finiteOrNull(snapshotValue(row, "rsGlobalPct"));
}

export function rowRsBenchmark(row = {}) {
  return finiteOrNull(snapshotValue(row, "rsRating"));
}

export function rowRsPrimary(row = {}) {
  return rowRsUniverse(row) ?? rowRsBenchmark(row) ?? null;
}

export function rowRsGlobal(row = {}) {
  return rowRsUniverse(row);
}

// Campos leídos por lib/scoringEngine.js:scoreWeakness (la canónica). Se
// resuelven vía snapshotValue porque `row` puede ser una fila de scan en vivo
// (campos directos) o una fila reconstruida desde un favorito (campos bajo
// row.snapshot). `upVolume` es booleano y se preserva tal cual: scoreWeakness
// lo compara con `=== true`/`=== false`, no con Number.isFinite.
const WEAKNESS_NUMERIC_INPUT_FIELDS = [
  "rsGlobalPct",
  "rsRating",
  "rsCountryPct",
  "rsSectorPct",
  "price",
  "sma50",
  "sma200",
  "sma200Slope",
  "perf3m",
  "perf6m",
  "perf12m",
  "distance52w",
  "distance20d",
  "maxDrawdown63d",
  "upDownVolRatio",
  "relativeVolume",
  "riskScore",
  "extSma50",
  "speculationRiskScore",
];

function weaknessScoreInput(row) {
  const input = Object.fromEntries(WEAKNESS_NUMERIC_INPUT_FIELDS.map((key) => [key, finiteOrNull(snapshotValue(row, key))]));
  const upVolume = snapshotValue(row, "upVolume");
  input.upVolume = upVolume === true || upVolume === false ? upVolume : null;
  return input;
}

export function weaknessScore(row = {}) {
  const direct = finiteOrNull(snapshotValue(row, "weaknessScore"));
  if (Number.isFinite(direct)) return direct;

  return scoreWeakness(weaknessScoreInput(row)).weaknessScore;
}

export function longOpportunityIssue(row = {}, { requireTrendTemplate = false } = {}) {
  const longBiasIssue = dailyLongBiasIssue(row);
  if (longBiasIssue) return longBiasIssue;

  const weak = weaknessScore(row);
  if (Number.isFinite(weak) && weak >= 60) return `Deterioro técnico ${weak.toFixed(0)} >= 60`;

  const perf3m = finiteOrNull(snapshotValue(row, "perf3m"));
  if (Number.isFinite(perf3m) && perf3m < -12) return `3M bajista ${perf3m.toFixed(1)}%`;

  const distance52w = finiteOrNull(snapshotValue(row, "distance52w"));
  if (Number.isFinite(distance52w) && distance52w < -45) return `demasiado lejos de 52w ${distance52w.toFixed(1)}%`;

  if (requireTrendTemplate) {
    const trendIssue = dailyLeaderTrendIssue(row);
    if (trendIssue) return trendIssue;
  }

  return "";
}

export function isLongOpportunityRow(row = {}, options = {}) {
  return !longOpportunityIssue(row, options);
}

export function metricValue(row = {}, key) {
  if (key === "weaknessScore") return weaknessScore(row);
  if (key === "objectiveScore") return finiteOrNull(snapshotValue(row, "objectiveScore")) ?? rowComposite(row);
  if (key === "totalScore" || key === "compositeScore") return rowComposite(row);
  if (key === "rsGlobalPct") return rowRsUniverse(row);
  if (key === "rsRating") return rowRsBenchmark(row);
  return finiteOrNull(snapshotValue(row, key));
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
  const stored = finiteOrNull(snapshotValue(row, "ipoAgeMonths"));
  const months = Number.isFinite(stored) ? stored : monthsSince(row.ipoDate || row.snapshot?.ipoDate);
  return Number.isFinite(months) && months >= 0 && months <= maxMonths;
}

export function favoriteSnapshotFromRow(row = {}, options = {}) {
  const methodologySnapshot = compactMethodologySnapshot(row);
  const metrics = Object.fromEntries(FAVORITE_SNAPSHOT_FIELDS.map((key) => [key, snapshotValue(row, key)]));
  // Metadatos de procedencia: no vienen del row, se construyen al capturar.
  //   - capturedAt: timestamp ISO de creación del snapshot. Etiqueta todas las
  //     señales/contradicciones como "detectadas al momento de guardar". Si el
  //     caller pasa un capturedAt explícito (p.ej. para replay determinista en
  //     tests), se respeta; si no, now().
  //   - scanLocalId: id del scan que originó el favorito, si está disponible
  //     vía options.scan (los callers pasan scan: selectedScan). No está en el
  //     row individual — es metadata del scan completo. Si no hay scan, se
  //     omite (cleanObject filtra undefined).
  const scanLocalId = options.scan?.id || options.scan?.local_id || options.scanLocalId || null;
  return cleanObject({
    ...methodologySnapshot,
    ...metrics,
    theme: rowTheme(row),
    stageState: methodologySnapshot.stageState,
    stageLabel: methodologySnapshot.stageLabel,
    riskState: methodologySnapshot.riskState,
    dataQualityState: methodologySnapshot.dataQualityState,
    capturedAt: options.capturedAt || new Date().toISOString(),
    scanLocalId,
  });
}

export function createFavoriteFromRow(row = {}, options = {}) {
  const marketHealth = options.marketHealth || null;
  const market = options.market || null;
  const scan = options.scan || null;
  const price = finiteOrNull(snapshotValue(row, "price"));
  const marketScore = options.marketScore ?? scan?.marketScore ?? market?.marketScore ?? marketHealth?.marketScore ?? null;
  const marketRegime = options.marketRegime ?? scan?.marketRegime ?? market?.regime?.label ?? marketHealth?.regime?.label ?? "sin dato";
  const now = new Date().toISOString();
  const addedAt = options.addedAt || now;

  return cleanObject({
    id: options.id || uid(),
    symbol: row.symbol,
    companyName: rowCompanyName(row),
    country: rowCountry(row),
    sector: rowSector(row),
    industry: rowIndustry(row),
    addedAt,
    updatedAt: options.updatedAt || addedAt,
    entryPrice: Number.isFinite(price) ? price : null,
    lastPrice: Number.isFinite(price) ? price : null,
    lastDate: row.lastDate || row.snapshot?.lastDate || null,
    source: options.source || "screener",
    notes: options.notes || "",
    marketScore,
    marketRegime,
    // El snapshot ahora incluye signalCoverage/signalContradictions/
    // contradictionsSkipped/percentileScope (copiados del row via
    // FAVORITE_SNAPSHOT_FIELDS) + capturedAt/scanLocalId (construidos aquí).
    // Pasamos options para que favoriteSnapshotFromRow reciba scan/capturedAt.
    snapshot: favoriteSnapshotFromRow(row, options),
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
