import { dateShort } from "@/lib/formatters";

// Etiquetas de snapshots para las pantallas de producto. Los valores que
// persiste el sistema pueden contener detalles de implementación; nunca se
// muestran tal cual al usuario.

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function snapshotDisplayName(scan = {}) {
  const date = validDate(scan.createdAt || scan.updatedAt);
  return date
    ? `Snapshot del ${dateShort(date)}`
    : "Snapshot guardado";
}

export function snapshotDisplaySource(scan = {}) {
  return scan?.preset === "manual" ? "Guardado manual" : "Datos guardados";
}

export function snapshotDisplayUpdate(scan = {}) {
  return scan?.marketRegime ? "Actualización disponible" : "Datos guardados";
}

// Cuántas filas tiene el snapshot, aunque este dispositivo no las guarde.
// Con la copia en la nube activa, localStorage solo guarda la ficha del
// escaneo (lib/localScanPersistence.js → scanMetaForLocalStorage: rows: [] y
// rowsAvailable = total real). Research Desk contaba rows.length y decía
// «0 filas · 0 acciones» de un nocturno de 3.287 (auditoría de producto
// 2026-11, D6). Devuelve { local, total, remoteOnly }.
export function snapshotRowCounts(scan = {}) {
  const local = Array.isArray(scan?.rows) ? scan.rows.length : 0;
  const available = Number(scan?.rowsAvailable);
  const total = Number.isFinite(available) && available > local ? available : local;
  return { local, total, remoteOnly: local === 0 && total > 0 && scan?.rowsStoredRemotely === true };
}

/** «3.287 acciones», o «3.287 acciones (en el servidor)» si aquí no están. */
export function snapshotRowCountLabel(scan = {}, noun = "acciones") {
  const { total, remoteOnly } = snapshotRowCounts(scan);
  return `${total.toLocaleString("es-ES")} ${noun}${remoteOnly ? " (en el servidor)" : ""}`;
}
