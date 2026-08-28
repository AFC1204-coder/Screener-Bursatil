// Caché de vistas filtradas por preset de ficha hunt (UX-11).
// El rail cambia entre 5 presets distintos; el fast-path P3 solo aplica cuando
// los criterios coinciden con el nocturno. Aquí materializamos el resultado de
// cada ficha sobre analyzedRows ya cargadas para que el gesto sea síncrono.
import { DEFAULT_FIELD_RULES, filterLayersForPreset, settingsForPreset } from "@/lib/screenerFilterCatalog";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";
import { filterCriteriaFingerprint } from "@/lib/screenerFilterFastPath";
import { HUNT_CARDS } from "@/lib/screenerHuntCards";

export function huntPresetActiveSettings(presetKey = "") {
  const key = String(presetKey || "").trim();
  const settings = settingsForPreset(key);
  const layers = filterLayersForPreset(key);
  return effectiveSettingsFromLayers(settings, layers, DEFAULT_FIELD_RULES);
}

export function huntFilterCacheKey(presetKey = "", analyzedCount = 0, context = {}) {
  const settings = huntPresetActiveSettings(presetKey);
  return [
    presetKey,
    analyzedCount,
    context.id || "",
    filterCriteriaFingerprint(settings),
    context.useRegimeFilter ? "1" : "0",
    context.marketHealth?.marketScore ?? "",
  ].join("|");
}

export function getOrComputeHuntFilter(cache, presetKey, analyzedRows = [], context = {}, filterFn) {
  if (!cache || !presetKey || !analyzedRows.length) return null;
  const key = huntFilterCacheKey(presetKey, analyzedRows.length, context);
  const hit = cache.get(key);
  if (hit) return { view: hit, cacheKey: key, fromCache: true };
  const settings = huntPresetActiveSettings(presetKey);
  const view = filterFn(analyzedRows, settings, context);
  cache.set(key, view);
  return { view, cacheKey: key, fromCache: false };
}

export function warmHuntFilterCache(cache, analyzedRows = [], context = {}, filterFn, { onlyIdle = true } = {}) {
  if (!cache || !analyzedRows.length) return () => {};
  const presetKeys = [...new Set(HUNT_CARDS.map((card) => card.presetKey))];
  let index = 0;
  function step() {
    while (index < presetKeys.length) {
      const presetKey = presetKeys[index++];
      const key = huntFilterCacheKey(presetKey, analyzedRows.length, context);
      if (!cache.has(key)) {
        const settings = huntPresetActiveSettings(presetKey);
        cache.set(key, filterFn(analyzedRows, settings, context));
        return;
      }
    }
  }
  if (!onlyIdle || typeof requestIdleCallback !== "function") {
    for (const presetKey of presetKeys) {
      getOrComputeHuntFilter(cache, presetKey, analyzedRows, context, filterFn);
    }
    return () => {};
  }
  let idleId = null;
  const run = () => {
    step();
    if (index < presetKeys.length) idleId = requestIdleCallback(run, { timeout: 1200 });
  };
  idleId = requestIdleCallback(run, { timeout: 400 });
  return () => {
    if (idleId != null) cancelIdleCallback(idleId);
  };
}
