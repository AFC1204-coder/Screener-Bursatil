import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  STORAGE_ALERT_DISMISS_PREFIX,
  buildStorageAlertMessage,
  dismissStorageAlert,
  isStorageAlertDismissed,
  storageAlertDismissKey,
} from "@/app/components/StorageAlert";
import { STORAGE_KEYS } from "@/lib/localState";

function fakeSessionStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    clear() { store.clear(); },
  };
}

describe("StorageAlert helpers", () => {
  it("genera clave de dismiss estable por key, cuota y gravedad", () => {
    const failure = {
      key: STORAGE_KEYS.scans,
      quota: true,
      degraded: false,
      failed: true,
    };
    expect(storageAlertDismissKey(failure)).toBe(
      `${STORAGE_ALERT_DISMISS_PREFIX}:${STORAGE_KEYS.scans}:1:0:1`,
    );
  });

  it("persiste dismiss en sessionStorage por clave de fallo", () => {
    const storage = fakeSessionStorage();
    const failure = {
      key: STORAGE_KEYS.scans,
      quota: true,
      degraded: false,
      failed: true,
    };

    expect(isStorageAlertDismissed(failure, storage)).toBe(false);
    dismissStorageAlert(failure, storage);
    expect(isStorageAlertDismissed(failure, storage)).toBe(true);
  });

  it("no confunde dismiss de otro tipo de fallo", () => {
    const storage = fakeSessionStorage();
    const scansFailure = {
      key: STORAGE_KEYS.scans,
      quota: true,
      degraded: false,
      failed: true,
    };
    const reviewFailure = {
      key: STORAGE_KEYS.review,
      quota: true,
      degraded: false,
      failed: true,
    };

    dismissStorageAlert(scansFailure, storage);
    expect(isStorageAlertDismissed(reviewFailure, storage)).toBe(false);
  });

  it("copy corto fusionado para cuota en scans", () => {
    const message = buildStorageAlertMessage({
      key: STORAGE_KEYS.scans,
      quota: true,
      degraded: false,
      failed: true,
    });

    expect(message.text).toContain("No cabe una copia local completa");
    expect(message.text).toContain("próxima visita");
    expect(message.text.split(".").length).toBeLessThanOrEqual(3);
    expect(message.showFreeSpace).toBe(true);
    expect(message.reduced).toBe(false);
  });

  it("muestra liberar espacio solo con cuota o fallo de scans", () => {
    expect(buildStorageAlertMessage({
      key: STORAGE_KEYS.review,
      quota: true,
      failed: true,
    }).showFreeSpace).toBe(true);

    expect(buildStorageAlertMessage({
      key: STORAGE_KEYS.scans,
      quota: false,
      failed: true,
    }).showFreeSpace).toBe(true);

    expect(buildStorageAlertMessage({
      key: STORAGE_KEYS.favorites,
      quota: false,
      failed: true,
    }).showFreeSpace).toBe(false);
  });

  it("usa clase compact en el componente", () => {
    const source = readFileSync(resolve("app/components/StorageAlert.jsx"), "utf8");
    expect(source).toContain("snapshotFreshnessNotice compact");
    expect(source).toContain("Liberar espacio");
    expect(source).toContain("freeUpLocalScans");
  });
});
