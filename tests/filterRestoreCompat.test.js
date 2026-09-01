// UX-FILTERS-7: compat al restaurar sesión/plantillas pre-rediseño (sin familyIntensity).
//
// Invariantes §4 spec:
// - Ninguna sesión v4 válida queda peor (mismos activeSettings efectivos).
// - La inferencia de modo es cosmética: no muta settings ni resultados.

import { describe, expect, it } from "vitest";

import { settingsAtFamilyIntensity } from "@/lib/filterFamilyIntensity";
import { resolveStoredFilterConfig } from "@/lib/filterRestoreCompat";
import {
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  FILTER_LAYERS_CONTRACT_VERSION,
  SCREENER_FILTER_PRESETS,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";
import { effectiveSettingsFromLayers, restoreFilterLayers } from "@/lib/screenerFilterLayers";
import { SCREENER_SESSION_VERSION } from "@/lib/screenerConfig";
import { templateSnapshotAssessment } from "@/lib/templateApplication";

function baselineEffectiveSettings(config) {
  const presetKey = SCREENER_FILTER_PRESETS[config.presetKey] ? config.presetKey : "balanced";
  const settings = settingsForPreset(presetKey, config.settings || {});
  const filterLayers = restoreFilterLayers(
    config.filterLayers,
    config.filterLayersVersion,
    presetKey,
  );
  const fieldRules = { ...DEFAULT_FIELD_RULES, ...(config.fieldRules || {}) };
  return effectiveSettingsFromLayers(settings, filterLayers, fieldRules);
}

// Sesión v4 típica guardada antes de UX-FILTERS-3 (sin familyIntensity).
const preRedesignSessionStrict = {
  version: SCREENER_SESSION_VERSION,
  presetKey: "strict",
  markets: ["US"],
  settings: settingsForPreset("strict"),
  filterLayers: { ...DEFAULT_FILTER_LAYERS },
  filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
  fieldRules: { ...DEFAULT_FIELD_RULES },
  useRegimeFilter: true,
};

const preRedesignSessionIpoDiscovery = {
  version: SCREENER_SESSION_VERSION,
  presetKey: "ipoDiscovery",
  markets: ["US"],
  settings: settingsForPreset("ipoDiscovery"),
  filterLayers: { ...DEFAULT_FILTER_LAYERS, ipo: true },
  filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
  fieldRules: { ...DEFAULT_FIELD_RULES },
};

const preRedesignSessionCustomRs = {
  version: SCREENER_SESSION_VERSION,
  presetKey: "balanced",
  markets: ["US", "ES"],
  settings: {
    ...settingsForPreset("balanced"),
    minRsRating: 72,
    minRsBenchmarkRating: 58,
  },
  filterLayers: { ...DEFAULT_FILTER_LAYERS },
  filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
  fieldRules: {
    ...DEFAULT_FIELD_RULES,
    minRsRating: true,
    minRsBenchmarkRating: true,
  },
};

const preRedesignTemplateTopRs = {
  version: 1,
  presetKey: "strict",
  markets: ["US"],
  settings: settingsForPreset("strict"),
  filterLayers: { ...DEFAULT_FILTER_LAYERS },
  filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
  fieldRules: { ...DEFAULT_FIELD_RULES },
  sort: "rsGlobalPct",
  perfPeriod: "perf6m",
  useRegimeFilter: false,
};

const preRedesignTemplateLayersV1 = {
  version: 1,
  presetKey: "balanced",
  markets: ["US"],
  settings: settingsForPreset("balanced"),
  // Capas v1: las cuatro apagadas de fábrica — deben descartarse, no migrarse.
  filterLayers: { pattern: false, volumeSurge: false, shortInterest: false, riskReward: false, trend: true },
  filterLayersVersion: 1,
  fieldRules: { ...DEFAULT_FIELD_RULES },
};

describe("resolveStoredFilterConfig · sesión pre-rediseño", () => {
  it("strict sin familyIntensity conserva los mismos activeSettings efectivos", () => {
    const expected = baselineEffectiveSettings(preRedesignSessionStrict);
    const resolved = resolveStoredFilterConfig(preRedesignSessionStrict);
    expect(resolved.effectiveSettings).toEqual(expected);
  });

  it("ipoDiscovery sin familyIntensity conserva los mismos activeSettings efectivos", () => {
    const expected = baselineEffectiveSettings(preRedesignSessionIpoDiscovery);
    const resolved = resolveStoredFilterConfig(preRedesignSessionIpoDiscovery);
    expect(resolved.effectiveSettings).toEqual(expected);
  });

  it("RS editado a mano sin familyIntensity conserva activeSettings y marca personalizado", () => {
    const expected = baselineEffectiveSettings(preRedesignSessionCustomRs);
    const resolved = resolveStoredFilterConfig(preRedesignSessionCustomRs);
    expect(resolved.effectiveSettings).toEqual(expected);
    expect(resolved.familyIntensityCustom.relativeStrength).toBe(true);
  });

  it("infiere intensidad estricta en RS cuando los umbrales coinciden con ancla 100", () => {
    const strictRs = settingsAtFamilyIntensity("relativeStrength", 100);
    const config = {
      ...preRedesignSessionStrict,
      settings: { ...settingsForPreset("strict"), ...strictRs.settings },
      fieldRules: { ...DEFAULT_FIELD_RULES, ...strictRs.fieldRules },
    };
    const resolved = resolveStoredFilterConfig(config);
    expect(resolved.familyIntensity.relativeStrength).toBe(100);
    expect(resolved.familyIntensityCustom.relativeStrength).toBe(false);
    // La inferencia no toca los settings guardados.
    expect(resolved.effectiveSettings).toEqual(baselineEffectiveSettings(config));
  });

  it("infiere intensidad discovery en IPO cuando los umbrales coinciden con ancla 0", () => {
    const openIpo = settingsAtFamilyIntensity("ipo", 0);
    const config = {
      ...preRedesignSessionIpoDiscovery,
      settings: { ...settingsForPreset("ipoDiscovery"), ...openIpo.settings },
    };
    const resolved = resolveStoredFilterConfig(config);
    expect(resolved.familyIntensity.ipo).toBe(0);
    expect(resolved.familyIntensityCustom.ipo).toBe(false);
    expect(resolved.effectiveSettings).toEqual(baselineEffectiveSettings(config));
  });

  it("capas v1/v2 se descartan: activeSettings alineados con contrato v3", () => {
    const expected = baselineEffectiveSettings(preRedesignTemplateLayersV1);
    const resolved = resolveStoredFilterConfig(preRedesignTemplateLayersV1);
    expect(resolved.effectiveSettings).toEqual(expected);
    expect(resolved.filterLayers).toEqual(DEFAULT_FILTER_LAYERS);
  });
});

describe("templateSnapshotAssessment · plantilla pre-rediseño", () => {
  it("plantilla strict sin familyIntensity → mismos effectiveSettings que la cadena directa", () => {
    const expected = baselineEffectiveSettings(preRedesignTemplateTopRs);
    const result = templateSnapshotAssessment(preRedesignTemplateTopRs, []);
    expect(result.effectiveSettings).toEqual(expected);
    expect(result.presetKey).toBe("strict");
  });

  it("la inferencia de modo en plantilla no altera effectiveSettings", () => {
    const openIpo = settingsAtFamilyIntensity("ipo", 0);
    const template = {
      version: 1,
      presetKey: "ipoDiscovery",
      markets: ["US"],
      settings: { ...settingsForPreset("ipoDiscovery"), ...openIpo.settings },
      filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
      useRegimeFilter: false,
    };
    const before = baselineEffectiveSettings(template);
    const result = templateSnapshotAssessment(template, []);
    expect(result.effectiveSettings).toEqual(before);
    expect(result.familyIntensity.ipo).toBe(0);
    expect(result.familyIntensityCustom.ipo).toBe(false);
  });

  it("plantilla con RS personalizado marca custom sin cambiar effectiveSettings", () => {
    const template = {
      version: 1,
      presetKey: "balanced",
      markets: ["US"],
      settings: preRedesignSessionCustomRs.settings,
      fieldRules: preRedesignSessionCustomRs.fieldRules,
      filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
    };
    const expected = baselineEffectiveSettings(template);
    const result = templateSnapshotAssessment(template, []);
    expect(result.effectiveSettings).toEqual(expected);
    expect(result.familyIntensityCustom.relativeStrength).toBe(true);
  });
});

describe("restoreFamilyIntensity · cosmética pura", () => {
  it("inferencia fallida → personalizado (custom) con slider en 50, sin tocar settings", () => {
    const settings = { ...settingsForPreset("balanced"), minRsRating: 72 };
    const fieldRules = { ...DEFAULT_FIELD_RULES, minRsRating: true };
    const resolved = resolveStoredFilterConfig({
      presetKey: "balanced",
      settings,
      fieldRules,
      filterLayersVersion: FILTER_LAYERS_CONTRACT_VERSION,
    });
    expect(resolved.familyIntensity.relativeStrength).toBe(50);
    expect(resolved.familyIntensityCustom.relativeStrength).toBe(true);
    expect(resolved.settings.minRsRating).toBe(72);
    expect(resolved.effectiveSettings.minRsRating).toBe(72);
  });
});
