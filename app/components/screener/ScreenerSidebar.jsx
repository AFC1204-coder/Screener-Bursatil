"use client";

import { useEffect, useRef } from "react";
import { FilterArchitecturePanel } from "@/app/screenerPanels";
import { isMarketSelectable, marketUnavailabilityReason } from "@/lib/marketAvailability";
import { MARKET_ORDER, MARKETS, marketExchange } from "@/lib/screenerConfig";
import { marketFlag } from "@/lib/symbols";
import {
  MARKET_PRESET_CHIP_OPTIONS,
  isDiarioChromeMode,
  resolveActiveMarketPresetLabel,
} from "@/lib/screenerChromeMode";

const MARKET_REGION_PRESETS = MARKET_PRESET_CHIP_OPTIONS.map(([key]) => key);

function MarketCustomizeDetails({
  markets,
  hasActiveMarketPreset,
  setMarketsAndInvalidate,
}) {
  const selectableMarketCount = MARKETS.filter(([code]) => isMarketSelectable(code)).length;
  const marketCustomizeLabel = `Personalizar mercados (${markets.length}/${selectableMarketCount})${hasActiveMarketPreset ? "" : " · personalizado"}`;

  return (
    <details className="marketCustomizeDisclosure">
      <summary><span>{marketCustomizeLabel}</span></summary>
      <div className="marketSelector marketGrid">
        {MARKETS.map(([c, n]) => {
          const active = markets.includes(c);
          const selectable = isMarketSelectable(c);
          const disabledReason = selectable ? null : marketUnavailabilityReason(c);
          return (
            <button
              key={c}
              type="button"
              className={`marketChip countryMarketChip ${active ? "active" : ""} ${selectable ? "" : "isDisabled"}`}
              title={disabledReason || `${n} · ${marketExchange(c)}`}
              aria-pressed={active}
              aria-disabled={selectable ? undefined : true}
              disabled={!selectable}
              onClick={() => {
                if (!selectable) return;
                const selectedMarkets = active ? markets.filter((x) => x !== c) : [...markets, c];
                const nextMarkets = MARKET_ORDER.filter((code) => selectedMarkets.includes(code));
                setMarketsAndInvalidate(nextMarkets, `Mercados actualizados: ${nextMarkets.length}`);
              }}
            >
              <span className="marketChipFlag">{marketFlag(c)}</span>
              <span className="marketChipCode">{c}</span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

function MarketPresetBar({ isMarketPresetActive, marketPreset }) {
  return (
    <div className="marketPresetBar">
      {MARKET_PRESET_CHIP_OPTIONS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`btn btnGhost btnSmall ${isMarketPresetActive(key) ? "btnActive" : ""}`}
          onClick={() => marketPreset(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function ScreenerSidebar({
  mobileFiltersRef,
  showMobileFilters,
  onCloseMobileFilters,
  markets,
  marketsStale,
  isMarketPresetActive,
  marketPreset,
  setMarketsAndInvalidate,
  filterLayers,
  useRegimeFilter,
  toggleFilterLayer,
  setActiveFilterFamily,
  setUseRegimeFilter,
  sheetFamilyKeys,
  cardLabel,
  settings,
  fieldRules,
  familyIntensity,
  familyIntensityCustom,
  familyCoverage,
  familyImpact,
  previewFamilyIntensity,
  commitFamilyIntensity,
  chromeMode = "diario",
  fichaAdjustOpen = false,
  onFichaAdjustOpenChange,
  chromeModeToggle = null,
}) {
  const diario = isDiarioChromeMode(chromeMode);
  const fichaDisclosureRef = useRef(null);
  const hasActiveMarketPreset = MARKET_REGION_PRESETS.some((key) => isMarketPresetActive(key));
  const marketChipLabel = resolveActiveMarketPresetLabel(isMarketPresetActive);

  useEffect(() => {
    if (!diario || !fichaAdjustOpen || !fichaDisclosureRef.current) return;
    if (!fichaDisclosureRef.current.open) fichaDisclosureRef.current.open = true;
  }, [diario, fichaAdjustOpen]);

  const filterArchitecture = (
    <FilterArchitecturePanel
      filterLayers={filterLayers}
      useRegimeFilter={useRegimeFilter}
      onToggleLayer={toggleFilterLayer}
      onOpenLayer={setActiveFilterFamily}
      onToggleRegime={() => setUseRegimeFilter((prev) => !prev)}
      sheetFamilyKeys={sheetFamilyKeys}
      cardLabel={cardLabel}
      settings={settings}
      fieldRules={fieldRules}
      familyIntensity={familyIntensity}
      familyIntensityCustom={familyIntensityCustom}
      familyCoverage={familyCoverage}
      familyImpact={familyImpact}
      onFamilyIntensityChange={previewFamilyIntensity}
      onFamilyIntensityCommit={commitFamilyIntensity}
    />
  );

  return (
    <aside
      ref={mobileFiltersRef}
      className={`sidebar ${showMobileFilters ? "mobileOpen" : ""} ${diario ? "sidebar--diario" : "sidebar--expert"}`}
    >
      <div className="mobileSidebarHeader">
        <h2>Filtros</h2>
        <div className="mobileSidebarHeaderActions">
          <button type="button" className="btn btnPrimary" onClick={onCloseMobileFilters}>Listo</button>
          <button type="button" className="mobileSidebarCloseBtn" onClick={onCloseMobileFilters} aria-label="Cerrar filtros" title="Cerrar filtros">✕</button>
        </div>
      </div>

      {chromeModeToggle ? (
        <div className="sidebarChromeModeSlot">
          {chromeModeToggle}
        </div>
      ) : null}

      {diario ? (
        <>
          <div className="sidebarGroup marketPanel marketPanel--diario" style={{ marginBottom: 16 }}>
            <details className="marketCompactDisclosure">
              <summary className="marketCompactChip" aria-label={`Mercados: ${marketChipLabel}`}>
                <span className="marketCompactChipLabel">
                  {marketChipLabel}
                  {marketsStale ? <i className="controlDot controlDotStale" aria-hidden="true" title="Mercados cambiados desde el último corte de datos" /> : null}
                  {!hasActiveMarketPreset ? <i className="controlDot controlDotCustom" aria-hidden="true" title="Selección personalizada distinta de la mesa" /> : null}
                </span>
                <em>{markets.length}/{MARKETS.length}</em>
              </summary>
              <div className="marketCompactDisclosureBody">
                <MarketPresetBar isMarketPresetActive={isMarketPresetActive} marketPreset={marketPreset} />
                <MarketCustomizeDetails
                  markets={markets}
                  hasActiveMarketPreset={hasActiveMarketPreset}
                  setMarketsAndInvalidate={setMarketsAndInvalidate}
                />
              </div>
            </details>
          </div>

          <details
            ref={fichaDisclosureRef}
            className="ajustarFichaDisclosure"
            onToggle={(event) => {
              onFichaAdjustOpenChange?.(event.currentTarget.open);
            }}
          >
            <summary>
              <span>Ajustar ficha</span>
              <em>{cardLabel || "familias"}</em>
            </summary>
            <div className="ajustarFichaDisclosureBody">
              {filterArchitecture}
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="sidebarGroup marketPanel" style={{ marginBottom: 24 }}>
            <div className="marketPanelHead">
              <span>
                Mercados
                {marketsStale ? <i className="controlDot controlDotStale" aria-hidden="true" title="Mercados cambiados desde el último corte de datos" /> : null}
                {!hasActiveMarketPreset ? <i className="controlDot controlDotCustom" aria-hidden="true" title="Selección personalizada distinta de la mesa" /> : null}
              </span>
              <em>{markets.length}/{MARKETS.length}</em>
            </div>
            <MarketPresetBar isMarketPresetActive={isMarketPresetActive} marketPreset={marketPreset} />
            <MarketCustomizeDetails
              markets={markets}
              hasActiveMarketPreset={hasActiveMarketPreset}
              setMarketsAndInvalidate={setMarketsAndInvalidate}
            />
          </div>
          {filterArchitecture}
        </>
      )}
    </aside>
  );
}
