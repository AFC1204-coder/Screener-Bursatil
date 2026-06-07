import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { methodologyDisplayForRow } from "../lib/methodologyDisplay.js";
import { setupPatternForBars } from "../lib/setupPatterns.js";
import { vcpDiagnosticSnapshot } from "../lib/vcpDiagnostics.js";

const CORPUS_PATH = process.env.VCP_CORPUS_PATH || "docs/methodology/vcp-corpus.json";
const OUTPUT_PATH = process.env.VCP_CORPUS_OUTPUT || "docs/methodology/latest-vcp-corpus-audit.md";
const VISUAL_OUTPUT_DIR = process.env.VCP_CORPUS_VISUAL_DIR || "docs/methodology/vcp-visuals";
const WRITE_VISUALS = process.env.VCP_CORPUS_VISUALS !== "0";
const MARKDOWN_OUTPUT = process.env.VCP_CORPUS_MARKDOWN !== "0";
const BASE_URL = process.env.VCP_CORPUS_BASE_URL || process.env.METHODOLOGY_AUDIT_BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
const REFRESH_ENV = process.env.VCP_CORPUS_REFRESH;
const MAX_PRICE_AGE_DAYS = Math.max(0, Number(process.env.VCP_CORPUS_MAX_PRICE_AGE_DAYS || 5));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.VCP_CORPUS_TIMEOUT_MS || 45000));

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value = "") {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function mdEscape(value = "") {
  return String(value || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function xmlEscape(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slug(value = "") {
  return String(value || "case").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "case";
}

function fmtPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "";
}

function fmtRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : "";
}

function normalizedBucket(value = "") {
  const key = String(value || "").trim().toLowerCase().replace(/^should_/, "").replace(/[-\s]+/g, "_");
  if (["plan", "plan_valid", "valid_plan"].includes(key)) return "plan";
  if (["watch", "watchlist", "vigilancia"].includes(key)) return "watch";
  if (["observe", "observable", "measured", "base_measurable"].includes(key)) return "observe";
  if (["block", "blocked", "reject", "rejected", "no_setup"].includes(key)) return "block";
  return "";
}

function actualBucket(display = {}) {
  const planValid = display.actionable === true && display.tradePlanEligible === true && display.blocksPatternClaim !== true;
  if (planValid) return "plan";
  if (display.watch === true) return "watch";
  if (display.observable === true) return "observe";
  return "block";
}

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        ...(TOKEN ? { "x-statsedge-token": TOKEN } : {}),
      },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`${path}: ${data.error || data.message || `HTTP ${res.status}`}`);
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${path}: timeout after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function refreshEnabled(testCase = {}, dataset = {}) {
  if (REFRESH_ENV === "1") return true;
  if (REFRESH_ENV === "0") return false;
  return testCase.refresh === true || dataset.defaultRefresh === true;
}

function chartPath(testCase = {}, dataset = {}) {
  const params = new URLSearchParams({
    symbol: testCase.symbol || "",
    range: testCase.chartRange || "MAX",
    interval: testCase.chartInterval || "D",
    maxAgeDays: String(testCase.maxPriceAgeDays ?? MAX_PRICE_AGE_DAYS),
  });
  if (testCase.cache === false) params.set("cache", "0");
  if (refreshEnabled(testCase, dataset)) {
    params.set("cache", "0");
    params.set("refresh", "1");
  }
  return `/api/chart?${params.toString()}`;
}

function barsThroughAsOf(bars = [], asOf = "latest") {
  const sorted = [...bars]
    .filter((bar) => toDate(bar.date) && Number.isFinite(finite(bar.close)))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const date = toDate(asOf);
  if (!date || String(asOf || "").toLowerCase() === "latest") return sorted;
  return sorted.filter((bar) => toDate(bar.date) <= date);
}

function referenceDateForAsOf(asOf = "latest") {
  const date = toDate(asOf);
  return date ? `${date}T23:59:59Z` : undefined;
}

