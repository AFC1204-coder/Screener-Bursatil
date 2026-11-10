// Corrección AL LEER de la fecha corrida −1 día en los nocturnos guardados
// antes del arreglo a34389a (2026-10-23 21:29 +02:00).
//
// Causa (auditoría de filtros 2026-11, §9.1): en modo pg, node-postgres
// devolvía las columnas `date` de daily_bars como Date a medianoche LOCAL y
// toDate() las pasaba por toISOString(). En Europe/Madrid eso corre TODA la
// serie leída de caché un día natural hacia atrás: el viernes queda en jueves
// y el lunes en domingo. El escáner guardó esa serie en chartPreview y su
// última fecha en lastDate, mientras que `price` es el cierre real de la
// sesión siguiente. Resultado: el screener decía «Precios del 15 oct» y el
// panel «cierre jue 15 oct» con el precio del viernes 16.
//
// Regla:
//   - Solo filas de escaneos creados ANTES del arreglo (created_at del scan o
//     de la fila). Un escaneo posterior nunca se toca: no hay doble corrección.
//   - Y solo si la serie de la fila delata el desfase: su chartPreview tiene
//     barras en domingo y ninguna en viernes (con datos sanos es al revés). Los
//     nocturnos del 13 y el 17-oct, con barras descargadas en vivo, tienen
//     viernes y quedan como están. Sin serie que lo pruebe, la fila tampoco se
//     toca: no se corrige a ciegas.
//   - El inverso exacto es +1 día NATURAL (el desfase es de huso horario, no
//     de calendario bursátil). Para cualquier fecha corrida real coincide con
//     «+1 sesión hábil»: una fecha guardada nunca es viernes ni sábado (sería
//     un sábado o domingo real), y tras un festivo el día siguiente natural es
//     justo la sesión que se guardó corrida (p. ej. Labor Day 7-sep → 8-sep).
//     Por eso no hace falta un calendario de festivos, que el repo no tiene.
//
// Se aplica en los puntos únicos de proyección de filas de scan_results:
// scanDecisionRowFromDb (/api/scans → screener, panel, ficha de la mesa),
// rowFromScanResult (lib/leaderboards.js → /api/discovery, Listas, leaderboards)
// y /api/scans/chart-preview (miniaturas diferidas).

export const PG_DATE_SHIFT_FIXED_AT = "2026-10-23T19:29:32.000Z";
const FIXED_AT_MS = Date.parse(PG_DATE_SHIFT_FIXED_AT);
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86400000;

function utcDay(value) {
  const match = ISO_DAY.exec(String(value || ""));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}

// Hay pocos cientos de fechas distintas en un nocturno y ~160.000 barras: se
// memoizan día siguiente y día de la semana por texto (sin Date por barra).
const NEXT_DAY_MEMO = new Map();
const WEEKDAY_MEMO = new Map();
const MEMO_MAX = 20000;

function memoSet(map, key, value) {
  if (map.size >= MEMO_MAX) map.clear();
  map.set(key, value);
  return value;
}

/** YYYY-MM-DD + 1 día natural (conserva el resto del texto, p. ej. una hora). */
export function nextCalendarDay(value) {
  const text = String(value || "");
  const cached = NEXT_DAY_MEMO.get(text);
  if (cached !== undefined) return cached;
  const time = utcDay(text);
  if (time == null) return value;
  return memoSet(NEXT_DAY_MEMO, text, new Date(time + DAY_MS).toISOString().slice(0, 10) + text.slice(10));
}

// 0 = domingo … 6 = sábado; null sin fecha.
function weekdayOf(value) {
  const text = String(value || "").slice(0, 10);
  const cached = WEEKDAY_MEMO.get(text);
  if (cached !== undefined) return cached;
  const time = utcDay(text);
  return memoSet(WEEKDAY_MEMO, text, time == null ? null : ((Math.floor(time / DAY_MS) + 4) % 7 + 7) % 7);
}

/** ¿El escaneo es anterior al arreglo? Sin fecha → no (no se corrige a ciegas). */
export function scanPredatesDateFix(createdAt) {
  const time = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt || ""));
  return Number.isFinite(time) && time < FIXED_AT_MS;
}

/** Firma del desfase en la serie: ≥1 barra en domingo y ninguna en viernes. */
export function chartPreviewLooksShifted(preview) {
  if (!Array.isArray(preview) || preview.length < 5) return false;
  let sundays = 0;
  let fridays = 0;
  for (const bar of preview) {
    const weekday = weekdayOf(bar?.date ?? bar?.time);
    if (weekday == null) continue;
    if (weekday === 0) sundays += 1;
    else if (weekday === 5) fridays += 1;
  }
  return sundays > 0 && fridays === 0;
}

function shiftPreview(preview) {
  return preview.map((bar) => {
    if (!bar || typeof bar !== "object") return bar;
    const next = { ...bar };
    if (bar.date != null) next.date = nextCalendarDay(bar.date);
    if (typeof bar.time === "string") next.time = nextCalendarDay(bar.time);
    return next;
  });
}

/** Serie de miniatura corregida (o la misma si no procede). */
export function repairShiftedChartPreview(preview, scanCreatedAt) {
  if (!scanPredatesDateFix(scanCreatedAt) || !chartPreviewLooksShifted(preview)) return preview;
  return shiftPreview(preview);
}

/**
 * Fila plana (lastDate y chartPreview en la raíz) corregida, o la misma fila
 * si no procede. Marca `priceDateRepaired: { from, to }` para poder auditarlo.
 */
export function repairShiftedPriceDate(row, scanCreatedAt) {
  if (!row || typeof row !== "object" || row.priceDateRepaired) return row;
  if (!scanPredatesDateFix(scanCreatedAt) || !chartPreviewLooksShifted(row.chartPreview)) return row;
  const from = typeof row.lastDate === "string" ? row.lastDate : "";
  const to = from ? nextCalendarDay(from) : "";
  return {
    ...row,
    ...(from ? { lastDate: to } : {}),
    chartPreview: shiftPreview(row.chartPreview),
    priceDateRepaired: { from, to, rule: "pg-date-shift-2026-10-23" },
  };
}
