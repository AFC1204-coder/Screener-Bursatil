// lib/screenerDomains/decision.jsx — componentes del dominio "decisión" del screener.
// Componentes de presentación pura (sin estado ni efectos). Cada uno recibe solo
// los props que consume, no el prop-bag completo. Extraídos de app/screenerPanels.jsx.

import { decisionConfidenceLabel } from "@/lib/decisionAudit";
import { buildScreenerDecisionBrief } from "@/lib/screenerDecisionBrief";
import { priorityTooltip } from "@/lib/screenerFormat";

export function DecisionConfidenceBadge({ confidence = null, compact = false }) {
  if (!confidence) return null;
  const score = Number(confidence.score);
  const title = [confidence.detail, Number.isFinite(score) ? `Confianza ${confidence.label} ${Math.round(score)}` : confidence.label].filter(Boolean).join(" · ");
  return <span className={`decisionConfidenceBadge ${compact ? "compact" : ""} ${confidence.tone || ""}`} title={title}>
    <b>{confidence.label || decisionConfidenceLabel(confidence.key, "Confianza")}</b>
    {Number.isFinite(score) ? <em>{Math.round(score)}</em> : null}
  </span>;
}

export function DecisionResolutionBadge({ resolution = null, className = "" }) {
  if (!resolution) return null;
  const label = resolution.label || "Resuelta";
  return <span
    className={`reviewQueueResolutionBadge ${resolution.tone || "neutral"} ${className}`.trim()}
    title={`Decision guardada: ${label}`}
  >
    {label}
  </span>;
}

export function DecisionPriorityBadge({ priority = null, compact = false }) {
  const score = Number(priority?.score);
  if (!Number.isFinite(score)) return null;
  return <span className={`decisionPriorityBadge ${compact ? "compact" : ""}`} title={priorityTooltip(priority)}>
    <b>Pri</b>
    <em>{Math.round(score).toLocaleString("es-ES")}</em>
  </span>;
}

export function DecisionQualityStrip({ audit, compact = false, activeIssueKey = "Todos", onIssueSelect, activeProfileKey = "Todos", onProfileSelect }) {
  if (!audit?.rows) return null;
  const decisions = audit.decisions || {};
  const quality = audit.decisionQuality || {};
  const riskCount = quality.longCandidateRiskCount || 0;
  const fragileOperableCount = quality.operableConfidenceRiskCount || 0;
  const topIssues = (quality.topIssues || []).filter((issue) => issue?.key).slice(0, compact ? 2 : 3);
  const topIssue = topIssues[0] || null;
  const auditCount = decisions.audit || 0;
  const operableCount = decisions.operable || 0;
  const cleanOperableCount = Math.max(0, operableCount - fragileOperableCount);
  const tone = topIssue?.severity || (riskCount || auditCount ? "warn" : "good");
  const fragileSample = quality.operableConfidenceRiskRows?.map((item) => item.symbol).filter(Boolean).slice(0, 4).join(" · ");
  const issueChip = (issue) => {
    const issueActive = issue?.key && activeIssueKey === issue.key;
    const sample = issue?.sample?.map((item) => item.symbol).filter(Boolean).slice(0, 4).join(" · ");
    const issueClass = `decisionQualityIssue ${issue?.severity || "good"} ${issueActive ? "active" : ""}`;
    const issueBody = <>
      <b>{issue?.label || "Sin alerta dominante"}</b>
      <em>{issue?.share || `${audit.rows} filas`}</em>
    </>;
    return issue?.key && onIssueSelect ? <button
      type="button"
      key={issue.key}
      className={issueClass}
      title={sample || undefined}
      onClick={() => onIssueSelect(issueActive ? "Todos" : issue.key)}
      aria-pressed={issueActive}
    >
      {issueBody}
    </button> : <span key={issue?.key || "none"} className={issueClass} title={sample || undefined}>{issueBody}</span>;
  };
  const metricButton = (key, count, label, metricTone = "") => {
    const active = activeProfileKey === key;
    const body = <>
      <b>{count}</b>
      <em>{label}</em>
    </>;
    return onProfileSelect ? <button
      type="button"
      className={`decisionQualityMetric ${metricTone} ${active ? "active" : ""}`}
      onClick={() => onProfileSelect(active ? "Todos" : key)}
      aria-pressed={active}
      title={key === "operable-fragile" ? fragileSample || "Operables con confianza no alta o confluencia minima" : undefined}
    >
      {body}
    </button> : <span className={`decisionQualityMetric ${metricTone}`}>{body}</span>;
  };
  return <div className={`decisionQualityStrip ${compact ? "compact" : ""} ${tone}`}>
    {metricButton("operable-clean", cleanOperableCount, "limpios", "good")}
    {metricButton("operable-fragile", fragileOperableCount, "fragiles", fragileOperableCount ? "warn" : "")}
    <span>
      <b>{riskCount}</b>
      <em>riesgo cola</em>
    </span>
    <span>
      <b>{auditCount}</b>
      <em>auditar</em>
    </span>
    <div className="decisionQualityIssueList" aria-label="Alertas principales de decision">
      {topIssues.length ? topIssues.map(issueChip) : issueChip(null)}
    </div>
  </div>;
}

