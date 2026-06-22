import { isTerminalScanStatus } from "@/lib/scanStatus";

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
