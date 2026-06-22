import { describe, expect, it } from "vitest";
import { buildSnapshotFreshnessNotice, staleDurationLabel } from "@/lib/snapshotFreshness";

describe("snapshot freshness", () => {
  it("no muestra aviso para snapshots frescos y completos", () => {
    expect(buildSnapshotFreshnessNotice({ stale: false }, { decisionProjectionPartialRows: 0 })).toBeNull();
  });

  it("explica cuando se sirve una copia cacheada por caida de Supabase", () => {
    const notice = buildSnapshotFreshnessNotice({
      stale: true,
      staleForMs: 125000,
      staleReason: "Timeout consultando Supabase.",
    });

    expect(notice.label).toBe("Snapshot cacheado");
    expect(notice.tone).toBe("warn");
    expect(notice.detail).toContain("última copia cacheada");
    expect(notice.detail).toContain("2 min");
    expect(notice.detail).toContain("Timeout consultando Supabase.");
  });

  it("advierte cuando la proyeccion de decision queda parcial", () => {
    const notice = buildSnapshotFreshnessNotice({}, { decisionProjectionPartialRows: 3 });

    expect(notice.label).toBe("Snapshot parcial");
    expect(notice.tone).toBe("info");
    expect(notice.detail).toContain("3 filas");
  });

  it("formatea duraciones stale compactas", () => {
    expect(staleDurationLabel(30000)).toBe("menos de 1 min");
    expect(staleDurationLabel(20 * 60000)).toBe("20 min");
    expect(staleDurationLabel(2 * 60 * 60000)).toBe("2 h");
  });
});
