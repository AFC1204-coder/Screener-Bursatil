// lib/screenerComposite.js — extracción canónica del composite por universo.
//
// Contexto: hasta 2026-07-10, `sectorize` (cálculo de sectorScore + composite)
// vivía duplicado en lib/screenerPipeline.js y lib/materializedScanner.js,
// con dos problemas documentados en el audit docs/screener-design-audit-2026-07-10.md
// (hallazgo C2):
//
//   (a) Se calculaba por lote (≤50 filas en el scan de servidor, ≤40 en el cron
//       repartidas entre ~11 mercados), con grupos de 1-3 miembros por tema — la
//       señal era mayormente ruido de composición de lote, no fuerza de grupo.
//
//   (b) Llevaba un bonus estático +20/+10 hardcodeado si el tema matcheaba el
//       regex /Semis|fotonica|Defensa|Software|Energia|Automatizacion/ — el 20%
//       del rango de una señal con peso 0.10 en el composite era una preferencia
//       sectorial fija, en un score comercializado como "objetivo".
//
// Este módulo es la fase 1 del ADR docs/adr-scoring-pipeline-canon.md: una
// ÚNICA definición de la señal de grupo, sin bonus, lista para ejecutarse
// sobre la población completa del scan en el paso de finalización
// (mismo tratamiento que rsGlobalPct — ver lib/scanPercentileFinalization.js).
//
// ─────────────────────────────────────────────────────────────────────────
// CONTRATO NUEVO (válido desde la consolidación, antes de la fase 2 del ADR)
// ─────────────────────────────────────────────────────────────────────────
//
// Fórmula del grupo (única, sin bonus, determinista):
//
//   sectorScore(group) = clamp(
//     clamp(groupSize * 10, 0, 25) +
//     clamp(avg(perf3m del grupo),    0, 20) +
//     clamp(avg(perf6m del grupo) / 2, 0, 20) +
//     clamp(leaders * 7,              0, 15)
//   )
//
//   donde leaders = #{row ∈ group : weinsteinScore ≥ 80 || minerviniScore ≥ 80}.
//
// RANGO EFECTIVO: el máximo teórico baja de 100 a 80 (sin el término del regex).
// Decisión explícita: NO renormalizamos (×1.25 u otro factor). Renormalizar
// escondería bajo un factor que la fórmula ya no aporta los 20 puntos que el
// bonus hardcodeado daba — exactamente lo que el audit y el prompt llaman a
// evitar ("no la escondas"). El peso 0.10 sobre 80 da un aporte máximo de 8
// puntos al composite (antes 10); se documenta en ratingModel.
//
// APLICACIÓN: computeSectorScoresForRows recibe TODAS las filas del scan
// (población completa), agrupa por theme (con fallback a sector y luego
// 'Sin grupo'), calcula sectorScore por grupo y devuelve un Map. Esto
// cierra (a): la señal se mide sobre la población completa, no sobre el lote
// de scoring.
//
// PROPAGACIÓN: applySectorScores inyecta sectorScore + groupStrengthScore
// (alias histórico) en cada fila. El caller (scanPercentileFinalization)
// recomputa objectiveScore/compositeScore en el mismo patch atómico que
// recalcula los percentiles RS — cierra (c) del audit para esta señal.
//
// CRON: este helper también lo consume lib/materializedScanner.js, pero la
// finalización no se ejecuta en el cron (ADR fase 3 lo deja fuera de scope).
// Las filas del cron siguen calculando sectorScore por lote y manteniendo
// percentileScope: "batch" hasta que fase 3 migre la finalización.
//
// ─────────────────────────────────────────────────────────────────────────

import { avg, clamp } from "@/lib/indicators";

// Fallback jerárquico de grouping key (orden de preferencia): theme > sector
// > literal "Sin grupo". Coherente con cómo enrichRelativePercentiles cae a
// countryCode(symbol) cuando country/theme faltan.
function groupingKeyForRow(row = {}) {
  const theme = typeof row.theme === "string" ? row.theme.trim() : "";
  if (theme) return theme;
  const sector = typeof row.sector === "string" ? row.sector.trim() : "";
  if (sector) return sector;
  return "Sin grupo";
}

