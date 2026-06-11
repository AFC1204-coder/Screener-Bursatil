// lib/serverCache.js — caché en memoria con TTL, límite LRU y deduplicación
// de promesas en vuelo. Pensado para envolver proveedores externos (Yahoo, Stooq...).
//
// Propiedades:
// - TTL por entrada; las entradas caducadas se descartan en lectura.
// - LRU: al superar maxEntries se expulsa la entrada menos usada recientemente.
// - In-flight dedupe: N llamadas concurrentes a la misma clave comparten 1 fetch
//   (crítico durante un scan: benchmarks SPY/QQQ/ACWI se piden una sola vez).
// - Los errores NUNCA se cachean: la promesa fallida se elimina y el siguiente
//   intento vuelve al proveedor.
//
// Limitación consciente: en Vercel serverless cada instancia tiene su propia
// memoria, así que el hit-rate es por-instancia. Para una app personal es
// suficiente; si algún día necesitas caché compartida, la interfaz get/set
// se sustituye por una tabla Supabase sin tocar a los consumidores.

export function createTtlCache({ maxEntries = 2000, name = "cache" } = {}) {
  const store = new Map(); // key -> { value, expiresAt }
  const inflight = new Map(); // key -> Promise
  let hits = 0;
  let misses = 0;

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    // LRU: reinsertar para marcar como recientemente usada.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  }

  function set(key, value, ttlMs) {
    if (store.has(key)) store.delete(key);
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  /**
   * Envuelve una función async con caché.
   * @param {string} key  clave única (incluye símbolo + opciones relevantes)
   * @param {number} ttlMs
   * @param {() => Promise<any>} loader
   */
  async function cached(key, ttlMs, loader) {
    const hit = get(key);
    if (hit !== undefined) {
      hits++;
      return hit;
    }
    const pending = inflight.get(key);
    if (pending) return pending;

    misses++;
    const promise = (async () => {
      try {
        const value = await loader();
        set(key, value, ttlMs);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  function stats() {
    return { name, size: store.size, hits, misses, inflight: inflight.size };
  }

  function clear() {
    store.clear();
    inflight.clear();
  }

  return { cached, get, set, stats, clear };
}

// Instancia compartida para datos de mercado.
// globalThis evita duplicar la caché cuando Next recarga módulos en dev.
const globalKey = "__statsedge_market_cache__";
export const marketCache =
  globalThis[globalKey] || (globalThis[globalKey] = createTtlCache({ maxEntries: 2500, name: "market" }));

export const TTL = {
  CHART_DAILY: 6 * 60 * 60 * 1000, // 6h: barras diarias, suficiente para screening EOD
  CHART_INTRADAY: 5 * 60 * 1000, // 5m: si pides intradía, caché corta
  PROFILE: 24 * 60 * 60 * 1000, // 24h: sector/industria/float cambian despacio
};
