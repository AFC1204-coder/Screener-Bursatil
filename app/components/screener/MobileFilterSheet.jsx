"use client";

// Filtros del screener móvil en hoja inferior (estudio móvil 2026-11, §2.3,
// paso 9). Un solo sitio para todo lo que filtra, igual que el popover
// «+ Filtro» de escritorio: mercados, lo que aplica la vista y sus familias
// con el recorte de cada una, el embudo, tu clasificación (Resolución), las
// capas de vista y el periodo de rendimiento. Abajo, fijo, «Ver N valores».
// No define filtros propios: monta los mismos componentes que escritorio.

import MobileSheet from "@/app/components/screener/MobileSheet";
import { MarketCustomizeDetails, MarketPresetBar } from "@/app/components/screener/ScreenerSidebar";
import ResultViewSelects from "@/app/components/screener/ResultViewSelects";
import { PerformancePeriodPicker } from "@/lib/screenerColumns";
import { num } from "@/lib/formatters";

export default function MobileFilterSheet({
  open = false,
  onClose,
  title = "",
  // Mercados
  markets = [],
  isMarketPresetActive,
  marketPreset,
  setMarketsAndInvalidate,
  hasActiveMarketPreset = true,
  // Lo que filtra la vista
  modeStrip = null,
  families = null,
  breakdown = null,
  analyzedCount = 0,
  passCount = 0,
  visibleCount = 0,
  // Tu clasificación + capas de vista (mismos props que ResultViewSelects)
  viewSelects = {},
  decisionResolutionFilter = "all",
  decisionResolutionOptions = [],
  onDecisionResolutionFilter,
  // Orden
  perfPeriod,
  onPerfPeriod,
  onReset,
  resetDisabled = true,
}) {
  const footer = (
    <>
      <button type="button" className="btn mobileSheetBtn" onClick={onReset} disabled={resetDisabled}>Restablecer</button>
      <button type="button" className="btn btnPrimary mobileSheetBtn mobileSheetBtnGrow" onClick={onClose}>
        Ver {num(visibleCount, 0)} {visibleCount === 1 ? "valor" : "valores"}
      </button>
    </>
  );
  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      label="Filtros"
      className="mobileFilterSheet"
      head={<h2>Filtros{title ? ` · ${title}` : ""}</h2>}
      footer={footer}
    >
      <p className="mobileSheetLabel mobileSheetLabel--first">Mercados</p>
      <MarketPresetBar isMarketPresetActive={isMarketPresetActive} marketPreset={marketPreset} />
      <MarketCustomizeDetails
        markets={markets}
        hasActiveMarketPreset={hasActiveMarketPreset}
        setMarketsAndInvalidate={setMarketsAndInvalidate}
      />

      <p className="mobileSheetLabel">Lo que filtra la vista</p>
      {modeStrip}
      {families}
      <p className="mobileFilterFunnel">
        {num(analyzedCount, 0)} analizadas → {num(passCount, 0)} pasan
        {visibleCount !== passCount ? ` · ${num(visibleCount, 0)} en lista` : ""}
      </p>
      {breakdown}

      <p className="mobileSheetLabel">Tu clasificación</p>
      <div className="mobileSeg" role="group" aria-label="Filtrar por tu clasificación">
        {decisionResolutionOptions.map((item) => (
          <button
            type="button"
            key={item.key}
            aria-pressed={decisionResolutionFilter === item.key}
            className={decisionResolutionFilter === item.key ? "isOn" : ""}
            onClick={() => onDecisionResolutionFilter?.(item.key)}
          >
            {String(item.displayLabel || item.label || item.key).replace(/^Resolución:\s*/, "")}
          </button>
        ))}
      </div>

      <div className="mobileFilterViewSelects">
        <ResultViewSelects {...viewSelects} showResolution={false} />
      </div>

      <p className="mobileSheetLabel">Rendimiento</p>
      <PerformancePeriodPicker value={perfPeriod} onChange={onPerfPeriod} className="mobilePeriodPicker" />
    </MobileSheet>
  );
}
