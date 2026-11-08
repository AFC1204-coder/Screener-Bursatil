// Calendario de sesiones por mercado (D4/D5 de la auditoría 2026-11).
//
// Hasta ahora no había ningún calendario de mercado en lib/: cada sitio que
// necesitaba «¿es día de sesión?» lo aproximaba con días naturales
// (lib/dataAge.js, lib/weeklyChanges.js) o con una lista de festivos escrita
// a mano en la consulta (research/auditoria-producto-2026-11/scripts/a4).
// Este módulo es la fuente única para dos preguntas:
//
//   1. ¿Está ya CERRADA (y asentada) la sesión a la que pertenece una barra
//      diaria? Es lo que decide si una barra puede persistirse en daily_bars
//      (D4: velas intradía guardadas como cierres).
//   2. ¿Es un día de sesión en NYSE? (D5 y chequeo de salud a4: barras en
//      festivos). Solo EE. UU. tiene festivos modelados; para el resto de
//      mercados solo se modelan los fines de semana. La pregunta 1 no
//      necesita festivos: se ancla a la FECHA DE LA BARRA, no a «hoy».
//
// Sin dependencias (ni alias "@/"): lo importan Next, vitest y el script de
// operaciones scripts/ops/data-health-check.mjs con node a pelo.

import { countryCode } from "./symbols.js";

const DAY_MS = 86400000;

// Margen tras el cierre oficial antes de dar la vela por definitiva: subastas
// de cierre, retraso de 15-20 min del proveedor y correcciones de volumen.
export const SESSION_SETTLE_BUFFER_MINUTES = 30;

// Huso, apertura y cierre (hora local del mercado). El cierre incluye la
// subasta de cierre donde la hay (LSE 16:35, Xetra/Euronext 17:35, HKEX 16:10).
// La apertura importa porque Yahoo fecha cada barra diaria con la fecha UTC
// del instante de apertura (lib/yahoo.js#yahooBarsFromChartResult): en
// Australia (10:00 AEDT = 23:00 UTC del día anterior) la barra del lunes llega
// fechada en domingo. barSessionDate deshace ese desplazamiento.
export const MARKET_SESSIONS = {
  US: { tz: "America/New_York", open: "09:30", close: "16:00", zoneLabel: "ET" },
  CA: { tz: "America/Toronto", open: "09:30", close: "16:00", zoneLabel: "ET" },
  HK: { tz: "Asia/Hong_Kong", open: "09:30", close: "16:10", zoneLabel: "HKT" },
  GB: { tz: "Europe/London", open: "08:00", close: "16:35", zoneLabel: "Londres" },
  IE: { tz: "Europe/Dublin", open: "08:00", close: "16:35", zoneLabel: "Dublín" },
  DE: { tz: "Europe/Berlin", open: "09:00", close: "17:35", zoneLabel: "CET" },
  DE_FWB: { tz: "Europe/Berlin", open: "08:00", close: "22:00", zoneLabel: "CET" },
  FR: { tz: "Europe/Paris", open: "09:00", close: "17:35", zoneLabel: "CET" },
  NL: { tz: "Europe/Amsterdam", open: "09:00", close: "17:35", zoneLabel: "CET" },
  BE: { tz: "Europe/Brussels", open: "09:00", close: "17:35", zoneLabel: "CET" },
  PT: { tz: "Europe/Lisbon", open: "08:00", close: "16:35", zoneLabel: "Lisboa" },
  CH: { tz: "Europe/Zurich", open: "09:00", close: "17:35", zoneLabel: "CET" },
  SE: { tz: "Europe/Stockholm", open: "09:00", close: "17:35", zoneLabel: "CET" },
  DK: { tz: "Europe/Copenhagen", open: "09:00", close: "17:05", zoneLabel: "CET" },
  NO: { tz: "Europe/Oslo", open: "09:00", close: "16:25", zoneLabel: "CET" },
  FI: { tz: "Europe/Helsinki", open: "10:00", close: "18:35", zoneLabel: "EET" },
  IT: { tz: "Europe/Rome", open: "09:00", close: "17:35", zoneLabel: "CET" },
  ES: { tz: "Europe/Madrid", open: "09:00", close: "17:35", zoneLabel: "CET" },
  AT: { tz: "Europe/Vienna", open: "09:00", close: "17:35", zoneLabel: "CET" },
  JP: { tz: "Asia/Tokyo", open: "09:00", close: "15:30", zoneLabel: "JST" },
  AU: { tz: "Australia/Sydney", open: "10:00", close: "16:12", zoneLabel: "Sídney" },
  SG: { tz: "Asia/Singapore", open: "09:00", close: "17:16", zoneLabel: "SGT" },
  ZA: { tz: "Africa/Johannesburg", open: "09:00", close: "17:00", zoneLabel: "SAST" },
  TW: { tz: "Asia/Taipei", open: "09:00", close: "13:30", zoneLabel: "Taipéi" },
  IL: { tz: "Asia/Jerusalem", open: "09:59", close: "17:25", zoneLabel: "Tel Aviv" },
  KR: { tz: "Asia/Seoul", open: "09:00", close: "15:30", zoneLabel: "KST" },
  IN: { tz: "Asia/Kolkata", open: "09:15", close: "15:30", zoneLabel: "IST" },
  CN: { tz: "Asia/Shanghai", open: "09:30", close: "15:00", zoneLabel: "CST" },
  BR: { tz: "America/Sao_Paulo", open: "10:00", close: "18:00", zoneLabel: "BRT" },
  MX: { tz: "America/Mexico_City", open: "08:30", close: "15:00", zoneLabel: "CDMX" },
  // Divisas de Yahoo (EURUSD=X…): la barra diaria es el día de Londres.
  FX: { tz: "Europe/London", open: "00:00", close: "23:59", zoneLabel: "Londres" },
  // Instrumento sin mercado conocido (futuros =F, índices no mapeados): se da
  // por asentado solo 24 h después del final del día UTC. Conservador a
  // propósito: tarda un día más en persistir, pero nunca guarda una vela viva
  // de un mercado al este o al oeste de UTC.
  GLOBAL: { tz: "UTC", open: "00:00", close: "23:59", zoneLabel: "UTC", extraSettleMinutes: 24 * 60 },
};

