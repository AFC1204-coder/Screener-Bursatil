// Antigüedad de los precios que alimentan un escaneo.
//
// Pura y sin red: se calcula con las filas que el screener ya tiene cargadas
// (campo `lastDate` de cada fila). No añade ninguna petición. Alimenta el aviso
// único del screener (`snapshotNotice`), la frescura que leen el filtro y los
// indicadores (`livePriceFreshness`) y la marca discreta de fila
// (`rowDataAgeMark`). Con datos al día no devuelve nada y la pantalla queda
// igual que antes.

import { priceFreshnessForDate } from "@/lib/dataCoverageShared";

// Días hábiles completos sin cierre a partir de los cuales se avisa. Con 2 se
// toleran un festivo de mercado y la mañana siguiente a un cierre; un retraso
// de dos sesiones ya no es explicable por el calendario.
export const DATA_AGE_MAX_MISSED_WEEKDAYS = 2;

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAY_MS = 86400000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function isoToUtcDay(value) {
  const match = ISO_DAY.exec(String(value || ""));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : null;
}

function utcDayOf(now) {
  const time = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : null;
}

// 1970-01-01 fue jueves. 0 = domingo … 6 = sábado.
function weekdayOfUtcDay(day) {
  return (((day + 4) % 7) + 7) % 7;
}

/** Fecha mediana (YYYY-MM-DD) del último precio de las filas; robusta a unas pocas filas rezagadas. */
export function medianLastDate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const days = [];
  for (const row of rows) {
    const day = isoToUtcDay(rowLastDate(row));
    if (day != null) days.push(day);
  }
  if (days.length === 0) return "";
  days.sort((a, b) => a - b);
  const middle = days[Math.floor(days.length / 2)];
  return new Date(middle * DAY_MS).toISOString().slice(0, 10);
}

/** Días hábiles completos entre el último precio y hoy (ambos extremos excluidos). */
export function missedWeekdays(lastDate, now = new Date()) {
  const last = isoToUtcDay(lastDate);
  const today = utcDayOf(now);
  if (last == null || today == null || today <= last) return 0;
  let missed = 0;
  for (let day = last + 1; day < today; day += 1) {
    const weekday = weekdayOfUtcDay(day);
    if (weekday !== 0 && weekday !== 6) missed += 1;
  }
  return missed;
}

function shortDateEs(isoDate) {
  const match = ISO_DAY.exec(isoDate);
  if (!match) return "";
  return `${Number(match[3])} ${MONTHS_ES[Number(match[2]) - 1]}`;
}

// ── Frescura al LEER, desde la fecha real del precio ───────────────────────
// `priceFreshnessDays` lo congela el escáner el día que escribe la fila: un
// escaneo de hace tres semanas, restaurado hoy, seguía diciendo «3 días» y
// pasaba el filtro de frescura indefinidamente (auditoría de filtros
// 2026-11, H4). Toda lectura de frescura —filtro, salud de datos, listas,
// evidencia de método, marca de fila— sale de aquí: días desde `lastDate`
// hasta hoy. El valor guardado solo se usa si la fila no trae fecha (filas
// antiguas sin `lastDate`; en el nocturno US de 2026-10-18, 0 de 3.287).

/** Fecha (YYYY-MM-DD) del último precio de la fila, venga plana o anidada. */
export function rowLastDate(row = {}) {
  if (!row || typeof row !== "object") return "";
  for (const source of [row, row.metrics, row.snapshot, row.raw]) {
    const match = ISO_DAY.exec(String(source?.lastDate || ""));
    if (match) return match[0];
  }
  return "";
}

function storedFreshness(row = {}) {
  for (const source of [row, row.metrics, row.snapshot, row.raw]) {
    const value = source?.priceFreshnessDays;
    if (value === null || value === undefined || value === "") continue;
    const days = Number(value);
    if (Number.isFinite(days)) return days;
  }
  return null;
}

/**
 * Frescura del precio de la fila calculada AHORA desde su fecha real.
 * Misma forma y etiquetas que dataCoverageShared.priceFreshnessForDate (la que
 * usa el escáner al escribir), más `source`: "lastDate" | "stored" | "none".
 */
