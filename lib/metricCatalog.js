export const METRIC_CATALOG = {
  totalScore: {
    label: "Composite",
    shortLabel: "Composite",
    description: "Score agregado de setup, fuerza, demanda, crecimiento y riesgo.",
  },
  compositeScore: {
    label: "Composite",
    shortLabel: "Composite",
    description: "Score agregado de setup, fuerza, demanda, crecimiento y riesgo.",
  },
  rsGlobalPct: {
    label: "RS",
    shortLabel: "RS",
    description: "Metrica principal de fuerza relativa: percentil 1-99 dentro del universo analizado con muestra minima.",
  },
  rsRating: {
    label: "RS Benchmark",
    shortLabel: "RS Bench",
    description: "Fuerza relativa frente al benchmark local de la bolsa/pais, con fallback global ACWI y opcion de override manual.",
  },
  rsCountryPct: {
    label: "RS Pais",
    shortLabel: "RS Pais",
    description: "Fuerza relativa dentro del mercado local.",
  },
  rsSectorPct: {
    label: "RS Grupo",
    shortLabel: "RS Grupo",
    description: "Fuerza relativa dentro del sector o grupo comparable.",
  },
  rsQualityScore: {
    label: "RS Quality",
    shortLabel: "RS Quality",
    description: "Calidad de la fuerza relativa ajustada por estabilidad, drawdown y volatilidad.",
  },
  weaknessScore: {
    label: "Deterioro",
    shortLabel: "Deterioro",
    description: "Evidencia tecnica de debilidad o distribucion.",
  },
  adProxyScore: {
    label: "A/D",
    shortLabel: "A/D",
    description: "Proxy de acumulacion/distribucion basado en volumen y comportamiento del precio.",
  },
  epsGrowthProxyScore: {
    label: "EPS proxy",
    shortLabel: "EPS proxy",
    description: "Proxy de crecimiento con beneficios, ventas, margen y ROE cuando hay datos.",
  },
  growthQualityScore: {
    label: "Growth",
    shortLabel: "Growth",
    description: "Calidad de crecimiento fundamental disponible.",
  },
  shortPercentOfFloat: {
    label: "Short Float",
    shortLabel: "Short Float",
    description: "Porcentaje de free float vendido en corto.",
  },
  volumeEffectScore: {
    label: "Volume Effect",
    shortLabel: "Volume Effect",
    description: "Evidencia de demanda reciente por volumen.",
  },
  stage: {
    label: "Stage",
    shortLabel: "Stage",
    description: "Lectura Weinstein de etapa primaria.",
  },
  weinsteinScore: {
    label: "Weinstein",
    shortLabel: "Weinstein",
    description: "Score de estructura Weinstein.",
  },
  minerviniScore: {
    label: "Minervini",
    shortLabel: "Minervini",
    description: "Score de trend template y momentum tipo Minervini.",
  },
  riskScore: {
    label: "Risk",
    shortLabel: "Risk",
    description: "Calidad de riesgo tecnico y volatilidad.",
  },
};

export function metricLabel(key, fallback = key) {
  return METRIC_CATALOG[key]?.label || fallback;
}

export function metricShortLabel(key, fallback = key) {
  return METRIC_CATALOG[key]?.shortLabel || METRIC_CATALOG[key]?.label || fallback;
}

export function metricDescription(key, fallback = "") {
  return METRIC_CATALOG[key]?.description || fallback;
}
