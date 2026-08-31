import { disabledPayload, finiteOrNull, requirePersistenceAuth, supabaseConfig, supabaseRequest, supabaseRpc, textOrNull, toTimestamp } from "@/lib/supabaseServer";
import { compactResearchRow } from "@/lib/researchRowContract";
import { isPublicScanStatus } from "@/lib/scanStatus";
import { prepareScanDecisionRow, scanDecisionMetrics, scanDecisionRaw, scanDecisionRowFromDb } from "@/lib/scanDecisionProjection";
import { clearScansApiCache, LATEST_SCAN_TTL_MS, scansApiCache } from "@/lib/scansApiCache";
import { readLatestMaterializedScanForMarkets, sortedMarketsForLookup } from "@/lib/materializedScanLookup";
import { readNightlyUsScan } from "@/lib/nightlyUsScan";
import { MARKETS_ANCHOR, NIGHTLY_US_ANCHOR } from "@/lib/scanLocalId";
import { snapshotRowsAreFiltered } from "@/lib/snapshotRestore";
import { attachCachedMarketCap, readMarketCapForSymbols } from "@/lib/fundamentalsCache";
import { attachWeeklyRs, readGlobalRsForSymbols } from "@/lib/globalRs";
import { attachWeeklyCountryRs, readCountryRsForSymbols } from "@/lib/countryRsHydrate";
import { attachWeeklyThemeRs, readThemeRsForSymbols } from "@/lib/themeRsHydrate";
import { scanRsHydrationMode } from "@/lib/scansRsHydration";
import { userFacingServiceError } from "@/lib/serviceErrors";

const SCANS_SUPABASE_TIMEOUT_MS = 8000;

function themeHydrateRowBySymbol(results = []) {
  const rowBySymbol = new Map();
  for (const item of results || []) {
    const symbol = String(item?.symbol || item?.raw?.symbol || "").trim().toUpperCase();
    if (!symbol || rowBySymbol.has(symbol)) continue;
    const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
    const metrics = item?.metrics && typeof item.metrics === "object" ? item.metrics : {};
    rowBySymbol.set(symbol, {
      symbol,
      theme: raw.theme || metrics.theme || "",
      sector: raw.sector || metrics.sector || "",
      industry: raw.industry || metrics.industry || "",
      businessSummary: raw.businessSummary || metrics.businessSummary || "",
    });
  }
  return rowBySymbol;
}

// ── El techo de PostgREST y por qué hay que paginar ────────────────────────
// PostgREST nunca devuelve más de 1.000 filas por respuesta, diga lo que diga
// el `limit`. Medido contra producción el 2026-08-17: pidiendo `limit=3400`
// sobre el nocturno de 3.312 filas, la respuesta trae 1.000 y
// `content-range: 0-999/3312`. Es decir: subir `rowsLimit` sin paginar NO trae
// una fila más — el arranque se quedaba en 1.000 pasara lo que pasara.
//
// Coste medido de leer el nocturno entero con esta paginación (4 páginas,
// mismo select que usa la ruta): 29,4 MB y 4,4 s en serie; 2,2-2,7 s en
// paralelo. Cada página tarda 0,6-2,7 s, muy por debajo del timeout de 8 s de
// SCANS_SUPABASE_TIMEOUT_MS, que es por página, no por lectura completa.
const POSTGREST_MAX_ROWS = 1000;
const RESULT_PAGE_CONCURRENCY = 4;

// Techo de rowsLimit por debajo del cual la respuesta se cachea 2 minutos
// (cacheableLatest). Antes eran 5.000, dimensionado cuando el arranque pedía
// 500 filas; con el universo completo (3.312 filas hoy, tope de 6.000 filas
// pedidas por lib/cloudSyncClient.js) el arranque caía fuera de la caché justo
// cuando más falta hace, porque es la petición más cara de la app.
const CACHEABLE_ROWS_LIMIT = 8000;

function scanPayload(scan = {}, ownerId) {
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const progressStatus = textOrNull(scan.settings?.progress?.status);
  const settings = {
    ...(scan.settings || {}),
    activeSettings: scan.activeSettings || scan.settings?.activeSettings || null,
    filterLayers: scan.filterLayers || scan.settings?.filterLayers || null,
    // Viaja junto a filterLayers para que al restaurar se sepa bajo qué
    // contrato de capas se guardó (lib/screenerFilterLayers.js:restoreFilterLayers).
    // Sin ella, un snapshot anterior a la v2 rehidrataría capas apagadas.
    filterLayersVersion: scan.filterLayersVersion ?? scan.settings?.filterLayersVersion ?? null,
    fieldRules: scan.fieldRules || scan.settings?.fieldRules || null,
    viewLayers: scan.viewLayers || scan.settings?.viewLayers || null,
    useRegimeFilter: scan.useRegimeFilter ?? scan.settings?.useRegimeFilter ?? null,
    sort: scan.sort || scan.settings?.sort || null,
    rowsAreFilteredSnapshot: snapshotRowsAreFiltered(scan),
    snapshotCompatibilityKey: scan.snapshotCompatibilityKey || scan.settings?.snapshotCompatibilityKey || null,
    methodologySummary: scan.methodologySummary || scan.settings?.methodologySummary || null,
    comparison: scan.comparison || scan.settings?.comparison || null,
  };
  return {
    owner_id: ownerId,
    local_id: textOrNull(scan.id) || crypto.randomUUID(),
    name: textOrNull(scan.name) || `Scan ${new Date().toLocaleString()}`,
    preset: textOrNull(scan.preset),
    progress_status: progressStatus,
    degraded: progressStatus === "partial",
    publishable: isPublicScanStatus(progressStatus),
    settings,
    market_score: finiteOrNull(scan.marketScore),
    market_regime: textOrNull(scan.marketRegime),
    row_count: rows.length,
    created_at: toTimestamp(scan.createdAt),
    updated_at: toTimestamp(scan.updatedAt || scan.updated_at || scan.createdAt || scan.created_at),
  };
}

