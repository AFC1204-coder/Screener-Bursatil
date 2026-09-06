// lib/ipoCohortWindowChips.js — ventanas de edad IPO en ficha «IPO recientes» (IPO-UX-A).

import { IPO_DISCOVERY_PRESET_KEY } from "@/lib/ipoDiscoveryView";
import { screenerFilterRejectReason } from "@/lib/screenerFilters";

export const IPO_COHORT_WINDOW_MONTHS = [6, 12, 24, 36];
export const IPO_COHORT_DEFAULT_MONTHS = 24;

export function isIpoCohortLensActive({ presetKey = "", cardId = "" } = {}) {
  if (presetKey === IPO_DISCOVERY_PRESET_KEY) return true;
  return cardId === "radar-ipo";
}

function countPassingRows(analyzedRows = [], settings = {}) {
  const filters = { enabled: true, values: settings };
  let count = 0;
  for (const row of analyzedRows) {
    if (!screenerFilterRejectReason(row, filters)) count += 1;
  }
  return count;
}

/**
 * @param {{ analyzedRows?: object[], baseSettings?: object, activeMonths?: number }} params
 * @returns {Array<{ months: number, label: string, count: number, active: boolean }>}
 */
export function buildIpoCohortWindowChips({
  analyzedRows = [],
  baseSettings = {},
  activeMonths = IPO_COHORT_DEFAULT_MONTHS,
} = {}) {
  const months = Number(activeMonths) || IPO_COHORT_DEFAULT_MONTHS;
  return IPO_COHORT_WINDOW_MONTHS.map((windowMonths) => ({
    months: windowMonths,
    label: `${windowMonths}m`,
    count: countPassingRows(analyzedRows, { ...baseSettings, maxIpoAgeMonths: windowMonths }),
    active: months === windowMonths,
  }));
}
