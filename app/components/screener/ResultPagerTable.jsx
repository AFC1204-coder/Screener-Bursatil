"use client";

// ResultPagerTable — slice presentacional de ScreenerShell.
// Contiene el pager (range/page-size/prev/next) y la CompactResultsTable.
// Recibe SOLO los slices que consume este bloque (no el prop-bag completo).
// El pager se renderiza solo cuando hay resultados visibles (preserva la
// gatera `visibleCount > 0` del shell original).

import { CompactResultsTable } from "@/app/screenerPanels";
import { RESULT_PAGE_SIZES } from "@/lib/screenerConfig";

export default function ResultPagerTable({
  visibleCount,
  // Pager
  resultPageStart,
  resultPageEnd,
  resultPageSize,
  onPageSizeChange,
  visibleResultPage,
  totalResultPages,
  onSetResultPage,
  // Table
  pagedRows,
  favoriteSymbols,
  onFavorite,
  onReview,
  onOpenStock,
  selectedSymbol,
  onSelectRow,
  perfPeriod,
  onPerfPeriod,
  sort = "",
  sortAsc = false,
  onSortColumn,
  setupMode = "",
  emptyLabel,
}) {
  // El pie ocupaba una franja entera para repetir un dato que ya está en la
  // cabecera ("N resultados"). Con una sola página no aporta nada y no se pinta;
  // con varias se reduce a una línea: rango + tamaño de página + dos flechas.
  const multiPage = totalResultPages > 1;
  return (
    <>
      {visibleCount && multiPage ? (
        <div className="controls resultPager">
          <span className="fine resultPagerRange">
            {resultPageStart + 1}-{resultPageEnd} de {visibleCount} · pág. {visibleResultPage}/{totalResultPages}
          </span>
          <div className="controls resultPagerControls">
            <select className="select resultPagerSize" value={resultPageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} aria-label="Acciones por página">
              {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}/pág.</option>)}
            </select>
            <button className="btn btnSmall btnGhost resultPagerStep" onClick={() => onSetResultPage(visibleResultPage - 1)} disabled={visibleResultPage <= 1} aria-label="Página anterior" title="Página anterior">‹</button>
            <button className="btn btnSmall btnGhost resultPagerStep" onClick={() => onSetResultPage(visibleResultPage + 1)} disabled={visibleResultPage >= totalResultPages} aria-label="Página siguiente" title="Página siguiente">›</button>
          </div>
        </div>
      ) : null}
      <CompactResultsTable
        rows={pagedRows}
        favoriteSymbols={favoriteSymbols}
        onFavorite={onFavorite}
        onReview={onReview}
        onOpenStock={onOpenStock}
        selectedSymbol={selectedSymbol}
        onSelectRow={onSelectRow}
        perfPeriod={perfPeriod}
        onPerfPeriod={onPerfPeriod}
        sort={sort}
        sortAsc={sortAsc}
        onSortColumn={onSortColumn}
        setupMode={setupMode}
        emptyLabel={emptyLabel}
      />
    </>
  );
}
