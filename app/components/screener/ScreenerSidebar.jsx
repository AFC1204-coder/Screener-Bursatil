"use client";

import { FilterArchitecturePanel } from "@/app/screenerPanels";
import { isMarketSelectable, marketUnavailabilityReason } from "@/lib/marketAvailability";
import { MARKET_ORDER, MARKETS, marketExchange } from "@/lib/screenerConfig";
import { marketFlag } from "@/lib/symbols";

const MARKET_REGION_PRESETS = ["global", "us", "us-core-intl", "core-intl", "europe", "asia", "hk"];

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
}) {
  const selectableMarketCount = MARKETS.filter(([code]) => isMarketSelectable(code)).length;
  const hasActiveMarketPreset = MARKET_REGION_PRESETS.some((key) => isMarketPresetActive(key));
  const marketCustomizeLabel = `Personalizar mercados (${markets.length}/${selectableMarketCount})${hasActiveMarketPreset ? "" : " · personalizado"}`;

  return (
    <aside ref={mobileFiltersRef} className={`sidebar ${showMobileFilters ? "mobileOpen" : ""}`}>
      <div className="mobileSidebarHeader">
        <h2>Filtros</h2>
        <div className="mobileSidebarHeaderActions">
          <button type="button" className="btn btnPrimary" onClick={onCloseMobileFilters}>Listo</button>
          <button type="button" className="mobileSidebarCloseBtn" onClick={onCloseMobileFilters} aria-label="Cerrar filtros" title="Cerrar filtros">✕</button>
        </div>
      </div>

      <div className="sidebarGroup marketPanel" style={{ marginBottom: 24 }}>
        <div className="marketPanelHead">
          <span>Mercados{marketsStale ? <i className="controlDot controlDotStale" aria-hidden="true" title="Mercados cambiados desde el último corte de datos" /> : null}</span>
          <em>{markets.length}/{MARKETS.length}</em>
        </div>
        <div className="marketPresetBar">
          {[
            ["global", "Global"],
            ["us", "EE. UU."],
            ["us-core-intl", "US+Core"],
            ["core-intl", "Core intl"],
            ["europe", "Europa"],
            ["asia", "Asia"],
            ["hk", "HK"],
          ].map(([key, label]) => <button key={key} className={`btn btnGhost btnSmall ${isMarketPresetActive(key) ? "btnActive" : ""}`} onClick={() => marketPreset(key)}>{label}</button>)}
        </div>
        <details className="marketCustomizeDisclosure">
          <summary><span>{marketCustomizeLabel}</span></summary>
          <div className="marketSelector marketGrid">
            {MARKETS.map(([c, n]) => {
              const active = markets.includes(c);
              const selectable = isMarketSelectable(c);
              const disabledReason = selectable ? null : marketUnavailabilityReason(c);
              return <button
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
              </button>;
            })}
          </div>
        </details>
      </div>

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
    </aside>
  );
}
