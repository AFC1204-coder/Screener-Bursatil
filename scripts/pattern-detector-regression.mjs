import assert from "node:assert/strict";
import { groupRows } from "../lib/grouping.js";
import { sanitizeMaterializedLeaderboardItem } from "../lib/leaderboards.js";
import { methodologyDisplayForRow, methodologyEvidenceLine, methodologyPivotWatchEligible, methodologySetupLabel, methodologyTradePlanEligible, methodologyWatchEligible } from "../lib/methodologyDisplay.js";
import { compactMethodologySnapshot, enrichRowsWithMethodology } from "../lib/methodologyEngine.js";
import { methodologyVerdictForRow } from "../lib/methodologyVerdict.js";
import { setupStructureForRow, strictVcpRejectReason, technicalConfidenceForPattern } from "../lib/patternNarrative.js";
import { screenerFilterRejectReason } from "../lib/screenerFilters.js";
import { setupPatternForBars } from "../lib/setupPatterns.js";
import { tradePlanEligibility } from "../lib/tradePlan.js";

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

function solidUptrendWithMicroPullbacks() {
  const rows = [];
  for (let i = 0; i < 180; i++) {
    const trend = 50 + i * 0.42;
    const wave = Math.sin(i / 4) * 2.2;
    rows.push(bar(i, trend + wave, 1_000_000 + i * 1_000));
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

const base = setupPatternForBars(progressiveContractionBase());
assert.equal(base.patternDataStatus, "ok");
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
assert.equal(["VCP plan valido", "VCP estricto sin plan", "Base en vigilancia"].includes(methodologyDisplayForRow(base).label), true);

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
assert.equal(methodologyVerdictForRow(cleanTwoContractionSqueeze).watch, true);
assert.equal(methodologyDisplayForRow(cleanTwoContractionSqueeze).label, "Compresion de pivot");
assert.equal(methodologyWatchEligible(cleanTwoContractionSqueeze), true);

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
assert.equal(methodologyVerdictForRow(usefulTwoContractionBase).label, "Base en vigilancia");
assert.equal(methodologyVerdictForRow(usefulTwoContractionBase).watch, true);
assert.equal(methodologySetupLabel(usefulTwoContractionBase), "Base en vigilancia");

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
assert.equal(methodologyDisplayForRow(cleanActionableStrict).label, "VCP plan valido");
assert.equal(methodologySetupLabel(cleanActionableStrict), "Plan valido");
assert.equal(methodologyWatchEligible(cleanActionableStrict), true);
assert.equal(methodologyTradePlanEligible(cleanActionableStrict), true);
assert.equal(methodologyPivotWatchEligible(cleanActionableStrict), true);
assert.ok(methodologyEvidenceLine(cleanActionableStrict).includes("24.0% -> 15.0% -> 7.0%"));
const cleanActionableSnapshot = compactMethodologySnapshot(cleanActionableStrict);
assert.equal(cleanActionableSnapshot.setupDisplayKey, "actionable_vcp");
assert.equal(cleanActionableSnapshot.setupDisplayLabel, "VCP plan valido");
assert.equal(cleanActionableSnapshot.setupPlanValid, true);
assert.equal(cleanActionableSnapshot.setupDisplayPlanValid, true);
assert.equal(cleanActionableSnapshot.setupDisplayBlocksPatternClaim, false);
assert.equal(cleanActionableSnapshot.setupDisplayTradePlanEligible, true);

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
assert.equal(methodologyDisplayForRow(storedLegacyActionableDisplay).label, "VCP plan valido");
assert.equal(methodologySetupLabel(storedLegacyActionableDisplay), "Plan valido");

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
assert.notEqual(methodologyDisplayForRow(staleStoredPlanDisplay).label, "VCP plan valido");
assert.notEqual(methodologySetupLabel(staleStoredPlanDisplay), "Plan valido");
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
assert.equal(refreshedSnapshotRow.setupDisplayPlanValid, false);
assert.notEqual(refreshedSnapshotRow.setupDisplayLabel, "VCP plan valido");
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
assert.notEqual(staleMaterializedLeaderboardItem.setupDisplayLabel, "VCP plan valido");

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
assert.equal(methodologyPivotWatchEligible(partialVolumeStrict), true);
assert.ok(methodologyEvidenceLine(partialVolumeStrict).startsWith("Parcial · "));

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
assert.equal(tradePlanEligibility(storedDataLimitedActionable).actionable, true);
assert.equal(methodologyDisplayForRow(storedDataLimitedActionable).actionable, false);
assert.equal(methodologyDisplayForRow(storedDataLimitedActionable).tradePlanEligible, false);
assert.equal(methodologyDisplayForRow(storedDataLimitedActionable).blocksPatternClaim, true);
assert.equal(methodologyWatchEligible(storedDataLimitedActionable), false);
assert.equal(methodologyTradePlanEligible(storedDataLimitedActionable), false);
assert.equal(methodologyPivotWatchEligible(storedDataLimitedActionable), false);
const groupedPivotWatch = groupRows([
  { ...cleanActionableStrict, symbol: "PIVOT_OK", sector: "Test group", totalScore: 80 },
  { ...partialVolumeStrict, symbol: "PIVOT_PARTIAL", sector: "Test group", totalScore: 75 },
  { ...storedDataLimitedActionable, symbol: "PIVOT_DATA", sector: "Test group", totalScore: 90 },
  { ...irregularNearPivot, symbol: "PIVOT_IRREGULAR", sector: "Test group", totalScore: 85 },
], "sector").find((group) => group.key === "Test group");
assert.equal(groupedPivotWatch.pivotWatch, 2);
assert.equal(groupedPivotWatch.nearPivot, 2);
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
