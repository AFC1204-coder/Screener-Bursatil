import { disabledPayload, finiteOrNull, requirePersistenceAuth, supabaseConfig, supabaseRequest, supabaseRpc, textOrNull, toTimestamp } from "@/lib/supabaseServer";

function scanPayload(scan = {}, ownerId) {
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const settings = {
    ...(scan.settings || {}),
    activeSettings: scan.activeSettings || scan.settings?.activeSettings || null,
    filterLayers: scan.filterLayers || scan.settings?.filterLayers || null,
    fieldRules: scan.fieldRules || scan.settings?.fieldRules || null,
    viewLayers: scan.viewLayers || scan.settings?.viewLayers || null,
    useRegimeFilter: scan.useRegimeFilter ?? scan.settings?.useRegimeFilter ?? null,
    rowsAreFilteredSnapshot: scan.rowsAreFilteredSnapshot ?? scan.settings?.rowsAreFilteredSnapshot ?? true,
    snapshotCompatibilityKey: scan.snapshotCompatibilityKey || scan.settings?.snapshotCompatibilityKey || null,
    methodologySummary: scan.methodologySummary || scan.settings?.methodologySummary || null,
    comparison: scan.comparison || scan.settings?.comparison || null,
  };
  return {
    owner_id: ownerId,
    local_id: textOrNull(scan.id) || crypto.randomUUID(),
    name: textOrNull(scan.name) || `Scan ${new Date().toLocaleString()}`,
    preset: textOrNull(scan.preset),
    settings,
    market_score: finiteOrNull(scan.marketScore),
    market_regime: textOrNull(scan.marketRegime),
    row_count: rows.length,
    created_at: toTimestamp(scan.createdAt),
    updated_at: toTimestamp(scan.updatedAt || scan.updated_at || scan.createdAt || scan.created_at),
  };
}

