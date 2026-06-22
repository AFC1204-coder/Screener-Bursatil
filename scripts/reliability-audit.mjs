import { compactErrorMessage } from "@/lib/decisionAudit";
import { auditRestoredScanRow, buildScreenerAuditabilitySummary, buildScreenerReliability } from "@/lib/screenerReliability";
import { buildDecisionEvidenceChecklist } from "@/lib/screenerExplainability";
import { scoreAuditStatusForRow } from "@/lib/screenerScoreAudit";

const baseUrl = process.env.RELIABILITY_AUDIT_BASE_URL || "http://127.0.0.1:3000";
const limit = Number(process.env.RELIABILITY_AUDIT_LIMIT || 1);
const rowsLimit = Number(process.env.RELIABILITY_AUDIT_ROWS_LIMIT || 2000);
const token = process.env.STATSEDGE_ACCESS_TOKEN || process.env.STATSEDGE_API_TOKEN || process.env.STATSEDGE_ADMIN_TOKEN || "";
const allowContractLoss = process.env.RELIABILITY_AUDIT_ALLOW_CONTRACT_LOSS === "1";

async function fetchScans({ full = false, decision = false } = {}) {
  const url = new URL("/api/scans", baseUrl);
  url.searchParams.set("includeRows", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("rowsLimit", String(rowsLimit));
  if (full) url.searchParams.set("full", "1");
  if (decision) url.searchParams.set("projection", "decision");
  const response = await fetch(url, {
    headers: token ? { "x-statsedge-token": token } : {},
    signal: AbortSignal.timeout(Number(process.env.RELIABILITY_AUDIT_TIMEOUT_MS || 90000)),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: compactErrorMessage(raw) || "Respuesta no JSON del endpoint de scans." };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(compactErrorMessage(data.error || data.message) || `HTTP ${response.status}`);
  }
  return data;
}

function bySymbol(rows = []) {
  return new Map(rows.map((row) => [String(row.symbol || "").toUpperCase(), row]).filter(([symbol]) => symbol));
}

function scoreComplete(row = {}) {
  const status = scoreAuditStatusForRow(row);
  const displayed = status.audit?.displayedScore;
  return status.clean && !status.missing && !status.mismatch && displayed !== null && displayed !== undefined && displayed !== "" && Number.isFinite(Number(displayed));
}

const [fullPayload, decisionPayload] = await Promise.all([
  fetchScans({ full: true }),
  fetchScans({ decision: true }),
]);

const fullScan = fullPayload.scans?.[0] || null;
const decisionScan = decisionPayload.scans?.[0] || null;
if (!decisionScan?.rows?.length) {
  throw new Error("No hay scan restaurado con filas para auditar.");
}

const fullRows = bySymbol(fullScan?.rows || []);
const decisionRows = decisionScan.rows || [];
const settings = decisionScan.activeSettings || decisionScan.settings?.activeSettings || decisionScan.settings || {};
const contractLosses = [];
const rows = decisionRows.map((row) => {
  const symbol = String(row.symbol || "").toUpperCase();
  const fullRow = fullRows.get(symbol);
  const originalScoreComplete = fullRow ? scoreComplete(fullRow) : false;
  const restoredAudit = auditRestoredScanRow(row, settings);
  const reliability = buildScreenerReliability(row, settings);
  const evidence = buildDecisionEvidenceChecklist(row, settings);
  const lostScoreContract = originalScoreComplete && !restoredAudit.scoreTraceable;
  if (lostScoreContract) {
    contractLosses.push({
      symbol,
      missing: restoredAudit.scoreMissing,
      reason: "La fila full era auditable, pero la proyección restaurada perdió score/componentes.",
    });
  }
  return {
    symbol,
    companyName: row.companyName || row.name || "",
    reliability: reliability.key,
    auditability: restoredAudit.key,
    scoreTraceable: restoredAudit.scoreTraceable,
    scoreMissing: restoredAudit.scoreMissing,
    dataHealth: reliability.dataHealthKey,
    evidence: reliability.evidenceKey,
    methodology: {
      passed: Number(evidence.passedCount || 0),
      total: Number(evidence.totalCount || 0),
      manualReviewRequired: evidence.manualReviewRequired === true,
      reviewFocus: (evidence.reviewFocus || []).slice(0, 3).map((item) => ({
        key: item.key,
        label: item.label,
        status: item.status,
        tone: item.tone,
        action: item.action,
      })),
      pending: (evidence.pending || []).slice(0, 5).map((item) => ({
        key: item.methodologyKey || item.key,
        label: item.label,
        status: item.status,
        detail: item.detail,
      })),
    },
    confidence: reliability.confidenceKey,
  };
});

const summary = buildScreenerAuditabilitySummary(decisionRows, settings);
const payload = {
  ok: contractLosses.length === 0,
  source: {
    baseUrl,
    fullProjection: fullPayload.projection,
    decisionProjection: decisionPayload.projection,
    scanId: decisionScan.id,
    createdAt: decisionScan.createdAt,
    rows: decisionRows.length,
  },
  snapshotIntegrity: summary.snapshotIntegrity,
  auditabilityShare: summary.auditabilityShare,
  verdict: summary.verdict,
  counts: summary.counts,
  contractLosses,
  methodologyPending: summary.methodologyPending || [],
  methodologyReviewFocus: summary.methodologyReviewFocus || [],
  methodologyLimitations: summary.methodologyLimitations || [],
  rows,
  note: "Auditabilidad interna: herramienta de observación; no sustituye el criterio metodológico del inversor.",
};

console.log(JSON.stringify(payload, null, 2));

if (contractLosses.length && !allowContractLoss) {
  process.exitCode = 1;
}