function relativePath(from = "", to = "") {
  if (!from || !to) return to || "";
  const fromDir = from.split("/").slice(0, -1).join("/");
  if (to.startsWith(`${fromDir}/`)) return to.slice(fromDir.length + 1);
  return to;
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

function checkNumber(checks, label, actual, predicate, expected) {
  checks.push({
    label,
    ok: predicate(actual),
    expected,
    actual: Number.isFinite(actual) ? String(actual) : "blank",
  });
}

function assertCase({ testCase = {}, chart = {}, bars = [], pattern = {}, display = {}, diagnostic = {} } = {}) {
  const expect = testCase.expect || {};
  const checks = [];
  const bucket = actualBucket(display);
  const expectedBucket = normalizedBucket(expect.calibrationBucket || expect.expectedOutcome);
  const planValid = display.actionable === true && display.tradePlanEligible === true && display.blocksPatternClaim !== true;

  checks.push({ label: "display key", ok: Boolean(display.key), expected: "non-empty", actual: display.key || "blank" });
  checks.push({ label: "diagnostic gates", ok: Array.isArray(diagnostic.gates) && diagnostic.gates.length >= 4, expected: ">= 4", actual: String(diagnostic.gates?.length || 0) });
  if (expectedBucket) checks.push({ label: "calibration bucket", ok: bucket === expectedBucket, expected: expectedBucket, actual: bucket });
  checkIn(checks, display.key, array(expect.verdictKeysAllowed), "setup verdict key");
  checkIn(checks, display.state, array(expect.verdictStatesAllowed), "setup verdict state");
  checkIn(checks, pattern.patternFamily, array(expect.patternFamilyAllowed), "pattern family");
  checkIn(checks, pattern.baseContextStatus, array(expect.baseContextStatusAllowed), "base context");
  checkIn(checks, pattern.contractionStructureStatus, array(expect.contractionStructureStatusAllowed), "contraction structure");

  if (typeof expect.watch === "boolean") checks.push({ label: "watch", ok: display.watch === expect.watch, expected: String(expect.watch), actual: String(display.watch === true) });
  if (typeof expect.planValid === "boolean") checks.push({ label: "planValid", ok: planValid === expect.planValid, expected: String(expect.planValid), actual: String(planValid) });
  if (typeof expect.strict === "boolean") checks.push({ label: "strict", ok: display.strict === expect.strict, expected: String(expect.strict), actual: String(display.strict === true) });
  if (typeof expect.contractionsDecreasing === "boolean") checks.push({ label: "contractionsDecreasing", ok: pattern.contractionsDecreasing === expect.contractionsDecreasing, expected: String(expect.contractionsDecreasing), actual: String(pattern.contractionsDecreasing === true) });
  if (typeof expect.consolidationCandidate === "boolean") checks.push({ label: "consolidationCandidate", ok: pattern.consolidationCandidate === expect.consolidationCandidate, expected: String(expect.consolidationCandidate), actual: String(pattern.consolidationCandidate === true) });
  if (Number.isFinite(expect.minContractionCount)) checkNumber(checks, "contractionCount", finite(pattern.contractionCount), (actual) => Number.isFinite(actual) && actual >= expect.minContractionCount, `>= ${expect.minContractionCount}`);
  if (Number.isFinite(expect.maxContractionCount)) checkNumber(checks, "contractionCount", finite(pattern.contractionCount), (actual) => Number.isFinite(actual) && actual <= expect.maxContractionCount, `<= ${expect.maxContractionCount}`);
  if (Number.isFinite(expect.minChartBars)) checkNumber(checks, "chartBars", bars.length, (actual) => actual >= expect.minChartBars, `>= ${expect.minChartBars}`);

  const failures = checks.filter((check) => !check.ok);
  return {
    id: testCase.id,
    symbol: testCase.symbol,
    asOf: testCase.asOf || "latest",
    latestDate: bars[0]?.date || "",
    archetype: testCase.archetype || "",
    humanLabel: testCase.humanLabel || "",
    provider: chart.meta?.dataProvider || "",
    chartBars: bars.length,
    display: {
      key: display.key || "",
      state: display.state || "",
      label: display.label || "",
      reason: display.reason || "",
      line: display.line || "",
      watch: display.watch === true,
      strict: display.strict === true,
      planValid,
    },
    pattern: {
      family: pattern.patternFamily || "",
      maturity: pattern.patternMaturity || "",
      dataStatus: pattern.patternDataStatus || "",
      consolidationCandidate: pattern.consolidationCandidate === true,
      baseContextStatus: pattern.baseContextStatus || "",
      contractionCount: finite(pattern.contractionCount),
      contractionsDecreasing: pattern.contractionsDecreasing === true,
      contractionStructureStatus: pattern.contractionStructureStatus || "",
      contractionDepths: Array.isArray(pattern.contractionDepths) ? pattern.contractionDepths : [],
      distanceToPivotPct: finite(pattern.distanceToPivotPct),
      volumeDryUpRatio: finite(pattern.volumeDryUpRatio),
      patternQualityScore: finite(pattern.patternQualityScore),
    },
    diagnostic,
    calibration: {
      expected: expectedBucket,
      actual: bucket,
    },
    checks,
    ok: failures.length === 0,
    failures,
  };
}

function uniqueDates(bars = []) {
  return new Map(bars.map((bar, index) => [toDate(bar.date), index]));
}

function chartWindowRows(bars = [], pattern = {}, visualBars = 130) {
  const descending = [...bars].filter((bar) => toDate(bar.date) && Number.isFinite(finite(bar.close)));
  const maxRows = Math.min(Math.max(Number(visualBars) || 130, 80), 220);
  const swings = Array.isArray(pattern.contractionSwings) ? pattern.contractionSwings : [];
  const needed = new Set(swings.flatMap((swing) => [toDate(swing.fromDate), toDate(swing.toDate)]).filter(Boolean));
  const selected = descending.slice(0, maxRows);
  const present = new Set(selected.map((bar) => toDate(bar.date)).filter(Boolean));
  for (const bar of descending.slice(maxRows)) {
    if (needed.has(toDate(bar.date)) && !present.has(toDate(bar.date))) {
      selected.push(bar);
      present.add(toDate(bar.date));
    }
  }
  return selected.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function renderVcpSvg({ testCase = {}, bars = [], pattern = {}, display = {} } = {}) {
  const rows = chartWindowRows(bars, pattern, testCase.visualBars);
  const width = 900;
  const height = 360;
  const pad = { left: 52, right: 28, top: 54, bottom: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const prices = rows.flatMap((bar) => [finite(bar.high), finite(bar.low), finite(bar.close)]).filter(Number.isFinite);
  const pivot = finite(pattern.pivotPrice);
  if (Number.isFinite(pivot)) prices.push(pivot);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const span = Math.max(maxPrice - minPrice, Math.abs(maxPrice) * 0.04, 1);
  const minY = minPrice - span * 0.08;
  const maxY = maxPrice + span * 0.08;
  const xForIndex = (index) => pad.left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * plotW);
  const yForPrice = (price) => pad.top + ((maxY - price) / (maxY - minY)) * plotH;
  const byDate = uniqueDates(rows);
  const linePoints = rows
    .map((bar, index) => {
      const close = finite(bar.close);
      return Number.isFinite(close) ? `${xForIndex(index).toFixed(1)},${yForPrice(close).toFixed(1)}` : "";
    })
    .filter(Boolean)
    .join(" ");
  const toneColor = display.actionable ? "#166534" : display.watch ? "#92400e" : display.observable ? "#1d4ed8" : "#991b1b";
  const swingColor = pattern.contractionStructureStatus === "ok" ? "#2563eb" : "#dc2626";
  const swingNodes = (Array.isArray(pattern.contractionSwings) ? pattern.contractionSwings : []).slice(0, 4).map((swing, index) => {
    const fromIndex = byDate.get(toDate(swing.fromDate));
    const toIndex = byDate.get(toDate(swing.toDate));
    const high = finite(swing.high);
    const low = finite(swing.low);
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || !Number.isFinite(high) || !Number.isFinite(low)) return "";
    const x1 = xForIndex(fromIndex);
    const x2 = xForIndex(toIndex);
    const y1 = yForPrice(high);
    const y2 = yForPrice(low);
    const labelX = Math.max(pad.left + 16, Math.min(width - pad.right - 18, (x1 + x2) / 2));
    const labelY = Math.max(pad.top + 18, Math.min(height - pad.bottom - 18, Math.min(y1, y2) - 8));
    return [
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${swingColor}" stroke-width="2.6" stroke-linecap="round"/>`,
      `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="3.2" fill="${swingColor}"/>`,
      `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3.2" fill="${swingColor}"/>`,
      `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${swingColor}">C${index + 1} ${fmtPct(finite(swing.depthPct))}</text>`,
    ].join("\n");
  }).filter(Boolean).join("\n");
  const pivotNode = Number.isFinite(pivot)
    ? `<line x1="${pad.left}" y1="${yForPrice(pivot).toFixed(1)}" x2="${width - pad.right}" y2="${yForPrice(pivot).toFixed(1)}" stroke="#0f766e" stroke-width="1.4" stroke-dasharray="6 5"/><text x="${width - pad.right}" y="${(yForPrice(pivot) - 6).toFixed(1)}" text-anchor="end" font-size="11" fill="#0f766e">pivot ${pivot.toFixed(2)}</text>`
    : "";
  const title = `${testCase.symbol || ""} ${testCase.asOf || ""} · ${display.label || ""}`;
  const subtitle = `${pattern.contractionStructureStatus || "sin estructura"} · ${contractionsLine(pattern) || "sin contracciones"} · pivot ${fmtPct(finite(pattern.distanceToPivotPct)) || "sin dato"}`;
  const firstDate = rows[0]?.date || "";
  const lastDate = rows.at(-1)?.date || "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(title)}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="#f8fafc" stroke="#d9e2ec"/>
  <text x="${pad.left}" y="25" font-size="16" font-weight="700" fill="#0f172a">${xmlEscape(title)}</text>
  <text x="${pad.left}" y="43" font-size="12" fill="${toneColor}">${xmlEscape(subtitle)}</text>
  <path d="M ${pad.left} ${pad.top + plotH * .25} H ${width - pad.right} M ${pad.left} ${pad.top + plotH * .5} H ${width - pad.right} M ${pad.left} ${pad.top + plotH * .75} H ${width - pad.right}" stroke="#e5e7eb" stroke-width="1"/>
  ${pivotNode}
  <polyline points="${linePoints}" fill="none" stroke="#111827" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
  ${swingNodes}
  <text x="${pad.left}" y="${height - 16}" font-size="11" fill="#475569">${xmlEscape(firstDate)}</text>
  <text x="${width - pad.right}" y="${height - 16}" text-anchor="end" font-size="11" fill="#475569">${xmlEscape(lastDate)}</text>
</svg>
`;
}

async function writeCaseVisual({ testCase = {}, bars = [], pattern = {}, display = {} } = {}) {
  if (!WRITE_VISUALS || !MARKDOWN_OUTPUT || !VISUAL_OUTPUT_DIR) return "";
  await fs.mkdir(VISUAL_OUTPUT_DIR, { recursive: true });
  const path = `${VISUAL_OUTPUT_DIR}/${slug(testCase.id || testCase.symbol)}.svg`;
  await fs.writeFile(path, renderVcpSvg({ testCase, bars, pattern, display }), "utf8");
  return path;
}

function calibrationSummary(results = []) {
  const summary = { checked: 0, mismatches: 0, actual: {} };
  for (const item of results) {
    const actual = item.calibration?.actual || "block";
    const expected = item.calibration?.expected || "";
    summary.actual[actual] = (summary.actual[actual] || 0) + 1;
    if (!expected) continue;
    summary.checked += 1;
    if (actual !== expected) summary.mismatches += 1;
  }
  return summary;
}

function aggregateFailures(dataset = {}, calibration = {}) {
  const expected = dataset.calibrationExpectations || {};
  const failures = [];
  const checks = [
    ["minCheckedCases", calibration.checked, (actual, target) => actual >= target, `checked >= ${expected.minCheckedCases}`],
    ["maxMismatches", calibration.mismatches, (actual, target) => actual <= target, `mismatches <= ${expected.maxMismatches}`],
    ["maxPlanCases", calibration.actual?.plan || 0, (actual, target) => actual <= target, `plan <= ${expected.maxPlanCases}`],
    ["minPlanCases", calibration.actual?.plan || 0, (actual, target) => actual >= target, `plan >= ${expected.minPlanCases}`],
    ["minWatchCases", calibration.actual?.watch || 0, (actual, target) => actual >= target, `watch >= ${expected.minWatchCases}`],
    ["minObserveCases", calibration.actual?.observe || 0, (actual, target) => actual >= target, `observe >= ${expected.minObserveCases}`],
    ["minBlockCases", calibration.actual?.block || 0, (actual, target) => actual >= target, `block >= ${expected.minBlockCases}`],
  ];
  for (const [key, actual, predicate, expectedLabel] of checks) {
    const target = Number(expected[key]);
    if (!Number.isFinite(target)) continue;
    if (!predicate(actual, target)) failures.push({ label: key, expected: expectedLabel, actual: String(actual) });
  }
  return failures;
}

function contractionsLine(pattern = {}) {
  const depths = Array.isArray(pattern.contractionDepths) ? pattern.contractionDepths : [];
  return depths.map((value) => fmtPct(finite(value))).filter(Boolean).join(" -> ");
}

function markdownReport(payload = {}) {
  const calibration = payload.calibration || {};
  const guardrails = payload.aggregateFailures || [];
  const lines = [
    "# VCP Corpus Audit",
    "",
    `Dataset version: ${payload.version || "unknown"}`,
    `Base URL: ${payload.baseUrl}`,
    `Refresh: ${payload.refresh ? "yes" : "no"} · Price max age: ${payload.maxPriceAgeDays}d`,
    `Cases: ${payload.cases} · Passed: ${payload.passed} · Failed: ${payload.failed}`,
    `Calibration: checked ${calibration.checked || 0} · mismatches ${calibration.mismatches || 0} · actual block ${calibration.actual?.block || 0} / observe ${calibration.actual?.observe || 0} / watch ${calibration.actual?.watch || 0} / plan ${calibration.actual?.plan || 0}`,
    `Calibration guardrails: ${guardrails.length ? guardrails.map((item) => `${item.label} expected ${item.expected}, actual ${item.actual}`).join("; ") : "OK"}`,
    "",
    "| Result | Case | Symbol | As of | Actual | Expected | Visual | Diagnostic | Contractions | Failed checks |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const item of payload.results || []) {
    const failedChecks = item.failures.map((check) => `${check.label}: esperado ${check.expected}, actual ${check.actual}`).join("; ");
    const diagnostic = [
      item.display.reason,
      item.pattern.contractionStructureStatus ? `estructura ${item.pattern.contractionStructureStatus}` : "",
      item.pattern.distanceToPivotPct != null ? `pivot ${fmtPct(item.pattern.distanceToPivotPct)}` : "",
      item.pattern.volumeDryUpRatio != null ? `vol ${fmtRatio(item.pattern.volumeDryUpRatio)}` : "",
      item.pattern.patternQualityScore != null ? `q ${item.pattern.patternQualityScore.toFixed(0)}` : "",
      item.chartBars ? `${item.chartBars} barras` : "",
    ].filter(Boolean).join("; ");
    const visual = item.visualPath ? `[SVG](${relativePath(payload.outputPath || "", item.visualPath)})` : "-";
    lines.push([
      item.ok ? "OK" : "FAIL",
      mdEscape(item.id),
      mdEscape(item.symbol),
      mdEscape(item.latestDate || item.asOf),
      mdEscape(`${item.display.label} (${item.display.key}/${item.display.state})`),
      mdEscape(item.calibration?.expected || "-"),
      visual,
      mdEscape(diagnostic),
      mdEscape(contractionsLine(item.pattern)),
      mdEscape(failedChecks || "-"),
    ].join(" | "));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const raw = await fs.readFile(CORPUS_PATH, "utf8");
  const dataset = JSON.parse(raw);
  const cases = (dataset.cases || []).filter((item) => item.active !== false);
  const refreshMode = cases.some((testCase) => refreshEnabled(testCase, dataset));
  assert.ok(cases.length, "VCP corpus must include at least one active case");

  const results = [];
  for (const testCase of cases) {
    assert.ok(testCase.symbol, `${testCase.id || "case"} must include symbol`);
    try {
      const chart = await getJson(chartPath(testCase, dataset));
      const bars = barsThroughAsOf(chart.bars || [], testCase.asOf || "latest");
      const pattern = setupPatternForBars(bars, {
        referenceDate: referenceDateForAsOf(testCase.asOf),
      });
      const display = methodologyDisplayForRow(pattern);
      const diagnostic = vcpDiagnosticSnapshot(pattern);
      const visualPath = await writeCaseVisual({ testCase, bars, pattern, display });
      results.push({ ...assertCase({ testCase, chart, bars, pattern, display, diagnostic }), visualPath });
    } catch (error) {
      results.push({
        id: testCase.id,
        symbol: testCase.symbol,
        asOf: testCase.asOf || "latest",
        latestDate: "",
        archetype: testCase.archetype || "",
        humanLabel: testCase.humanLabel || "",
        provider: "",
        chartBars: 0,
        display: { key: "error", state: "error", label: "Error de datos", reason: error.message || String(error) },
        pattern: {},
        diagnostic: {},
        calibration: { expected: normalizedBucket(testCase.expect?.calibrationBucket), actual: "block" },
        checks: [],
        ok: false,
        failures: [{ label: "data", expected: "chart", actual: error.message || String(error) }],
      });
    }
  }

  const failed = results.filter((item) => !item.ok);
  const calibration = calibrationSummary(results);
  const aggregate = aggregateFailures(dataset, calibration);
  const payload = {
    ok: failed.length === 0 && aggregate.length === 0,
    version: dataset.version,
    cases: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    baseUrl: BASE_URL,
    outputPath: OUTPUT_PATH,
    refresh: refreshMode,
    maxPriceAgeDays: MAX_PRICE_AGE_DAYS,
    calibration,
    aggregateFailures: aggregate,
    results,
  };
  const output = MARKDOWN_OUTPUT ? markdownReport(payload) : JSON.stringify(payload, null, 2);
  if (OUTPUT_PATH) await fs.writeFile(OUTPUT_PATH, output);
  console.log(output);

  if (failed.length || aggregate.length) {
    const caseSummary = failed.map((item) => `${item.symbol}: ${item.failures.map((check) => `${check.label} expected ${check.expected}, got ${check.actual}`).join("; ")}`).join(" | ");
    const aggregateSummary = aggregate.map((item) => `${item.label} expected ${item.expected}, got ${item.actual}`).join(" | ");
    throw new Error(`VCP corpus audit failed ${failed.length}/${results.length}: ${[caseSummary, aggregateSummary].filter(Boolean).join(" | ")}`);
  }
}

main().catch((error) => {
  console.error(`FAIL vcp-corpus-audit: ${error.message}`);
  process.exitCode = 1;
});
