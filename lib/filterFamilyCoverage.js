// lib/filterFamilyCoverage.js — cobertura N/M por familia piloto (UX-FILTERS-4).

import { canonicalRs } from "@/lib/rsCanonical";
import {
  IPO_DATE_COVERAGE_LOW_RATIO,
  IPO_DISCOVERY_PRESET_KEY,
  ipoDateCoverageStats,
  ipoDiscoveryEmptyMessage,
} from "@/lib/ipoDiscoveryView";

export const COVERAGE_PILOT_FAMILIES = ["ipo", "relativeStrength"];

/** Por debajo de esto el lote no alimenta el filtro RS de forma fiable (UX-13 ≈ 47 % sin dato). */
export const RS_COVERAGE_LOW_RATIO = 0.55;

export function rowHasRsDataSignal(row = {}) {
  return canonicalRs(row).available;
}

export function rsCoverageStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return { total: 0, withRsData: 0, ratio: 0, low: true };
  }
  let withRsData = 0;
  for (const row of list) {
    if (rowHasRsDataSignal(row)) withRsData += 1;
  }
  const ratio = withRsData / list.length;
  return {
    total: list.length,
    withRsData,
    ratio,
    low: ratio < RS_COVERAGE_LOW_RATIO,
  };
}

export function filterFamilyCoverageStats(familyKey, rows = []) {
  if (familyKey === "ipo") {
    const stats = ipoDateCoverageStats(rows);
    return {
      familyKey,
      ...stats,
      withData: stats.withIpoDate,
      dataLabel: "ipoDate",
      lowRatio: IPO_DATE_COVERAGE_LOW_RATIO,
    };
  }
  if (familyKey === "relativeStrength") {
    const stats = rsCoverageStats(rows);
    return {
      familyKey,
      ...stats,
      withData: stats.withRsData,
      dataLabel: "RS semanal",
      lowRatio: RS_COVERAGE_LOW_RATIO,
    };
  }
  return null;
}

export function filterFamilyCoverageByPilot(rows = []) {
  return Object.fromEntries(
    COVERAGE_PILOT_FAMILIES.map((key) => [key, filterFamilyCoverageStats(key, rows)]),
  );
}

export function filterFamilyCoverageCardWarning(familyKey, stats, { active = false } = {}) {
  if (!active || !stats) return "";
  if (!stats.low) return "";
  if (familyKey === "ipo") {
    return `⚠ ipoDate en ${stats.withIpoDate}/${stats.total}`;
  }
  if (familyKey === "relativeStrength") {
    return `⚠ RS con dato en ${stats.withRsData}/${stats.total}`;
  }
  return "";
}

export function filterFamilyCoverageModalLine(familyKey, stats) {
  if (!stats) return "";
  if (familyKey === "ipo") {
    return `Cobertura del dato: ipoDate en ${stats.withIpoDate}/${stats.total} del lote`;
  }
  if (familyKey === "relativeStrength") {
    return `Cobertura del dato: RS semanal en ${stats.withRsData}/${stats.total} del lote`;
  }
  return "";
}

export function rsFamilyEmptyMessage({ analyzedCount = 0, coverage = {} } = {}) {
  const total = coverage.total || analyzedCount;
  const withRs = coverage.withRsData ?? 0;

  if (coverage.low && withRs === 0) {
    return "Ningún valor pasa este filtro y ninguna fila del lote trae RS semanal del universo. El ranking se calcula en el proceso nocturno; hasta entonces el filtro RS no puede recortar por fuerza relativa.";
  }
  if (coverage.low) {
    return `Ningún valor pasa este filtro y solo ${withRs} de ${total} filas tienen RS semanal. Los valores sin ranking no entran en el corte RS; afloja la intensidad o espera a la hidratación del lote.`;
  }
  return `Ningún valor de los ${analyzedCount} analizados pasa el filtro RS activo. Afloja la intensidad o revisa las reglas auxiliares.`;
}

export function filterFamilyEmptyMessage(
  familyKey,
  { analyzedCount = 0, coverage = {}, settings = {}, filterLayers = {} } = {},
) {
  if (familyKey === "ipo") {
    return ipoDiscoveryEmptyMessage({ analyzedCount, coverage });
  }
  if (familyKey === "relativeStrength") {
    if (!filterLayers.relativeStrength) return "";
    const minRs = Number(settings.minRsRating);
    if (!Number.isFinite(minRs) || minRs <= 0) return "";
    return rsFamilyEmptyMessage({ analyzedCount, coverage });
  }
  return "";
}

export function shouldUseFamilyEmptyLabel(
  familyKey,
  { rows = [], analyzedRows = [], presetKey = "", filterLayers = {}, settings = {} } = {},
) {
  if (rows.length || !analyzedRows.length) return false;
  if (familyKey === "ipo") {
    return presetKey === IPO_DISCOVERY_PRESET_KEY || (filterLayers.ipo && settings.requireRecentIpo);
  }
  if (familyKey === "relativeStrength") {
    const minRs = Number(settings.minRsRating);
    return filterLayers.relativeStrength && Number.isFinite(minRs) && minRs > 0;
  }
  return false;
}
