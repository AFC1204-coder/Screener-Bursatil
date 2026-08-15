// tests/_audit_contract.js
//
// FUENTE ÚNICA estructurada para la auditoría de Camino A.
//
// Este archivo es la única fuente de verdad de:
//   - Inventario canónico (leído en runtime desde SIGNAL_REGISTRY).
//   - Tabla de equivalencia: por cada señal, qué rutas la invocan y cómo.
//   - Divergencias aceptadas (con cita exacta al ADR).
//
// Reglas:
//   1. La lista de claves NO se duplica: se valida que coincide con
//      Object.keys(SIGNAL_REGISTRY). Cualquier discrepancia rompe el audit.
//   2. Cada ruta declara para cada señal una clasificación:
//      - 'EQUIVALENT'        — la ruta invoca computeSignal/scoreWeakness
//                              sobre la fila y produce el mismo valor.
//      - 'EQUIVALENT_ADAPT'  — la ruta invoca con override o re-orden
//                              documentado (ej. prefiere pre-calc si finito).
//      - 'DIVERGENCE_DOC'    — divergencia intencional aceptada (ADR §N).
//      - 'NOT_APPLICABLE'    — la fase semántica de la ruta no requiere
//                              esta señal (ej. señales composite-level antes
//                              de sectorize).
//      - 'DIVERGENCE_PENDING' — divergencia detectada por el audit y NO
//                              documentada en el ADR. Si tras la auditoría
//                              esta categoría está vacía, Camino A puede
//                              pasar a cierre formal; si tiene entradas,
//                              cada una debe resolverse (mover a
//                              DIVERGENCE_DOC con respaldo en el ADR, o
//                              documentar y aceptar en el contrato).
//                              Mientras exista alguna DIVERGENCE_PENDING,
//                              Camino A está "pendiente de decisión humana".
//   3. Las divergencias declaradas tienen id + route + signal + ADR quote.
//      El test verifica que el quote existe literalmente en el ADR.
//
// El documento Markdown (docs/audit-score-coherence-contract.md) se
// valida estructuralmente contra este módulo: los IDs de divergencia
// deben coincidir, las claves deben coincidir y los conteos deben sumar.

import { SIGNAL_REGISTRY, COMPOSITE_WEIGHTS, computeComposite } from "@/lib/scoringEngine";

/**
 * Inventario de señales: se lee en runtime desde el registry.
 * Esta función es la única lectura canónica del conteo.
 */
export function registryInventory() {
  const entries = Object.values(SIGNAL_REGISTRY);
  const positives = entries.filter((e) => e.direction === "positive");
  const negatives = entries.filter((e) => e.direction === "negative");
  return {
    total: entries.length,
    positives: positives.map((e) => e.key),
    negatives: negatives.map((e) => e.key),
    positiveCount: positives.length,
    negativeCount: negatives.length,
  };
}

/**
 * Tabla de clasificación por ruta.
 *
 * Cada entrada mapea:
 *   signal → { routeKey: { kind, evidence } }
 *
 * `evidence` apunta a archivo:línea aproximada, sin pretender precisión
 * absoluta (es referencia humana para mantenimiento). El test verifica
 * que el archivo referenciado existe y que la señal/clave aparece en
 * alguna línea del archivo.
 */
