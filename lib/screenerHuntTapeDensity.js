// Densidad de la cinta Caza (P4): Compacto por defecto (≥8 filas en ~1080p),
// Cómodo opcional para quien prefiera más aire.

import { safeRead, safeWrite } from "@/lib/localState";

export const SCREENER_HUNT_TAPE_DENSITY_KEY = "statsedge.screenerHuntTapeDensity.v1";
export const SCREENER_HUNT_TAPE_DENSITY_CHANGED_EVENT = "statsedge:screenerHuntTapeDensity";

export const HUNT_TAPE_DENSITIES = {
  COMPACT: "compact",
  COMFORT: "comfort",
};

/** Alturas alineadas con `.huntTapeRow` en styles/screener.css (P4). */
export const HUNT_TAPE_ROW_HEIGHT_BY_DENSITY = {
  [HUNT_TAPE_DENSITIES.COMPACT]: 36,
  [HUNT_TAPE_DENSITIES.COMFORT]: 52,
};

/** Default = compacto: meta ≥8 tickers en viewport desktop ~1080p. */
export const DEFAULT_HUNT_TAPE_DENSITY = HUNT_TAPE_DENSITIES.COMPACT;

export function isHuntTapeDensity(value) {
  return value === HUNT_TAPE_DENSITIES.COMPACT || value === HUNT_TAPE_DENSITIES.COMFORT;
}

export function resolveHuntTapeDensity(value = DEFAULT_HUNT_TAPE_DENSITY) {
  return isHuntTapeDensity(value) ? value : DEFAULT_HUNT_TAPE_DENSITY;
}

export function huntTapeRowHeightPx(density = DEFAULT_HUNT_TAPE_DENSITY) {
  const key = resolveHuntTapeDensity(density);
  return HUNT_TAPE_ROW_HEIGHT_BY_DENSITY[key];
}

/**
 * Filas estimadas visibles en la lista (sin hint/cabecera).
 * Útil para tests de meta P4 y para scroll→índice de hydrate.
 */
export function estimateVisibleHuntTapeRows(listHeightPx = 0, density = DEFAULT_HUNT_TAPE_DENSITY) {
  const height = Math.max(0, Number(listHeightPx) || 0);
  const row = huntTapeRowHeightPx(density);
  return Math.floor(height / row);
}

/** Altura de lista típica en desktop 1080p tras chrome (sidebar + filtros + hint). */
export const HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX = 320;

export function readPersistedHuntTapeDensity() {
  const stored = safeRead(SCREENER_HUNT_TAPE_DENSITY_KEY, null);
  return isHuntTapeDensity(stored) ? stored : null;
}

export function persistHuntTapeDensity(density) {
  const next = resolveHuntTapeDensity(density);
  safeWrite(SCREENER_HUNT_TAPE_DENSITY_KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCREENER_HUNT_TAPE_DENSITY_CHANGED_EVENT, { detail: next }));
  }
  return next;
}

export function resolvePersistedHuntTapeDensity(
  persisted = readPersistedHuntTapeDensity(),
) {
  return persisted || DEFAULT_HUNT_TAPE_DENSITY;
}
