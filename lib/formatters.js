// lib/formatters.js — CAPA ÚNICA de formato numérico y de fechas (es-ES).
//
// Por qué existe en esta forma: en agosto de 2026 el producto tenía CINCO
// juegos de formateadores locales con los mismos nombres y contratos
// distintos — dos `pct` (con y sin signo), tres implementaciones de
// capitalización, fechas en tres regímenes (es-ES con varias máscaras,
// toLocaleString() sin locale que dependía del navegador, e ISO crudo) — y
// la cabecera de la ficha mezclaba coma y punto en la misma línea
// ("490,99 USD · -0.7%"). Es el mismo problema que rsCanonical/stageDisplay
// resolvieron para los datos, aplicado a los números.
//
// Reglas:
//   - es-ES en todo: coma decimal, punto de millares.
//   - `pct` (variaciones) firma el signo; `pctShare` (proporciones), no.
//     El cero nunca lleva signo: "-0.0%" era un signo sin significado.
//   - Dos máscaras de fecha y ninguna más: dateShort ("4 ago 2026") y
//     dateTime ("4 ago, 21:04"). Nada de toLocale*() sin locale ni ISO
//     crudo en superficie.
//   - La ausencia aquí es "-": cada superficie decide su etiqueta de
//     ausencia ("Sin dato", guion con InfoHint) por encima de esta capa.
//   - Los sufijos T/B/M se mantienen (decisión de densidad de tabla, no de
//     idioma); el fallback sub-millón usa millares es-ES.

const LOCALE = "es-ES";

function esNumber(n, digits) {
  return n.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function clamp(n, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
}

export function num(n, digits = 0) {
  return Number.isFinite(n) ? esNumber(n, digits) : "-";
}

// Variación con signo explícito: "+12,3%" / "-8,4%" / "0,0%".
export function pct(n, digits = 1) {
  if (!Number.isFinite(n)) return "-";
  const rounded = Number(n.toFixed(digits));
  if (rounded === 0) return `${esNumber(0, digits)}%`;
  return `${rounded > 0 ? "+" : "-"}${esNumber(Math.abs(rounded), digits)}%`;
}

// Proporción sin signo (cuotas, márgenes, volatilidad): "47%" / "12,3%".
export function pctShare(n, digits = 0) {
  return Number.isFinite(n) ? `${esNumber(n, digits)}%` : "-";
}

export function ratio(n, digits = 2) {
  return Number.isFinite(n) ? `${esNumber(n, digits)}x` : "-";
}

// Magnitud abreviada SIN signo, para capitalización bursátil (nunca es
// negativa; cero o ausencia → "-").
export function cap(n) {
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n >= 1e12) return `${esNumber(n / 1e12, 2)}T`;
  if (n >= 1e9) return `${esNumber(n / 1e9, 1)}B`;
  if (n >= 1e6) return `${esNumber(n / 1e6, 0)}M`;
  return esNumber(n, 0);
}

// Magnitud abreviada CON signo y moneda opcional, para importes que pueden
// ser negativos (free cash flow, resultados): "3,4B USD" / "-959M USD".
export function amount(n, currency = "") {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const value = abs >= 1e12 ? `${esNumber(abs / 1e12, 2)}T`
    : abs >= 1e9 ? `${esNumber(abs / 1e9, 1)}B`
      : abs >= 1e6 ? `${esNumber(abs / 1e6, 0)}M`
        : esNumber(abs, 0);
  return `${sign}${value}${currency ? ` ${currency}` : ""}`;
}

// Precio con dos decimales SIEMPRE (los céntimos no desaparecen por encima
// de 100, que es lo que hacía el formateador del screener): "1.234,50 USD".
export function priceMoney(n, currency = "") {
  if (!Number.isFinite(n)) return "-";
  return `${esNumber(n, 2)}${currency ? ` ${currency}` : ""}`;
}

export function signedPriceMoney(n, currency = "") {
  if (!Number.isFinite(n)) return "";
  return `${n > 0 ? "+" : ""}${priceMoney(n, currency)}`;
}

// ── Fechas ────────────────────────────────────────────────────────────────

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

// "4 ago 2026" — la máscara corta de todo el producto.
export function dateShort(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" }) : "-";
}

// "4 ago, 21:04" — cuando la hora importa (scans, actualizaciones).
export function dateTime(value) {
  const d = toDate(value);
  return d ? d.toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
}
