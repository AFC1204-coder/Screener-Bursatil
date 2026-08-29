// Teclado en la tabla de resultados del screener (UX-17).
// Enter sobre fila seleccionada abre Vista rápida, no la ficha directa.

export function isScreenerKeyboardTargetIgnored(target) {
  if (!target || typeof target !== "object" || !target.tagName) return false;
  const tag = String(target.tagName).toUpperCase();
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || Boolean(target.isContentEditable);
}

export function screenerEnterReviewSymbol({
  key,
  target,
  selectedResultSymbol = "",
  pagedRows = [],
  activeModalRow = null,
}) {
  if (key !== "Enter") return null;
  if (isScreenerKeyboardTargetIgnored(target)) return null;
  if (!pagedRows.length || activeModalRow) return null;
  const currentIndex = selectedResultSymbol
    ? pagedRows.findIndex((row) => row.symbol === selectedResultSymbol)
    : -1;
  if (currentIndex < 0) return null;
  const row = pagedRows[currentIndex];
  return row?.symbol ? String(row.symbol) : null;
}