export function resultPayload(row = {}, scanId, ownerId, index) {
  return {
    owner_id: ownerId,
    scan_id: scanId,
    symbol: textOrNull(row.symbol) || "-",
    company_name: textOrNull(row.companyName || row.name || row.symbol),
    country: textOrNull(row.country),
    sector: textOrNull(row.sector),
    industry: textOrNull(row.industry),
    theme: textOrNull(row.theme),
    rank_index: index + 1,
    total_score: finiteOrNull(row.totalScore),
    weinstein_score: finiteOrNull(row.weinsteinScore),
    minervini_score: finiteOrNull(row.minerviniScore),
    risk_score: finiteOrNull(row.riskScore),
    rs_rating: finiteOrNull(row.rsGlobalPct ?? row.rsRating),
    metrics: {
      rsGlobalPct: row.rsGlobalPct ?? null,
      rsRating: row.rsRating ?? null,
      rsCountryPct: row.rsCountryPct ?? null,
      rsSectorPct: row.rsSectorPct ?? null,
      rsQualityScore: row.rsQualityScore ?? null,
      rsStabilityScore: row.rsStabilityScore ?? null,
      speculationRiskScore: row.speculationRiskScore ?? null,
      rsQualityLabel: row.rsQualityLabel ?? null,
      rsGlobalSample: row.rsGlobalSample ?? null,
      rsCountrySample: row.rsCountrySample ?? null,
      rsSectorSample: row.rsSectorSample ?? null,
      rs3m: row.rs3m ?? null,
      rs6m: row.rs6m ?? null,
      rs12m: row.rs12m ?? null,
      benchmarkSymbol: row.benchmarkSymbol ?? null,
      benchmarkPerf3m: row.benchmarkPerf3m ?? null,
      benchmarkPerf6m: row.benchmarkPerf6m ?? null,
      benchmarkPerf12m: row.benchmarkPerf12m ?? null,
      rsBenchmarkSample: row.rsBenchmarkSample ?? null,
      rsBenchmarkAvailable: row.rsBenchmarkAvailable ?? null,
      rsBenchmarkIssue: row.rsBenchmarkIssue ?? null,
      perf3m: row.perf3m ?? null,
      perf6m: row.perf6m ?? null,
      perf12m: row.perf12m ?? null,
      distance20d: row.distance20d ?? null,
      distance50d: row.distance50d ?? null,
      distance52w: row.distance52w ?? null,
      extSma50: row.extSma50 ?? null,
      avgVolume: row.avgVolume ?? null,
      latestVolume: row.latestVolume ?? null,
      avgTurnover: row.avgTurnover ?? null,
      latestTurnover: row.latestTurnover ?? null,
      relativeVolume: row.relativeVolume ?? null,
      volumeSurgePct: row.volumeSurgePct ?? null,
      upDownVolRatio: row.upDownVolRatio ?? null,
      shortPercentOfFloat: row.shortPercentOfFloat ?? null,
      sharesPercentSharesOut: row.sharesPercentSharesOut ?? null,
      shortRatio: row.shortRatio ?? null,
      sharesShort: row.sharesShort ?? null,
      floatShares: row.floatShares ?? null,
      volumeScore: row.volumeScore ?? null,
      volumeEffectScore: row.volumeEffectScore ?? null,
      volumeEvidence: row.volumeEvidence ?? null,
      liquidityScore: row.liquidityScore ?? null,
      sectorScore: row.sectorScore ?? null,
      growthScore: row.growthScore ?? null,
      setupQualityScore: row.setupQualityScore ?? null,
      setupVerdictKey: row.setupVerdictKey ?? null,
      setupVerdictState: row.setupVerdictState ?? null,
      setupVerdictLabel: row.setupVerdictLabel ?? null,
      setupVerdictShortLabel: row.setupVerdictShortLabel ?? null,
      setupVerdictReason: row.setupVerdictReason ?? null,
      setupVerdictEvidence: row.setupVerdictEvidence ?? null,
      setupVerdictTone: row.setupVerdictTone ?? null,
      setupDataConfidenceKey: row.setupDataConfidenceKey ?? null,
      setupDataConfidenceLabel: row.setupDataConfidenceLabel ?? null,
      setupPlanValid: row.setupPlanValid ?? null,
      setupActionable: row.setupActionable ?? null,
      setupObservable: row.setupObservable ?? null,
      setupWatch: row.setupWatch ?? null,
      setupStrict: row.setupStrict ?? null,
      setupDisplayKey: row.setupDisplayKey ?? null,
      setupDisplayState: row.setupDisplayState ?? null,
      setupDisplayLabel: row.setupDisplayLabel ?? null,
      setupDisplayShortLabel: row.setupDisplayShortLabel ?? null,
      setupDisplayReason: row.setupDisplayReason ?? null,
      setupDisplayEvidence: row.setupDisplayEvidence ?? null,
      setupDisplayLine: row.setupDisplayLine ?? null,
      setupDisplayTone: row.setupDisplayTone ?? null,
      setupDisplayDataLimited: row.setupDisplayDataLimited ?? null,
      setupDisplayBlocksPatternClaim: row.setupDisplayBlocksPatternClaim ?? null,
      setupDisplayPlanValid: row.setupDisplayPlanValid ?? null,
      setupDisplayActionable: row.setupDisplayActionable ?? null,
      setupDisplayObservable: row.setupDisplayObservable ?? null,
      setupDisplayWatch: row.setupDisplayWatch ?? null,
      setupDisplayStrict: row.setupDisplayStrict ?? null,
      setupDisplayTradePlanEligible: row.setupDisplayTradePlanEligible ?? null,
      setupDisplayConfidenceKey: row.setupDisplayConfidenceKey ?? null,
      setupDisplayConfidenceLabel: row.setupDisplayConfidenceLabel ?? null,
      methodologyReliabilityState: row.methodologyReliabilityState ?? null,
      methodologyReliabilityLabel: row.methodologyReliabilityLabel ?? null,
      methodologyReliabilityReason: row.methodologyReliabilityReason ?? null,
      methodologyBlocksPatternClaim: row.methodologyBlocksPatternClaim ?? null,
      pivotPrice: row.pivotPrice ?? null,
      distanceToPivotPct: row.distanceToPivotPct ?? null,
      baseDepthPct: row.baseDepthPct ?? null,
      baseDays: row.baseDays ?? null,
      baseWeeks: row.baseWeeks ?? null,
      volumeDryUpRatio: row.volumeDryUpRatio ?? null,
      latestVolumeRatio: row.latestVolumeRatio ?? null,
      latestCloseLocationPct: row.latestCloseLocationPct ?? null,
      contractionDepths: row.contractionDepths ?? null,
      contractionCount: row.contractionCount ?? null,
      vcpCandidate: row.vcpCandidate ?? null,
      breakoutAttempt: row.breakoutAttempt ?? null,
      breakoutQualityScore: row.breakoutQualityScore ?? null,
      failedBreakout: row.failedBreakout ?? null,
      patternFamily: row.patternFamily ?? null,
      patternMaturity: row.patternMaturity ?? null,
      patternQualityScore: row.patternQualityScore ?? null,
      setupStructureKey: row.setupStructureKey ?? null,
      setupStructureLabel: row.setupStructureLabel ?? null,
      setupStructureReason: row.setupStructureReason ?? null,
      setupStructureEvidence: row.setupStructureEvidence ?? null,
      setupStructureTone: row.setupStructureTone ?? null,
      setupStructureStrict: row.setupStructureStrict ?? null,
      setupStructureDataLabel: row.setupStructureDataLabel ?? null,
      patternDataStatus: row.patternDataStatus ?? null,
      patternEligible: row.patternEligible ?? null,
      patternIssues: row.patternIssues ?? null,
      patternVolumeEligible: row.patternVolumeEligible ?? null,
      patternFreshnessDays: row.patternFreshnessDays ?? null,
      patternBarsCount: row.patternBarsCount ?? null,
      patternMinBars: row.patternMinBars ?? null,
      patternCoveragePct: row.patternCoveragePct ?? null,
      patternOhlcCoveragePct: row.patternOhlcCoveragePct ?? null,
      patternVolumeCoveragePct: row.patternVolumeCoveragePct ?? null,
      consolidationCandidate: row.consolidationCandidate ?? null,
      baseContextStatus: row.baseContextStatus ?? null,
      pivotSqueeze: row.pivotSqueeze ?? null,
      baseContextScore: row.baseContextScore ?? null,
      baseReturnPct: row.baseReturnPct ?? null,
      priorUptrendPct: row.priorUptrendPct ?? null,
      basePivotAgeBars: row.basePivotAgeBars ?? null,
      baseNearPivotDays: row.baseNearPivotDays ?? null,
      baseNewHighCount: row.baseNewHighCount ?? null,
      marginalHighBreaks: row.marginalHighBreaks ?? null,
      earlyBaseDepthPct: row.earlyBaseDepthPct ?? null,
      middleBaseDepthPct: row.middleBaseDepthPct ?? null,
      lateBaseDepthPct: row.lateBaseDepthPct ?? null,
      rangeCompressionRatio: row.rangeCompressionRatio ?? null,
      atr20Pct: row.atr20Pct ?? null,
      atr50Pct: row.atr50Pct ?? null,
      meaningfulContractionMinPct: row.meaningfulContractionMinPct ?? null,
      contractionsDecreasing: row.contractionsDecreasing ?? null,
      contraction1DepthPct: row.contraction1DepthPct ?? null,
      contraction2DepthPct: row.contraction2DepthPct ?? null,
      contraction3DepthPct: row.contraction3DepthPct ?? null,
      contraction4DepthPct: row.contraction4DepthPct ?? null,
      lastContractionDepthPct: row.lastContractionDepthPct ?? null,
      rejectedContractionDepthPct: row.rejectedContractionDepthPct ?? null,
      contractionReductionPct: row.contractionReductionPct ?? null,
      contractionStructureStatus: row.contractionStructureStatus ?? null,
      contractionStructureReason: row.contractionStructureReason ?? null,
      measuredContractionDepths: row.measuredContractionDepths ?? null,
      contractionSwings: row.contractionSwings ?? null,
      measuredContractionSwings: row.measuredContractionSwings ?? null,
      rejectedContractionSwing: row.rejectedContractionSwing ?? null,
      absDistanceToPivotPct: row.absDistanceToPivotPct ?? null,
      tightness5dPct: row.tightness5dPct ?? null,
      tightness10dPct: row.tightness10dPct ?? null,
      tightness20dPct: row.tightness20dPct ?? null,
      pivotClarityScore: row.pivotClarityScore ?? null,
      volumeDryUpScore: row.volumeDryUpScore ?? null,
      baseQualityScore: row.baseQualityScore ?? null,
      weeklyStageState: row.weeklyStageState ?? null,
      weeklyStageLabel: row.weeklyStageLabel ?? null,
      weeklyFastWeeks: row.weeklyFastWeeks ?? null,
      weeklySlowWeeks: row.weeklySlowWeeks ?? null,
      weeklyFastMa: row.weeklyFastMa ?? null,
      weeklySlowMa: row.weeklySlowMa ?? null,
      weeklySlowMaSlope: row.weeklySlowMaSlope ?? null,
      weeklyDistanceFastMa: row.weeklyDistanceFastMa ?? null,
      weeklyDistanceSlowMa: row.weeklyDistanceSlowMa ?? null,
      priceFreshnessDays: row.priceFreshnessDays ?? null,
      priceFreshnessLabel: row.priceFreshnessLabel ?? null,
      priceFreshnessOk: row.priceFreshnessOk ?? null,
      lastDate: row.lastDate ?? null,
    },
    raw: row,
  };
}

