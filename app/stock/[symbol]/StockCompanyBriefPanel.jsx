"use client";

import { amount, num as sharedNum } from "@/lib/formatters";

export default function StockCompanyBriefPanel({
  symbol = "",
  surface = null,
  expanded = false,
  onToggleExpanded,
  facts = null,
}) {
  const panel = surface || {
    state: "loading",
    message: "Cargando descripción del negocio…",
    summary: "",
    themeLabel: "",
    rsRows: [],
  };
  const summaryId = `hero-company-summary-${symbol || "stock"}`;
  const canExpand = panel.state === "ok" && panel.summary.length > 80;

  return (
    <section
      className="stockCompanyBriefPanel"
      aria-label="Resumen de negocio"
      data-state={panel.state}
      aria-busy={panel.state === "loading" ? "true" : "false"}
    >
      <div className="stockCompanyBriefHead">
        <h2 className="stockCompanyBriefTitle">Negocio</h2>
        {panel.themeLabel ? (
          <span className="stockCompanyBriefTheme">{panel.themeLabel}</span>
        ) : null}
      </div>

      {panel.rsRows?.length ? (
        <div className="stockCompanyBriefRsRow" aria-label="Rankings RS">
          {panel.rsRows.map((row) => (
            <div key={row.key} className="stockCompanyBriefRsItem">
              <span className="stockCompanyBriefRsLabel">{row.label}</span>
              <b
                className={`stockCompanyBriefRsValue ${row.cell.className || ""}`.trim()}
                title={row.cell.title || undefined}
                data-rs-state={row.cell.state}
              >
                {row.cell.text}
              </b>
            </div>
          ))}
        </div>
      ) : null}

      {panel.state === "loading" ? (
        <p className="stockCompanyBriefStatus" aria-live="polite">{panel.message}</p>
      ) : null}

      {panel.state === "empty" ? (
        <p className="stockCompanyBriefStatus stockCompanyBriefEmpty">{panel.message}</p>
      ) : null}

      {panel.state === "error" ? (
        <p className="stockCompanyBriefStatus stockCompanyBriefError" role="alert">{panel.message}</p>
      ) : null}

      {panel.state === "ok" ? (
        <div className={`stockCompanyBriefCopy ${expanded ? "isExpanded" : ""}`}>
          <p id={summaryId}>{panel.summary}</p>
          {canExpand ? (
            <button
              className="heroCompanyBriefToggle stockCompanyBriefToggle"
              type="button"
              aria-expanded={expanded}
              aria-controls={summaryId}
              onClick={onToggleExpanded}
            >
              {expanded ? "Ver menos" : "Ver completo"}
            </button>
          ) : null}
        </div>
      ) : null}

      {facts ? (
        <div className="stockCompanyBriefFacts" aria-label="Datos de empresa">
          {facts.map((fact) => (
            <div key={fact.label} className="stockCompanyBriefFact">
              <span>{fact.label}</span>
              <b data-state={fact.state || "value"} title={fact.title || undefined}>{fact.value}</b>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function stockCompanyBriefFacts(data = {}) {
  if (!data || data.notFound) return null;
  const employees = Number(data.employees);
  return [
    {
      label: "Subsector",
      value: data.industry || "—",
      state: data.industry ? "value" : "ghost",
    },
    {
      label: "Cap.",
      value: Number.isFinite(data.marketCap)
        ? amount(data.marketCap, data.marketCapCurrency || data.currency || "")
        : "—",
      state: Number.isFinite(data.marketCap) ? "value" : "ghost",
    },
    {
      label: "Empleados",
      value: Number.isFinite(employees) ? sharedNum(employees) : "—",
      state: Number.isFinite(employees) ? "value" : "ghost",
    },
  ];
}
