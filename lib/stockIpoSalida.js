// lib/stockIpoSalida.js — contexto de salida IPO en ficha /stock (IPO-UX-E).
// Reutiliza la misma semántica que la mesa IPO (lib/ipoDiscoveryView.js).

import { dateShort, pct as formatPct } from "@/lib/formatters";
import {
  ipoDesdeSalidaAbsenceReason,
  ipoDesdeSalidaPct,
  ipoSalidaCellLabel,
  rowIpoSalidaDate,
} from "@/lib/ipoDiscoveryView";
import { ipoAgeMonthsForRow } from "@/lib/scoring";

function usableBars(bars = []) {
  return (Array.isArray(bars) ? bars : []).filter(
    (bar) => bar?.date && Number.isFinite(bar.close) && bar.close > 0,
  );
}

function currentPriceFromBrief(brief = {}) {
  const quote = Number(brief?.quoteSnapshot?.price);
  if (Number.isFinite(quote) && quote > 0) return quote;
  const last = usableBars(brief.chartBars).at(-1);
  return Number.isFinite(last?.close) && last.close > 0 ? last.close : null;
}

/** Mapea company-brief a la forma de fila que esperan los helpers de mesa IPO. */
export function briefToIpoSalidaRow(brief = {}) {
  const bars = usableBars(brief.chartBars);
  return {
    ipoDate: String(brief.ipoDate || "").trim(),
    ipoAgeMonths: brief.ipoAgeMonths ?? null,
    ipoAnchorClose: brief.ipoAnchorClose,
    ipoAnchorDate: brief.ipoAnchorDate,
    price: currentPriceFromBrief(brief),
    chartPreview: bars,
  };
}

export function buildStockIpoSalidaContext(brief = {}) {
  const ipoDate = String(brief.ipoDate || "").trim();
  if (!ipoDate) {
    return { visible: false };
  }

  const row = briefToIpoSalidaRow(brief);
  const salida = rowIpoSalidaDate(row);
  const salidaLabel = ipoSalidaCellLabel(row);
  const ageMonths = ipoAgeMonthsForRow(row);
  const desdeSalidaPct = ipoDesdeSalidaPct(row);
  const desdeSalidaReason = ipoDesdeSalidaAbsenceReason(row);

  let salidaDisplay = "—";
  let salidaTitle = "";
  if (salida.kind === "listed") {
    salidaDisplay = dateShort(salida.date);
  } else if (typeof salidaLabel === "string") {
    salidaDisplay = salidaLabel;
  } else if (salidaLabel?.text) {
    salidaDisplay = salidaLabel.text;
    salidaTitle = salidaLabel.title || "";
  } else {
    salidaTitle = salidaLabel?.title || "Sin fecha de salida verificable para este valor.";
  }

  const ageDisplay = Number.isFinite(ageMonths) && ageMonths >= 0
    ? `${Math.round(ageMonths)}m`
    : null;

  return {
    visible: true,
    salidaDate: salida.kind === "listed" ? salida.date : "",
    salidaDisplay,
    salidaTitle,
    ageMonths: Number.isFinite(ageMonths) ? ageMonths : null,
    ageDisplay,
    desdeSalidaPct,
    desdeSalidaDisplay: Number.isFinite(desdeSalidaPct) ? formatPct(desdeSalidaPct) : "—",
    desdeSalidaReason,
  };
}
