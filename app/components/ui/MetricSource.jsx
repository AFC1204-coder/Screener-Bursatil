import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";

const SOURCE_STATUSES = ["mismatch", "unverified-value", "missing-source"];
const REVIEW_STATUSES = ["missing", "insufficient-input"];

function componentForTag(tag = "span") {
  if (tag === "b") return "b";
  if (tag === "strong") return "strong";
  if (tag === "em") return "em";
  return "span";
}

export function metricSourceFromItem(item = null, label = "", fallbackLabel = "Métrica") {
  if (!item || typeof item !== "object") return null;
  const status = String(item.status || "");
  const severity = String(item.severity || "");
  const titleLabel = label || item.label || item.key || fallbackLabel;
  if (severity === "bad" || SOURCE_STATUSES.includes(status)) {
    return { key: "blocked", mark: "x", title: `${titleLabel}: bloqueada` };
  }
  if (severity === "warn" || REVIEW_STATUSES.includes(status)) {
    return { key: "review", mark: "!", title: `${titleLabel}: revisar` };
  }
  if (item.proxy === true) {
    return { key: "proxy", mark: "p", title: `${titleLabel}: proxy/estimada` };
  }
  if (status === "verified" || status === "traceable") {
    return { key: "measured", mark: "", title: `${titleLabel}: medida/trazable` };
  }
  return null;
}

export function metricSourceFromRow(row = {}, key = "", label = "") {
  if (!key) return null;
  const audit = objectiveMetricAuditStatusForRow(row)?.audit;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const item = items.find((entry) => entry?.key === key);
  return item ? metricSourceFromItem(item, label || item.label || item.key) : null;
}

export function TrustMetric({
  row = {},
  metricKey = "",
  label = "",
  value = "-",
  className = "",
  baseClass = "",
  variant = "span",
  valueTag = "span",
}) {
  const source = metricKey ? metricSourceFromRow(row, metricKey, label) : null;
  const sourceClass = source?.key ? `source-${source.key}` : "";
  const valueText = value ?? "-";
  const Tag = componentForTag(variant);
  const ValueTag = componentForTag(valueTag);
  return <Tag
    className={[baseClass, className, sourceClass].filter(Boolean).join(" ")}
    title={source?.title || undefined}
    aria-label={source?.title ? `${label}: ${valueText}. ${source.title}` : undefined}
  >
    <ValueTag>{valueText}</ValueTag>
    {source?.mark ? <i aria-hidden="true">{source.mark}</i> : null}
  </Tag>;
}
