// lib/screenerTruthLine.js — una sola frase de verdad para el screener
// (analizadas / pasan / en lista / orden / fecha de corte).

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

function formatListCountSegment(visibleCount, pageSize, totalPages) {
  let segment = `${visibleCount} en lista`;
  const size = Number(pageSize);
  if (size > 0) {
    const pages = Number(totalPages);
    const showPageHint = (pages > 1) || (visibleCount > size);
    if (showPageHint) {
      segment += ` · ${size}/página`;
    }
  }
  return segment;
}

/**
 * Construye la línea de verdad del screener.
 * @param {object} params
 * @param {Array} params.analyzedRows
 * @param {number} params.passCount — filas que pasan el preset (rows.length)
 * @param {number} params.visibleCount — filas en lista tras filtros de vista (filtered.length)
 * @param {number} [params.pageSize] — tamaño de página del pager (opcional)
 * @param {number} [params.totalPages] — páginas totales del pager (opcional)
 * @param {string} params.presetName — nombre del preset activo
 * @param {string} params.sort
 * @param {boolean} params.sortAsc
 * @param {string|Date|null} params.scannedAt
 */
export function buildScreenerTruthLine({
  analyzedRows = [],
  passCount = 0,
  visibleCount = 0,
  pageSize,
  totalPages,
  presetName = "Filtro",
  sort = "",
  sortAsc = false,
  scannedAt = null,
} = {}) {
  const analyzed = analyzedCountForDisplay(analyzedRows);
  const parts = [
    `${analyzed} analizadas`,
    `${passCount} pasan «${presetName}»`,
    formatListCountSegment(visibleCount, pageSize, totalPages),
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
