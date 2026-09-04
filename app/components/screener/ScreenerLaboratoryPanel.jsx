"use client";

import GlobalCoveragePanel from "@/app/components/screener/GlobalCoveragePanel";
import { FilterDiagnosticsPanel } from "@/app/screenerPanels";

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
      <details className="disclosurePanel globalCoverageDisclosure">
        <summary>
          <span>Cobertura internacional por mercado</span>
          <em>informativo</em>
        </summary>
        <GlobalCoveragePanel />
      </details>
    </details>
  );
}
