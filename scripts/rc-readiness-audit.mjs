import { logRcReadinessHuman, runRcReadinessAudit } from "@/lib/rcReadinessRuntime";

const baseUrl = process.env.RC_READINESS_BASE_URL || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const token = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
const timeoutMs = Number(process.env.RC_READINESS_TIMEOUT_MS || 30000);
const minScore = Number(process.env.RC_READINESS_MIN_SCORE || 95);
const jsonOutput = process.env.RC_READINESS_JSON === "1";

const report = await runRcReadinessAudit({
  baseUrl,
  token,
  timeoutMs,
  minScore,
  environment: "rc",
});

if (jsonOutput) console.log(JSON.stringify(report, null, 2));
else logRcReadinessHuman(report);

if (!report.ok) process.exitCode = 1;
