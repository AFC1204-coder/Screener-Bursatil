// lib/weeklyChanges.js — «qué ha cambiado esta semana», la parte calculable.
//
// Responde la pregunta del usuario semanal (docs/analisis-friccion-2026-08-15.md
// A1/D11.1) con el diseño aprobado en docs/diseno-que-cambio-2026-08-16.md:
// dos escaneos nocturnos del universo estadounidense comparados símbolo a
// símbolo. Este módulo es puro (sin red, sin Supabase): la ruta
// app/api/weekly-changes/route.js trae los datos y delega aquí la elección de
// la pareja de escaneos y el cálculo de los cambios.
//
// Por qué la fuente es el par de nocturnos y no scan_symbol_history: la tabla
// de historia sigue alimentada solo por los crones rotatorios no
// estadounidenses (medido 2026-08-23: 0-4 filas US por noche frente a ~3.300
// símbolos del nocturno). La ruta lo comprueba en cada corrida
// (historyCoverage) y este módulo decide con ese dato: el día que la historia
// cubra el universo, la migración será deliberada, no silenciosa.

// ── El corte de criterio de etapa ──────────────────────────────────────────
// El nocturno reclasificó la etapa con el criterio estricto el 17 de agosto de
// 2026: el escaneo de la madrugada del 17 aún emite el vocabulario anterior
// (`base` 1.032 filas · `mixed` 373), y el del 18 ya solo emite
// `stage1..stage4` (medido sobre producción, 2026-08-23). Comparar un escaneo
// posterior con uno anterior al corte contaría como «cambio de etapa» lo que
// solo es un cambio de criterio, así que el primer escaneo comparable es el
// del 18 de agosto.
export const STAGE_CRITERIA_CUTOVER_SCAN_DATE = "2026-08-18";

// Vocabulario del criterio anterior. Si un lado de la comparación lo emite en
// proporción apreciable y el otro no, los criterios difieren aunque las
// fechas digan lo contrario (guardia para futuros cambios sin anotar).
const LEGACY_STAGE_STATES = new Set(["base", "mixed"]);
const LEGACY_VOCABULARY_MIN_SHARE = 0.01;

// ── Umbrales del desglose de máximos de 52 semanas ─────────────────────────
// `distance52w` es la distancia del cierre al máximo de 52 semanas en
// porcentaje, siempre ≤ 0 (lib/materializedScanner.js:highDist; la leyenda de
// la columna: «0% es estar en máximos»).
//   - En zona de máximo: cierre a menos del 1% del máximo (d52 ≥ −1).
//   - «Ya estaba cerca»: al inicio de la ventana cotizaba a menos del 5%
//     (d52 ancla ≥ −5). «Nuevo» = llegó a la zona viniendo de más lejos.
export const AT_HIGH_MIN_D52 = -1;
export const NEAR_HIGH_MIN_D52 = -5;

const STAGE2 = "stage2";
const CLASSIFIED_STAGE = /^stage[1-4]$/;

// Mercados estadounidenses tal como aparecen en scan_symbol_history.mic_code.
// Solo para medir la cobertura de la historia; el nocturno ya es solo US.
export const US_MIC_CODES = ["XNYS", "XNGS", "XNCM", "XNMS", "XASE", "ARCX", "BATS"];

// ── Fechas (siempre "YYYY-MM-DD" tratadas como UTC) ────────────────────────

const DAY_MS = 86400000;
const DAY_WORDS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTH_WORDS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function utcDate(dateText = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateText || ""));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isFinite(date.getTime()) ? date : null;
}

function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

/** "2026-08-17" → "lun 17 ago". Tabla propia: sin depender del ICU del entorno. */
export function formatDayLabel(dateText = "") {
  const date = utcDate(dateText);
  if (!date) return "";
  return `${DAY_WORDS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_WORDS[date.getUTCMonth()]}`;
}

/** Lunes (ISO) de la semana de la fecha dada, como "YYYY-MM-DD". */
export function mondayOf(dateText = "") {
  const date = utcDate(dateText);
  if (!date) return null;
  const shift = (date.getUTCDay() + 6) % 7;
  return isoOf(new Date(date.getTime() - shift * DAY_MS));
}

/**
 * Último día hábil (lun-vie) ESTRICTAMENTE anterior a la fecha dada. Es la
 * estimación de la fecha de barras de un nocturno que corre de madrugada; los
 * festivos estadounidenses no están modelados (la ruta corrige después con la
 * fecha real de las barras, `lastDate`).
 */
export function previousTradingDayEstimate(dateText = "") {
  const date = utcDate(dateText);
  if (!date) return null;
  let cursor = new Date(date.getTime() - DAY_MS);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return isoOf(cursor);
}

