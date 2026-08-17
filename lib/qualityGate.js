// La puerta previa a cualquier criterio del screener: sin precio y sin
// histórico suficiente, ninguna regla significa nada.
//
// ── Las filas ligeras y el histórico que no se escribió ───────────────────
// El escaneo nocturno guarda la población entera: las filas que pasan el
// preset van completas y el resto en proyección ligera
// (lib/scanLightProjection.js). Esa proyección no incluía `chartBarsCount`
// hasta el 2026-08-17, así que las filas ligeras ya guardadas llegan al
// navegador sin él. Rechazarlas por eso no protege de nada y rompe el
// producto: medido ese día sobre el nocturno entero, 41 de 3.312 filas
// llevaban el campo, de modo que el usuario filtraba sobre 41 acciones
// creyendo filtrar sobre el universo.
//
// Para esas filas la exigencia de histórico ya la aplicó quien las escribió:
// baseRejectReason (lib/materializedScanner.js) descarta el símbolo con
// "histórico insuficiente <180" ANTES de que pueda convertirse en fila
// ligera, con el mismo umbral de 180 barras que pide esta puerta. Una fila
// ligera existe, por construcción, solo si tenía histórico suficiente. Eso no
// es suponer un dato: es leer la garantía del productor, y por eso se acepta
// únicamente cuando el campo falta (`rowProjection === "light"`), nunca
// cuando viene con un valor por debajo del mínimo.
export function qualityGateForResearchRow(row = {}, settings = {}) {
  const reasons = [];
  const minBars = settings.setupMode === "ipoRecent" ? 20 : 180;
  const lightRowWithoutBarCount = row.rowProjection === "light" && row.chartBarsCount == null;
  if (!lightRowWithoutBarCount && (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount < minBars)) {
    reasons.push(`histórico ${row.chartBarsCount || 0}/${minBars}`);
  }
  if (!Number.isFinite(row.price) || row.price <= 0) reasons.push("precio no disponible");
  return {
    passed: reasons.length === 0,
    label: reasons.length ? "datos base insuficientes" : "apto",
    reasons,
  };
}
