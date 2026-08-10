import { disabledPayload, finiteOrNull, requirePersistenceAuth, supabaseConfig, supabaseRequest, supabaseRpc, textOrNull, toTimestamp } from "@/lib/supabaseServer";
import { compactResearchRow } from "@/lib/researchRowContract";
import { isPublicScanStatus } from "@/lib/scanStatus";
import { prepareScanDecisionRow, scanDecisionMetrics, scanDecisionRaw, scanDecisionRowFromDb } from "@/lib/scanDecisionProjection";
import { clearScansApiCache, LATEST_SCAN_TTL_MS, scansApiCache } from "@/lib/scansApiCache";
import { snapshotRowsAreFiltered } from "@/lib/snapshotRestore";
import { readGlobalRsForSymbols } from "@/lib/globalRs";

const SCANS_SUPABASE_TIMEOUT_MS = 8000;

function scanPayload(scan = {}, ownerId) {
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const progressStatus = textOrNull(scan.settings?.progress?.status);
  const settings = {
    ...(scan.settings || {}),
    activeSettings: scan.activeSettings || scan.settings?.activeSettings || null,
    filterLayers: scan.filterLayers || scan.settings?.filterLayers || null,
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

// Adjunta el RS semanal (rs_weekly_items, engine_version más reciente por
// símbolo) a una fila ya construida por prepareScanDecisionRow. Deliberadamente
// NO toca rsGlobalPct: ese campo lo consumen decenas de sitios además de la
// tabla/filtro (scoringEngine, decisionAudit, signalContradictions,
// screenerMethodologyEvidence, leaderboards...) y sustituirlo aquí cambiaría
// esas superficies en silencio — algo que la tarea prohíbe explícitamente
// ("NO cambies... el cálculo de rsGlobalPct"). Los campos nuevos conviven
// junto a rsGlobalPct; solo las superficies de display/filtro RS explícitamente
// migradas (tabla, ordenación, minRsRating, sectores, salud de mercado, modal
// de revisión) leen weeklyRs*.
function withWeeklyRs(row, weeklyRsBySymbol) {
  const entry = weeklyRsBySymbol?.get(String(row?.symbol || "").trim().toUpperCase());
  if (entry?.available) {
    return {
      ...row,
      weeklyRsAvailable: true,
      weeklyRsRating: entry.rsRating,
      weeklyRsRaw: entry.rsRaw,
      weeklyRsRank: entry.rank,
      weeklyRsSampleSize: entry.sampleSize,
      weeklyRsAsOf: entry.asOf,
      weeklyRsWeekKey: entry.weekKey,
      weeklyRsEngineVersion: entry.engineVersion,
      weeklyRsReason: null,
    };
  }
  return {
    ...row,
    weeklyRsAvailable: false,
    weeklyRsRating: null,
    weeklyRsRaw: null,
    weeklyRsRank: null,
    weeklyRsSampleSize: null,
    weeklyRsAsOf: null,
    weeklyRsWeekKey: null,
    weeklyRsEngineVersion: null,
    weeklyRsReason: entry?.reason || null,
  };
}

export function scanFromDb(row, results = [], options = {}) {
  const decisionSettings = row.settings?.activeSettings || row.settings || {};
  const weeklyRsBySymbol = options.weeklyRsBySymbol || null;
  const rows = results
    .filter((item) => item.scan_id === row.id)
    .sort((a, b) => (a.rank_index || 0) - (b.rank_index || 0))
    .map((item) => withWeeklyRs(prepareScanDecisionRow(scanDecisionRowFromDb(item, options), decisionSettings), weeklyRsBySymbol));
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

function compactErrorMessage(value = "") {
  const text = String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (/aborted|timeout|timed out/i.test(text)) return "Timeout consultando Supabase.";
  const cloudflare = text.match(/Error code\s*(\d+)/i)?.[1];
  if (cloudflare) return `Cloudflare ${cloudflare}: ${text.slice(0, 180)}`;
  return text.slice(0, 240);
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
      staleReason: compactErrorMessage(error.message) || "No se pudo refrescar el snapshot desde Supabase.",
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
    return "Falta una RPC de sincronizacion de snapshots. Aplica supabase/schema.sql antes de sincronizar snapshots.";
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
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);
  const rowsLimit = Math.min(Math.max(Number(searchParams.get("rowsLimit") || 5000), 0), 20000);
  const scanSelect = "id,local_id,created_at,updated_at,deleted_at,name,preset,settings,market_score,market_regime,row_count";
  const resultSelectFull = "scan_id,rank_index,raw,symbol,company_name,country,sector,industry,theme,total_score,weinstein_score,minervini_score,risk_score,rs_rating,metrics";
  const resultSelectDecision = "scan_id,rank_index,symbol,company_name,country,sector,industry,theme,total_score,weinstein_score,minervini_score,risk_score,rs_rating,metrics";
  const resultSelect = decisionProjection ? resultSelectDecision : resultSelectFull;
  try {
    const cacheableLatest = includeRows && !includeDeleted && limit === 1 && rowsLimit <= 5000;
    const cacheKey = `latest:${config.ownerId}:${rowsLimit}:${decisionProjection ? "decision" : full ? "full" : "compact"}`;
    const loadPayload = async () => {
      const scans = await supabaseRequest("scans", {
        query: `owner_id=eq.${encodeURIComponent(config.ownerId)}${includeDeleted ? "" : "&deleted_at=is.null"}&select=${scanSelect}&order=created_at.desc&limit=${limit}`,
        timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
      });
      const activeScans = scans.filter((scan) => !scan.deleted_at);
      const deletedScans = scans.filter((scan) => scan.deleted_at);
      let results = [];
      if (includeRows && activeScans.length && rowsLimit > 0) {
        const ids = activeScans.map((scan) => scan.id).join(",");
        results = await supabaseRequest("scan_results", {
          query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&scan_id=in.(${ids})&select=${resultSelect}&order=rank_index.asc&limit=${rowsLimit}`,
          timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
        });
        if (!full && !decisionProjection) results = results.map((item) => ({ ...item, raw: compactResearchRow(item.raw) }));
      }
      // Lote único de RS semanal para todos los símbolos de todos los scans
      // devueltos — una consulta (o unas pocas, si hay muchos símbolos), no
      // una por símbolo. Si falla (Supabase caído, engine no configurado,
      // etc.) no debe tumbar la respuesta de scans: todo queda marcado como
      // no disponible y el criterio se omite aguas abajo, igual que un
      // símbolo que de verdad no esté en el ranking.
      const scanSymbols = results.map((item) => item.symbol).filter(Boolean);
      const weeklyRs = await readGlobalRsForSymbols(scanSymbols).catch(() => ({ configured: false, bySymbol: new Map() }));
      return {
        configured: true,
        ok: true,
        projection: decisionProjection ? "decision" : full ? "full" : "compact",
        scans: activeScans.map((scan) => scanFromDb(scan, results, { decisionProjection, weeklyRsBySymbol: weeklyRs.bySymbol })),
        scanTombstones: includeDeleted ? deletedScans.map(scanTombstoneFromDb) : [],
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
