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
  return token ? { "x-statsedge-token": token } : {};
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
    return { ok: false, configured: true, message: error.message || "Supabase no disponible", data: null };
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
  const raw = item.updatedAt || item.updated_at || item.createdAt || item.created_at || item.addedAt || item.added_at;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function isNewer(candidate = {}, current = {}) {
  return timeValue(candidate) >= timeValue(current);
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
  return requestJson(`/api/scans?id=${encodeURIComponent(scan?.id || scan)}`, { method: "DELETE" });
}

export async function syncFavoriteToCloud(favorite) {
  return requestJson("/api/favorites", { method: "POST", body: JSON.stringify({ favorite }) });
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
  return requestJson("/api/settings", { method: "POST", body: JSON.stringify({ type, key, value }) });
}

export async function deleteFavoriteFromCloud(favorite) {
  const query = favorite?.symbol ? `symbol=${encodeURIComponent(favorite.symbol)}` : `id=${encodeURIComponent(favorite?.id || favorite || "")}`;
  return requestJson(`/api/favorites?${query}`, { method: "DELETE" });
}

export async function syncFavoritesToCloud(favorites = []) {
  if (!favorites.length) return { ok: true, configured: true, message: "Sin favoritos para subir", data: { saved: 0 } };
  return requestJson("/api/favorites", { method: "POST", body: JSON.stringify({ favorites }) });
}

export async function pushCloudState({ scans = [], favorites = [], alerts = null } = {}) {
  const scanResult = await syncScansToCloud(scans);
  const favoriteResult = await syncFavoritesToCloud(favorites);
  const alertsToPush = Array.isArray(alerts) ? alerts : readLocalAlertsForPush();
  const alertResult = await syncAlertsToCloud(alertsToPush.filter((alert) => alert.status !== "resolved" && alert.status !== "dismissed"));
  const configured = scanResult.configured !== false && favoriteResult.configured !== false && alertResult.configured !== false;
  const ok = scanResult.ok && favoriteResult.ok && alertResult.ok;
  return {
    configured,
    ok,
    scansSaved: scanResult.data?.saved || 0,
    favoritesSaved: favoriteResult.data?.saved || 0,
    alertsSaved: alertResult.data?.saved || 0,
    message: !configured ? "Supabase no configurado" : ok ? "Datos subidos a Supabase" : scanResult.message || favoriteResult.message || alertResult.message,
    details: { scanResult, favoriteResult, alertResult },
  };
}

export async function pullCloudState() {
  const scanResult = await requestJson("/api/scans?includeRows=1");
  const favoriteResult = await requestJson("/api/favorites");
  const alertResult = await requestJson("/api/alerts?status=all");
  const configured = scanResult.configured !== false && favoriteResult.configured !== false && alertResult.configured !== false;
  const ok = scanResult.ok && favoriteResult.ok && alertResult.ok;
  return {
    configured,
    ok,
    scans: scanResult.data?.scans || [],
    favorites: favoriteResult.data?.favorites || [],
    alerts: alertResult.data?.alerts || [],
    message: !configured ? "Supabase no configurado" : ok ? "Datos importados de Supabase" : scanResult.message || favoriteResult.message || alertResult.message,
    details: { scanResult, favoriteResult, alertResult },
  };
}