export function resultPayload(row = {}, scanId, ownerId, index, settingsOrExplanation = {}) {
  const preparedRow = prepareScanDecisionRow(row, settingsOrExplanation);
  return {
    owner_id: ownerId,
    scan_id: scanId,
    symbol: textOrNull(preparedRow.symbol) || "-",
    company_name: textOrNull(preparedRow.companyName || preparedRow.name || preparedRow.symbol),
    country: textOrNull(preparedRow.country),
    sector: textOrNull(preparedRow.sector),
    industry: textOrNull(preparedRow.industry),
    theme: textOrNull(preparedRow.theme),
    rank_index: index + 1,
    total_score: finiteOrNull(preparedRow.totalScore),
    weinstein_score: finiteOrNull(preparedRow.weinsteinScore),
    minervini_score: finiteOrNull(preparedRow.minerviniScore),
    risk_score: finiteOrNull(preparedRow.riskScore),
    rs_rating: finiteOrNull(preparedRow.rsGlobalPct ?? preparedRow.rsRating),
    metrics: {
      ...scanDecisionMetrics(preparedRow),
      rsGlobalPct: preparedRow.rsGlobalPct ?? null,
      rsRating: preparedRow.rsRating ?? null,
      rsCountryPct: preparedRow.rsCountryPct ?? null,
      rsSectorPct: preparedRow.rsSectorPct ?? null,
      rsQualityScore: preparedRow.rsQualityScore ?? null,
      rsStabilityScore: preparedRow.rsStabilityScore ?? null,
      speculationRiskScore: preparedRow.speculationRiskScore ?? null,
      rsQualityLabel: preparedRow.rsQualityLabel ?? null,
      rsGlobalSample: preparedRow.rsGlobalSample ?? null,
      rsCountrySample: preparedRow.rsCountrySample ?? null,
      rsSectorSample: preparedRow.rsSectorSample ?? null,
      rs3m: preparedRow.rs3m ?? null,
      rs6m: preparedRow.rs6m ?? null,
      rs12m: preparedRow.rs12m ?? null,
      benchmarkSymbol: preparedRow.benchmarkSymbol ?? null,
      benchmarkPerf3m: preparedRow.benchmarkPerf3m ?? null,
      benchmarkPerf6m: preparedRow.benchmarkPerf6m ?? null,
      benchmarkPerf12m: preparedRow.benchmarkPerf12m ?? null,
      rsBenchmarkSample: preparedRow.rsBenchmarkSample ?? null,
      rsBenchmarkAvailable: preparedRow.rsBenchmarkAvailable ?? null,
      rsBenchmarkIssue: preparedRow.rsBenchmarkIssue ?? null,
      perf3m: preparedRow.perf3m ?? null,
      perf6m: preparedRow.perf6m ?? null,
      perf12m: preparedRow.perf12m ?? null,
      distance20d: preparedRow.distance20d ?? null,
      distance50d: preparedRow.distance50d ?? null,
      distance52w: preparedRow.distance52w ?? null,
      extSma50: preparedRow.extSma50 ?? null,
      avgVolume: preparedRow.avgVolume ?? null,
      latestVolume: preparedRow.latestVolume ?? null,
      avgTurnover: preparedRow.avgTurnover ?? null,
      latestTurnover: preparedRow.latestTurnover ?? null,
      relativeVolume: preparedRow.relativeVolume ?? null,
      volumeSurgePct: preparedRow.volumeSurgePct ?? null,
      upDownVolRatio: preparedRow.upDownVolRatio ?? null,
      shortPercentOfFloat: preparedRow.shortPercentOfFloat ?? null,
      sharesPercentSharesOut: preparedRow.sharesPercentSharesOut ?? null,
      shortRatio: preparedRow.shortRatio ?? null,
      sharesShort: preparedRow.sharesShort ?? null,
      floatShares: preparedRow.floatShares ?? null,
      volumeScore: preparedRow.volumeScore ?? null,
      volumeEffectScore: preparedRow.volumeEffectScore ?? null,
      volumeEvidence: preparedRow.volumeEvidence ?? null,
      liquidityScore: preparedRow.liquidityScore ?? null,
      sectorScore: preparedRow.sectorScore ?? null,
      growthScore: preparedRow.growthScore ?? null,
      setupQualityScore: preparedRow.setupQualityScore ?? null,
      setupVerdictKey: preparedRow.setupVerdictKey ?? null,
      setupVerdictState: preparedRow.setupVerdictState ?? null,
      setupVerdictLabel: preparedRow.setupVerdictLabel ?? null,
      setupVerdictShortLabel: preparedRow.setupVerdictShortLabel ?? null,
      setupVerdictReason: preparedRow.setupVerdictReason ?? null,
      setupVerdictEvidence: preparedRow.setupVerdictEvidence ?? null,
      setupVerdictTone: preparedRow.setupVerdictTone ?? null,
      setupDataConfidenceKey: preparedRow.setupDataConfidenceKey ?? null,
      setupDataConfidenceLabel: preparedRow.setupDataConfidenceLabel ?? null,
      setupPlanValid: preparedRow.setupPlanValid ?? null,
      setupActionable: preparedRow.setupActionable ?? null,
      setupObservable: preparedRow.setupObservable ?? null,
      setupWatch: preparedRow.setupWatch ?? null,
      setupStrict: preparedRow.setupStrict ?? null,
      setupDisplayKey: preparedRow.setupDisplayKey ?? null,
      setupDisplayState: preparedRow.setupDisplayState ?? null,
      setupDisplayLabel: preparedRow.setupDisplayLabel ?? null,
      setupDisplayShortLabel: preparedRow.setupDisplayShortLabel ?? null,
      setupDisplayReason: preparedRow.setupDisplayReason ?? null,
      setupDisplayEvidence: preparedRow.setupDisplayEvidence ?? null,
      setupDisplayLine: preparedRow.setupDisplayLine ?? null,
      setupDisplayTone: preparedRow.setupDisplayTone ?? null,
      setupDisplayDataLimited: preparedRow.setupDisplayDataLimited ?? null,
      setupDisplayBlocksPatternClaim: preparedRow.setupDisplayBlocksPatternClaim ?? null,
      setupDisplayPlanValid: preparedRow.setupDisplayPlanValid ?? null,
      setupDisplayActionable: preparedRow.setupDisplayActionable ?? null,
      setupDisplayObservable: preparedRow.setupDisplayObservable ?? null,
      setupDisplayWatch: preparedRow.setupDisplayWatch ?? null,
      setupDisplayStrict: preparedRow.setupDisplayStrict ?? null,
      setupDisplayTradePlanEligible: preparedRow.setupDisplayTradePlanEligible ?? null,
      setupDisplayConfidenceKey: preparedRow.setupDisplayConfidenceKey ?? null,
      setupDisplayConfidenceLabel: preparedRow.setupDisplayConfidenceLabel ?? null,
      methodologyReliabilityState: preparedRow.methodologyReliabilityState ?? null,
      methodologyReliabilityLabel: preparedRow.methodologyReliabilityLabel ?? null,
      methodologyReliabilityReason: preparedRow.methodologyReliabilityReason ?? null,
      methodologyBlocksPatternClaim: preparedRow.methodologyBlocksPatternClaim ?? null,
      pivotPrice: preparedRow.pivotPrice ?? null,
      distanceToPivotPct: preparedRow.distanceToPivotPct ?? null,
      baseDepthPct: preparedRow.baseDepthPct ?? null,
      baseDays: preparedRow.baseDays ?? null,
      baseWeeks: preparedRow.baseWeeks ?? null,
      volumeDryUpRatio: preparedRow.volumeDryUpRatio ?? null,
      latestVolumeRatio: preparedRow.latestVolumeRatio ?? null,
      latestCloseLocationPct: preparedRow.latestCloseLocationPct ?? null,
      contractionDepths: preparedRow.contractionDepths ?? null,
      contractionCount: preparedRow.contractionCount ?? null,
      vcpCandidate: preparedRow.vcpCandidate ?? null,
      breakoutAttempt: preparedRow.breakoutAttempt ?? null,
      breakoutQualityScore: preparedRow.breakoutQualityScore ?? null,
      failedBreakout: preparedRow.failedBreakout ?? null,
      patternFamily: preparedRow.patternFamily ?? null,
      patternMaturity: preparedRow.patternMaturity ?? null,
      patternQualityScore: preparedRow.patternQualityScore ?? null,
      setupStructureKey: preparedRow.setupStructureKey ?? null,
      setupStructureLabel: preparedRow.setupStructureLabel ?? null,
      setupStructureReason: preparedRow.setupStructureReason ?? null,
      setupStructureEvidence: preparedRow.setupStructureEvidence ?? null,
      setupStructureTone: preparedRow.setupStructureTone ?? null,
      setupStructureStrict: preparedRow.setupStructureStrict ?? null,
      setupStructureDataLabel: preparedRow.setupStructureDataLabel ?? null,
      patternDataStatus: preparedRow.patternDataStatus ?? null,
      patternEligible: preparedRow.patternEligible ?? null,
      patternIssues: preparedRow.patternIssues ?? null,
      patternVolumeEligible: preparedRow.patternVolumeEligible ?? null,
      patternFreshnessDays: preparedRow.patternFreshnessDays ?? null,
      patternBarsCount: preparedRow.patternBarsCount ?? null,
      patternMinBars: preparedRow.patternMinBars ?? null,
      patternCoveragePct: preparedRow.patternCoveragePct ?? null,
      patternOhlcCoveragePct: preparedRow.patternOhlcCoveragePct ?? null,
      patternVolumeCoveragePct: preparedRow.patternVolumeCoveragePct ?? null,
      consolidationCandidate: preparedRow.consolidationCandidate ?? null,
      baseContextStatus: preparedRow.baseContextStatus ?? null,
      pivotSqueeze: preparedRow.pivotSqueeze ?? null,
      baseContextScore: preparedRow.baseContextScore ?? null,
      baseReturnPct: preparedRow.baseReturnPct ?? null,
      priorUptrendPct: preparedRow.priorUptrendPct ?? null,
      basePivotAgeBars: preparedRow.basePivotAgeBars ?? null,
      baseNearPivotDays: preparedRow.baseNearPivotDays ?? null,
      baseNewHighCount: preparedRow.baseNewHighCount ?? null,
      marginalHighBreaks: preparedRow.marginalHighBreaks ?? null,
      earlyBaseDepthPct: preparedRow.earlyBaseDepthPct ?? null,
      middleBaseDepthPct: preparedRow.middleBaseDepthPct ?? null,
      lateBaseDepthPct: preparedRow.lateBaseDepthPct ?? null,
      rangeCompressionRatio: preparedRow.rangeCompressionRatio ?? null,
      atr20Pct: preparedRow.atr20Pct ?? null,
      atr50Pct: preparedRow.atr50Pct ?? null,
      meaningfulContractionMinPct: preparedRow.meaningfulContractionMinPct ?? null,
      contractionsDecreasing: preparedRow.contractionsDecreasing ?? null,
      contraction1DepthPct: preparedRow.contraction1DepthPct ?? null,
      contraction2DepthPct: preparedRow.contraction2DepthPct ?? null,
      contraction3DepthPct: preparedRow.contraction3DepthPct ?? null,
      contraction4DepthPct: preparedRow.contraction4DepthPct ?? null,
      lastContractionDepthPct: preparedRow.lastContractionDepthPct ?? null,
      rejectedContractionDepthPct: preparedRow.rejectedContractionDepthPct ?? null,
      contractionReductionPct: preparedRow.contractionReductionPct ?? null,
      contractionStructureStatus: preparedRow.contractionStructureStatus ?? null,
      contractionStructureReason: preparedRow.contractionStructureReason ?? null,
      measuredContractionDepths: preparedRow.measuredContractionDepths ?? null,
      contractionSwings: preparedRow.contractionSwings ?? null,
      measuredContractionSwings: preparedRow.measuredContractionSwings ?? null,
      rejectedContractionSwing: preparedRow.rejectedContractionSwing ?? null,
      absDistanceToPivotPct: preparedRow.absDistanceToPivotPct ?? null,
      tightness5dPct: preparedRow.tightness5dPct ?? null,
      tightness10dPct: preparedRow.tightness10dPct ?? null,
      tightness20dPct: preparedRow.tightness20dPct ?? null,
      pivotClarityScore: preparedRow.pivotClarityScore ?? null,
      volumeDryUpScore: preparedRow.volumeDryUpScore ?? null,
      baseQualityScore: preparedRow.baseQualityScore ?? null,
      weeklyStageState: preparedRow.weeklyStageState ?? null,
      weeklyStageLabel: preparedRow.weeklyStageLabel ?? null,
      weeklyFastWeeks: preparedRow.weeklyFastWeeks ?? null,
      weeklySlowWeeks: preparedRow.weeklySlowWeeks ?? null,
      weeklyFastMa: preparedRow.weeklyFastMa ?? null,
      weeklySlowMa: preparedRow.weeklySlowMa ?? null,
      weeklySlowMaSlope: preparedRow.weeklySlowMaSlope ?? null,
      weeklyDistanceFastMa: preparedRow.weeklyDistanceFastMa ?? null,
      weeklyDistanceSlowMa: preparedRow.weeklyDistanceSlowMa ?? null,
      priceFreshnessDays: preparedRow.priceFreshnessDays ?? null,
      priceFreshnessLabel: preparedRow.priceFreshnessLabel ?? null,
      priceFreshnessOk: preparedRow.priceFreshnessOk ?? null,
      lastDate: preparedRow.lastDate ?? null,
    },
    // Misma poda de escritura que el runner del scan servidor: chartPreview
    // compacto y sin las copias duplicadas que ya viajan en metrics.
    raw: scanDecisionRaw(preparedRow),
  };
}

