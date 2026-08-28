// lib/rsGlobalUniverse.js — la mitad internacional del universo del motor de RS
// global privado (MET-1b), y el versionado de su denominador.
//
// QUÉ ES: las listas curadas del repo (lib/universes.js: CURATED + EXTRA +
// EXPANDED_CORE) para los mercados que el spec fija en la pregunta 2 — HK, CA,
// Europa-15, AU y JP. NO es el inventario del exchange ni el materializado del
// cron: la invariante 10 de docs/adr-discovery-global-curated.md prohíbe usar el
// lote rotativo de cada noche como denominador de un ranking, porque su
// composición cambia con el cursor.
//
// La mitad US del universo la aporta universe_snapshot_symbols y vive en el
// script del motor, no aquí: depende de Supabase y este módulo es puro.
//
// VERSIONADO DEL DENOMINADOR (invariante 10 y criterio 10.8b): el snapshot debe
// poder reproducirse. Para eso, universeFingerprint() emite un hash estable de
// la lista final de símbolos que se persiste en rs_weekly_snapshots.stats junto
// al universe_snapshot_id US. Recalcular desde esa lista debe dar percentiles
// idénticos; si el hash cambia, el denominador cambió y los percentiles no son
// comparables con los de la semana anterior.

import { createHash } from "node:crypto";

import { marketSymbols } from "@/lib/universes";
import { MARKET_CURRENCY } from "@/lib/rsFx";

// Mercados intl del universo v1, en el orden del spec. Fuera de v1: KR, IN, IL,
// CN, BR, MX, SG, ZA, TW — no son prioridad del dueño y añaden divisas y
// festivos sin valor de caza inmediato. Entrar después = engine_version nuevo o
// minor documentado en stats, nunca una edición silenciosa de esta lista.
export const GLOBAL_RS_INTL_MARKETS = [
  "HK",
  "CA",
  "GB",
  "DE",
  "FR",
  "NL",
  "CH",
  "SE",
  "IT",
  "ES",
  "DK",
  "NO",
  "FI",
  "BE",
  "PT",
  "AT",
  "IE",
  "AU",
  "JP",
];

/**
 * Símbolos internacionales del universo, con su mercado y divisa de cotización.
 * Determinista: mismo orden de mercados, mismo orden dentro de cada mercado
 * (el de marketSymbols, que ya deduplica).
 */
export function intlUniverseRows(markets = GLOBAL_RS_INTL_MARKETS) {
  const seen = new Set();
  const rows = [];
  for (const market of markets) {
    const currency = MARKET_CURRENCY[market] || "";
    for (const symbol of marketSymbols(market)) {
      const clean = String(symbol || "").trim().toUpperCase();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      rows.push({ symbol: clean, market, currency, source: "lib/universes.js" });
    }
  }
  return rows;
}

/** Conteo de símbolos definidos por mercado, para el bloque de cobertura. */
export function intlCountsByMarket(rows = intlUniverseRows()) {
  const counts = {};
  for (const row of rows) counts[row.market] = (counts[row.market] || 0) + 1;
  return counts;
}

/**
 * Hash estable de una lista de símbolos. Ordena antes de hashear para que el
 * fingerprint dependa del CONJUNTO y no del orden de iteración — dos corridas
 * con el mismo universo dan el mismo hash aunque el motor recorra los símbolos
 * en otro orden.
 */
export function universeFingerprint(symbols = []) {
  const sorted = [...new Set(symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))].sort();
  const hash = createHash("sha256").update(sorted.join("\n")).digest("hex");
  return { hash, count: sorted.length };
}
