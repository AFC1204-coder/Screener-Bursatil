import { buildRcReadinessReport } from "@/lib/rcReadiness";

export const RC_ENDPOINT_CHECKS = [
  {
    area: "endpointAvailability",
    name: "Screener shell",
    path: "/",
    kind: "html",
    maxLatencyMs: 1500,
    validate: ({ text }) => text.includes("StatsEdge"),
  },
  {
    area: "endpointAvailability",
    name: "Stock shell NVDA",
    path: "/stock/NVDA",
    kind: "html",
    maxLatencyMs: 1800,
    validate: ({ text }) => text.includes("StatsEdge"),
  },
  {
    area: "endpointAvailability",
    name: "Leaderboards",
    path: "/api/leaderboards?type=momentum&limit=5",
    maxLatencyMs: 3000,
    validate: ({ data }) => data.ok === true
      && data.legalMode === "derived-signals-only"
      && Boolean(data.leaderboard || Array.isArray(data.leaderboards)),
  },
  {
    area: "endpointAvailability",
    name: "Discovery",
    path: "/api/discovery?limit=5&groupsLimit=5&minGroupSize=1",
    maxLatencyMs: 3000,
    validate: ({ data }) => data.ok === true
      && data.legalMode === "derived-signals-only"
      && Array.isArray(data.rows)
      && data.health
      && typeof data.health.state === "string",
  },
  {
    area: "dataClarity",
    name: "Coverage",
    path: "/api/coverage?markets=US,EU1,JP,HK,AU",
    maxLatencyMs: 8000,
    validate: ({ data }) => data.status === "complete"
      && data.degraded !== true
      && data.scanCoverage?.status === "supabase"
      && Number(data.summary?.current) > 100
      && Array.isArray(data.markets),
  },
  {
    area: "dataClarity",
    name: "Chart NVDA",
    path: "/api/chart?symbol=NVDA",
    maxLatencyMs: 5000,
    validate: ({ data }) => Array.isArray(data.bars) && data.bars.length > 100,
  },
  {
    area: "dataClarity",
    name: "Company brief NVDA",
    path: "/api/company-brief?symbol=NVDA",
    maxLatencyMs: 6000,
    validate: ({ data }) => data.symbol === "NVDA" && Boolean(data.name) && Boolean(data.dataQuality),
  },
  {
    area: "dataClarity",
    name: "Market health",
    path: "/api/market-health",
    maxLatencyMs: 3000,
    validate: ({ data }) => Number.isFinite(data.marketScore) && Array.isArray(data.indexes),
  },
  {
    area: "operationalHealth",
    name: "MVP operational health",
    path: "/api/mvp-health",
    maxLatencyMs: 2500,
    validate: ({ data }) => ["pass", "warn"].includes(data.status)
      && Array.isArray(data.checks)
      && data.checks.some((item) => item.area === "discovery-cache")
      && data.checks.some((item) => item.area === "leaderboards-cache"),
  },
  {
    area: "operationalHealth",
    name: "Methodology health",
    path: "/api/methodology-health",
    maxLatencyMs: 2500,
    validate: ({ data }) => data.configured === true
      && data.status === "pass"
      && data.totals?.failed === 0
      && data.calibration?.guardrailsOk === true,
  },
  {
    area: "operationalHealth",
    name: "Materialized scan dry run",
    path: "/api/jobs/scan-refresh?markets=US,HK&limit=4&perMarket=2&cursor=0&dryRun=1&leaderboards=0",
    maxLatencyMs: 3000,
    validate: ({ data }) => data.ok === true
      && data.dryRun === true
      && Array.isArray(data.plan?.symbols)
      && Boolean(data.stats?.selection?.priorityMode),
  },
  {
    area: "operationalHealth",
    name: "Shadow symbol resolve dry run",
    path: "/api/jobs/shadow-symbol-resolve?markets=FI&dryRun=1&perMarket=3",
    maxLatencyMs: 7000,
    validate: ({ data }) => data.ok === true
      && data.job === "shadow-symbol-resolve"
      && data.dryRun === true
      && Array.isArray(data.rows),
  },
];

export const RC_AUTH_CHECKS = [
  {
    name: "Auth guard job scan-refresh",
    path: "/api/jobs/scan-refresh?markets=US&limit=1&perMarket=1&dryRun=1&leaderboards=0",
  },
  { name: "Auth guard MVP health", path: "/api/mvp-health" },
  { name: "Auth guard scan coverage", path: "/api/scan-coverage" },
  { name: "Auth guard settings", path: "/api/settings" },
  { name: "Auth guard favorites", path: "/api/favorites" },
].map((item) => ({
  ...item,
  area: "authProtection",
  expectedStatus: 401,
  includeAuth: false,
  maxLatencyMs: 1500,
  validate: ({ response }) => response.status === 401,
}));

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export function dataQualitySignals(data = {}) {
  const degraded = Boolean(
    data.degraded
    || data.partial
    || data.estimated
    || data.fallback
    || data.meta?.estimated
    || data.meta?.fallbackReason
    || data.dataQuality?.degraded
    || data.dataQuality?.partial
    || data.dataQuality?.estimated
    || data.dataQuality?.estimatedChart
    || String(data.status || "").toLowerCase().includes("partial")
  );
  const explicit = !degraded || Boolean(
    data.fallback
    || data.status
    || data.source
    || data.meta?.dataProvider
    || data.meta?.fallbackReason
    || data.dataQuality?.providerNote
    || data.dataQuality?.providers
    || data.dataQuality?.providerErrors
    || data.dataQuality?.coverage
    || data.dataQuality?.freshness
    || data.summary?.currentMeaning
  );
  return { degraded, explicit };
}

