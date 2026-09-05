import {
  STORAGE_KEYS,
  budgetFor,
  freeUpLocalScans,
  payloadChars,
  reportStorageOutcome,
  safeWrite,
} from "@/lib/localState";
import { fitScansForBrowser } from "@/lib/screenerPipeline";

const REMOTE_PERSISTENCE_SESSION_KEY = "statsedge.remotePersistence.v1";

let remotePersistenceConfigured = null;

export function getRemotePersistenceConfigured() {
  if (remotePersistenceConfigured !== null) return remotePersistenceConfigured;
  if (typeof window === "undefined") return false;
  try {
    remotePersistenceConfigured = sessionStorage.getItem(REMOTE_PERSISTENCE_SESSION_KEY) === "1";
  } catch {
    remotePersistenceConfigured = false;
  }
  return remotePersistenceConfigured;
}

export function setRemotePersistenceConfigured(configured) {
  remotePersistenceConfigured = Boolean(configured);
  if (typeof window === "undefined") return;
  try {
    if (remotePersistenceConfigured) sessionStorage.setItem(REMOTE_PERSISTENCE_SESSION_KEY, "1");
    else sessionStorage.removeItem(REMOTE_PERSISTENCE_SESSION_KEY);
  } catch {
    // sessionStorage bloqueado: el flag en memoria basta para esta visita.
  }
}

// Proyección mínima para localStorage cuando la fuente de verdad es el servidor.
// Conserva identidad y contadores; las filas viven en Postgres/PostgREST.
export function scanMetaForLocalStorage(scan = {}) {
  if (!scan || typeof scan !== "object") return scan;
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const {
    rows: _rows,
    rowsStoredRemotely: _stored,
    ...meta
  } = scan;
  return {
    ...meta,
    rowsStoredRemotely: true,
    rows: [],
    rowsAvailable: Number.isFinite(scan.rowsAvailable) ? scan.rowsAvailable : rows.length,
    rowsReturned: Number.isFinite(scan.rowsReturned) ? scan.rowsReturned : rows.length,
  };
}

export function prepareScansForLocalStorage(scans = [], { remoteConfigured = getRemotePersistenceConfigured() } = {}) {
  const list = (Array.isArray(scans) ? scans : []).filter(Boolean);
  if (remoteConfigured) return list.map(scanMetaForLocalStorage);
  return fitScansForBrowser(list);
}

// Único punto de escritura para STORAGE_KEYS.scans. Con persistencia remota
// activa no intenta guardar filas completas (evita QuotaExceeded en mesa US
// 3k+). Sin remoto, degrada con fitScansForBrowser en silencio y solo avisa
// si no pudo guardar nada útil.
export function persistLocalScans(scans = [], { remoteConfigured = getRemotePersistenceConfigured() } = {}) {
  const list = (Array.isArray(scans) ? scans : []).filter(Boolean);
  const primary = prepareScansForLocalStorage(list, { remoteConfigured });

  if (safeWrite(STORAGE_KEYS.scans, primary, { silent: true })) return true;

  if (remoteConfigured) {
    const minimal = list.map((scan) => scanMetaForLocalStorage(scan));
    if (safeWrite(STORAGE_KEYS.scans, minimal, { silent: true })) return true;
    return false;
  }

  freeUpLocalScans(1);
  const retry = fitScansForBrowser(list.slice(0, 1));
  if (safeWrite(STORAGE_KEYS.scans, retry, { silent: true })) return true;

  const budget = budgetFor(STORAGE_KEYS.scans);
  if (list.length === 1 && Number.isFinite(budget) && budget > 0) {
    const fitted = fitScansForBrowser(list, budget);
    if (payloadChars(fitted) <= budget && safeWrite(STORAGE_KEYS.scans, fitted, { silent: true })) {
      return true;
    }
  }

  reportStorageOutcome({ key: STORAGE_KEYS.scans, failed: true });
  return false;
}
