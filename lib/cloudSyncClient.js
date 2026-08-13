import { readFavoriteTombstones, readScanTombstones, writeFavoriteTombstones, writeScanTombstones } from "@/lib/localState";

const PERSISTENCE_TOKEN_KEY = "statsedge.persistenceToken.v1";

export function readPersistenceToken() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(PERSISTENCE_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function writePersistenceToken(token = "") {
  if (typeof window === "undefined") return false;
  try {
    const clean = String(token || "").trim();
    if (clean) localStorage.setItem(PERSISTENCE_TOKEN_KEY, clean);
    else localStorage.removeItem(PERSISTENCE_TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}

function persistenceAuthHeaders() {
  const token = readPersistenceToken();
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function requestJson(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...persistenceAuthHeaders(),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return { ok: false, configured: data.configured ?? true, message: data.error || data.message || `HTTP ${res.status}`, data };
    return { ok: data.ok !== false, configured: data.configured !== false, message: data.message || "", data };
  } catch (error) {
    return { ok: false, configured: true, message: error.message || "La nube no está disponible", data: null };
  }
}

function readLocalAlertsForPush() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("statsedge.alerts.v1") || "[]");
  } catch {
    return [];
  }
}

export function mergeByKey(remote = [], local = [], keyFn = (item) => item.id) {
  const map = new Map();
  for (const item of [...remote, ...local]) {
    const key = keyFn(item);
    if (!key) continue;
    const current = map.get(key);
    if (current && !isNewer(item, current)) continue;
    map.set(key, item);
  }
  return [...map.values()];
}

