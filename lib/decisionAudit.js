import { DECISION_TRACE_ENGINE_VERSION, DECISION_TRACE_SCHEMA_VERSION, isDecisionTraceVersionCurrent } from "@/lib/decisionTraceVersion";
import { buildDecisionBrief, buildDecisionEvidenceChecklist, explainScreenerRank } from "@/lib/screenerExplainability";
import { DATA_HEALTH_FILTER_ORDER, buildScreenerDataHealth, buildScreenerDataHealthSummary, dataHealthFilterLabel } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAuditSummary, compactScreenerScoreAudit } from "@/lib/screenerScoreAudit";

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function pct(part, total) {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function compactDataHealthForAudit(health = null) {
  if (!health || typeof health !== "object") return null;
  return {
    schemaVersion: health.schemaVersion || 1,
    status: health.status || null,
    coverageScore: health.coverageScore ?? null,
    freshness: health.freshness ? {
      label: health.freshness.label || "",
      detail: health.freshness.detail || "",
      days: health.freshness.days ?? null,
      maxDays: health.freshness.maxDays ?? null,
      ok: health.freshness.ok === true,
      stale: health.freshness.stale === true,
      tone: health.freshness.tone || "",
    } : null,
    provider: health.provider ? {
      label: health.provider.label || "",
      tone: health.provider.tone || "",
      detail: health.provider.detail || "",
    } : null,
    issues: Array.isArray(health.issues) ? health.issues.slice(0, 5) : [],
    topLine: health.topLine || "",
  };
}

function compactDataHealthSummary(summary = null) {
  if (!summary || typeof summary !== "object") return null;
  return {
    schemaVersion: summary.schemaVersion || 1,
    rows: summary.rows || 0,
    readyCount: summary.readyCount || 0,
    attentionCount: summary.attentionCount || 0,
    readyShare: summary.readyShare || "0%",
    attentionShare: summary.attentionShare || "0%",
    verdict: summary.verdict || null,
    counts: summary.counts || {},
    items: Array.isArray(summary.items) ? summary.items : [],
    topIssues: Array.isArray(summary.topIssues) ? summary.topIssues.slice(0, 8) : [],
  };
}

function combinedDataHealthSummary(scanAudits = []) {
  const counts = new Map(DATA_HEALTH_FILTER_ORDER.map((key) => [key, 0]));
  const issueCounts = new Map();
  let rows = 0;
  for (const scan of scanAudits) {
    const summary = scan.dataHealth || {};
    rows += Number(summary.rows || 0);
    for (const key of DATA_HEALTH_FILTER_ORDER) {
      counts.set(key, (counts.get(key) || 0) + Number(summary.counts?.[key] || 0));
    }
    for (const issue of summary.topIssues || []) {
      const key = issue.key || issue.label;
      if (!key) continue;
      const bucket = issueCounts.get(key) || { key, label: issue.label || key, tone: issue.tone || "warn", count: 0 };
      bucket.count += Number(issue.count || 0);
      issueCounts.set(key, bucket);
    }
  }
  const readyCount = counts.get("ready") || 0;
  const attentionCount = Math.max(0, rows - readyCount);
  const topIssues = [...issueCounts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8)
    .map((item) => ({ ...item, share: pct(item.count, rows) }));
  return {
    schemaVersion: 1,
    rows,
    readyCount,
    attentionCount,
    readyShare: pct(readyCount, rows),
    attentionShare: pct(attentionCount, rows),
    counts: Object.fromEntries(counts.entries()),
    items: DATA_HEALTH_FILTER_ORDER.map((key) => {
      const count = counts.get(key) || 0;
      return {
        key,
        label: dataHealthFilterLabel(key, { compact: true }),
        fullLabel: dataHealthFilterLabel(key),
        count,
        share: pct(count, rows),
      };
    }).filter((item) => item.count > 0),
    topIssues,
  };
}

function combinedScoreAuditSummary(scanAudits = []) {
  const counts = new Map([["good", 0], ["warn", 0], ["bad", 0], ["neutral", 0]]);
  const missingCounts = new Map();
  const dragCounts = new Map();
  const riskCounts = new Map();
  let rows = 0;
  let cleanCount = 0;
  let mismatchCount = 0;
  let missingRows = 0;
  for (const scan of scanAudits) {
    const summary = scan.scoreAudit || {};
    rows += Number(summary.rows || 0);
    cleanCount += Number(summary.cleanCount || 0);
    mismatchCount += Number(summary.mismatchCount || 0);
    missingRows += Number(summary.missingRows || 0);
    for (const [key, value] of Object.entries(summary.counts || {})) {
      counts.set(key, (counts.get(key) || 0) + Number(value || 0));
    }
    for (const source of [
      [summary.topMissing || [], missingCounts],
      [summary.topDrags || [], dragCounts],
      [summary.topRisks || [], riskCounts],
    ]) {
      const [items, target] = source;
      for (const item of items) {
        const key = item.key || item.label;
        if (!key) continue;
        const bucket = target.get(key) || { key, label: item.label || key, tone: item.tone || "warn", count: 0 };
        bucket.count += Number(item.count || 0);
        target.set(key, bucket);
      }
    }
  }
  const attentionCount = Math.max(0, rows - cleanCount);
  const rank = (map, limit = 6) => [...map.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((item) => ({ ...item, share: pct(item.count, rows) }));
  const verdict = !rows
    ? { key: "empty", label: "Sin resultados", tone: "muted", detail: "Ejecuta un scan para auditar score." }
    : mismatchCount
      ? { key: "residual", label: "Revisar fórmula", tone: "warn", detail: `${mismatchCount} filas con diferencia relevante vs score mostrado.` }
      : missingRows
        ? { key: "missing", label: "Score incompleto", tone: "warn", detail: `${missingRows} filas con componentes sin dato.` }
        : { key: "clean", label: "Score trazable", tone: "good", detail: `${cleanCount} filas con score reconciliado.` };
  return {
    schemaVersion: 1,
    rows,
    cleanCount,
    attentionCount,
    cleanShare: pct(cleanCount, rows),
    attentionShare: pct(attentionCount, rows),
    mismatchCount,
    missingRows,
    counts: Object.fromEntries(counts.entries()),
    verdict,
    topMissing: rank(missingCounts),
    topDrags: rank(dragCounts),
    topRisks: rank(riskCounts),
  };
}

function rowNumber(row = {}, key) {
  const value = row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rowText(row = {}, key) {
  return String(row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key] ?? "").trim();
}

function missingDecisionEvidence(row = {}) {
  return [
    ["dataCoverageScore", "cobertura datos"],
    ["technicalCoverageScore", "cobertura tecnica"],
    ["fundamentalCoverageScore", "cobertura fundamental"],
    ["rsQualityScore", "RS calidad"],
  ].filter(([key]) => rowNumber(row, key) == null).map(([, label]) => label);
}

function explain(row, scan) {
  return explainScreenerRank(row, scan.activeSettings || scan.settings?.activeSettings || scan.settings || {});
}

const LONG_BIASED_ACTIONS = new Set(["candidate-long", "candidate-with-watch", "strong-profile", "watch-setup"]);
const LEADERSHIP_DRIVER_KEYS = ["rs-global", "rs-group", "rs-quality", "weinstein", "minervini"];
const CONFIRMATION_DRIVER_KEYS = ["rs-global", "rs-group", "weinstein", "minervini", "volume-effect", "ad-proxy", "growth", "eps", "risk-reward"];
const EXECUTION_DRIVER_KEYS = ["volume-effect", "ad-proxy", "relative-volume", "growth", "eps", "risk-reward"];
const OPERABLE_CONFLUENCE_TARGETS = { leadership: 3, confirmation: 5, execution: 2 };

function issueSeverityRank(severity = "warn") {
  if (severity === "bad") return 3;
  if (severity === "warn") return 2;
  return 1;
}

function addIssue(list, issue) {
  if (!issue?.key || list.some((item) => item.key === issue.key)) return;
  list.push({ severity: "warn", ...issue });
}

function countDriverKeys(driverKeys, keys = []) {
  return keys.reduce((sum, key) => sum + (driverKeys.has(key) ? 1 : 0), 0);
}

function confluenceProfile(driverKeys) {
  return {
    leadership: countDriverKeys(driverKeys, LEADERSHIP_DRIVER_KEYS),
    confirmation: countDriverKeys(driverKeys, CONFIRMATION_DRIVER_KEYS),
    execution: countDriverKeys(driverKeys, EXECUTION_DRIVER_KEYS),
  };
}

function confluenceDetail(profile = {}) {
  return `liderazgo ${profile.leadership || 0}/${OPERABLE_CONFLUENCE_TARGETS.leadership} · confirmación ${profile.confirmation || 0}/${OPERABLE_CONFLUENCE_TARGETS.confirmation} · ejecución ${profile.execution || 0}/${OPERABLE_CONFLUENCE_TARGETS.execution}`;
}

function minimumConfluence(profile = {}) {
  return profile.leadership < OPERABLE_CONFLUENCE_TARGETS.leadership
    || profile.confirmation < OPERABLE_CONFLUENCE_TARGETS.confirmation
    || profile.execution < OPERABLE_CONFLUENCE_TARGETS.execution;
}

function uniqueWatch(explanation = {}) {
  const seen = new Set();
  return [...(explanation.displayWatch || []), ...(explanation.watch || [])].filter((item) => {
    const key = item?.key || item?.label;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function auditDriverKeys(row = {}, explanation = {}) {
  const keys = new Set((explanation.drivers || []).map((item) => item.key));
  const addScore = (key, value, threshold) => {
    const number = rowNumber(row, value);
    if (number != null && number >= threshold) keys.add(key);
  };
  if (row.setupDisplayPlanValid === true) keys.add("setup-plan");
  if (row.setupDisplayStrict === true) keys.add("setup-strict");
  if (row.setupDisplayWatch === true) keys.add("setup-watch");
  const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating");
  if (rs != null && rs >= 72) keys.add("rs-global");
  addScore("rs-group", "rsSectorPct", 70);
  addScore("rs-quality", "rsQualityScore", 68);
  addScore("weinstein", "weinsteinScore", 72);
  addScore("minervini", "minerviniScore", 72);
  addScore("volume-effect", "volumeEffectScore", 68);
  addScore("ad-proxy", "adProxyScore", 68);
  addScore("growth", "growthScore", 64);
  addScore("eps", "epsGrowthProxyScore", 64);
  addScore("risk-reward", "riskRewardScore", 68);
  const relativeVolume = rowNumber(row, "relativeVolume");
  if (relativeVolume != null && relativeVolume >= 1.5) keys.add("relative-volume");
  return keys;
}

function rowIssueSample(row = {}, explanation = {}, issues = [], confidence = null) {
  return {
    symbol: row.symbol,
    companyName: row.companyName || row.name || "",
    action: explanation.action?.label || explanation.action?.key || "",
    readiness: explanation.readiness?.label || explanation.readiness?.key || "",
    confidence: confidence?.label || "",
    confidenceKey: confidence?.key || "",
    confidenceScore: Number.isFinite(confidence?.score) ? confidence.score : null,
    objectiveScore: rowNumber(row, "objectiveScore"),
    totalScore: rowNumber(row, "totalScore"),
    rs: rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating"),
    extSma50: rowNumber(row, "extSma50"),
    riskRewardScore: rowNumber(row, "riskRewardScore"),
    confluence: confidence?.confluence || null,
    issues: issues.map((item) => item.label).slice(0, 4),
  };
}

function compactDecisionItem(item = {}) {
  return {
    key: String(item.key || item.label || "").slice(0, 80),
    label: String(item.label || item.key || "").slice(0, 120),
    ...(item.value !== undefined && item.value !== null && item.value !== "" ? { value: String(item.value).slice(0, 80) } : {}),
    ...(item.tone ? { tone: String(item.tone).slice(0, 24) } : {}),
    ...(item.text ? { text: String(item.text).slice(0, 180) } : {}),
    ...(item.detail ? { detail: String(item.detail).slice(0, 180) } : {}),
    ...(item.severity ? { severity: String(item.severity).slice(0, 24) } : {}),
  };
}

function compactDecisionState(item = {}) {
  return {
    key: item.key || "",
    label: item.label || item.key || "",
    tone: item.tone || "",
    detail: item.detail || "",
  };
}

function compactDecisionEvidence(evidence = null) {
  if (!evidence || typeof evidence !== "object") return null;
  const item = (entry = {}) => ({
    key: String(entry.key || entry.label || "").slice(0, 80),
    label: String(entry.label || entry.key || "").slice(0, 120),
    status: String(entry.status || "").slice(0, 40),
    statusLabel: String(entry.statusLabel || "").slice(0, 80),
    tone: String(entry.tone || "").slice(0, 24),
    detail: String(entry.detail || "").slice(0, 180),
  });
  const methodology = evidence.methodology && typeof evidence.methodology === "object" ? {
    schemaVersion: evidence.methodology.schemaVersion || 1,
    status: String(evidence.methodology.status || "").slice(0, 40),
    tone: String(evidence.methodology.tone || "").slice(0, 24),
    readyShare: String(evidence.methodology.readyShare || "").slice(0, 24),
    categories: Array.isArray(evidence.methodology.categories) ? evidence.methodology.categories.map(item).slice(0, 12) : [],
    pending: Array.isArray(evidence.methodology.pending) ? evidence.methodology.pending.map(item).slice(0, 8) : [],
  } : null;
  return {
    schemaVersion: Number(evidence.schemaVersion || 1),
    status: String(evidence.status || "").slice(0, 40),
    tone: String(evidence.tone || "").slice(0, 24),
    passedCount: Number.isFinite(Number(evidence.passedCount)) ? Number(evidence.passedCount) : 0,
    totalCount: Number.isFinite(Number(evidence.totalCount)) ? Number(evidence.totalCount) : 0,
    summary: String(evidence.summary || "").slice(0, 180),
    items: Array.isArray(evidence.items) ? evidence.items.map(item).slice(0, 12) : [],
    pending: Array.isArray(evidence.pending) ? evidence.pending.map(item).slice(0, 8) : [],
    ...(methodology ? { methodology } : {}),
  };
}

const READINESS_PRIORITY = {
  operable: 1000,
  watch: 660,
  audit: 260,
  reject: 80,
  bearish: 40,
};

export const DECISION_CONFIDENCE_META = {
  high: { label: "Alta", tone: "good" },
  medium: { label: "Media", tone: "warn" },
  low: { label: "Baja", tone: "warn" },
  "very-low": { label: "Muy baja", tone: "bad" },
};

export const DECISION_CONFIDENCE_ORDER = ["high", "medium", "low", "very-low"];

const ACTION_PRIORITY = {
  "candidate-long": 160,
  "strong-profile": 110,
  "candidate-with-watch": 80,
  "watch-setup": 55,
  watchlist: 35,
  "high-risk": -80,
  "check-data": -120,
  "avoid-long": -180,
  "bearish-watch": -220,
  unclear: -90,
};

function roundPriority(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function issuePenalty(issue = {}) {
  if (issue.key === "long-not-operable") return 190;
  if (issue.key === "missing-global-rs") return 180;
  if (issue.key === "incomplete-decision-evidence") return 190;
  if (issue.key === "needs-data-audit") return 150;
  if (issue.severity === "bad") return 130;
  if (issue.key === "thin-confirmation") return 75;
  if (issue.key === "minimum-confluence") return 170;
  if (issue.key === "overextended-sma50") return 70;
  if (issue.key === "low-risk-reward") return 65;
  if (issue.severity === "warn") return 55;
  return 20;
}

export function decisionConfidenceBand(score) {
  const value = Number(score);
  if (Number.isFinite(value) && value >= 80) return "high";
  if (Number.isFinite(value) && value >= 62) return "medium";
  if (Number.isFinite(value) && value >= 42) return "low";
  return "very-low";
}

export function decisionConfidenceLabel(key, fallback = key) {
  return DECISION_CONFIDENCE_META[key]?.label || fallback;
}

export function auditDecisionRowIssues(row = {}, settingsOrExplanation = {}) {
  if (row?.__screenerAnnotation?.issues && (!settingsOrExplanation || (settingsOrExplanation?.action && settingsOrExplanation?.readiness))) {
    return row.__screenerAnnotation.issues;
  }
  const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
  const issues = [];
  const actionKey = explanation.action?.key || "";
  const readinessKey = explanation.readiness?.key || "";
  const longBiased = LONG_BIASED_ACTIONS.has(actionKey);
  const driverKeys = auditDriverKeys(row, explanation);
  const watchKeys = new Set(uniqueWatch(explanation).map((item) => item.key));
  const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating");
  const extSma50 = rowNumber(row, "extSma50");
  const riskReward = rowNumber(row, "riskRewardScore");
  const weakness = rowNumber(row, "weaknessScore");
  const dataCoverage = rowNumber(row, "dataCoverageScore");
  const technicalCoverage = rowNumber(row, "technicalCoverageScore");
  const fundamentalCoverage = rowNumber(row, "fundamentalCoverageScore");
  const missingEvidence = missingDecisionEvidence(row);

  if (row.decisionProjectionPartial) {
    addIssue(issues, {
      key: "partial-projection",
      label: "Proyección parcial",
      severity: "warn",
      detail: Array.isArray(row.decisionProjectionMissing) ? row.decisionProjectionMissing.join(", ") : "",
    });
  }
  if (longBiased && readinessKey !== "operable") {
    addIssue(issues, {
      key: "long-not-operable",
      label: "Candidato no operable",
      severity: actionKey === "candidate-long" ? "bad" : "warn",
      detail: explanation.readiness?.detail || "",
    });
  }
  if (longBiased && !driverKeys.has("rs-global")) {
    addIssue(issues, {
      key: "missing-global-rs",
      label: "Sin liderazgo RS global",
      severity: "bad",
      detail: Number.isFinite(rs) ? `RS ${rs.toFixed(0)}` : "RS no disponible",
    });
  } else if (longBiased && Number.isFinite(rs) && rs < 72) {
    addIssue(issues, {
      key: "low-global-rs",
      label: "RS global bajo",
      severity: "warn",
      detail: `RS ${rs.toFixed(0)} < 72`,
    });
  }
  if (longBiased && missingEvidence.length) {
    addIssue(issues, {
      key: "incomplete-decision-evidence",
      label: "Evidencia incompleta",
      severity: "warn",
      detail: `faltan ${missingEvidence.join(", ")}`,
    });
  }
  if (longBiased) {
    const profile = confluenceProfile(driverKeys);
    const { leadership, confirmation, execution } = profile;
    if (leadership < 2 || confirmation < 3 || execution < 1) {
      addIssue(issues, {
        key: "thin-confirmation",
        label: "Confirmación insuficiente",
        severity: "warn",
        detail: `liderazgo ${leadership}/2 · confirmación ${confirmation}/3 · ejecución ${execution}/1`,
      });
    }
    if (readinessKey === "operable" && minimumConfluence(profile)) {
      addIssue(issues, {
        key: "minimum-confluence",
        label: "Confluencia mínima",
        severity: "warn",
        detail: confluenceDetail(profile),
      });
    }
  }
  if (watchKeys.has("extension") || (Number.isFinite(extSma50) && extSma50 > 18)) {
    addIssue(issues, {
      key: "overextended-sma50",
      label: "Extendida sobre SMA50",
      severity: Number.isFinite(extSma50) && extSma50 > 32 ? "bad" : "warn",
      detail: Number.isFinite(extSma50) ? `${extSma50.toFixed(1)}%` : "",
    });
  }
  if (watchKeys.has("risk-reward-low") || (Number.isFinite(riskReward) && riskReward < 55)) {
    addIssue(issues, {
      key: "low-risk-reward",
      label: "Rent/riesgo bajo",
      severity: "warn",
      detail: Number.isFinite(riskReward) ? `${riskReward.toFixed(0)} < 55` : "",
    });
  }
  if (watchKeys.has("weakness") || (Number.isFinite(weakness) && weakness >= 50)) {
    addIssue(issues, {
      key: "technical-weakness",
      label: "Deterioro técnico",
      severity: Number.isFinite(weakness) && weakness >= 78 ? "bad" : "warn",
      detail: Number.isFinite(weakness) ? `${weakness.toFixed(0)}` : "",
    });
  }
  if (watchKeys.has("freshness") || row.priceFreshnessOk === false || rowText(row, "priceFreshnessIssue")) {
    addIssue(issues, {
      key: "stale-price",
      label: "Precio no fresco",
      severity: "warn",
      detail: rowText(row, "priceFreshnessIssue") || "",
    });
  }
  if (watchKeys.has("quality-gate") || watchKeys.has("methodology-limited") || actionKey === "check-data" || readinessKey === "audit") {
    addIssue(issues, {
      key: "needs-data-audit",
      label: "Requiere auditar datos",
      severity: readinessKey === "audit" ? "bad" : "warn",
      detail: explanation.readiness?.detail || "",
    });
  }
  if ((Number.isFinite(dataCoverage) && dataCoverage < 55) || (Number.isFinite(technicalCoverage) && technicalCoverage < 60) || (Number.isFinite(fundamentalCoverage) && fundamentalCoverage < 30)) {
    addIssue(issues, {
      key: "low-coverage",
      label: "Cobertura baja",
      severity: "warn",
      detail: `data ${dataCoverage ?? "-"} · técnico ${technicalCoverage ?? "-"} · fund ${fundamentalCoverage ?? "-"}`,
    });
  }

  return issues.sort((a, b) => issueSeverityRank(b.severity) - issueSeverityRank(a.severity) || a.key.localeCompare(b.key));
}

export function decisionPriorityScore(row = {}, settingsOrExplanation = {}) {
  return decisionPriorityBreakdown(row, settingsOrExplanation).score;
}

export function decisionPriorityBreakdown(row = {}, settingsOrExplanation = {}) {
  const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
  const issues = auditDecisionRowIssues(row, explanation);
  const readinessScore = READINESS_PRIORITY[explanation.readiness?.key] ?? 0;
  const actionScore = ACTION_PRIORITY[explanation.action?.key] ?? 0;
  const totalScore = rowNumber(row, "objectiveScore") ?? rowNumber(row, "totalScore") ?? rowNumber(row, "compositeScore") ?? 0;
  const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating") ?? 0;
  const riskReward = rowNumber(row, "riskRewardScore") ?? 45;
  const issueCost = issues.reduce((sum, issue) => sum + issuePenalty(issue), 0);
  const components = [
    {
      key: "readiness",
      label: "Decision",
      value: readinessScore,
      detail: explanation.readiness?.label || explanation.readiness?.key || "",
      tone: explanation.readiness?.tone || "",
    },
    {
      key: "action",
      label: "Accion",
      value: actionScore,
      detail: explanation.action?.label || explanation.action?.key || "",
      tone: explanation.action?.tone || "",
    },
    {
      key: "score",
      label: "Score objetivo",
      value: totalScore * 2.2,
      raw: totalScore,
      detail: Number.isFinite(totalScore) ? `${Math.round(totalScore)} x2.2` : "",
    },
    {
      key: "rs",
      label: "RS",
      value: rs * 1.2,
      raw: rs,
      detail: Number.isFinite(rs) ? `${Math.round(rs)} x1.2` : "",
    },
    {
      key: "riskReward",
      label: "Rent/riesgo",
      value: riskReward * 0.55,
      raw: riskReward,
      detail: Number.isFinite(riskReward) ? `${Math.round(riskReward)} x0.55` : "",
    },
  ].map((item) => ({ ...item, value: roundPriority(item.value), ...(Number.isFinite(item.raw) ? { raw: roundPriority(item.raw) } : {}) }));
  const score = components.reduce((sum, item) => sum + item.value, 0) - issueCost;
  return {
    schemaVersion: 1,
    score: roundPriority(score),
    formula: "decision + accion + score + RS + rent/riesgo - issues",
    components,
    issuePenalty: roundPriority(issueCost),
    penalties: issues.map((issue) => ({
      key: issue.key,
      label: issue.label,
      severity: issue.severity || "warn",
      value: issuePenalty(issue),
    })).slice(0, 8),
  };
}

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function decisionConfidenceSummary(row = {}, settingsOrExplanation = {}, knownIssues = null) {
  if (row?.__screenerAnnotation?.confidence && (!settingsOrExplanation || (settingsOrExplanation?.action && settingsOrExplanation?.readiness))) {
    return row.__screenerAnnotation.confidence;
  }
  const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
  const issues = Array.isArray(knownIssues) ? knownIssues : auditDecisionRowIssues(row, explanation);
  const driverKeys = auditDriverKeys(row, explanation);
  const confluence = confluenceProfile(driverKeys);
  const readinessBase = {
    operable: 76,
    watch: 58,
    audit: 34,
    reject: 20,
    bearish: 24,
  }[explanation.readiness?.key] ?? 35;
  const actionBoost = {
    "candidate-long": 8,
    "strong-profile": 5,
    "candidate-with-watch": 1,
    "watch-setup": 0,
    watchlist: -2,
    "check-data": -8,
    "high-risk": -12,
    "avoid-long": -15,
    "bearish-watch": -8,
    unclear: -10,
  }[explanation.action?.key] ?? 0;
  const confluenceBoost = explanation.mode === "weakness"
    ? 0
    : Math.min(confluence.leadership, 4) * 2
      + Math.min(confluence.confirmation, 6) * 1.35
      + Math.min(confluence.execution, 3) * 1.75;
  const issueCost = issues.reduce((sum, issue) => sum + issuePenalty(issue) * 0.11, 0);
  const score = clampScore(readinessBase + actionBoost + confluenceBoost - issueCost);
  const key = decisionConfidenceBand(score);
  const meta = DECISION_CONFIDENCE_META[key] || DECISION_CONFIDENCE_META["very-low"];
  const primaryIssue = issues[0];
  return {
    key,
    score: Number(score.toFixed(0)),
    label: meta.label,
    tone: meta.tone,
    detail: primaryIssue ? `${primaryIssue.label}: ${primaryIssue.detail || primaryIssue.severity || "revisar"}` : confluenceDetail(confluence),
    confluence,
    issueCount: issues.length,
    issuePenalty: Number(issueCost.toFixed(1)),
  };
}

export function buildDecisionTrace(row = {}, settingsOrExplanation = {}) {
  const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
  const issues = auditDecisionRowIssues(row, explanation);
  const priority = decisionPriorityBreakdown(row, explanation);
  const confidence = decisionConfidenceSummary(row, explanation, issues);
  const evidence = buildDecisionEvidenceChecklist(row, explanation);
  return {
    schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
    engineVersion: DECISION_TRACE_ENGINE_VERSION,
    priorityScore: priority.score,
    priority,
    confidence,
    evidence: compactDecisionEvidence(evidence),
    action: compactDecisionState(explanation.action),
    readiness: compactDecisionState(explanation.readiness),
    brief: buildDecisionBrief(row, explanation),
    issues: issues.map(compactDecisionItem).slice(0, 8),
    drivers: (explanation.drivers || []).map(compactDecisionItem).slice(0, 5),
    watch: uniqueWatch(explanation).map(compactDecisionItem).slice(0, 5),
    line: String(explanation.line || explanation.text || "").slice(0, 360),
  };
}

export function isDecisionTraceCurrent(trace = null, row = {}) {
  if (row?.decisionProjectionPartial === true) return false;
  if (!trace || typeof trace !== "object") return false;
  if (!isDecisionTraceVersionCurrent(trace)) return false;
  if (!trace.action?.key || !trace.readiness?.key) return false;
  if (!trace.confidence?.key || !Number.isFinite(Number(trace.confidence.score))) return false;
  if (!trace.priority || typeof trace.priority !== "object") return false;
  if (!Number.isFinite(Number(trace.priority.score))) return false;
  return Array.isArray(trace.priority.components) && trace.priority.components.length >= 3;
}

export function decisionTraceForRow(row = {}, settingsOrExplanation = {}) {
  if (settingsOrExplanation && typeof settingsOrExplanation === "object" && Object.keys(settingsOrExplanation).length) {
    return buildDecisionTrace(row, settingsOrExplanation);
  }
  return isDecisionTraceCurrent(row?.decisionTrace, row)
    ? row.decisionTrace
    : buildDecisionTrace(row, settingsOrExplanation);
}

export function attachDecisionTrace(row = {}, settingsOrExplanation = {}) {
  if (!row || typeof row !== "object") return row;
  return { ...row, decisionTrace: buildDecisionTrace(row, settingsOrExplanation) };
}

function addIssueStats(counts, samples, issue, sample) {
  counts.set(issue.key, {
    key: issue.key,
    label: issue.label,
    severity: issue.severity,
    count: (counts.get(issue.key)?.count || 0) + 1,
  });
  const list = samples.get(issue.key) || [];
  if (list.length < 5) list.push(sample);
  samples.set(issue.key, list);
}

function issueSummary(counts, samples, totalRows, limit = 8) {
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || issueSeverityRank(b.severity) - issueSeverityRank(a.severity) || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      share: pct(item.count, totalRows),
      sample: samples.get(item.key) || [],
    }));
}

export function compactErrorMessage(value = "") {
  const text = String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (/aborted|timeout|timed out/i.test(text)) return "Timeout consultando Supabase.";
  const cloudflare = text.match(/Error code\s*(\d+)/i)?.[1];
  if (cloudflare) return `Cloudflare ${cloudflare}: ${text.slice(0, 180)}`;
  return text.slice(0, 240);
}

export function normalizeDecisionAuditPayload(payload = {}) {
  if (Array.isArray(payload)) return { scans: payload };
  if (payload && typeof payload === "object" && Array.isArray(payload.rows)) return { scans: [payload] };
  return { ...(payload && typeof payload === "object" ? payload : {}), scans: Array.isArray(payload?.scans) ? payload.scans : [] };
}

export function buildDecisionAuditExportPayload(options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const activeSettings = options.activeSettings || options.settings || {};
  const rows = Array.isArray(options.rows)
    ? options.rows.map((row) => {
      const traced = attachDecisionTrace(row, activeSettings);
      return {
        ...traced,
        dataHealth: compactDataHealthForAudit(buildScreenerDataHealth(traced, activeSettings)),
        scoreAudit: compactScreenerScoreAudit(traced),
      };
    })
    : [];
  const dataHealth = compactDataHealthSummary(buildScreenerDataHealthSummary(rows, activeSettings));
  const scoreAudit = buildScreenerScoreAuditSummary(rows);
  const scan = {
    id: options.id || `screener-export-${exportedAt.replace(/[:.]/g, "-")}`,
    name: options.name || `Screener export · ${rows.length} rows · ${exportedAt}`,
    preset: options.preset || "",
    settings: options.settings || activeSettings,
    activeSettings,
    filterLayers: options.filterLayers || null,
    fieldRules: options.fieldRules || null,
    viewLayers: options.viewLayers || null,
    viewFilters: options.viewFilters || null,
    rowsAreFilteredSnapshot: options.rowsAreFilteredSnapshot ?? true,
    marketScore: options.marketScore ?? null,
    marketRegime: options.marketRegime || "",
    dataHealth,
    scoreAudit,
    createdAt: exportedAt,
    updatedAt: exportedAt,
    rows,
  };
  return {
    ok: true,
    schemaVersion: 1,
    projection: options.projection || "screener-decision-audit-export",
    source: options.source || "screener",
    scope: options.scope || "visible-results",
    exportedAt,
    rowCount: rows.length,
    dataHealth,
    scoreAudit,
    scans: [scan],
  };
}

export function auditDecisionScan(scan = {}) {
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const dataHealth = compactDataHealthSummary(scan.dataHealth || buildScreenerDataHealthSummary(rows, scan.activeSettings || scan.settings || {}));
  const scoreAudit = scan.scoreAudit || buildScreenerScoreAuditSummary(rows);
  const decisions = new Map();
  const actions = new Map();
  const issueCounts = new Map();
  const issueSamples = new Map();
  const operableConfidenceIssueCounts = new Map();
  const operableConfidenceIssueSamples = new Map();
  const confidenceCounts = new Map();
  const longCandidateRisk = [];
  const operableConfidenceRisk = [];
  const suspiciousOperable = [];
  const auditRows = [];
  const partialProjectionRows = [];

  for (const row of rows) {
    if (row.decisionProjectionPartial) {
      partialProjectionRows.push({
        symbol: row.symbol,
        missing: Array.isArray(row.decisionProjectionMissing) ? row.decisionProjectionMissing : [],
      });
    }
    const explanation = explain(row, scan);
    increment(decisions, explanation.readiness.key);
    increment(actions, explanation.action.key);
    const issues = auditDecisionRowIssues(row, explanation);
    const confidence = decisionConfidenceSummary(row, explanation, issues);
    increment(confidenceCounts, confidence.key);
    const issueSample = rowIssueSample(row, explanation, issues, confidence);
    for (const issue of issues) addIssueStats(issueCounts, issueSamples, issue, issueSample);
    if (LONG_BIASED_ACTIONS.has(explanation.action.key) && explanation.readiness.key !== "operable") {
      longCandidateRisk.push(issueSample);
    }
    if (explanation.readiness.key === "operable") {
      if (confidence.key !== "high" || issues.some((issue) => issue.key === "minimum-confluence")) {
        operableConfidenceRisk.push(issueSample);
        const fragileIssues = issues.length ? issues : [{
          key: "low-decision-confidence",
          label: "Confianza no alta",
          severity: confidence.tone === "bad" ? "bad" : "warn",
          detail: `${confidence.label} ${confidence.score}`,
        }];
        for (const issue of fragileIssues) addIssueStats(operableConfidenceIssueCounts, operableConfidenceIssueSamples, issue, issueSample);
      }
      const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating");
      const driverKeys = new Set(explanation.drivers.map((item) => item.key));
      if ((Number.isFinite(rs) && rs < 72) || !driverKeys.has("rs-global")) {
        suspiciousOperable.push({
          symbol: row.symbol,
          companyName: row.companyName || row.name || "",
          rs,
          totalScore: rowNumber(row, "totalScore"),
          setup: rowText(row, "setupDisplayLabel") || rowText(row, "setupVerdictLabel"),
          drivers: explanation.drivers.map((item) => item.label).slice(0, 4),
        });
      }
    }
    if (explanation.readiness.key === "audit") {
      auditRows.push({
        symbol: row.symbol,
        reason: explanation.readiness.detail,
        action: explanation.action.label,
      });
    }
  }

  return {
    id: scan.id,
    name: scan.name,
    preset: scan.preset,
    rows: rows.length,
    decisions: sortedObject(decisions),
    actions: sortedObject(actions),
    partialProjectionRows: partialProjectionRows.slice(0, 12),
    partialProjectionCount: partialProjectionRows.length,
    dataHealth,
    scoreAudit,
    decisionQuality: {
      longCandidateRiskCount: longCandidateRisk.length,
      longCandidateRiskShare: pct(longCandidateRisk.length, rows.length),
      longCandidateRiskRows: longCandidateRisk.slice(0, 12),
      operableConfidenceRiskCount: operableConfidenceRisk.length,
      operableConfidenceRiskShare: pct(operableConfidenceRisk.length, rows.length),
      operableConfidenceRiskRows: operableConfidenceRisk.slice(0, 12),
      operableConfidenceTopIssues: issueSummary(operableConfidenceIssueCounts, operableConfidenceIssueSamples, operableConfidenceRisk.length, 6),
      topIssues: issueSummary(issueCounts, issueSamples, rows.length),
      confidence: DECISION_CONFIDENCE_ORDER
        .map((key) => ({
          key,
          label: decisionConfidenceLabel(key),
          count: confidenceCounts.get(key) || 0,
          share: pct(confidenceCounts.get(key) || 0, rows.length),
        }))
        .filter((item) => item.count > 0),
    },
    suspiciousOperable: suspiciousOperable.slice(0, 12),
    auditSample: auditRows.slice(0, 8),
  };
}

export function auditDecisionPayload(payload = {}, meta = {}) {
  const normalized = normalizeDecisionAuditPayload(payload);
  const scanAudits = normalized.scans.map(auditDecisionScan);
  const dataHealth = combinedDataHealthSummary(scanAudits);
  const scoreAudit = combinedScoreAuditSummary(scanAudits);
  const totals = scanAudits.reduce((acc, scan) => {
    acc.rows += scan.rows;
    for (const [key, value] of Object.entries(scan.decisions)) acc.decisions.set(key, (acc.decisions.get(key) || 0) + value);
    for (const [key, value] of Object.entries(scan.actions)) acc.actions.set(key, (acc.actions.get(key) || 0) + value);
    acc.partialProjectionCount += scan.partialProjectionCount;
    acc.partialProjectionRows.push(...scan.partialProjectionRows);
    acc.longCandidateRiskCount += scan.decisionQuality.longCandidateRiskCount;
    acc.longCandidateRiskRows.push(...scan.decisionQuality.longCandidateRiskRows);
    acc.operableConfidenceRiskCount += scan.decisionQuality.operableConfidenceRiskCount;
    acc.operableConfidenceRiskRows.push(...scan.decisionQuality.operableConfidenceRiskRows);
    for (const issue of scan.decisionQuality.operableConfidenceTopIssues || []) {
      acc.operableConfidenceIssueCounts.set(issue.key, {
        key: issue.key,
        label: issue.label,
        severity: issue.severity,
        count: (acc.operableConfidenceIssueCounts.get(issue.key)?.count || 0) + issue.count,
      });
      const list = acc.operableConfidenceIssueSamples.get(issue.key) || [];
      for (const sample of issue.sample || []) {
        if (list.length >= 5) break;
        list.push(sample);
      }
      acc.operableConfidenceIssueSamples.set(issue.key, list);
    }
    for (const item of scan.decisionQuality.confidence || []) {
      acc.confidenceCounts.set(item.key, (acc.confidenceCounts.get(item.key) || 0) + item.count);
    }
    for (const issue of scan.decisionQuality.topIssues) {
      acc.issueCounts.set(issue.key, {
        key: issue.key,
        label: issue.label,
        severity: issue.severity,
        count: (acc.issueCounts.get(issue.key)?.count || 0) + issue.count,
      });
      const list = acc.issueSamples.get(issue.key) || [];
      for (const sample of issue.sample || []) {
        if (list.length >= 5) break;
        list.push(sample);
      }
      acc.issueSamples.set(issue.key, list);
    }
    acc.suspiciousOperable.push(...scan.suspiciousOperable);
    return acc;
  }, {
    rows: 0,
    decisions: new Map(),
    actions: new Map(),
    partialProjectionCount: 0,
    partialProjectionRows: [],
    longCandidateRiskCount: 0,
    longCandidateRiskRows: [],
    operableConfidenceRiskCount: 0,
    operableConfidenceRiskRows: [],
    operableConfidenceIssueCounts: new Map(),
    operableConfidenceIssueSamples: new Map(),
    issueCounts: new Map(),
    issueSamples: new Map(),
    confidenceCounts: new Map(),
    suspiciousOperable: [],
  });

  const decisionShare = Object.fromEntries([...totals.decisions.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => [key, { count: value, share: pct(value, totals.rows) }]));

  return {
    scannedAt: meta.scannedAt || new Date().toISOString(),
    source: meta.source || "api",
    ...(meta.file ? { file: meta.file } : {}),
    ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
    ...(meta.fallbackReason ? { fallbackReason: meta.fallbackReason } : {}),
    projection: normalized.projection || meta.projection || "unknown",
    scans: scanAudits.length,
    rows: totals.rows,
    partialProjection: {
      count: totals.partialProjectionCount,
      share: pct(totals.partialProjectionCount, totals.rows),
      sample: totals.partialProjectionRows.slice(0, 20),
    },
    decisionShare,
    actions: sortedObject(totals.actions),
    dataHealth,
    scoreAudit,
    decisionQuality: {
      longCandidateRisk: {
        count: totals.longCandidateRiskCount,
        share: pct(totals.longCandidateRiskCount, totals.rows),
        sample: totals.longCandidateRiskRows.slice(0, 20),
      },
      operableConfidenceRisk: {
        count: totals.operableConfidenceRiskCount,
        share: pct(totals.operableConfidenceRiskCount, totals.rows),
        sample: totals.operableConfidenceRiskRows.slice(0, 20),
        topIssues: issueSummary(totals.operableConfidenceIssueCounts, totals.operableConfidenceIssueSamples, totals.operableConfidenceRiskCount, 8),
      },
      topIssues: issueSummary(totals.issueCounts, totals.issueSamples, totals.rows, 12),
      confidence: DECISION_CONFIDENCE_ORDER
        .map((key) => ({
          key,
          label: decisionConfidenceLabel(key),
          count: totals.confidenceCounts.get(key) || 0,
          share: pct(totals.confidenceCounts.get(key) || 0, totals.rows),
        }))
        .filter((item) => item.count > 0),
    },
    suspiciousOperable: totals.suspiciousOperable.slice(0, 20),
    byScan: scanAudits,
  };
}
