// lib/ipoDate.js — resolución canónica de la fecha de salida a bolsa.
//
// Por qué existe: `requireRecentIpo` / `maxIpoAgeMonths` filtran por
// `ipoDate`/`ipoAgeMonths`, y esos dos campos venían vacíos en el 100% de las
// filas de todos los escaneos (censo de 3.314 filas del nocturno del
// 2026-08-15, docs/analisis-compuesto-2026-08-15.md). No era un fallo de
// persistencia: la fila se guardaba con lo que traía, y lo que traía era "".
//
// La cadena rota, medida el 2026-08-28 contra los proveedores reales
// (RDDT, ARM, AAPL, 9988.HK, SHEL.L — las cinco devolvieron ipoDate ""):
//
//   1. `defaultKeyStatistics.firstTradeDateEpochUtc` — Yahoo ya no lo
//      devuelve en quoteSummary. La llamada tiene éxito (sector/industria
//      llegan), el campo simplemente no está.
//   2. `price.firstTradeDateMilliseconds` — el módulo `price` de quoteSummary
//      nunca ha tenido ese campo.
//   3. `quote.firstTradeDateMilliseconds` — el endpoint v7 `finance/quote`
//      responde **HTTP 401** desde que Yahoo le exige crumb; era el único de
//      los tres que alguna vez trajo el dato.
//
// La fuente que SÍ responde, sin autenticación y en todos los mercados
// probados, es `meta.firstTradeDate` del endpoint v8 de gráficos — el mismo
// que el pipeline ya pide para las barras. Este módulo es la parte PURA de
// esa resolución (sin red): el lado de I/O vive en lib/ipoDateSources.js.

// Motivo estable de ausencia. Se guarda en la fila para que la cobertura de
// filtros pueda distinguir "el proveedor no da la fecha" de "nadie la buscó".
export const IPO_DATE_UNAVAILABLE = "ipo-date-unavailable";

export const IPO_DATE_SOURCES = {
  chartMeta: "yahoo-chart-first-trade-date",
  keyStatistics: "yahoo-key-statistics",
  price: "yahoo-price-module",
  quote: "yahoo-quote",
  fmp: "fmp-profile",
  profile: "profile-cache",
};

// Misma aritmética que las cuatro copias que ya viven en el repo
// (lib/scoring.js, lib/screenerFilters.js, lib/stockRows.js y la que este
// módulo retira de lib/materializedScanner.js): diferencia en meses de
// calendario, sin mirar el día del mes. No se cambia el cálculo — cambiarlo
// movería el umbral de 60 meses de todos los presets a la vez.
export function monthsSince(date) {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  return (now.getFullYear() - parsed.getFullYear()) * 12 + now.getMonth() - parsed.getMonth();
}

function cleanDate(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  // Acepta ISO completo o YYYY-MM-DD; normaliza a YYYY-MM-DD.
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function ipoDateFromEpochSeconds(seconds) {
  const n = Number(seconds);
  // 0 es una fecha válida en epoch pero no una primera cotización creíble:
  // Yahoo la usa como relleno cuando no tiene el dato.
  if (!Number.isFinite(n) || n <= 0) return "";
  const parsed = new Date(n * 1000);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

// Extrae la primera cotización del meta de un gráfico, cubriendo las tres
// formas en que Yahoo la ha expuesto. `firstTradeDate` (segundos) es la única
// que responde hoy; las otras dos quedan porque no cuestan nada y porque el
// meta de un proveedor de reserva podría traerlas.
export function firstTradeDateFromChartMeta(meta = {}) {
  if (!meta || typeof meta !== "object") return null;
  const seconds = Number(meta.firstTradeDate ?? meta.firstTradeDateEpochUtc?.raw ?? meta.firstTradeDateEpochUtc);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const ms = Number(meta.firstTradeDateMilliseconds);
  if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000);
  return null;
}

/**
 * Resuelve fecha, edad, procedencia y motivo de ausencia a partir de las
 * fuentes que el pipeline ya tiene en mano. No hace red.
 *
 * Orden: meta del gráfico (Yahoo en vivo, el que responde) → perfil (que ya
 * puede traerla resuelta y cacheada, con su propia procedencia) → ausencia
 * declarada. Nunca inventa una fecha.
 *
 * @param {{chartMeta?: object, profile?: object}} sources
 * @returns {{ipoDate: string, ipoAgeMonths: number|null, ipoDateSource: string|null, ipoDateReason: string|null}}
 */
export function resolveIpoDate({ chartMeta = null, profile = null } = {}) {
  const fromChart = ipoDateFromEpochSeconds(firstTradeDateFromChartMeta(chartMeta));
  if (fromChart) return ipoDateResult(fromChart, IPO_DATE_SOURCES.chartMeta);

  const fromProfile = cleanDate(profile?.ipoDate);
  if (fromProfile) return ipoDateResult(fromProfile, profile?.ipoDateSource || IPO_DATE_SOURCES.profile);

  return {
    ipoDate: "",
    ipoAgeMonths: null,
    ipoDateSource: null,
    ipoDateReason: IPO_DATE_UNAVAILABLE,
  };
}

export function ipoDateResult(ipoDate = "", source = null) {
  const clean = cleanDate(ipoDate);
  if (!clean) {
    return { ipoDate: "", ipoAgeMonths: null, ipoDateSource: null, ipoDateReason: IPO_DATE_UNAVAILABLE };
  }
  return {
    ipoDate: clean,
    ipoAgeMonths: monthsSince(clean),
    ipoDateSource: source || null,
    ipoDateReason: null,
  };
}
