import { weeklyBarsFromDaily } from "@/lib/weeklyStage";
import { setupStructureForRow } from "@/lib/patternNarrative";
import { methodologyVerdictForRow } from "@/lib/methodologyVerdict";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function median(values = []) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const middle = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[middle] : (xs[middle - 1] + xs[middle]) / 2;
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function displaySnapshotFields(display = {}) {
  const blocked = display.blocksPatternClaim === true || display.dataLimited === true;
  return {
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
    setupDisplayConfidenceKey: display.confidence?.key || "",
    setupDisplayConfidenceLabel: display.confidence?.label || "",
  };
}

function pctDistance(high, low) {
  return Number.isFinite(high) && Number.isFinite(low) && high > 0 ? ((high - low) / high) * 100 : null;
}

function rangeStats(rows = []) {
  const highs = rows.map((bar) => finite(bar.high) ?? finite(bar.close)).filter(Number.isFinite);
  const lows = rows.map((bar) => finite(bar.low) ?? finite(bar.close)).filter(Number.isFinite);
  const high = highs.length ? Math.max(...highs) : null;
  const low = lows.length ? Math.min(...lows) : null;
  const depthPct = Number.isFinite(high) && Number.isFinite(low) && high > 0 ? ((high - low) / high) * 100 : null;
  return { high, low, depthPct };
}

function closeLocation(bar = {}) {
  const high = finite(bar.high) ?? finite(bar.close);
  const low = finite(bar.low) ?? finite(bar.close);
  const close = finite(bar.close);
  if (![high, low, close].every(Number.isFinite) || high <= low) return null;
  return ((close - low) / (high - low)) * 100;
}

function daysSince(date = "", referenceDate = Date.now()) {
  const parsed = Date.parse(date);
  const reference = Number.isFinite(Number(referenceDate)) ? Number(referenceDate) : Date.parse(referenceDate);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isFinite(reference)) return null;
  return Math.max(0, Math.floor((reference - parsed) / 86400000));
}

