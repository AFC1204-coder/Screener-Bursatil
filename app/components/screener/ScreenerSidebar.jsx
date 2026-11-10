"use client";

// Selector de mercados del screener: chip de ámbito (ticket de escritorio) y
// sus piezas (presets y rejilla), que la hoja de filtros móvil monta tal cual.
// El cajón lateral móvil que vivía aquí se retiró con el estudio móvil
// 2026-11 (paso 9): su contenido está en MobileFilterSheet.

import { isMarketSelectable, marketUnavailabilityReason } from "@/lib/marketAvailability";
import { MARKET_ORDER, MARKETS, marketExchange } from "@/lib/screenerConfig";
import { marketFlag } from "@/lib/symbols";
import {
  MARKET_PRESET_CHIP_OPTIONS,
  resolveActiveMarketPresetLabel,
} from "@/lib/screenerChromeMode";

const MARKET_REGION_PRESETS = MARKET_PRESET_CHIP_OPTIONS.map(([key]) => key);

export function MarketCustomizeDetails({
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

export function MarketPresetBar({ isMarketPresetActive, marketPreset }) {
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

/**
 * Chip de ámbito «EE. UU. 1/27» que despliega los presets y la rejilla de
 * mercados. Rediseño 2026-11 (paso 4): el mismo selector vive en el ticket del
 * screener (escritorio) y en el cajón de filtros (móvil); no hay un segundo
 * selector.
 */
export function MarketScopeChip({
  markets,
  marketsStale = false,
  isMarketPresetActive,
  marketPreset,
  setMarketsAndInvalidate,
  className = "",
}) {
  const hasActiveMarketPreset = MARKET_REGION_PRESETS.some((key) => isMarketPresetActive(key));
  const marketChipLabel = resolveActiveMarketPresetLabel(isMarketPresetActive);
  return (
    <details className={`marketCompactDisclosure${className ? ` ${className}` : ""}`}>
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
  );
}
