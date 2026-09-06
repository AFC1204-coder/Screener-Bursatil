// Modo de mesa de resultados: Caza (cinta) vs Auditoría (tabla Excel).
// TAPE-1: default Caza en fichas del rail; Auditoría fuera de ellas.
// La elección del usuario persiste en localStorage (sesión acotada).

import { safeRead, safeWrite } from "@/lib/localState";
import { isHuntCardPreset } from "@/lib/screenerHuntCards";

export const SCREENER_RESULT_VIEW_MODE_KEY = "statsedge.screenerResultViewMode.v1";

export const RESULT_VIEW_MODES = {
  CAZA: "caza",
  AUDIT: "audit",
};

export function defaultResultViewMode(presetKey = "") {
  return isHuntCardPreset(presetKey) ? RESULT_VIEW_MODES.CAZA : RESULT_VIEW_MODES.AUDIT;
}

export function readPersistedResultViewMode() {
  const stored = safeRead(SCREENER_RESULT_VIEW_MODE_KEY, null);
  if (stored === RESULT_VIEW_MODES.CAZA || stored === RESULT_VIEW_MODES.AUDIT) return stored;
  return null;
}

export function persistResultViewMode(mode) {
  if (mode === RESULT_VIEW_MODES.CAZA || mode === RESULT_VIEW_MODES.AUDIT) {
    safeWrite(SCREENER_RESULT_VIEW_MODE_KEY, mode);
  }
}

export function resolveResultViewMode(presetKey = "", persisted = readPersistedResultViewMode()) {
  return persisted || defaultResultViewMode(presetKey);
}

export function isCazaResultView(mode) {
  return mode === RESULT_VIEW_MODES.CAZA;
}
