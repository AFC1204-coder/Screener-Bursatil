import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { buildRowTrustSignature } from "@/lib/rowTrustSignature";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit } from "@/lib/screenerScoreAudit";

function auditIssueDetail(audit = null) {
  const issues = Array.isArray(audit?.issues) ? audit.issues : [];
  return issues.slice(0, 2).map((item) => [item.label || item.key, item.status].filter(Boolean).join(": ")).join(" · ");
}

export function metricTruthMetaForRow(row = {}, { includeIssueDetail = false } = {}) {
  const status = objectiveMetricAuditStatusForRow(row);
  const audit = status.audit || null;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const usable = items.filter((item) => item?.status === "verified" || item?.status === "traceable");
  const measuredCount = usable.filter((item) => item?.proxy !== true).length;
  const proxyCount = usable.filter((item) => item?.proxy === true).length;
  const detail = [
    includeIssueDetail ? status.detail || auditIssueDetail(audit) : status.detail,
    measuredCount ? `${measuredCount} medidas` : "",
    proxyCount ? `${proxyCount} proxy` : "",
  ].filter(Boolean).join(" · ");

  if (status.key === "bad") return { key: "blocked", label: "Bloq.", tone: "bad", detail, measuredCount, proxyCount };
  if (status.key === "warn") return { key: "review", label: "Rev.", tone: "warn", detail, measuredCount, proxyCount };
  if (status.key === "missing") {
    return { key: "missing", label: "Sin audit", tone: "warn", detail: status.detail || "Sin auditoria numerica.", measuredCount: 0, proxyCount: 0 };
  }
  return {
    key: proxyCount ? "mixed" : "measured",
    label: proxyCount ? "Mixto" : "Med.",
    tone: proxyCount ? "neutral" : "good",
    detail,
    measuredCount,
    proxyCount,
  };
}

export function rowTrustSignatureForRow(row = {}, {
  settings = {},
  dataHealth = null,
  metricTruth = null,
  scoreAudit = null,
  evidence = null,
  vcpReliability = null,
  rowIssues = [],
  metricTruthOptions = {},
} = {}) {
  return buildRowTrustSignature({
    dataHealth: dataHealth || buildScreenerDataHealth(row, settings),
    metricTruth: metricTruth || metricTruthMetaForRow(row, metricTruthOptions),
    scoreAudit: scoreAudit || buildScreenerScoreAudit(row),
    evidence,
    vcpReliability,
    rowIssues,
  });
}
