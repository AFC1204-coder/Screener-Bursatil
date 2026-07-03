// lib/screenerAtoms.jsx — primitivas UI compartidas del screener.
// Componentes pequeños usados por varios módulos feature (Table, Market, Mobile).
// Mantener acá rompe el ciclo Table↔Market: ambos importan de aquí, ninguno del otro.

import { useEffect, useState } from "react";
import { safeRead, safeWrite } from "@/lib/localState";
import {
  chartPath,
  companyLogoDomain,
  compactIssueLabel,
  initials,
  vcpCompactLabel,
} from "@/lib/screenerFormat";

export function MiniSparkline({ bars = [] }) {
  const points = bars.filter((x) => Number.isFinite(x.close));
  if (points.length < 2) return <div className="previewEmpty">Sin dato</div>;
  const w = 260, h = 118, pad = 10;
  const values = points.flatMap((p) => [p.close, p.sma50, p.sma200].filter(Number.isFinite));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, max * 0.02);
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => pad + (1 - ((v - min) / range)) * (h - pad * 2);
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const trendClass = last >= first ? "up" : "down";
  const volumeMax = Math.max(...points.map((p) => p.volume || 0), 1);
  const barW = Math.max(1.2, (w - pad * 2) / points.length - 1);
  return <svg className={`miniSparkline ${trendClass}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grafico tecnico compacto">
    <line x1={pad} x2={w - pad} y1={y(max)} y2={y(max)} className="sparkGuide" />
    <line x1={pad} x2={w - pad} y1={y(min)} y2={y(min)} className="sparkGuide" />
    {points.map((p, i) => {
      const vh = Math.max(1, ((p.volume || 0) / volumeMax) * 20);
      return <rect key={`${p.date}-${i}`} x={x(i) - barW / 2} y={h - pad - vh} width={barW} height={vh} className="sparkVolume" />;
    })}
    <path d={chartPath(points, "sma200", x, y)} className="sparkMa sparkMa200" />
    <path d={chartPath(points, "sma50", x, y)} className="sparkMa sparkMa50" />
    <path d={chartPath(points, "close", x, y)} className="sparkPrice" />
    <circle cx={x(points.length - 1)} cy={y(last)} r="3.4" className="sparkLast" />
  </svg>;
}

export function CompanyMark({ row = {}, size = "md" }) {
  const domain = companyLogoDomain(row);
  const logo = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : "";
  const [failedLogo, setFailedLogo] = useState("");
  const canShowLogo = logo && failedLogo !== logo;
  return <span className={`companyMark companyMark-${size}`}>
    {canShowLogo ? <img src={logo} alt="" loading="lazy" onError={() => setFailedLogo(logo)} /> : <b>{initials(row.companyName || row.name, row.symbol)}</b>}
  </span>;
}

export function CompactMetric({ label, value, tone = "", source = null, title = "", className = "", zero = false, metricType = "quality" }) {
  const sourceClass = source?.key ? `source-${source.key}` : "";
  const sourceTitle = source?.title || "";
  const valueText = value ?? "-";
  const titleText = [title, sourceTitle].filter(Boolean).join(" · ") || undefined;
  const ariaLabel = sourceTitle ? `${label}: ${valueText}. ${sourceTitle}` : undefined;
  return <span className={`compactMetric ${className} ${tone} ${sourceClass}`.trim()} title={titleText} aria-label={ariaLabel} data-zero={zero ? "true" : "false"} data-metric-type={metricType}>
    <small>{label}</small>
    <b>{valueText}</b>
    {source?.mark ? <i aria-hidden="true">{source.mark}</i> : null}
  </span>;
}

export function ReviewFocusPill({ focus = null }) {
  if (!focus) return null;
  return <span className={`reviewFocusPill ${focus.tone || "warn"} focus-${focus.key || "other"}`} title={focus.detail || focus.label}>
    <b>Foco</b>
    <em>{focus.label}</em>
  </span>;
}

export function DecisionIssueBadge({ issues = [], compact = false, activeKey = "Todos", onSelect }) {
  const primary = issues[0];
  if (!primary) return null;
  const active = primary.key && activeKey === primary.key;
  const detail = issues.map((issue) => issue.detail ? `${issue.label}: ${issue.detail}` : issue.label).join(" · ");
  const className = `decisionIssueBadge ${compact ? "compact" : ""} ${primary.severity || "warn"} ${active ? "active" : ""}`;
  const body = <>
    <b>{compact ? compactIssueLabel(primary.label, primary.key) : primary.label}</b>
    {issues.length > 1 ? <em>+{issues.length - 1}</em> : null}
  </>;
  return primary.key && onSelect ? <button
    type="button"
    className={className}
    title={detail}
    onClick={(event) => {
      event.stopPropagation();
      onSelect(active ? "Todos" : primary.key);
    }}
    aria-pressed={active}
  >
    {body}
  </button> : <span className={className} title={detail}>{body}</span>;
}

export function VcpReliabilityPill({ audit = null }) {
  if (!audit) return null;
  const title = [
    audit.label,
    Number.isFinite(audit.auditabilityPct) ? `${audit.auditabilityPct}%` : "",
    audit.summary,
    audit.sequence ? `Secuencia ${audit.sequence}` : "",
    audit.note,
  ].filter(Boolean).join(" · ");
  return <span className={`vcpReliabilityPill ${audit.tone || "neutral"}`} title={title}>
    <b>VCP</b>
    <em>{vcpCompactLabel(audit)}</em>
  </span>;
}

export function ObjectiveMetricTruthPill({ state = null }) {
  if (!state) return null;
  return <span className={`objectiveMetricTruthPill ${state.tone || "neutral"}`} title={state.title || state.label}>
    <b>Metr.</b>
    <em>{state.label}</em>
  </span>;
}

// ResultsDisclosureGroup — shell unificado para los disclosure groups de resultados
// (Decisiones, Auditoría y datos, Filtros). Unifica el "chrome" (contenedor,
// comportamiento de apertura, persistencia) entre desktop y móvil.
//
// Estado: TOTALMENTE CONTROLADO cuando storageKey está presente. useState arranca
// con defaultOpen; useEffect lee localStorage al montar y sobrescribe si hay un
// valor persistido. onToggle persiste el nuevo estado. Misma storageKey en
// desktop y móvil → estado sincronizado al montar (cada superficie lee el mismo
// valor al aparecer). Nunca mixto: o todas las superficies usan storageKey
// (controlado) o ninguna (no-controlado, defaultOpen nativo).
export function ResultsDisclosureGroup({ label, count, defaultOpen = false, storageKey = null, className = "", children }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!storageKey) return;
    const stored = safeRead(storageKey, null);
    if (stored !== null) setOpen(Boolean(stored));
  }, [storageKey]);
  const handleToggle = (event) => {
    if (!storageKey) return;
    const next = event.currentTarget.open;
    setOpen(next);
    safeWrite(storageKey, next);
  };
  return (
    <details
      className={`disclosurePanel ${className}`.trim()}
      open={open || undefined}
      onToggle={storageKey ? handleToggle : undefined}
    >
      <summary><span>{label}</span>{count != null ? <em>{count}</em> : null}</summary>
      {children}
    </details>
  );
}
