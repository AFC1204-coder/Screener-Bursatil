// lib/scanLightProjection.js — la proyección LIGERA de una fila de escaneo.
//
// Por qué existe: hasta ahora el escaneo nocturno analizaba los ~5.600
// símbolos del universo estadounidense y guardaba solo los que pasaban el
// preset — 62 de 5.608 la noche del 14 de agosto de 2026. El 98,9% del
// trabajo se tiraba, y sin población no hay sobre qué filtrar: cualquier
// criterio distinto del preset obligaba a reescanear desde el navegador.
// Ver docs/adr-universo-precalculado.md.
//
// Ahora se guarda todo lo que llega al filtro. Los que pasan conservan la
// fila completa (la ficha del valor y la auditoría la necesitan); los que no
// pasan se guardan con ESTA proyección, que es exactamente lo que hace falta
// para poder filtrar, pintar la tabla de siete columnas y ordenar las Listas.
//
// ── El tamaño, medido (ADR Parte B.5) ────────────────────────────────────
// Fila completa de hoy: 46.481 B de JSON de media sobre 262 filas reales.
// Fila con esta proyección: 7.233 B. Un 84% menos. De los 279 campos
// distintos que hoy se escriben entre `raw` y `metrics`, aquí quedan 129.
// (Los tres últimos son las entradas del compuesto añadidas el 2026-08-15;
// media medida sobre el nocturno de ese día: 7.212 B → 7.281 B, +0,95%.)
//
// ── Los tres campos excluidos a propósito ────────────────────────────────
// Concentran 27,7 KB de los 46,5 KB de la fila (el 60%) y NINGUNA regla de
// filtro, columna de la tabla ni orden de lista los consulta:
//   - objectiveMetricAudit (16.270 B/fila): la tabla solo necesita saber si
//     el estado de cuatro métricas es "no fiable". Eso viaja resumido en
//     `metricAuditFlags`, del orden de 100 bytes.
//   - decisionTrace (6.675 B/fila).
//   - growthMetrics (4.788 B/fila): copia de métricas que ya viajan sueltas
//     en la misma fila.
//
// ── Cómo se mantiene honesta esta lista ──────────────────────────────────
// tests/scanLightProjection.test.js recorre FIELD_RULES, DISTANCE_RULES, las
// columnas de SCREENER_COLUMNS y los campos de orden de las Listas, y falla
// si alguno no está aquí. Añadir un control de filtro nuevo sin añadir su
// campo a esta lista rompe la suite en vez de fallar en silencio de noche
// —que es exactamente el modo de fallo que ya sufrió `minRsRating`
// (docs/auditoria-filtros-2026-08-13.md, E.2 punto 2).

import { compactChartPreview } from "@/lib/researchRowContract";

// Métricas cuyo valor puede existir y no ser fiable: la auditoría objetiva
// las marca como divergentes o no verificables contra la serie de precios.
// La tabla las pinta como ausentes con su motivo (principio 7 de
// docs/principios-producto.md). lib/screenerColumns.jsx importa esta
// constante en vez de tener su propia copia: si el criterio cambia, cambia
// en un sitio y la fila ligera y la celda siguen de acuerdo.
export const UNRELIABLE_AUDIT_STATUS = new Set(["mismatch", "unverified-value", "missing-source"]);

// Las cuatro métricas para las que la tabla consulta la auditoría objetiva
// (lib/screenerColumns.jsx, columnas 5 y 6).
export const AUDITED_TABLE_METRICS = ["perf3m", "perf6m", "perf12m", "distance52w"];

export const SCAN_LIGHT_EXCLUDED_FIELDS = ["objectiveMetricAudit", "decisionTrace", "growthMetrics"];

