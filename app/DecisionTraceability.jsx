"use client";

function reviewHref(source = "current", symbol = "") {
  const params = new URLSearchParams();
  params.set("source", source || "current");
  if (symbol) params.set("symbol", symbol);
  return `/review?${params.toString()}`;
}

export function DecisionTraceBadge({ resolution = null }) {
  if (!resolution) return null;
  return <span className={`decisionTraceBadge ${resolution.tone || "neutral"}`.trim()} aria-label={`Decision ${resolution.label || resolution.key}`} title={[resolution.label, resolution.note, resolution.detail].filter(Boolean).join(" · ")}>
    {resolution.label || resolution.key}
  </span>;
}

export function DecisionTracePanel({ summary = null, title = "Trazabilidad Review", detail = "Resoluciones guardadas desde Review/Ficha visibles en esta superficie." }) {
  if (!summary?.rows) return null;
  const hasResolved = summary.resolvedCount > 0;
  return <section className={`card decisionTracePanel ${hasResolved ? "active" : ""}`.trim()}>
    <div className="sectionTitle">
      <h2>{title}</h2>
      <span className={`decisionTraceStatus ${hasResolved ? "pass" : "warn"}`}>{hasResolved ? `${summary.resolvedCount} trazadas` : "Sin resoluciones"}</span>
    </div>
    <div className="decisionTraceGrid">
      <span><b>{summary.rows}</b><em>símbolos scope</em></span>
      <span><b>{summary.pendingCount}</b><em>sin decidir</em></span>
      <span><b>{summary.resolvedCount}</b><em>resueltas</em></span>
      <span><b>{summary.latest?.length || 0}</b><em>eventos recientes</em></span>
    </div>
    <div className="decisionTraceChips" aria-label="Resoluciones de decisión visibles">
      {summary.resolvedGroups.map((group) => <a
        className={`decisionTraceChip ${group.tone || "neutral"}`}
        href={reviewHref(summary.source, group.sampleSymbols?.[0] || "")}
        key={group.key}
        title={group.sampleSymbols?.length ? group.sampleSymbols.join(", ") : group.label}
      >
        <b>{group.count}</b>
        <span>{group.label}</span>
      </a>)}
      {!summary.resolvedGroups.length ? <span className="decisionTraceEmpty">Sin candidatas, vigilancia o descartes para los símbolos visibles.</span> : null}
    </div>
    {summary.latest?.length ? <div className="decisionTraceEvents" aria-label="Historial reciente de decisiones visibles">
      {summary.latest.map((entry, index) => <a
        className={`decisionTraceEvent ${entry.tone || "neutral"}`}
        href={reviewHref(summary.source, entry.symbol)}
        key={`${entry.symbol}-${entry.key}-${entry.updatedAt || index}`}
        title={[entry.detail, entry.note].filter(Boolean).join(" · ")}
      >
        <b>{entry.symbol}</b>
        <span>{entry.label || entry.key}</span>
        {entry.note ? <em>{entry.note}</em> : null}
      </a>)}
    </div> : null}
    <p className="fine">{detail}</p>
  </section>;
}
