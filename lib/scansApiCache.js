import { createTtlCache } from "@/lib/serverCache";

const scansCacheKey = "__statsedge_scans_api_cache__";

export const LATEST_SCAN_TTL_MS = 2 * 60 * 1000;
const existingScansCache = globalThis[scansCacheKey];
export const scansApiCache =
  existingScansCache && typeof existingScansCache.peek === "function"
    ? existingScansCache
    : (globalThis[scansCacheKey] = createTtlCache({ maxEntries: 20, name: "scans-api" }));

export function clearScansApiCache() {
  scansApiCache.clear();
}
