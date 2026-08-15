// lib/screenerDomains/dataHealth.jsx — componentes del dominio "salud de datos"
// del screener. Componentes de presentación pura (sin estado ni efectos).
// Extraídos de app/screenerPanels.jsx.

import { dataHealthFilterLabel } from "@/lib/screenerDataHealth";

export function dataHealthCompactLabel(health = null) {
  const key = health?.status?.key || "";
  if (key === "ready") return "OK";
  if (key === "stale") return "Viejo";
  if (key === "blocked") return "Bloq.";
  if (key === "thin") return "Parcial";
  if (key === "limited") return "Parcial";
  return health?.status?.label || "Datos";
}

export function DataHealthPanel({ health = null, compact = false, activeKey = "Todos", onFilter }) {
  if (!health) return null;
  const tone = health.status?.tone || "neutral";
  const title = [health.status?.detail, health.topLine, health.provider?.detail].filter(Boolean).join(" · ");
  if (compact) {
    const filterKey = health.status?.key || "unknown";
    const canFilter = filterKey !== "Todos" && typeof onFilter === "function";
    const active = activeKey === filterKey;
    const className = `dataHealthBadge ${tone} ${canFilter ? "compactTrustFilter" : ""} ${active ? "active" : ""}`.trim();
    const body = <>
      <b>Datos</b>
      <em>{dataHealthCompactLabel(health)}</em>
    </>;
    if (canFilter) {
      return <button
        type="button"
        className={className}
        aria-label={`Filtrar resultados por salud de datos: ${dataHealthFilterLabel(filterKey)}`}
        aria-pressed={active}
        title={[title, `Filtrar similares: ${dataHealthFilterLabel(filterKey)}`].filter(Boolean).join(" · ")}
        onClick={(event) => { event.stopPropagation(); onFilter(filterKey); }}
      >
        {body}
      </button>;
    }
    return <span className={className} title={title}>{body}</span>;
  }
  return <div className={`dataHealthPanel ${tone}`} aria-label="Salud de datos del resultado">
    <div className="dataHealthHead">
      <span>Salud datos</span>
      <b>{health.status?.label || "Sin auditoría"}</b>
      <em>{health.status?.detail || health.topLine}</em>
    </div>
    <div className="dataHealthMetrics">
      {health.metrics.map((item) => <span className={`dataHealthMetric ${item.tone || "neutral"}`} key={item.key} title={item.detail || undefined}>
        <b>{item.label}</b>
        <em>{item.value == null ? "-" : `${item.value}${item.suffix || ""}`}</em>
      </span>)}
    </div>
    <div className="dataHealthMeta">
      <span className={health.freshness?.tone || ""}>
        <b>Frescura</b>
        <em>{health.freshness?.detail || health.freshness?.label || "-"}</em>
      </span>
      <span className={health.provider?.tone || ""} title={health.provider?.detail || undefined}>
        <b>Fuente</b>
        <em>{health.provider?.label || "-"}</em>
      </span>
    </div>
    {health.issues?.length ? <div className="dataHealthIssues">
      {health.issues.slice(0, 4).map((item) => <span className={item.tone || "warn"} key={item.key} title={item.detail || undefined}>{item.label}</span>)}
    </div> : null}
  </div>;
}

export function DataHealthSummaryRail({ summary = null, activeKey = "Todos", onSelect, compact = false }) {
  if (!summary?.rows) return null;
  const items = (summary.items || []).filter((item) => item.count > 0);
  const railClass = ["decisionRail", "dataHealthSummaryRail", compact ? "compact" : "", summary.verdict?.tone || "neutral"].filter(Boolean).join(" ");
  const selectItem = (item) => {
    if (!item?.key) return;
    onSelect?.(activeKey === item.key ? "Todos" : item.key);
  };
  return <section className={railClass} aria-label="Resumen de salud de datos">
    <div className="dataHealthSummaryIntro" title={summary.verdict?.detail || `${summary.rows} filas`}>
      <span>Salud datos</span>
      <b>{summary.verdict?.label || "Base de datos"}</b>
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
          title={`Filtrar ${item.fullLabel}`}
        >
          {body}
        </button> : <span key={item.key} className={`dataHealthSummaryItem ${item.tone || "neutral"}`}>{body}</span>;
      })}
    </div>
    {summary.topIssues?.length && !compact ? <div className="dataHealthSummaryIssues">
      {summary.topIssues.slice(0, 3).map((item) => <span className={item.tone || "warn"} key={item.key}>
        <b>{item.label}</b>
        <em>{item.count} · {item.share}</em>
      </span>)}
    </div> : null}
  </section>;
}