export const EQUIVALENCE_MATRIX = Object.freeze({
  // Ruta A: buildResearchRow (camino cliente + /api/scan)
  researchRow: {
    weinsteinScore:       { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:291" },
    minerviniScore:       { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:292" },
    momentumScore:        { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:293" },
    riskScore:            { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:294" },
    riskRewardScore:      { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:295" },
    volumeEffectScore:    { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:296" },
    volumeScore:          { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:300" },
    liquidityScore:       { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:301" },
    ipoScore:             { kind: "NOT_APPLICABLE",   evidence: "no invocado en Ruta A; calculado en sectorize" },
    objectiveSetupScore:  { kind: "NOT_APPLICABLE",   evidence: "no invocado en Ruta A; calculado en sectorize" },
    patternContributionScore: { kind: "NOT_APPLICABLE", evidence: "no invocado en Ruta A; calculado en sectorize" },
    patternScore:         { kind: "NOT_APPLICABLE",   evidence: "no invocado en Ruta A; calculado en sectorize" },
    setupQualityScore:    { kind: "NOT_APPLICABLE",   evidence: "no invocado en Ruta A; calculado en sectorize" },
    demandScore:          { kind: "NOT_APPLICABLE",   evidence: "no invocado en Ruta A; calculado en sectorize" },
    growthScore:          { kind: "NOT_APPLICABLE",   evidence: "no invocado en Ruta A; calculado en sectorize" },
    epsGrowthProxyScore:  { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:299" },
    adProxyScore:         { kind: "EQUIVALENT",       evidence: "lib/researchRow.js:298" },
    weaknessScore:        { kind: "EQUIVALENT_ADAPT", evidence: "lib/researchRow.js:316-318 (doble invocación)" },
  },

  // Ruta B: sectorize (camino vivo del scan cliente/servidor)
  screenerPipeline: {
    weinsteinScore:       { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    minerviniScore:       { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    momentumScore:        { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    riskScore:            { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    riskRewardScore:      { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    volumeEffectScore:    { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    volumeScore:          { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    liquidityScore:       { kind: "EQUIVALENT",       evidence: "llega pre-calculado de Ruta A; no recalculado" },
    ipoScore:             { kind: "EQUIVALENT",       evidence: "lib/screenerPipeline.js:318 (computeSignal con sectorScore)" },
    objectiveSetupScore:  { kind: "EQUIVALENT",       evidence: "lib/screenerPipeline.js:319" },
    patternContributionScore: { kind: "EQUIVALENT",   evidence: "lib/screenerPipeline.js:320" },
    patternScore:         { kind: "EQUIVALENT",       evidence: "lib/screenerPipeline.js:321" },
    setupQualityScore:    { kind: "EQUIVALENT",       evidence: "lib/screenerPipeline.js:322" },
    demandScore:          { kind: "EQUIVALENT",       evidence: "lib/screenerPipeline.js:323" },
    growthScore:          { kind: "EQUIVALENT",       evidence: "lib/screenerPipeline.js:324" },
    epsGrowthProxyScore:  { kind: "EQUIVALENT_ADAPT", evidence: "lib/screenerPipeline.js:328 (prefiere pre-calc si finito)" },
    adProxyScore:         { kind: "EQUIVALENT_ADAPT", evidence: "lib/screenerPipeline.js:327 (prefiere pre-calc si finito)" },
    weaknessScore:        { kind: "EQUIVALENT_ADAPT", evidence: "lib/screenerPipeline.js:352-357 (doble invocación + narrativa)" },
  },

  // Ruta C — buildResearchRow privado (cron scan-refresh).
  // Calcula las mismas señales técnicas que Ruta A: no calcula señales
  // composite-level (eso lo hace sectorize, abajo). Acceso vía seam
  // `_forTest` (línea final de lib/materializedScanner.js).
  materializedScanner_build: {
    weinsteinScore:       { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:567" },
    minerviniScore:       { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:568" },
    momentumScore:        { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:569" },
    riskScore:            { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:570" },
    riskRewardScore:      { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:571" },
    volumeEffectScore:    { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:572" },
    volumeScore:          { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:575" },
    liquidityScore:       { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:576" },
    ipoScore:             { kind: "NOT_APPLICABLE",   evidence: "no se invoca en buildResearchRow privado" },
    objectiveSetupScore:  { kind: "NOT_APPLICABLE",   evidence: "calculado en sectorize, no en buildResearchRow" },
    patternContributionScore: { kind: "NOT_APPLICABLE", evidence: "idem" },
    patternScore:         { kind: "NOT_APPLICABLE",   evidence: "idem" },
    setupQualityScore:    { kind: "NOT_APPLICABLE",   evidence: "idem" },
    demandScore:          { kind: "NOT_APPLICABLE",   evidence: "idem" },
    growthScore:          { kind: "NOT_APPLICABLE",   evidence: "idem" },
    epsGrowthProxyScore:  { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:574" },
    adProxyScore:         { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:573" },
    weaknessScore:        { kind: "EQUIVALENT_ADAPT", evidence: "lib/materializedScanner.js:591-593 (doble invocación)" },
  },

  // Ruta C — sectorize privado.
  // Calcula las señales composite-level + percentiles. Diferencias con B:
  //   - ipoScore NO se invoca (DIVERG-DOC #1; ADR §4.3). Desde el 2026-08-15
  //     el término salió del composite, así que la ausencia del campo ya no
  //     cambia ningún score: B y C producen el mismo composite.
  //   - sectorize opera por lote local, no por población completa (hallazgo
  //     pendiente de respaldo textual en el ADR).
  //   - scoreWeakness se invoca POST-percentiles (mismo orden que B;
  //     ADR §4.4 documenta la diferencia con Ruta A).
  materializedScanner_sectorize: {
    weinsteinScore:       { kind: "EQUIVALENT",       evidence: "llega pre-calculado del builder" },
    minerviniScore:       { kind: "EQUIVALENT",       evidence: "idem" },
    momentumScore:        { kind: "EQUIVALENT",       evidence: "idem" },
    riskScore:            { kind: "EQUIVALENT",       evidence: "idem" },
    riskRewardScore:      { kind: "EQUIVALENT",       evidence: "idem" },
    volumeEffectScore:    { kind: "EQUIVALENT",       evidence: "idem" },
    volumeScore:          { kind: "EQUIVALENT",       evidence: "idem" },
    liquidityScore:       { kind: "EQUIVALENT",       evidence: "idem" },
    ipoScore:             { kind: "DIVERGENCE_DOC",   evidence: "ADR §4.3 — NO se invoca en sectorize privado" },
    objectiveSetupScore:  { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:419" },
    patternContributionScore: { kind: "EQUIVALENT",   evidence: "lib/materializedScanner.js:420" },
    patternScore:         { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:421" },
    setupQualityScore:    { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:422" },
    demandScore:          { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:423" },
    growthScore:          { kind: "EQUIVALENT",       evidence: "lib/materializedScanner.js:424" },
    epsGrowthProxyScore:  { kind: "EQUIVALENT_ADAPT", evidence: "lib/materializedScanner.js:428 (override)" },
    adProxyScore:         { kind: "EQUIVALENT_ADAPT", evidence: "lib/materializedScanner.js:427 (override)" },
    weaknessScore:        { kind: "EQUIVALENT_ADAPT", evidence: "lib/materializedScanner.js:591-593 (post-percentiles; ADR §4.4)" },
    // sectorScore y rsGlobalPct/rsCountryPct/rsSectorPct NO son señales del
    // registry (son calculadas por sectorize y usadas por el composite).
    // No aparecen en EQUIVALENCE_MATRIX; la divergencia de sectorize por
    // lote local se registra en PENDING_DIVERGENCES #P3.
  },
});

/**
 * Estado global del audit. Si hay DIVERGENCE_PENDING activas, Camino A
 * NO está listo para cierre.
 */
export function auditGlobalStatus() {
  const pending = PENDING_DIVERGENCES.length;
  return {
    pendingCount: pending,
    isReadyForClosure: pending === 0,
    acceptedCount: ACCEPTED_DIVERGENCES.length,
    message: pending === 0
      ? "Sin divergencias pendientes; Camino A listo para cierre formal."
      : `Camino A tiene ${pending} divergencia(s) pendiente(s); NO listo para cierre formal.`,
  };
}

/**
 * Divergencias aceptadas por el ADR (con cita exacta).
 *
 * Cada entrada declara:
 *   - id: identificador que aparece literal en el contrato Markdown.
 *   - signal: nombre de la señal afectada (o "n/a" si no aplica a una señal).
 *   - route: ruta del sistema donde ocurre.
 *   - adrQuote: substring literal que DEBE aparecer en el ADR para que el
 *               audit considere la divergencia "respaldada por el ADR".
 *               Si el ADR no contiene la cita, la divergencia pasa a
 *               DIVERGENCE_PENDING y rompe el audit.
 *
 * Cualquier divergencia listada que NO tenga respaldo literal en el ADR
 * se considera "no aceptada" y el test falla. Esta es la verificación
 * dura de "no esconder discrepancias bajo normalización".
 */
export const ACCEPTED_DIVERGENCES = Object.freeze([
  {
    id: "DIVERG-DOC #1",
    signal: "ipoScore",
    route: "materializedScanner.sectorize",
    severity: "campo-ausente",
    description: "ipoScore no se invoca en materializedScanner.sectorize: el campo falta en las filas del cron. Desde el 2026-08-15 ya NO afecta al composite (el término salió de COMPOSITE_WEIGHTS), así que la divergencia dejó de ser observable en el score y se queda en el campo.",
    adrQuote: "**`ipoScore` en el composite**",
    adrSection: "§4.3",
  },
  {
    id: "DIVERG-DOC #2",
    signal: "ebitdaMargin",
    route: "materializedScanner.dataCoverageForRow",
    severity: "cobertura",
    description: "ebitdaMargin ausente en dataCoverageForRow privado; presente en researchRow.js (13 entradas).",
    adrQuote: "`ebitdaMargin` en cobertura fundamental",
    adrSection: "§4.2",
  },
  {
    id: "DIVERG-DOC #3",
    signal: "compositeReasons/Risks/ratingModel",
    route: "materializedScanner.sectorize",
    severity: "producto",
    description: "Narrativa + ratingModel ausentes en filas del cron. El tercer campo de la divergencia original, legacyTotalScore, dejó de existir el 2026-08-15: se eliminó de la ruta B porque su único consumidor era una columna del CSV, así que ya no hay nada que diverja por ahí.",
    adrQuote: "Narrativa + `legacyTotalScore` + `ratingModel`",
    adrSection: "§4.5",
  },
  {
    id: "DIVERG-DOC #4",
    signal: "chartPreview",
    route: "materializedScanner.compactChartPreview",
    severity: "contrato-compacto",
    description: "chartPreview privado produce {date, close, volume} descendente; contrato define {date, close, sma50, sma200, volume} ascendente.",
    adrQuote: "`chartPreview`",
    adrSection: "§4.6",
  },
  {
    id: "DIVERG-DOC #5",
    signal: "normalizeBars",
    route: "researchRow.buildResearchRow",
    severity: "defensa-barata",
    description: "normalizeBars ausente en Ruta A; presente en materializedScanner.",
    adrQuote: "`normalizeBars`",
    adrSection: "§4.7",
  },
  {
    id: "DIVERG-DOC #6",
    signal: "minBarsGate",
    route: "materializedScanner.baseRejectReason",
    severity: "politica-seleccion",
    description: "Gate de 180 barras como política de selección en cron; Ruta A exige 20 (mínimo técnico) y 180 solo con requireLongHistory=true.",
    adrQuote: "Gate de barras",
    adrSection: "§4.8",
  },
  {
    id: "DIVERG-DOC #7",
    signal: "chartEstimated",
    route: "materializedScanner_build",
    severity: "defensa-barata",
    description: "Ruta C rechaza charts no decision-grade en el ensamblado y expone chartEstimated=false; la unificación estructural del builder queda para fase 2.",
    adrQuote: "**`chartEstimated`**",
    adrSection: "§4.1",
  },
  {
    id: "DIVERG-DOC #8",
    signal: "sectorScore/rsPercentile",
    route: "materializedScanner.sectorize/leaderboards",
    severity: "fiabilidad-estadistica",
    description: "El cron calcula percentiles por lote local; los leaderboards conservan filas batch, exponen su scope, lo comunican y priorizan final solo en empates. La corrección estructural queda para fase 3.",
    adrQuote: "Percentiles por lote en leaderboards",
    adrSection: "§4.9",
  },
]);

/**
 * Divergencias PENDIENTES — detectadas por el audit, NO respaldadas por el
 * ADR. Cada una tiene:
 *   - id: identificador único que aparece literal en el Markdown.
 *   - routes: array de rutas donde ocurre.
 *   - signal: nombre de la señal afectada (o null si no aplica).
 *   - evidence: archivo:línea aproximado.
 *   - impact: descripción del impacto observable.
 *   - status: "pendiente-de-decision-humana".
 *   - adrQuote: texto literal que DEBE aparecer en el ADR. Si el ADR lo
 *               contiene, el test advierte (no falla) y la divergencia puede
 *               pasar a DIVERGENCE_DOC. Si NO lo contiene, sigue siendo
 *               pendiente.
 *
 * El test verifica que cada DIVERGENCE_PENDING:
 *   - Aparece en la matriz con kind correcto.
 *   - Aparece literal en el Markdown §X.
 *   - NO está clasificada como DIVERGENCE_DOC en la matriz.
 *
 * Si CAMINO A tiene alguna divergencia pendiente, el estado global es
 * "pendiente" y Camino A no puede declararse listo para cierre.
 */
export const PENDING_DIVERGENCES = Object.freeze([]);

/**
 * Pesos del composite — para validación de la suma.
 * Esta función expone la verificación de pesos que el test debe hacer.
 */
export function compositeWeightsCheck() {
  const sum = COMPOSITE_WEIGHTS.reduce((acc, w) => acc + w.weight, 0);
  // La invariante NO es que los pesos declarados sumen 1.0 —desde que el
  // término IPO salió del composite (2026-08-15) suman 0.98—, sino que el
  // motor renormalice sobre esa suma y conserve la escala 0-100. Con todos los
  // términos al mismo valor, el composite tiene que devolver ese valor.
  const scaleTop = computeComposite(Object.fromEntries(COMPOSITE_WEIGHTS.map(({ key }) => [key, 100])));
  return {
    weights: COMPOSITE_WEIGHTS,
    sum,
    scaleTop,
    expectedScaleTop: 100,
    ok: Math.abs(scaleTop - 100) < 1e-9,
  };
}

/**
 * Valida que el inventario del registry coincide con la matriz de
 * equivalencia. Si alguien añade una señal al registry sin añadirla a
 * la matriz (o viceversa), esto falla.
 */
export function validateMatrixCoverage() {
  const inv = registryInventory();
  const allKeys = new Set([...inv.positives, ...inv.negatives]);
  const matrixKeys = new Set();
  for (const route of Object.values(EQUIVALENCE_MATRIX)) {
    for (const key of Object.keys(route)) {
      matrixKeys.add(key);
    }
  }
  const missingInMatrix = [...allKeys].filter((k) => !matrixKeys.has(k));
  const extraInMatrix = [...matrixKeys].filter((k) => !allKeys.has(k));
  return {
    registryCount: allKeys.size,
    matrixCount: matrixKeys.size,
    missingInMatrix,
    extraInMatrix,
    ok: missingInMatrix.length === 0 && extraInMatrix.length === 0,
  };
}

/**
 * Renderiza el contrato Markdown a partir de la fuente estructurada.
 * El archivo docs/audit-score-coherence-contract.md debe coincidir EXACTAMENTE
 * con la salida de esta función. El test verifica la igualdad byte-a-byte.
 *
 * Si cambias la matriz o las divergencias, regenera el archivo ejecutando
 *   node -e "import('./tests/_audit_contract.js').then(m => require('fs').writeFileSync('docs/audit-score-coherence-contract.md', m.renderContractMarkdown()))"
 */
export function renderContractMarkdown() {
  const inv = registryInventory();
  const status = auditGlobalStatus();
  const lines = [];

  // Header
  lines.push("# Contrato de auditoría — Equivalencia de las 18 señales entre las 3 rutas");
  lines.push("");
  lines.push("- **Versión:** 4.0.0");
  lines.push("- **Fecha:** 2026-07-15");
  lines.push("- **Rama:** `codex/statsedge-ui-polish`");
  lines.push(`- **Estado:** Camino A — base auditable, **NO cerrado** (${status.message})`);
  lines.push("- **Alcance:** inventario, trazabilidad y equivalencia NUMÉRICA de las 18 señales del");
  lines.push("  `SIGNAL_REGISTRY` (17 positivas + 1 negativa) entre las tres rutas reales del sistema:");
  lines.push("    1. `lib/researchRow.js` → `buildResearchRow` (camino cliente + `/api/scan`).");
  lines.push("    2. `lib/screenerPipeline.js` → `sectorize` (composite por universo).");
  lines.push("    3. `lib/materializedScanner.js` → `buildResearchRow` privado + `sectorize` privado (cron).");
  lines.push("- **Auditoría automática:** `tests/signalRegistryAudit.test.js`.");
  lines.push("- **Fuente estructurada única:** `tests/_audit_contract.js`. Este documento se GENERA desde esa fuente.");
  lines.push("- **Golden snapshot independiente:** `tests/_golden_snapshot_scoring.js`.");
  lines.push("");

  // Estado global
  lines.push("## 0. Estado global del audit");
  lines.push("");
  lines.push(`- **Divergencias aceptadas (DIVERG-DOC):** ${ACCEPTED_DIVERGENCES.length}`);
  lines.push(`- **Divergencias pendientes (DIVERG-PENDIENTE):** ${PENDING_DIVERGENCES.length}`);
  lines.push(`- **Listo para cierre formal:** ${status.isReadyForClosure ? "SÍ" : "NO"}`);
  lines.push(`- **Mensaje:** ${status.message}`);
  lines.push("");

  // Limitaciones
  lines.push("> ⚠️ **Seam de Ruta C:** `lib/materializedScanner.js` exporta `_forTest = { buildResearchRow, sectorize }`");
  lines.push("> como cambio estrictamente no funcional (17 líneas adicionales). Verificar visualmente y hard-reload");
  lines.push("> antes de commit; no altera JSX ni comportamiento de producción.");
  lines.push("");
  lines.push(`> ⚠️ **Conteo del registry:** ${inv.positives.length} positives + ${inv.negatives.length} negative = ${inv.total} total.`);
  lines.push("> El brief original decía 20 (19+weaknessScore); el código tiene 18 (17+weaknessScore).");
  lines.push("");

  // Inventario
  lines.push("## 1. Inventario canónico (18 señales)");
  lines.push("");
  lines.push("Fuente: `Object.values(SIGNAL_REGISTRY)` en `lib/scoringEngine.js`.");
  lines.push("");
  lines.push("| # | Key | direction | requiredInputs |");
  lines.push("|---|-----|-----------|----------------|");
  for (const [i, key] of Object.keys(SIGNAL_REGISTRY).entries()) {
    const entry = SIGNAL_REGISTRY[key];
    const dir = entry.direction === "positive" ? "positive" : "**negative**";
    lines.push(`| ${i + 1} | \`${key}\` | ${dir} | ${entry.requiredInputs.length} |`);
  }
  lines.push("");
  lines.push("### Composite (`COMPOSITE_WEIGHTS`)");
  lines.push("");
  lines.push(`Términos = ${COMPOSITE_WEIGHTS.length}. Suma de pesos declarados = ${compositeWeightsCheck().sum}; el motor renormaliza sobre esa suma, y con todos los términos a 100 el composite da ${compositeWeightsCheck().scaleTop} (verificado por \`compositeWeightsCheck()\`).`);
  lines.push("");

  // Tabla de equivalencia por ruta — generada desde la matriz
  lines.push("## 2. Tabla de equivalencia por ruta (matriz canónica)");
  lines.push("");
  lines.push("Cada celda (señal × ruta) tiene un `kind`: `EQUIVALENT`, `EQUIVALENT_ADAPT`, `DIVERGENCE_DOC`, `DIVERGENCE_PENDING` o `NOT_APPLICABLE`.");
  lines.push("");
  lines.push("### Ruta A — `lib/researchRow.js · buildResearchRow`");
  lines.push("");
  lines.push("| Señal | kind | evidence |");
  lines.push("|-------|------|----------|");
  for (const [signal, entry] of Object.entries(EQUIVALENCE_MATRIX.researchRow)) {
    lines.push(`| \`${signal}\` | ${entry.kind} | ${entry.evidence} |`);
  }
  lines.push("");
  lines.push("### Ruta B — `lib/screenerPipeline.js · sectorize`");
  lines.push("");
  lines.push("| Señal | kind | evidence |");
  lines.push("|-------|------|----------|");
  for (const [signal, entry] of Object.entries(EQUIVALENCE_MATRIX.screenerPipeline)) {
    lines.push(`| \`${signal}\` | ${entry.kind} | ${entry.evidence} |`);
  }
  lines.push("");
  lines.push("### Ruta C — `lib/materializedScanner.js · buildResearchRow` (privado, vía seam `_forTest`)");
  lines.push("");
  lines.push("| Señal | kind | evidence |");
  lines.push("|-------|------|----------|");
  for (const [signal, entry] of Object.entries(EQUIVALENCE_MATRIX.materializedScanner_build)) {
    lines.push(`| \`${signal}\` | ${entry.kind} | ${entry.evidence} |`);
  }
  lines.push("");
  lines.push("### Ruta C — `lib/materializedScanner.js · sectorize` (privado, vía seam `_forTest`)");
  lines.push("");
  lines.push("| Señal | kind | evidence |");
  lines.push("|-------|------|----------|");
  for (const [signal, entry] of Object.entries(EQUIVALENCE_MATRIX.materializedScanner_sectorize)) {
    lines.push(`| \`${signal}\` | ${entry.kind} | ${entry.evidence} |`);
  }
  lines.push("");

  // Divergencias aceptadas
  lines.push("## 3. Divergencias aceptadas (DIVERG-DOC, con respaldo literal en el ADR)");
  lines.push("");
  lines.push("| ID | Severidad | Descripción | ADR § | Cita literal |");
  lines.push("|----|-----------|-------------|-------|--------------|");
  for (const div of ACCEPTED_DIVERGENCES) {
    const desc = div.description.replace(/\|/g, "\\|");
    const quote = div.adrQuote.replace(/\|/g, "\\|");
    lines.push(`| ${div.id} | ${div.severity} | ${desc} | ${div.adrSection} | \`${quote}\` |`);
  }
  lines.push("");

  // Divergencias pendientes
  lines.push("## 4. Divergencias pendientes (DIVERG-PENDIENTE, pendientes de decisión humana)");
  lines.push("");
  lines.push("Estas divergencias fueron detectadas por la auditoría pero **NO están respaldadas por el ADR**.");
  lines.push("Permanecen en estado pendiente hasta que:");
  lines.push("(a) se añada respaldo explícito al ADR y pasen a DIVERG-DOC; o");
  lines.push("(b) se decida que no son divergencias y se retiren; o");
  lines.push("(c) se cierre Camino A asumiéndolas como decisiones humanas.");
  lines.push("");
  lines.push("| ID | Rutas | Señal | Evidencia | Impacto | Estado |");
  lines.push("|----|-------|-------|-----------|---------|--------|");
  for (const div of PENDING_DIVERGENCES) {
    const routes = div.routes.join(", ");
    const ev = div.evidence.replace(/\|/g, "\\|");
    const im = div.impact.replace(/\|/g, "\\|");
    lines.push(`| ${div.id} | \`${routes}\` | \`${div.signal}\` | ${ev} | ${im} | ${div.status} |`);
  }
  lines.push("");
  lines.push("**Consecuencia:** mientras existan DIVERG-PENDIENTE, el estado global es \"pendiente de decisión humana\" y Camino A NO puede cerrarse formalmente.");
  lines.push("");

  // Reglas
  lines.push("## 5. Reglas que el audit enforza");
  lines.push("");
  lines.push("1. **Registry ↔ matriz:** las claves de `SIGNAL_REGISTRY` coinciden con `EQUIVALENCE_MATRIX[*]`.");
  lines.push("2. **Escala del composite:** con todos los términos de `COMPOSITE_WEIGHTS` al mismo valor, `computeComposite` devuelve ese valor (real). No se exige que los pesos declarados sumen 1.0: suman 0.98 y el motor renormaliza.");
  lines.push("3. **Equivalencia numérica:** para cada celda EQUIVALENT/EQUIVALENT_ADAPT, el valor post-ruta === `computeSignal(row, key).value`.");
  lines.push("4. **Override rule:** adProxy/epsGrowthProxy se preservan si finitos; fallback al canon si no.");
  lines.push("5. **DIVERGENCE_DOC:** cada cita literal debe aparecer en el ADR.");
  lines.push("6. **Golden snapshot:** cada `computeSignal(signal)` en fila completa === función snapshot pre-consolidación.");
  lines.push("   La excepción histórica de `patternContributionScore` queda corregida y el override `r.patternContribution` se conserva.");
  lines.push("7. **Sincronización Markdown ↔ matriz:** el archivo `docs/audit-score-coherence-contract.md` debe coincidir EXACTAMENTE con la salida de `renderContractMarkdown()`.");

  lines.push("8. **Estado global:** `auditGlobalStatus().pendingCount === PENDING_DIVERGENCES.length`.");
  lines.push("");

  // Cómo extender
  lines.push("## 6. Cómo extender este contrato");
  lines.push("");
  lines.push("1. Si añades una señal al `SIGNAL_REGISTRY`: actualiza la matriz, regenera el Markdown con `renderContractMarkdown()`.");
  lines.push("2. Si eliminas: retírala de registry + matriz.");
  lines.push("3. Si renombras: propágalo a todos los lugares. El test `validateMatrixCoverage` rompe con mensaje accionable.");
  lines.push("4. Si añades una DIVERG-DOC: ponla en `ACCEPTED_DIVERGENCES` con cita literal del ADR; regenera el Markdown.");
  lines.push("5. Si detectas una nueva divergencia sin respaldo del ADR: ponla en `PENDING_DIVERGENCES`; el estado global pasa a \"pendiente\".");
  lines.push("");

  // Out of scope
  lines.push("## 7. Lo que este contrato NO hace");
  lines.push("");
  lines.push("- No audita `COMPOSITE_WEIGHTS` semánticamente (las 11 claves). Solo la escala.");
  lines.push("- No audita `scoreWeakness` semánticamente (umbrales).");
  lines.push("- No audita la capa de fetch ni el contrato compacto.");
  lines.push("- No audita `scoreCompositeValue`.");
  lines.push("- **No declara Camino A cerrado.** Esta base auditable es prerrequisito de la validación humana posterior.");
  lines.push("");

  return lines.join("\n") + "\n";
}