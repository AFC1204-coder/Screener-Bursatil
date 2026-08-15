export const POST_DEPLOY_OBSERVABILITY_VERSION = "post-deploy-observability-v1";

export const DEFAULT_POST_DEPLOY_THRESHOLDS = {
  maxLatencyRatio: 2.25,
  minLatencyDeltaMs: 1500,
};

function envLabel(env = {}) {
  return String(env.name || env.environment || env.source?.environment || "environment");
}

function byCheckIdentity(report = {}) {
  return new Map((report.checks || []).map((check) => [`${check.area}:${check.name}:${check.path}`, check]));
}

function checkIdentity(check = {}) {
  return `${check.area}:${check.name}:${check.path}`;
}

function issue(severity, key, message, meta = {}) {
  return { severity, key, message, ...meta };
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function compareRcReports(localReport = {}, productionReport = {}, options = {}) {
  const thresholds = { ...DEFAULT_POST_DEPLOY_THRESHOLDS, ...(options.thresholds || {}) };
  const localChecks = byCheckIdentity(localReport);
  const blockers = [];
  const warnings = [];
  const deltas = [];
  const productionName = envLabel(productionReport.source || { name: "production" });

  if (!productionReport.ok) {
    blockers.push(issue(
      "fail",
      "production-readiness-failed",
      `${productionName} no supera la puerta RC: ${productionReport.status || "unknown"} ${productionReport.score ?? "n/a"}/${productionReport.targetScore ?? "n/a"}.`
    ));
  }

  for (const productionCheck of productionReport.checks || []) {
    const localCheck = localChecks.get(checkIdentity(productionCheck));
    if (!localCheck) {
      blockers.push(issue("fail", "missing-local-baseline", `No hay baseline local para ${productionCheck.name}.`, {
        check: productionCheck.name,
        path: productionCheck.path,
      }));
      continue;
    }

    if (localCheck.state !== "fail" && productionCheck.state === "fail") {
      blockers.push(issue("fail", "production-check-regressed", `${productionCheck.name} pasa localmente pero falla en produccion.`, {
        check: productionCheck.name,
        path: productionCheck.path,
        localState: localCheck.state,
        productionState: productionCheck.state,
      }));
    }

    if (localCheck.statusCode !== null && productionCheck.statusCode !== null && localCheck.statusCode !== productionCheck.statusCode) {
      blockers.push(issue("fail", "status-divergence", `${productionCheck.name} devuelve HTTP ${productionCheck.statusCode} en produccion vs ${localCheck.statusCode} local.`, {
        check: productionCheck.name,
        path: productionCheck.path,
        localStatus: localCheck.statusCode,
        productionStatus: productionCheck.statusCode,
      }));
    }

    if (localCheck.degraded !== productionCheck.degraded) {
      warnings.push(issue("warn", "degradation-divergence", `${productionCheck.name} tiene degradacion=${productionCheck.degraded} en produccion vs ${localCheck.degraded} local.`, {
        check: productionCheck.name,
        path: productionCheck.path,
      }));
    }

    const localLatency = finite(localCheck.latencyMs);
    const productionLatency = finite(productionCheck.latencyMs);
    if (localLatency !== null && productionLatency !== null) {
      const deltaMs = productionLatency - localLatency;
      const ratio = localLatency > 0 ? productionLatency / localLatency : null;
      deltas.push({
        check: productionCheck.name,
        path: productionCheck.path,
        localLatencyMs: localLatency,
        productionLatencyMs: productionLatency,
        deltaMs,
        ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      });
      if (!options.sameEnvironment && productionCheck.area !== "latency" && deltaMs > thresholds.minLatencyDeltaMs && ratio !== null && ratio > thresholds.maxLatencyRatio) {
        warnings.push(issue("warn", "latency-regression", `${productionCheck.name} es ${Math.round(ratio * 10) / 10}x más lento en produccion (+${deltaMs}ms).`, {
          check: productionCheck.name,
          path: productionCheck.path,
          localLatencyMs: localLatency,
          productionLatencyMs: productionLatency,
        }));
      }
    }
  }

  return { blockers, warnings, deltas };
}

export function buildPostDeployObservabilityReport(input = {}) {
  const local = input.local || null;
  const production = input.production || null;
  const requireProduction = input.requireProduction === true;
  const warnings = [];
  const blockers = [];
  let comparison = null;
  const sameEnvironment = Boolean(local?.baseUrl && production?.baseUrl && local.baseUrl === production.baseUrl);

  if (!local?.report) {
    blockers.push(issue("fail", "missing-local-report", "Falta el reporte local de observabilidad."));
  } else if (!local.report.ok) {
    blockers.push(issue("fail", "local-readiness-failed", `Local no supera la puerta RC: ${local.report.status} ${local.report.score}/${local.report.targetScore}.`));
  }

  if (!production?.report) {
    const missing = issue(
      requireProduction ? "fail" : "warn",
      "missing-production-url",
      "No hay URL de produccion configurada; se genero solo baseline local. Usa POST_DEPLOY_PROD_URL para comparar."
    );
    if (requireProduction) blockers.push(missing);
    else warnings.push(missing);
  } else {
    if (sameEnvironment) {
      warnings.push(issue("warn", "same-environment-comparison", "Local y produccion apuntan a la misma URL; la comparacion valida el flujo pero no sustituye una prueba contra produccion real."));
    }
    comparison = compareRcReports(local?.report || {}, production.report, { ...input, sameEnvironment });
    blockers.push(...comparison.blockers);
    warnings.push(...comparison.warnings);
  }

  const status = blockers.length ? "fail" : warnings.length ? "warn" : "pass";
  return {
    ok: blockers.length === 0,
    version: POST_DEPLOY_OBSERVABILITY_VERSION,
    status,
    generatedAt: input.generatedAt || new Date().toISOString(),
    mode: production?.report ? "local-vs-production" : "local-only",
    thresholds: { ...DEFAULT_POST_DEPLOY_THRESHOLDS, ...(input.thresholds || {}) },
    local: local ? {
      name: local.name || "local",
      baseUrl: local.baseUrl || local.report?.source?.baseUrl || "",
      status: local.report?.status || "missing",
      score: local.report?.score ?? null,
      targetScore: local.report?.targetScore ?? null,
      blockers: local.report?.counts?.blockers ?? null,
      warnings: local.report?.counts?.warnings ?? null,
    } : null,
    production: production ? {
      name: production.name || "production",
      baseUrl: production.baseUrl || production.report?.source?.baseUrl || "",
      status: production.report?.status || "missing",
      score: production.report?.score ?? null,
      targetScore: production.report?.targetScore ?? null,
      blockers: production.report?.counts?.blockers ?? null,
      warnings: production.report?.counts?.warnings ?? null,
    } : null,
    counts: {
      blockers: blockers.length,
      warnings: warnings.length,
      latencyDeltas: comparison?.deltas?.length || 0,
    },
    blockers,
    warnings,
    latencyDeltas: (comparison?.deltas || [])
      .sort((a, b) => b.deltaMs - a.deltaMs)
      .slice(0, 12),
  };
}
