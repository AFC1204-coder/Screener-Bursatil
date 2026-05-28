import assert from "node:assert/strict";
import { setupStructureForRow, strictVcpRejectReason } from "../lib/patternNarrative.js";
import { screenerFilterRejectReason } from "../lib/screenerFilters.js";
import { setupPatternForBars } from "../lib/setupPatterns.js";

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
