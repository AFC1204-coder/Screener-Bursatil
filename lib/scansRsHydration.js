// lib/scansRsHydration.js — modo de hidratación RS en GET /api/scans (PERF-NAC).

/** @returns {"core"|"extended"} */
export function scanRsHydrationMode({
  full = false,
  decisionProjection = false,
  hydrateRsParam = null,
} = {}) {
  if (full || decisionProjection) return "extended";
  const param = String(hydrateRsParam ?? "").trim();
  if (param === "1" || param === "extended") return "extended";
  if (param === "0" || param === "core") return "core";
  // Compacto de mesa: global RS + market cap. La mesa completa (filtros/columnas
  // weeklyCountryRsRating y weeklyThemeRsRating) requiere extended — ?hydrateRs=1.
  return "core";
}
