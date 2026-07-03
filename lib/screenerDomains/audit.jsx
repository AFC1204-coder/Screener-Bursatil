// lib/screenerDomains/audit.jsx — componentes del dominio "auditoría" del screener:
// pruebas de decisión, score-audit y auditabilidad. Componentes de presentación
// pura (sin estado ni efectos). Extraídos de app/screenerPanels.jsx.

import { decisionEvidenceFilterLabel } from "@/lib/screenerExplainability";
import { scoreAuditFilterLabel, scoreAuditReviewReasons } from "@/lib/screenerScoreAudit";

export function scoreAuditCompactFilterKey(audit = null) {
  if (!audit) return "all";
  const residualWarn = Number.isFinite(audit.residual) && Math.abs(audit.residual) >= 4;
  if (residualWarn) return "mismatch";
  if (Array.isArray(audit.missing) && audit.missing.length) return "missing";
  if (audit.integrityTone === "good") return "clean";
  return "attention";
}

export function scoreAuditCompactLabel(audit = null) {
  const key = scoreAuditCompactFilterKey(audit);
  if (key === "clean") return "Traz.";
  if (key === "mismatch") return "Desc.";
  if (key === "missing") return "Inc.";
  if (key === "attention") return "Revisar";
  return "Score";
}

export function DecisionEvidenceChecklist({ evidence = null, compact = false, activeKey = "all", onFilter }) {
  const items = Array.isArray(evidence?.pending) && evidence.pending.length
    ? evidence.pending
    : Array.isArray(evidence?.items) ? evidence.items.filter((item) => item.status === "confirmed") : [];
  if (!items.length) return null;
  const label = evidence?.pending?.length ? "Pruebas pendientes" : "Pruebas confirmadas";
  const filterKey = evidence?.status || "all";
  const canFilter = compact && filterKey !== "all" && typeof onFilter === "function";
  const active = activeKey === filterKey;
  const className = `decisionEvidenceChecklist ${compact ? "compact" : ""} ${evidence?.tone || ""} ${canFilter ? "compactTrustFilter" : ""} ${active ? "active" : ""}`.trim();
  const reviewFocus = Array.isArray(evidence?.reviewFocus) ? evidence.reviewFocus.filter((item) => item?.label || item?.key).slice(0, 2) : [];
  const compactLabel = filterKey === "complete"
    ? "OK"
    : filterKey === "blocked"
      ? "Bloq."
      : filterKey === "needs-work"
        ? "Validar"
        : evidence?.pending?.length ? "Revisar" : "OK";
  const compactTitle = [
    label,
    Number.isFinite(evidence?.passedCount) && Number.isFinite(evidence?.totalCount) ? `${evidence.passedCount}/${evidence.totalCount}` : "",
    items.slice(0, 4).map((item) => [item.label, item.statusLabel || item.status, item.detail].filter(Boolean).join(": ")).join(" · "),
    reviewFocus.map((item) => [item.label, item.action || item.detail].filter(Boolean).join(": ")).join(" · "),
    canFilter ? `Filtrar similares: ${decisionEvidenceFilterLabel(filterKey)}` : "",
  ].filter(Boolean).join(" · ");
  if (compact) {
    const body = <>
      <span>
        <b>Pruebas</b>
        <em>{compactLabel}</em>
      </span>
      {items.length > 1 ? <i>{items.length}</i> : null}
    </>;
    if (canFilter) {
      return <button
        type="button"
        className={className}
        aria-label={`Filtrar resultados por pruebas: ${decisionEvidenceFilterLabel(filterKey)}`}
        aria-pressed={active}
        title={compactTitle}
        onClick={(event) => { event.stopPropagation(); onFilter(filterKey); }}
      >
        {body}
      </button>;
    }
    return <span className={className} title={compactTitle}>{body}</span>;
  }
  const body = <>
    <span>{label}<em>{Number.isFinite(evidence?.passedCount) && Number.isFinite(evidence?.totalCount) ? `${evidence.passedCount}/${evidence.totalCount}` : ""}</em></span>
    <div>
      {items.slice(0, compact ? 2 : 4).map((item) => <strong key={item.key || item.label} className={item.tone || ""} title={item.detail || undefined}>
        <b>{item.label}</b>
        <em>{item.statusLabel || item.status}</em>
      </strong>)}
    </div>
    {!compact && reviewFocus.length ? <section className="decisionEvidenceReviewFocus" aria-label="Foco de revision metodologica">
      <span>{evidence?.manualReviewRequired ? "Foco revision" : "Contexto observado"}</span>
      {reviewFocus.map((item) => {
        const visibleDetail = item.detail || item.statusLabel || item.status || "Validar";
        const fullDetail = [item.action, item.detail].filter(Boolean).join(" · ") || undefined;
        return <p key={`review-${item.key || item.label}`} className={item.tone || "neutral"} title={fullDetail}>
          <b>{item.label}</b>
          <em>{visibleDetail}</em>
        </p>;
      })}
    </section> : null}
    {canFilter ? <i>{active ? "Filtro activo" : `Filtrar ${decisionEvidenceFilterLabel(filterKey, { compact: true })}`}</i> : null}
  </>;
  if (canFilter) {
    return <button
      type="button"
      className={className}
      aria-label={`Filtrar resultados por pruebas: ${decisionEvidenceFilterLabel(filterKey)}`}
      aria-pressed={active}
      title={`Filtrar similares: ${decisionEvidenceFilterLabel(filterKey)}`}
      onClick={(event) => { event.stopPropagation(); onFilter(filterKey); }}
    >
      {body}
    </button>;
  }
  return <div className={className} aria-label="Pruebas de decision">{body}</div>;
}