// ── Cómo se reparten las páginas cuando no caben todas ─────────────────────
// Si el escaneo tiene más filas que el tope pedido, el recorte NO puede ser
// "las primeras por rank_index": rank_index ordena por puntuación, así que
// quedarse con el principio deja fuera todos los valores débiles y cualquier
// filtro que los busque (etapa 4, RS bajo) devuelve vacío sin que el usuario
// sepa por qué. Eso es exactamente lo que hacía el arranque con rowsLimit=500
// sobre 3.313 filas: el usuario filtraba sobre la mejor sexta parte creyendo
// que filtraba sobre el universo.
//
// En su lugar, las páginas se reparten por todo el rango del ranking (muestreo
// sistemático): con 20.000 filas y tope de 6.000 se leen 6 páginas de 1.000
// espaciadas cada 3.333 puestos, así que la muestra cubre cabeza, medio y cola.
// Sigue siendo una muestra —y se dice, con su motivo, en el aviso de la
// pantalla (lib/snapshotFreshness.js)— pero no está sesgada hacia los mejores.
export function scanResultPageOffsets(rowsAvailable, rowsLimit) {
  const available = Math.max(Number(rowsAvailable) || 0, 0);
  const limit = Math.max(Number(rowsLimit) || 0, 0);
  if (!limit) return { offsets: [], sampled: false, step: 0 };
  const target = available > 0 ? Math.min(available, limit) : limit;
  const pageCount = Math.max(1, Math.ceil(target / POSTGREST_MAX_ROWS));
  const sampled = available > limit;
  const step = sampled ? Math.max(POSTGREST_MAX_ROWS, Math.floor(available / pageCount)) : POSTGREST_MAX_ROWS;
  return {
    offsets: Array.from({ length: pageCount }, (_, index) => index * step),
    sampled,
    step,
  };
}

