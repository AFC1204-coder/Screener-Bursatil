import { beforeEach, describe, expect, it } from "vitest";

import {
  shouldShowStorageAlert,
  buildStorageAlertMessage,
} from "@/app/components/StorageAlert";
import {
  STORAGE_KEYS,
  lastStorageWriteFailure,
  subscribeStorageWriteFailures,
} from "@/lib/localState";
import {
  persistLocalScans,
  prepareScansForLocalStorage,
  scanMetaForLocalStorage,
  setRemotePersistenceConfigured,
} from "@/lib/localScanPersistence";
import { persistRowForBrowser } from "@/lib/screenerPipeline";

function installFakeStorage({ maxChars = 50_000 } = {}) {
  const store = new Map();
  const session = new Map();
  const fake = {
    get length() { return store.size; },
    key(index) { return [...store.keys()][index] ?? null; },
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) {
      const text = String(value);
      const others = [...store.entries()].filter(([k]) => k !== key)
        .reduce((sum, [, v]) => sum + v.length, 0);
      if (others + text.length > maxChars) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      store.set(key, text);
    },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
  globalThis.window = globalThis;
  globalThis.localStorage = fake;
  globalThis.sessionStorage = {
    getItem(key) { return session.has(key) ? session.get(key) : null; },
    setItem(key, value) { session.set(key, String(value)); },
    removeItem(key) { session.delete(key); },
    clear() { session.clear(); },
  };
  return fake;
}

function bigRow(symbol = "BIG") {
  return persistRowForBrowser({
    symbol,
    price: 42,
    objectiveScore: 71,
    compositeScore: 71,
    totalScore: 71,
    chartBarsCount: 220,
    chartPreview: Array.from({ length: 40 }, (_, i) => ({ time: i, value: 10 + i })),
    objectiveMetricAudit: { heavy: "x".repeat(4000) },
    decisionTrace: { steps: Array.from({ length: 20 }, () => ({ note: "trace" })) },
  });
}

function nightlyScan(rowCount = 120) {
  const rows = Array.from({ length: rowCount }, (_, index) => bigRow(`S${String(index).padStart(3, "0")}`));
  return {
    id: "cron:nightly-us:2026-09-05",
    createdAt: "2026-09-05T03:57:00.000Z",
    rowsAvailable: rowCount,
    rowsReturned: rowCount,
    rows,
  };
}

describe("localScanPersistence", () => {
  beforeEach(() => {
    setRemotePersistenceConfigured(false);
    installFakeStorage({ maxChars: 200_000 });
  });

  it("con remoto activo guarda solo meta sin filas", () => {
    setRemotePersistenceConfigured(true);
    const scan = nightlyScan(8);
    expect(persistLocalScans([scan])).toBe(true);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.scans));
    expect(stored).toHaveLength(1);
    expect(stored[0].rows).toEqual([]);
    expect(stored[0].rowsStoredRemotely).toBe(true);
    expect(stored[0].rowsAvailable).toBe(8);
    expect(stored[0].id).toBe(scan.id);
  });

  it("remoto OK + mesa grande no dispara QuotaExceeded en camino feliz", () => {
    installFakeStorage({ maxChars: 4_000 });
    setRemotePersistenceConfigured(true);
    const seen = [];
    const unsubscribe = subscribeStorageWriteFailures((failure) => seen.push(failure));
    expect(persistLocalScans([nightlyScan(500)])).toBe(true);
    unsubscribe();
    expect(seen).toHaveLength(0);
    expect(lastStorageWriteFailure()).toBeNull();
  });

  it("sin remoto guarda sin avisar en camino feliz", () => {
    installFakeStorage({ maxChars: 200_000 });
    setRemotePersistenceConfigured(false);
    const seen = [];
    const unsubscribe = subscribeStorageWriteFailures((failure) => seen.push(failure));
    expect(persistLocalScans([nightlyScan(8)])).toBe(true);
    unsubscribe();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.scans))[0].rows.length).toBe(8);
    expect(seen.some((failure) => failure.failed)).toBe(false);
  });

  it("scanMetaForLocalStorage conserva contadores y vacía filas", () => {
    const meta = scanMetaForLocalStorage(nightlyScan(12));
    expect(meta.rows).toEqual([]);
    expect(meta.rowsStoredRemotely).toBe(true);
    expect(meta.rowsAvailable).toBe(12);
    expect(meta.rowsReturned).toBe(12);
  });

  it("prepareScansForLocalStorage respeta el flag remoto", () => {
    const scan = nightlyScan(3);
    setRemotePersistenceConfigured(true);
    expect(prepareScansForLocalStorage([scan])[0].rows).toEqual([]);
    setRemotePersistenceConfigured(false);
    expect(prepareScansForLocalStorage([scan])[0].rows.length).toBe(3);
  });
});

describe("StorageAlert · remoto activo", () => {
  beforeEach(() => {
    setRemotePersistenceConfigured(true);
  });

  it("oculta el aviso de scans cuando la persistencia remota está activa", () => {
    expect(shouldShowStorageAlert({
      key: STORAGE_KEYS.scans,
      quota: true,
      failed: true,
    })).toBe(false);
  });

  it("copy de scans menos alarmista", () => {
    setRemotePersistenceConfigured(false);
    const message = buildStorageAlertMessage({
      key: STORAGE_KEYS.scans,
      quota: true,
      failed: true,
    });
    expect(message.text).toContain("No cabe una copia local completa");
    expect(message.text).not.toContain("snapshot local");
  });
});
