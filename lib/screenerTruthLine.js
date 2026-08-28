// lib/screenerTruthLine.js — una sola frase de verdad para el screener
// (analizadas / pasan / visibles / orden / fecha de corte).

import { dateTime } from "@/lib/formatters";
import { analyzedCountForDisplay } from "@/lib/screenerFormat";
import { SORT_LABELS } from "@/lib/screenerConfig";

function sortDirectionLabel(sortAsc) {
  return sortAsc ? "↑" : "↓";
}

function formatSortLabel(sort, sortAsc) {
  const base = SORT_LABELS[sort] || sort || "—";
  return `${base} ${sortDirectionLabel(sortAsc)}`;
}

/**
 * Construye la línea de verdad del screener.
 * @param {object} params
 * @param {Array} params.analyzedRows
 * @param {number} params.passCount — filas que pasan el preset (rows.length)
 * @param {number} params.visibleCount — filas visibles tras filtros de vista (filtered.length)
 * @param {string} params.presetName — nombre del preset activo
 * @param {string} params.sort
 * @param {boolean} params.sortAsc
 * @param {string|Date|null} params.scannedAt
 */
export function buildScreenerTruthLine({
  analyzedRows = [],
  passCount = 0,
  visibleCount = 0,
  presetName = "Filtro",
  sort = "",
  sortAsc = false,
  scannedAt = null,
} = {}) {
  const analyzed = analyzedCountForDisplay(analyzedRows);
  const parts = [
    `${analyzed} analizadas`,
    `${passCount} pasan «${presetName}»`,
    `${visibleCount} visibles`,
    `orden: ${formatSortLabel(sort, sortAsc)}`,
  ];
  if (scannedAt) {
    parts.push(`corte ${dateTime(scannedAt)}`);
  }
  return parts.join(" · ");
}

export function marketCountLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? "1 mercado" : `${n} mercados`;
}
