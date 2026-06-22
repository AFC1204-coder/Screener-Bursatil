import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { setupPatternForBars } from "../lib/setupPatterns.js";

const CORPUS_PATH = process.env.VCP_CORPUS_PATH || "docs/methodology/vcp-corpus.json";
const BASE_URL = process.env.VCP_DEPTH_BASE_URL || process.env.VCP_CORPUS_BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
const REFRESH_ENV = process.env.VCP_DEPTH_REFRESH ?? process.env.VCP_CORPUS_REFRESH;
const MAX_PRICE_AGE_DAYS = Math.max(0, Number(process.env.VCP_DEPTH_MAX_PRICE_AGE_DAYS || process.env.VCP_CORPUS_MAX_PRICE_AGE_DAYS || 5));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.VCP_DEPTH_TIMEOUT_MS || 45000));
const TOLERANCE = Number(process.env.VCP_DEPTH_TOLERANCE || 1e-9);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function toDate(value = "") {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "sin dato";
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function refreshEnabled(testCase = {}, dataset = {}) {
  if (REFRESH_ENV === "1") return true;
  if (REFRESH_ENV === "0") return false;
  return testCase.refresh === true || dataset.defaultRefresh === true;
}

function chartPath(testCase = {}, dataset = {}) {
  const minBars = finite(testCase.expect?.minChartBars);
  const asOf = toDate(testCase.asOf || "");
  const params = new URLSearchParams({
    symbol: testCase.symbol || "",
    range: testCase.chartRange || "MAX",
    interval: testCase.chartInterval || "D",
    maxAgeDays: String(testCase.maxPriceAgeDays ?? MAX_PRICE_AGE_DAYS),
  });
  if (Number.isFinite(minBars)) params.set("minBars", String(Math.ceil(minBars)));
  if (asOf) params.set("asOf", asOf);
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

function swingAudit(testCase = {}, pattern = {}) {
  const accepted = Array.isArray(pattern.contractionSwings) ? pattern.contractionSwings : [];
  const measured = Array.isArray(pattern.measuredContractionSwings) && pattern.measuredContractionSwings.length
    ? pattern.measuredContractionSwings
    : accepted;
  return measured.map((swing, index) => {
    const acceptedSwing = index < accepted.length && swing !== pattern.rejectedContractionSwing;
    const high = finite(swing.high);
    const low = finite(swing.low);
    const actual = finite(swing.depthPct);
    const stored = acceptedSwing
      ? finite(pattern.contractionDepths?.[index])
      : finite(pattern.rejectedContractionDepthPct ?? swing.depthPct);
    const expected = Number.isFinite(high) && Number.isFinite(low) && high > 0 ? ((high - low) / high) * 100 : null;
    const formulaError = Number.isFinite(actual) && Number.isFinite(expected) ? Math.abs(actual - expected) : Infinity;
    const storedError = Number.isFinite(stored) && Number.isFinite(actual) ? Math.abs(stored - actual) : Infinity;
    return {
      caseId: testCase.id || "",
      symbol: testCase.symbol || "",
      asOf: testCase.asOf || "latest",
      label: acceptedSwing ? `C${index + 1}` : `C${accepted.length + 1} rechazada`,
      accepted: acceptedSwing,
      high,
      low,
      expected,
      actual,
      stored,
      formulaError,
      storedError,
      ok: formulaError <= TOLERANCE && storedError <= TOLERANCE,
    };
  });
}

function cacheHitMeta(chart = {}) {
  const cache = chart.meta?.cache || {};
  if (cache.hit === true) return cache;
  if (cache.read?.hit === true) return cache.read;
  return null;
}

function expectationFailures(testCase = {}, chart = {}, bars = [], pattern = {}, audits = []) {
  const expect = testCase.expect || {};
  const failures = [];
  const minBars = finite(expect.minChartBars);
  const minContractions = finite(expect.minContractionCount);
  const minMeasuredContractions = finite(expect.minMeasuredContractionCount);
  const allowedStructures = array(expect.contractionStructureStatusAllowed);
  const structure = pattern.contractionStructureStatus || "";
  if (Number.isFinite(minBars) && bars.length < minBars) failures.push(`chartBars ${bars.length} < ${minBars}`);
  const cacheHit = cacheHitMeta(chart);
  const asOfRows = finite(cacheHit?.asOfRows ?? cacheHit?.rows);
  if (cacheHit && Number.isFinite(minBars) && (!Number.isFinite(asOfRows) || asOfRows < minBars)) failures.push(`cache asOfRows ${Number.isFinite(asOfRows) ? asOfRows : "blank"} < ${minBars}`);
  const acceptedSwings = audits.filter((item) => item.accepted).length;
  const rejectedSwings = audits.filter((item) => !item.accepted).length;
  if (Number.isFinite(minContractions) && acceptedSwings < minContractions) failures.push(`accepted swings ${acceptedSwings} < ${minContractions}`);
  if (Number.isFinite(minMeasuredContractions) && audits.length < minMeasuredContractions) failures.push(`measured swings ${audits.length} < ${minMeasuredContractions}`);
  if (typeof expect.rejectedContraction === "boolean" && Boolean(rejectedSwings) !== expect.rejectedContraction) failures.push(`rejected swing ${Boolean(rejectedSwings)} != ${expect.rejectedContraction}`);
  if (allowedStructures.length && !allowedStructures.includes(structure)) failures.push(`structure ${structure || "blank"} not in ${allowedStructures.join(", ")}`);
  return failures;
}

async function main() {
  const dataset = JSON.parse(await fs.readFile(CORPUS_PATH, "utf8"));
  const cases = (dataset.cases || []).filter((item) => item.active !== false);
  assert.ok(cases.length, "VCP corpus must include active cases");

  const caseResults = [];
  const checks = [];
  for (const testCase of cases) {
    const chart = await getJson(chartPath(testCase, dataset));
    const bars = barsThroughAsOf(chart.bars || [], testCase.asOf || "latest");
    const pattern = setupPatternForBars(bars, { referenceDate: referenceDateForAsOf(testCase.asOf) });
    const audits = swingAudit(testCase, pattern);
    const expectationIssues = expectationFailures(testCase, chart, bars, pattern, audits);
    caseResults.push({
      id: testCase.id,
      symbol: testCase.symbol,
      asOf: testCase.asOf || "latest",
      chartBars: bars.length,
      swings: audits.filter((item) => item.accepted).length,
      measuredSwings: audits.length,
      depths: audits.filter((item) => item.accepted).map((item) => fmt(item.actual, 1)).join(" -> "),
      rejectedDepths: audits.filter((item) => !item.accepted).map((item) => fmt(item.actual, 1)).join(" -> "),
      structure: pattern.contractionStructureStatus || "",
      expectationIssues,
    });
    checks.push(...audits);
  }

  const failed = checks.filter((item) => !item.ok);
  const expectationFailuresList = caseResults.flatMap((item) => item.expectationIssues.map((issue) => ({ ...item, issue })));
  const casesWithSwings = caseResults.filter((item) => item.swings > 0).length;
  const rejectedSwings = checks.filter((item) => !item.accepted).length;
  const maxFormulaError = checks.length ? Math.max(...checks.map((item) => item.formulaError)) : 0;
  const maxStoredError = checks.length ? Math.max(...checks.map((item) => item.storedError)) : 0;
  const samples = checks
    .filter((item) => ["META", "NVDA", "BRK-B", "AAPL"].includes(item.symbol))
    .slice(0, 5);

  assert.ok(checks.length >= 20, `Expected at least 20 real contraction swings, got ${checks.length}`);
  assert.equal(failed.length, 0, failed.map((item) => `${item.caseId} ${item.label}`).join(", "));
  assert.equal(expectationFailuresList.length, 0, expectationFailuresList.map((item) => `${item.id}: ${item.issue}`).join("; "));

  console.log(`# VCP Real Depth Audit\n`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Cases: ${caseResults.length} · with contractions: ${casesWithSwings} · accepted swings: ${checks.filter((item) => item.accepted).length} · rejected checked: ${rejectedSwings} · measured checked: ${checks.length}`);
  console.log(`Max formula error: ${maxFormulaError} · max stored-depth error: ${maxStoredError}`);
  console.log(`Result: OK\n`);
  console.log(`| Symbol | As of | Accepted | Rejected | Depths | Structure | Bars | Corpus checks |`);
  console.log(`|---|---:|---:|---:|---|---|---:|---|`);
  for (const item of caseResults) {
    console.log(`| ${item.symbol} | ${item.asOf} | ${item.swings} | ${item.rejectedDepths || "-"} | ${item.depths || "-"} | ${item.structure || "-"} | ${item.chartBars} | ${item.expectationIssues.length ? item.expectationIssues.join("; ") : "OK"} |`);
  }
  console.log(`\nSample formula checks:`);
  for (const item of samples) {
    console.log(`- ${item.symbol} ${item.asOf} ${item.label}: (${fmt(item.high, 4)} - ${fmt(item.low, 4)}) / ${fmt(item.high, 4)} * 100 = ${fmt(item.expected, 4)}%; stored ${fmt(item.actual, 4)}%`);
  }
}

main().catch((error) => {
  console.error(`FAIL vcp-real-depth-audit: ${error.message || error}`);
  process.exitCode = 1;
});
