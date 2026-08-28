// lib/screenerHuntCards.js — fichas de caza del rail diario (propuesta A).
// Cada ficha aplica un preset existente + orden por defecto. No inventa umbrales.

import {
  SCREENER_FILTER_PRESETS,
  shouldAutoApplyIntlFilterPreset,
} from "@/lib/screenerFilterCatalog";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";
import { applySortSelection } from "@/lib/screenerSortInvariant";

export const HUNT_CARDS = [
  { id: "lideres-etapa-2", label: "Líderes Etapa 2", presetKey: "balanced", defaultSort: "activePerf" },
  { id: "cerca-pivot", label: "Cerca de pivot", presetKey: "nearPivot", defaultSort: "distance52w" },
  { id: "deterioro", label: "Deterioro", presetKey: "weakness", defaultSort: "weaknessScore" },
  { id: "lideres-intl", label: "Líderes intl", presetKey: "intl", defaultSort: "activePerf" },
  { id: "radar-ipo", label: "Radar IPO", presetKey: "ipoDiscovery", defaultSort: "activePerf" },
];

const HUNT_CARD_BY_ID = Object.fromEntries(HUNT_CARDS.map((card) => [card.id, card]));
const HUNT_CARD_PRESET_KEYS = new Set(HUNT_CARDS.map((card) => card.presetKey));

export function huntCardById(id = "") {
  return HUNT_CARD_BY_ID[String(id || "").trim()] || null;
}

export function isHuntCardPreset(presetKey = "") {
  return HUNT_CARD_PRESET_KEYS.has(String(presetKey || "").trim());
}

export function huntCardForPreset(presetKey = "") {
  const key = String(presetKey || "").trim();
  if (key === "ipo") return HUNT_CARD_BY_ID["radar-ipo"] || null;
  return HUNT_CARDS.find((card) => card.presetKey === key) || null;
}

export function optionalBasePresetEntries() {
  return Object.entries(SCREENER_FILTER_PRESETS).filter(([key]) => !HUNT_CARD_PRESET_KEYS.has(key));
}

/**
 * Ficha activa a partir del preset interno y los mercados.
 * Sin US, un preset US-céntrico se muestra como Líderes intl (el auto-switch
 * de mercados acaba llamando setPreset("intl") en el mismo gesto).
 * Con US, intl elegido a mano sigue siendo Líderes intl: el restore a
 * balanced solo ocurre al cambiar mercados, no al pintar el rail.
 */
export function resolveActiveHuntCard(presetKey = "", markets = []) {
  if (shouldAutoApplyIntlFilterPreset(markets, presetKey)) {
    return huntCardForPreset("intl");
  }
  return huntCardForPreset(presetKey);
}

export function huntDisplayName(presetKey = "", markets = []) {
  const card = resolveActiveHuntCard(presetKey, markets);
  if (card) return card.label;
  return SCREENER_FILTER_PRESETS[presetKey]?.name || "Filtro";
}

export function huntCardSelection(cardId = "", { perfPeriod = "" } = {}) {
  const card = huntCardById(cardId);
  if (!card) return null;
  const sortKey = card.defaultSort === "activePerf"
    ? (perfPeriod || DEFAULT_PERFORMANCE_PERIOD)
    : card.defaultSort;
  const aligned = applySortSelection(sortKey, { perfPeriod });
  return {
    presetKey: card.presetKey,
    sort: aligned.sort,
    sortAsc: false,
  };
}
