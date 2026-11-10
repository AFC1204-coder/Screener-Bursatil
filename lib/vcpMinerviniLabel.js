// Etiqueta corta Minervini para la columna VCP del screener (VCP-4).
// Lee campos materializados del scan; no recalcula el motor.

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPivotPct(value) {
  const n = finite(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.abs(n) < 10 ? n.toFixed(1).replace(/\.0$/, "") : String(Math.round(n));
  return n > 0 ? `+${rounded}` : rounded;
}

/**
 * Huella Minervini `Y/Z NT` (docs/vcp-footprint-notacion.md): primera contracción % / última % y
 * número de contracciones. Las semanas de base (XW) se omiten: aún no hay dato real (baseWeeks
 * vale 13 en todas las filas). N sale de contractionCount (no de las 3 profundidades guardadas)
 * y Z de lastContractionDepthPct, para que 4 o 5 contracciones no se queden en «3T».
 * Es un CANDIDATO, no una confirmación: el tono "watch" marca los que aún no pasan el motor.
 * @param {object} row Fila de screener (scan cacheado o vivo).
 * @returns {{ label: string, tone: "neutral"|"watch"|"", title: string }}
 */
export function vcpMinerviniLabel(row = {}) {
  const count = finite(row.contractionCount);
  if (!Number.isFinite(count) || count < 2) {
    return {
      label: "",
      tone: "",
      title: "Sin compresión VCP operable (menos de 2 contracciones medidas).",
    };
  }

  const candidate = row.vcpCandidate === true;
  const dist = finite(row.distanceToPivotPct);
  const depths = [row.contraction1DepthPct, row.contraction2DepthPct, row.contraction3DepthPct].map(finite).filter(Number.isFinite);
  const first = depths[0];
  const last = finite(row.lastContractionDepthPct) ?? depths.at(-1);
  const hasDepths = Number.isFinite(first) && Number.isFinite(last);
  const label = hasDepths ? `${Math.round(first)}/${Math.round(last)} ${count}T` : `${count}T`;

  const pivotNote = Number.isFinite(dist)
    ? ` Distancia al pivote: ${formatPivotPct(dist)}%.`
    : "";
  const detail = hasDepths ? ` Primera contracción ${Math.round(first)}%, última ${Math.round(last)}%.` : "";

  return {
    label,
    tone: candidate ? "neutral" : "watch",
    title: candidate
      ? `Candidato VCP: ${count} contracciones (aún sin ruptura confirmada).${detail}${pivotNote}`
      : `Posible VCP en formación: ${count} contracciones, aún no candidato.${detail}${pivotNote}`,
  };
}
