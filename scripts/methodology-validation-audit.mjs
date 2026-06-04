import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { BASE_URL, getMethodologyBrief, PRICE_MAX_AGE_DAYS, PROFILE_MAX_AGE_DAYS, REFRESH, verdictFromBrief } from "./methodology-audit-utils.mjs";

const CASES_PATH = process.env.METHODOLOGY_CASES_PATH || "docs/methodology/validation-cases.json";
const MARKDOWN_OUTPUT = process.env.METHODOLOGY_AUDIT_MARKDOWN === "1";
const OUTPUT_PATH = process.env.METHODOLOGY_AUDIT_OUTPUT || "";

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function checkIn(checks, value, allowed = [], label = "") {
  if (!allowed.length) return;
  checks.push({
    label,
    ok: allowed.includes(value),
    expected: allowed.join(", "),
    actual: value || "blank",
  });
}

function checkNotIn(checks, value, disallowed = [], label = "") {
  if (!disallowed.length) return;
  checks.push({
    label,
    ok: !disallowed.includes(value),
    expected: `not ${disallowed.join(", ")}`,
    actual: value || "blank",
  });
}

function normalizedCalibrationBucket(value = "") {
  const key = String(value || "").trim().toLowerCase().replace(/^should_/, "").replace(/[-\s]+/g, "_");
  if (["plan", "plan_valid", "valid_plan"].includes(key)) return "plan";
  if (["watch", "watchlist", "vigilancia"].includes(key)) return "watch";
  if (["observe", "observable", "measured", "base_measurable"].includes(key)) return "observe";
  if (["block", "blocked", "reject", "rejected", "no_setup"].includes(key)) return "block";
  if (["not_plan", "non_plan", "no_plan", "not_actionable"].includes(key)) return "not_plan";
  return "";
}

function actualCalibrationBucket(verdict = {}) {
  if (verdict.planValid) return "plan";
  if (verdict.watch) return "watch";
  if (verdict.observable) return "observe";
  return "block";
}

function inferredExpectedCalibration(expect = {}) {
  const explicit = normalizedCalibrationBucket(expect.calibrationBucket || expect.expectedOutcome || expect.methodologyBucket);
  if (explicit) return explicit;
  if (expect.planValid === true || expect.actionable === true) return "plan";
  if (expect.watch === true) return "watch";
  if (expect.observable === true && expect.watch === false) return "observe";
  if (expect.watch === false) return "block";
  const allowedStates = array(expect.verdictStatesAllowed);
  if (allowedStates.length && allowedStates.every((state) => state === "watch")) return "watch";
  if (allowedStates.length && allowedStates.every((state) => state === "blocked")) return "block";
  if (expect.planValid === false || expect.actionable === false) return "not_plan";
  return "";
}

function calibrationCheck(expected = "", actual = "", verdict = {}) {
  if (!expected) return null;
  if (expected === "not_plan") return {
    label: "calibration bucket",
    ok: verdict.planValid === false,
    expected: "not plan",
    actual,
  };
  return {
    label: "calibration bucket",
    ok: actual === expected,
    expected,
    actual,
  };
}

