import { isCloudAuthFailure, userFacingServiceError } from "@/lib/serviceErrors";

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

// Copia local recortada por presupuesto de localStorage (fitScansForBrowser):
// rowsSampled + menos filas que el universo. Misma guarda que restoreLocalSnapshot.
export function localScanIsSampled(scan) {
  if (!scan || !Array.isArray(scan.rows)) return false;
  return Boolean(scan.rowsSampled) && Number(scan.rowsAvailable) > scan.rows.length;
}

export function localSampleDetail(scan) {
  if (!localScanIsSampled(scan)) return "";
  return `La copia local guarda ${scan.rows.length} de ${scan.rowsAvailable} acciones, repartidas por todo el ranking, porque el escaneo entero no cabe en este navegador.`;
}

// Traduce fallos de /api/scans al aviso de «copia local». Si el servidor ya
// devolvió copy de producto (p. ej. nube desactivada), no lo sustituye por el
// genérico «La copia guardada en la nube no está disponible».
export function snapshotCloudFallbackReason(rawMessage, { configured = true } = {}) {
  const serverMessage = String(rawMessage || "").trim();
  if (configured === false && serverMessage) return serverMessage;
  return userFacingServiceError(rawMessage, "No se pudo cargar desde tu cuenta.");
}

export function buildCloudAuthRequiredNotice({ scan = null } = {}) {
  const sampled = localScanIsSampled(scan);
  const populationNote = sampled
    ? ` Mientras tanto se muestra una copia local (${scan.rows.length} de ${scan.rowsAvailable} acciones).`
    : scan?.rows?.length
      ? ` Mientras tanto se muestra la copia local (${scan.rows.length} acciones).`
      : "";
  return {
    tone: "warn",
    label: "Sesión caducada",
    detail: `Tu sesión ya no es válida para cargar el escaneo desde tu cuenta.${populationNote} Vuelve a entrar para recuperar el universo completo.`,
    source: "auth-required",
    requiresReauth: true,
    sampled,
    rowsAvailable: sampled ? Number(scan?.rowsAvailable) : null,
    rowsReturned: sampled ? scan?.rows?.length : null,
  };
}

export function buildLocalFallbackNotice({ rawMessage = "", configured = true, scan = null } = {}) {
  if (isCloudAuthFailure(rawMessage)) return buildCloudAuthRequiredNotice({ scan });
  const reason = snapshotCloudFallbackReason(rawMessage, { configured });
  if (!reason) return null;
  const sampleDetail = localSampleDetail(scan);
  const sampled = localScanIsSampled(scan);
  return {
    tone: "info",
    label: "Copia local",
    detail: `${reason} Se usa la última copia guardada en este dispositivo del escaneo nocturno estadounidense.${sampleDetail ? ` ${sampleDetail}` : ""}`,
    source: "local",
    sampled,
    rowsAvailable: sampled ? Number(scan?.rowsAvailable) : null,
    rowsReturned: sampled ? scan?.rows?.length : null,
  };
}

export function sessionAutoRefreshStatus({ sampled = false } = {}) {
  return sampled
    ? "Sesión recuperada. Cargando el universo completo del escaneo nocturno..."
    : "Sesión recuperada. Actualizando al último escaneo nocturno...";
}

export function manualDataRefreshStatus({ sampled = false } = {}) {
  return sampled
    ? "Actualizando al universo completo del escaneo nocturno..."
    : "Actualizando al último escaneo nocturno...";
}

// Una sola renovación cubre P1 (caducidad) y P2 (muestra). Null = no tocar.
export function screenerSessionRefreshReason({ expired = false, sampled = false } = {}) {
  if (expired && sampled) return "expired-and-sampled";
  if (expired) return "expired";
  if (sampled) return "sampled";
  return null;
}

export function buildSessionKeepNotice({ reason = "", scan = null } = {}) {
  if (isCloudAuthFailure(reason)) return buildCloudAuthRequiredNotice({ scan });
  const cloudReason = String(reason || "").trim();
  const sampleDetail = localSampleDetail(scan);
  if (sampleDetail) {
    return {
      tone: "warn",
      label: "Copia local",
      detail: cloudReason ? `${cloudReason} ${sampleDetail}` : sampleDetail,
      source: "session-sample",
      sampled: true,
      rowsAvailable: Number(scan.rowsAvailable),
      rowsReturned: scan.rows.length,
    };
  }
  return {
    tone: "warn",
    label: "Datos sin renovar",
    detail: `${cloudReason} Se muestran los datos guardados en este navegador; recarga la página para reintentar.`.trim(),
    source: "session-stale",
  };
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
    details.push(
      duration
        ? `La última sincronización no llegó a tiempo; sigues viendo el escaneo de hace ${duration}. Puedes seguir filtrando con normalidad.`
        : "La última sincronización no llegó a tiempo; sigues viendo el último escaneo guardado. Puedes seguir filtrando con normalidad.",
    );
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
      ? `Se muestran ${rowsReturned} de ${rowsAvailable} acciones: una muestra repartida por todo el ranking, porque solo se cargó parte del universo en este dispositivo.`
      : `Se muestran ${rowsReturned} de ${rowsAvailable} acciones; solo se cargó parte del universo en este dispositivo.`);
  }
  if (partialRows > 0) {
    details.push(`${partialRows} filas tienen datos incompletos; revísalas antes de decidir.`);
  }

  return {
    tone: stale || truncated ? "warn" : "info",
    label: stale ? "Sin actualizar hoy" : truncated ? "Datos incompletos" : "Datos parciales",
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
