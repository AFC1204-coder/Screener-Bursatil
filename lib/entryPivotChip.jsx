// lib/entryPivotChip.jsx — celda «Pivote · R» de la cinta (escritorio y móvil).
// Una sola celda, una línea: «-4,0% · R 6,8%» (distancia al pivote · riesgo
// hasta el stop de referencia). Lo ausente es «—» en --ghost, nunca 0. El
// detalle (pivote, stop y de dónde sale) vive en el title y en el bloque
// «Entrada» del panel. Sin colores: es un dato, no una señal.

import { ENTRY_ABSENT, entryChipForRow } from "@/lib/entryRisk";

export function HuntTapePivotCell({ row, className = "huntTapePivot" }) {
  const chip = entryChipForRow(row);
  if (chip.empty) {
    return (
      <span className={`${className} huntTapeGhost`} title={chip.title} aria-label={chip.title}>
        {ENTRY_ABSENT}
      </span>
    );
  }
  return (
    <span className={className} title={chip.title} aria-label={chip.title}>
      <span className={chip.hasDist ? "" : "huntTapeGhost"}>{chip.distText}</span>
      <span className="entryChipSep"> · R </span>
      <span className={chip.hasRisk ? "" : "huntTapeGhost"}>{chip.riskText}</span>
    </span>
  );
}
