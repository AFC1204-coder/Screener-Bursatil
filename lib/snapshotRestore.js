import { isTerminalScanStatus } from "@/lib/scanStatus";
import { CRON_LOCAL_ID_PREFIX, isNightlyUsLocalId } from "@/lib/scanLocalId";

function timestampValue(value) {
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function scanTime(scan = {}) {
  return timestampValue(scan.updatedAt || scan.updated_at || scan.createdAt || scan.created_at);
}

function restorePriority(scan = {}) {
  const status = scan.settings?.progress?.status;
  if (isTerminalScanStatus(status)) return 3;
  if (!status) return 2;
  return 1;
}

export function snapshotRowsAreFiltered(scan = {}) {
  const explicit = scan.rowsAreFilteredSnapshot ?? scan.settings?.rowsAreFilteredSnapshot;
  if (explicit !== undefined && explicit !== null) return explicit !== false;
  return !scan.settings?.progress;
}

export function restoredSnapshotView(scan = {}, activeSettings = {}, context = {}, filterRows) {
  const analyzedRows = Array.isArray(scan.rows) ? scan.rows : [];
  const rowsAreFilteredSnapshot = snapshotRowsAreFiltered(scan);
  if (rowsAreFilteredSnapshot) {
    return { rows: analyzedRows, analyzedRows, diagnostics: null, filterMs: 0, rowsAreFilteredSnapshot };
  }
  const filtered = typeof filterRows === "function"
    ? filterRows(analyzedRows, activeSettings, context)
    : { rows: [], diagnostics: null, filterMs: 0 };
  return {
    rows: Array.isArray(filtered.rows) ? filtered.rows : [],
    analyzedRows,
    diagnostics: filtered.diagnostics || null,
    filterMs: Number.isFinite(filtered.filterMs) ? filtered.filterMs : 0,
    rowsAreFilteredSnapshot,
  };
}

export function restorableScans(scans = []) {
  return (Array.isArray(scans) ? scans : [])
    .filter((scan) => scan && Array.isArray(scan.rows) && scan.rows.length > 0)
    .sort((a, b) => (restorePriority(b) - restorePriority(a)) || (scanTime(b) - scanTime(a)));
}

export function pickBestRestorableScan(scans = []) {
  return restorableScans(scans)[0] || null;
}

// El mismo anclaje que el servidor, aplicado a la copia local. Los snapshots
// guardados llevan como `id` el `local_id` del escaneo del que salieron
// (app/api/scans/route.js → scanFromDb), así que aquí se reconoce al nocturno
// estadounidense por el mismo prefijo. Los snapshots que guarda el usuario a
// mano llevan un uid y no casan: se siguen viendo en el escritorio de
// investigación, pero no son "los datos de anoche" y no repueblan el arranque.
export function restorableNightlyUsScans(scans = []) {
  return restorableScans(scans).filter((scan) => isNightlyUsLocalId(scan?.id));
}

export function pickNightlyUsRestorableScan(scans = []) {
  return restorableNightlyUsScans(scans)[0] || null;
}

// Limpieza para "Reset sesión": tira los snapshots del cron de OTROS mercados
// que el arranque llegó a cachear mientras pedía "el más reciente" (JP, IT-ES…).
// Son residuo del fallo, nunca los creó el usuario, y mientras sigan ahí
// encabezan la lista local que leen otras pantallas (ipo-radar, sectores).
// Los snapshots guardados a mano llevan uid y NO se tocan: borrarlos sería
// destruir trabajo del usuario en un botón que solo promete reiniciar la sesión.
export function dropForeignMarketSnapshots(scans = []) {
  return (Array.isArray(scans) ? scans : []).filter((scan) => {
    const id = String(scan?.id || "");
    return !id.startsWith(CRON_LOCAL_ID_PREFIX) || isNightlyUsLocalId(id);
  });
}
