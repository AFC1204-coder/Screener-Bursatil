// lib/ipoDiscoveryView.js — cobertura ipoDate y copy del empty state Radar IPO (IPO-1b).

import { dateShort } from "@/lib/formatters";
import { ipoAnchorFromBars } from "@/lib/ipoAnchor";
import { ipoAgeMonthsForRow } from "@/lib/scoring";

export { ipoAnchorFromBars } from "@/lib/ipoAnchor";

export const IPO_DISCOVERY_PRESET_KEY = "ipoDiscovery";

/** Por debajo de esto el escaneo aún no alimenta el filtro IPO de forma fiable. */
export const IPO_DATE_COVERAGE_LOW_RATIO = 0.05;

export function rowHasIpoDateSignal(row = {}) {
  const date = String(row.ipoDate || row.snapshot?.ipoDate || "").trim();
  if (date) return true;
  const age = ipoAgeMonthsForRow(row);
  return Number.isFinite(age) && age >= 0;
}

export function ipoDateCoverageStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return { total: 0, withIpoDate: 0, ratio: 0, low: true };
  }
  let withIpoDate = 0;
  for (const row of list) {
    if (rowHasIpoDateSignal(row)) withIpoDate += 1;
  }
  const ratio = withIpoDate / list.length;
  return {
    total: list.length,
    withIpoDate,
    ratio,
    low: ratio < IPO_DATE_COVERAGE_LOW_RATIO,
  };
}

export function rowIpoSalidaDate(row = {}) {
  const listed = String(row.ipoDate || row.snapshot?.ipoDate || "").trim();
  if (listed) return { date: listed, kind: "listed" };
  const expected = String(row.expectedTradeDate || "").trim();
  if (row.ipoWatchOnly && expected) return { date: expected, kind: "expected" };
  return { date: "", kind: "missing" };
}

export function ipoDateSortValue(row = {}) {
  const { date } = rowIpoSalidaDate(row);
  return date || null;
}

export function ipoSalidaCellLabel(row = {}) {
  const salida = rowIpoSalidaDate(row);
  if (salida.kind === "listed") return dateShort(salida.date);
  if (salida.kind === "expected") return `${dateShort(salida.date)} · est.`;
  if (row.ipoWatchOnly) {
    return { text: "Pre-IPO", title: "Vigilada local sin fecha de cotización confirmada." };
  }
  const age = ipoAgeMonthsForRow(row);
  if (Number.isFinite(age) && age >= 0) {
    return { text: `${age.toFixed(0)}m`, title: "Edad IPO estimada sin fecha verificable en el materializado." };
  }
  return {
    text: "",
    title: "Sin fecha de salida verificable para este valor.",
  };
}

// ── Desde salida (IPO-UX-D / D2) ──────────────────────────────────────────
// % desde la salida: precio actual vs primer cierre usable ≥ ipoDate.
//
// Convención:
//   - Solo IPO ya cotizada (`ipoDate` verificada); pre-IPO / fecha estimada → ausencia.
//   - Ancla preferida: `ipoAnchorClose` + `ipoAnchorDate` persistidos en scan
//     (IPO-UX-D2, calculados desde la serie completa en buildResearchRow).
//   - Fallback: primera barra de chartPreview con date ≥ ipoDate y close > 0.
//   - Actual: row.price; si falta, último close de chartPreview.
//   - Si chartPreview (~48 sesiones en fila ligera) no alcanza ipoDate y no hay
//     ancla persistida, no se inventa ancla ni se pide serie extra aquí.
export function rowChartPreviewBars(row = {}) {
  const preview = row.chartPreview;
  if (!Array.isArray(preview) || !preview.length) return [];
  return preview.filter((bar) => bar?.date && Number.isFinite(bar.close) && bar.close > 0);
}

export function ipoDesdeSalidaAnchorClose(row = {}) {
  const salida = rowIpoSalidaDate(row);
  if (salida.kind === "expected") {
    return { close: null, reason: "Fecha de salida estimada (pre-IPO): sin cierre de mercado para anclar." };
  }
  if (salida.kind !== "listed" || !salida.date) {
    if (row.ipoWatchOnly) {
      return { close: null, reason: "Vigilada pre-IPO sin cotización: no hay rendimiento desde salida." };
    }
    return { close: null, reason: "Sin fecha de salida verificada para anclar el rendimiento." };
  }
  const persistedClose = Number(row.ipoAnchorClose);
  const persistedDate = String(row.ipoAnchorDate || "").trim();
  if (Number.isFinite(persistedClose) && persistedClose > 0 && persistedDate) {
    return { close: persistedClose, date: persistedDate, reason: null };
  }
  const bars = rowChartPreviewBars(row);
  if (!bars.length) {
    return { close: null, reason: "Sin serie de precios en la fila para calcular el rendimiento desde la salida." };
  }
  const earliest = String(bars[0].date);
  const anchor = bars.find((bar) => String(bar.date) >= salida.date);
  if (!anchor) {
    return {
      close: null,
      reason: "La serie disponible en la fila no alcanza hasta la fecha de salida.",
    };
  }
  if (earliest > salida.date) {
    const ageMonths = ipoAgeMonthsForRow(row);
    // IPO muy reciente: la ventana puede empezar en la primera sesión tras el día de salida.
    if (!Number.isFinite(ageMonths) || ageMonths > 2) {
      return {
        close: null,
        reason: "La serie disponible en la fila no alcanza hasta la fecha de salida.",
      };
    }
  }
  return { close: anchor.close, date: anchor.date, reason: null };
}

export function ipoDesdeSalidaPct(row = {}) {
  const anchor = ipoDesdeSalidaAnchorClose(row);
  if (!Number.isFinite(anchor.close) || anchor.close <= 0) return null;
  const bars = rowChartPreviewBars(row);
  const current = Number.isFinite(row.price) && row.price > 0
    ? row.price
    : bars.at(-1)?.close;
  if (!Number.isFinite(current) || current <= 0) return null;
  return ((current / anchor.close) - 1) * 100;
}

export function ipoDesdeSalidaSortValue(row = {}) {
  const value = ipoDesdeSalidaPct(row);
  return Number.isFinite(value) ? value : null;
}

export function ipoDesdeSalidaAbsenceReason(row = {}) {
  if (Number.isFinite(ipoDesdeSalidaPct(row))) return "";
  const anchor = ipoDesdeSalidaAnchorClose(row);
  if (anchor.reason) return anchor.reason;
  return "Sin precio actual para calcular el rendimiento desde la salida.";
}

export function ipoDiscoveryEmptyMessage({ analyzedCount = 0, coverage = {} } = {}) {
  const total = coverage.total || analyzedCount;
  const withIpo = coverage.withIpoDate ?? 0;

  if (coverage.low && withIpo === 0) {
    return "Ningún valor pasa Radar IPO: el escaneo cargado aún no trae fechas de salida (ipoDate) en las filas materializadas. El nocturno las rellena desde el perfil cacheado.";
  }
  if (coverage.low) {
    return `Ningún valor pasa Radar IPO y solo ${withIpo} de ${total} filas tienen fecha de salida confirmada. Afloja el filtro o espera a que el nocturno complete la cobertura.`;
  }
  return `Ningún valor de los ${analyzedCount} analizados pasa este filtro de IPO reciente. Afloja alguna condición.`;
}
