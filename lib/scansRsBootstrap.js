// lib/scansRsBootstrap.js — bootstrap core-first: pintar mesa con hydrateRs=0 y
// completar RS país/tema en segundo plano sin vaciar la tabla.

export const RS_EXTENDED_FIELD_PREFIXES = ["weeklyCountryRs", "weeklyThemeRs"];

export function rowSymbolKey(row = {}) {
  return String(row?.symbol || "").trim().toUpperCase();
}

/** Campos weeklyCountryRs* / weeklyThemeRs* de una fila extended. */
export function pickExtendedRsFields(row = {}) {
  const patch = {};
  for (const key of Object.keys(row)) {
    if (RS_EXTENDED_FIELD_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      patch[key] = row[key];
    }
  }
  return patch;
}

/** Parchea filas existentes con RS país/tema de un snapshot extended (por symbol). */
export function mergeExtendedRsIntoRows(existingRows = [], extendedRows = []) {
  if (!Array.isArray(existingRows) || !existingRows.length) return existingRows;
  if (!Array.isArray(extendedRows) || !extendedRows.length) return existingRows;

  const extendedBySymbol = new Map();
  for (const row of extendedRows) {
    const symbol = rowSymbolKey(row);
    if (!symbol) continue;
    const patch = pickExtendedRsFields(row);
    if (Object.keys(patch).length) extendedBySymbol.set(symbol, patch);
  }
  if (!extendedBySymbol.size) return existingRows;

  return existingRows.map((row) => {
    const patch = extendedBySymbol.get(rowSymbolKey(row));
    if (!patch) return row;
    return { ...row, ...patch };
  });
}

export function markRsBootstrapCoreReady() {
  if (typeof performance === "undefined") return;
  try {
    performance.mark("statsedge:bootstrap-core");
    performance.measure("statsedge:T_core", "navigationStart", "statsedge:bootstrap-core");
  } catch {
    // User Timing no disponible o navigationStart ausente.
  }
}

export function markRsBootstrapExtendedReady() {
  if (typeof performance === "undefined") return;
  try {
    performance.mark("statsedge:bootstrap-extended");
    if (performance.getEntriesByName("statsedge:bootstrap-core", "mark").length) {
      performance.measure(
        "statsedge:T_extended_after_core",
        "statsedge:bootstrap-core",
        "statsedge:bootstrap-extended",
      );
    }
  } catch {
    // User Timing no disponible.
  }
}

/**
 * Segunda fase en background: fetch extended → onMerged(extendedRows).
 * Si falla o isCancelled, la mesa core permanece intacta.
 */
export function scheduleExtendedRsHydration({
  fetchExtended,
  extractRows,
  isCancelled = () => false,
  onMerged,
  onError,
} = {}) {
  if (typeof fetchExtended !== "function") return Promise.resolve();

  return fetchExtended()
    .then((result) => {
      if (isCancelled()) return;
      if (!result?.ok || result.configured === false) return;
      const extendedRows = typeof extractRows === "function" ? extractRows(result) : null;
      if (!Array.isArray(extendedRows) || !extendedRows.length) return;
      markRsBootstrapExtendedReady();
      onMerged?.(extendedRows, result);
    })
    .catch((error) => {
      console.error("[rsBootstrap] extended hydrate fallida:", error);
      onError?.(error);
    });
}
