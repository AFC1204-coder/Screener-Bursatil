import assert from "node:assert/strict";
import { groupRows } from "../lib/grouping.js";
import { sanitizeMaterializedLeaderboardItem } from "../lib/leaderboards.js";
import { methodologyCompactReasonLine, methodologyDisplayForRow, methodologyEvidenceLine, methodologyPatternEvidenceBonus, methodologyPatternEvidenceUsable, methodologyPivotWatchEligible, methodologySetupLabel, methodologyTradePlanEligible, methodologyWatchEligible } from "../lib/methodologyDisplay.js";
import { compactMethodologySnapshot, enrichRowsWithMethodology, setupTagsForRow } from "../lib/methodologyEngine.js";
import { methodologyVerdictForRow } from "../lib/methodologyVerdict.js";
import { latestScanStateFromRow } from "../lib/materializedScanner.js";
import { setupStructureForRow, strictVcpRejectReason, technicalConfidenceForPattern } from "../lib/patternNarrative.js";
import { screenerFilterRejectReason } from "../lib/screenerFilters.js";
import { setupPatternForBars } from "../lib/setupPatterns.js";
import { computeTradePlan, tradePlanEligibility } from "../lib/tradePlan.js";
import { vcpObjectiveSummary } from "../lib/vcpDiagnostics.js";

const dayMs = 86400000;
const startMs = Date.now() - 179 * dayMs;

function bar(index, close, volume = 1_000_000, range = 0.012) {
  const date = new Date(startMs + index * dayMs).toISOString().slice(0, 10);
  return {
    date,
    open: close * 0.995,
    high: close * (1 + range),
    low: close * (1 - range),
    close,
    volume,
  };
}

function preciseBar(index, close, high = close, low = close, volume = 1_000_000) {
  const date = new Date(startMs + index * dayMs).toISOString().slice(0, 10);
  return {
    date,
    open: close,
    high,
    low,
    close,
    volume,
  };
}

function interpolate(a, b, t) {
  return a + (b - a) * t;
}

function solidUptrendWithMicroPullbacks() {
  const rows = [];
  for (let i = 0; i < 180; i++) {
    const trend = 50 + i * 0.42;
    const wave = Math.sin(i / 4) * 2.2;
    rows.push(bar(i, trend + wave, 1_000_000 + i * 1_000));
  }
  return rows;
}

function persistentAdvanceWithTwoShallowDips() {
  const rows = [];
  for (let i = 0; i < 180; i++) {
    const trend = 42 + i * 0.48;
    const firstDip = i >= 116 && i <= 123 ? -Math.sin(((i - 116) / 7) * Math.PI) * 4.2 : 0;
    const secondDip = i >= 150 && i <= 157 ? -Math.sin(((i - 150) / 7) * Math.PI) * 5.2 : 0;
    const wave = Math.sin(i / 9) * 0.3;
    rows.push(bar(i, trend + firstDip + secondDip + wave, 1_000_000 + i * 1_000, 0.009));
  }
  return rows;
}

function progressiveContractionBase() {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(bar(i, 45 + i * 0.45, 1_300_000));
  for (let i = 100; i < 180; i++) {
    let close;
    if (i < 115) close = 90 - ((i - 100) / 15) * 20;
    else if (i < 130) close = 70 + ((i - 115) / 15) * 18;
    else if (i < 144) close = 88 - ((i - 130) / 14) * 12;
    else if (i < 158) close = 76 + ((i - 144) / 14) * 10;
    else if (i < 168) close = 86 - ((i - 158) / 10) * 5;
    else close = 81 + ((i - 168) / 12) * 5;
    rows.push(bar(i, close, i > 145 ? 650_000 : 950_000));
  }
  return rows;
}

function sparseOhlcProgressiveBase() {
  return progressiveContractionBase().map((item, index) => {
    if (index < 105 || index % 3 !== 0) return item;
    const next = { ...item };
    delete next.high;
    return next;
  });
}

function marginalHighBreakThenPivotSqueeze() {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(bar(i, 40 + i * 0.42, 1_250_000));
  for (let i = 100; i < 180; i++) {
    let close;
    if (i < 114) close = 82 - ((i - 100) / 14) * 16;
    else if (i < 130) close = 66 + ((i - 114) / 16) * 17;
    else if (i < 145) close = 83 - ((i - 130) / 15) * 9;
    else if (i < 158) close = 74 + ((i - 145) / 13) * 12;
    else if (i < 166) close = 86 + ((i - 158) / 8) * 2.8;
    else if (i < 173) close = 88.8 - ((i - 166) / 7) * 3.1;
    else close = 85.7 + ((i - 173) / 7) * 2.2;
    rows.push(bar(i, close, i > 155 ? 620_000 : 900_000, i > 160 ? 0.006 : 0.011));
  }
  return rows;
}

function expandingContractionsBase() {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(bar(i, 45 + i * 0.45, 1_300_000));
  for (let i = 100; i < 180; i++) {
    let close;
    if (i < 114) close = 90 - ((i - 100) / 14) * 12;
    else if (i < 128) close = 78 + ((i - 114) / 14) * 11;
    else if (i < 143) close = 89 - ((i - 128) / 15) * 16;
    else if (i < 158) close = 73 + ((i - 143) / 15) * 15;
    else if (i < 174) close = 88 - ((i - 158) / 16) * 22;
    else close = 66 + ((i - 174) / 6) * 18;
    rows.push(bar(i, close, i > 145 ? 700_000 : 950_000));
  }
  return rows;
}

function lowerLowCompressionTrap() {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(bar(i, 45 + i * 0.45, 1_300_000));
  for (let i = 100; i < 180; i++) {
    let close;
    if (i < 114) close = 96 - ((i - 100) / 14) * 16;
    else if (i < 128) close = 80 + ((i - 114) / 14) * 12;
    else if (i < 142) close = 92 - ((i - 128) / 14) * 12.3;
    else if (i < 156) close = 79.7 + ((i - 142) / 14) * 8.7;
    else if (i < 168) close = 88.4 - ((i - 156) / 12) * 9;
    else close = 79.4 + ((i - 168) / 12) * 16.6;
    rows.push(bar(i, close, i > 145 ? 650_000 : 950_000, i > 160 ? 0.007 : 0.011));
  }
  return rows;
}

function controlledContractionDepthBase() {
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const close = 55 + i * 0.32;
    rows.push(preciseBar(i, close, close + 0.5, close - 0.5, 1_400_000));
  }
  const pivots = [
    [100, 94, 96, 92],
    [104, 98, 100, 96],
    [112, 81, 83, 80],
    [121, 95, 98, 93],
    [130, 89, 91, 88.2],
    [139, 96, 97, 94],
    [148, 93, 94, 92.15],
    [158, 96, 98, 94],
    [168, 95, 97, 93.5],
    [179, 96, 98, 95],
  ];
  for (let segment = 0; segment < pivots.length - 1; segment++) {
    const [startIndex, startClose, startHigh, startLow] = pivots[segment];
    const [endIndex, endClose, endHigh, endLow] = pivots[segment + 1];
    for (let i = startIndex; i < endIndex; i++) {
      if (i === startIndex) {
        rows.push(preciseBar(i, startClose, startHigh, startLow, segment >= 3 ? 650_000 : 950_000));
        continue;
      }
      const t = (i - startIndex) / (endIndex - startIndex);
      const close = interpolate(startClose, endClose, t);
      const high = Math.max(close, interpolate(startHigh, endHigh, t));
      const low = Math.min(close, interpolate(startLow, endLow, t));
      rows.push(preciseBar(i, close, high, low, segment >= 3 ? 650_000 : 950_000));
    }
  }
  const [lastIndex, lastClose, lastHigh, lastLow] = pivots.at(-1);
  rows.push(preciseBar(lastIndex, lastClose, lastHigh, lastLow, 620_000));
  return rows;
}