// ── NIVEL 1 — los campos que comparan los 62 controles numéricos ─────────
// 56 declarados en FIELD_RULES/DISTANCE_RULES (lib/screenerFilterCatalog.js)
// más los 7 de las cuatro reglas con código propio.
const RULE_FIELDS = [
  "absDistanceToPivotPct", "adProxyScore", "avgTurnover", "avgVolume", "baseDepthPct",
  "baseWeeks", "contraction1DepthPct", "contraction2DepthPct", "contraction3DepthPct",
  "contractionCount", "dataCoverageScore", "distance20d", "distance50d", "distance52w",
  "distanceATH", "epsGrowthProxyScore", "extSma50", "fundamentalCoverageScore",
  "highsSpreadPct", "lastContractionDepthPct", "latestTurnover", "latestVolume",
  "liquidityScore", "marketCap", "maxDailyMove20dPct", "maxDailyRange20dPct",
  "maxDrawdown63d", "minerviniScore", "momentumScore", "objectiveScore",
  "patternQualityScore", "perf12m", "perf3m", "perf6m", "price", "range63dPct",
  "relativeVolume", "returnToDrawdown3m", "returnToVol3m", "riskRewardScore", "riskScore",
  "rsCountryPct", "rsQualityScore", "rsRating", "rsSectorPct", "sectorScore",
  "shortPercentOfFloat", "technicalCoverageScore", "tightness10dPct", "upDownVolRatio",
  "volatility63d", "volumeDryUpRatio", "volumeEffectScore", "volumeScore", "volumeSurgePct",
  "weinsteinScore",
  // Las 4 reglas que el motor evalúa con código propio, fuera de FIELD_RULES:
  "priceFreshnessDays", "lastDate",        // maxPriceFreshnessDays
  "weeklyRsAvailable", "weeklyRsRating",   // minRsRating (ver nota de hidratación abajo)
  "weeklyCountryRsAvailable", "weeklyCountryRsRating", // minRsCountryPct
  "weeklyThemeRsAvailable", "weeklyThemeRsRating", // minThemeRsRating
  "weaknessScore",                          // minWeaknessScore
  "ipoAgeMonths", "ipoDate",                // maxIpoAgeMonths / requireRecentIpo
  // Procedencia y motivo de ausencia de la fecha de salida a bolsa. No los
  // compara ningún control: acompañan al dato para que la cobertura de filtros
  // pueda decir "el proveedor no da la fecha" (`ipo-date-unavailable`) en vez
  // de dejar la regla como no evaluada sin explicar por qué. Con la fecha
  // presente, `ipoDateReason` es null y scanLightMetrics no lo escribe.
  "ipoDateSource", "ipoDateReason",
];

// ── NIVEL 2 — los interruptores de sí/no ─────────────────────────────────
const BOOLEAN_RULE_FIELDS = [
  // requireStage2 → stage2RejectDetail, que ahora mira SOLO la etapa.
  "weeklyStageState", "weeklyStageConfirmation", "weeklyStageLabel",
  "weeklyFastWeeks", "weeklySlowWeeks", "weeklySlopeWeeks", "weeklyFlatPct",
  // La EVIDENCIA de la etapa. Antes no se guardaba ninguna: el 98,8% de las
  // filas llevaban el veredicto y ninguna de las tres cifras que lo sostienen,
  // así que la ficha no podía enseñar por qué un valor estaba donde estaba
  // (docs/auditoria-etapas-2026-08-16.md, C-18). `weeklyPriceAboveSlowMa`
  // además es lo que lee la amplitud: con cuatro etapas, "sobre su media de
  // 30 semanas" ya no se deduce de la etiqueta — una etapa 1 tentativa está
  // por encima y una etapa 3 tentativa por debajo.
  "weeklySlowMa", "weeklySlowMaSlope", "weeklySlowMaPriorSlope",
  "weeklyDistanceSlowMa", "weeklyPriceAboveSlowMa", "weeklyStageWeek",
  // requirePulso → trendTemplateIssue
  "sma50", "sma150", "sma200", "sma200Slope",
  "upVolume",                 // requireUpVolume
  "contractionsDecreasing",   // requireContractionsDecreasing
];

// ── NIVEL 3 — las 3 puertas implícitas, sin control en la interfaz ───────
// patternValidityGate, setupModeGate y el bloque de veredicto persistido que
// methodologyDisplayForRow prefiere sobre el recálculo.
//
// `pivotPrice` está aquí porque lo encontró la MEDICIÓN, no la lectura de
// código: sin él, el contrato de la lista `nearPivot` daba un veredicto
// distinto para un símbolo (V) de las 262 filas probadas. Ver ADR A.5.
const GATE_FIELDS = [
  "patternDataStatus", "patternEligible", "patternVolumeEligible",
  "contractionStructureStatus", "contractionStructureReason",
  "methodologyReliabilityState", "methodologyReliabilityReason", "methodologyBlocksPatternClaim",
  "setupDisplayDataLimited", "setupDisplayBlocksPatternClaim",
  "totalScore", "rsGlobalPct", "ipoScore", "distanceToPivotPct", "pivotPrice",
  "setupDisplayActionable", "setupDisplayWatch", "setupDisplayKey", "setupDisplayState",
  "setupDisplayLabel", "setupDisplayReason", "setupDisplayTone", "setupDisplayShortLabel",
  "setupDisplayEvidence", "setupDisplayLine", "setupDisplayStrict",
  "setupDisplayConfidenceKey", "setupDisplayConfidenceLabel",
  "setupDisplayTradePlanEligible", "setupDisplayObservable", "setupDisplayPlanValid",
  "setupVerdictKey", "setupVerdictState", "setupVerdictLabel", "setupVerdictShortLabel",
];