function dedupeScanResultsBySymbol(results = [], { sourceScans = [] } = {}) {
  const ordered = sourceScans.length
    ? results.slice().sort((left, right) => {
      const orderFor = (item) => {
        const index = sourceScans.findIndex((scan) => scan.id === item.scan_id);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
      };
      const leftOrder = orderFor(left);
      const rightOrder = orderFor(right);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return (left.rank_index || 0) - (right.rank_index || 0);
    })
    : results;
  const seen = new Set();
  const deduped = [];
  for (const item of ordered) {
    const symbol = String(item?.symbol || "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    deduped.push(item);
  }
  return deduped;
}

async function readMergedMaterializedResults({
  ownerId,
  sourceScans = [],
  select,
  rowsLimit,
}) {
  const orderedScans = sourceScans.slice().sort((left, right) => (
    (left.created_at < right.created_at ? 1 : -1)
  ));
  const ids = orderedScans.map((scan) => scan.id).filter(Boolean).join(",");
  if (!ids) return { rows: [], sampled: false, step: 0 };
  const rowsAvailable = orderedScans.reduce((total, scan) => total + (Number(scan.row_count) || 0), 0);
  const page = await readScanResultPages({
    ownerId,
    scanIds: ids,
    select,
    rowsLimit: Math.max(rowsLimit, rowsAvailable),
    rowsAvailable,
  });
  return { ...page, rows: dedupeScanResultsBySymbol(page.rows, { sourceScans: orderedScans }) };
}

async function readScanRowHydration(scanSymbols = [], results = [], { hydrationMode = "core" } = {}) {
  const emptyRs = { configured: false, bySymbol: new Map() };
  const [weeklyRs, marketCaps] = await Promise.all([
    readGlobalRsForSymbols(scanSymbols).catch(() => emptyRs),
    readMarketCapForSymbols(scanSymbols).catch(() => emptyRs),
  ]);
  if (hydrationMode !== "extended") {
    return {
      weeklyRsBySymbol: weeklyRs.bySymbol,
      weeklyCountryRsBySymbol: null,
      weeklyThemeRsBySymbol: null,
      marketCapBySymbol: marketCaps.bySymbol,
      rsHydration: "core",
    };
  }
  const themeRows = themeHydrateRowBySymbol(results);
  const [weeklyCountryRs, weeklyThemeRs] = await Promise.all([
    readCountryRsForSymbols(scanSymbols).catch(() => emptyRs),
    readThemeRsForSymbols(scanSymbols, { rowBySymbol: themeRows }).catch(() => emptyRs),
  ]);
  return {
    weeklyRsBySymbol: weeklyRs.bySymbol,
    weeklyCountryRsBySymbol: weeklyCountryRs.bySymbol,
    weeklyThemeRsBySymbol: weeklyThemeRs.bySymbol,
    marketCapBySymbol: marketCaps.bySymbol,
    rsHydration: "extended",
  };
}

async function readScanResultPages({ ownerId, scanIds, select, rowsLimit, rowsAvailable }) {
  const { offsets, sampled, step } = scanResultPageOffsets(rowsAvailable, rowsLimit);
  const rows = [];
  for (let index = 0; index < offsets.length; index += RESULT_PAGE_CONCURRENCY) {
    const batch = offsets.slice(index, index + RESULT_PAGE_CONCURRENCY);
    const pages = await Promise.all(batch.map((offset) => supabaseRequest("scan_results", {
      query: `owner_id=eq.${encodeURIComponent(ownerId)}&scan_id=in.(${scanIds})&select=${select}&order=rank_index.asc&limit=${POSTGREST_MAX_ROWS}&offset=${offset}`,
      timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
    })));
    for (const page of pages) rows.push(...page);
    // Página corta = se acabaron las filas. Solo vale cuando las páginas van
    // seguidas; con muestreo repartido una página corta no dice nada del
    // resto del rango.
    if (!sampled && pages.some((page) => page.length < POSTGREST_MAX_ROWS)) break;
  }
  // Con muestreo NO se recorta al tope exacto: el sobrante es de menos de una
  // página y cortarlo volvería a tirar precisamente la cola del ranking.
  return { rows: sampled ? rows : rows.slice(0, rowsLimit), sampled, step };
}

// La hidratación del RS semanal vive en lib/globalRs.js (attachWeeklyRs) para
// que TODAS las rutas que producen filas la apliquen, no solo esta.
export function scanFromDb(row, results = [], options = {}) {
  const decisionSettings = row.settings?.activeSettings || row.settings || {};
  const weeklyRsBySymbol = options.weeklyRsBySymbol || null;
  const weeklyCountryRsBySymbol = options.weeklyCountryRsBySymbol || null;
  const weeklyThemeRsBySymbol = options.weeklyThemeRsBySymbol || null;
  const marketCapBySymbol = options.marketCapBySymbol || null;
  // decisionTrace se RECONSTRUYE fila a fila al servir (prepareScanDecisionRow
  // → decisionTraceForRow). Medido el 2026-08-17 sobre la respuesta real:
  // 6.682 B por fila, el 52,6% del peso de la respuesta del arranque — y es el
  // mismo campo que la proyección ligera del nocturno excluye a propósito y que
  // la proyección de persistencia del navegador tampoco guarda. Los consumidores
  // ya lo rehacen cuando falta (decisionTraceForRow, explanationFromTrace), así
  // que la proyección compacta —la que pide la pantalla principal— deja de
  // cargar con él. ?full=1 y ?projection=decision lo siguen llevando.
  const prepareRow = options.omitDecisionTrace
    ? (item) => item
    : (item) => prepareScanDecisionRow(item, decisionSettings);
  const rows = results
    .filter((item) => options.matchAllResults || item.scan_id === row.id)
    .sort((a, b) => (a.rank_index || 0) - (b.rank_index || 0))
    // Dos rehidrataciones desde la fuente compartida, ambas sobre la fila ya
    // construida: el RS del ranking semanal (rs_weekly_items) y la
    // capitalización de fundamental_snapshots. La ficha del valor lee esas dos
    // mismas tablas en vivo; sin esto, un snapshot de días atrás enseñaba en
    // el screener números que la ficha del mismo símbolo desmentía.
    .map((item) => attachCachedMarketCap(
      attachWeeklyThemeRs(
        attachWeeklyCountryRs(
          attachWeeklyRs(prepareRow(scanDecisionRowFromDb(item, options)), weeklyRsBySymbol),
          weeklyCountryRsBySymbol,
        ),
        weeklyThemeRsBySymbol,
      ),
      marketCapBySymbol,
    ));
  // rowsAvailable es el total real del escaneo (columna scans.row_count);
  // rowsReturned es lo que sobrevivió al recorte de rowsLimit. Si
  // includeRows viene en false no hubo recorte, solo no se pidieron filas:
  // en ese caso no hay nada que reportar como truncado.
  const rowsAvailable = Number(row.row_count) || 0;
  const rowsReturned = rows.length;
  const rowsTruncated = options.includeRows !== false && rowsAvailable > rowsReturned;
  return {
    id: row.local_id || row.id,
    cloudId: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    name: row.name,
    preset: row.preset,
    settings: row.settings || {},
    activeSettings: row.settings?.activeSettings || null,
    filterLayers: row.settings?.filterLayers || null,
    filterLayersVersion: row.settings?.filterLayersVersion ?? null,
    fieldRules: row.settings?.fieldRules || null,
    viewLayers: row.settings?.viewLayers || null,
    useRegimeFilter: row.settings?.useRegimeFilter ?? null,
    sort: row.settings?.sort || "",
    rowsAreFilteredSnapshot: snapshotRowsAreFiltered({ settings: row.settings || {} }),
    snapshotCompatibilityKey: row.settings?.snapshotCompatibilityKey || null,
    methodologySummary: row.settings?.methodologySummary || null,
    comparison: row.settings?.comparison || null,
    marketScore: finiteOrNull(row.market_score),
    marketRegime: row.market_regime || "sin dato",
    rows,
    rowsAvailable,
    rowsReturned,
    rowsTruncated,
    // Cómo se eligieron las filas que sí llegaron: `true` = muestra repartida
    // por todo el ranking (scanResultPageOffsets), `false` = las primeras por
    // rank_index porque cabían todas. La pantalla lo dice tal cual.
    rowsSampled: Boolean(options.rowsSampled) && rowsTruncated,
    ...(options.decisionProjection
      ? { decisionProjectionPartialRows: rows.filter((item) => item.decisionProjectionPartial).length }
      : {}),
  };
}

function scanTombstoneFromDb(row = {}) {
  return {
    id: row.local_id || row.id,
    cloudId: row.id,
    deletedAt: row.deleted_at || row.updated_at,
    updatedAt: row.updated_at || row.deleted_at,
  };
}

// Lo que sale de aquí VIAJA AL NAVEGADOR: va como `staleReason` del snapshot
// —que el screener pinta en su banner— y como `error` de la respuesta 500, que
// el cliente enseña en la línea de estado. Antes devolvía "Timeout consultando
// Supabase.", el nombre de Cloudflare con 180 caracteres del error original, o
// directamente 240 caracteres crudos: de ahí salía el "Supabase: Timeout
// consultando Supabase." con doble mención que veía el usuario.
//
// Ahora traduce con el mismo mapa que el resto del producto
// (lib/serviceErrors.js) y devuelve "" cuando no reconoce el error, para que
// cada caller ponga su propio texto. El original queda en el log del servidor.
function compactErrorMessage(value = "") {
  const text = String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  console.error("[scans] error del proveedor:", text.slice(0, 240));
  return userFacingServiceError(text, "");
}

async function cachedLatestScans(cacheKey, loadPayload) {
  const cached = scansApiCache.peek(cacheKey, { allowExpired: true });
  if (cached && !cached.expired) return cached.value;
  try {
    const payload = await loadPayload();
    scansApiCache.set(cacheKey, payload, LATEST_SCAN_TTL_MS);
    return payload;
  } catch (error) {
    if (!cached?.value) throw error;
    return {
      ...cached.value,
      ok: true,
      stale: true,
      staleForMs: cached.staleForMs,
      staleReason: compactErrorMessage(error.message) || "No se pudo refrescar la copia guardada.",
    };
  }
}

function timestampValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function scanSyncSummary(rows = [], payloads = []) {
  const incomingById = new Map(payloads.map((payload) => [String(payload?.local_id || "").trim(), timestampValue(payload?.updated_at)]));
  const skippedStale = rows.reduce((count, row) => {
    const incomingTime = incomingById.get(String(row?.local_id || "").trim()) || 0;
    if (!incomingTime) return count;
    return timestampValue(row?.updated_at) > incomingTime ? count + 1 : count;
  }, 0);
  return {
    saved: Math.max(rows.length - skippedStale, 0),
    returned: rows.length,
    skippedStale,
  };
}

export function scanDeleteSummary(rows = [], tombstones = []) {
  const incomingById = new Map(tombstones.map((item) => [String(item?.id || item?.localId || item?.local_id || "").trim(), timestampValue(item?.deletedAt || item?.deleted_at || item?.updatedAt || item?.updated_at)]));
  const skippedStale = rows.reduce((count, row) => {
    const incomingTime = incomingById.get(String(row?.local_id || row?.id || "").trim()) || 0;
    if (!incomingTime) return count;
    return !row?.deleted_at && timestampValue(row?.updated_at) > incomingTime ? count + 1 : count;
  }, 0);
  return {
    deleted: Math.max(rows.length - skippedStale, 0),
    returned: rows.length,
    skippedStale,
  };
}

function scanSyncError(error = {}) {
  const code = error.details?.code;
  const message = error.message || "";
  if (code === "PGRST202" || /(upsert_scan_newer_wins|delete_scan_newer_wins)/i.test(message)) {
    return "La sincronización de snapshots no está disponible en este entorno.";
  }
  return message || "No se pudieron sincronizar snapshots";
}

async function saveScan(scan, ownerId) {
  const payload = scanPayload(scan, ownerId);
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const decisionSettings = scan.activeSettings || scan.settings?.activeSettings || scan.settings || {};
  const saved = await supabaseRpc("upsert_scan_newer_wins", {
    p_owner_id: ownerId,
    p_scan: payload,
    p_results: rows.map((row, index) => resultPayload(row, null, ownerId, index, decisionSettings)),
  });
  return { row: Array.isArray(saved) ? saved[0] : null, payload };
}

export async function GET(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json({ ...disabledPayload(), scans: [] });
  const { searchParams } = new URL(req.url);
  const includeRows = searchParams.get("includeRows") !== "0";
  const includeDeleted = searchParams.get("includeDeleted") === "1";
  // Snapshot compacto por defecto: el chartPreview completo (96 barras OHLC por
  // fila) es ~70% del peso del payload y la UI de listas solo necesita la serie
  // ligera de la sparkline. ?full=1 devuelve las filas íntegras.
  const full = searchParams.get("full") === "1";
  const projection = searchParams.get("projection") || "";
  const decisionProjection = projection === "decision" && !full;
  const rsHydrationMode = scanRsHydrationMode({
    full,
    decisionProjection,
    hydrateRsParam: searchParams.get("hydrateRs"),
  });
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);
  const rowsLimit = Math.min(Math.max(Number(searchParams.get("rowsLimit") || 5000), 0), 20000);
  const scanSelect = "id,local_id,created_at,updated_at,deleted_at,name,preset,settings,market_score,market_regime,row_count";
  const resultSelectFull = "scan_id,rank_index,raw,symbol,company_name,country,sector,industry,theme,total_score,weinstein_score,minervini_score,risk_score,rs_rating,metrics";
  const resultSelectDecision = "scan_id,rank_index,symbol,company_name,country,sector,industry,theme,total_score,weinstein_score,minervini_score,risk_score,rs_rating,metrics";
  const resultSelect = decisionProjection ? resultSelectDecision : resultSelectFull;
  // ?anchor=nightly-us pide UN escaneo concreto —el último nocturno
  // estadounidense— en lugar del más reciente de la base. No es un lujo: el
  // cron europeo corre a las 22-23h, después del nocturno de las 03:57, así que
  // "el más reciente" es a partir de esa hora un escaneo de otro mercado (el 16
  // de agosto de 2026, UNA acción italiana frente a las 3.313 estadounidenses).
  // Ver lib/nightlyUsScan.js.
  const anchoredToNightlyUs = searchParams.get("anchor") === NIGHTLY_US_ANCHOR;
  const anchoredToMarkets = searchParams.get("anchor") === MARKETS_ANCHOR;
  const requestedMarkets = anchoredToMarkets
    ? sortedMarketsForLookup(String(searchParams.get("markets") || searchParams.get("market") || "").split(","))
    : [];
  try {
    const cacheableLatest = includeRows && !includeDeleted && limit === 1 && rowsLimit <= CACHEABLE_ROWS_LIMIT;
    const marketsCacheKey = anchoredToMarkets ? requestedMarkets.join(",") : "";
    const cacheKey = `latest:${config.ownerId}:${rowsLimit}:${decisionProjection ? "decision" : full ? "full" : "compact"}:${anchoredToNightlyUs ? NIGHTLY_US_ANCHOR : anchoredToMarkets ? `${MARKETS_ANCHOR}:${marketsCacheKey}` : "any"}`;
    const loadPayload = async () => {
      if (anchoredToMarkets) {
        if (!requestedMarkets.length) {
          return {
            configured: true,
            ok: true,
            projection: decisionProjection ? "decision" : full ? "full" : "compact",
            scans: [],
            scanTombstones: [],
            markets: { found: false, reason: "no-markets", requested: [], matchedScanId: null, rowCount: 0 },
          };
        }
        const materialized = await readLatestMaterializedScanForMarkets(requestedMarkets, {
          timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
          columns: scanSelect,
        });
        if (!materialized.scan) {
          return {
            configured: true,
            ok: true,
            projection: decisionProjection ? "decision" : full ? "full" : "compact",
            scans: [],
            scanTombstones: [],
            markets: {
              found: false,
              reason: materialized.reason || "no-materialized-scan",
              requested: requestedMarkets,
              matchedScanId: materialized.rejectedScan?.id || null,
              rowCount: materialized.rejectedScan?.rowCount ?? 0,
              rejectedScan: materialized.rejectedScan || null,
              missingMarkets: materialized.missingMarkets || null,
              missingDetails: materialized.missingDetails || null,
            },
          };
        }
        const scans = [materialized.row];
        const activeScans = scans.filter((scan) => !scan.deleted_at);
        let results = [];
        let rowsSampled = false;
        if (includeRows && activeScans.length && rowsLimit > 0) {
          if ((materialized.merged || materialized.accumulated) && Array.isArray(materialized.sourceScans) && materialized.sourceScans.length) {
            const page = await readMergedMaterializedResults({
              ownerId: config.ownerId,
              sourceScans: materialized.sourceScans,
              select: resultSelect,
              rowsLimit,
            });
            results = page.rows;
            rowsSampled = page.sampled;
          } else {
            const ids = activeScans.map((scan) => scan.id).join(",");
            const page = await readScanResultPages({
              ownerId: config.ownerId,
              scanIds: ids,
              select: resultSelect,
              rowsLimit,
              rowsAvailable: activeScans.reduce((total, scan) => total + (Number(scan.row_count) || 0), 0),
            });
            results = page.rows;
            rowsSampled = page.sampled;
          }
          if (!full && !decisionProjection) results = results.map((item) => ({ ...item, raw: compactResearchRow(item.raw) }));
        }
        const scanSymbols = results.map((item) => item.symbol).filter(Boolean);
        const hydration = await readScanRowHydration(scanSymbols, results, { hydrationMode: rsHydrationMode });
        return {
          configured: true,
          ok: true,
          projection: decisionProjection ? "decision" : full ? "full" : "compact",
          rsHydration: hydration.rsHydration,
          scans: activeScans.map((scan) => scanFromDb(scan, results, {
            decisionProjection,
            includeRows,
            rowsSampled,
            omitDecisionTrace: !full && !decisionProjection,
            weeklyRsBySymbol: hydration.weeklyRsBySymbol,
            weeklyCountryRsBySymbol: hydration.weeklyCountryRsBySymbol,
            weeklyThemeRsBySymbol: hydration.weeklyThemeRsBySymbol,
            marketCapBySymbol: hydration.marketCapBySymbol,
            matchAllResults: Boolean(materialized.merged || materialized.accumulated),
          })),
          scanTombstones: [],
          markets: {
            found: true,
            reason: materialized.partial ? "partial-markets" : null,
            requested: requestedMarkets,
            matchedScanId: materialized.scan.id,
            rowCount: results.length || materialized.scan.rowCount,
            localId: materialized.scan.localId,
            source: materialized.scan.source || null,
            merged: Boolean(materialized.merged),
            partial: Boolean(materialized.partial),
            missingMarkets: materialized.missingMarkets || null,
            missingDetails: materialized.missingDetails || null,
            accumulated: Boolean(materialized.accumulated),
            accumulatedNights: materialized.scan?.accumulatedNights || materialized.row?.settings?.accumulatedNights || null,
          },
        };
      }
      const nightly = anchoredToNightlyUs
        ? await readNightlyUsScan({ timeoutMs: SCANS_SUPABASE_TIMEOUT_MS, columns: scanSelect })
        : null;
      // Sin nocturno no se sirve el escaneo de otro mercado "para que haya
      // algo": se devuelve la ausencia con su motivo y la pantalla lo dice.
      if (anchoredToNightlyUs && !nightly.scan) {
        return {
          configured: true,
          ok: true,
          projection: decisionProjection ? "decision" : full ? "full" : "compact",
          scans: [],
          scanTombstones: [],
          nightly: { found: false, reason: nightly.reason || "no-nightly-scan", rejectedScan: nightly.rejectedScan || null },
        };
      }
      const scans = anchoredToNightlyUs ? [nightly.row] : await supabaseRequest("scans", {
        query: `owner_id=eq.${encodeURIComponent(config.ownerId)}${includeDeleted ? "" : "&deleted_at=is.null"}&select=${scanSelect}&order=created_at.desc&limit=${limit}`,
        timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
      });
      const activeScans = scans.filter((scan) => !scan.deleted_at);
      const deletedScans = scans.filter((scan) => scan.deleted_at);
      let results = [];
      let rowsSampled = false;
      if (includeRows && activeScans.length && rowsLimit > 0) {
        const ids = activeScans.map((scan) => scan.id).join(",");
        const page = await readScanResultPages({
          ownerId: config.ownerId,
          scanIds: ids,
          select: resultSelect,
          rowsLimit,
          rowsAvailable: activeScans.reduce((total, scan) => total + (Number(scan.row_count) || 0), 0),
        });
        results = page.rows;
        rowsSampled = page.sampled;
        if (!full && !decisionProjection) results = results.map((item) => ({ ...item, raw: compactResearchRow(item.raw) }));
      }
      // Lote único de RS semanal para todos los símbolos de todos los scans
      // devueltos — una consulta (o unas pocas, si hay muchos símbolos), no
      // una por símbolo. Si falla (Supabase caído, engine no configurado,
      // etc.) no debe tumbar la respuesta de scans: todo queda marcado como
      // no disponible y el criterio se omite aguas abajo, igual que un
      // símbolo que de verdad no esté en el ranking.
      const scanSymbols = results.map((item) => item.symbol).filter(Boolean);
      const hydration = await readScanRowHydration(scanSymbols, results, { hydrationMode: rsHydrationMode });
      return {
        configured: true,
        ok: true,
        projection: decisionProjection ? "decision" : full ? "full" : "compact",
        rsHydration: hydration.rsHydration,
        scans: activeScans.map((scan) => scanFromDb(scan, results, {
          decisionProjection,
          includeRows,
          rowsSampled,
          omitDecisionTrace: !full && !decisionProjection,
          weeklyRsBySymbol: hydration.weeklyRsBySymbol,
          weeklyCountryRsBySymbol: hydration.weeklyCountryRsBySymbol,
          weeklyThemeRsBySymbol: hydration.weeklyThemeRsBySymbol,
          marketCapBySymbol: hydration.marketCapBySymbol,
        })),
        scanTombstones: includeDeleted ? deletedScans.map(scanTombstoneFromDb) : [],
        ...(anchoredToNightlyUs ? { nightly: { found: true, ...nightly.scan } } : {}),
      };
    };
    return Response.json(cacheableLatest ? await cachedLatestScans(cacheKey, loadPayload) : await loadPayload());
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: compactErrorMessage(error.message) || "No se pudieron cargar snapshots", details: error.details || null }, { status: 500 });
  }
}

