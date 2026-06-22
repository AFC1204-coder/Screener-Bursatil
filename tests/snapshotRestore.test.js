import { describe, expect, it } from "vitest";
import { pickBestRestorableScan, restorableScans, restoredSnapshotView, snapshotRowsAreFiltered } from "@/lib/snapshotRestore";

function scan(id, rows, patch = {}) {
  return {
    id,
    rows,
    createdAt: "2026-06-01T10:00:00.000Z",
    ...patch,
  };
}

describe("snapshot restore", () => {
  it("ignora snapshots sin filas restaurables", () => {
    expect(pickBestRestorableScan([
      scan("empty", []),
      null,
      scan("missing", null),
    ])).toBeNull();
  });

  it("prefiere scans terminales frente a scans en progreso aunque sean algo mas antiguos", () => {
    const picked = pickBestRestorableScan([
      scan("running", [{ symbol: "RUN" }], {
        updatedAt: "2026-06-03T10:00:00.000Z",
        settings: { progress: { status: "running" } },
      }),
      scan("done", [{ symbol: "DONE" }], {
        updatedAt: "2026-06-02T10:00:00.000Z",
        settings: { progress: { status: "done" } },
      }),
    ]);

    expect(picked.id).toBe("done");
  });

  it("acepta snapshots manuales sin estado de progreso y los ordena por fecha", () => {
    const ordered = restorableScans([
      scan("older", [{ symbol: "OLD" }], { createdAt: "2026-06-01T10:00:00.000Z" }),
      scan("newer", [{ symbol: "NEW" }], { createdAt: "2026-06-04T10:00:00.000Z" }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("distingue snapshots filtrados de scans raw de servidor", () => {
    expect(snapshotRowsAreFiltered(scan("manual", [{ symbol: "M" }]))).toBe(true);
    expect(snapshotRowsAreFiltered(scan("server-old", [{ symbol: "S" }], {
      settings: { progress: { status: "done" } },
    }))).toBe(false);
    expect(snapshotRowsAreFiltered(scan("server-explicit", [{ symbol: "S" }], {
      rowsAreFilteredSnapshot: true,
      settings: { progress: { status: "done" } },
    }))).toBe(true);
    expect(snapshotRowsAreFiltered(scan("manual-explicit-raw", [{ symbol: "M" }], {
      rowsAreFilteredSnapshot: false,
    }))).toBe(false);
  });

  it("refiltra scans raw al restaurar y conserva filas analizadas", () => {
    const raw = scan("raw", [{ symbol: "KEEP" }, { symbol: "DROP" }], {
      settings: { progress: { status: "done" } },
    });
    const restored = restoredSnapshotView(raw, { setupMode: "leader" }, { source: "test" }, (rows, settings, context) => ({
      rows: rows.filter((row) => row.symbol === "KEEP"),
      diagnostics: { settings, context, finalCount: 1 },
      filterMs: 12,
    }));

    expect(restored.rows.map((row) => row.symbol)).toEqual(["KEEP"]);
    expect(restored.analyzedRows.map((row) => row.symbol)).toEqual(["KEEP", "DROP"]);
    expect(restored.diagnostics.finalCount).toBe(1);
    expect(restored.filterMs).toBe(12);
    expect(restored.rowsAreFilteredSnapshot).toBe(false);
  });

  it("no refiltra snapshots que ya son resultados filtrados", () => {
    const filtered = scan("filtered", [{ symbol: "VISIBLE" }], { rowsAreFilteredSnapshot: true });
    const restored = restoredSnapshotView(filtered, {}, {}, () => ({ rows: [] }));

    expect(restored.rows.map((row) => row.symbol)).toEqual(["VISIBLE"]);
    expect(restored.analyzedRows.map((row) => row.symbol)).toEqual(["VISIBLE"]);
    expect(restored.rowsAreFilteredSnapshot).toBe(true);
  });
});
