"use client";

import { TrustMetric } from "@/app/components/ui/MetricSource";

export function QuickReviewMetricValue({ row = {}, metricKey = "", label = "", value = "-", className = "" }) {
  return <TrustMetric row={row} metricKey={metricKey} label={label} value={value} className={className} baseClass="quickReviewMetricValue" variant="b" />;
}

export function ReviewQueueFocusBadge({ focus = null }) {
  if (!focus) return null;
  return <span className={`reviewQueueFocusBadge ${focus.tone || "warn"} focus-${focus.key || "other"}`} title={focus.detail || focus.label}>Foco {focus.label}</span>;
}

export function ReviewPriorityResultRail({ summary = [], activeKey = "all", onSelect, onReview }) {
  const items = Array.isArray(summary) ? summary.filter((item) => item?.count > 0) : [];
  if (!items.length) return null;
  const activeItem = activeKey !== "all" ? items.find((item) => item.key === activeKey) : null;
  const reviewTarget = activeItem || items[0];
  return <div className="decisionSummaryRail reviewPriorityResultRail" aria-label="Resumen por prioridad de investigacion">
    {items.map((item) => {
      const active = activeKey === item.key;
      return <button
        type="button"
        key={item.key}
        className={`decisionSummaryChip priority-${item.key} ${item.tone || "neutral"} ${active ? "active" : ""}`.trim()}
        onClick={() => onSelect?.(active ? "all" : item.key)}
        onDoubleClick={() => onReview?.(item.key)}
        title={[item.topSymbol ? `${item.topSymbol} · ${Math.round(item.topScore || 0)}` : "", item.sampleSymbols?.length ? item.sampleSymbols.join(", ") : item.label, "Doble click: revisar esta prioridad"].filter(Boolean).join(" · ")}
      >
        <b>{item.count}</b>
        <span>{item.shortLabel || item.label}</span>
      </button>;
    })}
    {reviewTarget ? <button
      type="button"
      className={`decisionSummaryChip reviewPriorityAction priority-${reviewTarget.key} ${reviewTarget.tone || "neutral"}`.trim()}
      onClick={() => onReview?.(reviewTarget.key)}
      title={`Abrir cola Review: ${reviewTarget.label}`}
    >
      <b>Ir</b>
      <span>Revisar {reviewTarget.shortLabel || reviewTarget.label}</span>
    </button> : null}
  </div>;
}

export function ReviewPriorityPanel({ priority = null, compact = false }) {
  if (!priority) return null;
  const components = Array.isArray(priority.priority?.components) ? priority.priority.components.slice(0, compact ? 3 : 4) : [];
  const penalties = Array.isArray(priority.priority?.penalties) ? priority.priority.penalties.slice(0, compact ? 2 : 3) : [];
  return <div className={`reviewPriorityPanel quickReviewPriorityPanel ${compact ? "compact" : ""} ${priority.tone || ""}`} aria-label="Prioridad de investigacion">
    <div className="reviewPriorityHead">
      <span><b>{priority.label}</b><em>{priority.reason}</em></span>
      <strong>{Math.round(priority.score || 0)}</strong>
    </div>
    {components.length ? <div className="reviewPriorityComponents">
      {components.map((item) => <span key={item.key} title={item.detail || item.label}>
        <em>{item.label}</em>
        <b>{Math.round(item.value || 0)}</b>
      </span>)}
    </div> : null}
    {penalties.length ? <div className="reviewPriorityPenalties">
      {penalties.map((item) => <small className={item.severity || "warn"} key={item.key}>-{Math.round(item.value || 0)} {item.label}</small>)}
    </div> : null}
  </div>;
}
