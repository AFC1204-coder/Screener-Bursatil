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
  let label = `${count}C`;
  if (!candidate) label += "·form";
  if (Number.isFinite(dist) && dist !== 0) {
    const pivot = formatPivotPct(dist);
    if (pivot) label += `·PV${pivot}%`;
  }

  const pivotNote = Number.isFinite(dist)
    ? ` Distancia al pivot: ${formatPivotPct(dist)}%.`
    : "";

  return {
    label,
    tone: candidate ? "neutral" : "watch",
    title: candidate
      ? `VCP ${count} contracciones; candidato del motor unificado.${pivotNote}`
      : `VCP ${count} contracciones en formación (aún no candidato).${pivotNote}`,
  };
}
