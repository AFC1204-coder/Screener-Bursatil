import fs from "node:fs/promises";
import { BASE_URL, getMethodologyBrief, PRICE_MAX_AGE_DAYS, PROFILE_MAX_AGE_DAYS, REFRESH, verdictFromBrief } from "./methodology-audit-utils.mjs";

const CASES_PATH = process.env.METHODOLOGY_CASES_PATH || "docs/methodology/validation-cases.json";
const LIMIT = Math.max(1, Number(process.env.METHODOLOGY_REVIEW_LIMIT || 30));
const INCLUDE_ACTIVE = process.env.METHODOLOGY_REVIEW_INCLUDE_ACTIVE === "1";
const JSON_OUTPUT = process.env.METHODOLOGY_REVIEW_JSON === "1";

function fmtPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "";
}

function fmtRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : "";
}

function mdEscape(value = "") {
  return String(value || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function calibrationBucket(verdict = {}) {
  if (verdict.planValid) return "plan";
  if (verdict.watch) return "watch";
  if (verdict.observable) return "observe";
  return "block";
}

function reviewCandidate(caseDef = {}, brief = {}) {
  const verdict = verdictFromBrief(brief);
  return {
    id: caseDef.id,
    symbol: caseDef.symbol,
    active: caseDef.active !== false,
    reviewStatus: caseDef.reviewStatus || (caseDef.active === false ? "pending" : "reviewed"),
    focus: caseDef.reviewFocus || [],
    theme: brief.theme,
    sector: brief.sector,
    industry: brief.industry,
    chartBars: brief.chartBars,
    verdict,
    calibrationBucket: calibrationBucket(verdict),
  };
}

function failedCandidate(caseDef = {}, error) {
  return {
    id: caseDef.id,
    symbol: caseDef.symbol,
    active: caseDef.active !== false,
    reviewStatus: "error",
    focus: caseDef.reviewFocus || [],
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
      patternDataStatus: "error",
      patternQualityScore: null,
    },
    calibrationBucket: "block",
  };
}

function printMarkdown(results = [], dataset = {}) {
  const lines = [
    `# Methodology Review Queue`,
    "",
    `Dataset version: ${dataset.version || "unknown"}`,
    `Base URL: ${BASE_URL}`,
    `Refresh: ${REFRESH ? "yes" : "no"} · Profile max age: ${PROFILE_MAX_AGE_DAYS}d · Price max age: ${PRICE_MAX_AGE_DAYS}d`,
    "",
    "| Symbol | Status | Theme | Verdict | Bucket | Plan valid | Evidence | Focus |",
    "|---|---|---|---|---|---:|---|---|",
  ];
  for (const item of results) {
    const evidence = [
      item.verdict.reason,
      item.verdict.contractionCount != null ? `${item.verdict.contractionCount} contr.` : "",
      item.verdict.distanceToPivotPct != null ? `pivot ${fmtPct(item.verdict.distanceToPivotPct)}` : "",
      item.verdict.volumeDryUpRatio != null ? `vol ${fmtRatio(item.verdict.volumeDryUpRatio)}` : "",
      item.verdict.patternQualityScore != null ? `q ${item.verdict.patternQualityScore.toFixed(0)}` : "",
    ].filter(Boolean).join("; ");
    lines.push([
      mdEscape(item.symbol),
      mdEscape(item.reviewStatus),
      mdEscape(item.theme),
      mdEscape(`${item.verdict.label} (${item.verdict.key}/${item.verdict.state})`),
      mdEscape(item.calibrationBucket),
      item.verdict.planValid ? "yes" : "no",
      mdEscape(evidence),
      mdEscape((item.focus || []).join(", ")),
    ].join(" | "));
  }
  console.log(lines.join("\n"));
}

async function main() {
  const raw = await fs.readFile(CASES_PATH, "utf8");
  const dataset = JSON.parse(raw);
  const cases = (dataset.cases || [])
    .filter((item) => item.symbol)
    .filter((item) => INCLUDE_ACTIVE || item.active === false || item.reviewStatus === "pending")
    .slice(0, LIMIT);

  const results = [];
  for (const item of cases) {
    try {
      const brief = await getMethodologyBrief(item.symbol);
      results.push(reviewCandidate(item, brief));
    } catch (error) {
      results.push(failedCandidate(item, error));
    }
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      ok: true,
      version: dataset.version,
      count: results.length,
      baseUrl: BASE_URL,
      refresh: REFRESH,
      results,
    }, null, 2));
    return;
  }

  printMarkdown(results, dataset);
}

main().catch((error) => {
  console.error(`FAIL methodology-review-report: ${error.message}`);
  process.exitCode = 1;
});
