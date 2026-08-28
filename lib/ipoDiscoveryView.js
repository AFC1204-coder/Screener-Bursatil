// lib/ipoDiscoveryView.js — cobertura ipoDate y copy del empty state Radar IPO (IPO-1b).

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

export function ipoDiscoveryEmptyMessage({ analyzedCount = 0, coverage = {} } = {}) {
  const total = coverage.total || analyzedCount;
  const withIpo = coverage.withIpoDate ?? 0;

  if (coverage.low && withIpo === 0) {
    return "Ningún valor pasa Radar IPO: el escaneo cargado aún no trae fechas de salida (ipoDate) en las filas materializadas. El nocturno las rellena desde el perfil cacheado; hasta entonces usa IPO Radar para vigiladas pre-IPO.";
  }
  if (coverage.low) {
    return `Ningún valor pasa Radar IPO y solo ${withIpo} de ${total} filas tienen fecha de salida confirmada. Afloja el filtro o revisa candidatos en IPO Radar.`;
  }
  return `Ningún valor de los ${analyzedCount} analizados pasa este filtro de IPO reciente. Afloja alguna condición o añade vigiladas en IPO Radar.`;
}
