import { DEFAULT_MARKETS, DEFAULT_VIEW_LAYERS, SCREENER_SESSION_VERSION } from "@/lib/screenerConfig";
import {
  DEFAULT_FIELD_RULES,
  filterLayersForPreset,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";

// Criterios que P4 conserva al traer datos frescos (refresh) y que el reset
// nuclear vuelve a los valores por defecto.
export const SCREENER_CRITERIA_KEYS = [
  "markets",
  "manual",
  "presetKey",
  "settings",
  "filterLayers",
  "fieldRules",
  "viewLayers",
  "sort",
  "scanMode",
  "useRegimeFilter",
  "selectedFilterTemplateId",
];

export function pickScreenerCriteria(state = {}) {
  const picked = {};
  for (const key of SCREENER_CRITERIA_KEYS) {
    if (state[key] !== undefined) picked[key] = state[key];
  }
  return picked;
}

/**
 * Sesión v4 ya aplicó criterios en el boot. Si faltan filas y hay que traer
 * el nocturno, restoreSnapshot no debe pisar preset/capas/settings con los
 * del scan (síntoma ficha→back → defaults).
 */
export function shouldPreserveSessionCriteriaOnSnapshotRestore(
  session,
  sessionVersion = SCREENER_SESSION_VERSION,
) {
  return Boolean(session && Number(session.version) === Number(sessionVersion));
}

export function screenerCriteriaAfterReset() {
  const settings = settingsForPreset("balanced");
  const filterLayers = filterLayersForPreset("balanced");
  return {
    markets: DEFAULT_MARKETS,
    manual: "",
    presetKey: "balanced",
    settings,
    filterLayers,
    fieldRules: DEFAULT_FIELD_RULES,
    viewLayers: DEFAULT_VIEW_LAYERS,
    scanMode: "all",
    useRegimeFilter: true,
    selectedFilterTemplateId: "",
  };
}

export function dataRefreshEligibleOwner(owner) {
  return owner === "session" || owner === "cloud" || owner === "local";
}

export function criteriaPreservedAcrossDataRefresh(before = {}, after = {}) {
  return JSON.stringify(pickScreenerCriteria(before)) === JSON.stringify(pickScreenerCriteria(after));
}

export {
  SESSION_AUTOSAVE_DEBOUNCE_MS,
  createDebouncedSessionSaver,
} from "@/lib/screenerFilterFastPath";