// ── La tabla de siete columnas (lib/screenerColumns.jsx) ─────────────────
// Los weeklyRs* NO los produce el escáner: los añade attachWeeklyRs
// (lib/globalRs.js) AL LEER, cruzando con rs_weekly_items. Están en la lista
// porque forman parte del contrato de lo que la fila debe poder ofrecer, no
// porque haya que escribirlos — scanLightMetrics solo escribe lo que existe.
const TABLE_FIELDS = [
  "symbol", "companyName", "country", "chartPreview",   // 1 Ticker + miniatura
  "theme",                                              // 2 Tema
  "weeklyRsAsOf", "weeklyRsWeekKey", "weeklyRsRank",    // 3 RS (canonicalRs)
  "weeklyRsSampleSize", "weeklyRsEngineVersion", "weeklyRsReason",
  "weeklyCountryRsAvailable", "weeklyCountryRsRating", "weeklyCountryRsRank",
  "weeklyCountryRsSampleSize", "weeklyCountryRsWeekKey", "weeklyCountryRsReason",
  // 4 Etapa, 5 Rendimiento, 6 Dist. 52s y 7 Capitalización ya están arriba.
];

// ── Las Listas: contrato de pertenencia y resumen de fiabilidad ──────────
const LIST_FIELDS = ["sector", "industry", "priceFreshnessOk", "priceFreshnessIssue"];

// ── La ficha del valor ───────────────────────────────────────────────────
// readUniverseRsSnapshot (app/api/company-brief/route.js) lee 17 métricas de
// scan_results por `symbol=eq.X&order=created_at.desc&limit=1`. Catorce ya
// están arriba; estas tres faltaban. Importan porque, con el universo
// guardado, la fila más reciente de un símbolo puede ser una fila ligera.
const STOCK_PAGE_FIELDS = ["rsGlobalSample", "rsCountrySample", "rsSectorSample"];

// ── Las entradas del compuesto que solo vivían en memoria ────────────────
// Los otros nueve términos de COMPOSITE_WEIGHTS (lib/scoringEngine.js) ya
// están arriba porque algún filtro, columna u orden de lista los consulta.
// Estos tres no los consultaba nadie, así que se calculaban, se usaban para
// puntuar y se tiraban al guardar. Consecuencia medida sobre las 3.314 filas
// del nocturno del 2026-08-15 (docs/analisis-compuesto-2026-08-15.md, B.3):
// el 99,1% de las filas guardaba un score que no se podía reconstruir con lo
// que la fila enseña, y buildScreenerScoreAudit (lib/screenerScoreAudit.js)
// —que imputa 0 puntos a lo que no encuentra— dejaba un residual de mediana
// 21,8 puntos contra un umbral de alarma de 4: el 100% de las filas ligeras
// en estado "Revisar fórmula", y un desglose que enseñaba "Demanda –, +0,0"
// para un componente que sí había pesado.
//
// Son tres escalares. Coste MEDIDO sobre las 3.283 filas ligeras reales de
// ese escaneo, añadiéndoles los valores reales de las 31 filas completas:
// mediana 7.219 B → 7.287 B (+68 B, +0,94%); media +68,8 B (+0,95%); peor
// caso +76 B. Sobre el escaneo entero, +220 KB sobre 22,6 MB.
const COMPOSITE_INPUT_FIELDS = ["setupQualityScore", "demandScore", "growthScore"];

// ── La puerta que corre ANTES que las reglas ─────────────────────────────
// qualityGateForResearchRow (lib/qualityGate.js) se ejecuta en el navegador
// sobre cada fila antes de aplicar ningún criterio, y exige dos cosas: precio
// y al menos 180 barras diarias (`chartBarsCount`). `price` ya está en
// RULE_FIELDS; `chartBarsCount` no estaba, y sin él TODA fila ligera se caía
// con "histórico 0/180". Medido el 2026-08-17 sobre el nocturno servido
// entero: 41 de 3.312 filas llevaban el campo, así que el usuario filtraba de
// hecho sobre esas 41 —las que ya habían pasado el preset del nocturno—, no
// sobre el universo. Es el mismo campo, por el mismo motivo, que la proyección
// de PERSISTENCIA conserva desde el 2026-08-15 (PERSIST_IDENTITY_FIELDS,
// lib/screenerPipeline.js).
//
// Nota de despliegue: esto solo lo escriben los escaneos NUEVOS. Las filas ya
// guardadas siguen sin el campo, y para ellas la puerta se apoya en la
// garantía del productor (ver lib/qualityGate.js).
const QUALITY_GATE_FIELDS = ["chartBarsCount"];