function scanFromDb(row, results = []) {
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
    rowsAreFilteredSnapshot: row.settings?.rowsAreFilteredSnapshot !== false,
    snapshotCompatibilityKey: row.settings?.snapshotCompatibilityKey || null,
    methodologySummary: row.settings?.methodologySummary || null,
    comparison: row.settings?.comparison || null,
    marketScore: finiteOrNull(row.market_score),
    marketRegime: row.market_regime || "sin dato",
    rows: results
      .filter((item) => item.scan_id === row.id)
      .sort((a, b) => (a.rank_index || 0) - (b.rank_index || 0))
      .map((item) => item.raw || {
        symbol: item.symbol,
        companyName: item.company_name,
        country: item.country,
        sector: item.sector,
        industry: item.industry,
        theme: item.theme,
        totalScore: finiteOrNull(item.total_score),
        weinsteinScore: finiteOrNull(item.weinstein_score),
        minerviniScore: finiteOrNull(item.minervini_score),
        riskScore: finiteOrNull(item.risk_score),
        rsRating: finiteOrNull(item.rs_rating),
        ...(item.metrics || {}),
      }),
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
  const saved = await supabaseRpc("upsert_scan_newer_wins", {
    p_owner_id: ownerId,
    p_scan: payload,
    p_results: rows.map((row, index) => resultPayload(row, null, ownerId, index)),
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
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);
  try {
    const scans = await supabaseRequest("scans", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}${includeDeleted ? "" : "&deleted_at=is.null"}&select=*&order=created_at.desc&limit=${limit}`,
    });
    const activeScans = scans.filter((scan) => !scan.deleted_at);
    const deletedScans = scans.filter((scan) => scan.deleted_at);
    let results = [];
    if (includeRows && activeScans.length) {
      const ids = activeScans.map((scan) => scan.id).join(",");
      results = await supabaseRequest("scan_results", {
        query: `scan_id=in.(${ids})&select=*&order=rank_index.asc`,
      });
    }
    return Response.json({
      configured: true,
      ok: true,
      scans: activeScans.map((scan) => scanFromDb(scan, results)),
      scanTombstones: includeDeleted ? deletedScans.map(scanTombstoneFromDb) : [],
    });
  } catch (error) {
    return Response.json({ configured: true, ok: false, error: error.message, details: error.details || null }, { status: 500 });
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
