import { userFacingServiceError } from "@/lib/serviceErrors";

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
  const rowsAvailable = finite(scan?.rowsAvailable);
  const rowsReturned = finite(scan?.rowsReturned);
  // rowsTruncated lo calcula el servidor (app/api/scans/route.js,
  // scanFromDb): compara el total real del escaneo (scans.row_count) contra
  // las filas que sobrevivieron al recorte de rowsLimit. Si algún día viene
  // sin los números, no fabricamos el aviso con datos a medias.
  const truncated = Boolean(scan?.rowsTruncated) && rowsAvailable != null && rowsReturned != null;
  if (!stale && partialRows <= 0 && !truncated) return null;

  const details = [];
  if (stale) {
    const duration = staleDurationLabel(payload.staleForMs);
    details.push(`No se pudo refrescar la copia guardada; se muestra la última disponible${duration ? ` (${duration})` : ""}.`);
    // staleReason lo escribe el servidor (app/api/scans/route.js) y puede
    // traer hasta 240 caracteres del error original: códigos HTTP, texto de
    // Cloudflare o de PostgREST, el nombre del servicio. Se traduce, y lo que
    // no se reconoce NO se enseña — este texto se pinta tal cual en el banner
    // del screener (ScreenerShell → snapshotNotice.detail).
    const reason = userFacingServiceError(payload.staleReason, "");
    if (reason) details.push(reason);
  }
  if (truncated) {
    // Cuando no caben todas las filas, el criterio del recorte importa tanto
    // como el número: si la muestra fueran "las primeras", que ordenan por
    // puntuación, todo filtro de valores débiles devolvería vacío sin que el
    // usuario supiera por qué. Por eso el servidor reparte las páginas por
    // todo el ranking (rowsSampled) y aquí se dice cuál de los dos casos es.
    details.push(scan?.rowsSampled
      ? `Se muestran ${rowsReturned} de ${rowsAvailable} acciones de este escaneo: una muestra repartida por todo el ranking, porque el escaneo no cabe entero en la restauración.`
      : `Se muestran ${rowsReturned} de ${rowsAvailable} acciones de este escaneo; el resto no se cargó por el límite de tamaño de la restauración.`);
  }
  if (partialRows > 0) {
    details.push(`${partialRows} filas tienen proyección de decisión parcial; audítalas antes de priorizarlas.`);
  }

  return {
    tone: stale || truncated ? "warn" : "info",
    label: stale ? "Snapshot cacheado" : truncated ? "Snapshot incompleto" : "Snapshot parcial",
    detail: details.join(" "),
    stale,
    staleForMs: finite(payload.staleForMs),
    partialRows,
    truncated,
    sampled: Boolean(scan?.rowsSampled) && truncated,
    rowsAvailable,
    rowsReturned,
    source: "supabase",
  };
}
