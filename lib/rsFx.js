// lib/rsFx.js — conversión de precio local a USD para el motor de RS global
// privado (MET-1b). Implementa la convención FX cerrada en el addendum §7 y la
// política de fallo del spec (docs/spec-rs-global-multi-mercado-fx.md, «FX»).
//
// LO QUE ESTE MÓDULO ES Y LO QUE NO ES
//
// Es aritmética pura y política de elegibilidad: dado un precio local, una
// divisa y una serie FX ya leída, devuelve el precio en USD o un motivo de
// exclusión. NO habla con Supabase ni con Yahoo — eso vive en el script
// (scripts/rs-fx-ingest.mjs para la ingesta, scripts/rs-global-private.mjs para
// la lectura), de modo que todo lo delicado sea testeable sin red ni base.
//
// CONVENCIÓN DE MULTIPLICACIÓN (addendum §7, conservada íntegra)
//
//   priceInBase = localPrice × FX[C→USD]
//
// El par directo {CCY}USD=X ya cotiza C→USD, así que se usa tal cual. El
// inverso USD{CCY}=X cotiza USD→C y se normaliza como 1/rate (§7.2). Si la
// divisa del símbolo ES la base (USD), fx=1 por contrato (§7.3) — no se busca
// ningún par. Sin cruces en v1 (§7.4 no se ejercita): las diez divisas del
// universo cotizan todas contra USD; si un día hace falta una pierna
// intermedia, eso es engine_version nuevo, no un parche aquí.
//
// LA TRAMPA DE GBX (spec pregunta 4)
//
// LSE cotiza en peniques. Un precio de 2.500 en RR.L no son 2.500 libras, son
// 25 libras. Aplicar GBP→USD directamente sobre el penique infla el precio
// ×100 — y como el RS es un RATIO entre dos precios de la misma serie, el
// factor se cancelaría... salvo que la serie cambie de unidad a mitad (Yahoo lo
// ha hecho) o que el precio en USD se persista para auditoría. Normalizamos
// GBX→GBP dividiendo entre 100 ANTES de aplicar FX, con el mismo precedente que
// app/api/company-brief/route.js:130-134.

// Divisas del universo v1 (spec pregunta 2 + «FX»): las diez que cubren US, HK,
// CA, Europa-15, AU y JP. Cualquier símbolo cuya divisa no salga de aquí se
// excluye con fx-currency-unknown — nunca se asume paridad.
export const FX_BASE_CURRENCY = "USD";

// Mercado (código ISO del país, tal como lo devuelve lib/symbols.js:countryCode)
// → divisa de cotización. Deliberadamente explícito y no derivado: un mapa
// implícito por sufijo escondería que .L cotiza en peniques y no en libras.
export const MARKET_CURRENCY = {
  US: "USD",
  HK: "HKD",
  CA: "CAD",
  GB: "GBX", // LSE cotiza en peniques — ver normalizeCurrencyUnit
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  IT: "EUR",
  ES: "EUR",
  BE: "EUR",
  PT: "EUR",
  AT: "EUR",
  IE: "EUR",
  FI: "EUR",
  CH: "CHF",
  SE: "SEK",
  DK: "DKK",
  NO: "NOK",
  AU: "AUD",
  JP: "JPY",
};

// Las divisas que realmente necesitan par FX (todas menos la base).
export const FX_CURRENCIES = [...new Set(Object.values(MARKET_CURRENCY).map((code) => (code === "GBX" ? "GBP" : code)))]
  .filter((code) => code !== FX_BASE_CURRENCY)
  .sort();

/** Pares Yahoo para una divisa: [directo, inverso]. Vacío si es la base. */
export function fxPairsFor(currency = "") {
  const code = normalizeCurrencyCode(currency);
  if (!code || code === FX_BASE_CURRENCY) return [];
  return [`${code}${FX_BASE_CURRENCY}=X`, `${FX_BASE_CURRENCY}${code}=X`];
}

/** Todos los pares directos que la ingesta debe traer (uno por divisa). */
export function fxDirectPairs() {
  return FX_CURRENCIES.map((code) => `${code}${FX_BASE_CURRENCY}=X`);
}

/**
 * Código ISO de la divisa. GBX/GBp/GBX=X colapsan a GBP: la UNIDAD (peniques)
 * la resuelve normalizeCurrencyUnit, no el código del par FX — no existe un par
 * "GBXUSD=X".
 */
export function normalizeCurrencyCode(currency = "") {
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return "";
  if (code === "GBX" || code === "GBP" || code === "GBPENCE" || code === "PENCE") return "GBP";
  return code;
}

