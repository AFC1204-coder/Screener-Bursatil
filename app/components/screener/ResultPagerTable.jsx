"use client";

// ResultPagerTable — slice presentacional de ScreenerShell.
// Contiene la barra de 40 px sobre la tabla (rediseño 2026-11, paso 5:
// Caza/Auditoría · fichas del filtro vivo y «+ Filtro» vía `filterSlot` ·
// aviso de datos vía `noticeSlot` (paso 6) · «N en cola» y densidad), el pager, la CompactResultsTable (Auditoría) o la
// cinta HuntTapeView (Caza).

import { useEffect, useState } from "react";
import { CompactResultsTable } from "@/app/screenerPanels";
import HuntTapeView from "@/app/components/screener/HuntTapeView";
import { HuntTapeEmpty } from "@/lib/screenerHuntTapeEmpty";
import { RESULT_PAGE_SIZES } from "@/lib/screenerConfig";
import { HuntTapeDensityToggle, HuntTapeModeToggle } from "@/lib/screenerHuntTape";
import {
  persistHuntTapeDensity,
  readPersistedHuntTapeDensity,
  resolveHuntTapeDensity,
  resolvePersistedHuntTapeDensity,
} from "@/lib/screenerHuntTapeDensity";
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
  chartPreviewDeferred = false,
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
  decisionResolutions = null,
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
  hasBatchPercentiles = false,
  emptyLabel,
  filterSlot = null,
  // Paso 6: aviso de datos de una línea en la misma banda (escritorio).
  noticeSlot = null,
  // Paso 7: panel lateral (motivo de inclusión + clasificar desde el panel).
  peekInclusion = "",
  onResolveDecision = null,
  // Paso 8: salida única del vacío, común a Caza y Auditoría.
  emptyAction = null,
}) {
  const [viewMode, setViewMode] = useState(() => resolveResultViewMode(presetKey));
  const [tapeDensity, setTapeDensity] = useState(() => resolvePersistedHuntTapeDensity());

  useEffect(() => {
    const persisted = readPersistedResultViewMode();
    setViewMode(resolveResultViewMode(presetKey, persisted));
  }, [presetKey]);

  useEffect(() => {
    setTapeDensity(resolvePersistedHuntTapeDensity(readPersistedHuntTapeDensity()));
  }, []);

  function handleViewModeChange(nextMode) {
    const mode = nextMode === RESULT_VIEW_MODES.CAZA ? RESULT_VIEW_MODES.CAZA : RESULT_VIEW_MODES.AUDIT;
    setViewMode(mode);
    persistResultViewMode(mode);
  }

  function handleDensityChange(nextDensity) {
    const density = resolveHuntTapeDensity(nextDensity);
    setTapeDensity(density);
    persistHuntTapeDensity(density);
  }

  const cazaMode = isCazaResultView(viewMode);
  const multiPage = totalResultPages > 1;

  return (
    <>
      <div className="resultViewChrome" role="toolbar" aria-label="Barra de la mesa">
        <HuntTapeModeToggle mode={viewMode} onChange={handleViewModeChange} />
        {filterSlot}
        {noticeSlot}
        <span className="resultViewChromeMeta fine">
          {visibleCount ? `${visibleCount} en cola` : "0 en cola"}
        </span>
        {cazaMode ? (
          <HuntTapeDensityToggle density={tapeDensity} onChange={handleDensityChange} />
        ) : null}
      </div>

      {cazaMode ? (
        <HuntTapeView
          rows={filteredRows}
          emptyLabel={emptyLabel}
          onOpenStock={onOpenStock}
          activeModalRow={activeModalRow}
          chartPreviewDeferred={chartPreviewDeferred}
          density={tapeDensity}
          favoriteSymbols={favoriteSymbols}
          decisionResolutions={decisionResolutions}
          peekInclusion={peekInclusion}
          onFavorite={onFavorite}
          onResolveDecision={onResolveDecision}
          emptyAction={emptyAction}
        />
      ) : !visibleCount ? (
        <HuntTapeEmpty label={emptyLabel} action={emptyAction} />
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
