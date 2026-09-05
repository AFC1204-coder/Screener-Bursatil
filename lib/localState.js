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
  listViews: "statsedge.listViews.v1",
};

// ── Presupuesto de persistencia ────────────────────────────────────────────
// La cuota de localStorage de un navegador real es de 5-10 MB por origen.
// Estas tres claves son las únicas que crecen con los datos (las demás están
// acotadas por número: 250 favoritos, 500 alertas, plantillas). El presupuesto
// se mide en caracteres de JSON (≈ bytes en ASCII) y deja margen para el resto
// incluso en la cuota más estricta de 5 MB... salvo scans, que usa la banda
// alta y se recorta primero cuando algo no cabe (freeUpLocalScans).
//
// Orden de descarte cuando una escritura no cabe:
//   1. scans → se queda solo el snapshot más reciente.
//   2. review → pierde las miniaturas; la cola y las resoluciones se quedan.
//   3. screenerSession → cae a solo-criterios (sin referencia de filas).
// Quien degrada avisa: cada caída de nivel pasa por notifyWriteFailure y las
// superficies suscritas muestran el aviso de producto.
export const STORAGE_BUDGETS = {
  [STORAGE_KEYS.scans]: 4_500_000,
  // 3 MB permiten que una cola típica (~280 filas ligeras de ~8,6 KB, medido
  // el 2026-08-15) conserve las miniaturas; con 2,5 MB rozaba el límite y la
  // degradación las quitaba en el primer uso.
  [STORAGE_KEYS.review]: 3_000_000,
  [STORAGE_KEYS.screenerSession]: 1_500_000,
};

export function budgetFor(key) {
  return STORAGE_BUDGETS[key] || null;
}

export function payloadChars(value) {
  try {
    return JSON.stringify(value)?.length || 0;
  } catch {
    return 0;
  }
}

// ── Notificación de fallos de escritura ────────────────────────────────────
// safeWrite se tragaba el error de cuota y la función que dependía del dato
// desaparecía sin mensaje (la cola de revisión nunca se escribía y el raíl de
// la ficha no aparecía). Ahora cada fallo queda registrado y notificado; las
// páginas se suscriben y muestran el aviso en lenguaje de producto.
const writeFailureListeners = new Set();
let lastFailure = null;

export function isQuotaError(error) {
  if (!error) return false;
  const name = String(error.name || "");
  const code = Number(error.code);
  return name === "QuotaExceededError"
    || name === "NS_ERROR_DOM_QUOTA_REACHED"
    || code === 22
    || code === 1014;
}

function notifyWriteFailure(failure) {
  lastFailure = failure;
  for (const listener of [...writeFailureListeners]) {
    try {
      listener(failure);
    } catch {
      // Un listener roto no debe impedir avisar al resto.
    }
  }
}

export function subscribeStorageWriteFailures(listener) {
  if (typeof listener !== "function") return () => {};
  writeFailureListeners.add(listener);
  return () => writeFailureListeners.delete(listener);
}

export function lastStorageWriteFailure() {
  return lastFailure;
}

// Desenlace de una escritura orquestada (con degradación y reintentos). Los
// orquestadores llaman a safeWrite con {silent: true} para que los intentos
// intermedios no disparen avisos, y reportan aquí UNA vez lo que pasó:
//   - degraded: se guardó, pero una versión reducida.
//   - failed: no se pudo guardar ni reducido.
export function reportStorageOutcome({ key, degraded = false, failed = false, quota = true, detail = "" } = {}) {
  if (!degraded && !failed) return;
  notifyWriteFailure({
    key,
    quota,
    degraded,
    failed,
    detail,
    at: new Date().toISOString(),
  });
}

// Tamaño real por clave statsedge.* — para diagnóstico y verificación.
export function storageFootprint() {
  if (typeof window === "undefined") return { totalChars: 0, keys: [] };
  const keys = [];
  let totalChars = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("statsedge.")) continue;
      const chars = (localStorage.getItem(key) || "").length;
      totalChars += chars;
      keys.push({ key, chars });
    }
  } catch {
    return { totalChars: 0, keys: [] };
  }
  keys.sort((a, b) => b.chars - a.chars);
  return { totalChars, keys };
}

// Primer nivel de descarte: los snapshots locales viejos. Devuelve cuántos
// caracteres liberó, para que el llamador decida si merece reintentar.
export function freeUpLocalScans(keep = 1) {
  const scans = readScans();
  if (!Array.isArray(scans) || scans.length <= keep) return 0;
  const before = payloadChars(scans);
  const kept = scans.slice(0, Math.max(1, keep));
  if (!safeWrite(STORAGE_KEYS.scans, kept, { silent: true })) return 0;
  return Math.max(0, before - payloadChars(kept));
}

export function safeRead(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function safeWrite(key, value, { silent = false } = {}) {
  if (typeof window === "undefined") return false;
  let payload = "";
  try {
    payload = JSON.stringify(value);
    localStorage.setItem(key, payload);
    return true;
  } catch (error) {
    // localStorage puede fallar en modo privado o por cuota. El fallo ya no se
    // traga: queda registrado y (salvo intentos intermedios de un orquestador
    // con silent) notificado para que el producto avise.
    const failure = {
      key,
      quota: isQuotaError(error),
      failed: true,
      chars: payload.length,
      at: new Date().toISOString(),
      message: String(error?.message || error || ""),
    };
    lastFailure = failure;
    if (!silent) notifyWriteFailure(failure);
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
  safeWrite(STORAGE_KEYS.scans, scans, { silent: true });
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