export async function runRcRuntimeCheck(definition, options = {}) {
  const baseUrl = options.baseUrl || "http://127.0.0.1:3000";
  const token = options.token || "";
  const timeoutMs = Number(options.timeoutMs || 30000);
  const url = new URL(definition.path, baseUrl);
  const headers = definition.includeAuth === false || !token ? {} : { "x-statsedge-token": token };
  const { signal, clear } = timeoutSignal(timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { headers, cache: "no-store", signal });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    let data = null;
    const issues = [];

    if (definition.kind !== "html") {
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        issues.push({ severity: "fail", key: "invalid-json", message: "Respuesta JSON invalida." });
      }
    }

    const valid = definition.validate({ response, data, text });
    const quality = definition.kind === "html" ? { degraded: false, explicit: true } : dataQualitySignals(data || {});
    return {
      area: definition.area,
      name: definition.name,
      path: definition.path,
      ok: valid && (definition.expectedStatus ? response.status === definition.expectedStatus : response.ok),
      statusCode: response.status,
      expectedStatus: definition.expectedStatus,
      latencyMs,
      maxLatencyMs: definition.maxLatencyMs,
      hardMaxLatencyMs: definition.hardMaxLatencyMs,
      degraded: quality.degraded,
      explicitDegradation: quality.explicit,
      issues,
      failureMessage: valid ? "" : "Contrato de respuesta invalido.",
    };
  } catch (error) {
    return {
      area: definition.area,
      name: definition.name,
      path: definition.path,
      ok: false,
      latencyMs: Date.now() - started,
      maxLatencyMs: definition.maxLatencyMs,
      issues: [{ severity: "fail", key: "fetch-failed", message: error.message || "fetch failed" }],
      failureMessage: "No se pudo contactar el endpoint.",
    };
  } finally {
    clear();
  }
}

export function missingTokenCheck() {
  return {
    area: "authProtection",
    name: "Runtime token configured",
    path: "env:STATSEDGE_ACCESS_TOKEN",
    ok: false,
    issues: [{
      severity: "fail",
      key: "missing-runtime-token",
      message: "No hay token configurado; RC real no debe depender del modo fail-open local.",
    }],
  };
}

export function latencyChecksFor(checks = []) {
  return checks
    .filter((check) => Number.isFinite(check.latencyMs) && Number.isFinite(check.maxLatencyMs))
    .map((check) => ({
      area: "latency",
      name: `${check.name} latency`,
      path: check.path,
      ok: true,
      latencyMs: check.latencyMs,
      maxLatencyMs: check.maxLatencyMs,
      hardMaxLatencyMs: check.hardMaxLatencyMs,
    }));
}

export async function runRcReadinessAudit(options = {}) {
  const runtimeChecks = [];
  for (const check of RC_ENDPOINT_CHECKS) runtimeChecks.push(await runRcRuntimeCheck(check, options));
  if (!options.token) runtimeChecks.push(missingTokenCheck());
  else {
    for (const check of RC_AUTH_CHECKS) runtimeChecks.push(await runRcRuntimeCheck(check, options));
  }
  runtimeChecks.push(...latencyChecksFor(runtimeChecks));

  return buildRcReadinessReport({
    checks: runtimeChecks,
    source: {
      baseUrl: options.baseUrl || "http://127.0.0.1:3000",
      tokenConfigured: Boolean(options.token),
      checks: runtimeChecks.length,
      environment: options.environment || "",
    },
    thresholds: { minScore: Number(options.minScore || 95) },
  });
}

export function logRcReadinessHuman(report) {
  console.log(`StatsEdge RC readiness: ${report.status.toUpperCase()} ${report.score}/${report.targetScore}`);
  for (const area of report.areas) {
    console.log(`${area.state.toUpperCase()} ${area.label}: ${area.score} (${area.checks} checks)`);
  }
  for (const blocker of report.blockers.slice(0, 8)) {
    console.log(`FAIL ${blocker.area}/${blocker.check}: ${blocker.message}`);
  }
  for (const warning of report.warnings.slice(0, 8)) {
    console.log(`WARN ${warning.area}/${warning.check}: ${warning.message}`);
  }
}