function assertCase(brief = {}, testCase = {}) {
  const expect = testCase.expect || {};
  const verdict = verdictFromBrief(brief);
  const actualBucket = actualCalibrationBucket(verdict);
  const expectedBucket = inferredExpectedCalibration(expect);
  const checks = [];

  checks.push({ label: "display key", ok: Boolean(verdict.key), expected: "non-empty", actual: verdict.key || "blank" });
  checks.push({ label: "display label", ok: Boolean(verdict.label), expected: "non-empty", actual: verdict.label || "blank" });
  checks.push({ label: "display evidence", ok: Boolean(verdict.line || verdict.reason), expected: "non-empty", actual: verdict.line || verdict.reason || "blank" });
  checks.push({ label: "plan/watch exclusivity", ok: !(verdict.planValid && verdict.watch), expected: "not both true", actual: `planValid=${verdict.planValid}, watch=${verdict.watch}` });
  if (verdict.planValid) {
    checks.push({ label: "plan valid not blocked", ok: verdict.blocksPatternClaim !== true, expected: "false", actual: String(verdict.blocksPatternClaim) });
    checks.push({ label: "plan valid trade plan", ok: verdict.tradePlanEligible === true, expected: "true", actual: String(verdict.tradePlanEligible) });
    checks.push({ label: "plan valid strict", ok: verdict.strict === true, expected: "true", actual: String(verdict.strict) });
  }
  if (verdict.blocksPatternClaim) {
    checks.push({ label: "blocked claim not plan valid", ok: verdict.planValid === false, expected: "false", actual: String(verdict.planValid) });
  }
  if (verdict.dataLimited) {
    checks.push({ label: "data limited not plan valid", ok: verdict.planValid === false, expected: "false", actual: String(verdict.planValid) });
    checks.push({ label: "data limited not watch", ok: verdict.watch === false, expected: "false", actual: String(verdict.watch) });
  }
  if (["partial", "blocked", "unknown"].includes(verdict.dataConfidenceKey)) {
    checks.push({ label: "limited confidence blocks claim", ok: verdict.blocksPatternClaim === true, expected: "true", actual: String(verdict.blocksPatternClaim) });
  }

  if (expect.theme) checks.push({ label: "theme", ok: brief.theme === expect.theme, expected: expect.theme, actual: brief.theme || "blank" });
  checkNotIn(checks, brief.theme, array(expect.themeNot), "theme");
  checkIn(checks, verdict.key, array(expect.verdictKeysAllowed), "setup verdict key");
  checkIn(checks, verdict.state, array(expect.verdictStatesAllowed), "setup verdict state");
  checkIn(checks, verdict.label, array(expect.verdictLabelsAllowed), "setup verdict label");
  checkNotIn(checks, verdict.label, array(expect.verdictLabelsNot), "setup verdict label");
  checkIn(checks, verdict.patternDataStatus, array(expect.patternDataStatusAllowed), "pattern data status");
  checkIn(checks, verdict.dataConfidenceKey, array(expect.dataConfidenceKeysAllowed), "data confidence key");

  if (typeof expect.actionable === "boolean") {
    checks.push({ label: "planValid", ok: verdict.planValid === expect.actionable, expected: String(expect.actionable), actual: String(verdict.planValid) });
  }
  if (typeof expect.planValid === "boolean") {
    checks.push({ label: "planValid", ok: verdict.planValid === expect.planValid, expected: String(expect.planValid), actual: String(verdict.planValid) });
  }
  if (typeof expect.watch === "boolean") {
    checks.push({ label: "watch", ok: verdict.watch === expect.watch, expected: String(expect.watch), actual: String(verdict.watch) });
  }
  if (typeof expect.observable === "boolean") {
    checks.push({ label: "observable", ok: verdict.observable === expect.observable, expected: String(expect.observable), actual: String(verdict.observable) });
  }
  if (typeof expect.strict === "boolean") {
    checks.push({ label: "strict", ok: verdict.strict === expect.strict, expected: String(expect.strict), actual: String(verdict.strict) });
  }
  if (typeof expect.blocksPatternClaim === "boolean") {
    checks.push({ label: "blocksPatternClaim", ok: verdict.blocksPatternClaim === expect.blocksPatternClaim, expected: String(expect.blocksPatternClaim), actual: String(verdict.blocksPatternClaim) });
  }
  if (typeof expect.dataLimited === "boolean") {
    checks.push({ label: "dataLimited", ok: verdict.dataLimited === expect.dataLimited, expected: String(expect.dataLimited), actual: String(verdict.dataLimited) });
  }
  if (Number.isFinite(expect.minPatternQualityScore)) {
    checks.push({
      label: "patternQualityScore",
      ok: Number.isFinite(verdict.patternQualityScore) && verdict.patternQualityScore >= expect.minPatternQualityScore,
      expected: `>= ${expect.minPatternQualityScore}`,
      actual: verdict.patternQualityScore == null ? "blank" : verdict.patternQualityScore.toFixed(1),
    });
  }
  if (Number.isFinite(expect.maxPatternQualityScore)) {
    checks.push({
      label: "patternQualityScore",
      ok: Number.isFinite(verdict.patternQualityScore) && verdict.patternQualityScore <= expect.maxPatternQualityScore,
      expected: `<= ${expect.maxPatternQualityScore}`,
      actual: verdict.patternQualityScore == null ? "blank" : verdict.patternQualityScore.toFixed(1),
    });
  }
  if (Number.isFinite(expect.minChartBars)) {
    checks.push({
      label: "chartBars",
      ok: Number.isFinite(brief.chartBars) && brief.chartBars >= expect.minChartBars,
      expected: `>= ${expect.minChartBars}`,
      actual: String(brief.chartBars || 0),
    });
  }
  const bucketCheck = calibrationCheck(expectedBucket, actualBucket, verdict);
  if (bucketCheck) checks.push(bucketCheck);

  const failures = checks.filter((check) => !check.ok);
  return {
    id: testCase.id,
    symbol: testCase.symbol,
    humanLabel: testCase.humanLabel || "",
    theme: brief.theme,
    sector: brief.sector,
    industry: brief.industry,
    chartBars: brief.chartBars,
    verdict,
    calibration: {
      expected: expectedBucket,
      actual: actualBucket,
    },
    checks,
    ok: failures.length === 0,
    failures,
  };
}

function fmtPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "";
}

function fmtRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : "";
}

function mdEscape(value = "") {
  return String(value || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function calibrationSummary(results = []) {
  const summary = {
    checked: 0,
    unspecified: 0,
    mismatches: 0,
    expected: {},
    actual: {},
  };
  for (const item of results) {
    const expected = item.calibration?.expected || "";
    const actual = item.calibration?.actual || "block";
    summary.actual[actual] = (summary.actual[actual] || 0) + 1;
    if (!expected) {
      summary.unspecified += 1;
      continue;
    }
    summary.checked += 1;
    summary.expected[expected] = (summary.expected[expected] || 0) + 1;
    if ((item.failures || []).some((check) => check.label === "calibration bucket")) summary.mismatches += 1;
  }
  return summary;
}

function calibrationAggregateFailures(dataset = {}, calibration = {}) {
  const expected = dataset.calibrationExpectations || {};
  const failures = [];
  const checks = [
    ["minCheckedCases", calibration.checked, (actual, target) => actual >= target, `checked >= ${expected.minCheckedCases}`],
    ["maxMismatches", calibration.mismatches, (actual, target) => actual <= target, `mismatches <= ${expected.maxMismatches}`],
    ["maxPlanCases", calibration.actual?.plan || 0, (actual, target) => actual <= target, `plan <= ${expected.maxPlanCases}`],
    ["minWatchCases", calibration.actual?.watch || 0, (actual, target) => actual >= target, `watch >= ${expected.minWatchCases}`],
    ["minObserveCases", calibration.actual?.observe || 0, (actual, target) => actual >= target, `observe >= ${expected.minObserveCases}`],
  ];
  for (const [key, actual, predicate, expectedLabel] of checks) {
    const target = Number(expected[key]);
    if (!Number.isFinite(target)) continue;
    if (!predicate(actual, target)) failures.push({ label: key, expected: expectedLabel, actual: String(actual) });
  }
  return failures;
}

function markdownReport(payload = {}) {
  const rows = payload.results || [];
  const calibration = payload.calibration || calibrationSummary(rows);
  const guardrailFailures = payload.calibrationAggregateFailures || [];
  const lines = [
    "# Methodology Validation Matrix",
    "",
    `Dataset version: ${payload.version || "unknown"}`,
    `Base URL: ${payload.baseUrl}`,
    `Refresh: ${payload.refresh ? "yes" : "no"} · Profile max age: ${payload.profileMaxAgeDays}d · Price max age: ${payload.priceMaxAgeDays}d`,
    `Cases: ${payload.cases} · Passed: ${payload.passed} · Failed: ${payload.failed}`,
    `Calibration: checked ${calibration.checked} · mismatches ${calibration.mismatches} · actual block ${calibration.actual?.block || 0} / observe ${calibration.actual?.observe || 0} / watch ${calibration.actual?.watch || 0} / plan ${calibration.actual?.plan || 0}`,
    `Calibration guardrails: ${guardrailFailures.length ? guardrailFailures.map((item) => `${item.label} expected ${item.expected}, actual ${item.actual}`).join("; ") : "OK"}`,
    "",
    "| Result | Symbol | Theme | Display verdict | Calibration | Claim block | Confidence | Plan valid | Evidence | Failed checks |",
    "|---|---|---|---|---|---:|---|---:|---|---|",
  ];
  for (const item of rows) {
    const evidence = [
      item.verdict.line,
      item.verdict.reason,
      item.verdict.contractionCount != null ? `${item.verdict.contractionCount} contr.` : "",
      item.verdict.distanceToPivotPct != null ? `pivot ${fmtPct(item.verdict.distanceToPivotPct)}` : "",
      item.verdict.volumeDryUpRatio != null ? `vol ${fmtRatio(item.verdict.volumeDryUpRatio)}` : "",
      item.verdict.patternQualityScore != null ? `q ${item.verdict.patternQualityScore.toFixed(0)}` : "",
      item.chartBars ? `${item.chartBars} barras` : "",
    ].filter(Boolean).join("; ");
    const failedChecks = item.failures
      .map((check) => `${check.label}: esperado ${check.expected}, actual ${check.actual}`)
      .join("; ");
    lines.push([
      item.ok ? "OK" : "FAIL",
      mdEscape(item.symbol),
      mdEscape(item.theme),
      mdEscape(`${item.verdict.label} (${item.verdict.key}/${item.verdict.state})`),
      mdEscape(item.calibration?.expected ? `${item.calibration.actual}/${item.calibration.expected}` : `${item.calibration?.actual || "-"} / -`),
      item.verdict.blocksPatternClaim ? "yes" : "no",
      mdEscape(item.verdict.dataConfidenceLabel || item.verdict.dataConfidenceKey || "-"),
      item.verdict.planValid ? "yes" : "no",
      mdEscape(evidence),
      mdEscape(failedChecks || "-"),
    ].join(" | "));
  }
  return `${lines.join("\n")}\n`;
}

function isDataAccessFailure(result = {}) {
  return (result.failures || []).some((check) => check.label === "data");
}

async function main() {
  const raw = await fs.readFile(CASES_PATH, "utf8");
  const dataset = JSON.parse(raw);
  const cases = (dataset.cases || []).filter((item) => item.active !== false);
  assert.ok(cases.length, "methodology validation set must include at least one active case");

  const results = [];
  for (const testCase of cases) {
    assert.ok(testCase.symbol, `${testCase.id || "case"} must include symbol`);
    try {
      const brief = await getMethodologyBrief(testCase.symbol);
      results.push(assertCase(brief, testCase));
    } catch (error) {
      const result = {
        id: testCase.id,
        symbol: testCase.symbol,
        humanLabel: testCase.humanLabel || "",
        theme: "",
        sector: "",
        industry: "",
        chartBars: 0,
        verdict: {
          key: "error",
          state: "error",
          label: "Error de datos",
          reason: error?.message || String(error || "error"),
          planValid: false,
          actionable: false,
        },
        checks: [],
        ok: false,
        failures: [{ label: "data", expected: "brief", actual: error?.message || String(error || "error") }],
      };
      results.push(result);
    }
  }

  const failed = results.filter((item) => !item.ok);
  const calibration = calibrationSummary(results);
  const aggregateFailures = calibrationAggregateFailures(dataset, calibration);
  const payload = {
    ok: true,
    version: dataset.version,
    cases: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    baseUrl: BASE_URL,
    refresh: REFRESH,
    profileMaxAgeDays: PROFILE_MAX_AGE_DAYS,
    priceMaxAgeDays: PRICE_MAX_AGE_DAYS,
    calibration,
    calibrationAggregateFailures: aggregateFailures,
    results,
  };

  const output = MARKDOWN_OUTPUT ? markdownReport(payload) : JSON.stringify(payload, null, 2);
  const allDataAccessFailures = failed.length === results.length && failed.every(isDataAccessFailure);
  if (OUTPUT_PATH && allDataAccessFailures) {
    console.error(`SKIP methodology audit output write: all ${results.length} cases failed during data access.`);
  } else if (OUTPUT_PATH) {
    await fs.writeFile(OUTPUT_PATH, output);
  }
  console.log(output);

  if (failed.length || aggregateFailures.length) {
    const summary = failed.map((item) => {
      const details = item.failures.map((check) => `${check.label} expected ${check.expected}, got ${check.actual}`).join("; ");
      return `${item.symbol}: ${details}`;
    }).join(" | ");
    const aggregateSummary = aggregateFailures.map((item) => `${item.label} expected ${item.expected}, got ${item.actual}`).join("; ");
    throw new Error(`methodology validation failed ${failed.length}/${results.length}: ${[summary, aggregateSummary].filter(Boolean).join(" | ")}`);
  }
}

main().catch((error) => {
  console.error(`FAIL methodology-validation-audit: ${error.message}`);
  process.exitCode = 1;
});
