import { describe, expect, it } from "vitest";
import { shouldSkipCloudSnapshotRestore } from "@/lib/screenerRemountGuards";
import { SCREENER_SESSION_VERSION } from "@/lib/screenerConfig";

const freshSession = {
  version: SCREENER_SESSION_VERSION,
  scanContext: { scannedAt: "2026-09-12T04:00:00.000Z" },
};

const localScan = {
  id: "scan-1",
  rows: [{ symbol: "AAPL" }],
  rowsAvailable: 3309,
  rowsSampled: false,
};

describe("shouldSkipCloudSnapshotRestore", () => {
  it("salta cloud con sesión vigente y copia local completa", () => {
    expect(shouldSkipCloudSnapshotRestore({
      localScan,
      session: freshSession,
      now: new Date("2026-09-12T12:00:00.000Z"),
    })).toBe(true);
  });

  it("no salta sin sesión (arranque frío)", () => {
    expect(shouldSkipCloudSnapshotRestore({
      localScan,
      session: null,
    })).toBe(false);
  });

  it("no salta sin copia local", () => {
    expect(shouldSkipCloudSnapshotRestore({
      localScan: null,
      session: freshSession,
    })).toBe(false);
  });

  it("no salta con sesión caducada", () => {
    expect(shouldSkipCloudSnapshotRestore({
      localScan,
      session: {
        version: SCREENER_SESSION_VERSION,
        scanContext: { scannedAt: "2026-09-10T04:00:00.000Z" },
      },
      now: new Date("2026-09-12T12:00:00.000Z"),
    })).toBe(false);
  });

  it("no salta con copia local muestreada (P2 sigue pidiendo nube)", () => {
    expect(shouldSkipCloudSnapshotRestore({
      localScan: {
        ...localScan,
        rowsSampled: true,
        rows: [{ symbol: "AAPL" }],
        rowsAvailable: 3309,
      },
      session: freshSession,
      now: new Date("2026-09-12T12:00:00.000Z"),
    })).toBe(false);
  });
});
