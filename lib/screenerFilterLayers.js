import {
  DEFAULT_FIELD_RULES,
  DEFAULT_FILTER_LAYERS,
  FILTER_FIELDS,
  FILTER_FIELD_LAYERS,
  FILTER_LAYERS_CONTRACT_VERSION,
  NEUTRAL_FIELD_VALUES,
  SETTING_LAYER_DEPENDENCIES,
  effectiveScreenerFilterValues,
  filterLayersForPreset,
} from "./screenerFilterCatalog.js";

export { FILTER_LAYERS_CONTRACT_VERSION };

// ---------------------------------------------------------------------------
// restoreFilterLayers — única puerta de entrada del estado de capas guardado.
//
// El problema que resuelve: hasta la v1 del contrato, cuatro de las catorce
// capas venían apagadas de fábrica. Cualquier sesión, snapshot o plantilla
// guardada entonces lleva esas cuatro en `false`, y al leerla es IMPOSIBLE
// distinguir "el usuario las apagó a propósito" de "se guardó el estado de
// fábrica". Los dos casos producen exactamente el mismo objeto.
//
// Por eso el estado anterior a la v2 se DESCARTA en vez de migrarse: rehidratar
// esas cuatro capas perpetuaría en silencio justo lo que la v2 elimina — un
// screener que filtra distinto de lo que su preset dice, sin que el usuario lo
// haya pedido. Descartarlo cuesta una pulsación en el panel de filtros; lo otro
// deja el estado dudoso para siempre. Lo demás de la sesión (resultados,
// universo, filtros de vista, scroll) NO se toca: por eso este corte va por
// contrato propio de capas y no subiendo SCREENER_SESSION_VERSION.
//
// A partir de la v2 el estado guardado sí se respeta: se escribe con su versión
// al lado, así que apagar una capa vuelve a ser una decisión que persiste.
// ---------------------------------------------------------------------------
export function restoreFilterLayers(savedLayers, savedVersion, presetKey = "balanced") {
  const base = filterLayersForPreset(presetKey);
  const version = Number(savedVersion);
  if (!Number.isFinite(version) || version < FILTER_LAYERS_CONTRACT_VERSION) return base;
  if (!savedLayers || typeof savedLayers !== "object") return base;
  return { ...base, ...savedLayers };
}

export function fieldLayerKeys(fieldOrKey) {
  const key = typeof fieldOrKey === "string" ? fieldOrKey : fieldOrKey?.key;
  return FILTER_FIELD_LAYERS[key] || [];
}

export function isFieldRuleActive(field, rules = DEFAULT_FIELD_RULES, layers = DEFAULT_FILTER_LAYERS) {
  return rules[field.key] !== false && fieldLayerKeys(field).every((key) => layers[key] !== false);
}

export function inactiveFieldReason(field, rules = DEFAULT_FIELD_RULES, layers = DEFAULT_FILTER_LAYERS) {
  if (rules[field.key] === false) return "Regla quitada: el valor se conserva";
  const off = fieldLayerKeys(field).filter((key) => layers[key] === false);
  return off.length ? `Capa apagada: ${off.join(", ")}` : "";
}

export function settingLayerDependency(key) {
  return SETTING_LAYER_DEPENDENCIES[key] || null;
}

export function settingApplies(key, layers = DEFAULT_FILTER_LAYERS) {
  const dependency = settingLayerDependency(key);
  return !dependency || layers[dependency.layer] !== false;
}

export function inactiveSettingReason(key, layers = DEFAULT_FILTER_LAYERS) {
  const dependency = settingLayerDependency(key);
  if (!dependency || layers[dependency.layer] !== false) return "";
  return `Capa ${dependency.label} apagada; al marcarla se activa.`;
}

