// lib/startupScanCache.js — caché local (IndexedDB) del escaneo de arranque,
// VALIDADA por identidad, no "pinta lo viejo y luego cambia".
//
// Por qué existe (móvil 2026-11, prioridad nº 1 del usuario: «que cargue como
// una aplicación»): /api/scans?includeRows=1 pesa ~15 MB de JSON (2,6 MB gzip)
// y se descargaba entero en CADA apertura. localStorage no admite el universo
// entero (presupuesto de 4,5 M de caracteres, ver fitScansForBrowser), pero
// IndexedDB sí.
//
// Diseño (decisión de seguridad): en vez de stale-while-revalidate —que
// obligaría a tocar la máquina de estados del arranque en app/page.jsx para
// repintar— la caché se valida antes de usarla con una SONDA: la misma URL con
// includeRows=0 (≈2 KB, ~10 ms) que trae el id, updatedAt y rowsAvailable del
// escaneo vigente. Solo si la identidad coincide con la guardada (y la copia
// no supera STARTUP_CACHE_MAX_AGE_MS) se sirve lo guardado, con la MISMA forma
// de resultado que la red. Si no coincide, o la sonda falla, se descarga igual
// que antes. Por construcción no puede enseñar un escaneo distinto del que el
// servidor da ahora; la antigüedad máxima acota solo lo que el escaneo no
// identifica (RS global semanal hidratado en el payload core).
//
// Qué NO cachea: la segunda fase (hydrateRs=1, RS país/tema) ni nada que no
// sea el arranque core. Todo fallo de IndexedDB (modo privado, cuota, bloqueo)
// degrada en silencio a la descarga normal.

export const STARTUP_CACHE_DB = "statsedge-cache";
export const STARTUP_CACHE_STORE = "startupScans";
export const STARTUP_CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const STARTUP_CACHE_MAX_ENTRIES = 4;
export const STARTUP_CACHE_MAX_CHARS = 40_000_000;

const META_SUFFIX = "#meta";
const TEXT_SUFFIX = "#text";

/** URL de la sonda: la del arranque, sin filas. */
export function probeUrlFor(startupUrl) {
  const url = new URL(startupUrl, "http://local.invalid");
  url.searchParams.set("includeRows", "0");
  url.searchParams.delete("rowsLimit");
  return `${url.pathname}${url.search}`;
}

/** Identidad del escaneo de un payload de /api/scans (sonda o completo). */
export function identityOf(data) {
  const scan = Array.isArray(data?.scans) ? data.scans[0] : null;
  if (!scan || !scan.id) return null;
  return [scan.id, scan.updatedAt || "", scan.rowsAvailable ?? ""].join("|");
}

/** ¿Merece guardarse? Solo un arranque correcto y con filas. */
export function isCacheablePayload(data) {
  if (!data || data.ok === false || data.configured === false || data.error) return false;
  const scan = Array.isArray(data.scans) ? data.scans[0] : null;
  return Boolean(scan && Array.isArray(scan.rows) && scan.rows.length > 0 && identityOf(data));
}

export function createMemoryStore() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(record) { map.set(record.key, record); return true; },
    async remove(key) { map.delete(key); return true; },
    async keys() { return [...map.keys()]; },
  };
}

/** Almacén sobre IndexedDB; null si el navegador no lo ofrece. Nunca lanza. */
export function createIdbStore(idb = typeof indexedDB === "undefined" ? undefined : indexedDB) {
  if (!idb) return null;
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = idb.open(STARTUP_CACHE_DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STARTUP_CACHE_STORE, { keyPath: "key" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB bloqueada"));
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
    }
    return dbPromise;
  };
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STARTUP_CACHE_STORE, mode);
      let out;
      const request = fn(tx.objectStore(STARTUP_CACHE_STORE));
      if (request) request.onsuccess = () => { out = request.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("transacción abortada"));
    });
  };
  return {
    get: (key) => run("readonly", (s) => s.get(key)).then((v) => v ?? null).catch(() => null),
    put: (record) => run("readwrite", (s) => s.put(record)).then(() => true).catch(() => false),
    remove: (key) => run("readwrite", (s) => s.delete(key)).then(() => true).catch(() => false),
    keys: () => run("readonly", (s) => s.getAllKeys()).then((v) => v || []).catch(() => []),
  };
}