function assertNear(actual, expected, label, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

const trend = setupPatternForBars(solidUptrendWithMicroPullbacks());
assert.equal(trend.patternDataStatus, "ok");
assert.equal(trend.consolidationCandidate, false);
assert.equal(trend.patternFamily, "trend_no_base");
assert.equal(trend.contractionCount, 0);
assert.deepEqual(trend.contractionDepths, []);
assert.equal(trend.patternQualityScore, 0);
assert.ok(trend.baseContextScore < 45);
assert.equal(setupStructureForRow(trend).key, "trend_no_base");
assert.equal(methodologyVerdictForRow(trend).key, "no_base");
assert.equal(methodologyVerdictForRow(trend).actionable, false);
assert.equal(methodologyDisplayForRow(trend).label, "Sin base validada");
assert.equal(methodologySetupLabel(trend), "Sin base");
assert.equal(methodologyWatchEligible(trend), false);

const twoDipAdvance = setupPatternForBars(persistentAdvanceWithTwoShallowDips());
assert.equal(twoDipAdvance.patternDataStatus, "ok");
assert.equal(twoDipAdvance.baseContextStatus, "persistent_advance");
assert.equal(twoDipAdvance.consolidationCandidate, false);
assert.equal(twoDipAdvance.patternFamily, "trend_no_base");
assert.equal(twoDipAdvance.contractionCount, 0);
assert.deepEqual(twoDipAdvance.contractionDepths, []);
assert.equal(twoDipAdvance.vcpCandidate, false);
assert.equal(twoDipAdvance.pivotSqueeze, false);
assert.equal(setupStructureForRow(twoDipAdvance).key, "trend_no_base");
assert.equal(methodologyVerdictForRow(twoDipAdvance).key, "no_base");
assert.equal(methodologyWatchEligible(twoDipAdvance), false);
assert.equal(methodologyTradePlanEligible(twoDipAdvance), false);
assert.equal(methodologyPivotWatchEligible(twoDipAdvance), false);

const base = setupPatternForBars(progressiveContractionBase());
assert.equal(base.patternDataStatus, "ok");
assert.equal(base.patternBarsCount, 180);
assert.equal(base.patternMinBars, 90);
assert.equal(base.patternCoveragePct, 100);
assert.equal(base.consolidationCandidate, true);
assert.equal(base.patternFamily, "progressive_contraction");
assert.equal(base.contractionCount, 3);
assert.equal(base.contractionsDecreasing, true);
assert.ok(base.contraction1DepthPct > 20 && base.contraction1DepthPct < 27);
assert.ok(base.contraction2DepthPct > 12 && base.contraction2DepthPct < 18);
assert.ok(base.contraction3DepthPct > 6 && base.contraction3DepthPct < 10);
assert.ok(base.patternQualityScore >= 60);
assert.ok(["vcp_strict", "vcp_watch"].includes(setupStructureForRow(base).key));
assert.equal(["actionable_vcp", "strict_not_actionable", "vcp_watch"].includes(methodologyVerdictForRow(base).key), true);
assert.equal(["VCP plan válido", "VCP estricto sin plan", "Base en vigilancia"].includes(methodologyDisplayForRow(base).label), true);

const exactDepthBase = setupPatternForBars(controlledContractionDepthBase());
assert.equal(exactDepthBase.patternDataStatus, "ok");
assert.equal(exactDepthBase.consolidationCandidate, true);
assert.equal(exactDepthBase.contractionStructureStatus, "ok");
assert.equal(exactDepthBase.contractionCount, 4);
[
  { high: 100, low: 80, depth: 20 },
  { high: 98, low: 88.2, depth: 10 },
  { high: 97, low: 92.15, depth: 5 },
  { high: 98, low: 93.5, depth: (98 - 93.5) / 98 * 100 },
].forEach((expected, index) => {
  const swing = exactDepthBase.contractionSwings[index];
  assert.equal(swing.high, expected.high, `C${index + 1} high should come from the local pivot high`);
  assert.equal(swing.low, expected.low, `C${index + 1} low should come from the following local pivot low`);
  assertNear(swing.depthPct, expected.depth, `C${index + 1} depth`);
  assertNear(exactDepthBase.contractionDepths[index], expected.depth, `C${index + 1} stored depth`);
});
assert.deepEqual(exactDepthBase.contractionDepths.map((value) => Number(value.toFixed(1))), [20, 10, 5, 4.6]);

const shortHistory = setupPatternForBars(progressiveContractionBase().slice(-70));
assert.equal(shortHistory.patternDataStatus, "insufficient_history");
assert.equal(shortHistory.patternEligible, false);
assert.equal(shortHistory.patternBarsCount, 70);
assert.equal(shortHistory.patternMinBars, 90);
assert.equal(shortHistory.contractionCount, 0);
const shortHistoryObjective = vcpObjectiveSummary(shortHistory);
assert.equal(shortHistoryObjective.history.state, "fail");
assert.match(shortHistoryObjective.primary, /Hist\. 70\/90 barras · comp\. s\/d/);
assert.match(shortHistoryObjective.secondary, /Histórico insuficiente/);

const sparseOhlc = setupPatternForBars(sparseOhlcProgressiveBase());
assert.equal(sparseOhlc.patternDataStatus, "sparse_ohlc");
assert.equal(sparseOhlc.patternEligible, false);
assert.ok(sparseOhlc.patternOhlcCoveragePct < 95);
assert.equal(sparseOhlc.contractionStructureStatus, "data_blocked");
assert.equal(sparseOhlc.contractionCount, 0);
assert.equal(setupStructureForRow(sparseOhlc).key, "data");
assert.equal(methodologyVerdictForRow(sparseOhlc).state, "data");
assert.equal(methodologyWatchEligible(sparseOhlc), false);
assert.equal(methodologyTradePlanEligible(sparseOhlc), false);
assert.equal(screenerFilterRejectReason(sparseOhlc, { minContractionCount: 2 })?.field, "patternDataStatus");
const sparseOhlcObjective = vcpObjectiveSummary({ ...sparseOhlc, distanceToPivotPct: null, volumeDryUpRatio: null });
assert.match(sparseOhlcObjective.detail, /OHLC incompleto/);
assert.doesNotMatch(sparseOhlcObjective.detail, /pivot 0\.0%|vol 0\.00x/);

const missingVolumeBase = setupPatternForBars(progressiveContractionBase().map((item, index) => {
  if (index < 130) return item;
  return { ...item, volume: null };
}));
assert.equal(missingVolumeBase.patternDataStatus, "partial_volume");
assert.equal(missingVolumeBase.patternEligible, true);
assert.equal(missingVolumeBase.patternVolumeEligible, false);
assert.ok(missingVolumeBase.patternVolumeCoveragePct < 80);
assert.equal(missingVolumeBase.volumeDryUpRatio, null);
assert.equal(screenerFilterRejectReason(missingVolumeBase, { maxVolumeDryUpRatio: 0.9 })?.field, "patternDataStatus");
assert.equal(Boolean(screenerFilterRejectReason(missingVolumeBase, { minContractionCount: 2 })), false);

const blankStringVolumeBase = setupPatternForBars(progressiveContractionBase().map((item, index) => {
  if (index < 130) return item;
  return { ...item, volume: "   " };
}));
assert.equal(blankStringVolumeBase.patternDataStatus, "partial_volume");
assert.equal(blankStringVolumeBase.patternEligible, true);
assert.equal(blankStringVolumeBase.patternVolumeEligible, false);
assert.ok(blankStringVolumeBase.patternVolumeCoveragePct < 80);
assert.equal(blankStringVolumeBase.volumeDryUpRatio, null);
assert.equal(screenerFilterRejectReason(blankStringVolumeBase, { maxVolumeDryUpRatio: 0.9 })?.field, "patternDataStatus");

const squeeze = setupPatternForBars(marginalHighBreakThenPivotSqueeze());
assert.equal(squeeze.patternDataStatus, "ok");
assert.equal(squeeze.consolidationCandidate, true);
assert.notEqual(squeeze.patternFamily, "trend_no_base");
assert.equal(squeeze.pivotSqueeze, true);
assert.ok(["progressive_contraction", "pivot_squeeze"].includes(squeeze.patternFamily));
assert.ok(["vcp_strict", "vcp_watch", "pivot_squeeze"].includes(setupStructureForRow(squeeze).key));
assert.ok(squeeze.marginalHighBreaks >= 0);
assert.ok(squeeze.lateBaseDepthPct < squeeze.middleBaseDepthPct);
assert.ok(squeeze.distanceToPivotPct >= -5 && squeeze.distanceToPivotPct <= 3);
assert.equal(methodologyDisplayForRow(squeeze).watch || methodologyDisplayForRow(squeeze).strict || methodologyDisplayForRow(squeeze).actionable, true);

const irregularNearPivot = {
  patternDataStatus: "ok",
  patternEligible: true,
  consolidationCandidate: true,
  patternFamily: "base_structure",
  patternQualityScore: 72,
  baseDepthPct: 22,
  distanceToPivotPct: -1.8,
  pivotClarityScore: 80,
  tightness10dPct: 5,
  volumeDryUpRatio: .65,
  contractionCount: 3,
  contractionsDecreasing: false,
  contractionDepths: [12, 6, 9],
  contraction1DepthPct: 12,
  contraction2DepthPct: 6,
  contraction3DepthPct: 9,
  lastContractionDepthPct: 9,
};
assert.equal(setupStructureForRow(irregularNearPivot).key, "not_vcp");
assert.equal(methodologyVerdictForRow(irregularNearPivot).state, "blocked");
assert.equal(methodologyVerdictForRow(irregularNearPivot).watch, false);
assert.equal(methodologyDisplayForRow(irregularNearPivot).watch, false);
assert.equal(methodologyWatchEligible(irregularNearPivot), false);
assert.equal(methodologyPivotWatchEligible(irregularNearPivot), false);
assert.notEqual(methodologySetupLabel(irregularNearPivot), "Pivot estimado");
assert.equal(methodologyCompactReasonLine(irregularNearPivot), "re-expansión final");

const weakConstructiveBase = {
  patternDataStatus: "ok",
  patternEligible: true,
  consolidationCandidate: true,
  patternFamily: "base_structure",
  patternQualityScore: 35,
  baseDepthPct: 18,
  distanceToPivotPct: -11,
  tightness10dPct: 9,
  volumeDryUpRatio: 1.05,
  contractionCount: 1,
  contractionsDecreasing: false,
  contractionDepths: [4.2],
  contraction1DepthPct: 4.2,
  lastContractionDepthPct: 4.2,
};
assert.equal(setupStructureForRow(weakConstructiveBase).key, "constructive_base");
assert.equal(methodologyVerdictForRow(weakConstructiveBase).key, "not_actionable");
assert.equal(methodologyVerdictForRow(weakConstructiveBase).label, "Base no confirmada");
assert.equal(methodologyVerdictForRow(weakConstructiveBase).watch, false);
assert.equal(methodologyDisplayForRow(weakConstructiveBase).label, "Base no confirmada");
assert.equal(methodologyDisplayForRow(weakConstructiveBase).watch, false);

const weakSingleContractionSqueeze = {
  patternDataStatus: "ok",
  patternEligible: true,
  consolidationCandidate: true,
  patternFamily: "pivot_squeeze",
  pivotSqueeze: true,
  patternQualityScore: 78,
  baseDepthPct: 20,
  distanceToPivotPct: -1,
  pivotClarityScore: 82,
  tightness10dPct: 4,
  rightSideTight: true,
  volumeDryUpRatio: .7,
  contractionCount: 1,
  contractionsDecreasing: true,
  contractionDepths: [5],
  contraction1DepthPct: 5,
  lastContractionDepthPct: 5,
};
assert.equal(setupStructureForRow(weakSingleContractionSqueeze).key, "constructive_base");
assert.equal(methodologyVerdictForRow(weakSingleContractionSqueeze).watch, false);

const cleanTwoContractionSqueeze = {
  ...weakSingleContractionSqueeze,
  contractionCount: 2,
  contractionDepths: [12, 5],
  contraction1DepthPct: 12,
  contraction2DepthPct: 5,
  lastContractionDepthPct: 5,
};
assert.equal(setupStructureForRow(cleanTwoContractionSqueeze).key, "pivot_squeeze");
assert.equal(methodologyVerdictForRow(cleanTwoContractionSqueeze).key, "pivot_squeeze");
assert.notEqual(methodologyVerdictForRow(cleanTwoContractionSqueeze).key, "vcp_watch");
assert.equal(methodologyVerdictForRow(cleanTwoContractionSqueeze).watch, true);
assert.equal(methodologyDisplayForRow(cleanTwoContractionSqueeze).label, "Compresión de pivot");
assert.equal(methodologyWatchEligible(cleanTwoContractionSqueeze), true);

const missingPivotSqueeze = {
  ...cleanTwoContractionSqueeze,
  pivotPrice: null,
  distanceToPivotPct: null,
  absDistanceToPivotPct: null,
};
assert.notEqual(methodologyVerdictForRow(missingPivotSqueeze).key, "pivot_squeeze");
assert.equal(methodologyVerdictForRow(missingPivotSqueeze).watch, false);
assert.equal(methodologyPivotWatchEligible(missingPivotSqueeze), false);

const blankStringMetricsSqueeze = {
  ...cleanTwoContractionSqueeze,
  distanceToPivotPct: "   ",
  absDistanceToPivotPct: "   ",
  volumeDryUpRatio: "   ",
};
assert.notEqual(setupStructureForRow(blankStringMetricsSqueeze).key, "pivot_squeeze");
assert.notEqual(methodologyVerdictForRow(blankStringMetricsSqueeze).key, "pivot_squeeze");
assert.equal(methodologyVerdictForRow(blankStringMetricsSqueeze).watch, false);
assert.equal(methodologyPivotWatchEligible(blankStringMetricsSqueeze), false);
const blankStringMetricsObjective = vcpObjectiveSummary(blankStringMetricsSqueeze);
assert.match(blankStringMetricsObjective.secondary, /pivot sin dato/i);
assert.match(blankStringMetricsObjective.secondary, /vol sin dato/i);
assert.doesNotMatch(blankStringMetricsObjective.secondary, /pivot \+?0\.0%|vol 0\.00x/);

const usefulTwoContractionBase = {
  patternDataStatus: "ok",
  patternEligible: true,
  consolidationCandidate: true,
  patternFamily: "base_structure",
  patternQualityScore: 72,
  baseDepthPct: 18,
  distanceToPivotPct: -7,
  tightness10dPct: 9,
  volumeDryUpRatio: .72,
  contractionCount: 2,
  contractionsDecreasing: true,
  contractionDepths: [14, 6],
  contraction1DepthPct: 14,
  contraction2DepthPct: 6,
  lastContractionDepthPct: 6,
};
assert.equal(setupStructureForRow(usefulTwoContractionBase).key, "constructive_base");
assert.equal(methodologyVerdictForRow(usefulTwoContractionBase).key, "constructive_base");
assert.equal(methodologyVerdictForRow(usefulTwoContractionBase).label, "Base constructiva");
assert.notEqual(methodologyVerdictForRow(usefulTwoContractionBase).key, "vcp_watch");
assert.equal(methodologyVerdictForRow(usefulTwoContractionBase).watch, true);
assert.equal(methodologySetupLabel(usefulTwoContractionBase), "Base constructiva");

const storedLegacyConstructiveBase = {
  ...usefulTwoContractionBase,
  setupDisplayKey: "constructive_base",
  setupDisplayState: "watch",
  setupDisplayLabel: "Base en vigilancia",
  setupDisplayShortLabel: "Base en vigilancia",
  setupDisplayWatch: true,
};
assert.equal(methodologyDisplayForRow(storedLegacyConstructiveBase).key, "constructive_base");
assert.equal(methodologyDisplayForRow(storedLegacyConstructiveBase).label, "Base constructiva");
assert.equal(methodologySetupLabel(storedLegacyConstructiveBase), "Base constructiva");
assert.notEqual(methodologyDisplayForRow(storedLegacyConstructiveBase).label, "Base en vigilancia");

const farMeasuredBase = {
  ...usefulTwoContractionBase,
  distanceToPivotPct: -16,
};
assert.equal(setupStructureForRow(farMeasuredBase).key, "constructive_base");
assert.equal(methodologyVerdictForRow(farMeasuredBase).key, "base_measurable");
assert.equal(methodologyVerdictForRow(farMeasuredBase).label, "Base medible");
assert.equal(methodologyVerdictForRow(farMeasuredBase).observable, true);
assert.equal(methodologyVerdictForRow(farMeasuredBase).watch, false);
assert.equal(methodologyDisplayForRow(farMeasuredBase).label, "Base medible");
assert.equal(methodologyDisplayForRow(farMeasuredBase).watch, false);

const farProgressiveBase = {
  ...usefulTwoContractionBase,
  patternFamily: "progressive_contraction",
  distanceToPivotPct: -13,
  contractionCount: 3,
  contractionDepths: [18, 10, 5],
  contraction1DepthPct: 18,
  contraction2DepthPct: 10,
  contraction3DepthPct: 5,
  lastContractionDepthPct: 5,
};
assert.equal(setupStructureForRow(farProgressiveBase).key, "vcp_watch");
assert.equal(methodologyVerdictForRow(farProgressiveBase).key, "base_measurable");
assert.equal(methodologyVerdictForRow(farProgressiveBase).watch, false);
assert.equal(methodologyDisplayForRow(farProgressiveBase).label, "Base medible");
assert.equal(methodologyWatchEligible(farProgressiveBase), false);

const wetProgressiveBase = {
  patternDataStatus: "ok",
  patternEligible: true,
  consolidationCandidate: true,
  patternFamily: "progressive_contraction",
  patternQualityScore: 82,
  baseDepthPct: 22,
  distanceToPivotPct: -4,
  absDistanceToPivotPct: 4,
  pivotClarityScore: 75,
  tightness10dPct: 7,
  volumeDryUpRatio: 1.25,
  contractionCount: 3,
  contractionsDecreasing: true,
  contractionDepths: [18, 10, 5],
  contraction1DepthPct: 18,
  contraction2DepthPct: 10,
  contraction3DepthPct: 5,
  lastContractionDepthPct: 5,
};
assert.equal(setupStructureForRow(wetProgressiveBase).key, "constructive_base");
assert.equal(methodologyVerdictForRow(wetProgressiveBase).key, "not_actionable");
assert.equal(methodologyVerdictForRow(wetProgressiveBase).label, "Base no confirmada");
assert.equal(methodologyVerdictForRow(wetProgressiveBase).watch, false);
assert.equal(methodologyDisplayForRow(wetProgressiveBase).label, "Base no confirmada");
assert.equal(methodologyWatchEligible(wetProgressiveBase), false);

const expanding = setupPatternForBars(expandingContractionsBase());
assert.equal(expanding.patternDataStatus, "ok");
assert.equal(expanding.consolidationCandidate, true);
assert.notEqual(expanding.patternFamily, "progressive_contraction");
assert.equal(expanding.contractionCount, 1);
assert.ok(expanding.contraction1DepthPct > 24);
assert.equal(expanding.contractionsDecreasing, false);
assert.notEqual(setupStructureForRow(expanding).key, "vcp_strict");

const lowerLowTrap = setupPatternForBars(lowerLowCompressionTrap());
assert.equal(lowerLowTrap.patternDataStatus, "ok");
assert.equal(lowerLowTrap.consolidationCandidate, true);
assert.notEqual(lowerLowTrap.patternFamily, "progressive_contraction");
assert.equal(lowerLowTrap.contractionCount, 1);
assert.equal(lowerLowTrap.contractionDepths.length, 1);
assert.equal(lowerLowTrap.measuredContractionDepths.length, 2);
assert.equal(Number.isFinite(lowerLowTrap.rejectedContractionDepthPct), true);
assert.equal(lowerLowTrap.contractionsDecreasing, false);
assert.equal(lowerLowTrap.contractionStructureStatus, "lower_low_drift");
assert.equal(lowerLowTrap.vcpCandidate, false);
assert.equal(lowerLowTrap.pivotSqueeze, false);
assert.equal(setupStructureForRow(lowerLowTrap).key, "not_vcp");
assert.equal(methodologyVerdictForRow(lowerLowTrap).key, "not_actionable");
assert.notEqual(setupStructureForRow(lowerLowTrap).key, "vcp_watch");
assert.equal(methodologyWatchEligible(lowerLowTrap), false);
assert.equal(methodologyPivotWatchEligible(lowerLowTrap), false);
assert.equal(screenerFilterRejectReason(lowerLowTrap, { minContractionCount: 2 })?.field, "contractionStructureStatus");
assert.match(screenerFilterRejectReason(lowerLowTrap, { minContractionCount: 2 })?.reason || "", /mínimos|base|estructura/i);
const lowerLowObjective = vcpObjectiveSummary(lowerLowTrap);
assert.equal(lowerLowObjective.count, 1);
assert.equal(lowerLowObjective.sequence, lowerLowTrap.contractionDepths.map((value) => `${value.toFixed(1)}%`).join(" -> "));
assert.match(lowerLowObjective.rejectedContractionText, /rechazada/i);
const legacyReexpansionObjective = vcpObjectiveSummary({
  contractionStructureStatus: "depth_reexpansion",
  contractionCount: 3,
  contractionDepths: [15.6, 5.2, 5.6],
  contractionsDecreasing: false,
});
assert.equal(legacyReexpansionObjective.count, 2);
assert.equal(legacyReexpansionObjective.sequence, "15.6% -> 5.2%");
assert.match(legacyReexpansionObjective.rejectedContractionText, /5\.6%/);

const progressiveFilter = {
  requireContractionsDecreasing: true,
  minContractionCount: 3,
  maxContraction1DepthPct: 25,
  maxContraction2DepthPct: 16,
  maxContraction3DepthPct: 8,
  maxLastContractionDepthPct: 8,
};
const cleanProgressiveRow = {
  price: 100,
  contractionCount: 3,
  contractionsDecreasing: true,
  contractionDepths: [24, 15, 7],
  contraction1DepthPct: 24,
  contraction2DepthPct: 15,
  contraction3DepthPct: 7,
  lastContractionDepthPct: 7,
};
assert.equal(screenerFilterRejectReason(cleanProgressiveRow, progressiveFilter), "");
assert.equal(strictVcpRejectReason({
  ...cleanProgressiveRow,
  patternDataStatus: "ok",
  patternEligible: true,
  consolidationCandidate: true,
  patternFamily: "progressive_contraction",
  baseDepthPct: 32,
  absDistanceToPivotPct: 4,
  distanceToPivotPct: -4,
  volumeDryUpRatio: .82,
  tightness10dPct: 9,
}), "");
const cleanActionableStrict = {
  ...cleanProgressiveRow,
  patternDataStatus: "ok",
  patternEligible: true,
  consolidationCandidate: true,
  patternFamily: "progressive_contraction",
  baseDepthPct: 32,
  absDistanceToPivotPct: 4,
  distanceToPivotPct: -4,
  volumeDryUpRatio: .82,
  tightness10dPct: 9,
  setupStructureKey: "vcp_strict",
  setupStructureStrict: true,
  patternQualityScore: 72,
  pivotPrice: 100,
};
assert.equal(tradePlanEligibility(cleanActionableStrict).actionable, true);
assert.equal(methodologyVerdictForRow(cleanActionableStrict).key, "actionable_vcp");
assert.equal(methodologyDisplayForRow(cleanActionableStrict).label, "VCP plan válido");
assert.equal(methodologySetupLabel(cleanActionableStrict), "Plan válido");
assert.equal(methodologyWatchEligible(cleanActionableStrict), true);
assert.equal(methodologyTradePlanEligible(cleanActionableStrict), true);
assert.equal(methodologyPivotWatchEligible(cleanActionableStrict), true);
assert.ok(methodologyEvidenceLine(cleanActionableStrict).includes("24.0% -> 15.0% -> 7.0%"));
assert.equal(methodologyCompactReasonLine(cleanActionableStrict), "compresión válida");
const cleanActionableObjective = vcpObjectiveSummary(cleanActionableStrict);
assert.equal(cleanActionableObjective.countText, "3 comp.");
assert.equal(cleanActionableObjective.sequence, "24.0% -> 15.0% -> 7.0%");
assert.ok(cleanActionableObjective.primary.includes("3 comp."));
assert.ok(cleanActionableObjective.secondary.includes("ultima 7.0%"));
assert.ok(cleanActionableObjective.secondary.includes("base 32.0%"));
assert.ok(cleanActionableObjective.secondary.includes("pivot -4.0%"));
const cleanActionableSnapshot = compactMethodologySnapshot(cleanActionableStrict);
assert.equal(cleanActionableSnapshot.setupDisplayKey, "actionable_vcp");
assert.equal(cleanActionableSnapshot.setupDisplayLabel, "VCP plan válido");
assert.equal(cleanActionableSnapshot.setupPlanValid, true);
assert.equal(cleanActionableSnapshot.setupDisplayPlanValid, true);
assert.equal(cleanActionableSnapshot.setupDisplayBlocksPatternClaim, false);
assert.equal(cleanActionableSnapshot.setupDisplayTradePlanEligible, true);
assert.equal(computeTradePlan(cleanActionableStrict).available, true);
const cleanActionableTags = setupTagsForRow({
  ...cleanActionableStrict,
  price: 108,
  sma50: 100,
  totalScore: 88,
  rsGlobalPct: 82,
  distance20d: -4,
  distance52w: -8,
  extSma50: 8,
  highsSpreadPct: 5,
}).map((tag) => tag.key);
assert.equal(cleanActionableTags.includes("near_pivot"), true);
assert.equal(cleanActionableTags.includes("pivot_zone"), true);
assert.equal(cleanActionableTags.includes("volume_dry_up"), true);

const storedLegacyActionableDisplay = {
  ...cleanActionableStrict,
  setupDisplayKey: "actionable_vcp",
  setupDisplayState: "actionable",
  setupDisplayLabel: "VCP accionable",
  setupDisplayShortLabel: "Accionable",
  setupDisplayActionable: true,
  setupDisplayTradePlanEligible: true,
  setupDisplayBlocksPatternClaim: false,
};
assert.equal(methodologyDisplayForRow(storedLegacyActionableDisplay).label, "VCP plan válido");
assert.equal(methodologySetupLabel(storedLegacyActionableDisplay), "Plan válido");

const staleStoredPlanDisplay = {
  ...cleanActionableStrict,
  patternQualityScore: 62,
  setupDisplayKey: "actionable_vcp",
  setupDisplayState: "actionable",
  setupDisplayLabel: "VCP accionable",
  setupDisplayShortLabel: "Accionable",
  setupDisplayActionable: true,
  setupDisplayTradePlanEligible: true,
  setupDisplayBlocksPatternClaim: false,
};
assert.notEqual(methodologyVerdictForRow(staleStoredPlanDisplay).key, "actionable_vcp");
assert.notEqual(methodologyDisplayForRow(staleStoredPlanDisplay).key, "actionable_vcp");
assert.notEqual(methodologyDisplayForRow(staleStoredPlanDisplay).label, "VCP plan válido");
assert.notEqual(methodologySetupLabel(staleStoredPlanDisplay), "Plan válido");
assert.equal(methodologyDisplayForRow(staleStoredPlanDisplay).actionable, false);
assert.equal(methodologyDisplayForRow(staleStoredPlanDisplay).tradePlanEligible, false);
assert.equal(methodologyTradePlanEligible(staleStoredPlanDisplay), false);

const staleSnapshotRow = {
  ...staleStoredPlanDisplay,
  symbol: "STALE",
  methodologyEvents: [
    { type: "setup_plan_valid", severity: "positive", label: "VCP plan valido observado", detail: "Evento legacy congelado." },
  ],
};
const refreshedSnapshotRow = enrichRowsWithMethodology([staleSnapshotRow], [])[0];
assert.equal(refreshedSnapshotRow.setupPlanValid, false);
assert.equal(refreshedSnapshotRow.setupActionable, false);
assert.equal(refreshedSnapshotRow.setupDisplayPlanValid, false);
assert.equal(refreshedSnapshotRow.setupDisplayActionable, false);
assert.notEqual(refreshedSnapshotRow.setupDisplayLabel, "VCP plan válido");
assert.equal(refreshedSnapshotRow.methodologyEvents.some((event) => event.type === "setup_plan_valid"), false);

const staleMaterializedLeaderboardItem = sanitizeMaterializedLeaderboardItem({
  rank_index: 1,
  symbol: "STALE",
  company_name: "Stale Cache Inc",
  score: 99,
  metrics: {
    ...staleStoredPlanDisplay,
    dataCoverageScore: 90,
    lastDate: new Date().toISOString().slice(0, 10),
    priceFreshnessDays: 0,
  },
}, { maxPriceFreshnessDays: 5 });
assert.equal(staleMaterializedLeaderboardItem.setupDisplayPlanValid, false);
assert.equal(staleMaterializedLeaderboardItem.setupDisplayActionable, false);
assert.notEqual(staleMaterializedLeaderboardItem.setupDisplayLabel, "VCP plan válido");
const staleRecentScanState = latestScanStateFromRow({
  symbol: "STALE",
  created_at: new Date().toISOString(),
  metrics: {
    ...staleStoredPlanDisplay,
    setupPlanValid: true,
    setupWatch: true,
    setupStrict: true,
    setupDisplayPlanValid: false,
    setupDisplayActionable: false,
    setupDisplayTradePlanEligible: false,
    setupDisplayWatch: false,
    setupDisplayStrict: false,
    setupDisplayBlocksPatternClaim: true,
    setupDisplayDataLimited: true,
    setupStructureKey: "vcp_strict",
  },
});
assert.equal(staleRecentScanState.planValid, false, "recent scan materialization state must let display false override legacy setupPlanValid true");
assert.equal(staleRecentScanState.watch, false, "recent scan materialization state must suppress watch when display blocks the claim");
assert.equal(staleRecentScanState.strict, false, "recent scan materialization state must suppress strict when display blocks the claim");
assert.equal(staleRecentScanState.patternCandidate, false, "recent scan materialization state must not keep blocked VCP candidates alive");

const staleDataUnblockedDisplayState = latestScanStateFromRow({
  symbol: "STALEDATA",
  created_at: new Date().toISOString(),
  metrics: {
    setupPlanValid: true,
    setupWatch: true,
    setupStrict: true,
    setupDisplayPlanValid: true,
    setupDisplayActionable: true,
    setupDisplayTradePlanEligible: true,
    setupDisplayWatch: true,
    setupDisplayStrict: true,
    setupDisplayBlocksPatternClaim: false,
    setupDisplayDataLimited: false,
    setupStructureKey: "vcp_strict",
    patternFamily: "progressive_contraction",
    patternDataStatus: "stale_price",
    patternEligible: false,
    setupQualityScore: 95,
  },
});
assert.equal(staleDataUnblockedDisplayState.planValid, false, "recent scan state must block plans when pattern data is stale even if stored display flags are positive");
assert.equal(staleDataUnblockedDisplayState.watch, false, "recent scan state must block watch when pattern data is stale even if stored display flags are positive");
assert.equal(staleDataUnblockedDisplayState.strict, false, "recent scan state must block strict when pattern data is stale even if stored display flags are positive");
assert.equal(staleDataUnblockedDisplayState.patternCandidate, false, "recent scan state must not keep pattern candidates alive with stale pattern data");
assert.equal(staleDataUnblockedDisplayState.qualityScore, null, "recent scan state must not reward setup quality from blocked pattern data");

const invalidStructureUnblockedDisplayState = latestScanStateFromRow({
  symbol: "LOWLOW",
  created_at: new Date().toISOString(),
  metrics: {
    setupWatch: true,
    setupDisplayWatch: true,
    setupDisplayBlocksPatternClaim: false,
    setupDisplayDataLimited: false,
    setupStructureKey: "pivot_squeeze",
    patternFamily: "progressive_contraction",
    patternDataStatus: "ok",
    patternEligible: true,
    contractionStructureStatus: "lower_low_drift",
  },
});
assert.equal(invalidStructureUnblockedDisplayState.watch, false, "recent scan state must block watch when contraction structure was rejected");
assert.equal(invalidStructureUnblockedDisplayState.patternCandidate, false, "recent scan state must not keep rejected contraction structures as pattern candidates");

const strictPlanFalsePositiveGoldenSet = [
  {
    name: "low pattern quality",
    row: { ...cleanActionableStrict, patternQualityScore: 62 },
    reason: "calidad",
  },
  {
    name: "weak pivot clarity",
    row: { ...cleanActionableStrict, pivotClarityScore: 42, pivotTouchCount: 1, baseNearPivotDays: 4 },
    reason: "claridad",
  },
  {
    name: "weak base context",
    row: { ...cleanActionableStrict, baseContextScore: 34 },
    reason: "contexto",
  },
  {
    name: "extended above pivot",
    row: { ...cleanActionableStrict, distanceToPivotPct: 4.4, absDistanceToPivotPct: 4.4 },
    reason: "extendido",
  },
  {
    name: "too far below pivot",
    row: { ...cleanActionableStrict, distanceToPivotPct: -5.6, absDistanceToPivotPct: 5.6 },
    reason: "pivot",
  },
  {
    name: "weak latest close",
    row: { ...cleanActionableStrict, latestCloseLocationPct: 34 },
    reason: "cierre",
  },
  {
    name: "missing pivot",
    row: { ...cleanActionableStrict, pivotPrice: null, distanceToPivotPct: null, absDistanceToPivotPct: null },
    reason: "pivot",
  },
];

for (const item of strictPlanFalsePositiveGoldenSet) {
  const reason = strictVcpRejectReason(item.row);
  assert.ok(reason.toLowerCase().includes(item.reason), `${item.name}: expected strict reject reason to include ${item.reason}, got ${reason}`);
  assert.notEqual(setupStructureForRow(item.row).key, "vcp_strict", `${item.name}: should not be strict VCP`);
  assert.notEqual(methodologyVerdictForRow(item.row).key, "actionable_vcp", `${item.name}: should not become plan-valid verdict`);
  assert.equal(methodologyTradePlanEligible(item.row), false, `${item.name}: display gate should block trade plan`);
}

const legacyStrictRowsMustStillPassPlanGate = [
  { name: "legacy weak pivot clarity", row: { ...cleanActionableStrict, pivotClarityScore: 42 } },
  { name: "legacy extended price", row: { ...cleanActionableStrict, distanceToPivotPct: 4.2, absDistanceToPivotPct: 4.2 } },
  { name: "legacy weak close", row: { ...cleanActionableStrict, latestCloseLocationPct: 30 } },
  { name: "legacy weak base context", row: { ...cleanActionableStrict, baseContextScore: 30 } },
];
for (const item of legacyStrictRowsMustStillPassPlanGate) {
  assert.equal(tradePlanEligibility({
    ...item.row,
    setupStructureKey: "vcp_strict",
    setupStructureStrict: true,
  }).actionable, false, `${item.name}: legacy strict row should still be blocked`);
}

const partialVolumeStrict = {
  ...cleanActionableStrict,
  patternDataStatus: "partial_volume",
};
assert.equal(setupStructureForRow(partialVolumeStrict).key, "vcp_strict");
assert.equal(technicalConfidenceForPattern(partialVolumeStrict).key, "partial");
assert.equal(tradePlanEligibility(partialVolumeStrict).actionable, false);
assert.equal(methodologyVerdictForRow(partialVolumeStrict).key, "strict_not_actionable");
assert.equal(methodologyVerdictForRow(partialVolumeStrict).watch, true);
assert.equal(methodologyVerdictForRow(partialVolumeStrict).actionable, false);
assert.equal(methodologyDisplayForRow(partialVolumeStrict).label, "VCP estricto sin plan");
assert.equal(methodologyDisplayForRow(partialVolumeStrict).blocksPatternClaim, true);
assert.equal(methodologyDisplayForRow(partialVolumeStrict).actionable, false);
assert.equal(methodologyWatchEligible(partialVolumeStrict), true);
assert.equal(methodologyTradePlanEligible(partialVolumeStrict), false);
assert.equal(methodologyPivotWatchEligible(partialVolumeStrict), false);
assert.ok(methodologyEvidenceLine(partialVolumeStrict).startsWith("Parcial · "));
assert.equal(screenerFilterRejectReason(partialVolumeStrict, { requireContractionsDecreasing: true, minContractionCount: 3 }), "");
assert.match(screenerFilterRejectReason({
  ...partialVolumeStrict,
  distance20d: -4,
  distance52w: -8,
  highsSpreadPct: 5,
  extSma50: 8,
}, { setupMode: "nearPivot", maxDistance20dHigh: 8, maxHighsSpreadPct: 12, maxExtensionSma50: 18 })?.reason || "", /pivot metodológico no validado/i);
const partialVolumeTags = setupTagsForRow({
  ...partialVolumeStrict,
  price: 108,
  sma50: 100,
  distance20d: -4,
  distance52w: -8,
  extSma50: 8,
  highsSpreadPct: 5,
}).map((tag) => tag.key);
assert.equal(partialVolumeTags.includes("near_highs"), true);
assert.equal(partialVolumeTags.includes("near_pivot"), false);
assert.equal(partialVolumeTags.includes("pivot_zone"), false);
assert.equal(partialVolumeTags.includes("volume_dry_up"), false);
const scoreOnlyNearHighsTags = setupTagsForRow({
  price: 100,
  sma50: 92,
  sma200: 80,
  distance20d: -4,
  distance52w: -8,
  extSma50: 8,
  highsSpreadPct: 5,
  distanceToPivotPct: -4,
  patternQualityScore: 70,
  consolidationCandidate: true,
}).map((tag) => tag.key);
assert.equal(scoreOnlyNearHighsTags.includes("near_highs"), true);
assert.equal(scoreOnlyNearHighsTags.includes("near_pivot"), false);
assert.equal(scoreOnlyNearHighsTags.includes("pivot_zone"), false);
const staleNearHighsTags = setupTagsForRow({
  price: 80,
  sma50: 100,
  sma200: 70,
  distance20d: -4,
  distance52w: -8,
  extSma50: 8,
  highsSpreadPct: 5,
}).map((tag) => tag.key);
assert.equal(staleNearHighsTags.includes("near_highs"), false);
const weakPivotZoneTags = setupTagsForRow({
  price: 100,
  sma50: 92,
  sma200: 72,
  sma200Slope: 3,
  totalScore: 92,
  rsGlobalPct: 88,
  weaknessScore: 82,
  distance20d: -4,
  distance52w: -8,
  extSma50: 7,
  highsSpreadPct: 5,
  distanceToPivotPct: -2,
  patternDataStatus: "ok",
  patternEligible: true,
  setupDisplayKey: "pivot_squeeze",
  setupDisplayState: "watch",
  setupDisplayLabel: "Compresion de pivot",
  setupDisplayWatch: true,
  setupDisplayObservable: true,
  setupDisplayBlocksPatternClaim: false,
  setupDisplayDataLimited: false,
}).map((tag) => tag.key);
assert.equal(weakPivotZoneTags.includes("pivot_zone"), false);
const validPullbackTags = setupTagsForRow({
  price: 100,
  sma50: 98,
  sma200: 80,
  extSma50: 2,
  distance52w: -20,
}).map((tag) => tag.key);
assert.equal(validPullbackTags.includes("pullback_sma50"), true);
const overWindowPullbackTags = setupTagsForRow({
  price: 108.5,
  sma50: 100,
  sma200: 80,
  extSma50: 8.5,
  distance52w: -20,
}).map((tag) => tag.key);
assert.equal(overWindowPullbackTags.includes("pullback_sma50"), false);
const stalePullbackTags = setupTagsForRow({
  price: 80,
  sma50: 100,
  sma200: 70,
  extSma50: 0,
  distance52w: -20,
}).map((tag) => tag.key);
assert.equal(stalePullbackTags.includes("pullback_sma50"), false);
const validExtendedTags = setupTagsForRow({
  price: 115,
  sma50: 100,
  extSma50: 15,
  momentumScore: 70,
  rsGlobalPct: 82,
}).map((tag) => tag.key);
assert.equal(validExtendedTags.includes("extended_strong"), true);
const staleExtendedTags = setupTagsForRow({
  price: 90,
  sma50: 100,
  extSma50: 18,
  momentumScore: 70,
  rsGlobalPct: 82,
}).map((tag) => tag.key);
assert.equal(staleExtendedTags.includes("extended_strong"), false);
assert.equal(screenerFilterRejectReason({ ...partialVolumeStrict, patternVolumeEligible: false }, { maxVolumeDryUpRatio: .9 })?.field, "patternDataStatus");

const storedPartialDisplay = {
  patternDataStatus: "ok",
  patternEligible: true,
  setupDisplayKey: "strict_not_actionable",
  setupDisplayState: "validated",
  setupDisplayLabel: "VCP estricto sin plan",
  setupDisplayShortLabel: "VCP estricto",
  setupDisplayLine: "Parcial · 24.0% -> 15.0% -> 7.0%",
  setupDisplayBlocksPatternClaim: true,
  setupDisplayActionable: false,
  setupDisplayObservable: true,
  setupDisplayWatch: true,
  setupDisplayStrict: true,
  setupDisplayTradePlanEligible: false,
  setupDisplayConfidenceKey: "partial",
  setupDisplayConfidenceLabel: "Dato parcial",
};
assert.equal(methodologyDisplayForRow(storedPartialDisplay).key, "strict_not_actionable");
assert.equal(methodologyDisplayForRow(storedPartialDisplay).line, "Parcial · 24.0% -> 15.0% -> 7.0%");
assert.equal(methodologyDisplayForRow(storedPartialDisplay).blocksPatternClaim, true);
assert.equal(methodologyDisplayForRow(storedPartialDisplay).dataLimited, false);
assert.equal(methodologyDisplayForRow(storedPartialDisplay).watch, true);
assert.equal(methodologyWatchEligible(storedPartialDisplay), true);

const stalePricePattern = {
  ...cleanActionableStrict,
  patternDataStatus: "stale_price",
  patternEligible: false,
};
assert.equal(setupStructureForRow(stalePricePattern).key, "data");
assert.equal(methodologyVerdictForRow(stalePricePattern).state, "data");
assert.equal(methodologyDisplayForRow(stalePricePattern).blocksPatternClaim, true);
assert.equal(methodologyDisplayForRow(stalePricePattern).actionable, false);
assert.equal(methodologySetupLabel(stalePricePattern), "Datos");
assert.equal(methodologyWatchEligible(stalePricePattern), false);
assert.equal(methodologyTradePlanEligible(stalePricePattern), false);
assert.equal(methodologyPivotWatchEligible(stalePricePattern), false);
assert.equal(screenerFilterRejectReason(stalePricePattern, progressiveFilter)?.field, "patternDataStatus");

const storedDataLimitedNearPivot = {
  ...cleanTwoContractionSqueeze,
  methodologyReliabilityState: "data_limited",
  methodologyReliabilityLabel: "Datos parciales",
  methodologyReliabilityReason: "Cobertura parcial: no afirmar patron automaticamente.",
  methodologyBlocksPatternClaim: true,
  setupVerdictLabel: "Datos parciales",
  setupVerdictShortLabel: "Datos",
};
assert.equal(methodologyDisplayForRow(storedDataLimitedNearPivot).dataLimited, true);
assert.equal(methodologyDisplayForRow(storedDataLimitedNearPivot).label, "Datos parciales");
assert.equal(methodologyDisplayForRow(storedDataLimitedNearPivot).blocksPatternClaim, true);
assert.equal(methodologyDisplayForRow(storedDataLimitedNearPivot).actionable, false);
assert.equal(methodologyDisplayForRow(storedDataLimitedNearPivot).watch, false);
assert.equal(methodologyVerdictForRow(storedDataLimitedNearPivot).state, "data");
assert.equal(methodologyVerdictForRow(storedDataLimitedNearPivot).watch, false);
assert.equal(methodologyVerdictForRow(storedDataLimitedNearPivot).actionable, false);
assert.equal(methodologySetupLabel(storedDataLimitedNearPivot), "Datos");
assert.equal(methodologyWatchEligible(storedDataLimitedNearPivot), false);
assert.equal(methodologyTradePlanEligible(storedDataLimitedNearPivot), false);
assert.equal(methodologyPivotWatchEligible(storedDataLimitedNearPivot), false);

const storedDataLimitedActionable = {
  ...cleanActionableStrict,
  methodologyReliabilityState: "data_limited",
  methodologyReliabilityLabel: "Datos parciales",
  methodologyReliabilityReason: "Precio viejo: no derivar plan automatico.",
  methodologyBlocksPatternClaim: true,
};
const storedDataLimitedPlanGate = tradePlanEligibility(storedDataLimitedActionable);
assert.equal(storedDataLimitedPlanGate.actionable, false);
assert.match(storedDataLimitedPlanGate.reason, /Precio viejo|Datos parciales/i);
const storedDataLimitedComputedPlan = computeTradePlan(storedDataLimitedActionable);
assert.equal(storedDataLimitedComputedPlan.available, false);
assert.match(storedDataLimitedComputedPlan.reason, /Precio viejo|Datos parciales/i);
const invalidStructurePlanGate = tradePlanEligibility({
  ...cleanActionableStrict,
  contractionStructureStatus: "lower_low_drift",
  contractionStructureReason: "mínimos no sostienen la base",
});
assert.equal(invalidStructurePlanGate.actionable, false);
assert.match(invalidStructurePlanGate.reason, /mínimos|rechazada|lower_low/i);
const invalidStructureComputedPlan = computeTradePlan({
  ...cleanActionableStrict,
  contractionStructureStatus: "lower_low_drift",
  contractionStructureReason: "mínimos no sostienen la base",
});
assert.equal(invalidStructureComputedPlan.available, false);
assert.match(invalidStructureComputedPlan.reason, /mínimos|rechazada|lower_low/i);
const blockedVolumePlanGate = tradePlanEligibility({
  ...cleanActionableStrict,
  patternVolumeEligible: false,
});
assert.equal(blockedVolumePlanGate.actionable, false);
assert.match(blockedVolumePlanGate.reason, /Volumen no fiable/i);
const blockedVolumeComputedPlan = computeTradePlan({
  ...cleanActionableStrict,
  patternVolumeEligible: false,
});
assert.equal(blockedVolumeComputedPlan.available, false);
assert.match(blockedVolumeComputedPlan.reason, /Volumen no fiable/i);
assert.equal(methodologyVerdictForRow(storedDataLimitedActionable).state, "data");
assert.equal(methodologyVerdictForRow(storedDataLimitedActionable).watch, false);
assert.equal(methodologyVerdictForRow(storedDataLimitedActionable).actionable, false);
assert.equal(methodologyDisplayForRow(storedDataLimitedActionable).actionable, false);
assert.equal(methodologyDisplayForRow(storedDataLimitedActionable).tradePlanEligible, false);
assert.equal(methodologyDisplayForRow(storedDataLimitedActionable).blocksPatternClaim, true);
assert.equal(methodologyDisplayForRow(storedDataLimitedActionable).reason, "Precio viejo: no derivar plan automático.");
assert.equal(methodologyWatchEligible(storedDataLimitedActionable), false);
assert.equal(methodologyTradePlanEligible(storedDataLimitedActionable), false);
assert.equal(methodologyPivotWatchEligible(storedDataLimitedActionable), false);
const compactDataLimitedActionable = compactMethodologySnapshot(storedDataLimitedActionable);
assert.equal(compactDataLimitedActionable.setupPlanValid, false);
assert.equal(compactDataLimitedActionable.setupActionable, false);
assert.equal(compactDataLimitedActionable.setupWatch, false);
assert.equal(compactDataLimitedActionable.setupStrict, false);
assert.equal(compactDataLimitedActionable.setupDisplayPlanValid, false);
assert.equal(compactDataLimitedActionable.setupDisplayActionable, false);
assert.equal(compactDataLimitedActionable.setupDisplayWatch, false);
assert.equal(compactDataLimitedActionable.setupDisplayBlocksPatternClaim, true);
const blockedRawPatternBonusTrap = {
  ...storedDataLimitedActionable,
  patternQualityScore: 99,
  contractionScore: 100,
  vcpCandidate: true,
  breakoutAttempt: true,
  breakoutQualityScore: 100,
  distanceToPivotPct: -1,
  volumeDryUpRatio: 0.5,
};
assert.equal(methodologyPatternEvidenceUsable(blockedRawPatternBonusTrap), false);
assert.equal(methodologyPatternEvidenceBonus(blockedRawPatternBonusTrap), 0, "blocked VCP/pivot evidence must not add positive setup-score bonus");
assert.ok(methodologyPatternEvidenceBonus(cleanActionableStrict) > 0, "validated VCP evidence should still contribute positive setup-score bonus");
const groupedPivotWatch = groupRows([
  { ...cleanActionableStrict, symbol: "PIVOT_OK", sector: "Test group", totalScore: 80, rsGlobalPct: 82 },
  { ...partialVolumeStrict, symbol: "PIVOT_PARTIAL", sector: "Test group", totalScore: 75 },
  { ...storedDataLimitedActionable, symbol: "PIVOT_DATA", sector: "Test group", totalScore: 90 },
  { ...irregularNearPivot, symbol: "PIVOT_IRREGULAR", sector: "Test group", totalScore: 85 },
  { symbol: "EXT_OK", sector: "Test group", totalScore: 88, rsGlobalPct: 82, price: 124, sma50: 100, sma200: 80, extSma50: 24, weaknessScore: 10 },
  { symbol: "EXT_STALE", sector: "Test group", totalScore: 91, rsGlobalPct: 88, price: 90, sma50: 100, sma200: 70, extSma50: 18, weaknessScore: 10 },
], "sector").find((group) => group.key === "Test group");
assert.equal(groupedPivotWatch.pivotWatch, 1);
assert.equal(groupedPivotWatch.nearPivot, 1);
assert.equal(groupedPivotWatch.extended, 1);
assert.equal(tradePlanEligibility({
  ...cleanProgressiveRow,
  patternDataStatus: "ok",
  setupStructureKey: "vcp_watch",
  setupStructureStrict: false,
  patternQualityScore: 72,
  pivotPrice: 100,
}).actionable, false);
assert.equal(tradePlanEligibility({
  ...cleanProgressiveRow,
  patternDataStatus: "ok",
  setupStructureKey: "vcp_strict",
  setupStructureStrict: true,
  patternQualityScore: 58,
  pivotPrice: 100,
}).actionable, false);
assert.equal(
  screenerFilterRejectReason({
    ...cleanProgressiveRow,
    contractionsDecreasing: false,
    contractionDepths: [9.7, 5.8, 3.5, 7.1],
    contraction1DepthPct: 9.7,
    contraction2DepthPct: 5.8,
    contraction3DepthPct: 3.5,
    lastContractionDepthPct: 7.1,
  }, progressiveFilter)?.field,
  "requireContractionsDecreasing"
);

console.log("OK pattern-detector-regression: consolidation gate rejects micro-pullback trends and accepts structural contractions.");
