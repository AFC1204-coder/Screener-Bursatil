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
  screenerColumnLabel,
  screenerColumnSortKey,
  screenerVisibleColumns,
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

export function CompactResultsTable({
  rows = [],
  favoriteSymbols,
  onFavorite,
  onReview,
  onOpenStock,
  selectedSymbol = "",
  onSelectRow,
  emptyLabel = "Sin datos cargados todavía.",
  perfPeriod,
  onPerfPeriod,
  sort = "",
  sortAsc = false,
  onSortColumn,
  setupMode = "",
}) {
  const ctx = { perfPeriod, favoriteSymbols, onFavorite, onOpenStock, sort, setupMode };
  const columns = screenerVisibleColumns(ctx);
  return <div className="resultsTableBlock">
    <div className="resultsTableControls">
      <PerformancePeriodPicker value={perfPeriod} onChange={onPerfPeriod} />
    </div>
    <div className="tableWrap compactTableWrap">
      <table className="table compactResultsTable">
        <thead>
          <tr>
            {columns.map((column) => {
              const columnSortKey = screenerColumnSortKey(column, ctx);
              const isSortable = Boolean(columnSortKey && onSortColumn);
              const isActive = columnSortKey && columnSortKey === sort;
              const headLabel = screenerColumnLabel(column, ctx);
              return (
                <th key={column.key} className={column.className} data-align={column.align}>
                  {isSortable ? (
                    <button
                      type="button"
                      className={`columnHead columnHeadBtn${isActive ? " isActive" : ""}`}
                      onClick={() => onSortColumn(columnSortKey)}
                      aria-sort={isActive ? (sortAsc ? "ascending" : "descending") : "none"}
                      title={`Ordenar por ${headLabel}`}
                    >
                      <span className="columnHeadText">{headLabel}</span>
                      {isActive ? <span className="sortIndicator" aria-hidden="true">{sortAsc ? "↑" : "↓"}</span> : null}
                      {column.legend ? <InfoHint text={column.legend} /> : null}
                    </button>
                  ) : (
                    <span className="columnHead">
                      {headLabel}
                      {column.legend ? <InfoHint text={column.legend} /> : null}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
              className={selectedSymbol === row.symbol ? "isSelected" : ""}
              tabIndex={selectedSymbol === row.symbol ? 0 : -1}
              aria-selected={selectedSymbol === row.symbol}
              onClick={(event) => {
                if (event.target.closest("button, a")) return;
                onSelectRow?.(row.symbol);
                onReview?.(row.symbol);
              }}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className} data-align={column.align}>
                  {column.cell(row, ctx)}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={columns.length} className="emptyResultsCell">{emptyLabel}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}
