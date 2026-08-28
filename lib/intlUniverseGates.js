import { countryCode } from "@/lib/symbols";

/** Defaults US/nocturno (USD). HK/CA resuelven en moneda local vía resolveBaseRejectThresholds. */
export const BASE_REJECT_DEFAULTS = Object.freeze({
  minPrice: 1,
  minAvgTurnover: 250000,
});

/**
 * Umbrales de calidad para mercados intl en modo official-broad (INT-3 / INT-3c).
 * US/nocturno no usa este mapa salvo que el mercado esté listado aquí.
 *
 * Motivos de rechazo (baseRejectReason → status UX-16):
 * - precio bajo / importe medio bajo → minPrice / minAvgTurnover (INT-3c, moneda local)
 * - liquidez baja score N → minLiquidityScore
 * - movimiento errático X% turnover Y → maxErraticDailyMovePct + erraticLowTurnover
 *
 * INT-3c: Pro/MICRO + spend-cap 8 GB → mejor yield por lote (umbrales HKD/CAD),
 * no más símbolos/noche. Acumulación multi-noche = INT-3d.
 */
export const INTL_UNIVERSE_GATE_THRESHOLDS = Object.freeze({
  HK: {
    // 0.50 HKD: títulos normales cotizan 0.30–0.90; minPrice:1 USD los barría todos.
    minPrice: 0.5,
    minAvgTurnover: 250000,
    minLiquidityScore: 25,
    maxErraticDailyMovePct: 14,
    erraticLowTurnover: 500000,
  },
  CA: {
    minPrice: 1,
    minAvgTurnover: 250000,
    minLiquidityScore: 25,
    maxErraticDailyMovePct: 14,
    erraticLowTurnover: 500000,
  },
});

export const OFFICIAL_BROAD_SCAN_MARKETS = new Set(Object.keys(INTL_UNIVERSE_GATE_THRESHOLDS));

const CURATED_HEAD_BOOST_SCORE = 400;

export function intlBroadPerMarketLimit() {
  const raw = Number(process.env.STATSEDGE_INTL_BROAD_PER_MARKET);
  if (Number.isFinite(raw) && raw >= 24) return Math.min(Math.floor(raw), 120);
  return 84;
}

export function isOfficialBroadMarket(market = "") {
  return OFFICIAL_BROAD_SCAN_MARKETS.has(String(market || "").toUpperCase());
}

export function officialBroadMarketFromList(markets = []) {
  if (!Array.isArray(markets) || markets.length !== 1) return "";
  const market = String(markets[0] || "").toUpperCase();
  return isOfficialBroadMarket(market) ? market : "";
}

/** Caps efectivos de limit/perMarket en /api/cron/scan-refresh (INT-3b). */
export const SCAN_REFRESH_LEGACY_LIMIT_MAX = 80;
export const SCAN_REFRESH_LEGACY_PER_MARKET_MAX = 25;

export function scanRefreshParamCaps(group = {}) {
  const broad = officialBroadMarketFromList(group.markets);
  if (broad) {
    return {
      limitMax: group.limit,
      perMarketMax: group.perMarket,
      broad,
    };
  }
  return {
    limitMax: Math.min(group.limit, SCAN_REFRESH_LEGACY_LIMIT_MAX),
    perMarketMax: Math.min(group.perMarket, SCAN_REFRESH_LEGACY_PER_MARKET_MAX),
    broad: "",
  };
}

export function resolveIntlGateThresholds(market = "", overrides = {}) {
  const key = String(market || "").toUpperCase();
  const base = INTL_UNIVERSE_GATE_THRESHOLDS[key];
  if (!base) return null;
  const scoped = overrides?.[key] && typeof overrides[key] === "object" ? overrides[key] : {};
  return { ...base, ...scoped };
}

/**
 * Umbrales baseReject por mercado (INT-3c). El cron puede pasar minPrice/minAvgTurnover
 * globales (USD); official-broad HK/CA aplican overrides en moneda local por fila.
 */