export function DecisionOperatingBrief({ audit = null, rows = [], compact = false, onIssueSelect, onReadinessFilter, onConfidenceFilter, onReview }) {
  const brief = buildScreenerDecisionBrief({ audit, rows });
  if (!brief.rows) return null;
  const applyFilter = (filter = {}) => {
    if (filter.type === "readiness") onReadinessFilter?.(filter.value);
    else if (filter.type === "confidence") onConfidenceFilter?.(filter.value);
    else if (filter.type === "issue") onIssueSelect?.(filter.value);
    else if (filter.type === "review") onReview?.();
  };
  const filterAvailable = (filter = {}) => {
    if (filter.type === "readiness") return Boolean(onReadinessFilter);
    if (filter.type === "confidence") return Boolean(onConfidenceFilter);
    if (filter.type === "issue") return Boolean(onIssueSelect);
    if (filter.type === "review") return Boolean(onReview);
    return false;
  };
  const metricBody = (metric) => <>
    <b>{metric.value}</b>
    <span>{metric.label}</span>
    <em>{metric.share}</em>
  </>;
  return <section className={`decisionOperatingBrief ${compact ? "compact" : ""} ${brief.verdict.tone || "neutral"}`.trim()} aria-label="Lectura operativa del Screener">
    <div className="decisionOperatingIntro">
      <span>Lectura Screener</span>
      <strong>{brief.verdict.label}</strong>
      <p>{brief.verdict.detail}</p>
    </div>
    <div className="decisionOperatingMetrics">
      {brief.metrics.map((metric) => filterAvailable(metric.filter) ? <button
        type="button"
        key={metric.key}
        className={`decisionOperatingMetric ${metric.tone || "neutral"}`}
        onClick={() => applyFilter(metric.filter)}
        title={`Filtrar ${metric.label}`}
      >
        {metricBody(metric)}
      </button> : <span key={metric.key} className={`decisionOperatingMetric ${metric.tone || "neutral"}`}>{metricBody(metric)}</span>)}
    </div>
    <div className="decisionOperatingActions">
      {brief.primaryIssue ? <button
        type="button"
        className={`decisionOperatingIssue ${brief.primaryIssue.severity || "warn"}`}
        onClick={() => onIssueSelect?.(brief.primaryIssue.key)}
        disabled={!onIssueSelect}
        title={brief.primaryIssue.sample?.map((item) => item.symbol).filter(Boolean).join(", ") || brief.primaryIssue.label}
      >
        <span>Riesgo principal</span>
        <b>{brief.primaryIssue.label}</b>
        <em>{brief.primaryIssue.count} · {brief.primaryIssue.share}</em>
      </button> : <span className="decisionOperatingIssue good">
        <span>Riesgo principal</span>
        <b>Sin incidencia dominante</b>
        <em>scope limpio</em>
      </span>}
      <div>
        {brief.actions.map((item) => <button
          type="button"
          key={item.key}
          className="decisionOperatingAction"
          onClick={() => applyFilter(item.filter)}
          disabled={!filterAvailable(item.filter)}
          title={item.detail}
        >
          <b>{item.label}</b>
          <em>{item.detail}</em>
        </button>)}
      </div>
    </div>
  </section>;
}

export function DecisionSummaryRail({ summary = [], activeKey = "Todos", onSelect, className = "" }) {
  if (!summary.length) return null;
  return <div className={`decisionSummaryRail ${className}`.trim()} aria-label="Resumen por calidad de decision">
    {summary.map((item) => {
      const active = activeKey === item.key;
      return <button
        type="button"
        key={item.key}
        className={`decisionSummaryChip ${active ? "active" : ""}`}
        onClick={() => onSelect?.(active ? "Todos" : item.key)}
        aria-pressed={active}
      >
        <b>{item.count}</b>
        <span>{item.label}</span>
      </button>;
    })}
  </div>;
}

export function PendingDecisionWorkRail({ summary = null, active = false, onFocus, onClear, onReview, className = "" }) {
  if (!summary?.pendingCount) return null;
  const top = summary.top || null;
  return <div className={`pendingDecisionWorkRail ${active ? "active" : ""} ${className}`.trim()} aria-label="Trabajo pendiente de decision">
    <div className="pendingDecisionWorkStats">
      <span><b>{summary.pendingCount}</b><em>sin decidir</em></span>
      <span><b>{summary.highConfidenceCount || 0}</b><em>alta confianza</em></span>
      <span><b>{summary.reviewableCount || 0}</b><em>prioritarias</em></span>
    </div>
    <div className="pendingDecisionWorkFocus">
      <span>Foco sugerido</span>
      <b>{top?.symbol || "-"}</b>
      <em>{top ? `Pri ${Math.round(top.priority || 0)} · ${top.confidenceLabel || "Confianza"}` : "Sin foco"}</em>
    </div>
    <div className="pendingDecisionWorkActions">
      <button type="button" className={`pendingDecisionWorkPrimary ${active ? "active" : ""}`} onClick={onFocus}>
        Trabajo pendiente
      </button>
      <button type="button" onClick={onReview}>Revisar</button>
      {active ? <button type="button" onClick={onClear}>Limpiar enfoque</button> : null}
    </div>
  </div>;
}