function timeValue(item = {}) {
  const raw = item.updatedAt || item.updated_at || item.deletedAt || item.deleted_at || item.createdAt || item.created_at || item.addedAt || item.added_at;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function isNewer(candidate = {}, current = {}) {
  return timeValue(candidate) >= timeValue(current);
}

function favoriteKey(item = {}) {
  return String(item.symbol || item.ticker || "").trim().toUpperCase();
}

function scanKey(item = {}) {
  return String(item.id || item.localId || item.local_id || item.cloudId || "").trim();
}

function alertKey(item = {}) {
  return String(item.id || item.localId || item.local_id || item.payload?.localId || item.cloudId || "").trim();
}

function tombstoneTime(item = {}) {
  return timeValue({ updatedAt: item.deletedAt || item.deleted_at || item.updatedAt || item.updated_at });
}

function compactTombstones(tombstones = []) {
  const bySymbol = new Map();
  for (const item of tombstones) {
    const symbol = favoriteKey(item);
    if (!symbol) continue;
    const current = bySymbol.get(symbol);
    const next = {
      id: item.id || item.localId || item.local_id || null,
      localId: item.localId || item.local_id || item.id || null,
      symbol,
      deletedAt: item.deletedAt || item.deleted_at || item.updatedAt || item.updated_at || new Date().toISOString(),
      updatedAt: item.updatedAt || item.updated_at || item.deletedAt || item.deleted_at || new Date().toISOString(),
    };
    if (!current || tombstoneTime(next) >= tombstoneTime(current)) bySymbol.set(symbol, next);
  }
  return [...bySymbol.values()].sort((a, b) => tombstoneTime(b) - tombstoneTime(a)).slice(0, 500);
}

export function recordFavoriteTombstone(favorite = {}, deletedAt = new Date().toISOString()) {
  const symbol = favoriteKey(favorite);
  if (!symbol) return null;
  const tombstone = {
    id: favorite.id || favorite.localId || favorite.local_id || null,
    localId: favorite.id || favorite.localId || favorite.local_id || null,
    symbol,
    deletedAt,
    updatedAt: deletedAt,
  };
  writeFavoriteTombstones(compactTombstones([tombstone, ...readFavoriteTombstones()]));
  return tombstone;
}

function clearSyncedFavoriteTombstones(synced = []) {
  const syncedBySymbol = new Map(compactTombstones(synced).map((item) => [favoriteKey(item), tombstoneTime(item)]));
  if (!syncedBySymbol.size) return;
  const remaining = readFavoriteTombstones().filter((item) => {
    const symbol = favoriteKey(item);
    const syncedTime = syncedBySymbol.get(symbol);
    return !syncedTime || tombstoneTime(item) > syncedTime;
  });
  writeFavoriteTombstones(compactTombstones(remaining));
}

export function mergeFavoritesWithTombstones(remote = [], local = [], tombstones = []) {
  const tombstoneBySymbol = new Map();
  for (const item of compactTombstones([...tombstones, ...readFavoriteTombstones()])) {
    const symbol = favoriteKey(item);
    if (!symbol) continue;
    const current = tombstoneBySymbol.get(symbol);
    if (!current || tombstoneTime(item) >= tombstoneTime(current)) tombstoneBySymbol.set(symbol, item);
  }

  return mergeByKey(remote, local, favoriteKey)
    .filter((favorite) => {
      const tombstone = tombstoneBySymbol.get(favoriteKey(favorite));
      return !tombstone || tombstoneTime(tombstone) < timeValue(favorite);
    });
}

function compactScanTombstones(tombstones = []) {
  const byId = new Map();
  for (const item of tombstones) {
    const id = scanKey(item);
    if (!id) continue;
    const next = {
      id,
      localId: item.localId || item.local_id || id,
      deletedAt: item.deletedAt || item.deleted_at || item.updatedAt || item.updated_at || new Date().toISOString(),
      updatedAt: item.updatedAt || item.updated_at || item.deletedAt || item.deleted_at || new Date().toISOString(),
    };
    const current = byId.get(id);
    if (!current || tombstoneTime(next) >= tombstoneTime(current)) byId.set(id, next);
  }
  return [...byId.values()].sort((a, b) => tombstoneTime(b) - tombstoneTime(a)).slice(0, 500);
}

export function recordScanTombstone(scan = {}, deletedAt = new Date().toISOString()) {
  const id = scanKey(scan);
  if (!id) return null;
  const tombstone = {
    id,
    localId: scan.localId || scan.local_id || id,
    deletedAt,
    updatedAt: deletedAt,
  };
  writeScanTombstones(compactScanTombstones([tombstone, ...readScanTombstones()]));
  return tombstone;
}

function clearSyncedScanTombstones(synced = []) {
  const syncedById = new Map(compactScanTombstones(synced).map((item) => [scanKey(item), tombstoneTime(item)]));
  if (!syncedById.size) return;
  const remaining = readScanTombstones().filter((item) => {
    const id = scanKey(item);
    const syncedTime = syncedById.get(id);
    return !syncedTime || tombstoneTime(item) > syncedTime;
  });
  writeScanTombstones(compactScanTombstones(remaining));
}

export function mergeScansWithTombstones(remote = [], local = [], tombstones = []) {
  const tombstoneById = new Map();
  for (const item of compactScanTombstones([...tombstones, ...readScanTombstones()])) {
    const id = scanKey(item);
    if (!id) continue;
    const current = tombstoneById.get(id);
    if (!current || tombstoneTime(item) >= tombstoneTime(current)) tombstoneById.set(id, item);
  }

  return mergeByKey(remote, local, scanKey)
    .filter((scan) => {
      const tombstone = tombstoneById.get(scanKey(scan));
      return !tombstone || tombstoneTime(tombstone) < timeValue(scan);
    });
}

export function mergeAlertsWithTimestamps(remote = [], local = []) {
  return mergeByKey(remote, local, alertKey);
}

export async function getCloudStatus() {
  const result = await requestJson("/api/supabase/status");
  return { ...result.data, ok: result.ok, configured: result.configured, message: result.message || result.data?.message || "" };
}

export async function syncScanToCloud(scan) {
  return requestJson("/api/scans", { method: "POST", body: JSON.stringify({ scan }) });
}

export async function syncScansToCloud(scans = []) {
  if (!scans.length) return { ok: true, configured: true, message: "Sin snapshots para subir", data: { saved: 0 } };
  return requestJson("/api/scans", { method: "POST", body: JSON.stringify({ scans }) });
}

export async function deleteScanFromCloud(scan) {
  const tombstone = recordScanTombstone(scan);
  const deletedAt = tombstone?.deletedAt || new Date().toISOString();
  const result = await requestJson(`/api/scans?id=${encodeURIComponent(scan?.id || scan)}&deletedAt=${encodeURIComponent(deletedAt)}`, { method: "DELETE" });
  if (result.ok && result.configured !== false && tombstone) clearSyncedScanTombstones([tombstone]);
  return result;
}

export async function syncScanDeletesToCloud(tombstones = readScanTombstones()) {
  const compacted = compactScanTombstones(tombstones);
  if (!compacted.length) return { ok: true, configured: true, message: "Sin borrados de snapshots para subir", data: { deleted: 0, skippedStale: 0 } };
  const result = await requestJson("/api/scans", { method: "DELETE", body: JSON.stringify({ tombstones: compacted }) });
  if (result.ok && result.configured !== false) clearSyncedScanTombstones(compacted);
  return result;
}

// Solo el escaneo más reciente: limit=1 es la única combinación que activa
// la caché de app/api/scans/route.js (cacheableLatest), y hace que
// rank_index vuelva a ser un orden significativo (es la posición DENTRO de
// un escaneo, no un orden global entre varios). rowsLimit=500 es diez
// páginas de 50 filas (DEFAULT_RESULT_PAGE_SIZE, lib/screenerConfig.js) o
// cinco de 100 — suficiente para paginar sin volver al servidor en un uso
// normal, muy por debajo de las 9.918 filas de un escaneo grande. Si el
// escaneo tiene más filas que esto, /api/scans lo reporta (rowsTruncated)
// y la UI lo avisa; no se pide "todo por si acaso".
export async function getLatestScanFromCloud() {
  return requestJson("/api/scans?includeRows=1&limit=1&rowsLimit=500");
}

export async function syncFavoriteToCloud(favorite) {
  return requestJson("/api/favorites", { method: "POST", keepalive: true, body: JSON.stringify({ favorite }) });
}

export async function getAlertsFromCloud(status = "active") {
  return requestJson(`/api/alerts?status=${encodeURIComponent(status)}`);
}

export async function syncAlertsToCloud(alerts = []) {
  if (!alerts.length) return { ok: true, configured: true, message: "Sin alertas para subir", data: { saved: 0 } };
  return requestJson("/api/alerts", { method: "POST", body: JSON.stringify({ alerts }) });
}

export async function resolveAlertInCloud(alert) {
  const localId = alert?.localId || alert?.payload?.localId || alert?.id;
  if (!alert?.cloudId && !localId) return { ok: true, configured: true, skipped: true, message: "Alerta solo local" };
  return requestJson("/api/alerts", { method: "PATCH", body: JSON.stringify({ cloudId: alert.cloudId || null, localId, status: alert.status || "resolved", payload: alert.payload || {} }) });
}

export async function getSettingFromCloud(type, key = "default") {
  return requestJson(`/api/settings?type=${encodeURIComponent(type)}&key=${encodeURIComponent(key)}`);
}

export async function syncSettingToCloud({ type, key = "default", value = {} } = {}) {
  return requestJson("/api/settings", { method: "POST", body: JSON.stringify({ type, key, value, updatedAt: value?.updatedAt }) });
}

export async function deleteFavoriteFromCloud(favorite) {
  const tombstone = recordFavoriteTombstone(favorite);
  const deletedAt = tombstone?.deletedAt || new Date().toISOString();
  const query = favorite?.symbol
    ? `symbol=${encodeURIComponent(favorite.symbol)}&deletedAt=${encodeURIComponent(deletedAt)}`
    : `id=${encodeURIComponent(favorite?.id || favorite || "")}&deletedAt=${encodeURIComponent(deletedAt)}`;
  const result = await requestJson(`/api/favorites?${query}`, { method: "DELETE" });
  if (result.ok && result.configured !== false && tombstone) clearSyncedFavoriteTombstones([tombstone]);
  return result;
}

export async function syncFavoritesToCloud(favorites = []) {
  if (!favorites.length) return { ok: true, configured: true, message: "Sin favoritos para subir", data: { saved: 0 } };
  return requestJson("/api/favorites", { method: "POST", body: JSON.stringify({ favorites }) });
}

export async function syncFavoriteDeletesToCloud(tombstones = readFavoriteTombstones()) {
  const compacted = compactTombstones(tombstones);
  if (!compacted.length) return { ok: true, configured: true, message: "Sin borrados de favoritos para subir", data: { deleted: 0, skippedStale: 0 } };
  const result = await requestJson("/api/favorites", { method: "DELETE", body: JSON.stringify({ tombstones: compacted }) });
  if (result.ok && result.configured !== false) clearSyncedFavoriteTombstones(compacted);
  return result;
}

export async function pushCloudState({ scans = [], favorites = [], alerts = null } = {}) {
  const scanDeleteResult = await syncScanDeletesToCloud();
  const scanResult = await syncScansToCloud(scans);
  const favoriteDeleteResult = await syncFavoriteDeletesToCloud();
  const favoriteResult = await syncFavoritesToCloud(favorites);
  const alertsToPush = Array.isArray(alerts) ? alerts : readLocalAlertsForPush();
  const alertResult = await syncAlertsToCloud(alertsToPush.filter((alert) => alert.status !== "resolved" && alert.status !== "dismissed"));
  const configured = scanDeleteResult.configured !== false && scanResult.configured !== false && favoriteDeleteResult.configured !== false && favoriteResult.configured !== false && alertResult.configured !== false;
  const ok = scanDeleteResult.ok && scanResult.ok && favoriteDeleteResult.ok && favoriteResult.ok && alertResult.ok;
  return {
    configured,
    ok,
    scansDeleted: scanDeleteResult.data?.deleted || 0,
    scansDeleteSkippedStale: scanDeleteResult.data?.skippedStale || 0,
    scansSaved: scanResult.data?.saved || 0,
    favoritesDeleted: favoriteDeleteResult.data?.deleted || 0,
    favoritesDeleteSkippedStale: favoriteDeleteResult.data?.skippedStale || 0,
    favoritesSaved: favoriteResult.data?.saved || 0,
    favoritesSkippedStale: favoriteResult.data?.skippedStale || 0,
    alertsSaved: alertResult.data?.saved || 0,
    message: !configured ? "La copia en la nube no está activada" : ok ? "Datos subidos a la nube" : scanDeleteResult.message || scanResult.message || favoriteDeleteResult.message || favoriteResult.message || alertResult.message,
    details: { scanDeleteResult, scanResult, favoriteDeleteResult, favoriteResult, alertResult },
  };
}

export async function pullCloudState() {
  const scanResult = await requestJson("/api/scans?includeRows=1&includeDeleted=1");
  const favoriteResult = await requestJson("/api/favorites?includeDeleted=1");
  const alertResult = await requestJson("/api/alerts?status=all");
  const configured = scanResult.configured !== false && favoriteResult.configured !== false && alertResult.configured !== false;
  const ok = scanResult.ok && favoriteResult.ok && alertResult.ok;
  return {
    configured,
    ok,
    scans: scanResult.data?.scans || [],
    scanTombstones: scanResult.data?.scanTombstones || [],
    favorites: favoriteResult.data?.favorites || [],
    favoriteTombstones: favoriteResult.data?.favoriteTombstones || [],
    alerts: alertResult.data?.alerts || [],
    message: !configured ? "La copia en la nube no está activada" : ok ? "Datos importados de la nube" : scanResult.message || favoriteResult.message || alertResult.message,
    details: { scanResult, favoriteResult, alertResult },
  };
}