/**
 * Normaliza precio y divisa a la UNIDAD mayor antes de aplicar FX.
 * GBX 2500 → GBP 25. Cualquier otra divisa pasa intacta.
 */
export function normalizeCurrencyUnit(price, currency = "") {
  const raw = String(currency || "").trim().toUpperCase();
  const value = Number(price);
  if (!Number.isFinite(value)) return { price: null, currency: normalizeCurrencyCode(currency), divisor: 1 };
  // "GBp" es la grafía de Yahoo para peniques y llega aquí ya en mayúsculas
  // por el toUpperCase de arriba, así que este único caso cubre GBX y GBp.
  // GBP a secas es libras y NO se divide.
  if (raw === "GBX" || raw === "PENCE" || raw === "GBPENCE") {
    return { price: value / 100, currency: "GBP", divisor: 100 };
  }
  return { price: value, currency: normalizeCurrencyCode(currency), divisor: 1 };
}

/** Divisa de cotización de un símbolo, a partir de su mercado. */
export function currencyForMarket(market = "") {
  return MARKET_CURRENCY[String(market || "").trim().toUpperCase()] || "";
}

// ── Política de elegibilidad de la serie FX ──────────────────────────────
//
// fxMaxAge = 5 sesiones FX (una semana natural de mercado), cerrado en el spec
// («FX», política de fallo). Forward-fill PERMITIDO dentro de ese límite,
// registrando la fx_date de la observación realmente usada; fuera del límite,
// el símbolo sale del ranking con motivo. Nunca 0, nunca paridad, nunca media.
export const FX_MAX_AGE_SESSIONS = 5;

// La serie FX tiene su propio control de discontinuidad, separado del de la
// serie local: un salto de 3x en un cruce contra USD no es un split, es un dato
// corrupto, y confundirlo con el split de la acción produciría el motivo
// equivocado. Mismo umbral por coherencia con el control de precio.
export const FX_DISCONTINUITY_FACTOR_THRESHOLD = 3;

export const FX_EXCLUSION_REASONS = {
  CURRENCY_UNKNOWN: "fx-currency-unknown",
  UNAVAILABLE: "fx-unavailable",
  STALE: "fx-stale",
  DISCONTINUOUS: "fx-discontinuous",
};

/**
 * Elige la observación FX aplicable a una fecha, con forward-fill acotado.
 *
 * @param {Array<{date: string, close: number}>} fxBars serie DESC (más reciente
 *   primero), la misma convención que devuelve fetchBarsForSymbol.
 * @param {string} asOfDate fecha de la barra de cierre del símbolo.
 * @returns {{ok: true, rate: number, fxDate: string, ageSessions: number} |
 *   {ok: false, exclusionReason: string, reason: string}}
 *
 * Anti-lookahead (addendum §8): solo se consideran observaciones con
 * trade_date <= asOfDate. Como el cómputo corre tras el cierre de todos los
 * mercados, cualquier dato así llevaba ya ≥1 día público.
 */
export function pickFxObservation(fxBars = [], asOfDate = "", options = {}) {
  const maxAge = Number.isFinite(Number(options.maxAgeSessions)) ? Number(options.maxAgeSessions) : FX_MAX_AGE_SESSIONS;
  const bars = Array.isArray(fxBars) ? fxBars : [];
  if (!bars.length) {
    return { ok: false, exclusionReason: FX_EXCLUSION_REASONS.UNAVAILABLE, reason: "sin serie FX para esta divisa" };
  }
  // bars viene DESC. Los índices posteriores al primero elegible son sesiones FX
  // anteriores: la distancia en índices ES la antigüedad en sesiones FX, que es
  // exactamente la unidad en la que el spec fija fxMaxAge (no días naturales:
  // un puente de tres días no debe consumir el presupuesto de staleness).
  const eligibleIndex = bars.findIndex((bar) => bar?.date && bar.date <= asOfDate && Number.isFinite(bar.close) && bar.close > 0);
  if (eligibleIndex === -1) {
    return {
      ok: false,
      exclusionReason: FX_EXCLUSION_REASONS.UNAVAILABLE,
      reason: `sin observación FX con trade_date <= ${asOfDate}`,
    };
  }
  const chosen = bars[eligibleIndex];
  // Antigüedad = cuántas sesiones FX hay ENTRE la elegida y la fecha del
  // símbolo. Si la serie FX tiene una barra en la misma fecha, es 0.
  const sessionsAfter = bars.slice(0, eligibleIndex).filter((bar) => bar?.date && bar.date <= asOfDate).length;
  const ageSessions = chosen.date === asOfDate ? 0 : countSessionsBetween(bars, chosen.date, asOfDate) + sessionsAfter;
  if (ageSessions > maxAge) {
    return {
      ok: false,
      exclusionReason: FX_EXCLUSION_REASONS.STALE,
      reason: `FX más reciente (${chosen.date}) a ${ageSessions} sesiones de ${asOfDate}, por encima de fxMaxAge=${maxAge}`,
    };
  }
  return { ok: true, rate: chosen.close, fxDate: chosen.date, ageSessions };
}

