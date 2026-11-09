// lib/longHistoryStore.js — E/S de la tabla long_history_stats (migración
// supabase/migrations/20261108120000_long_history_stats.sql, SIN aplicar).
// El cálculo vive en lib/longHistory.js (puro).

import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";
import { longHistoryFromDbRow, longHistoryToDbRow } from "@/lib/longHistory";

const UPSERT_CHUNK = 200;

// Una estadística más antigua que esto NO se usa: sin un job semanal que refresque la tabla, un dato
// de hace semanas no debe presentarse como actual (el campo se omite y la interfaz dirá «sin dato»).
export const LONG_HISTORY_MAX_AGE_DAYS = 45;

/** Upsert por (owner_id, symbol, as_of). Devuelve nº de filas enviadas. */
export async function writeLongHistoryStats(entries = []) {
  const config = supabaseConfig();
  const rows = entries.map(({ symbol, stat }) => longHistoryToDbRow(symbol, stat, { ownerId: config.ownerId }));
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await supabaseRequest("long_history_stats", {
      method: "POST",
      query: "on_conflict=owner_id,symbol,as_of",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: rows.slice(i, i + UPSERT_CHUNK),
    });
  }
  return rows.length;
}

/**
 * Última estadística utilizable por símbolo → Map(SYMBOL → stat).
 * Una sola lectura paginada de la vista long_history_latest (una fila por símbolo).
 */
export async function readLatestLongHistoryMap({ maxRows = 20000 } = {}) {
  const config = supabaseConfig();
  const out = new Map();
  const pageSize = 1000;
  for (let offset = 0; out.size < maxRows; offset += pageSize) {
    const page = await supabaseRequest("long_history_latest", {
      query: {
        select: "*",
        owner_id: `eq.${config.ownerId}`,
        order: "symbol.asc",
        limit: String(pageSize),
        offset: String(offset),
      },
    });
    if (!Array.isArray(page) || !page.length) break;
    for (const row of page) out.set(String(row.symbol).toUpperCase(), longHistoryFromDbRow(row));
    if (page.length < pageSize) break;
  }
  return out;
}

/**
 * Fecha de cálculo → ms UTC a medianoche. Acepta texto «YYYY-MM-DD…» (adaptador actual) y objetos Date
 * (adaptador antiguo del Mini, que devuelve las columnas date como Date en hora local: se leen sus
 * componentes locales, no toISOString, para no retrasar un día en zonas al este de UTC).
 */
export function asOfToMs(asOf) {
  if (asOf instanceof Date) {
    return Number.isFinite(asOf.getTime()) ? Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()) : NaN;
  }
  return Date.parse(`${String(asOf || "").slice(0, 10)}T00:00:00Z`);
}

/**
 * Mapa listo para pasar a buildResearchRow (options.longHistoryBySymbol). NUNCA lanza: si la lectura
 * falla o no hay nada, devuelve un Map vacío y el escaneo sigue sin campos lh* (no se pierde la noche
 * por un dato complementario). Descarta lo más antiguo que `maxAgeDays`.
 * `reader` y `now` son inyectables para los tests.
 */
export async function loadLongHistoryForScan({ maxAgeDays = LONG_HISTORY_MAX_AGE_DAYS, reader = readLatestLongHistoryMap, now = Date.now(), onNote = null } = {}) {
  let all;
  try {
    all = await reader();
  } catch (error) {
    onNote?.(`histórico largo no disponible (${error?.message || error}): el escaneo sigue sin campos lh*`);
    return new Map();
  }
  const out = new Map();
  let stale = 0;
  for (const [symbol, stat] of all) {
    const asOf = asOfToMs(stat?.asOf);
    if (!Number.isFinite(asOf) || (now - asOf) / 86400000 > maxAgeDays) {
      stale += 1;
      continue;
    }
    out.set(symbol, stat);
  }
  onNote?.(`histórico largo: ${out.size} símbolos con estadística vigente${stale ? ` · ${stale} descartados por antigüedad (> ${maxAgeDays} días)` : ""}`);
  return out;
}