export function livePriceFreshness(row = {}, { maxDays, now = new Date() } = {}) {
  const limitInput = Number(maxDays);
  const lastDate = rowLastDate(row);
  if (lastDate) {
    return { ...priceFreshnessForDate(lastDate, Number.isFinite(limitInput) ? limitInput : undefined, now), lastDate, source: "lastDate" };
  }
  const base = priceFreshnessForDate("", Number.isFinite(limitInput) ? limitInput : undefined, now);
  const stored = storedFreshness(row);
  if (stored == null) return { ...base, lastDate: "", source: "none" };
  const ok = stored <= base.priceFreshnessMaxDays;
  return {
    ...base,
    priceFreshnessDays: stored,
    priceFreshnessOk: ok,
    priceFreshnessLabel: stored <= 2 ? "fresco" : ok ? "útil" : "viejo",
    priceFreshnessIssue: ok ? "" : `precio viejo: ${stored}d > ${base.priceFreshnessMaxDays}d`,
    lastDate: "",
    source: "stored",
  };
}

/**
 * Marca discreta de fila: el precio de ESTA fila lleva al menos
 * DATA_AGE_MAX_MISSED_WEEKDAYS sesiones sin actualizarse (mismo umbral que el
 * aviso de la lista). Sin fecha o al día → null: la fila no cambia.
 */
export function rowDataAgeMark(row = {}, now = new Date()) {
  const lastDate = rowLastDate(row);
  if (!lastDate) return null;
  const missed = missedWeekdays(lastDate, now);
  if (missed < DATA_AGE_MAX_MISSED_WEEKDAYS) return null;
  return {
    lastDate,
    missedWeekdays: missed,
    title: `Precio del ${shortDateEs(lastDate)}: ${missed} sesiones sin actualizar`,
  };
}

/** Aviso de precios retrasados, o null si están al día (o no hay fechas que juzgar). */
export function buildDataAgeNotice(rows, now = new Date()) {
  const lastDate = medianLastDate(rows);
  if (!lastDate) return null;
  const missed = missedWeekdays(lastDate, now);
  if (missed < DATA_AGE_MAX_MISSED_WEEKDAYS) return null;
  const label = shortDateEs(lastDate);
  return {
    tone: "warn",
    label: `Precios del ${label}`,
    detail: `Los precios más recientes de esta lista son del ${label}: llevan ${missed} sesiones sin actualizarse. Mientras no lleguen precios nuevos, el filtro de frescura no recorta: todo se calcula con los precios de esa fecha.`,
    stale: false,
    source: "data-age",
    dataAgeLastDate: lastDate,
    dataAgeMissedWeekdays: missed,
  };
}

// ── Opción B (decisión 2026-11-06): frescura en pausa si TODO va atrasado ──
// Si la lista entera está atrasada (mismo criterio que el aviso: mediana de
// lastDate a ≥ DATA_AGE_MAX_MISSED_WEEKDAYS sesiones), el filtro de frescura
// NO recorta: dejaría la mesa vacía sin decir nada útil. Se muestran las
// filas con el aviso único de precios viejos y la marca atenuada por fila. El
// filtro solo recorta cuando los datos son mixtos (unas filas al día, otras no).
export function datasetPriceIsStale(rows, now = new Date()) {
  return buildDataAgeNotice(rows, now) !== null;
}

// Texto del estado vacío del screener. Si la frescura dejó fuera filas, lo
// dice (una frase); si no, el texto de siempre.
export function screenerEmptyFilterText(analyzedCount = 0, diagnostics = null) {
  const total = Number(analyzedCount) || 0;
  const stale = Number(diagnostics?.freshnessRejected) || 0;
  const maxDays = Number(diagnostics?.freshnessMaxDays);
  const limit = Number.isFinite(maxDays) && maxDays < 999 ? ` de más de ${maxDays} días` : " atrasado";
  if (stale > 0 && stale >= total) {
    return `Ningún valor de los ${total} analizados pasa: todos tienen el precio${limit}.`;
  }
  if (stale > 0) {
    return `Ningún valor de los ${total} analizados pasa: ${stale} quedan fuera por precio${limit} y el resto no cumple el filtro.`;
  }
  return `Ningún valor de los ${total} analizados pasa este filtro. Afloja alguna condición o cambia de plantilla; los datos siguen cargados.`;
}
