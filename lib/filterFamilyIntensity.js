// lib/filterFamilyIntensity.js — mapa declarado de intensidad 0…100 para familias piloto.

import { settingsForPreset } from "./screenerFilterCatalog.js";

export const INTENSITY_PILOT_FAMILIES = ["ipo", "relativeStrength"];

const IPO_DISCOVERY = settingsForPreset("ipoDiscovery");
const IPO_STRICT = settingsForPreset("ipo");

/** @type {Record<string, { settings: Record<string, unknown>; fieldRules?: Record<string, boolean> }>} */
const IPO_ANCHORS = {
  0: {
    settings: {
      setupMode: "ipoRecent",
      requireRecentIpo: true,
      maxIpoAgeMonths: IPO_DISCOVERY.maxIpoAgeMonths,
      minDataCoverageScore: IPO_DISCOVERY.minDataCoverageScore,
      minTechnicalCoverageScore: IPO_DISCOVERY.minTechnicalCoverageScore,
      minFundamentalCoverageScore: IPO_DISCOVERY.minFundamentalCoverageScore,
      minMarketCap: IPO_DISCOVERY.minMarketCap,
      minPrice: IPO_DISCOVERY.minPrice,
      minAvgVolume: IPO_DISCOVERY.minAvgVolume,
      minPerf3m: IPO_DISCOVERY.minPerf3m,
      minPerf6m: IPO_DISCOVERY.minPerf6m,
      minPerf12m: IPO_DISCOVERY.minPerf12m,
    },
  },
  50: {
    settings: {
      setupMode: "ipoRecent",
      requireRecentIpo: true,
      maxIpoAgeMonths: 60,
      minDataCoverageScore: 28,
      minTechnicalCoverageScore: 38,
      minFundamentalCoverageScore: 0,
      minMarketCap: 175000000,
      minPrice: 3,
      minAvgVolume: 112500,
      minPerf3m: -45,
      minPerf6m: -50,
      minPerf12m: -100,
    },
  },
  100: {
    settings: {
      setupMode: "ipoRecent",
      requireRecentIpo: true,
      maxIpoAgeMonths: IPO_STRICT.maxIpoAgeMonths,
      minDataCoverageScore: IPO_STRICT.minDataCoverageScore,
      minTechnicalCoverageScore: IPO_STRICT.minTechnicalCoverageScore,
      minFundamentalCoverageScore: IPO_STRICT.minFundamentalCoverageScore,
      minMarketCap: IPO_STRICT.minMarketCap,
      minPrice: IPO_STRICT.minPrice,
      minAvgVolume: IPO_STRICT.minAvgVolume,
      minPerf3m: IPO_STRICT.minPerf3m,
      minPerf6m: IPO_STRICT.minPerf6m,
      minPerf12m: IPO_STRICT.minPerf12m,
    },
  },
};

/** @type {Record<string, { settings: Record<string, unknown>; fieldRules?: Record<string, boolean> }>} */
const RS_ANCHORS = {
  0: {
    settings: {
      minRsRating: 0,
      minRsBenchmarkRating: 0,
      minRsCountryPct: 0,
      minRsSectorPct: 0,
      minRsQualityScore: 0,
      minSectorScore: 0,
    },
    fieldRules: {
      minRsRating: false,
      minRsBenchmarkRating: false,
      minRsCountryPct: false,
      minRsSectorPct: false,
      minRsQualityScore: false,
      minSectorScore: false,
    },
  },
  50: {
    settings: {
      minRsRating: 55,
      minRsBenchmarkRating: 0,
      minRsCountryPct: 0,
      minRsSectorPct: 0,
      minRsQualityScore: 0,
      minSectorScore: 0,
    },
    fieldRules: {
      minRsRating: true,
      minRsBenchmarkRating: false,
      minRsCountryPct: false,
      minRsSectorPct: false,
      minRsQualityScore: false,
      minSectorScore: false,
    },
  },
  100: {
    settings: {
      minRsRating: 75,
      minRsBenchmarkRating: 60,
      minRsCountryPct: 0,
      minRsSectorPct: 0,
      minRsQualityScore: 60,
      minSectorScore: 55,
    },
    fieldRules: {
      minRsRating: true,
      minRsBenchmarkRating: true,
      minRsCountryPct: false,
      minRsSectorPct: false,
      minRsQualityScore: true,
      minSectorScore: true,
    },
  },
};

