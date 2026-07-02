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
  settings,
  favoriteSymbols,
  onFavorite,
  onReview,
  onOpenStock,
  decisionResolutions,
  emptyLabel,
}) {
  return (
    <>
      {visibleCount ? (
        <div className="controls resultPager" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <span className="fine">
            Mostrando {visibleCount ? resultPageStart + 1 : 0}-{resultPageEnd} de {visibleCount}
          </span>
          <div className="controls">
            <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={resultPageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} aria-label="Acciones por página">
              {RESULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} por página</option>)}
            </select>
            <button className="btn btnSmall btnGhost" onClick={() => onSetResultPage(visibleResultPage - 1)} disabled={visibleResultPage <= 1}>Anterior</button>
            <span className="fine">Página {visibleResultPage}/{totalResultPages}</span>
            <button className="btn btnSmall btnGhost" onClick={() => onSetResultPage(visibleResultPage + 1)} disabled={visibleResultPage >= totalResultPages}>Siguiente</button>
          </div>
        </div>
      ) : null}
      <CompactResultsTable
        rows={pagedRows}
        settings={settings}
        favoriteSymbols={favoriteSymbols}
        onFavorite={onFavorite}
        onReview={onReview}
        onOpenStock={onOpenStock}
        rankOffset={resultPageStart}
        emptyLabel={emptyLabel}
        decisionResolutions={decisionResolutions}
      />
    </>
  );
}
