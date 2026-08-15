// lib/templateApplication.js — qué produce una plantilla guardada aplicada
// sobre el snapshot ya cargado, SIN escanear.
//
// Hasta 2026-08-15, aplicar una plantilla pasaba por applyFilterConfig →
// clear(): borraba analyzedRows y scanContext — exactamente las dos
// precondiciones del efecto de re-filtrado instantáneo — y dejaba la tabla
// vacía pidiendo un scan. Ningún criterio de plantilla lo exigía: settings, capas,
// reglas de campo, filtros de vista y orden se evalúan todos en cliente con
// filterAnalyzedRows (la misma ruta que ya usa la restauración de sesión).
//
// Lo ÚNICO que una plantilla puede pedir y el snapshot no puede dar es
// cobertura de universo: mercados (markets/manual) sin filas en los datos de
// anoche. Eso no se resuelve filtrando — se AVISA (snapshotCoverageGaps),
// nunca se vacía la tabla.
import {
  DEFAULT_FIELD_RULES,
  SCREENER_FILTER_PRESETS as PRESETS,
  settingsForPreset,
} from "@/lib/screenerFilterCatalog";
import { effectiveSettingsFromLayers, restoreFilterLayers } from "@/lib/screenerFilterLayers";
import { filterAnalyzedRows } from "@/lib/screenerPipeline";
import { countryCode } from "@/lib/symbols";

// Mercados pedidos que no tienen ni una fila en el snapshot cargado.
// Los códigos de mercado y row.country comparten esquema (US, ES, DE...);
// countryCode(symbol) es el mismo fallback que usa la restauración.
export function snapshotCoverageGaps(requestedMarkets = [], analyzedRows = []) {
  const requested = (Array.isArray(requestedMarkets) ? requestedMarkets : []).filter(Boolean);
  if (!requested.length || !analyzedRows.length) return [];
  const covered = new Set();
  for (const row of analyzedRows) {
    const code = row?.country || countryCode(row?.symbol);
    if (code) covered.add(code);
  }
  return requested.filter((code) => !covered.has(code));
}

// Deriva de la config de una plantilla los settings efectivos (la MISMA
// cadena preset→settings→capas→reglas que applyFilterConfig aplica al estado)
// y los pasa por el filtro real sobre las filas ya cargadas. No muta nada:
// es la foto de "qué verá el usuario" que la página usa para avisar de
// cobertura o de cero resultados en el momento de aplicar.
export function templateSnapshotAssessment(config = {}, analyzedRows = [], context = {}) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const presetKey = PRESETS[safeConfig.presetKey] ? safeConfig.presetKey : "balanced";
  const settings = settingsForPreset(presetKey, safeConfig.settings || {});
  const filterLayers = restoreFilterLayers(safeConfig.filterLayers, safeConfig.filterLayersVersion, presetKey);
  const fieldRules = { ...DEFAULT_FIELD_RULES, ...(safeConfig.fieldRules || {}) };
  const effectiveSettings = effectiveSettingsFromLayers(settings, filterLayers, fieldRules);
  const rows = Array.isArray(analyzedRows) ? analyzedRows : [];
  const filterContext = {
    symbolsCount: rows.length,
    baseCount: rows.length,
    providerErrors: [],
    marketHealth: context.marketHealth ?? null,
    useRegimeFilter: safeConfig.useRegimeFilter !== false,
  };
  const view = rows.length ? filterAnalyzedRows(rows, effectiveSettings, filterContext) : null;
  return {
    presetKey,
    effectiveSettings,
    analyzedCount: rows.length,
    // null = no hay datos sobre los que evaluar (no confundir con 0 filas).
    filteredCount: view ? view.rows.length : null,
    uncoveredMarkets: snapshotCoverageGaps(safeConfig.markets, rows),
  };
}
