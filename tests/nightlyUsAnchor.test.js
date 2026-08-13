// La lectura de listas se ancla a UN escaneo: el último nocturno
// estadounidense. Y cuando no lo hay, dice que no lo hay — nunca sirve otro.
//
// Motivo: la lectura por ventana temporal (las N filas más recientes de
// cualquier origen) mezclaba mercados y fechas sin avisar. El 13 de agosto de
// 2026 metía cuatro valores de Hong Kong con cierre del día 10 entre filas
// estadounidenses con cierre del 12
// (docs/migracion-listas-2026-08-13.md §13.3).
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
let scansResponse = [];
let rowsResponse = [];
let scansError = null;

vi.mock("@/lib/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabaseConfig: () => ({ configured: true, ownerId: "personal", url: "https://x.test", missing: [] }),
    supabaseRequest: async (path, options) => {
      calls.push({ path, query: options?.query || "" });
      if (path === "scans") {
        if (scansError) throw scansError;
        return scansResponse;
      }
      if (path === "scan_results") return rowsResponse;
      return [];
    },
    supabaseRequestAll: async (path, options) => {
      calls.push({ path, query: options?.query || "" });
      if (path === "scan_results") return rowsResponse;
      return [];
    },
  };
});

const { readNightlyUsScan, readNightlyUsScanRows } = await import("@/lib/leaderboards");

const scan = (extra = {}) => ({
  id: "scan-1",
  local_id: "materialized:US:2026-08-13:o0:l5608",
  created_at: "2026-08-13T05:03:38.193Z",
  settings: { progress: { status: "partial" } },
  ...extra,
});

beforeEach(() => {
  calls.length = 0;
  scansResponse = [];
  rowsResponse = [];
  scansError = null;
});

describe("selección del escaneo", () => {
  it("busca por el prefijo materialized:US: y coge el más reciente", async () => {
    scansResponse = [scan()];
    await readNightlyUsScan();
    const query = calls.find((c) => c.path === "scans")?.query || "";
    expect(query).toContain("local_id=like.");
    expect(decodeURIComponent(query)).toContain("materialized:US:*");
    expect(query).toContain("order=created_at.desc");
    expect(query).toContain("limit=1");
  });

  it("lee las filas de ESE escaneo, no de una ventana temporal", async () => {
    scansResponse = [scan()];
    rowsResponse = [{ symbol: "VCTR", country: "US" }];
    const result = await readNightlyUsScanRows();
    const rowsQuery = calls.find((c) => c.path === "scan_results")?.query || "";
    expect(rowsQuery).toContain("scan_id=eq.scan-1");
    expect(rowsQuery).not.toContain("created_at=gte");
    expect(result.rows).toHaveLength(1);
    expect(result.nightly).toMatchObject({ found: true, empty: false, localId: "materialized:US:2026-08-13:o0:l5608", rows: 1 });
  });
});

describe("ausencia explícita, nunca otro mercado en silencio", () => {
  it("sin ningún escaneo nocturno devuelve cero filas y el motivo", async () => {
    scansResponse = [];
    const result = await readNightlyUsScanRows();
    expect(result.configured).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.nightly).toMatchObject({ found: false, reason: "no-nightly-scan" });
    // Y no ha ido a buscar filas por su cuenta a ninguna otra parte.
    expect(calls.filter((c) => c.path === "scan_results")).toHaveLength(0);
  });

  it("un nocturno que no terminó bien no publica, y se dice cuál era", async () => {
    scansResponse = [scan({ settings: { progress: { status: "failed" } } })];
    const result = await readNightlyUsScanRows();
    expect(result.rows).toEqual([]);
    expect(result.nightly).toMatchObject({ found: false, reason: "nightly-not-publishable" });
    expect(result.nightly.rejectedScan).toMatchObject({ id: "scan-1", status: "failed" });
    expect(calls.filter((c) => c.path === "scan_results")).toHaveLength(0);
  });

  it("no busca el nocturno anterior cuando el último falla", async () => {
    // Servir el de anteayer como si fuera el de hoy es la misma mentira que
    // servir otro mercado: una fecha que la pantalla no declara.
    scansResponse = [scan({ settings: { progress: { status: "cancelled" } } })];
    await readNightlyUsScanRows();
    const scanQueries = calls.filter((c) => c.path === "scans");
    expect(scanQueries).toHaveLength(1);
    expect(scanQueries[0].query).toContain("limit=1");
  });

  it("un nocturno sin filas se distingue de no tener nocturno", async () => {
    scansResponse = [scan()];
    rowsResponse = [];
    const result = await readNightlyUsScanRows();
    expect(result.nightly).toMatchObject({ found: true, empty: true, rows: 0 });
  });

  it("acepta los tres estados publicables y solo esos", async () => {
    for (const status of ["complete", "partial", "done"]) {
      scansResponse = [scan({ settings: { progress: { status } } })];
      expect((await readNightlyUsScan()).scan).not.toBeNull();
    }
    for (const status of ["failed", "error", "cancelled", "finalizing", ""]) {
      scansResponse = [scan({ settings: { progress: { status } } })];
      expect((await readNightlyUsScan()).scan).toBeNull();
    }
  });
});