export const FILTER_FAMILY_INTENSITY = {
  ipo: {
    key: "ipo",
    anchors: IPO_ANCHORS,
    managedKeys: Object.keys(IPO_ANCHORS[0].settings).concat(["requireRecentIpo"]),
    summaryKeys: ["maxIpoAgeMonths", "requireRecentIpo", "minPerf3m", "minDataCoverageScore"],
    auxiliaryFieldKeys: [],
  },
  relativeStrength: {
    key: "relativeStrength",
    anchors: RS_ANCHORS,
    managedKeys: Object.keys(RS_ANCHORS[0].settings),
    summaryKeys: ["minRsRating", "minRsBenchmarkRating", "minRsQualityScore", "minSectorScore"],
    auxiliaryFieldKeys: ["minRsBenchmarkRating", "minRsCountryPct", "minRsSectorPct", "minRsQualityScore", "minSectorScore"],
  },
};

const ANCHOR_POINTS = [0, 50, 100];
const NUMERIC_TOLERANCE = 0.51;

function clampIntensity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function segmentForIntensity(intensity) {
  if (intensity <= 50) return { low: 0, high: 50, t: intensity / 50 };
  return { low: 50, high: 100, t: (intensity - 50) / 50 };
}

function interpolateValue(key, lowValue, highValue, t) {
  if (typeof lowValue === "number" && typeof highValue === "number") {
    return Number(lerp(lowValue, highValue, t).toFixed(4));
  }
  return t < 0.5 ? lowValue : highValue;
}

export function familyHasIntensity(key) {
  return INTENSITY_PILOT_FAMILIES.includes(key);
}

export function intensityManagedKeys(familyKey) {
  return FILTER_FAMILY_INTENSITY[familyKey]?.managedKeys || [];
}

export function intensityAuxiliaryFieldKeys(familyKey) {
  return FILTER_FAMILY_INTENSITY[familyKey]?.auxiliaryFieldKeys || [];
}

export function settingsAtFamilyIntensity(familyKey, intensity = 0) {
  const config = FILTER_FAMILY_INTENSITY[familyKey];
  if (!config) return { settings: {}, fieldRules: {} };
  const value = clampIntensity(intensity);
  const { low, high, t } = segmentForIntensity(value);
  const lowAnchor = config.anchors[low];
  const highAnchor = config.anchors[high];
  const keys = new Set([
    ...Object.keys(lowAnchor.settings),
    ...Object.keys(highAnchor.settings),
  ]);
  const settings = {};
  keys.forEach((key) => {
    settings[key] = interpolateValue(
      key,
      lowAnchor.settings[key],
      highAnchor.settings[key],
      t,
    );
  });
  const fieldRules = {};
  const ruleKeys = new Set([
    ...Object.keys(lowAnchor.fieldRules || {}),
    ...Object.keys(highAnchor.fieldRules || {}),
  ]);
  ruleKeys.forEach((key) => {
    const lowRule = lowAnchor.fieldRules?.[key];
    const highRule = highAnchor.fieldRules?.[key];
    if (typeof lowRule === "boolean" && typeof highRule === "boolean") {
      fieldRules[key] = t < 0.5 ? lowRule : highRule;
    } else {
      fieldRules[key] = highRule ?? lowRule ?? true;
    }
  });
  return { settings, fieldRules };
}

function valuesClose(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= NUMERIC_TOLERANCE;
  }
  return a === b;
}

export function settingsMatchFamilyIntensity(settings = {}, fieldRules = {}, familyKey, intensity) {
  const expected = settingsAtFamilyIntensity(familyKey, intensity);
  const config = FILTER_FAMILY_INTENSITY[familyKey];
  if (!config) return true;
  const settingsOk = config.managedKeys.every((key) => valuesClose(settings[key], expected.settings[key]));
  const ruleKeys = Object.keys(expected.fieldRules || {});
  const rulesOk = ruleKeys.every((key) => {
    const current = fieldRules[key] !== false;
    const expectedRule = expected.fieldRules[key] !== false;
    return current === expectedRule;
  });
  return settingsOk && rulesOk;
}