function usableBars(rows = []) {
  return (rows || [])
    .map((bar) => {
      const close = finite(bar.close);
      if (!bar?.date || !Number.isFinite(close) || close <= 0) return null;
      const high = finite(bar.high) ?? close;
      const low = finite(bar.low) ?? close;
      return {
        ...bar,
        close,
        high: Math.max(high, close),
        low: Math.min(low, close),
        open: finite(bar.open) ?? close,
        volume: finite(bar.volume),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function coverageBars(rows = []) {
  return (rows || [])
    .map((bar) => {
      if (!bar?.date) return null;
      return {
        date: bar.date,
        high: finite(bar.high),
        low: finite(bar.low),
        close: finite(bar.close),
        volume: finite(bar.volume),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function coverageRatio(rows = [], field = "close") {
  if (!rows.length) return 0;
  return rows.filter((row) => Number.isFinite(finite(row[field]))).length / rows.length;
}

function patternDataGate(rows = [], options = {}) {
  const minBars = Number(options.minPatternBars || 90);
  const sourceRows = Array.isArray(options.rawBars) ? coverageBars(options.rawBars) : rows;
  const recentRows = sourceRows.slice(0, Math.min(90, sourceRows.length));
  const volumeRows = sourceRows.slice(0, Math.min(50, sourceRows.length));
  const priceAgeDays = daysSince(rows[0]?.date, options.referenceDate ?? options.asOfDate ?? Date.now());
  const highCoverage = coverageRatio(recentRows, "high");
  const lowCoverage = coverageRatio(recentRows, "low");
  const closeCoverage = coverageRatio(recentRows, "close");
  const volumeCoverage = coverageRatio(volumeRows, "volume");
  const issues = [];
  if (rows.length < minBars) issues.push("insufficient_history");
  if (!Number.isFinite(priceAgeDays)) issues.push("missing_latest_date");
  else if (priceAgeDays > Number(options.maxPatternFreshnessDays || 10)) issues.push("stale_price");
  if (highCoverage < .95 || lowCoverage < .95 || closeCoverage < .98) issues.push("sparse_ohlc");
  if (volumeCoverage < .8) issues.push("missing_volume");

  const hardIssues = new Set(["insufficient_history", "missing_latest_date", "stale_price", "sparse_ohlc"]);
  const hardBlocked = issues.some((issue) => hardIssues.has(issue));
  return {
    patternEligible: !hardBlocked,
    patternDataStatus: hardBlocked ? issues.find((issue) => hardIssues.has(issue)) : issues.length ? "partial_volume" : "ok",
    patternIssues: issues,
    patternVolumeEligible: !issues.includes("missing_volume"),
    patternFreshnessDays: priceAgeDays,
    patternBarsCount: rows.length,
    patternMinBars: minBars,
    patternCoveragePct: minBars > 0 ? clamp((rows.length / minBars) * 100, 0, 100) : null,
    patternOhlcCoveragePct: Math.round(Math.min(highCoverage, lowCoverage, closeCoverage) * 1000) / 10,
    patternVolumeCoveragePct: Math.round(volumeCoverage * 1000) / 10,
  };
}

function localPivots(descRows = [], lookback = 130, radius = 3) {
  const lookbackRows = descRows.slice(0, Math.min(lookback, descRows.length));
  const asc = [...lookbackRows].reverse();
  const pivots = [];
  for (let i = radius; i < asc.length - radius; i++) {
    const window = asc.slice(i - radius, i + radius + 1);
    const high = finite(asc[i].high) ?? finite(asc[i].close);
    const low = finite(asc[i].low) ?? finite(asc[i].close);
    const isHigh = Number.isFinite(high) && high === Math.max(...window.map((row) => finite(row.high) ?? finite(row.close)).filter(Number.isFinite));
    const isLow = Number.isFinite(low) && low === Math.min(...window.map((row) => finite(row.low) ?? finite(row.close)).filter(Number.isFinite));
    const descIndex = lookbackRows.length - 1 - i;
    if (isHigh) pivots.push({ type: "high", index: i, descIndex, date: asc[i].date, price: high });
    if (isLow) pivots.push({ type: "low", index: i, descIndex, date: asc[i].date, price: low });
  }
  const merged = [];
  for (const pivot of pivots.sort((a, b) => a.index - b.index)) {
    const prev = merged[merged.length - 1];
    if (prev?.type === pivot.type) {
      const betterHigh = pivot.type === "high" && pivot.price > prev.price;
      const betterLow = pivot.type === "low" && pivot.price < prev.price;
      if (betterHigh || betterLow) merged[merged.length - 1] = pivot;
    } else {
      merged.push(pivot);
    }
  }
  return merged;
}

function contractionSequence(rows = []) {
  const pivots = localPivots(rows);
  const pullbacks = [];
  for (let i = 0; i < pivots.length - 1; i++) {
    const high = pivots[i];
    if (high.type !== "high") continue;
    const low = pivots.slice(i + 1).find((pivot) => pivot.type === "low");
    if (!low) continue;
    const nextHigh = pivots.slice(i + 1).find((pivot) => pivot.type === "high");
    if (nextHigh && nextHigh.index < low.index) continue;
    const depthPct = pctDistance(high.price, low.price);
    const bars = low.index - high.index;
    if (Number.isFinite(depthPct) && depthPct >= 2 && bars >= 2) {
      pullbacks.push({
        depthPct,
        fromDate: high.date,
        toDate: low.date,
        high: high.price,
        low: low.price,
        highDescIndex: high.descIndex,
        lowDescIndex: low.descIndex,
        bars,
      });
    }
  }
  return pullbacks;
}

function decreasingSequence(depths = []) {
  const xs = depths.filter(Number.isFinite);
  if (xs.length < 2) return false;
  return xs.every((value, index) => index === 0 || value <= xs[index - 1] * 0.92 || value <= xs[index - 1] - 1);
}

function tightnessPct(rows = [], n = 10) {
  return rangeStats(rows.slice(0, Math.min(n, rows.length))).depthPct;
}

function averageTrueRangePct(rows = [], n = 20) {
  const values = [];
  for (let index = 0; index < Math.min(n, rows.length - 1); index++) {
    const bar = rows[index];
    const prevClose = finite(rows[index + 1]?.close);
    const high = finite(bar.high) ?? finite(bar.close);
    const low = finite(bar.low) ?? finite(bar.close);
    if (![high, low, prevClose].every(Number.isFinite) || prevClose <= 0) continue;
    values.push((Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)) / prevClose) * 100);
  }
  return avg(values);
}

function pivotClarity({ rows = [], pivotPrice, distanceToPivotPct, highsSpreadPct }) {
  if (!Number.isFinite(pivotPrice) || pivotPrice <= 0) return { pivotClarityScore: null, pivotTouchCount: 0 };
  const pivotRows = rows.slice(1, Math.min(66, rows.length));
  const pivotTouchCount = pivotRows.filter((bar) => {
    const high = finite(bar.high) ?? finite(bar.close);
    return Number.isFinite(high) && Math.abs((high / pivotPrice - 1) * 100) <= 3;
  }).length;
  const pivotClarityScore = clamp(
    (pivotTouchCount >= 2 ? 34 : pivotTouchCount === 1 ? 18 : 0)
    + (Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= -8 && distanceToPivotPct <= 5 ? 34 : 0)
    + (Number.isFinite(highsSpreadPct) ? clamp((18 - highsSpreadPct) * 1.5, 0, 24) : 0)
    + (pivotRows.length >= 30 ? 8 : 0)
  );
  return { pivotClarityScore, pivotTouchCount };
}

function weeklyStructure(rows = []) {
  const weekly = weeklyBarsFromDaily(rows);
  const baseRows = weekly.slice(0, Math.min(16, weekly.length));
  const base = rangeStats(baseRows);
  const latest = weekly[0];
  const high52 = rangeStats(weekly.slice(0, Math.min(52, weekly.length))).high;
  return {
    weeklyBaseDepthPct: base.depthPct,
    weeklyBaseWeeks: baseRows.length || null,
    weeklyNearHighPct: Number.isFinite(latest?.close) && Number.isFinite(high52) && high52 > 0 ? ((latest.close / high52) - 1) * 100 : null,
  };
}

function consolidationContext(rows = [], { base = {}, pivotPrice, price } = {}) {
  const window = rows.slice(0, Math.min(65, rows.length));
  const olderRows = rows.slice(65, Math.min(130, rows.length));
  const oldest = window.at(-1) || {};
  const oldestClose = finite(oldest.close);
  const preBaseClose = finite(olderRows.at(-1)?.close);
  const baseReturnPct = Number.isFinite(price) && Number.isFinite(oldestClose) && oldestClose > 0 ? ((price / oldestClose) - 1) * 100 : null;
  const priorUptrendPct = Number.isFinite(oldestClose) && Number.isFinite(preBaseClose) && preBaseClose > 0 ? ((oldestClose / preBaseClose) - 1) * 100 : null;
  const earlyBase = rangeStats(window.slice(35, 65));
  const lateBase = rangeStats(window.slice(0, 15));
  const middleBase = rangeStats(window.slice(15, 35));
  const atr20Pct = averageTrueRangePct(rows, 20);
  const atr50Pct = averageTrueRangePct(rows, 50);
  const baseRangeMedianPct = median([earlyBase.depthPct, middleBase.depthPct].filter(Number.isFinite));
  const rangeCompressionRatio = Number.isFinite(lateBase.depthPct) && Number.isFinite(baseRangeMedianPct) && baseRangeMedianPct > 0
    ? lateBase.depthPct / baseRangeMedianPct
    : null;
  const tightnessThresholdPct = Number.isFinite(atr20Pct) ? clamp(atr20Pct * 2.4, 5, 12) : 8;
  const rightSideTight = Number.isFinite(lateBase.depthPct) && lateBase.depthPct <= tightnessThresholdPct;
  const volatilityCompression = Number.isFinite(rangeCompressionRatio) && rangeCompressionRatio <= .75
    || Number.isFinite(lateBase.depthPct) && Number.isFinite(base.depthPct) && lateBase.depthPct <= base.depthPct * .45;
  let pivotAgeBars = null;
  let nearPivotDays = 0;
  let marginalHighBreaks = 0;
  if (Number.isFinite(pivotPrice) && pivotPrice > 0) {
    for (let index = 1; index < window.length; index++) {
      const high = finite(window[index].high) ?? finite(window[index].close);
      if (!Number.isFinite(high)) continue;
      const distancePct = Math.abs((high / pivotPrice - 1) * 100);
      if (distancePct <= 1.5 && pivotAgeBars === null) pivotAgeBars = index;
      if (distancePct <= 5) nearPivotDays += 1;
      if (high > pivotPrice * 1.003 && high <= pivotPrice * 1.035) marginalHighBreaks += 1;
    }
  }
  const asc = [...window].reverse();
  let runningHigh = null;
  let baseNewHighCount = 0;
  for (const bar of asc) {
    const high = finite(bar.high) ?? finite(bar.close);
    if (!Number.isFinite(high)) continue;
    if (runningHigh === null) {
      runningHigh = high;
      continue;
    }
    if (high > runningHigh * 1.003) baseNewHighCount += 1;
    runningHigh = Math.max(runningHigh, high);
  }
  const highChurnCeiling = baseNewHighCount <= 30;
  const establishedCeiling = highChurnCeiling && (Number.isFinite(pivotAgeBars) && pivotAgeBars >= 8 || nearPivotDays >= 10);
  const persistentAdvance = Number.isFinite(baseReturnPct)
    && baseReturnPct > 18
    && baseNewHighCount >= 16
    && (!Number.isFinite(pivotAgeBars) || pivotAgeBars <= 8)
    && !establishedCeiling;
  const rangeControlled = !Number.isFinite(base.depthPct) || base.depthPct <= 48;
  const baseDepthSufficient = Number.isFinite(base.depthPct) && base.depthPct >= Math.max(8, (atr20Pct ?? 3) * 2.1);
  const controlledHighs = baseNewHighCount <= 14 || establishedCeiling;
  const consolidationCandidate = window.length >= 25
    && rangeControlled
    && !persistentAdvance
    && (establishedCeiling || volatilityCompression && baseDepthSufficient && controlledHighs || rightSideTight && nearPivotDays >= 6 && controlledHighs);
  const baseContextScore = clamp(
    (establishedCeiling ? 30 : 0)
    + (volatilityCompression ? 24 : 0)
    + (rightSideTight ? 18 : 0)
    + (baseDepthSufficient ? 12 : 0)
    + (Number.isFinite(priorUptrendPct) && priorUptrendPct >= 15 ? 8 : 0)
    + (persistentAdvance ? -35 : 0)
  );
  return {
    consolidationCandidate,
    pivotPrice,
    baseReturnPct,
    priorUptrendPct,
    basePivotAgeBars: pivotAgeBars,
    baseNearPivotDays: nearPivotDays,
    baseNewHighCount,
    marginalHighBreaks,
    earlyBaseDepthPct: earlyBase.depthPct,
    middleBaseDepthPct: middleBase.depthPct,
    lateBaseDepthPct: lateBase.depthPct,
    rangeCompressionRatio,
    atr20Pct,
    atr50Pct,
    rightSideTight,
    volatilityCompression,
    baseContextScore,
    meaningfulContractionMinPct: Number.isFinite(atr20Pct) ? clamp(atr20Pct * .9, 2.4, 5.5) : 3,
    baseContextStatus: consolidationCandidate ? "consolidating" : persistentAdvance ? "persistent_advance" : "unconfirmed_base",
  };
}

function structuralContractions(rows = [], context = {}) {
  if (!context.consolidationCandidate) return { contractions: [], contractionStructureStatus: "not_consolidating", contractionStructureReason: "base not confirmed" };
  const meaningful = contractionSequence(rows).filter((item) => {
    if (!Number.isFinite(item.depthPct)) return false;
    const meaningfulDepth = item.depthPct >= (context.meaningfulContractionMinPct ?? 3)
      || context.rightSideTight && item.depthPct >= 2.2;
    const recentBaseSwing = (item.highDescIndex ?? 999) <= 90 && (item.lowDescIndex ?? 999) <= 90;
    return meaningfulDepth && recentBaseSwing;
  });
  if (!meaningful.length) return { contractions: [], contractionStructureStatus: "no_meaningful_contractions", contractionStructureReason: "no meaningful base contractions" };
  const anchor = meaningful.reduce((best, item) => item.depthPct > best.depthPct ? item : best, meaningful[0]);
  const ceiling = Math.max(anchor.high, Number.isFinite(context.pivotPrice) ? context.pivotPrice : anchor.high) * 1.04;
  const floor = anchor.low * 0.997;
  const accepted = [anchor];
  let rejected = null;
  let contractionStructureStatus = "ok";
  let contractionStructureReason = "";
  for (const item of meaningful) {
    if (item === anchor || item.highDescIndex >= anchor.highDescIndex) continue;
    const previous = accepted.at(-1);
    const highGap = Math.abs((previous.highDescIndex ?? NaN) - (item.highDescIndex ?? NaN));
    const lowGap = Math.abs((previous.lowDescIndex ?? NaN) - (item.lowDescIndex ?? NaN));
    const separated = (!Number.isFinite(highGap) || highGap >= 4) && (!Number.isFinite(lowGap) || lowGap >= 4);
    const sameCeiling = !Number.isFinite(item.high) || item.high <= ceiling;
    const holdsBaseFloor = !Number.isFinite(item.low) || item.low >= floor;
    const holdsPreviousLow = !Number.isFinite(item.low) || !Number.isFinite(previous.low) || item.low >= previous.low * 0.997;
    const usefulReduction = !Number.isFinite(item.depthPct) || !Number.isFinite(previous.depthPct)
      || item.depthPct <= previous.depthPct * 0.98
      || item.depthPct <= previous.depthPct - 0.5;
    if (!separated) {
      contractionStructureStatus = "pivot_noise";
      contractionStructureReason = "swings too close to count as separate contractions";
      rejected = item;
      break;
    }
    if (!sameCeiling) {
      contractionStructureStatus = "ceiling_break";
      contractionStructureReason = "base ceiling not stable";
      rejected = item;
      break;
    }
    if (!holdsBaseFloor || !holdsPreviousLow) {
      contractionStructureStatus = "lower_low_drift";
      contractionStructureReason = "base floor not holding";
      rejected = item;
      break;
    }
    if (!usefulReduction) {
      contractionStructureStatus = "depth_reexpansion";
      contractionStructureReason = "contractions are re-expanding";
      rejected = item;
      break;
    }
    accepted.push(item);
  }
  return {
    contractions: accepted.slice(0, 4),
    rejectedContraction: rejected,
    measuredContractions: (rejected ? [...accepted, rejected] : accepted).slice(0, 4),
    contractionStructureStatus,
    contractionStructureReason,
  };
}

export function setupPatternForBars(bars = [], options = {}) {
  const rows = usableBars(bars);
  const latest = rows[0] || {};
  const price = finite(latest.close);
  const baseRows = rows.slice(0, Math.min(65, rows.length));
  const pivotRows = rows.slice(1, Math.min(66, rows.length));
  const base = rangeStats(baseRows);
  const pivotPrice = rangeStats(pivotRows).high;
  const avgVolume50 = avg(rows.slice(1, 51).map((bar) => finite(bar.volume)));
  const avgVolume10 = avg(rows.slice(0, 10).map((bar) => finite(bar.volume)));
  const avgVolume5 = avg(rows.slice(0, 5).map((bar) => finite(bar.volume)));
  const latestVolume = finite(latest.volume);
  const volumeDryUpRatio = Number.isFinite(avgVolume10) && Number.isFinite(avgVolume50) && avgVolume50 > 0 ? avgVolume10 / avgVolume50 : null;
  const latestVolumeRatio = Number.isFinite(latestVolume) && Number.isFinite(avgVolume50) && avgVolume50 > 0 ? latestVolume / avgVolume50 : null;
  const distanceToPivotPct = Number.isFinite(price) && Number.isFinite(pivotPrice) && pivotPrice > 0 ? ((price / pivotPrice) - 1) * 100 : null;
  const latestCloseLocationPct = closeLocation(latest);
  const dataGate = patternDataGate(rows, { ...options, rawBars: options.rawBars || bars });
  const context = consolidationContext(rows, { base, pivotPrice, price });
  const contractionResult = dataGate.patternEligible
    ? structuralContractions(rows, context)
    : { contractions: [], contractionStructureStatus: "data_blocked", contractionStructureReason: "pattern data gate blocked" };
  const contractions = contractionResult.contractions;
  const rejectedContraction = contractionResult.rejectedContraction || null;
  const measuredContractions = Array.isArray(contractionResult.measuredContractions) ? contractionResult.measuredContractions : contractions;
  const depths = contractions.map((item) => item.depthPct);
  const measuredDepths = measuredContractions.map((item) => item.depthPct).filter(Number.isFinite);
  const contractionCount = depths.filter(Number.isFinite).length;
  const contractionStructureOk = contractionResult.contractionStructureStatus === "ok";
  const contractionsDecreasing = contractionStructureOk && decreasingSequence(depths);
  const contractionReductionPct = depths.length >= 2 && Number.isFinite(depths[0]) && depths[0] > 0 ? ((depths[0] - depths.at(-1)) / depths[0]) * 100 : null;
  const lastContractionDepthPct = depths.at(-1) ?? null;
  const contractionScore = clamp(
    (contractionCount >= 3 ? 35 : contractionCount === 2 ? 22 : contractionCount === 1 ? 8 : 0)
    + (contractionsDecreasing ? 28 : 0)
    + (Number.isFinite(lastContractionDepthPct) ? clamp((12 - lastContractionDepthPct) * 2.2, 0, 22) : 0)
    + (Number.isFinite(contractionReductionPct) ? clamp(contractionReductionPct * .25, 0, 15) : 0)
  );
  const tightness5dPct = tightnessPct(rows, 5);
  const tightness10dPct = tightnessPct(rows, 10);
  const tightness15dPct = tightnessPct(rows, 15);
  const tightness20dPct = tightnessPct(rows, 20);
  const tightnessScore = clamp(
    (Number.isFinite(tightness5dPct) ? clamp((10 - tightness5dPct) * 4, 0, 34) : 0)
    + (Number.isFinite(tightness10dPct) ? clamp((16 - tightness10dPct) * 2.2, 0, 30) : 0)
    + (Number.isFinite(tightness20dPct) ? clamp((24 - tightness20dPct) * 1.5, 0, 24) : 0)
    + (Number.isFinite(base.depthPct) && base.depthPct <= 35 ? 12 : 0)
  );
  const highsSpreadPct = Number.isFinite(pivotPrice) && Number.isFinite(rangeStats(rows.slice(0, 20)).high) ? Math.abs((rangeStats(rows.slice(0, 20)).high / pivotPrice) - 1) * 100 : null;
  const pivot = pivotClarity({ rows, pivotPrice, distanceToPivotPct, highsSpreadPct });
  const volumeDryUpScore = Number.isFinite(volumeDryUpRatio) ? clamp((1.05 - volumeDryUpRatio) * 120, 0, 100) : null;
  const baseQualityScore = clamp(
    (Number.isFinite(base.depthPct) ? clamp((42 - base.depthPct) * 1.7, 0, 44) : 0)
    + (baseRows.length >= 25 ? 18 : baseRows.length >= 15 ? 10 : 0)
    + (tightnessScore * .22)
    + (contractionScore * .16)
    + ((context.baseContextScore ?? 0) * .18)
  );
  const patternQualityScore = dataGate.patternEligible ? context.consolidationCandidate ? clamp(
    contractionScore * .28
    + tightnessScore * .2
    + (pivot.pivotClarityScore ?? 0) * .2
    + (volumeDryUpScore ?? 45) * .13
    + baseQualityScore * .13
    + (context.baseContextScore ?? 0) * .06
  ) : 0 : null;
  const contractionsTighten = contractionsDecreasing && contractionCount >= 3;
  const vcpCandidate = Boolean(dataGate.patternEligible && context.consolidationCandidate && contractionsTighten && Number.isFinite(volumeDryUpRatio) && volumeDryUpRatio <= 0.85 && Number.isFinite(base.depthPct) && base.depthPct <= 35);
  const nearPivot = Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= -5 && distanceToPivotPct <= 3;
  const tightAroundPivot = context.rightSideTight || Number.isFinite(tightness10dPct) && tightness10dPct <= (context.atr20Pct ?? 3) * 2.4;
  const pivotSqueezeEvidence = contractionCount >= 2 && contractionsDecreasing
    || context.baseNearPivotDays >= 12 && pivot.pivotTouchCount >= 2 && Number.isFinite(tightness10dPct) && tightness10dPct <= 8;
  const pivotSqueeze = Boolean(dataGate.patternEligible
    && context.consolidationCandidate
    && nearPivot
    && tightAroundPivot
    && pivotSqueezeEvidence
    && Number.isFinite(base.depthPct)
    && base.depthPct <= 32
    && (pivot.pivotClarityScore ?? 0) >= 55
    && Number.isFinite(volumeDryUpRatio)
    && volumeDryUpRatio <= 1.15);
  const breakoutQualityScore = clamp(
    (Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= 0 && distanceToPivotPct <= 5 ? 32 : 0)
    + (Number.isFinite(latestVolumeRatio) ? clamp((latestVolumeRatio - 1) * 35, 0, 28) : 0)
    + (Number.isFinite(latestCloseLocationPct) ? clamp((latestCloseLocationPct - 50) * 0.5, 0, 20) : 0)
    + (vcpCandidate ? 20 : 0)
  );
  const breakoutAttempt = Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= 0 && Number.isFinite(latestVolumeRatio) && latestVolumeRatio >= 1.25;
  const recentlyAbovePivot = Number.isFinite(pivotPrice) && rows.slice(0, 10).some((bar) => (finite(bar.high) ?? finite(bar.close)) > pivotPrice);
  const failedBreakout = Boolean(recentlyAbovePivot && Number.isFinite(price) && Number.isFinite(pivotPrice) && price < pivotPrice && Number.isFinite(latestVolumeRatio) && latestVolumeRatio >= 1.1);
  const patternFamily = !dataGate.patternEligible ? "insufficient_data"
    : !context.consolidationCandidate ? "trend_no_base"
      : failedBreakout ? "failed_breakout"
        : breakoutAttempt ? "breakout_observed"
          : vcpCandidate || contractionsTighten ? "progressive_contraction"
            : pivotSqueeze ? "pivot_squeeze"
            : Number.isFinite(base.depthPct) && base.depthPct <= 22 && Number.isFinite(tightness10dPct) && tightness10dPct <= 10 ? "tight_base"
              : Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= -5 && distanceToPivotPct <= 3 ? "pivot_zone"
                : "base_structure";
  const patternMaturity = !dataGate.patternEligible ? "unavailable"
    : !context.consolidationCandidate ? "not_consolidating"
      : failedBreakout ? "failed"
        : breakoutAttempt ? "breakout_attempt"
          : pivotSqueeze ? "pivot_squeeze"
            : Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= -5 && distanceToPivotPct <= 3 ? "pivot_zone"
            : "forming";
  const result = {
    patternTimeframe: "D",
    patternFamily,
    patternMaturity,
    patternQualityScore,
    contractionScore,
    tightnessScore,
    pivotClarityScore: pivot.pivotClarityScore,
    pivotTouchCount: pivot.pivotTouchCount,
    volumeDryUpScore,
    baseQualityScore,
    ...dataGate,
    pivotPrice,
    distanceToPivotPct,
    absDistanceToPivotPct: Number.isFinite(distanceToPivotPct) ? Math.abs(distanceToPivotPct) : null,
    baseDepthPct: base.depthPct,
    baseDays: baseRows.length,
    baseWeeks: baseRows.length ? baseRows.length / 5 : null,
    ...context,
    volumeDryUpRatio,
    latestVolumeRatio,
    latestCloseLocationPct,
    contractionDepths: depths,
    contraction1DepthPct: depths[0] ?? null,
    contraction2DepthPct: depths[1] ?? null,
    contraction3DepthPct: depths[2] ?? null,
    contraction4DepthPct: depths[3] ?? null,
    measuredContractionDepths: measuredDepths,
    lastContractionDepthPct,
    rejectedContractionDepthPct: rejectedContraction?.depthPct ?? null,
    contractionReductionPct,
    contractionCount,
    contractionsDecreasing,
    contractionStructureStatus: contractionResult.contractionStructureStatus,
    contractionStructureReason: contractionResult.contractionStructureReason,
    contractionSwings: contractions,
    measuredContractionSwings: measuredContractions,
    rejectedContractionSwing: rejectedContraction,
    tightness5dPct,
    tightness10dPct,
    tightness15dPct,
    tightness20dPct,
    pivotSqueeze,
    vcpCandidate,
    breakoutAttempt,
    breakoutQualityScore,
    failedBreakout,
    avgVolume5,
    avgVolume10,
    avgVolume50,
    ...weeklyStructure(rows),
  };
  const structure = setupStructureForRow(result);
  const rowWithStructure = { ...result, setupStructureKey: structure.key, setupStructureStrict: structure.strict, setupStructureReason: structure.reason };
  const verdict = methodologyVerdictForRow(rowWithStructure);
  const display = methodologyDisplayForRow({ ...rowWithStructure, ...{
    setupVerdictKey: verdict.key,
    setupVerdictState: verdict.state,
    setupVerdictLabel: verdict.label,
    setupVerdictShortLabel: verdict.shortLabel,
    setupVerdictReason: verdict.reason,
  } });
  const blocked = display.blocksPatternClaim === true || display.dataLimited === true;
  return {
    ...result,
    setupStructureKey: structure.key,
    setupStructureLabel: structure.label,
    setupStructureReason: structure.reason,
    setupStructureEvidence: structure.evidence,
    setupStructureTone: structure.tone,
    setupStructureStrict: structure.strict,
    setupStructureDataLabel: structure.dataLabel,
    setupVerdictKey: verdict.key,
    setupVerdictState: verdict.state,
    setupVerdictLabel: verdict.label,
    setupVerdictShortLabel: verdict.shortLabel,
    setupVerdictReason: verdict.reason,
    setupVerdictEvidence: verdict.evidence,
    setupVerdictTone: verdict.tone,
    setupDataConfidenceKey: verdict.dataConfidence?.key,
    setupDataConfidenceLabel: verdict.dataConfidence?.label,
    setupPlanValid: !blocked && display.actionable === true && display.tradePlanEligible === true,
    setupActionable: !blocked && display.actionable === true,
    setupObservable: !blocked && display.observable === true,
    setupWatch: !blocked && display.watch === true,
    setupStrict: !blocked && display.strict === true,
    ...displaySnapshotFields(display),
  };
}
