// lib/screenerHuntCards.js — fichas de caza del rail diario (propuesta A).
// Cada ficha aplica un preset existente + orden por defecto. No inventa umbrales.

import {
  SCREENER_FILTER_PRESETS,
  shouldAutoApplyIntlFilterPreset,
} from "@/lib/screenerFilterCatalog";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";
import { applySortSelection } from "@/lib/screenerSortInvariant";

export const HUNT_CARDS = [
  { id: "lideres-etapa-2", label: "Líderes Etapa 2", glyph: "2", presetKey: "balanced", defaultSort: "activePerf" },
  { id: "cerca-pivot", label: "Cerca de pivot", glyph: "◦", presetKey: "nearPivot", defaultSort: "distance52w" },
  { id: "deterioro", label: "Deterioro", glyph: "↘", presetKey: "weakness", defaultSort: "weaknessScore" },
  { id: "lideres-intl", label: "Líderes intl", glyph: "∘", presetKey: "intl", defaultSort: "activePerf" },
  { id: "radar-ipo", label: "IPO recientes", glyph: "n", presetKey: "ipoDiscovery", defaultSort: "ipoDate" },
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

// ── Raíl de vistas (rediseño 2026-11, paso 6) ─────────────────────────────
// «Esta noche»: las cuatro cifras de /api/weekly-changes convertidas en colas.
// Una cola externa no es un preset: es una lista de símbolos que se busca en
// las filas ya analizadas (sin el filtro de la ficha: una salida de Etapa 2 no
// pasaría «Líderes Etapa 2»). Las capas de vista (país, tema…) siguen
// aplicando encima. Ventana real = la del payload (desde el viernes anterior).

const WEEKLY_QUEUE_DEFS = [
  { id: "entradas-e2", label: "Entradas en Etapa 2", glyph: "+", pick: (p) => p?.stage2?.entries },
  { id: "salidas-e2", label: "Salidas de Etapa 2", glyph: "−", pick: (p) => p?.stage2?.exits },
  { id: "nuevos-maximos", label: "Nuevos máximos 52s", glyph: "▲", pick: (p) => p?.highs?.newThisWindow },
  { id: "cerca-maximo", label: "A <5 % del máximo", glyph: "≈", pick: (p) => p?.highs?.alreadyNear },
];

/**
 * Vistas «Esta noche» a partir del payload de /api/weekly-changes.
 * Sin payload comparable devuelve las cuatro con count null (el raíl pinta
 * «—»: el grupo no desaparece, empty contractual).
 */
export function weeklyQueueViews(payload = null) {
  const ok = payload?.state === "ok";
  return WEEKLY_QUEUE_DEFS.map(({ pick, ...def }) => {
    const bucket = ok ? pick(payload) : null;
    const symbols = Array.isArray(bucket?.rows)
      ? bucket.rows.map((row) => String(row?.symbol || "").trim()).filter(Boolean)
      : [];
    return {
      ...def,
      kind: "weekly",
      count: ok ? (Number.isFinite(bucket?.count) ? bucket.count : symbols.length) : null,
      symbols,
      since: ok ? String(payload?.window?.from || "") : "",
    };
  });
}

/** Cola de favoritos («Mis vistas»). */
export function favoritesQueueView(favoriteSymbols = null) {
  const symbols = favoriteSymbols ? [...favoriteSymbols].map((s) => String(s || "").trim()).filter(Boolean) : [];
  return { id: "favoritos", label: "Favoritos", glyph: "★", kind: "favorites", count: symbols.length, symbols };
}

/** Normaliza una cola externa para `applyHuntQueue` (símbolos únicos, Set). */
export function normalizeHuntQueue(view = null) {
  if (!view?.id || !Array.isArray(view.symbols)) return null;
  const symbols = new Set(view.symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean));
  return { id: view.id, label: view.label || view.id, kind: view.kind || "", since: view.since || "", symbols };
}

/** Filas analizadas que pertenecen a la cola, en el orden de analyzedRows. */
export function huntQueueRows(queue = null, analyzedRows = []) {
  if (!queue?.symbols?.size) return [];
  return analyzedRows.filter((row) => queue.symbols.has(String(row?.symbol || "").toUpperCase()));
}
