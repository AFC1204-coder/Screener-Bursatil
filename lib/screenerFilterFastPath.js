// Fast-path del re-filtrado en cliente: leer lo que el nocturno ya calculó
// (screenPassed + scores) en vez de re-sectorizar y re-aplicar 68 reglas.
//
// El gesto (preset/orden) se mide en filterAnalyzedRows.filterMs. Este módulo
// decide cuándo el veredicto precomputado sigue siendo válido.
import {
  SCREENER_FILTER_QUERY_KEYS,
  effectiveScreenerFilterValues,
} from "@/lib/screenerFilterCatalog";

export const SESSION_AUTOSAVE_DEBOUNCE_MS = 250;

function canonFilterValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && trimmed !== "") return numeric;
    return trimmed;
  }
  return value ?? "";
}

export function filterCriteriaFingerprint(settings = {}) {
  const values = effectiveScreenerFilterValues(settings || {});
  const parts = [];
  for (const key of SCREENER_FILTER_QUERY_KEYS) {
    if (key === "filterPreset") continue;
    const raw = values[key];
    if (raw === undefined || raw === null || raw === "") {
      parts.push(`${key}=`);
      continue;
    }
    parts.push(`${key}=${canonFilterValue(raw)}`);
  }
  return parts.join("|");
}

export function filterCriteriaMatchPrecomputed(currentSettings = {}, precomputedValues = {}) {
  return filterCriteriaFingerprint(currentSettings) === filterCriteriaFingerprint(precomputedValues);
}

export function screenerFiltersFromScan(scan = {}) {
  const fromSettings = scan?.settings?.screenerFilters;
  if (fromSettings && typeof fromSettings === "object") return fromSettings;
  if (scan?.screenerFilters && typeof scan.screenerFilters === "object") return scan.screenerFilters;
  return null;
}

export function rowHasPrecomputedScreen(row = {}) {
  return typeof row?.screenPassed === "boolean";
}

export function rowsHavePrecomputedScreen(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return false;
  for (const row of rows) {
    if (!rowHasPrecomputedScreen(row)) return false;
  }
  return true;
}

export function rowLooksAlreadyScored(row = {}) {
  return Number.isFinite(row?.totalScore)
    || Number.isFinite(row?.compositeScore)
    || Number.isFinite(row?.objectiveScore)
    || Number.isFinite(row?.sectorScore)
    || Number.isFinite(row?.weaknessScore);
}

export function populationNeedsRescore(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return false;
  let scored = 0;
  for (const row of rows) {
    if (rowLooksAlreadyScored(row)) scored += 1;
  }
  return scored < rows.length * 0.9;
}

export function canUseScreenPassedFastPath(rows = [], settings = {}, context = {}) {
  const precomputed = context?.screenerFilters;
  if (!precomputed || typeof precomputed !== "object") return false;
  if (precomputed.enabled === false) return false;
  const values = precomputed.values && typeof precomputed.values === "object"
    ? precomputed.values
    : precomputed;
  if (!values || typeof values !== "object") return false;
  if (!rowsHavePrecomputedScreen(rows)) return false;
  return filterCriteriaMatchPrecomputed(settings, values);
}

export function withScanScreenerFilters(context = {}, scan = null) {
  if (context?.screenerFilters) return context;
  const filters = screenerFiltersFromScan(scan);
  if (!filters) return context;
  return { ...context, screenerFilters: filters };
}

export function createDebouncedSessionSaver(delayMs = SESSION_AUTOSAVE_DEBOUNCE_MS) {
  let timer = null;
  let pending = null;
  const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : SESSION_AUTOSAVE_DEBOUNCE_MS;
  return {
    schedule(fn) {
      pending = fn;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const run = pending;
        pending = null;
        run?.();
      }, delay);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const run = pending;
      pending = null;
      run?.();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
