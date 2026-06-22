export const RC_READINESS_VERSION = "rc-readiness-v1";

export const DEFAULT_RC_READINESS_THRESHOLDS = {
  minScore: 95,
  warningPenalty: 12,
};

export const RC_READINESS_AREAS = [
  { key: "endpointAvailability", label: "Endpoints criticos", weight: 30 },
  { key: "authProtection", label: "Proteccion interna", weight: 20 },
  { key: "dataClarity", label: "Claridad de datos", weight: 20 },
  { key: "latency", label: "Latencia percibida", weight: 15 },
  { key: "operationalHealth", label: "Salud operativa", weight: 15 },
];

const AREA_KEYS = new Set(RC_READINESS_AREAS.map((area) => area.key));

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeIssue(issue = {}) {
  const severity = issue.severity === "fail" ? "fail" : issue.severity === "warn" ? "warn" : "info";
  return {
    severity,
    key: String(issue.key || severity || "issue"),
    message: String(issue.message || issue.key || severity || "Issue"),
  };
}

export function normalizeRcCheck(check = {}) {
  const area = AREA_KEYS.has(check.area) ? check.area : "endpointAvailability";
  const statusCode = finiteNumber(check.statusCode);
  const expectedStatus = finiteNumber(check.expectedStatus);
  const latencyMs = finiteNumber(check.latencyMs);
  const maxLatencyMs = finiteNumber(check.maxLatencyMs);
  const hardMaxLatencyMs = finiteNumber(check.hardMaxLatencyMs) || (maxLatencyMs ? maxLatencyMs * 2 : null);
  const issues = Array.isArray(check.issues) ? check.issues.map(normalizeIssue) : [];

  if (check.ok === false) {
    issues.push({
      severity: "fail",
      key: "contract-failed",
      message: check.failureMessage || "El endpoint no cumple el contrato esperado.",
    });
  }

  if (expectedStatus !== null && statusCode !== null && statusCode !== expectedStatus) {
    issues.push({
      severity: "fail",
      key: "unexpected-status",
      message: `Esperado HTTP ${expectedStatus}; recibido HTTP ${statusCode}.`,
    });
  } else if (expectedStatus === null && statusCode !== null && statusCode >= 500) {
    issues.push({
      severity: "fail",
      key: "server-error",
      message: `HTTP ${statusCode} en endpoint critico.`,
    });
  }

  if (latencyMs !== null && maxLatencyMs !== null && latencyMs > maxLatencyMs) {
    issues.push({
      severity: hardMaxLatencyMs !== null && latencyMs > hardMaxLatencyMs ? "fail" : "warn",
      key: "latency-budget",
      message: `Latencia ${latencyMs}ms por encima del presupuesto ${maxLatencyMs}ms.`,
    });
  }

  if (check.degraded && check.explicitDegradation === false) {
    issues.push({
      severity: "fail",
      key: "ambiguous-degradation",
      message: "El payload parece degradado/estimado pero no lo marca con suficiente claridad.",
    });
  } else if (check.degraded) {
    issues.push({
      severity: "warn",
      key: "explicit-degradation",
      message: "El endpoint respondio en modo degradado o estimado, correctamente senalizado.",
    });
  }

  const hasFailure = issues.some((issue) => issue.severity === "fail");
  const hasWarning = issues.some((issue) => issue.severity === "warn");
  const state = hasFailure ? "fail" : hasWarning ? "warn" : "pass";

  return {
    area,
    name: String(check.name || check.path || "check"),
    path: check.path || "",
    state,
    ok: state !== "fail",
    statusCode,
    expectedStatus,
    latencyMs,
    maxLatencyMs,
    degraded: Boolean(check.degraded),
    explicitDegradation: check.explicitDegradation !== false,
    issues,
  };
}

function scoreCheck(check, thresholds = DEFAULT_RC_READINESS_THRESHOLDS) {
  if (check.state === "fail") return 0;
  if (check.state === "warn") return Math.max(0, 100 - Number(thresholds.warningPenalty || 12));
  return 100;
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

export function buildRcReadinessReport(input = {}) {
  const thresholds = { ...DEFAULT_RC_READINESS_THRESHOLDS, ...(input.thresholds || {}) };
  const checks = (input.checks || []).map(normalizeRcCheck);
  const byArea = new Map(RC_READINESS_AREAS.map((area) => [area.key, []]));
  for (const check of checks) byArea.get(check.area)?.push(check);

  const areas = RC_READINESS_AREAS.map((area) => {
    const areaChecks = byArea.get(area.key) || [];
    const score = areaChecks.length
      ? areaChecks.reduce((sum, check) => sum + scoreCheck(check, thresholds), 0) / areaChecks.length
      : 0;
    const blockers = areaChecks.flatMap((check) => check.issues.filter((issue) => issue.severity === "fail").map((issue) => ({ ...issue, check: check.name, path: check.path })));
    const warnings = areaChecks.flatMap((check) => check.issues.filter((issue) => issue.severity === "warn").map((issue) => ({ ...issue, check: check.name, path: check.path })));
    return {
      ...area,
      score: roundScore(score),
      state: blockers.length ? "fail" : warnings.length ? "warn" : areaChecks.length ? "pass" : "fail",
      checks: areaChecks.length,
      blockers,
      warnings,
    };
  });

  const totalWeight = areas.reduce((sum, area) => sum + area.weight, 0) || 1;
  const score = roundScore(areas.reduce((sum, area) => sum + area.score * area.weight, 0) / totalWeight);
  const blockers = areas.flatMap((area) => area.blockers.map((issue) => ({ ...issue, area: area.key })));
  const warnings = areas.flatMap((area) => area.warnings.map((issue) => ({ ...issue, area: area.key })));
  const meetsScore = score >= Number(thresholds.minScore || DEFAULT_RC_READINESS_THRESHOLDS.minScore);
  const status = blockers.length ? "fail" : meetsScore ? (warnings.length ? "warn" : "pass") : "fail";

  return {
    ok: blockers.length === 0 && meetsScore,
    version: RC_READINESS_VERSION,
    status,
    score,
    targetScore: Number(thresholds.minScore || DEFAULT_RC_READINESS_THRESHOLDS.minScore),
    generatedAt: input.generatedAt || new Date().toISOString(),
    source: input.source || {},
    thresholds,
    counts: {
      checks: checks.length,
      pass: checks.filter((check) => check.state === "pass").length,
      warn: checks.filter((check) => check.state === "warn").length,
      fail: checks.filter((check) => check.state === "fail").length,
      blockers: blockers.length,
      warnings: warnings.length,
    },
    areas,
    blockers,
    warnings,
    checks,
  };
}
