// Fixture RIGHT — satisfies cache-001 contract (sandbox reference only).
// Generation/identity guards; default maxEntries 2000; marketCache preserved.

export function createTtlCache({ maxEntries = 2000, name = "cache" } = {}) {
  const store = new Map();
  const inflight = new Map();
  let hits = 0;
  let misses = 0;

  function peek(key, { allowExpired = false } = {}) {
    const entry = store.get(key);
    if (!entry) return undefined;
    const expired = entry.expiresAt <= Date.now();
    if (expired && !allowExpired) return undefined;
    return {
      value: entry.value,
      expired,
      expiresAt: entry.expiresAt,
      cachedAt: entry.cachedAt ?? entry.expiresAt,
      staleForMs: expired ? Date.now() - (entry.cachedAt ?? entry.expiresAt) : 0,
    };
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  }

  function write(key, value, ttlMs) {
    if (store.has(key)) store.delete(key);
    store.set(key, { value, expiresAt: Date.now() + ttlMs, cachedAt: Date.now() });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  function set(key, value, ttlMs) {
    write(key, value, ttlMs);
    inflight.delete(key);
  }

  async function cached(key, ttlMs, loader) {
    const hit = get(key);
    if (hit !== undefined) {
      hits++;
      return hit;
    }
    const pending = inflight.get(key);
    if (pending) return pending;

    misses++;
    let loaded;
    try {
      loaded = loader();
    } catch (error) {
      return Promise.reject(error);
    }

    const promise = Promise.resolve(loaded).then(
      (value) => {
        if (inflight.get(key) === promise) {
          write(key, value, ttlMs);
          inflight.delete(key);
        }
        return value;
      },
      (error) => {
        if (inflight.get(key) === promise) inflight.delete(key);
        throw error;
      },
    );
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

  return { cached, get, peek, set, stats, clear };
}

const globalKey = "__statsedge_market_cache__";
export const marketCache =
  globalThis[globalKey] || (globalThis[globalKey] = createTtlCache({ maxEntries: 2500, name: "market" }));

export const TTL = {
  CHART_DAILY: 6 * 60 * 60 * 1000,
  CHART_INTRADAY: 5 * 60 * 1000,
  PROFILE: 24 * 60 * 60 * 1000,
};
