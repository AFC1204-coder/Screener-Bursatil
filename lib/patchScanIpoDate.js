// lib/patchScanIpoDate.js — merge puro de ipoDate en metrics de scan_results (IPO-NOCT).

import { IPO_DATE_SOURCES, IPO_DATE_UNAVAILABLE, ipoDateResult } from "@/lib/ipoDate";

/**
 * Aplica fecha de perfil cacheado sobre metrics de una fila de scan.
 * No escribe en red. Si no hay fecha de perfil, deja metrics intactas.
 *
 * @param {object} metrics
 * @param {{ipoDate?: string, ipoDateSource?: string|null}} profile
 * @returns {{metrics: object, changed: boolean, reason: string}}
 */
export function mergeScanMetricsIpoDate(metrics = {}, profile = {}) {
  const base = metrics && typeof metrics === "object" && !Array.isArray(metrics)
    ? { ...metrics }
    : {};
  const existing = String(base.ipoDate || "").trim();
  const resolved = ipoDateResult(
    profile?.ipoDate,
    profile?.ipoDateSource || IPO_DATE_SOURCES.profile,
  );
  if (!resolved.ipoDate) {
    return { metrics: base, changed: false, reason: "no-profile-date" };
  }
  if (existing === resolved.ipoDate
    && Number(base.ipoAgeMonths) === resolved.ipoAgeMonths
    && String(base.ipoDateSource || "") === String(resolved.ipoDateSource || "")) {
    return { metrics: base, changed: false, reason: "already" };
  }
  const next = {
    ...base,
    ipoDate: resolved.ipoDate,
    ipoAgeMonths: resolved.ipoAgeMonths,
    ipoDateSource: resolved.ipoDateSource,
  };
  if (next.ipoDateReason === IPO_DATE_UNAVAILABLE || next.ipoDateReason == null) {
    delete next.ipoDateReason;
  }
  return { metrics: next, changed: true, reason: existing ? "refresh" : "patch" };
}

export function summarizePatchPlan(rows = []) {
  const out = { wouldPatch: 0, already: 0, noProfile: 0, sample: [] };
  for (const row of rows) {
    if (row.reason === "already") out.already += 1;
    else if (row.reason === "no-profile-date") out.noProfile += 1;
    else if (row.changed) {
      out.wouldPatch += 1;
      if (out.sample.length < 10) {
        out.sample.push({
          symbol: row.symbol,
          ipoDate: row.metrics?.ipoDate,
          ipoAgeMonths: row.metrics?.ipoAgeMonths,
          ipoDateSource: row.metrics?.ipoDateSource,
        });
      }
    }
  }
  return out;
}