export async function POST(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  try {
    const body = await req.json();
    const scans = body.scans || (body.scan ? [body.scan] : []);
    const saved = [];
    const payloads = [];
    for (const scan of scans) {
      const result = await saveScan(scan, config.ownerId);
      if (result.row) saved.push(result.row);
      if (result.payload) payloads.push(result.payload);
    }
    const summary = scanSyncSummary(saved, payloads);
    clearScansApiCache();
    return Response.json({ configured: true, ok: true, ...summary, scans: saved.filter((row) => !row.deleted_at).map((row) => ({ ...row, row_count: Number(row.row_count || 0) })) });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: scanSyncError(error), details: error.details || null }, { status: 500 });
  }
}

export async function DELETE(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) return Response.json(disabledPayload());
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  try {
    const body = await req.json().catch(() => ({}));
    const tombstones = Array.isArray(body?.tombstones) && body.tombstones.length
      ? body.tombstones.map((item) => ({
        id: textOrNull(item.id || item.localId || item.local_id),
        deletedAt: toTimestamp(item.deletedAt || item.deleted_at || item.updatedAt || item.updated_at),
      }))
      : [{
        id: textOrNull(id),
        deletedAt: toTimestamp(searchParams.get("deletedAt")),
      }];
    const valid = tombstones.filter((item) => item.id);
    if (!valid.length) return Response.json({ error: "Falta id" }, { status: 400 });
    const rows = [];
    for (const tombstone of valid) {
      const savedRows = await supabaseRpc("delete_scan_newer_wins", {
        p_owner_id: config.ownerId,
        p_local_id: tombstone.id,
        p_deleted_at: tombstone.deletedAt,
      });
      if (Array.isArray(savedRows)) rows.push(...savedRows);
    }
    const summary = scanDeleteSummary(rows, valid);
    clearScansApiCache();
    return Response.json({
      configured: true,
      ok: true,
      ...summary,
      scanTombstones: rows.filter((row) => row.deleted_at).map(scanTombstoneFromDb),
    });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: scanSyncError(error), details: error.details || null }, { status: 500 });
  }
}
