// Modo de chrome del screener (P3 + P12): Diario (caza diaria) vs Expert.
// Diario = mercados chip + familias detrás de «Ajustar ficha»; Expert = layout denso actual.
// Preferencia en localStorage (sesión acotada), mismo patrón que resultViewMode / huntTapeDensity.

import { safeRead, safeWrite } from "@/lib/localState";

export const SCREENER_CHROME_MODE_KEY = "statsedge.screenerChromeMode.v1";
export const SCREENER_CHROME_MODE_CHANGED_EVENT = "statsedge:screenerChromeMode";

export const SCREENER_CHROME_MODES = {
  DIARIO: "diario",
  EXPERT: "expert",
};

/** Default producto = caza diaria (menos chrome). */
export const DEFAULT_SCREENER_CHROME_MODE = SCREENER_CHROME_MODES.DIARIO;

export const MARKET_PRESET_CHIP_OPTIONS = [
  ["global", "Global"],
  ["us", "EE. UU."],
  ["us-core-intl", "US+Core intl"],
  ["core-intl", "Core intl"],
  ["europe", "Europa"],
  ["asia", "Asia"],
  ["hk", "HK"],
];

export function isScreenerChromeMode(value) {
  return value === SCREENER_CHROME_MODES.DIARIO || value === SCREENER_CHROME_MODES.EXPERT;
}

export function resolveScreenerChromeMode(value = DEFAULT_SCREENER_CHROME_MODE) {
  return isScreenerChromeMode(value) ? value : DEFAULT_SCREENER_CHROME_MODE;
}

export function isDiarioChromeMode(mode) {
  return resolveScreenerChromeMode(mode) === SCREENER_CHROME_MODES.DIARIO;
}

export function isExpertChromeMode(mode) {
  return resolveScreenerChromeMode(mode) === SCREENER_CHROME_MODES.EXPERT;
}

export function readPersistedScreenerChromeMode() {
  const stored = safeRead(SCREENER_CHROME_MODE_KEY, null);
  return isScreenerChromeMode(stored) ? stored : null;
}

export function persistScreenerChromeMode(mode) {
  const next = resolveScreenerChromeMode(mode);
  safeWrite(SCREENER_CHROME_MODE_KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCREENER_CHROME_MODE_CHANGED_EVENT, { detail: next }));
  }
  return next;
}

export function resolvePersistedScreenerChromeMode(
  persisted = readPersistedScreenerChromeMode(),
) {
  return persisted || DEFAULT_SCREENER_CHROME_MODE;
}

/**
 * Etiqueta del chip de mercados (Diario): preset activo o «Personalizado».
 * @param {(key: string) => boolean} isMarketPresetActive
 */
export function resolveActiveMarketPresetLabel(isMarketPresetActive) {
  if (typeof isMarketPresetActive !== "function") return "Personalizado";
  for (const [key, label] of MARKET_PRESET_CHIP_OPTIONS) {
    if (isMarketPresetActive(key)) return label;
  }
  return "Personalizado";
}
