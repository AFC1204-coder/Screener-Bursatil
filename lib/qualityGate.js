export function qualityGateForResearchRow(row = {}, settings = {}) {
  const reasons = [];
  const minBars = settings.setupMode === "ipoRecent" ? 20 : 180;
  if (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount < minBars) reasons.push(`historico ${row.chartBarsCount || 0}/${minBars}`);
  if (!Number.isFinite(row.price) || row.price <= 0) reasons.push("precio no disponible");
  return {
    passed: reasons.length === 0,
    label: reasons.length ? "datos base insuficientes" : "apto",
    reasons,
  };
}