// Índices de Yahoo que el producto usa como referencia (benchmarks RS,
// regímenes regionales). Sin esto, countryCode("^AXJO") devolvería "US".
const INDEX_MARKETS = {
  "^GSPC": "US", "^IXIC": "US", "^DJI": "US", "^RUT": "US", "^NDX": "US", "^VIX": "US", "^NYA": "US",
  "^GSPTSE": "CA", "^HSI": "HK", "^HSCE": "HK", "^FTSE": "GB", "^FTMC": "GB", "^GDAXI": "DE",
  "^STOXX50E": "DE", "^STOXX": "DE", "^FCHI": "FR", "^AEX": "NL", "^BFX": "BE", "^IBEX": "ES",
  "^SSMI": "CH", "^OMX": "SE", "^OMXC25": "DK", "^OSEAX": "NO", "^OMXH25": "FI", "FTSEMIB.MI": "IT",
  "^N225": "JP", "^TOPX": "JP", "^AXJO": "AU", "^STI": "SG", "^TWII": "TW", "^KS11": "KR",
  "^NSEI": "IN", "^BSESN": "IN", "000001.SS": "CN", "^BVSP": "BR", "^MXX": "MX", "^TA125.TA": "IL",
};

export function marketForSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) return "GLOBAL";
  if (INDEX_MARKETS[clean]) return INDEX_MARKETS[clean];
  if (clean.endsWith("=X")) return "FX";
  if (clean.startsWith("^") || clean.includes("=")) return "GLOBAL";
  if (clean.endsWith(".F")) return "DE_FWB";
  const country = countryCode(clean);
  return MARKET_SESSIONS[country] ? country : "GLOBAL";
}

export function marketSession(market = "US") {
  return MARKET_SESSIONS[market] || MARKET_SESSIONS.GLOBAL;
}

// ── Fechas y husos ───────────────────────────────────────────────────────

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dateUtcMs(date = "") {
  const clean = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return NaN;
  return Date.parse(`${clean}T00:00:00Z`);
}

export function addDays(date = "", days = 0) {
  const ms = dateUtcMs(date);
  return Number.isFinite(ms) ? isoDate(ms + days * DAY_MS) : "";
}

const formatterCache = new Map();
function zonedFormatter(tz) {
  if (!formatterCache.has(tz)) {
    formatterCache.set(tz, new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }));
  }
  return formatterCache.get(tz);
}

