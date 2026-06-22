function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function staleDurationLabel(ms) {
  const value = finite(ms);
  if (value == null || value <= 0) return "";
  if (value < 60000) return "menos de 1 min";
  const minutes = Math.round(value / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function buildSnapshotFreshnessNotice(payload = {}, scan = {}) {
  const stale = Boolean(payload?.stale);
  const partialRows = finite(scan?.decisionProjectionPartialRows) || 0;
  if (!stale && partialRows <= 0) return null;

  const details = [];
  if (stale) {
    const duration = staleDurationLabel(payload.staleForMs);
    details.push(`Supabase no respondió; se muestra la última copia cacheada${duration ? ` (${duration})` : ""}.`);
    if (payload.staleReason) details.push(payload.staleReason);
  }
  if (partialRows > 0) {
    details.push(`${partialRows} filas tienen proyección de decisión parcial; audítalas antes de priorizarlas.`);
  }

  return {
    tone: stale ? "warn" : "info",
    label: stale ? "Snapshot cacheado" : "Snapshot parcial",
    detail: details.join(" "),
    stale,
    staleForMs: finite(payload.staleForMs),
    partialRows,
    source: "supabase",
  };
}
