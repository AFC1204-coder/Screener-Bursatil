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

// ── Semanas cerradas (viernes a viernes) ───────────────────────────────────
//
// Auditoría de producto 2026-11, D1/D2: la etapa oficial se calcula sobre
// semanas CERRADAS y «qué cambió» compara viernes con viernes. Una semana está
// cerrada para un escaneo cuando el escaneo corrió después de su viernes
// (sábado o más tarde, en UTC): misma regla que lib/weeklyStage.js
// (`isWeekClosed`), aplicada con la fecha del nocturno como referencia.

/** Viernes de la semana ISO de la fecha dada. */
export function fridayOf(dateText = "") {
  const monday = mondayOf(dateText);
  if (!monday) return null;
  return isoOf(new Date(utcDate(monday).getTime() + 4 * DAY_MS));
}

function addDaysIso(dateText, days) {
  const date = utcDate(dateText);
  return date ? isoOf(new Date(date.getTime() + days * DAY_MS)) : null;
}

/**
 * Viernes de la última semana cerrada para un escaneo con barras hasta
 * `dataAsOf` que corrió el día `referenceDate`. Si el escaneo corrió después
 * del viernes de la semana de sus barras, esa semana está cerrada; si no, la
 * última cerrada es la anterior.
 */
export function closedWeekEndFor(dataAsOf = "", referenceDate = "") {
  const friday = fridayOf(dataAsOf);
  if (!friday) return null;
  if (referenceDate && String(referenceDate).slice(0, 10) > friday) return friday;
  return addDaysIso(friday, -7);
}

// Tolerancia del ancla: sus barras pueden acabar hasta 2 días antes del
// viernes objetivo (viernes festivo → jueves; cierre excepcional de dos días →
// miércoles), nunca después. Una ancla con barras de la semana siguiente no es
// «el cierre del viernes», y una con barras de la semana anterior compararía
// dos semanas: en ambos casos no hay par.
export const WEEKLY_ANCHOR_TOLERANCE_DAYS = 2;