/** "materialized:US:2026-08-23:t040159:o0:l5610" → "2026-08-23". */
export function scanDateFromLocalId(localId = "") {
  const match = /^materialized:US:(\d{4}-\d{2}-\d{2})/.exec(String(localId || ""));
  return match ? match[1] : null;
}

// ── Elección de la pareja de escaneos ──────────────────────────────────────

/**
 * Dada la lista de nocturnos retenidos (metas: {id, localId, createdAt}),
 * elige el escaneo actual y el ancla de la ventana semanal.
 *
 * Regla, en orden:
 *   1. Actual = el nocturno más reciente.
 *   2. Ancla preferida = el nocturno homogéneo (fecha ≥ corte de criterio) más
 *      reciente cuya fecha de barras estimada caiga en una semana ISO anterior
 *      a la del actual — «el último cierre de semana completado» del diseño.
 *   3. Si no existe, el homogéneo más antiguo con barras anteriores a las del
 *      actual: la ventana más larga que se puede afirmar, declarada parcial.
 *   4. Si ni eso, no hay comparación — con su motivo, nunca con un cero.
 */
export function pickComparisonPair(scanMetas = [], { cutoverScanDate = STAGE_CRITERIA_CUTOVER_SCAN_DATE } = {}) {
  const metas = (Array.isArray(scanMetas) ? scanMetas : [])
    .map((meta) => {
      const scanDate = scanDateFromLocalId(meta?.localId);
      if (!scanDate) return null;
      return { ...meta, scanDate, dataAsOfEstimate: previousTradingDayEstimate(scanDate) };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  if (!metas.length) return { current: null, anchor: null, reason: "no-nightly-scans" };

  // Un solo escaneo por fecha: si una noche tiene dos corridas, vale la última.
  const byDate = new Map();
  for (const meta of metas) {
    if (!byDate.has(meta.scanDate)) byDate.set(meta.scanDate, meta);
  }
  const deduped = [...byDate.values()];
  const current = deduped[0];

  const hasPreCutoverScans = deduped.some((meta) => meta.scanDate < cutoverScanDate);
  const candidates = deduped.filter((meta) => (
    meta !== current
    && meta.scanDate >= cutoverScanDate
    && meta.dataAsOfEstimate
    && current.dataAsOfEstimate
    && meta.dataAsOfEstimate < current.dataAsOfEstimate
  ));

  if (!candidates.length) {
    return {
      current,
      anchor: null,
      reason: hasPreCutoverScans ? "only-pre-cutover-anchors" : "single-comparable-scan",
    };
  }

  const currentWeek = mondayOf(current.dataAsOfEstimate);
  const previousWeekCandidates = candidates
    .filter((meta) => mondayOf(meta.dataAsOfEstimate) < currentWeek)
    .sort((a, b) => b.dataAsOfEstimate.localeCompare(a.dataAsOfEstimate));

  if (previousWeekCandidates.length) {
    return {
      current,
      anchor: previousWeekCandidates[0],
      anchorPolicy: "previous-week-close",
      partialWeek: false,
      partialReason: null,
    };
  }

  const oldest = [...candidates].sort((a, b) => a.dataAsOfEstimate.localeCompare(b.dataAsOfEstimate))[0];
  return {
    current,
    anchor: oldest,
    anchorPolicy: "oldest-homogeneous",
    partialWeek: true,
    // Si hay escaneos retenidos anteriores al corte, la ventana está acotada
    // por el cambio de criterio; si no, por la retención de nocturnos.
    partialReason: hasPreCutoverScans ? "stage-criteria-cutover" : "retention",
  };
}

// ── Cálculo de los cambios ─────────────────────────────────────────────────

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row = {}) {
  const symbol = String(row.symbol || "").trim().toUpperCase();
  if (!symbol) return null;
  const stage = String(row.stage || "").trim().toLowerCase() || null;
  return {
    symbol,
    stage,
    d52: finiteOrNull(row.d52),
    name: String(row.name || row.company_name || "").trim() || null,
    theme: String(row.theme || "").trim() || null,
    lastDate: String(row.lastDate || "").slice(0, 10) || null,
  };
}

export function normalizeScanRows(rows = []) {
  const bySymbol = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizeRow(raw);
    if (row) bySymbol.set(row.symbol, row);
  }
  return bySymbol;
}

function isClassifiedStage(stage) {
  return typeof stage === "string" && CLASSIFIED_STAGE.test(stage);
}

/** Fecha real de las barras de un escaneo: la última fecha vista en sus filas. */
export function dataAsOfFromRows(bySymbol) {
  let max = null;
  for (const row of bySymbol.values()) {
    if (row.lastDate && (!max || row.lastDate > max)) max = row.lastDate;
  }
  return max;
}

/**
 * ¿Emiten los dos lados el mismo vocabulario de etapa? Si un lado trae
 * `base`/`mixed` en proporción apreciable y el otro no, los criterios
 * difieren y compararlos fabricaría transiciones falsas.
 */
