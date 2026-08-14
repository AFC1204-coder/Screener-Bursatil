import { describe, expect, it } from "vitest";
import { pickBestRestorableScan, restorableScans, restoredSnapshotView, snapshotRowsAreFiltered } from "@/lib/snapshotRestore";
import { filterAnalyzedRows } from "@/lib/screenerPipeline";

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

  // Regresión de docs/scan-vivo-filas-incompletas-2026-08-14.md: hasta el
  // 2026-08-14, la vista previa del screener (loadCachedScreenerPreview en
  // app/page.jsx) pintaba GET /api/leaderboards, cuya proyección
  // publicItem() nunca incluye chartPreview ni weeklyStageState/
  // weeklyStageLabel — la tabla mostraba miniatura y etapa en blanco. Ahora
  // esa vista previa pasa por restoredSnapshotView + filterAnalyzedRows (la
  // MISMA ruta que ya usa la restauración de sesión), así que estos campos
  // deben sobrevivir en ambas ramas: snapshot ya filtrado (pasa tal cual) y
  // snapshot raw de servidor (se refiltra con la función real, sin stub).
  function fullResearchRow(symbol) {
    return {
      symbol,
      price: 120,
      chartBarsCount: 250,
      chartPreview: [
        { date: "2026-08-10", close: 118, sma50: 110, sma200: 95, volume: 120000 },
        { date: "2026-08-11", close: 120, sma50: 111, sma200: 96, volume: 130000 },
      ],
      weeklyStageState: "base",
      weeklyStageLabel: "Base / transicion",
      weeklyStage: { state: "base", label: "Base / transicion" },
    };
  }

  it("conserva chartPreview y etapa semanal en snapshots ya filtrados", () => {
    const filtered = scan("filtered-full", [fullResearchRow("AAA")], { rowsAreFilteredSnapshot: true });
    const restored = restoredSnapshotView(filtered, {}, {}, () => ({ rows: [] }));

    expect(restored.rows).toHaveLength(1);
    expect(restored.rows[0].chartPreview).toHaveLength(2);
    expect(restored.rows[0].weeklyStageState).toBe("base");
    expect(restored.rows[0].weeklyStageLabel).toBe("Base / transicion");
  });

  it("conserva chartPreview y etapa semanal al refiltrar snapshots raw de servidor con filterAnalyzedRows real", () => {
    const raw = scan("raw-full", [fullResearchRow("BBB")], {
      settings: { progress: { status: "done" } },
    });
    const restored = restoredSnapshotView(raw, {}, { useRegimeFilter: false, marketHealth: null }, filterAnalyzedRows);

    expect(restored.rows).toHaveLength(1);
    expect(restored.rows[0].chartPreview).toHaveLength(2);
    expect(restored.rows[0].weeklyStageState).toBe("base");
    expect(restored.rows[0].weeklyStageLabel).toBe("Base / transicion");
    expect(restored.analyzedRows[0].chartPreview).toHaveLength(2);
  });
});
