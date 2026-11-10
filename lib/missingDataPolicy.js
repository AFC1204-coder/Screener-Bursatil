// Política única de dato que falta en un filtro activo.
//
// Decisión (auditoría de filtros 2026-11, propuesta 2, H6): una fila SIN el
// dato que exige un filtro encendido NO pasa ese filtro, y su rechazo se marca
// como «sin dato» para contarlo aparte en la auditoría/verdad del screener. No
// hay excepciones por familia: el RS semanal, el RS país, el RS tema, el RS
// quality, la fuerza de grupo y las reglas numéricas genéricas se tratan igual.
//
// Antes convivían tres políticas: el RS semanal se OMITÍA (la fila pasaba en
// silencio: 89 de 3.287 en el nocturno US del 2026-10-18), el RS país y el RS
// tema se omitían en el filtro duro pero se rechazaban en el post-filtro, y
// las reglas genéricas se rechazaban. El resultado dependía de por qué camino
// pasaba la fila. Ahora todas las rutas (filtro duro, atajo screenPassed,
// post-filtro, explicación por fila) llaman a este módulo.
//
// Un filtro APAGADO (umbral neutro) no pide nada: la ausencia no cuenta.

export const MISSING_DATA_POLICY = "reject-and-count";
export const MISSING_DATA_LABEL = "sin dato";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Rechazo por ausencia: misma forma que reject() de screenerFilters más la marca. */
export function missingDataReject(field, label) {
  return { field, reason: `${label} ${MISSING_DATA_LABEL}`, missingData: true };
}

/**
 * Evalúa un umbral numérico que el filtro exige.
 * Devuelve null si pasa; si no, { field, reason, missingData }.
 */
export function requiredThresholdReject({ field, label, value, threshold, op = "min", digits = 0 }) {
  const limit = finite(threshold);
  if (limit == null) return null;
  const number = finite(value);
  if (number == null) return missingDataReject(field, label);
  if (op === "max" && number > limit) return { field, reason: `${label} ${number.toFixed(digits)} > ${limit}`, missingData: false };
  if (op !== "max" && number < limit) return { field, reason: `${label} ${number.toFixed(digits)} < ${limit}`, missingData: false };
  return null;
}

/** Estado del dato para la explicación por fila: "missing" | "fail" | "pass". */
export function requiredThresholdStatus({ value, threshold, op = "min" }) {
  const limit = finite(threshold);
  const number = finite(value);
  if (limit == null) return "pass";
  if (number == null) return "missing";
  if (op === "max") return number > limit ? "fail" : "pass";
  return number < limit ? "fail" : "pass";
}

/** RS semanal canónico (rs_weekly_items) de la fila, o null si no está en el ranking. */
export function weeklyRsValue(row = {}) {
  if (row?.weeklyRsAvailable !== true) return null;
  return finite(row.weeklyRsRating);
}

/** ¿Este rechazo es por dato ausente? Acepta rechazos nuevos y motivos de texto heredados. */
export function isMissingDataRejection(item = {}) {
  if (!item || typeof item !== "object") return false;
  if (item.missingData === true) return true;
  if (item.missingData === false) return false;
  const text = String(item.reason || item.detail || "");
  return /\bsin dato\b/i.test(text);
}

/** Recuento aparte de los rechazos «sin dato», total y por campo. */
export function summarizeMissingData(rejections = []) {
  const byField = {};
  let total = 0;
  for (const item of Array.isArray(rejections) ? rejections : []) {
    if (!isMissingDataRejection(item)) continue;
    total += 1;
    const field = item.field || item.key || "otro";
    byField[field] = (byField[field] || 0) + 1;
  }
  return { total, byField };
}
