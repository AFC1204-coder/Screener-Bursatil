// lib/huntCardRsPresentation.js — presentación honesta de RS en Líderes Etapa 2 (UX-13 opción D).
// Chip RS N/M sobre filas que pasan la ficha; copy corto; sin tocar motor ni minRsRating.

import { rsCoverageStats } from "@/lib/filterFamilyCoverage";
import { huntCardById, resolveActiveHuntCard } from "@/lib/screenerHuntCards";

export const HUNT_RS_LEADERS_CARD_ID = "lideres-etapa-2";

export const HUNT_RS_COPY_SHORT =
  "RS = ranking semanal del universo privado. Sin dato aquí no significa que el valor falle la etapa.";

export function huntCardShowsRsCoverage({ cardId = "", presetKey = "", markets = [] } = {}) {
  const card = cardId
    ? huntCardById(cardId)
    : resolveActiveHuntCard(presetKey, markets);
  return card?.id === HUNT_RS_LEADERS_CARD_ID;
}

export function huntCardRsCoverageFromPassedRows(passedRows = []) {
  return rsCoverageStats(passedRows);
}

export function huntCardRsChipLabel(stats = {}) {
  const total = Number(stats.total) || 0;
  const withRs = Number(stats.withRsData) || 0;
  if (!total) return "";
  return `RS ${withRs}/${total}`;
}

/**
 * Chip de verdad local: RS con dato entre los que pasan la ficha (no el lote entero).
 * @returns {null | { label: string, title: string, stats: ReturnType<typeof rsCoverageStats> }}
 */
export function buildHuntCardRsChip({
  cardId = "",
  presetKey = "",
  markets = [],
  passedRows = [],
} = {}) {
  if (!huntCardShowsRsCoverage({ cardId, presetKey, markets })) return null;
  const stats = huntCardRsCoverageFromPassedRows(passedRows);
  if (!stats.total) return null;
  return {
    label: huntCardRsChipLabel(stats),
    title: HUNT_RS_COPY_SHORT,
    stats,
  };
}
