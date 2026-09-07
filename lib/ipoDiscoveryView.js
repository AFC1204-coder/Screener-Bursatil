// lib/ipoDiscoveryView.js — cobertura ipoDate y copy del empty state Radar IPO (IPO-1b).

import { dateShort } from "@/lib/formatters";
import { ipoAgeMonthsForRow } from "@/lib/scoring";

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
