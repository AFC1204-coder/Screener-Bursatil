// lib/ipoAnchor.js — ancla de cierre ≥ ipoDate (IPO-UX-D2).
// Módulo puro (sin scoring / UI) para scripts Node y researchRow.

/**
 * Primer cierre usable con date ≥ ipoDate.
 * @param {Array<{date?: string, close?: number}>} bars
 * @param {string} ipoDate
 * @returns {{ipoAnchorClose: number, ipoAnchorDate: string}|null}
 */
export function ipoAnchorFromBars(bars = [], ipoDate = "") {
  const listed = String(ipoDate || "").trim();
  if (!listed) return null;
  const usable = (Array.isArray(bars) ? bars : []).filter(
    (bar) => bar?.date && Number.isFinite(bar.close) && bar.close > 0,
  );
  if (!usable.length) return null;
  const asc = [...usable].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const anchor = asc.find((bar) => String(bar.date) >= listed);
  if (!anchor) return null;
  return { ipoAnchorClose: anchor.close, ipoAnchorDate: anchor.date };
}
