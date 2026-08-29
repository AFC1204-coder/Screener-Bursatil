// lib/lideresIntlGuardrail.js — aviso cuando la ficha Líderes intl no cuadra con los datos cargados (UX-16 / H-07).

import { normalizeMarketList } from "@/lib/markets";
import { marketSelectionIncludesUs } from "@/lib/screenerFilterCatalog";
import { resolveActiveHuntCard } from "@/lib/screenerHuntCards";
import { countryCode } from "@/lib/symbols";

export const LIDERES_INTL_GUARDRAIL_SOURCE = "lideres-intl-misalignment";

export const LIDERES_INTL_CTA = {
  LOAD_CORE_INTL: "load-core-intl",
  REMOVE_US: "remove-us",
  SWITCH_ETAPA_2: "switch-etapa-2",
};

const US_MARKET = "US";
const US_MAJORITY_RATIO = 0.5;

export function marketCodeForRow(row = {}) {
  return String(row?.country || countryCode(row?.symbol) || "").toUpperCase();
}

export function countRowsByMarket(rows = []) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = marketCodeForRow(row);
    if (!code) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return counts;
}

export function selectionIncludesIntlMarkets(markets = []) {
  return normalizeMarketList(markets, []).some((code) => code !== US_MARKET);
}

export function scannedDataIncludesIntl(scannedMarkets = [], analyzedRows = []) {
  if (normalizeMarketList(scannedMarkets, []).some((code) => code !== US_MARKET)) return true;
  for (const code of countRowsByMarket(analyzedRows).keys()) {
    if (code !== US_MARKET) return true;
  }
  return false;
}

export function batchUsShare(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 0;
  const counts = countRowsByMarket(list);
  return (counts.get(US_MARKET) || 0) / list.length;
}

export function batchIsMajorityUs(rows = []) {
  return batchUsShare(rows) >= US_MAJORITY_RATIO;
}

/**
 * True cuando la ficha Líderes intl está activa pero el lote cargado no respalda una lectura intl.
 */
export function isLideresIntlDataMisaligned({
  presetKey = "",
  markets = [],
  scannedMarkets = [],
  analyzedRows = [],
} = {}) {
  if (resolveActiveHuntCard(presetKey, markets)?.id !== "lideres-intl") return false;

  const hasIntlInData = scannedDataIncludesIntl(scannedMarkets, analyzedRows);
  const selectionHasIntl = selectionIncludesIntlMarkets(markets);

  if (!hasIntlInData) return true;
  if (!selectionHasIntl && marketSelectionIncludesUs(markets)) return true;
  if (selectionHasIntl && batchIsMajorityUs(analyzedRows)) return true;
  return false;
}

function formatScannedMarkets(scannedMarkets = []) {
  const codes = normalizeMarketList(scannedMarkets, []);
  return codes.length ? codes.join(", ") : US_MARKET;
}

/**
 * @returns {null | {
 *   tone: string,
 *   label: string,
 *   detail: string,
 *   ctas: Array<{ id: string, label: string, primary?: boolean }>,
 *   source: string,
 * }}
 */
export function buildLideresIntlGuardrailNotice({
  presetKey = "",
  markets = [],
  scannedMarkets = [],
  analyzedRows = [],
} = {}) {
  if (!isLideresIntlDataMisaligned({ presetKey, markets, scannedMarkets, analyzedRows })) {
    return null;
  }

  const hasIntlInData = scannedDataIncludesIntl(scannedMarkets, analyzedRows);
  const selectionHasIntl = selectionIncludesIntlMarkets(markets);
  const rowCount = Array.isArray(analyzedRows) ? analyzedRows.length : 0;
  const scannedLabel = formatScannedMarkets(scannedMarkets);
  const rowSuffix = rowCount > 0 ? ` (${rowCount})` : "";

  let detail;
  if (!hasIntlInData) {
    detail = `Datos cargados: ${scannedLabel}${rowSuffix}. «Líderes intl» espera tickers fuera de US; lo que ves son mayoritariamente 🇺🇸.`;
  } else if (!selectionHasIntl) {
    detail = `Mercados solo US pero la ficha es intl. Los resultados cargados no coinciden con esa expectativa.`;
  } else {
    const usPct = Math.round(batchUsShare(analyzedRows) * 100);
    detail = `El lote cargado es ${usPct}% US aunque la ficha es intl; miles de tickers 🇺🇸 pueden pasar el filtro.`;
  }

  const ctas = [];
  if (!hasIntlInData || !selectionHasIntl) {
    ctas.push({ id: LIDERES_INTL_CTA.LOAD_CORE_INTL, label: "Cargar Core intl", primary: true });
  }
  if (marketSelectionIncludesUs(markets)) {
    ctas.push({ id: LIDERES_INTL_CTA.REMOVE_US, label: "Quitar US" });
  }
  ctas.push({ id: LIDERES_INTL_CTA.SWITCH_ETAPA_2, label: "Cambiar a Líderes E2" });

  return {
    tone: "warn",
    label: "Líderes intl",
    detail,
    ctas,
    source: LIDERES_INTL_GUARDRAIL_SOURCE,
  };
}