async function pruneOldEntries(store, keepMax) {
  const keys = (await store.keys()).filter((key) => String(key).endsWith(META_SUFFIX));
  if (keys.length <= keepMax) return;
  const metas = (await Promise.all(keys.map((key) => store.get(key)))).filter(Boolean);
  metas.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  for (const meta of metas.slice(0, metas.length - keepMax)) {
    const base = String(meta.key).slice(0, -META_SUFFIX.length);
    await store.remove(base + META_SUFFIX);
    await store.remove(base + TEXT_SUFFIX);
  }
}

/** Guarda texto y, al final, la meta (la meta implica que el texto existe). */
export async function saveStartupScan(store, url, data, { now = Date.now, maxEntries = STARTUP_CACHE_MAX_ENTRIES } = {}) {
  if (!store || !isCacheablePayload(data)) return false;
  let text;
  try { text = JSON.stringify(data); } catch { return false; }
  if (text.length > STARTUP_CACHE_MAX_CHARS) return false;
  const okText = await store.put({ key: url + TEXT_SUFFIX, text });
  if (!okText) return false;
  const okMeta = await store.put({ key: url + META_SUFFIX, identity: identityOf(data), savedAt: now() });
  if (!okMeta) {
    await store.remove(url + TEXT_SUFFIX);
    return false;
  }
  await pruneOldEntries(store, maxEntries).catch(() => {});
  return true;
}

/**
 * Resuelve el arranque. `fetchFull()` y `fetchProbe()` devuelven el resultado
 * ya normalizado ({ ok, configured, message, data }). `defer(fn)` programa el
 * guardado fuera del camino crítico (idle en el navegador, inmediato en tests).
 */
export async function resolveStartupScan({
  url,
  store,
  fetchFull,
  fetchProbe,
  now = Date.now,
  maxAgeMs = STARTUP_CACHE_MAX_AGE_MS,
  defer = (fn) => fn(),
  onEvent = () => {},
}) {
  const fullAndSave = async (reason) => {
    onEvent({ type: "miss", reason });
    const result = await fetchFull();
    if (store && result?.ok && isCacheablePayload(result.data)) {
      defer(() => { saveStartupScan(store, url, result.data, { now }).catch(() => {}); });
    }
    return result;
  };
  if (!store) return fullAndSave("sin-almacen");

  let meta = null;
  try { meta = await store.get(url + META_SUFFIX); } catch { meta = null; }
  if (!meta || !meta.identity) return fullAndSave("sin-copia");
  const age = now() - Number(meta.savedAt || 0);
  if (!(age >= 0 && age <= maxAgeMs)) return fullAndSave("caducada");

  let probe;
  let textRecord;
  try {
    [probe, textRecord] = await Promise.all([fetchProbe(), store.get(url + TEXT_SUFFIX)]);
  } catch {
    return fullAndSave("sonda-fallo");
  }
  if (!probe?.ok) return fullAndSave("sonda-fallo");
  if (identityOf(probe.data) !== meta.identity) return fullAndSave("identidad-distinta");
  if (!textRecord || typeof textRecord.text !== "string") return fullAndSave("sin-texto");

  let data;
  try { data = JSON.parse(textRecord.text); } catch { data = null; }
  if (!data || identityOf(data) !== meta.identity || !isCacheablePayload(data)) {
    await store.remove(url + META_SUFFIX).catch(() => {});
    await store.remove(url + TEXT_SUFFIX).catch(() => {});
    return fullAndSave("corrupta");
  }
  onEvent({ type: "hit", ageMs: age });
  return { ok: data.ok !== false, configured: data.configured !== false, message: data.message || "", data, fromCache: true };
}
