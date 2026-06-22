import { businessThemeKey } from "../lib/businessTheme.js";
import { methodologyDisplayForRow } from "../lib/methodologyDisplay.js";
import { methodologyVerdictForRow } from "../lib/methodologyVerdict.js";
import { setupPatternForBars } from "../lib/setupPatterns.js";

export const BASE_URL = process.env.METHODOLOGY_AUDIT_BASE_URL || "http://127.0.0.1:3000";
export const TOKEN = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
export const REFRESH = process.env.METHODOLOGY_AUDIT_REFRESH === "1";
export const PROFILE_MAX_AGE_DAYS = Math.max(0, Number(process.env.METHODOLOGY_AUDIT_MAX_PROFILE_AGE_DAYS || 14));
export const PRICE_MAX_AGE_DAYS = Math.max(0, Number(process.env.METHODOLOGY_AUDIT_MAX_PRICE_AGE_DAYS || 5));
export const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.METHODOLOGY_AUDIT_TIMEOUT_MS || 45000));

export async function getJson(path) {
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

export function requestPath(path = "", params = {}) {
  const search = new URLSearchParams(params);
  if (REFRESH) {
    search.set("cache", "0");
    search.set("refresh", "1");
  }
  return `${path}?${search.toString()}`;
}

export async function getMethodologyBrief(symbol = "") {
  const [profile, chart] = await Promise.all([
    getJson(requestPath("/api/profile", {
      symbol,
      maxAgeDays: String(PROFILE_MAX_AGE_DAYS),
    })),
    getJson(requestPath("/api/chart", {
      symbol,
      range: "MAX",
      interval: "D",
      maxAgeDays: String(PRICE_MAX_AGE_DAYS),
    })),
  ]);
  const setupPattern = setupPatternForBars(Array.isArray(chart.bars) ? chart.bars : []);
  const verdict = methodologyVerdictForRow(setupPattern);
  const display = methodologyDisplayForRow(setupPattern);
  return {
    symbol,
    name: profile.name || profile.longName || profile.shortName || symbol,
    sector: profile.sector || chart.meta?.sector || "",
    industry: profile.industry || chart.meta?.industry || "",
    theme: businessThemeKey(profile.sector || "", profile.industry || "", profile.businessSummary || profile.summary || ""),
    chartProvider: chart.meta?.dataProvider || "",
    chartBars: Array.isArray(chart.bars) ? chart.bars.length : 0,
    setupPattern: {
      ...setupPattern,
      setupVerdictKey: verdict.key,
      setupVerdictState: verdict.state,
      setupVerdictLabel: verdict.label,
      setupVerdictReason: verdict.reason,
      setupDataConfidenceKey: verdict.dataConfidence?.key,
      setupDataConfidenceLabel: verdict.dataConfidence?.label,
      setupPlanValid: verdict.actionable && verdict.tradePlanEligible && !verdict.blocksPatternClaim,
      setupActionable: verdict.actionable,
      setupObservable: verdict.observable,
      setupWatch: verdict.watch,
      setupStrict: verdict.strict,
      setupDisplayKey: display.key,
      setupDisplayState: display.state,
      setupDisplayLabel: display.label,
      setupDisplayShortLabel: display.shortLabel,
      setupDisplayReason: display.reason,
      setupDisplayLine: display.line,
      setupDisplayDataLimited: display.dataLimited,
      setupDisplayBlocksPatternClaim: display.blocksPatternClaim,
      setupDisplayPlanValid: display.actionable && display.tradePlanEligible && !display.blocksPatternClaim,
      setupDisplayActionable: display.actionable,
      setupDisplayObservable: display.observable,
      setupDisplayWatch: display.watch,
      setupDisplayStrict: display.strict,
      setupDisplayTradePlanEligible: display.tradePlanEligible,
      setupDisplayConfidenceKey: display.confidence?.key,
      setupDisplayConfidenceLabel: display.confidence?.label,
    },
  };
}

export function verdictFromBrief(brief = {}) {
  const pattern = brief.setupPattern || {};
  const display = methodologyDisplayForRow(pattern);
  const actionable = display.actionable === true;
  const tradePlanEligible = display.tradePlanEligible === true;
  const blocksPatternClaim = display.blocksPatternClaim === true;
  const planValid = actionable && tradePlanEligible && !blocksPatternClaim;
  return {
    key: display.key || pattern.setupVerdictKey || "",
    state: display.state || pattern.setupVerdictState || "",
    label: display.label || pattern.setupVerdictLabel || "",
    shortLabel: display.shortLabel || "",
    reason: display.reason || pattern.setupVerdictReason || "",
    line: display.line || "",
    planValid,
    actionable,
    observable: display.observable === true,
    watch: display.watch === true,
    strict: display.strict === true,
    tradePlanEligible,
    dataLimited: display.dataLimited === true,
    blocksPatternClaim,
    dataConfidenceKey: display.confidence?.key || pattern.setupDataConfidenceKey || "",
    dataConfidenceLabel: display.confidence?.label || pattern.setupDataConfidenceLabel || "",
    engineKey: pattern.setupVerdictKey || "",
    engineState: pattern.setupVerdictState || "",
    engineLabel: pattern.setupVerdictLabel || "",
    patternDataStatus: pattern.patternDataStatus || "",
    patternQualityScore: Number.isFinite(pattern.patternQualityScore) ? pattern.patternQualityScore : null,
    contractionCount: Number.isFinite(pattern.contractionCount) ? pattern.contractionCount : null,
    contractionsDecreasing: pattern.contractionsDecreasing === true,
    distanceToPivotPct: Number.isFinite(pattern.distanceToPivotPct) ? pattern.distanceToPivotPct : null,
    baseDepthPct: Number.isFinite(pattern.baseDepthPct) ? pattern.baseDepthPct : null,
    volumeDryUpRatio: Number.isFinite(pattern.volumeDryUpRatio) ? pattern.volumeDryUpRatio : null,
  };
}
