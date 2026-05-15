async function requestJson(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
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

export function mergeByKey(remote = [], local = [], keyFn = (item) => item.id) {
  const map = new Map();
  for (const item of [...remote, ...local]) {
    const key = keyFn(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return [...map.values()];
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

export async function deleteFavoriteFromCloud(favorite) {
  const query = favorite?.id ? `id=${encodeURIComponent(favorite.id)}` : `symbol=${encodeURIComponent(favorite?.symbol || "")}`;
  return requestJson(`/api/favorites?${query}`, { method: "DELETE" });
}

export async function syncFavoritesToCloud(favorites = []) {
  if (!favorites.length) return { ok: true, configured: true, message: "Sin favoritos para subir", data: { saved: 0 } };
  return requestJson("/api/favorites", { method: "POST", body: JSON.stringify({ favorites }) });
}

export async function pushCloudState({ scans = [], favorites = [] }) {
  const scanResult = await syncScansToCloud(scans);
  const favoriteResult = await syncFavoritesToCloud(favorites);
  const configured = scanResult.configured !== false && favoriteResult.configured !== false;
  const ok = scanResult.ok && favoriteResult.ok;
  return {
    configured,
    ok,
    scansSaved: scanResult.data?.saved || 0,
    favoritesSaved: favoriteResult.data?.saved || 0,
    message: !configured ? "Supabase no configurado" : ok ? "Datos subidos a Supabase" : scanResult.message || favoriteResult.message,
    details: { scanResult, favoriteResult },
  };
}

export async function pullCloudState() {
  const scanResult = await requestJson("/api/scans?includeRows=1");
  const favoriteResult = await requestJson("/api/favorites");
  const configured = scanResult.configured !== false && favoriteResult.configured !== false;
  const ok = scanResult.ok && favoriteResult.ok;
  return {
    configured,
    ok,
    scans: scanResult.data?.scans || [],
    favorites: favoriteResult.data?.favorites || [],
    message: !configured ? "Supabase no configurado" : ok ? "Datos importados de Supabase" : scanResult.message || favoriteResult.message,
    details: { scanResult, favoriteResult },
  };
}
