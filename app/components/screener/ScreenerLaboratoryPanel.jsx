"use client";

import { useState } from "react";
import GlobalCoveragePanel from "@/app/components/screener/GlobalCoveragePanel";
import { FilterDiagnosticsPanel } from "@/app/screenerPanels";

/**
 * Cobertura solo monta (y fetch) cuando el usuario abre el disclosure.
 * T9: no competir con el cold start del escaneo en el pasillo de carga.
 */
function GlobalCoverageDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="disclosurePanel globalCoverageDisclosure"
      onToggle={(event) => {
        setOpen(Boolean(event.currentTarget.open));
      }}
    >
      <summary>
        <span>Cobertura internacional por mercado</span>
        <em>informativo</em>
      </summary>
      {open ? <GlobalCoveragePanel /> : null}
    </details>
  );
}

export default function ScreenerLaboratoryPanel({ diagnostics, resultsRows, resultsFiltered }) {
  return (
    <details className="disclosurePanel screenerDiagnosticsDisclosure screenerLaboratoryPanel">
      <summary>
        <span>Diagnóstico</span>
        <em>auditoría · cobertura</em>
      </summary>
      <details className="scanDiagnosticsDisclosure">
        <summary>
          <span>Auditoría de filtros</span>
          <em>{diagnostics ? `${diagnostics.finalCount}/${diagnostics.analyzed} pasan` : "sin datos"}</em>
        </summary>
        <FilterDiagnosticsPanel diagnostics={diagnostics} rowsCount={resultsRows.length} filteredCount={resultsFiltered.length} />
      </details>
      <GlobalCoverageDisclosure />
    </details>
  );
}