function timeOf(value) {
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

// ── Elección de la pareja de escaneos ──────────────────────────────────────

/**
 * Dada la lista de nocturnos retenidos (metas: {id, localId, createdAt}),
 * elige el escaneo MOSTRADO y su ancla de hace una semana cerrada.
 *
 * Regla (D2, auditoría 2026-11):
 *   1. Actual = el escaneo que el screener está mostrando (`currentLocalId`).
 *      Sin él, el nocturno más reciente por fecha real de creación. Si el
 *      mostrado no está entre los nocturnos publicables, no hay par.
 *   2. Semana del actual = la última semana cerrada a la fecha del escaneo
 *      (`closedWeekEndFor`). Objetivo del ancla = ese viernes − 7 días.
 *   3. Ancla = un nocturno homogéneo (fecha ≥ corte de criterio) cuya última
 *      semana cerrada sea exactamente la del objetivo y cuyas barras acaben
 *      entre objetivo − tolerancia y el objetivo. Entre varios, el de barras
 *      más recientes y, a igualdad, el que corrió antes (el más pegado al
 *      cierre del viernes).
 *   4. Si no hay ancla, no hay comparación — con su motivo, nunca con un cero.
 * Las fechas de barras aquí son estimadas (`previousTradingDayEstimate`); la
 * ruta las verifica con la fecha real de las filas antes de dar cifras.
 */
export function pickComparisonPair(scanMetas = [], {
  cutoverScanDate = STAGE_CRITERIA_CUTOVER_SCAN_DATE,
  currentLocalId = "",
  toleranceDays = WEEKLY_ANCHOR_TOLERANCE_DAYS,
} = {}) {
  const metas = (Array.isArray(scanMetas) ? scanMetas : [])
    .map((meta) => {
      const scanDate = scanDateFromLocalId(meta?.localId);
      if (!scanDate) return null;
      const dataAsOfEstimate = previousTradingDayEstimate(scanDate);
      return {
        ...meta,
        scanDate,
        dataAsOfEstimate,
        closedWeekEnd: closedWeekEndFor(dataAsOfEstimate, scanDate),
        createdAtMs: timeOf(meta?.createdAt),
      };
    })
    .filter(Boolean)
    // Por instante real: `createdAt` puede llegar como Date (adaptador pg) y
    // ordenar su texto («Wed Oct 14…») elegía como «actual» el miércoles.
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  if (!metas.length) return { current: null, anchor: null, reason: "no-nightly-scans" };

  // Un solo escaneo por fecha: si una noche tiene dos corridas, vale la última.
  const byDate = new Map();
  for (const meta of metas) {
    if (!byDate.has(meta.scanDate)) byDate.set(meta.scanDate, meta);
  }
  const deduped = [...byDate.values()];

  let current = deduped[0];
  if (currentLocalId) {
    current = metas.find((meta) => meta.localId === currentLocalId) || null;
    if (!current) return { current: null, anchor: null, reason: "displayed-scan-not-nightly" };
  }

  const currentWeekEnd = current.closedWeekEnd;
  const anchorWeekEnd = currentWeekEnd ? addDaysIso(currentWeekEnd, -7) : null;
  const earliestAnchorData = anchorWeekEnd ? addDaysIso(anchorWeekEnd, -toleranceDays) : null;
  const base = { current, currentWeekEnd, anchorWeekEnd, anchorPolicy: "weekly-close", partialWeek: false, partialReason: null };

  const matchesTarget = (meta) => (
    meta !== current
    && meta.localId !== current.localId
    && meta.createdAtMs < current.createdAtMs
    && meta.closedWeekEnd === anchorWeekEnd
    && meta.dataAsOfEstimate
    && meta.dataAsOfEstimate <= anchorWeekEnd
    && meta.dataAsOfEstimate >= earliestAnchorData
  );
  const onTarget = anchorWeekEnd ? deduped.filter(matchesTarget) : [];
  const candidates = onTarget
    .filter((meta) => meta.scanDate >= cutoverScanDate)
    .sort((a, b) => (
      b.dataAsOfEstimate.localeCompare(a.dataAsOfEstimate) || a.createdAtMs - b.createdAtMs
    ));

  if (!candidates.length) {
    return {
      ...base,
      anchor: null,
      reason: onTarget.length ? "only-pre-cutover-anchors" : "no-weekly-anchor",
    };
  }
  return { ...base, anchor: candidates[0] };
}

/**
 * Verificación con las fechas REALES de barras (máximo `lastDate` de las
 * filas): el par sigue siendo viernes a viernes. Devuelve el motivo si no.
 */
export function verifyWeeklyPair({ current, anchor, currentAsOf, anchorAsOf, toleranceDays = WEEKLY_ANCHOR_TOLERANCE_DAYS } = {}) {
  if (!current || !anchor || !currentAsOf || !anchorAsOf) return { ok: false, reason: "no-sessions-between-scans" };
  if (anchorAsOf >= currentAsOf) return { ok: false, reason: "no-sessions-between-scans" };
  const currentWeekEnd = closedWeekEndFor(currentAsOf, current.scanDate);
  const anchorWeekEnd = currentWeekEnd ? addDaysIso(currentWeekEnd, -7) : null;
  const anchorClosed = closedWeekEndFor(anchorAsOf, anchor.scanDate);
  const inTolerance = anchorWeekEnd
    && anchorAsOf <= anchorWeekEnd
    && anchorAsOf >= addDaysIso(anchorWeekEnd, -toleranceDays);
  if (!inTolerance || anchorClosed !== anchorWeekEnd) return { ok: false, reason: "anchor-outside-tolerance", currentWeekEnd, anchorWeekEnd };
  return { ok: true, currentWeekEnd, anchorWeekEnd };
}

/**
 * ¿La etapa guardada en el escaneo mostrado es la oficial (semanas cerradas)?
 *   - Filas escritas con D1 llevan `weeklyStageWeekStart`: oficial.
 *   - Filas anteriores: solo si la semana de sus barras ya estaba cerrada al
 *     correr el escaneo (sábado/domingo/lunes), porque entonces «semana en
 *     curso» y «semana cerrada» coinciden. Entre semana, esas filas llevan
 *     la etapa provisional antigua y no sirven para contar entradas.
 */
export function displayedStageIsOfficial(bySymbol, { dataAsOf = "", scanDate = "" } = {}) {
  for (const row of bySymbol.values()) {
    if (row.stageWeekStart) return true;
  }
  const friday = fridayOf(dataAsOf);
  return Boolean(friday && scanDate && String(scanDate).slice(0, 10) > friday);
}

// ── Cálculo de los cambios ─────────────────────────────────────────────────

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metricsObject(row = {}) {
  const metrics = row.metrics;
  if (metrics && typeof metrics === "object" && !Array.isArray(metrics)) return metrics;
  if (typeof metrics === "string") {
    try {
      const parsed = JSON.parse(metrics);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeRow(row = {}) {
  const symbol = String(row.symbol || "").trim().toUpperCase();
  if (!symbol) return null;
  const metrics = metricsObject(row);
  const stage = String(row.stage || metrics.weeklyStageState || "").trim().toLowerCase() || null;
  return {
    symbol,
    stage,
    d52: finiteOrNull(row.d52 ?? metrics.distance52w),
    name: String(row.name || row.company_name || "").trim() || null,
    theme: String(row.theme || "").trim() || null,
    lastDate: String(row.lastDate || metrics.lastDate || "").slice(0, 10) || null,
    stageWeekStart: String(row.stageWeekStart || metrics.weeklyStageWeekStart || "").slice(0, 10) || null,
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

/**
 * Contrato D2: una «entrada en E2» ESTÁ en etapa 2 en el escaneo mostrado y
 * una «salida» NO lo está. Filtra lo que no cumpla (no debería haber nada si
 * el actual es el mostrado) y devuelve cuántas filas se descartaron.
 */
export function validateAgainstDisplayed(changes, displayedBySymbol) {
  const stageOf = (symbol) => displayedBySymbol?.get?.(symbol)?.stage ?? null;
  const entries = changes.stage2.entries.filter((row) => stageOf(row.symbol) === STAGE2);
  const exits = changes.stage2.exits.filter((row) => {
    const stage = stageOf(row.symbol);
    return isClassifiedStage(stage) && stage !== STAGE2;
  });
  return {
    ...changes,
    stage2: { entries, exits },
    validation: {
      entriesDropped: changes.stage2.entries.length - entries.length,
      exitsDropped: changes.stage2.exits.length - exits.length,
    },
  };
}

/**
 * Rótulo de la ventana semanal: «Semana 9 → 16 oct» (mismo mes),
 * «Semana 25 sep → 2 oct» (meses distintos), con año si cambia.
 */
export function weeklyWindowLabel(fromDate = "", toDate = "") {
  const from = utcDate(fromDate);
  const to = utcDate(toDate);
  if (!from || !to) return "";
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const sameMonth = sameYear && from.getUTCMonth() === to.getUTCMonth();
  const toText = `${to.getUTCDate()} ${MONTH_WORDS[to.getUTCMonth()]}${sameYear ? "" : ` ${to.getUTCFullYear()}`}`;
  const fromText = sameMonth
    ? `${from.getUTCDate()}`
    : `${from.getUTCDate()} ${MONTH_WORDS[from.getUTCMonth()]}${sameYear ? "" : ` ${from.getUTCFullYear()}`}`;
  return `Semana ${fromText} → ${toText}`;
}

export const WEEKLY_NO_COMPARISON_LABEL = "Sin comparación esta semana";
export const WEEKLY_PENDING_LABEL = "Cambios de la semana";

/**
 * Cabecera del grupo semanal del raíl. Con par válido, las fechas; sin par,
 * «Sin comparación esta semana»; sin respuesta todavía, un rótulo neutro.
 */
export function weeklyHeadingFromPayload(payload = null) {
  if (!payload) return WEEKLY_PENDING_LABEL;
  if (payload.state === "ok") {
    const win = payload.window || {};
    return weeklyWindowLabel(win.fromWeekEnd || win.from, win.toWeekEnd || win.to) || WEEKLY_PENDING_LABEL;
  }
  if (payload.state === "cloud-off") return WEEKLY_PENDING_LABEL;
  return WEEKLY_NO_COMPARISON_LABEL;
}

// ── Vocabulario de presentación ────────────────────────────────────────────

const STAGE_WORDS = {
  stage1: "etapa 1",
  stage2: "etapa 2",
  stage3: "posible etapa 3",
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
