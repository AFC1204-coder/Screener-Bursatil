import { createTtlCache } from "@/lib/serverCache";

const scansCacheKey = "__statsedge_scans_api_cache__";
const scansInflightKey = "__statsedge_scans_api_inflight__";

export const LATEST_SCAN_TTL_MS = 15 * 60 * 1000;
const existingScansCache = globalThis[scansCacheKey];
export const scansApiCache =
  existingScansCache && typeof existingScansCache.peek === "function"
    ? existingScansCache
    : (globalThis[scansCacheKey] = createTtlCache({ maxEntries: 20, name: "scans-api" }));

// Single-flight de las lecturas «último escaneo» cacheables: dos peticiones
// idénticas que fallan la caché a la vez (StrictMode en dev, dos pestañas, un
// refresco durante el arranque) comparten UNA carga en vez de leer y armar
// dos veces las ~3.300 filas (5-10 s de servidor cada una en frío).
const existingInflight = globalThis[scansInflightKey];
export const scansApiInflight =
  existingInflight instanceof Map ? existingInflight : (globalThis[scansInflightKey] = new Map());

export function clearScansApiCache() {
  scansApiCache.clear();
  // Una escritura invalida también las cargas en curso: las peticiones que
  // lleguen después deben leer de nuevo, no unirse a una lectura anterior.
  scansApiInflight.clear();
}
