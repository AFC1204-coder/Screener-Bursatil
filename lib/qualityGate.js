export function qualityGateForResearchRow(row = {}, settings = {}) {
  const reasons = [];
  const minBars = settings.setupMode === "ipoRecent" ? 20 : 180;
  if (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount < minBars) reasons.push(`historico ${row.chartBarsCount || 0}/${minBars}`);
  if (!Number.isFinite(row.price) || row.price <= 0) reasons.push("precio no disponible");
  if ((settings.minPrice || 0) > 0 && (!Number.isFinite(row.price) || row.price < settings.minPrice)) reasons.push("precio insuficiente");
  if ((settings.minMarketCap || 0) > 0 && (!Number.isFinite(row.marketCap) || row.marketCap < settings.minMarketCap)) reasons.push("capitalizacion insuficiente");
  if ((settings.minAvgTurnover || 0) > 0 && (!Number.isFinite(row.avgTurnover) || row.avgTurnover < settings.minAvgTurnover)) reasons.push("importe medio insuficiente");
  if ((settings.minAvgVolume || 0) > 0 && (!Number.isFinite(row.avgVolume) || row.avgVolume < settings.minAvgVolume)) reasons.push("volumen medio insuficiente");
  if ((settings.minDataCoverageScore || 0) > 0 && (!Number.isFinite(row.dataCoverageScore) || row.dataCoverageScore < settings.minDataCoverageScore)) reasons.push("cobertura insuficiente");
  if ((settings.minTechnicalCoverageScore || 0) > 0 && (!Number.isFinite(row.technicalCoverageScore) || row.technicalCoverageScore < settings.minTechnicalCoverageScore)) reasons.push("cobertura tecnica insuficiente");
  return {
    passed: reasons.length === 0,
    label: reasons.length ? "rechazo pre-filtro" : "apto",
    reasons,
  };
}
