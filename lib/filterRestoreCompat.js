// lib/filterRestoreCompat.js — cadena compartida de restore para sesión y plantillas.
//
// UX-FILTERS-7: sesiones/plantillas pre-rediseño no traen familyIntensity; la
// inferencia de modo es cosmética y nunca muta settings ni activeSettings.

import {
  DEFAULT_FIELD_RULES,
  SCREENER_FILTER_PRESETS as PRESETS,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";
import { restoreFamilyIntensity } from "@/lib/filterFamilyIntensity";
import { effectiveSettingsFromLayers, restoreFilterLayers } from "@/lib/screenerFilterLayers";

export function resolveStoredFilterConfig(config = {}) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const presetKey = PRESETS[safeConfig.presetKey] ? safeConfig.presetKey : "balanced";
  const settings = settingsForPreset(presetKey, safeConfig.settings || {});
  const filterLayers = restoreFilterLayers(
    safeConfig.filterLayers,
    safeConfig.filterLayersVersion,
    presetKey,
  );
  const fieldRules = { ...DEFAULT_FIELD_RULES, ...(safeConfig.fieldRules || {}) };
  const effectiveSettings = effectiveSettingsFromLayers(settings, filterLayers, fieldRules);
  const { intensity: familyIntensity, custom: familyIntensityCustom } = restoreFamilyIntensity(
    settings,
    fieldRules,
    safeConfig.familyIntensity || {},
  );
  return {
    presetKey,
    settings,
    filterLayers,
    fieldRules,
    effectiveSettings,
    familyIntensity,
    familyIntensityCustom,
  };
}