// ¿La fila cuenta como "líder" del grupo? Mismo umbral que la fórmula previa
// (weinsteinScore ≥ 80 || minerviniScore ≥ 80) — sólo cambia el contexto:
// ahora se cuenta por grupo sobre la población completa del scan, no por lote.
function isLeader(row = {}) {
  const w = Number(row.weinsteinScore);
  const m = Number(row.minerviniScore);
  return (Number.isFinite(w) && w >= 80) || (Number.isFinite(m) && m >= 80);
}

/**
 * Calcula el sectorScore de un grupo de filas (todas del mismo theme).
 * Pure. No I/O.
 *
 * @param {Array<object>} group - filas del grupo; se leen perf3m, perf6m,
 *   weinsteinScore, minerviniScore. Filas sin esos campos aportan 0 al avg
 *   (Number.isFinite los filtra), igual que la fórmula previa.
 * @returns {number} sectorScore clamped 0-100 (rango efectivo 0-80).
 */
export function sectorScoreForGroup(group = []) {
  const rows = Array.isArray(group) ? group : [];
  const groupSize = rows.length;
  const avg3 = avg(rows.map((row) => row.perf3m || 0));
  const avg6 = avg(rows.map((row) => row.perf6m || 0));
  const leaders = rows.filter(isLeader).length;
  const raw = clamp(groupSize * 10, 0, 25)
    + clamp(Number.isFinite(avg3) ? avg3 : 0, 0, 20)
    + clamp(Number.isFinite(avg6) ? avg6 / 2 : 0, 0, 20)
    + clamp(leaders * 7, 0, 15);
  // clamp final 0-100: el rango efectivo del cálculo es 0-80 (ver cabecera).
  return clamp(raw, 0, 100);
}

/**
 * Calcula sectorScores para TODAS las filas del scan (población completa),
 * agrupadas por theme (con fallback a sector > "Sin grupo"). Devuelve un
 * Map<groupingKey, sectorScore>.
 *
 * Pure. Idempotente sobre el mismo input.
 *
 * @param {Array<object>} rows - filas del scan (sin filtrar; pasar TODAS).
 * @returns {Map<string, number>} sectorScore por groupingKey.
 */
export function computeSectorScoresForRows(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = groupingKeyForRow(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const scores = new Map();
  for (const [key, group] of groups) {
    scores.set(key, sectorScoreForGroup(group));
  }
  return scores;
}

/**
 * Aplica los sectorScores calculados a cada fila. Inyecta `sectorScore`
 * (lookup por theme con fallback) y `groupStrengthScore: sectorScore`
 * (alias histórico que los consumers leen como fallback).
 *
 * Devuelve un NUEVO array; no muta las filas de entrada.
 *
 * @param {Array<object>} rows
 * @param {Map<string, number>} sectorScoresByKey
 * @param {{defaultScore?: number, defaultKey?: string}} [options]
 *   - defaultScore: valor cuando no hay match por theme (default 40, igual
 *     que la fórmula previa).
 *   - defaultKey: key a probar primero cuando la fila no tiene theme; útil
 *     para que el fallback sea explícito en los tests.
 * @returns {Array<object>} filas con sectorScore + groupStrengthScore.
 */
export function applySectorScores(rows = [], sectorScoresByKey, options = {}) {
  const defaultScore = Number.isFinite(options.defaultScore) ? options.defaultScore : 40;
  const scores = sectorScoresByKey instanceof Map ? sectorScoresByKey : new Map();
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => {
    const key = groupingKeyForRow(row);
    const score = scores.has(key)
      ? scores.get(key)
      : scores.has("Sin grupo")
        ? scores.get("Sin grupo")
        : defaultScore;
    return { ...row, sectorScore: score, groupStrengthScore: score };
  });
}