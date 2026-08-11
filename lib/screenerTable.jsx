// lib/screenerTable.jsx — tabla de resultados del screener y barra de resultados pendientes.
// Feature module: presentación de la tabla de resultados del screener.
//
// La tabla NO define columnas: las lee de lib/screenerColumns.jsx, que es la
// fuente única compartida con la vista móvil (docs/principios-producto.md,
// principio 7 y su nota de implementación). Este archivo solo pone el marco:
// cabecera, filas, celda vacía y el selector global de periodo.
//
// Lo que YA NO vive en la fila (principio 1 y 7): el veredicto, la confianza,
// las insignias de auditoría/fiabilidad, Minervini y Weinstein numéricos,
// RS Quality, deterioro, SMA50 y los tres RS por separado. Todo eso se sigue
// calculando y guardando; se consulta en la ficha del valor y en QuickReview.

import { InfoHint } from "@/app/components/ui/InfoHint";
import {
  PerformancePeriodPicker,
  SCREENER_COLUMNS,
  screenerColumnLabel,
} from "@/lib/screenerColumns";
import { countryName, marketFlag } from "@/lib/symbols";

export function CompactCountryFlag({ country }) {
  const code = String(country || "").toUpperCase();
  const safeCode = /^[A-Z]{2}$/.test(code) ? code : "XX";
  return <span
    className="compactCountryFlag"
    title={countryName(safeCode)}
    aria-label={countryName(safeCode)}
  >
    {marketFlag(safeCode)}
  </span>;
}

export function PendingResultsBar({ pending, visibleCount = 0, filteredCount = 0, onCommit }) {
  if (!pending?.rows?.length && !pending?.diagnostics) return null;
  const pendingCount = Number(pending.filteredCount ?? pending.rows?.length ?? 0);
  const delta = pendingCount - filteredCount;
  return <div className="pendingResultsBar">
    <span>{pending.done ? "Actualización lista" : "Lista congelada"}</span>
    <b>{pendingCount} resultados</b>
    {delta ? <em>{delta > 0 ? `+${delta}` : `${delta}`} vs visibles</em> : <em>{visibleCount} visibles</em>}
    <button type="button" className="btn btnSmall btnPrimary" onClick={onCommit}>Mostrar</button>
  </div>;
}

export function CompactResultsTable({
  rows = [],
  favoriteSymbols,
  onFavorite,
  onReview,
  onOpenStock,
  emptyLabel = "Ejecuta un scan para ver resultados",
  perfPeriod,
  onPerfPeriod,
}) {
  const ctx = { perfPeriod, favoriteSymbols, onFavorite, onOpenStock };
  return <div className="resultsTableBlock">
    <div className="resultsTableControls">
      <PerformancePeriodPicker value={perfPeriod} onChange={onPerfPeriod} />
    </div>
    <div className="tableWrap compactTableWrap">
      <table className="table compactResultsTable">
        <thead>
          <tr>
            {SCREENER_COLUMNS.map((column) => (
              <th key={column.key} className={column.className} data-align={column.align}>
                <span className="columnHead">
                  {screenerColumnLabel(column, ctx)}
                  {column.legend ? <InfoHint text={column.legend} /> : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
              onClick={(event) => { if (!event.target.closest("button, a")) onReview?.(row.symbol); }}
            >
              {SCREENER_COLUMNS.map((column) => (
                <td key={column.key} className={column.className} data-align={column.align}>
                  {column.cell(row, ctx)}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={SCREENER_COLUMNS.length} className="emptyResultsCell">{emptyLabel}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}