export function inferFamilyIntensity(settings = {}, fieldRules = {}, familyKey) {
  if (!familyHasIntensity(familyKey)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (let candidate = 0; candidate <= 100; candidate += 1) {
    if (!settingsMatchFamilyIntensity(settings, fieldRules, familyKey, candidate)) continue;
    const distance = Math.abs(candidate - 50);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function isFamilyIntensityCustom(settings = {}, fieldRules = {}, familyKey, storedIntensity = null) {
  if (!familyHasIntensity(familyKey)) return false;
  if (storedIntensity == null) return inferFamilyIntensity(settings, fieldRules, familyKey) == null;
  return !settingsMatchFamilyIntensity(settings, fieldRules, familyKey, storedIntensity);
}

// Restaura intensidad por familia al rehidratar sesión/plantilla. Solo cosmético:
// no toca settings ni fieldRules; si la inferencia falla → personalizado (custom).
export function restoreFamilyIntensity(settings = {}, fieldRules = {}, savedIntensity = {}) {
  const intensity = {};
  const custom = {};
  INTENSITY_PILOT_FAMILIES.forEach((key) => {
    const stored = savedIntensity[key];
    if (Number.isFinite(stored)) {
      intensity[key] = stored;
      custom[key] = isFamilyIntensityCustom(settings, fieldRules, key, stored);
      return;
    }
    const inferred = inferFamilyIntensity(settings, fieldRules, key);
    intensity[key] = inferred ?? 50;
    custom[key] = inferred == null;
  });
  return { intensity, custom };
}

function formatThreshold(key, value) {
  if (!Number.isFinite(value)) return null;
  if (key === "maxIpoAgeMonths") return `edad ≤ ${Math.round(value)}m`;
  if (key === "minRsRating") return value > 0 ? `RS global ≥ ${Math.round(value)}` : "sin corte RS";
  if (key === "minRsBenchmarkRating" && value > 0) return `bench ≥ ${Math.round(value)}`;
  if (key === "minRsQualityScore" && value > 0) return `quality ≥ ${Math.round(value)}`;
  if (key === "minSectorScore" && value > 0) return `grupo ≥ ${Math.round(value)}`;
  if (key === "minPerf3m" && value > -100) return `perf 3M ≥ ${Math.round(value)}%`;
  if (key === "minDataCoverageScore" && value > 0) return `cobertura ≥ ${Math.round(value)}`;
  return null;
}

export function summarizeFamilyIntensity(familyKey, settings = {}, fieldRules = {}) {
  if (familyKey === "ipo") {
    const parts = [];
    if (settings.requireRecentIpo) parts.push("IPO real");
    const age = formatThreshold("maxIpoAgeMonths", settings.maxIpoAgeMonths);
    if (age) parts.push(age);
    const perf = formatThreshold("minPerf3m", settings.minPerf3m);
    if (perf) parts.push(perf);
    const cov = formatThreshold("minDataCoverageScore", settings.minDataCoverageScore);
    if (cov && settings.minDataCoverageScore >= 30) parts.push(cov);
    return parts.join(" · ") || "IPO abierto";
  }
  if (familyKey === "relativeStrength") {
    const parts = [];
    const rs = formatThreshold("minRsRating", settings.minRsRating);
    if (rs) parts.push(rs);
    if (fieldRules.minRsBenchmarkRating !== false) {
      const bench = formatThreshold("minRsBenchmarkRating", settings.minRsBenchmarkRating);
      if (bench) parts.push(bench);
    }
    if (fieldRules.minRsQualityScore !== false) {
      const quality = formatThreshold("minRsQualityScore", settings.minRsQualityScore);
      if (quality) parts.push(quality);
    }
    if (fieldRules.minSectorScore !== false) {
      const group = formatThreshold("minSectorScore", settings.minSectorScore);
      if (group) parts.push(group);
    }
    return parts.join(" · ") || "sin corte RS";
  }
  return "";
}

export function intensityTickLabel(value) {
  if (value <= 0) return "Abierto";
  if (value >= 100) return "Estricto";
  if (value === 50) return "Medio";
  return "";
}

export { ANCHOR_POINTS, clampIntensity };
