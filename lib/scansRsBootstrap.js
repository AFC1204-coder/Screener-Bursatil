// lib/scansRsBootstrap.js — bootstrap core-first: pintar mesa con hydrateRs=0 y
// completar RS país/tema en segundo plano sin vaciar la tabla.
//
// SCANS-HYDRATERS-COLD-1: el GET hydrateRs=1 no arranca en el mismo tick que
// el paint de core — se difiere a post-paint + idle para no competir con el
// primer render / parse de la mesa.

export const RS_EXTENDED_FIELD_PREFIXES = ["weeklyCountryRs", "weeklyThemeRs"];

/** Timeout de requestIdleCallback antes de forzar el fetch extended (ms). */
export const EXTENDED_RS_IDLE_TIMEOUT_MS = 600;

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
 * Espera al siguiente paint (doble rAF) y luego idle, o resuelve en microtarea
 * cuando no hay APIs de browser (Node / tests con defer:false suele saltarse).
 * @returns {() => void} cancel
 */
export function whenBrowserIdle(callback, { timeout = EXTENDED_RS_IDLE_TIMEOUT_MS } = {}) {
  if (typeof callback !== "function") return () => {};

  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    callback();
  };

  const hasRaf = typeof requestAnimationFrame === "function";
  const hasIdle = typeof requestIdleCallback === "function";

  // Sin rAF (Node puro): micro-delay para no bloquear el tick de core.
  if (!hasRaf) {
    const id = setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }

  let raf1 = 0;
  let raf2 = 0;
  let idleId = null;
  let timeoutId = null;

  const afterPaint = () => {
    if (cancelled) return;
    if (hasIdle) {
      idleId = requestIdleCallback(run, { timeout });
      return;
    }
    timeoutId = setTimeout(run, 0);
  };

  raf1 = requestAnimationFrame(() => {
    if (cancelled) return;
    raf2 = requestAnimationFrame(afterPaint);
  });

  return () => {
    cancelled = true;
    if (raf1) cancelAnimationFrame(raf1);
    if (raf2) cancelAnimationFrame(raf2);
    if (idleId != null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
    if (timeoutId != null) clearTimeout(timeoutId);
  };
}

function waitForBrowserIdle({ timeout = EXTENDED_RS_IDLE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    whenBrowserIdle(() => resolve(), { timeout });
  });
}

/**
 * Segunda fase en background: fetch extended → onMerged(extendedRows).
 * Por defecto difiere el arranque del fetch a post-paint + idle para que el
 * primer paint de la mesa core no compita con hydrateRs=1.
 * Si falla o isCancelled, la mesa core permanece intacta.
 *
 * @param {object} args
 * @param {boolean} [args.defer=true] — false solo en tests / callers síncronos
 */
export function scheduleExtendedRsHydration({
  fetchExtended,
  extractRows,
  isCancelled = () => false,
  onMerged,
  onError,
  defer = true,
  idleTimeoutMs = EXTENDED_RS_IDLE_TIMEOUT_MS,
} = {}) {
  if (typeof fetchExtended !== "function") return Promise.resolve();

  const runFetch = () => {
    if (isCancelled()) return Promise.resolve();
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
  };

  if (!defer) return runFetch();

  return waitForBrowserIdle({ timeout: idleTimeoutMs }).then(() => runFetch());
}
