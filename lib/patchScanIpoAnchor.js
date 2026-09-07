// lib/patchScanIpoAnchor.js — merge puro de ancla «desde salida» en scan_results (IPO-UX-D2).

import { ipoAnchorFromBars } from "@/lib/ipoDiscoveryView";

/**
 * Calcula y fusiona ipoAnchorClose/ipoAnchorDate en metrics de una fila de scan.
 * No escribe en red.
 *
 * @param {object} metrics
 * @param {Array<{date?: string, close?: number}>} bars serie diaria descendente
 * @returns {{metrics: object, changed: boolean, reason: string, anchor?: object|null}}
 */
export function mergeScanMetricsIpoAnchor(metrics = {}, bars = []) {
  const base = metrics && typeof metrics === "object" && !Array.isArray(metrics)
    ? { ...metrics }
    : {};
  const ipoDate = String(base.ipoDate || "").trim();
  if (!ipoDate) {
    return { metrics: base, changed: false, reason: "no-ipo-date", anchor: null };
  }
  const anchor = ipoAnchorFromBars(bars, ipoDate);
  if (!anchor) {
    return { metrics: base, changed: false, reason: "no-anchor-in-history", anchor: null };
  }
  const same = Number(base.ipoAnchorClose) === anchor.ipoAnchorClose
    && String(base.ipoAnchorDate || "") === anchor.ipoAnchorDate;
  if (same) {
    return { metrics: base, changed: false, reason: "already", anchor };
  }
  return {
    metrics: { ...base, ...anchor },
    changed: true,
    reason: base.ipoAnchorClose ? "refresh" : "patch",
    anchor,
  };
}

export function summarizeIpoAnchorPatchPlan(rows = []) {
  const out = {
    wouldPatch: 0,
    already: 0,
    noIpoDate: 0,
    noHistory: 0,
    sample: [],
  };
  for (const row of rows) {
    if (row.reason === "already") out.already += 1;
    else if (row.reason === "no-ipo-date") out.noIpoDate += 1;
    else if (row.reason === "no-anchor-in-history") out.noHistory += 1;
    else if (row.changed) {
      out.wouldPatch += 1;
      if (out.sample.length < 10) {
        out.sample.push({
          symbol: row.symbol,
          ipoDate: row.metrics?.ipoDate,
          ipoAnchorClose: row.metrics?.ipoAnchorClose,
          ipoAnchorDate: row.metrics?.ipoAnchorDate,
        });
      }
    }
  }
  return out;
}