// Partes de fecha/hora locales de un instante en un huso.
export function zonedParts(ms, tz) {
  const parts = Object.fromEntries(zonedFormatter(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.parse(`${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}Z`);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Instante (ms UTC) de una hora local "HH:MM" de una fecha en un huso.
// Dos pasadas para caer bien en los cambios de horario de verano.
export function zonedTimeToUtc(date = "", hhmm = "00:00", tz = "UTC") {
  const [h, m] = String(hhmm).split(":").map(Number);
  const base = dateUtcMs(date);
  if (!Number.isFinite(base)) return NaN;
  const naive = base + (h * 60 + m) * 60000;
  const first = naive - offsetMs(naive, tz);
  const second = naive - offsetMs(first, tz);
  return second;
}

export function sessionOpenInstant(market, sessionDate) {
  const s = marketSession(market);
  return zonedTimeToUtc(sessionDate, s.open, s.tz);
}

export function sessionCloseInstant(market, sessionDate) {
  const s = marketSession(market);
  return zonedTimeToUtc(sessionDate, s.close, s.tz);
}

// Instante a partir del cual la vela de la sesión `sessionDate` es definitiva.
export function sessionSettleInstant(market, sessionDate, bufferMinutes = SESSION_SETTLE_BUFFER_MINUTES) {
  const s = marketSession(market);
  return sessionCloseInstant(market, sessionDate) + (bufferMinutes + (s.extraSettleMinutes || 0)) * 60000;
}

// Fecha LOCAL de la sesión a la que pertenece una barra fechada `barDate`
// (fecha UTC de su apertura, convención de Yahoo). En casi todos los mercados
// coincide; en Australia o en divisas en horario de verano británico, la
// barra va fechada el día anterior a su sesión.
export function barSessionDate(market, barDate = "") {
  const date = String(barDate || "").slice(0, 10);
  if (!Number.isFinite(dateUtcMs(date))) return "";
  if (isoDate(sessionOpenInstant(market, date)) === date) return date;
  const next = addDays(date, 1);
  if (isoDate(sessionOpenInstant(market, next)) === date) return next;
  return date;
}

function nowMs(now) {
  if (now instanceof Date) return now.getTime();
  if (Number.isFinite(now)) return now;
  if (typeof now === "string" && now) {
    const ms = Date.parse(now);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

// Ventana en la que una barra no asentada se considera «la sesión en curso».
// Una barra que se asienta más allá de 48 h en el futuro no es una sesión
// viva: ningún proveedor real la devuelve (solo series sintéticas de test), y
// no es asunto de D4 decidir qué hacer con ella.
const LIVE_SESSION_HORIZON_MS = 48 * 3600000;

// ¿La sesión de esta barra sigue abierta (o cerrada hace menos del margen)
// en `now`? Es la regla de D4: estas barras NO se persisten.
export function isBarSessionInProgress(symbol, barDate, now, options = {}) {
  const market = options.market || marketForSymbol(symbol);
  const session = barSessionDate(market, barDate);
  if (!session) return false;
  const settle = sessionSettleInstant(market, session, options.bufferMinutes ?? SESSION_SETTLE_BUFFER_MINUTES);
  const remaining = settle - nowMs(now);
  return remaining > 0 && remaining <= LIVE_SESSION_HORIZON_MS;
}

// ¿Se escribió esta barra ANTES de que su sesión quedara asentada? Es la
// regla de lectura de D4: una vela así es parcial (volumen recortado, cierre
// intradía) aunque su fecha diga que es de hoy o de ayer.
export function wasWrittenBeforeSettle(symbol, barDate, writtenAt, options = {}) {
  const written = writtenAt ? Date.parse(writtenAt) : NaN;
  if (!Number.isFinite(written)) return false;
  const market = options.market || marketForSymbol(symbol);
  const session = barSessionDate(market, barDate);
  if (!session) return false;
  return written < sessionSettleInstant(market, session, options.bufferMinutes ?? SESSION_SETTLE_BUFFER_MINUTES);
}

// Hora local del mercado, para rotular un precio intradía («14:53 ET»).
export function marketTimeLabel(symbol, at) {
  const market = marketForSymbol(symbol);
  const s = marketSession(market);
  const p = zonedParts(nowMs(at), s.tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ${s.zoneLabel}`;
}

// ── Festivos NYSE ────────────────────────────────────────────────────────
//
// Reglas de la NYSE (Rule 7.2), calculadas, no listadas a mano:
//   Año Nuevo (si cae en sábado NO se traslada al viernes; en domingo, lunes),
//   Martin Luther King (3.er lunes de enero), Presidents' Day (3.er lunes de
//   febrero), Viernes Santo, Memorial Day (último lunes de mayo), Juneteenth
//   (desde 2022), Independencia, Labor Day (1.er lunes de septiembre),
//   Acción de Gracias (4.º jueves de noviembre) y Navidad. Sábado → viernes,
//   domingo → lunes. Más los cierres extraordinarios.
const NYSE_SPECIAL_CLOSURES = [
  "2012-10-29", "2012-10-30", // huracán Sandy
  "2018-12-05", // funeral de George H. W. Bush
  "2025-01-09", // funeral de Jimmy Carter
];

function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return isoDate(Date.UTC(year, month - 1, day));
}

function lastWeekday(year, month, weekday) {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const diff = (lastDay.getUTCDay() - weekday + 7) % 7;
  return isoDate(lastDay.getTime() - diff * DAY_MS);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(Date.UTC(year, month - 1, day));
}

function observedFixed(year, month, day) {
  const ms = Date.UTC(year, month - 1, day);
  const dow = new Date(ms).getUTCDay();
  if (dow === 6) return isoDate(ms - DAY_MS);
  if (dow === 0) return isoDate(ms + DAY_MS);
  return isoDate(ms);
}

const nyseCache = new Map();
export function nyseHolidays(year) {
  if (nyseCache.has(year)) return nyseCache.get(year);
  const days = [];
  const ny = Date.UTC(year, 0, 1);
  const nyDow = new Date(ny).getUTCDay();
  if (nyDow === 0) days.push(isoDate(ny + DAY_MS));
  else if (nyDow !== 6) days.push(isoDate(ny));
  days.push(nthWeekday(year, 1, 1, 3));
  days.push(nthWeekday(year, 2, 1, 3));
  days.push(addDays(easterSunday(year), -2));
  days.push(lastWeekday(year, 5, 1));
  if (year >= 2022) days.push(observedFixed(year, 6, 19));
  days.push(observedFixed(year, 7, 4));
  days.push(nthWeekday(year, 9, 1, 1));
  days.push(nthWeekday(year, 11, 4, 4));
  days.push(observedFixed(year, 12, 25));
  for (const d of NYSE_SPECIAL_CLOSURES) if (d.startsWith(`${year}-`)) days.push(d);
  const set = new Set(days);
  nyseCache.set(year, set);
  return set;
}

function isWeekend(date) {
  const dow = new Date(dateUtcMs(date)).getUTCDay();
  return dow === 0 || dow === 6;
}

// ¿Es `date` (fecha local de sesión) un día con mercado abierto? Festivos solo
// para EE. UU.; el resto, solo fines de semana (ver cabecera).
export function isTradingDay(market = "US", date = "") {
  const clean = String(date || "").slice(0, 10);
  if (!Number.isFinite(dateUtcMs(clean))) return false;
  if (market === "FX" || market === "GLOBAL") return !isWeekend(clean);
  if (isWeekend(clean)) return false;
  if (market === "US") return !nyseHolidays(Number(clean.slice(0, 4))).has(clean);
  return true;
}

// Días SIN sesión NYSE (fines de semana y festivos) en [from, to], ambos
// incluidos. Lo usa el chequeo de salud a4.
export function nyseNonTradingDays(from = "", to = "") {
  const out = [];
  let cursor = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  if (!Number.isFinite(dateUtcMs(cursor)) || !Number.isFinite(dateUtcMs(end))) return out;
  while (cursor <= end) {
    if (!isTradingDay("US", cursor)) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

// Última sesión NYSE estrictamente anterior a `date`.
export function previousNyseSession(date = "") {
  let cursor = addDays(date, -1);
  for (let i = 0; i < 15 && cursor; i += 1) {
    if (isTradingDay("US", cursor)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return "";
}

// ¿Es `date` la última sesión NYSE de su semana ISO? (viernes, o jueves si
// el viernes es festivo). La usa a11 para saber cuándo cierra la semana.
export function isLastNyseSessionOfWeek(date = "") {
  if (!isTradingDay("US", date)) return false;
  let cursor = addDays(date, 1);
  while (new Date(dateUtcMs(cursor)).getUTCDay() !== 1) {
    if (isTradingDay("US", cursor)) return false;
    cursor = addDays(cursor, 1);
  }
  return true;
}

// Lunes de la semana ISO de una fecha.
export function isoWeekMonday(date = "") {
  const ms = dateUtcMs(date);
  if (!Number.isFinite(ms)) return "";
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return isoDate(ms - dow * DAY_MS);
}