export function stageVocabularyIncompatible(anchorBySymbol, currentBySymbol) {
  const legacyShare = (bySymbol) => {
    let legacy = 0;
    let classified = 0;
    for (const row of bySymbol.values()) {
      if (!row.stage) continue;
      if (LEGACY_STAGE_STATES.has(row.stage)) legacy += 1;
      if (LEGACY_STAGE_STATES.has(row.stage) || isClassifiedStage(row.stage)) classified += 1;
    }
    return classified ? legacy / classified : 0;
  };
  const anchorLegacy = legacyShare(anchorBySymbol) > LEGACY_VOCABULARY_MIN_SHARE;
  const currentLegacy = legacyShare(currentBySymbol) > LEGACY_VOCABULARY_MIN_SHARE;
  return anchorLegacy !== currentLegacy;
}

function changeRow(anchorRow, currentRow) {
  return {
    symbol: currentRow.symbol,
    name: currentRow.name,
    theme: currentRow.theme,
    stageFrom: anchorRow.stage,
    stageTo: currentRow.stage,
    d52Now: currentRow.d52,
    d52Anchor: anchorRow.d52,
  };
}

/**
 * El delta entre dos escaneos, símbolo a símbolo. Solo describe: entradas y
 * salidas de etapa 2 entre pares clasificados en ambos cortes, y el desglose
 * de la zona de máximos de 52 semanas. Los símbolos presentes en un solo
 * escaneo no cuentan como cambios (no hay con qué compararlos) y se devuelven
 * aparte para que la superficie los declare.
 */
export function computeWeeklyChanges(anchorBySymbol, currentBySymbol, {
  atHighMinD52 = AT_HIGH_MIN_D52,
  nearHighMinD52 = NEAR_HIGH_MIN_D52,
} = {}) {
  const stage2Entries = [];
  const stage2Exits = [];
  const newHighs = [];
  const alreadyNearHighs = [];
  const atHighNoAnchor = [];
  let paired = 0;
  let stagePairs = 0;
  let d52Pairs = 0;
  let atHighNow = 0;

  for (const currentRow of currentBySymbol.values()) {
    const anchorRow = anchorBySymbol.get(currentRow.symbol);
    if (!anchorRow) continue;
    paired += 1;

    if (isClassifiedStage(anchorRow.stage) && isClassifiedStage(currentRow.stage)) {
      stagePairs += 1;
      if (anchorRow.stage !== STAGE2 && currentRow.stage === STAGE2) stage2Entries.push(changeRow(anchorRow, currentRow));
      else if (anchorRow.stage === STAGE2 && currentRow.stage !== STAGE2) stage2Exits.push(changeRow(anchorRow, currentRow));
    }

    if (currentRow.d52 !== null && anchorRow.d52 !== null) d52Pairs += 1;
    if (currentRow.d52 !== null && currentRow.d52 >= atHighMinD52) {
      atHighNow += 1;
      if (anchorRow.d52 === null) atHighNoAnchor.push(changeRow(anchorRow, currentRow));
      else if (anchorRow.d52 >= nearHighMinD52) alreadyNearHighs.push(changeRow(anchorRow, currentRow));
      else newHighs.push(changeRow(anchorRow, currentRow));
    }
  }

  const enteredCoverage = [];
  for (const symbol of currentBySymbol.keys()) {
    if (!anchorBySymbol.has(symbol)) enteredCoverage.push(symbol);
  }
  const leftCoverage = [];
  for (const symbol of anchorBySymbol.keys()) {
    if (!currentBySymbol.has(symbol)) leftCoverage.push(symbol);
  }

  return {
    population: {
      current: currentBySymbol.size,
      anchor: anchorBySymbol.size,
      paired,
      stagePairs,
      d52Pairs,
      enteredCoverage: enteredCoverage.length,
      leftCoverage: leftCoverage.length,
    },
    stage2: { entries: stage2Entries, exits: stage2Exits },
    highs: {
      atHighNow,
      newThisWindow: newHighs,
      alreadyNear: alreadyNearHighs,
      noAnchor: atHighNoAnchor,
      thresholds: { atHighMinD52, nearHighMinD52 },
    },
  };
}

// ── Vocabulario de presentación ────────────────────────────────────────────

const STAGE_WORDS = {
  stage1: "etapa 1",
  stage2: "etapa 2",
  stage3: "etapa 3",
  stage4: "etapa 4",
  base: "base",
  mixed: "mixto",
  insufficient_history: "sin histórico suficiente",
};

/** "stage2" → "etapa 2". Para estados desconocidos, el propio texto. */
export function stageWord(stage) {
  const key = String(stage || "").trim().toLowerCase();
  return STAGE_WORDS[key] || (key || "sin clasificar");
}