export const SCAN_LIGHT_FIELDS = [...new Set([
  ...RULE_FIELDS,
  ...BOOLEAN_RULE_FIELDS,
  ...GATE_FIELDS,
  ...TABLE_FIELDS,
  ...LIST_FIELDS,
  ...STOCK_PAGE_FIELDS,
  ...COMPOSITE_INPUT_FIELDS,
  ...QUALITY_GATE_FIELDS,
])];

/**
 * Resumen de la auditoría objetiva: solo las métricas de la tabla cuyo estado
 * es no fiable. Sustituye a objectiveMetricAudit entero (16 KB → ~100 B).
 * Devuelve `null` cuando no hay ninguna, para no escribir un objeto vacío.
 */
export function metricAuditFlags(row = {}) {
  const items = Array.isArray(row?.objectiveMetricAudit?.items) ? row.objectiveMetricAudit.items : [];
  if (!items.length) return null;
  const flags = {};
  for (const key of AUDITED_TABLE_METRICS) {
    const item = items.find((entry) => entry?.key === key);
    if (item && UNRELIABLE_AUDIT_STATUS.has(item.status)) flags[key] = item.status;
  }
  return Object.keys(flags).length ? flags : null;
}

/**
 * Proyección ligera de `metrics` para una fila que NO pasó el preset.
 *
 * Solo copia los campos que EXISTEN en la fila: un campo ausente se queda
 * ausente, no se rellena con null (principio 3 de docs/principios-producto.md
 * — un dato ausente se muestra como ausente, nunca como cero ni por defecto).
 * Esa es también la diferencia de peso frente a scanResultPayload, que hace
 * `?? null` campo a campo y por tanto materializa las ausencias.
 *
 * @param {object} row fila de research ya puntuada
 * @param {{rejection?: {field?: string, reason?: string}}} options
 */
export function scanLightMetrics(row = {}, options = {}) {
  const metrics = {};
  for (const key of SCAN_LIGHT_FIELDS) {
    const value = row?.[key];
    if (value !== undefined && value !== null) metrics[key] = value;
  }
  // Misma proyección de la miniatura que aplica scanDecisionRaw a la fila
  // completa (lib/scanDecisionProjection.js): 48 puntos date/close/sma50/
  // sma200/volume redondeados. Sin esto, el mismo campo se guardaba con dos
  // formas distintas en la misma tabla — la completa redondeada a 4 decimales
  // y con las claves de medias, la ligera en crudo. Medido sobre la corrida de
  // 300 símbolos del 2026-08-14: `close` salía como 159.5399932861328 en la
  // ligera y 26.8169 en la completa. No cambiaba lo que se pinta (MiniSparkline
  // trata la clave ausente y el null igual), pero dos formas para el mismo
  // campo es de donde salen las divergencias que luego cuesta encontrar.
  if (Array.isArray(metrics.chartPreview)) metrics.chartPreview = compactChartPreview(metrics.chartPreview);
  const flags = metricAuditFlags(row);
  if (flags) metrics.metricAuditFlags = flags;
  return {
    ...metrics,
    ...screenOutcome(false, options.rejection),
  };
}

/**
 * Marca de cribado que llevan TODAS las filas del escaneo, ligeras y
 * completas. Sin ella, una consulta sobre scan_results no puede distinguir
 * "este valor cumple el preset" de "este valor solo está aquí como población".
 *
 * - screenPassed: el único campo que hay que consultar para filtrar.
 * - rowProjection: qué forma tiene la fila, para que un consumidor sepa si
 *   puede esperar `raw` completo antes de pedirlo.
 * - screenRejectField/screenRejectReason: por qué no pasó. Sirve para
 *   separar "no cumple el criterio" de "no hay dato", que con 5.600 filas
 *   deja de ser un matiz y pasa a ser la mitad de los rechazos de algunas
 *   reglas (ADR D.12.2).
 */
export function screenOutcome(passed, rejection = null) {
  if (passed) return { screenPassed: true, rowProjection: "full" };
  return {
    screenPassed: false,
    rowProjection: "light",
    screenRejectField: rejection?.field || null,
    screenRejectReason: rejection?.reason || null,
  };
}
