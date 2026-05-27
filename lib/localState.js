export const STORAGE_KEYS = {
  scans: "statsedge.scans.v1",
  scanTombstones: "statsedge.scanTombstones.v1",
  favorites: "statsedge.favorites.v1",
  favoriteTombstones: "statsedge.favoriteTombstones.v1",
  alerts: "statsedge.alerts.v1",
  review: "statsedge.review.v1",
  chartSettings: "statsedge.chartSettings.v1",
  ipoRadar: "statsedge.ipoRadar.v1",
  screenerSession: "statsedge.screenerSession.v1",
  screenerFilterTemplates: "statsedge.screenerFilterTemplates.v1",
};

export function safeRead(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function safeWrite(key, value) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // localStorage can fail in private mode or when a large screener session exceeds quota.
    return false;
  }
}

export function safeRemove(key) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    // Ignore storage errors so the UI remains usable.
    return false;
  }
}

export function readScans() {
  return safeRead(STORAGE_KEYS.scans, []);
}

export function writeScans(scans = []) {
  safeWrite(STORAGE_KEYS.scans, scans);
}

export function readScanTombstones() {
  return safeRead(STORAGE_KEYS.scanTombstones, []);
}

export function writeScanTombstones(tombstones = []) {
  safeWrite(STORAGE_KEYS.scanTombstones, tombstones);
}

export function readFavorites() {
  return safeRead(STORAGE_KEYS.favorites, []);
}

export function writeFavorites(favorites = []) {
  safeWrite(STORAGE_KEYS.favorites, favorites);
}

export function readFavoriteTombstones() {
  return safeRead(STORAGE_KEYS.favoriteTombstones, []);
}

export function writeFavoriteTombstones(tombstones = []) {
  safeWrite(STORAGE_KEYS.favoriteTombstones, tombstones);
}

export function readAlerts() {
  return safeRead(STORAGE_KEYS.alerts, []);
}

export function writeAlerts(alerts = []) {
  safeWrite(STORAGE_KEYS.alerts, alerts);
}

export function readReviewQueue() {
  return safeRead(STORAGE_KEYS.review, {});
}

export function writeReviewQueue(review = {}) {
  safeWrite(STORAGE_KEYS.review, review);
}

export function readIpoRadar() {
  return safeRead(STORAGE_KEYS.ipoRadar, []);
}

export function writeIpoRadar(items = []) {
  safeWrite(STORAGE_KEYS.ipoRadar, items);
}