export function ScoreAuditPanel({ audit = null, compact = false, activeKey = "all", onFilter }) {
  if (!audit) return null;
  const reasons = scoreAuditReviewReasons(audit);
  const visibleComponents = compact ? audit.positive.slice(0, 3) : audit.components.filter((item) => !item.optional || item.value != null);
  const tooltip = [audit.formula, Number.isFinite(audit.residual) ? `Diferencia vs score mostrado ${audit.residual.toFixed(1)}` : ""].filter(Boolean).join(" · ");
  if (compact) {
    const filterKey = scoreAuditCompactFilterKey(audit);
    const canFilter = filterKey !== "all" && typeof onFilter === "function";
    const active = activeKey === filterKey;
    const className = `scoreAuditMini ${audit.integrityTone || "neutral"} ${canFilter ? "compactTrustFilter" : ""} ${active ? "active" : ""}`.trim();
    const body = <>
      <b>Score</b>
      <em>{scoreAuditCompactLabel(audit)}</em>
    </>;
    if (canFilter) {
      return <button
        type="button"
        className={className}
        aria-label={`Filtrar resultados por auditoría de score: ${scoreAuditFilterLabel(filterKey)}`}
        aria-pressed={active}
        title={[tooltip, `Filtrar similares: ${scoreAuditFilterLabel(filterKey)}`].filter(Boolean).join(" · ")}
        onClick={(event) => { event.stopPropagation(); onFilter(filterKey); }}
      >
        {body}
      </button>;
    }
    return <span className={className} title={tooltip}>{body}</span>;
  }
  return <div className={`scoreAuditPanel ${audit.integrityTone || "neutral"}`} aria-label="Composición auditable del score">
    <div className="scoreAuditHead">
      <span>Score audit</span>
      <b>{Number.isFinite(audit.displayedScore) ? audit.displayedScore.toFixed(0) : "-"}</b>
      <em>calc {audit.calculatedScore.toFixed(1)}{Number.isFinite(audit.residual) ? ` · Δ ${audit.residual.toFixed(1)}` : ""}</em>
    </div>
    {reasons.length ? <div className="scoreAuditReasons" aria-label="Motivos de auditoría del score">
      {reasons.slice(0, 4).map((item) => <span className={item.tone || "neutral"} key={item.key} title={item.detail || item.label}>
        <b>{item.label}</b>
        <em>{item.value || item.detail || ""}</em>
      </span>)}
    </div> : null}
    <div className="scoreAuditComponents">
      {visibleComponents.map((item) => <span className={`scoreAuditComponent ${item.tone || "neutral"}`} key={item.key} title={`${item.label}: ${item.value ?? "sin dato"} x ${item.weight}`}>
        <b>{item.label}</b>
        <em>{item.value == null ? "-" : item.value.toFixed(0)}</em>
        <i>+{item.points.toFixed(1)}</i>
      </span>)}
    </div>
    {(audit.drags.length || audit.risks.length || audit.missing.length) ? <div className="scoreAuditRisks">
      {audit.drags.slice(0, 3).map((item) => <span className="warn" key={`drag-${item.key}`}>{item.label} {item.value?.toFixed(0)}</span>)}
      {audit.risks.slice(0, 3).map((item) => <span className={item.tone || "warn"} key={`risk-${item.key}`}>{item.label}</span>)}
      {audit.missing.slice(0, 2).map((item) => <span className="warn" key={`missing-${item.key}`}>{item.label} sin dato</span>)}
    </div> : null}
  </div>;
}

