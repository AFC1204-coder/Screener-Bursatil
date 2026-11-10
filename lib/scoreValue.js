// lib/scoreValue.js — número de puntuación (RS, percentiles) o null.
//
// `Number(null)` es 0 y `Number.isFinite(0)` es true: el patrón
// `Number.isFinite(Number(x)) ? Number(x) : null` convierte un RS AUSENTE en
// un «0» pintado como dato (estudio móvil 2026-11, M3: «RS global 0» en la
// vista rápida de TJGC). Mismo criterio que `isScore` de
// app/UniversalPriceChart.jsx: null, undefined y "" son ausencia.

export function isScore(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function scoreOrNull(value) {
  return isScore(value) ? Number(value) : null;
}
