import { countryCode } from "@/lib/symbols";

/**
 * Umbrales de calidad para mercados intl en modo official-broad (INT-3).
 * US/nocturno no usa este mapa salvo que el mercado esté listado aquí.
 *
 * Motivos de rechazo (baseRejectReason → status UX-16):
 * - liquidez baja score N → minLiquidityScore
 * - movimiento errático X% turnover Y → maxErraticDailyMovePct + erraticLowTurnover
 */
export const INTL_UNIVERSE_GATE_THRESHOLDS = Object.freeze({
  HK: {
    minLiquidityScore: 25,
    maxErraticDailyMovePct: 14,
    erraticLowTurnover: 500000,
  },
  CA: {
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

export function resolveIntlGateThresholds(market = "", overrides = {}) {
  const key = String(market || "").toUpperCase();
  const base = INTL_UNIVERSE_GATE_THRESHOLDS[key];
  if (!base) return null;
  const scoped = overrides?.[key] && typeof overrides[key] === "object" ? overrides[key] : {};
  return { ...base, ...scoped };
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