export function DecisionEvidenceSummaryRail({ summary = null, activeKey = "all", onSelect, onReview, compact = false }) {
  if (!summary?.rows) return null;
  const items = (summary.items || []).filter((item) => item.count > 0);
  const activeItem = activeKey !== "all" ? items.find((item) => item.key === activeKey) : null;
  const reviewTarget = activeItem || items.find((item) => item.key === "needs-work") || items.find((item) => item.key === "blocked") || items[0];
  const railClass = ["decisionRail", "decisionEvidenceSummaryRail", "dataHealthSummaryRail", compact ? "compact" : "", summary.verdict?.tone || "neutral"].filter(Boolean).join(" ");
  const selectItem = (item) => {
    if (!item?.key) return;
    onSelect?.(activeKey === item.key ? "all" : item.key);
  };
  return <section className={railClass} aria-label="Resumen de pruebas de decision">
    <div className="dataHealthSummaryIntro" title={summary.verdict?.detail || `${summary.rows} filas evaluadas`}>
      <span>Pruebas</span>
      <b>{summary.verdict?.label || "Checklist"}</b>
      <em>{summary.rows} filas</em>
    </div>
    <div className="dataHealthSummaryItems">
      {items.map((item) => {
        const active = activeKey === item.key;
        const body = <>
          <b>{item.count}</b>
          <span>{item.label}</span>
          <em>{item.share}</em>
        </>;
        return onSelect ? <button
          type="button"
          key={item.key}
          className={["dataHealthSummaryItem", item.tone || "neutral", active ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => selectItem(item)}
          aria-pressed={active}
          title={`Filtrar ${decisionEvidenceFilterLabel(item.key)}`}
        >
          {body}
        </button> : <span key={item.key} className={`dataHealthSummaryItem ${item.tone || "neutral"}`}>{body}</span>;
      })}
    </div>
    {summary.topIssues?.length || onReview ? <div className="dataHealthSummaryIssues decisionEvidenceActions">
      {summary.topIssues?.length && !compact ? summary.topIssues.slice(0, 2).map((item) => <span className={item.tone || "warn"} key={item.key}>
        <b>{item.label}</b>
        <em>{item.count} · {item.share}</em>
      </span>) : null}
      {onReview && reviewTarget ? <button
        type="button"
        className={`decisionEvidenceReviewAction ${reviewTarget.tone || "neutral"}`}
        onClick={() => onReview(reviewTarget.key)}
        title={`Abrir Review: ${decisionEvidenceFilterLabel(reviewTarget.key)}`}
      >
        <b>Revisar</b>
        <em>{decisionEvidenceFilterLabel(reviewTarget.key, { compact: true })}</em>
      </button> : null}
    </div> : null}
  </section>;
}

export function scoreAuditShare(count = 0, total = 0) {
  if (!total) return "0%";
  const value = (count / total) * 100;
  return `${value >= 10 || count === total ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function ScoreAuditSummaryRail({ summary = null, activeKey = "all", onSelect, onReview, compact = false }) {
  if (!summary?.rows) return null;
  const total = summary.rows || 0;
  const items = [
    { key: "clean", count: summary.cleanCount || 0, label: "Trazable", tone: "good", share: summary.cleanShare || scoreAuditShare(summary.cleanCount, total) },
    { key: "attention", count: summary.attentionCount || 0, label: "Revisar", tone: summary.attentionCount ? "warn" : "good", share: summary.attentionShare || scoreAuditShare(summary.attentionCount, total) },
    { key: "mismatch", count: summary.mismatchCount || 0, label: "Descuadre", tone: summary.mismatchCount ? "warn" : "muted", share: scoreAuditShare(summary.mismatchCount, total) },
    { key: "missing", count: summary.missingRows || 0, label: "Incompleto", tone: summary.missingRows ? "warn" : "muted", share: scoreAuditShare(summary.missingRows, total) },
  ].filter((item) => item.count > 0 || item.key === "clean");
  const topIssues = [
    ...(summary.topMissing || []).slice(0, 1).map((item) => ({ ...item, label: `${item.label} sin dato` })),
    ...(summary.topDrags || []).slice(0, 1),
    ...(summary.topRisks || []).slice(0, 1),
  ].slice(0, 3);
  const actionableKeys = ["attention", "mismatch", "missing"];
  const activeReviewTarget = actionableKeys.includes(activeKey)
    ? items.find((item) => item.key === activeKey && item.count > 0)
    : null;
  const reviewTarget = activeReviewTarget
    || items.find((item) => item.key === "attention" && item.count > 0)
    || items.find((item) => item.key === "mismatch" && item.count > 0)
    || items.find((item) => item.key === "missing" && item.count > 0);
  const railClass = ["decisionRail", "scoreAuditSummaryRail", "dataHealthSummaryRail", compact ? "compact" : "", summary.verdict?.tone || "neutral"].filter(Boolean).join(" ");
  const selectItem = (item) => {
    if (!item?.key) return;
    onSelect?.(activeKey === item.key ? "all" : item.key);
  };
  return <section className={railClass} aria-label="Resumen de auditoría de score">
    <div className="dataHealthSummaryIntro" title={summary.verdict?.detail || `${summary.rows} filas auditadas`}>
      <span>Score audit</span>
      <b>{summary.verdict?.label || "Score trazable"}</b>
      <em>{summary.rows} filas</em>
    </div>
    <div className="dataHealthSummaryItems">
      {items.map((item) => {
        const active = activeKey === item.key;
        const body = <>
          <b>{item.count}</b>
          <span>{item.label}</span>
          <em>{item.share}</em>
        </>;
        return onSelect ? <button
          type="button"
          key={item.key}
          className={["scoreAuditSummaryItem", "dataHealthSummaryItem", item.tone || "neutral", active ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => selectItem(item)}
          aria-pressed={active}
          title={`Filtrar ${scoreAuditFilterLabel(item.key)}`}
        >
          {body}
        </button> : <span key={item.key} className={`scoreAuditSummaryItem dataHealthSummaryItem ${item.tone || "neutral"}`}>{body}</span>;
      })}
    </div>
    {(topIssues.length && !compact) || (onReview && reviewTarget) ? <div className="dataHealthSummaryIssues scoreAuditActions">
      {topIssues.length && !compact ? topIssues.map((item) => <span className={item.tone || "warn"} key={`${item.key}-${item.label}`}>
        <b>{item.label}</b>
        <em>{item.count} · {item.share}</em>
      </span>) : null}
      {onReview && reviewTarget ? <button
        type="button"
        className={`scoreAuditReviewAction ${reviewTarget.tone || "neutral"}`}
        onClick={() => onReview(reviewTarget.key)}
        title={`Abrir Review: ${scoreAuditFilterLabel(reviewTarget.key)}`}
      >
        <b>Auditar</b>
        <em>{scoreAuditFilterLabel(reviewTarget.key, { compact: true })}</em>
      </button> : null}
    </div> : null}
  </section>;
}

export function AuditabilitySummaryRail({ summary = null, compact = false, onReviewFocus }) {
  if (!summary?.rows) return null;
  const railClass = ["decisionRail", "auditabilitySummaryRail", "dataHealthSummaryRail", compact ? "compact" : "", summary.verdict?.tone || "neutral"].filter(Boolean).join(" ");
  const reviewFocus = (summary.methodologyReviewFocus || []).slice(0, 3);
  const limitations = (summary.methodologyLimitations || []).slice(0, 3);
  const usageTitle = "Herramienta de observación; no sustituye el criterio metodológico del inversor.";
  return <section className={railClass} aria-label="Auditabilidad interna">
    <div className="dataHealthSummaryIntro" title={summary.verdict?.detail || usageTitle}>
      <span>Auditabilidad</span>
      <b>{summary.auditabilityShare}</b>
      <em>{summary.verdict?.label || `${summary.rows} filas`}</em>
    </div>
    <div className="dataHealthSummaryItems">
      {(summary.items || []).map((item) => <span key={item.key} className={`dataHealthSummaryItem ${item.tone || "neutral"}`}>
        <b>{item.count}</b>
        <span>{item.label}</span>
        <em>{item.share}</em>
      </span>)}
    </div>
    {!compact ? <div className="dataHealthSummaryIssues">
      <span className={summary.counts?.fullyAuditable === summary.rows ? "good" : "warn"}>
        <b>Snapshot</b>
        <em>{summary.snapshotIntegrity} íntegro</em>
      </span>
      {reviewFocus.map((item) => {
        const meta = item.share || (item.count ? `${item.count}` : "");
        const body = <>
          <b>{item.label}</b>
          <em>{meta}</em>
        </>;
        return onReviewFocus ? <button
          type="button"
          className={`decisionEvidenceReviewAction ${item.tone || "warn"}`}
          key={`methodology-review-${item.key}`}
          title={[item.action, item.toneSummary].filter(Boolean).join(" · ") || undefined}
          aria-label={`Abrir Review: ${item.label}`}
          onClick={() => onReviewFocus(item.key)}
        >
          {body}
        </button> : <span className={item.tone || "warn"} key={`methodology-review-${item.key}`} title={[item.action, item.toneSummary].filter(Boolean).join(" · ") || undefined}>
          {body}
        </span>;
      })}
      {limitations.map((item) => {
        const meta = item.share || (item.count ? `${item.count}` : "");
        return <span className={item.tone || "neutral"} key={`methodology-limit-${item.key}`} title={item.toneSummary || undefined}>
          <b>{item.label}</b>
          <em>{meta}</em>
        </span>;
      })}
      <span className="neutral" title={usageTitle}>
        <b>Uso</b>
        <em>Observación</em>
      </span>
    </div> : null}
  </section>;
}
