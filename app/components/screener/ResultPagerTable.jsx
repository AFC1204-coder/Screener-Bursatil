"use client";

// ResultPagerTable — slice presentacional de ScreenerShell.
// Contiene el pager (range/page-size/prev/next), la CompactResultsTable
// (Auditoría) o la cinta HuntTapeView (Caza).

import { useEffect, useState } from "react";
import { CompactResultsTable } from "@/app/screenerPanels";
import HuntTapeView from "@/app/components/screener/HuntTapeView";
import { RESULT_PAGE_SIZES } from "@/lib/screenerConfig";
import { HuntTapeModeToggle } from "@/lib/screenerHuntTape";
import {
  RESULT_VIEW_MODES,
  isCazaResultView,
  persistResultViewMode,
  readPersistedResultViewMode,
  resolveResultViewMode,
} from "@/lib/screenerResultViewMode";

export default function ResultPagerTable({
  visibleCount,
  presetKey = "",
  filteredRows = [],
  activeModalRow = null,
  // Pager
  resultPageStart,
  resultPageEnd,
  resultPageSize,
  onPageSizeChange,
  visibleResultPage,
  totalResultPages,
  onSetResultPage,
  // Table / tape
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
  scannedMarkets = [],
  presetKey = "",
  hasBatchPercentiles = false,
  emptyLabel,
}) {
  const [viewMode, setViewMode] = useState(() => resolveResultViewMode(presetKey));

  useEffect(() => {
    const persisted = readPersistedResultViewMode();
    setViewMode(resolveResultViewMode(presetKey, persisted));
  }, [presetKey]);

  function handleViewModeChange(nextMode) {
    const mode = nextMode === RESULT_VIEW_MODES.CAZA ? RESULT_VIEW_MODES.CAZA : RESULT_VIEW_MODES.AUDIT;
    setViewMode(mode);
    persistResultViewMode(mode);
  }

  const cazaMode = isCazaResultView(viewMode);
  const multiPage = totalResultPages > 1;

  return (
    <>
      <div className="resultViewChrome">
        <HuntTapeModeToggle mode={viewMode} onChange={handleViewModeChange} />
        {cazaMode ? (
          <span className="resultViewChromeMeta fine">
            {visibleCount ? `${visibleCount} en cola` : "0 en cola"}
          </span>
        ) : null}
      </div>

      {cazaMode ? (
        <HuntTapeView
          rows={filteredRows}
          emptyLabel={emptyLabel}
          onOpenStock={onOpenStock}
          activeModalRow={activeModalRow}
        />
      ) : (
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
            scannedMarkets={scannedMarkets}
            presetKey={presetKey}
            hasBatchPercentiles={hasBatchPercentiles}
            emptyLabel={emptyLabel}
          />
        </>
      )}
    </>
  );
}
