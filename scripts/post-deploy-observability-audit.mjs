import { buildPostDeployObservabilityReport } from "@/lib/postDeployObservability";
import { runRcReadinessAudit } from "@/lib/rcReadinessRuntime";

function normalizeBaseUrl(value = "") {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

const localUrl = normalizeBaseUrl(
  process.env.POST_DEPLOY_LOCAL_URL
  || process.env.RC_READINESS_BASE_URL
  || process.env.SMOKE_BASE_URL
  || "http://127.0.0.1:3000"
);
const productionUrl = normalizeBaseUrl(
  process.env.POST_DEPLOY_PROD_URL
  || process.env.PRODUCTION_BASE_URL
  || process.env.VERCEL_PROJECT_PRODUCTION_URL
  || ""
);
const token = process.env.POST_DEPLOY_TOKEN
  || process.env.STATSEDGE_ACCESS_TOKEN
  || process.env.STATSEDGE_API_TOKEN
  || process.env.STATSEDGE_ADMIN_TOKEN
  || "";
const productionToken = process.env.POST_DEPLOY_PROD_TOKEN || token;
const timeoutMs = Number(process.env.POST_DEPLOY_TIMEOUT_MS || process.env.RC_READINESS_TIMEOUT_MS || 30000);
const minScore = Number(process.env.POST_DEPLOY_MIN_SCORE || process.env.RC_READINESS_MIN_SCORE || 95);
const requireProduction = process.env.POST_DEPLOY_REQUIRE_PROD === "1";
const jsonOutput = process.env.POST_DEPLOY_JSON === "1";

function logHuman(report) {
  console.log(`StatsEdge post-deploy observability: ${report.status.toUpperCase()} (${report.mode})`);
  if (report.local) {
    console.log(`LOCAL ${report.local.status} ${report.local.score}/${report.local.targetScore} - ${report.local.baseUrl}`);
  }
  if (report.production) {
    console.log(`PROD ${report.production.status} ${report.production.score}/${report.production.targetScore} - ${report.production.baseUrl}`);
  }
  for (const blocker of report.blockers.slice(0, 8)) console.log(`FAIL ${blocker.key}: ${blocker.message}`);
  for (const warning of report.warnings.slice(0, 8)) console.log(`WARN ${warning.key}: ${warning.message}`);
  for (const delta of report.latencyDeltas.slice(0, 5)) {
    const ratio = delta.ratio === null ? "n/a" : `${delta.ratio}x`;
    console.log(`LAT ${delta.check}: prod ${delta.productionLatencyMs}ms vs local ${delta.localLatencyMs}ms (${ratio}, ${delta.deltaMs}ms)`);
  }
}

async function runEnvironment(name, baseUrl, envToken) {
  const report = await runRcReadinessAudit({
    baseUrl,
    token: envToken,
    timeoutMs,
    minScore,
    environment: name,
  });
  return { name, baseUrl, report };
}

const local = await runEnvironment("local", localUrl, token);
const production = productionUrl
  ? await runEnvironment("production", productionUrl, productionToken)
  : null;

const report = buildPostDeployObservabilityReport({
  local,
  production,
  requireProduction,
});

if (jsonOutput) console.log(JSON.stringify(report, null, 2));
else logHuman(report);

if (!report.ok) process.exitCode = 1;
