// lib/filterFamilyImpact.js — impacto −N por familia piloto (UX-FILTERS-5).
//
// Igual que los chips de vista muestran cuánto recorta cada opción, cada
// familia de ejecución declara cuánto recorta sobre el LOTE CARGADO
// (analyzedRows), no sobre el universo teórico. Reutiliza el mismo predicado
// canónico de rechazo del pipeline (`screenerFilterRejectReason`), aislando las
// reglas propias de la familia para no atribuirle cortes de otras capas.
//
// Aislamiento: se construye un `filters.values` disperso que solo contiene los
// umbrales propios de la familia (sus campos + su setting booleano), con
// `setupMode: "any"` y `filterStrictness: "discovery"` para que el predicado no
// aplique el suelo de sesgo largo ni el gate compuesto de setup. Cualquier otra
// regla se omite porque su clave no está presente (finite() → null → inactiva).

import {
  FILTER_FIELDS,
  FILTER_FIELD_LAYERS,
  SETTING_LAYER_DEPENDENCIES,
} from "./screenerFilterCatalog.js";
import { isFieldRuleActive, settingApplies } from "./screenerFilterLayers.js";
import { screenerFilterRejectReason } from "./screenerFilters.js";

export const IMPACT_PILOT_FAMILIES = ["ipo", "relativeStrength"];

function familyFieldList(familyKey) {
  return FILTER_FIELDS.filter((field) => (FILTER_FIELD_LAYERS[field.key] || []).includes(familyKey));
}

function familyBooleanKeys(familyKey) {
  return Object.entries(SETTING_LAYER_DEPENDENCIES)
    .filter(([, dependency]) => dependency.layer === familyKey)
    .map(([key]) => key);
}

// Umbrales aislados de la familia: solo sus reglas activas, sin arrastrar el
// gate de setup ni el suelo de sesgo largo. Devuelve null si la familia no
// tiene ninguna regla propia activa (→ no recorta por definición).
function isolatedFamilyFilters(familyKey, { settings = {}, filterLayers = {}, fieldRules = {} } = {}) {
  const values = { setupMode: "any", filterStrictness: "discovery" };
  let activeRules = 0;

  for (const field of familyFieldList(familyKey)) {
    if (!isFieldRuleActive(field, fieldRules, filterLayers)) continue;
    values[field.key] = settings[field.key];
    activeRules += 1;
  }

  for (const key of familyBooleanKeys(familyKey)) {
    if (!settingApplies(key, filterLayers)) continue;
    if (settings[key] === true) {
      values[key] = true;
      activeRules += 1;
    }
  }

  if (!activeRules) return null;
  return { enabled: true, values };
}

/**
 * Cuenta cuántas filas del lote recorta una familia por sí sola.
 * @returns {{familyKey: string, layerOn: boolean, total: number, cut: number, remaining: number, hasActiveRules: boolean}}
 */
export function filterFamilyImpactStats(
  familyKey,
  { analyzedRows = [], settings = {}, filterLayers = {}, fieldRules = {} } = {},
) {
  const total = Array.isArray(analyzedRows) ? analyzedRows.length : 0;
  const layerOn = filterLayers[familyKey] !== false;
  const base = { familyKey, layerOn, total, cut: 0, remaining: total, hasActiveRules: false };

  // Capa apagada: no se inventa impacto de corte actual (D8 / spec §3.0).
  if (!layerOn) return base;

  const filters = isolatedFamilyFilters(familyKey, { settings, filterLayers, fieldRules });
  if (!filters) return base;

  let cut = 0;
  for (const row of analyzedRows) {
    if (screenerFilterRejectReason(row, filters)) cut += 1;
  }
  return { familyKey, layerOn, total, cut, remaining: Math.max(0, total - cut), hasActiveRules: true };
}

export function filterFamilyImpactByPilot({ analyzedRows = [], settings = {}, filterLayers = {}, fieldRules = {} } = {}) {
  return Object.fromEntries(
    IMPACT_PILOT_FAMILIES.map((familyKey) => [
      familyKey,
      filterFamilyImpactStats(familyKey, { analyzedRows, settings, filterLayers, fieldRules }),
    ]),
  );
}

// Etiqueta corta para la tarjeta (LayerControl). Capa apagada → null (sin
// impacto falso). Activa y recorta → «recorta −N». Activa y no recorta →
// «sin recorte» (tono neutro/gris).
export function filterFamilyImpactCardLabel(impact) {
  if (!impact || !impact.layerOn) return null;
  if (impact.cut > 0) return { text: `recorta −${impact.cut}`, tone: "cut" };
  return { text: "sin recorte", tone: "none" };
}

// Pie del editor (FilterFamilyModal): impacto agregado local de la familia.
export function filterFamilyImpactModalLine(impact) {
  if (!impact || !impact.layerOn) return null;
  if (!impact.total) return null;
  if (impact.cut > 0) {
    return `Esta familia deja ${impact.remaining} de ${impact.total} · recorta −${impact.cut}`;
  }
  return `Esta familia deja ${impact.total} de ${impact.total} · sin recorte`;
}