// Cuenta sesiones FX estrictamente entre dos fechas (exclusivo en ambos
// extremos). Sirve para medir el hueco cuando la serie FX no tiene barra en la
// fecha del símbolo: si el mercado FX cotizó tres veces en ese hueco, la
// observación tiene tres sesiones de antigüedad, no los días naturales.
function countSessionsBetween(bars = [], fromDate = "", toDate = "") {
  if (!fromDate || !toDate || fromDate >= toDate) return 0;
  // La serie FX no tiene barras entre fromDate y toDate por construcción
  // (fromDate es la primera <= toDate), así que el hueco se estima por días
  // naturales descontando fines de semana: es una COTA SUPERIOR de sesiones,
  // deliberadamente conservadora — prefiere excluir a colar un FX viejo.
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  let sessions = 0;
  for (let ms = from + 86400000; ms <= to; ms += 86400000) {
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6) sessions += 1;
  }
  return sessions;
}

/**
 * Detecta discontinuidad en la serie FX. Separada del control de la serie
 * local a propósito (ver comentario de FX_DISCONTINUITY_FACTOR_THRESHOLD).
 */
export function fxSeriesDiscontinuity(fxBars = [], threshold = FX_DISCONTINUITY_FACTOR_THRESHOLD) {
  const bars = (Array.isArray(fxBars) ? fxBars : []).filter((bar) => Number.isFinite(bar?.close) && bar.close > 0);
  for (let i = 1; i < bars.length; i += 1) {
    const a = bars[i - 1].close;
    const b = bars[i].close;
    const factor = Math.max(a / b, b / a);
    if (factor >= threshold) {
      return { discontinuous: true, date: bars[i - 1].date, factor };
    }
  }
  return { discontinuous: false };
}

/**
 * Convierte un precio local a USD aplicando la convención §7 completa.
 *
 * @param {number} localPrice precio en la unidad de cotización del mercado.
 * @param {string} currency divisa declarada (GBX admitido).
 * @param {{rate: number, inverse: boolean}|null} fx observación ya elegida.
 * @returns {{ok: true, priceInBase, localPrice, normalizedCurrency, fxRate,
 *   unitDivisor} | {ok: false, exclusionReason, reason}}
 */
export function convertToBase(localPrice, currency = "", fx = null) {
  const unit = normalizeCurrencyUnit(localPrice, currency);
  if (!Number.isFinite(unit.price)) {
    return { ok: false, exclusionReason: FX_EXCLUSION_REASONS.UNAVAILABLE, reason: "precio local no finito" };
  }
  const code = unit.currency;
  if (!code) {
    return { ok: false, exclusionReason: FX_EXCLUSION_REASONS.CURRENCY_UNKNOWN, reason: "divisa vacía o no normalizable" };
  }
  // C = B (§7.3): contrato, no aproximación. No se busca par ni se admite que
  // uno "mejore" el 1.
  if (code === FX_BASE_CURRENCY) {
    return {
      ok: true,
      priceInBase: unit.price,
      localPrice: unit.price,
      normalizedCurrency: code,
      fxRate: 1,
      unitDivisor: unit.divisor,
    };
  }
  if (!FX_CURRENCIES.includes(code)) {
    return {
      ok: false,
      exclusionReason: FX_EXCLUSION_REASONS.CURRENCY_UNKNOWN,
      reason: `divisa fuera del universo v1: ${code}`,
    };
  }
  const rawRate = Number(fx?.rate);
  if (!Number.isFinite(rawRate) || rawRate <= 0) {
    return { ok: false, exclusionReason: FX_EXCLUSION_REASONS.UNAVAILABLE, reason: `sin tasa FX aplicable para ${code}` };
  }
  // §7.2: el par inverso se normaliza a C→USD antes de multiplicar. Nunca se
  // divide el precio: la convención del addendum es una multiplicación única.
  const rate = fx?.inverse ? 1 / rawRate : rawRate;
  return {
    ok: true,
    priceInBase: unit.price * rate,
    localPrice: unit.price,
    normalizedCurrency: code,
    fxRate: rate,
    unitDivisor: unit.divisor,
  };
}
