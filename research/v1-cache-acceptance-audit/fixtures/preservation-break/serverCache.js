// Fixture PRESERVATION_BREAK — defects fixed; key identity broken (1 === "1").
// Sandbox only.

export function createTtlCache({ maxEntries = 2000, name = "cache" } = {}) {
  const store = new Map();
  const inflight = new Map();
  let hits = 0;
  let misses = 0;
  const canon = (key) => (typeof key === "number" || typeof key === "string" ? String(key) : key);

  function peek(key, { allowExpired = false } = {}) {
    const entry = store.get(canon(key));
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
    const k = canon(key);
    const entry = store.get(k);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      store.delete(k);
      return undefined;
    }
    store.delete(k);
    store.set(k, entry);
    return entry.value;
  }

  function write(key, value, ttlMs) {
    const k = canon(key);
    if (store.has(k)) store.delete(k);
    store.set(k, { value, expiresAt: Date.now() + ttlMs, cachedAt: Date.now() });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  function set(key, value, ttlMs) {
    write(key, value, ttlMs);
    inflight.delete(canon(key));
  }

  async function cached(key, ttlMs, loader) {
    const k = canon(key);
    const hit = get(k);
    if (hit !== undefined) {
      hits++;
      return hit;
    }
    const pending = inflight.get(k);
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
        if (inflight.get(k) === promise) {
          write(k, value, ttlMs);
          inflight.delete(k);
        }
        return value;
      },
      (error) => {
        if (inflight.get(k) === promise) inflight.delete(k);
        throw error;
      },
    );
    inflight.set(k, promise);
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