export function effectiveSettingsFromLayers(set = {}, layers = DEFAULT_FILTER_LAYERS, fieldRules = DEFAULT_FIELD_RULES) {
  const next = { ...set };
  if (!layers.trend) {
    next.requireStage2 = false;
    next.requireSma200Up = false;
    next.requirePriceAboveSma50 = false;
    next.minWeinsteinScore = 0;
    next.minMinerviniScore = 0;
  }
  if (!layers.momentum) {
    next.minPerf3m = -100;
    next.minPerf6m = -100;
    next.minPerf12m = -100;
    next.minMomentumScore = 0;
  }
  if (!layers.relativeStrength) {
    next.minRsRating = 0;
    next.minRsBenchmarkRating = 0;
    next.minRsCountryPct = 0;
    next.minRsSectorPct = 0;
    next.minRsQualityScore = 0;
    next.minSectorScore = 0;
  }
  if (!layers.proximity) {
    next.maxDistance20dHigh = 999;
    next.maxDistance50dHigh = 999;
    next.maxDistance52w = 999;
    next.maxDistanceATH = 999;
    next.maxHighsSpreadPct = 999;
    next.maxExtensionSma50 = 999;
    next.minRiskScore = 0;
  }
  if (!layers.volatility) {
    next.maxDailyMove20dPct = 999;
    next.maxDailyRange20dPct = 999;
    next.maxRange63dPct = 999;
    next.maxVolatility63d = 999;
    next.maxDrawdown63d = 999;
  }
  if (!layers.pattern) {
    next.requireContractionsDecreasing = false;
    next.minContractionCount = 0;
    next.maxContraction1DepthPct = 999;
    next.maxContraction2DepthPct = 999;
    next.maxContraction3DepthPct = 999;
    next.maxLastContractionDepthPct = 999;
    next.maxBaseDepthPct = 999;
    next.maxAbsDistanceToPivotPct = 999;
    next.maxVolumeDryUpRatio = 999;
    next.maxTightness10dPct = 999;
    next.minPatternQualityScore = 0;
  }
  if (!layers.score) {
    next.minRiskScore = 0;
    next.minVolumeScore = 0;
    next.minSectorScore = 0;
    next.minTotalScore = 0;
  }
  if (!layers.liquidity) {
    next.minPrice = 0;
    next.minMarketCap = 0;
    next.minAvgVolume = 0;
    next.minAvgTurnover = 0;
    next.minVolumeScore = 0;
    next.minLiquidityScore = 0;
  }
  if (!layers.volumeSurge) {
    next.minLatestVolume = 0;
    next.minLatestTurnover = 0;
    next.minRelativeVolume = 0;
    next.minVolumeSurgePct = -999;
    next.minUpDownVolRatio = 0;
    next.minVolumeEffectScore = 0;
    next.requireUpVolume = false;
  }
  if (!layers.shortInterest) {
    next.minShortFloatPct = 0;
    next.maxShortFloatPct = 999;
  }
  if (!layers.riskReward) {
    next.minRiskRewardScore = 0;
    next.minReturnToVol3m = -999;
    next.minReturnToDrawdown3m = -999;
  }
  if (!layers.coverage) {
    next.maxPriceFreshnessDays = 999;
    next.minDataCoverageScore = 0;
    next.minTechnicalCoverageScore = 0;
    next.minFundamentalCoverageScore = 0;
  }
  if (!layers.ipo) {
    next.requireRecentIpo = false;
    next.maxIpoAgeMonths = 999;
  }
  if (!layers.score && next.setupMode === "weakness") next.setupMode = "any";
  if (!layers.ipo && next.setupMode === "ipoRecent") next.setupMode = "any";
  if (!layers.proximity && ["nearPivot", "pullback", "early", "ipoRecent", "extended"].includes(next.setupMode)) next.setupMode = "any";
  if (!layers.momentum && ["nearPivot", "pullback", "early", "ipoRecent", "extended"].includes(next.setupMode)) next.setupMode = "any";
  if (!layers.trend && ["leader", "early", "pullback"].includes(next.setupMode)) next.setupMode = "any";
  for (const field of FILTER_FIELDS) {
    if (!isFieldRuleActive(field, fieldRules, layers)) next[field.key] = NEUTRAL_FIELD_VALUES[field.key] ?? next[field.key];
  }
  return effectiveScreenerFilterValues(next);
}
