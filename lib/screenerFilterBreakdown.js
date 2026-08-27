// lib/screenerFilterBreakdown.js — micro-desglose bajo la línea de verdad.
// Reutiliza diagnostics y chips de vista; no calcula un embudo nuevo.

function formatPresetLine(presetName, finalCount, analyzed) {
  return `Ficha «${presetName}» deja ${finalCount} de ${analyzed}`;
}

function formatTopRejection(block) {
  if (!block?.count) return null;
  const label = String(block.label || block.stage || "Filtro").trim();
  return `Principal corte: ${label} (−${block.count})`;
}

function formatViewHiddenLine(hiddenByView, viewChips = []) {
  if (!(Number(hiddenByView) > 0)) return null;
  const chipLabels = viewChips.map((chip) => chip.label).filter(Boolean).slice(0, 2);
  const chipHint = chipLabels.length ? ` (${chipLabels.join(" · ")})` : "";
  return `Vista oculta ${hiddenByView} más${chipHint}`;
}

/**
 * Construye 1–3 líneas de desglose en lenguaje de trader.
 * @param {object} params
 * @param {object|null} params.diagnostics
 * @param {number} params.passCount — filas que pasan el preset (rows.length)
 * @param {string} params.presetName
 * @param {number} params.hiddenByView
 * @param {Array<{label?: string}>} params.viewChips
 */
export function buildScreenerFilterBreakdown({
  diagnostics = null,
  passCount = 0,
  presetName = "Ficha",
  hiddenByView = 0,
  viewChips = [],
} = {}) {
  const lines = [];

  if (diagnostics) {
    const analyzed = Number(diagnostics.analyzed || 0);
    const finalCount = Number.isFinite(Number(diagnostics.finalCount))
      ? Number(diagnostics.finalCount)
      : Number(passCount) || 0;
    if (analyzed > 0) {
      lines.push(formatPresetLine(presetName, finalCount, analyzed));
    }
    const topRejection = formatTopRejection(diagnostics.blocks?.[0]);
    if (topRejection) lines.push(topRejection);
  } else {
    lines.push("Sin desglose del embudo; solo vista");
  }

  const viewLine = formatViewHiddenLine(hiddenByView, viewChips);
  if (viewLine) lines.push(viewLine);

  return {
    summaryLabel: "¿Qué recorta?",
    hasDiagnostics: Boolean(diagnostics),
    lines: lines.slice(0, 3),
  };
}
