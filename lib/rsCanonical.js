// lib/rsCanonical.js — LECTOR ÚNICO del RS que el producto enseña.
//
// Por qué existe: en agosto de 2026 el mismo símbolo (MAR) mostraba cuatro
// valores distintos de RS en cinco pantallas de la misma sesión. La causa no
// era el cálculo: eran DOS rankings diferentes leídos por superficies
// distintas, y una tercera superficie que ni siquiera recibía el bueno.
//
//   1. `rs_weekly_items` — ranking semanal sobre el universo estadounidense
//      completo (4.868 símbolos), calculado por scripts/rs-universe.mjs.
//      Viaja en la fila como weeklyRsAvailable / weeklyRsRating / weeklyRs*.
//      ESTA es la fuente. Es la única comparable entre valores y entre
//      pantallas: misma población, mismo día de corte, misma metodología.
//
//   2. `scan_results.rsGlobalPct` — percentil del símbolo DENTRO del lote de
//      un escaneo concreto. Puede calcularse sobre 50 símbolos o sobre 9.916,
//      cambia con cada escaneo y no es comparable con nada. Sigue existiendo
//      y sigue alimentando el scoring (no se toca), pero NO es el RS y no
//      puede mostrarse bajo esa etiqueta.
//
// Regla que impone este módulo: si una superficie no tiene el ranking semanal
// para un símbolo, muestra AUSENCIA con el motivo (principios de producto 3 y
// 7). Nunca cae al percentil del lote: un dato ausente es preferible a un dato
// que contradice otra pantalla.
//
// Ver docs/adr-rs-universo-us.md y tests/rsSurfaceConsistency.test.js.

export const RS_CANONICAL_SOURCE = "rs_weekly_items";
export const RS_CANONICAL_LABEL = "RS";

// El símbolo se consultó contra el ranking y no está en él.
export const RS_NOT_RANKED_REASON = "Sin RS semanal: este símbolo no entra en el ranking del universo (histórico insuficiente o serie de precios discontinua).";
// La fila llegó a la pantalla sin pasar por la hidratación del ranking. No es
// lo mismo que "no está en el ranking" y no se puede decir que lo sea.
export const RS_NOT_HYDRATED_REASON = "Sin RS semanal en esta vista: la fila no trae cargado el ranking semanal del universo. Abre la ficha del valor para verlo.";

// RS Quality no es el RS: es un ajuste de calidad SOBRE un RS. El que viaja en
// las filas de scan_results está calculado sobre el percentil del lote
// (lib/relativeStrength.js:scoreRsQuality con rsGlobalPct), no sobre el
// ranking semanal que estas pantallas enseñan como RS. Enseñar los dos juntos
// era la contradicción reportada: "RS – y RS Quality 88" en el mismo panel.
// La ficha del valor sí lo recalcula sobre el RS que muestra
// (app/api/company-brief/route.js:mergeUniverseRelativeStrength), así que allí
// es coherente y se mantiene.
export const RS_QUALITY_OFF_CANON_REASON = "RS Quality no disponible aquí: el valor del escaneo está calculado sobre el percentil del lote, no sobre el RS semanal del universo que muestra esta pantalla. En la ficha del valor sí se calcula sobre el RS que se enseña.";

// Una fila puede llegar plana (scan en vivo), bajo `snapshot` (favoritos
// rehidratados), bajo `metrics` o bajo `raw` (proyecciones de scan_results).
// El lector mira los cuatro sitios para que ninguna superficie tenga que
// saber de qué camino vino su fila.
function pick(row, key) {
  if (!row || typeof row !== "object") return undefined;
  if (row[key] !== undefined && row[key] !== null) return row[key];
  if (row.snapshot?.[key] !== undefined && row.snapshot?.[key] !== null) return row.snapshot[key];
  if (row.metrics?.[key] !== undefined && row.metrics?.[key] !== null) return row.metrics[key];
  if (row.raw?.[key] !== undefined && row.raw?.[key] !== null) return row.raw[key];
  return undefined;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hydrationFlag(row) {
  const flat = row?.weeklyRsAvailable;
  if (flat === true || flat === false) return flat;
  const nested = row?.snapshot?.weeklyRsAvailable ?? row?.metrics?.weeklyRsAvailable ?? row?.raw?.weeklyRsAvailable;
  if (nested === true || nested === false) return nested;
  return undefined;
}

/**
 * Estado del RS canónico de una fila, para CUALQUIER superficie.
 *
 * @returns {{available: boolean, value: number|null, reason: string,
 *   hydrated: boolean, asOf: string, weekKey: string, rank: number|null,
 *   sampleSize: number|null, engineVersion: string, source: string}}
 */
export function canonicalRs(row = {}) {
  const flag = hydrationFlag(row);
  const value = finite(pick(row, "weeklyRsRating"));
  if (flag === true && value !== null) {
    return {
      available: true,
      value,
      reason: "",
      hydrated: true,
      asOf: String(pick(row, "weeklyRsAsOf") || ""),
      weekKey: String(pick(row, "weeklyRsWeekKey") || ""),
      rank: finite(pick(row, "weeklyRsRank")),
      sampleSize: finite(pick(row, "weeklyRsSampleSize")),
      engineVersion: String(pick(row, "weeklyRsEngineVersion") || ""),
      source: RS_CANONICAL_SOURCE,
    };
  }
  const hydrated = flag !== undefined;
  const persistedReason = String(pick(row, "weeklyRsReason") || "");
  return {
    available: false,
    value: null,
    reason: hydrated ? (persistedReason || RS_NOT_RANKED_REASON) : RS_NOT_HYDRATED_REASON,
    hydrated,
    asOf: "",
    weekKey: "",
    rank: null,
    sampleSize: null,
    engineVersion: "",
    source: RS_CANONICAL_SOURCE,
  };
}

/** Atajo para las superficies que solo necesitan el número (o null). */
export function canonicalRsValue(row = {}) {
  return canonicalRs(row).value;
}

/** Texto que explica la ausencia, listo para el icono de información. */
export function canonicalRsReason(row = {}) {
  return canonicalRs(row).reason;
}

// Valor de ordenación: los símbolos sin RS semanal van SIEMPRE al final, en vez
// de colarse con el percentil del lote. Ordenar una columna por un número que
// la celda no enseña es la misma incoherencia por otra vía.
export const RS_SORT_ABSENT = -1;

export function canonicalRsSortValue(row = {}) {
  const value = canonicalRsValue(row);
  return value === null ? RS_SORT_ABSENT : value;
}
