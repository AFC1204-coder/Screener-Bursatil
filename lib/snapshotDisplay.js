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
    ? `Snapshot del ${date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}`
    : "Snapshot guardado";
}

export function snapshotDisplaySource(scan = {}) {
  return scan?.preset === "manual" ? "Guardado manual" : "Datos guardados";
}

export function snapshotDisplayUpdate(scan = {}) {
  return scan?.marketRegime ? "Actualización disponible" : "Datos guardados";
}