export function resolveBaseRejectThresholds(market = "", globalOptions = {}) {
  const key = String(market || "").toUpperCase();
  const marketMap = INTL_UNIVERSE_GATE_THRESHOLDS[key];
  const minPrice = Number(
    marketMap?.minPrice
    ?? globalOptions.minPrice
    ?? BASE_REJECT_DEFAULTS.minPrice,
  );
  const minAvgTurnover = Number(
    marketMap?.minAvgTurnover
    ?? globalOptions.minAvgTurnover
    ?? BASE_REJECT_DEFAULTS.minAvgTurnover,
  );
  return { minPrice, minAvgTurnover };
}

/**
 * Gates intl adicionales tras pasar los mínimos base (histórico, precio, turnover marginal).
 * Devuelve cadena vacía si la fila pasa.
 */
export function intlUniverseGateRejectReason(row = {}, market = "", options = {}) {
  const thresholds = resolveIntlGateThresholds(market, options.intlGates);
  if (!thresholds) return "";

  const liquidityScore = Number(row.liquidityScore);
  if (
    Number.isFinite(thresholds.minLiquidityScore)
    && Number.isFinite(liquidityScore)
    && liquidityScore < thresholds.minLiquidityScore
  ) {
    return `liquidez baja score ${Math.round(liquidityScore)}`;
  }

  const maxMove = Number(row.maxDailyMove20dPct);
  const avgTurnover = Number(row.avgTurnover);
  if (
    Number.isFinite(thresholds.maxErraticDailyMovePct)
    && Number.isFinite(maxMove)
    && maxMove > thresholds.maxErraticDailyMovePct
    && Number.isFinite(thresholds.erraticLowTurnover)
    && (avgTurnover || 0) < thresholds.erraticLowTurnover
  ) {
    return `movimiento errático ${maxMove.toFixed(1)}% turnover ${Math.round(avgTurnover || 0)}`;
  }

  return "";
}

export function marketForIntlGates(row = {}, options = {}) {
  return String(
    options.market
    || row.market
    || row.country
    || countryCode(row.symbol)
    || "",
  ).toUpperCase();
}

export { CURATED_HEAD_BOOST_SCORE };

/** Prefijos de baseRejectReason que INT-3e deprioritiza en selección HK official-broad. */
export const PRIOR_POLICY_BASE_REJECT_PREFIXES = Object.freeze([
  "precio bajo",
  "importe medio bajo",
  "market cap bajo",
]);

function cleanGateText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** HK official-broad (INT-3e): fila con metadatos de tablero HKEX en el snapshot. */
export function hkBoardMetadataPresent(row = {}) {
  return Boolean(cleanGateText(row.exchangeSubCategory));
}

/** Main Board + short-sell elegible; sin metadatos → neutral (no penalizar). */
export function isHkPreferredBoard(row = {}) {
  if (!hkBoardMetadataPresent(row)) return true;
  const sub = cleanGateText(row.exchangeSubCategory);
  return /Main Board/i.test(sub) && row.shortSellEligible === true;
}

/** GEM, sin Main Board o sin short-sell; solo cuando hay metadatos HKEX. */
export function isHkLiquidDeprioritized(row = {}) {
  if (!hkBoardMetadataPresent(row)) return false;
  return !isHkPreferredBoard(row);
}

export function priorPolicyBaseRejectReason(state = null) {
  if (!state) return "";
  const reason = cleanGateText(state.policyRejectReason || state.screenRejectReason || "");
  for (const prefix of PRIOR_POLICY_BASE_REJECT_PREFIXES) {
    if (reason.startsWith(prefix)) return reason;
  }
  return "";
}

export function isPriorPolicyBaseReject(state = null) {
  return Boolean(priorPolicyBaseRejectReason(state));
}

/**
 * CA official-broad: sin proxy de tablero/short-sell en el snapshot hoy — INT-3e HK-only.
 * Cuando exista un campo barato equivalente en officialUniverses, reutilizar el mismo patrón.
 */
export function isCaLiquidDeprioritized() {
  return false;
}
