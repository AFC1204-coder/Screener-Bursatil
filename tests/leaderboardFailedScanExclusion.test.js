// Tests del contrato de exclusión "failed nunca publica" en leaderboards.
// Cubre: RPC leaderboard_publishable_rows como punto único de filtrado
// (lib/leaderboards.js#readScanRows) y asegura que scans failed|error|cancelled
// NUNCA contribuyen filas a buildLeaderboard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, url: "https://example.supabase.co", ownerId: "owner-test" })),
  supabaseRpc: vi.fn(),
  supabaseRequest: vi.fn(),
  supabaseRequestAll: vi.fn(),
  textOrNull: (v) => (v == null ? null : String(v)),
  finiteOrNull: (v) => (Number.isFinite(v) ? v : null),
  disabledPayload: () => ({ disabled: true }),
}));

import { readScanRows, buildLeaderboard } from "@/lib/leaderboards";
import { supabaseConfig, supabaseRpc } from "@/lib/supabaseServer";

beforeEach(() => {
  vi.clearAllMocks();
  supabaseConfig.mockReturnValue({
    configured: true,
    url: "https://example.supabase.co",
    ownerId: "owner-test",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("readScanRows / leaderboard_publishable_rows", () => {
  it("escenario mixto: SOLO filas de scans complete|partial|done entran", async () => {
    // Simula que el join Postgres entregó 6 filas totales pero solo 3 son publicables.
    supabaseRpc.mockResolvedValue({
      rowsRead: 6,
      rowsPublished: 3,
      rowsExcluded: 3,
      rows: [
        { scan_id: "scan-complete", symbol: "AAA", total_score: 80, parent_status: "complete" },
        { scan_id: "scan-partial", symbol: "BBB", total_score: 70, parent_status: "partial" },
        { scan_id: "scan-done-legacy", symbol: "CCC", total_score: 60, parent_status: "done" },
      ],
    });

    const result = await readScanRows({ maxRows: 100, sinceDays: 45 });

    expect(supabaseRpc).toHaveBeenCalledWith(
      "leaderboard_publishable_rows",
      expect.objectContaining({
        p_owner_id: "owner-test",
        p_max_rows: 100,
        p_since_days: 45,
      }),
      expect.any(Object),
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rowsPublished).toBe(3);
    expect(result.rowsExcluded).toBe(3);
    expect(result.rowsRead).toBe(6);
  });

  it("escenario todo-failed: rowsExcluded=N y buildLeaderboard recibe []", async () => {
    supabaseRpc.mockResolvedValue({
      rowsRead: 5,
      rowsPublished: 0,
      rowsExcluded: 5,
      rows: [],
    });

    const result = await readScanRows({ maxRows: 100, sinceDays: 45 });
    expect(result.rows).toHaveLength(0);
    expect(result.rowsExcluded).toBe(5);
    expect(result.rowsPublished).toBe(0);

    // Confirma que NO hay filas por las que liderar → items vacío.
    const leaderboard = buildLeaderboard(result.rows, { strategy: "momentum", limit: 25 });
    expect(leaderboard.count).toBe(0);
    expect(leaderboard.items).toEqual([]);
  });

  it("Supabase no configurado devuelve { configured: false, rows: [] } y NO llama RPC", async () => {
    supabaseConfig.mockReturnValueOnce({
      configured: false,
      url: "",
      ownerId: "",
    });

    const result = await readScanRows({ maxRows: 100 });
    expect(result.configured).toBe(false);
    expect(result.rows).toEqual([]);
    expect(supabaseRpc).not.toHaveBeenCalled();
  });

  it("params max/since se aplican al payload RPC", async () => {
    supabaseRpc.mockResolvedValue({ rows: [], rowsRead: 0, rowsPublished: 0, rowsExcluded: 0 });
    await readScanRows({ maxRows: 250, sinceDays: 7 });
    expect(supabaseRpc).toHaveBeenCalledWith(
      "leaderboard_publishable_rows",
      expect.objectContaining({ p_max_rows: 250, p_since_days: 7 }),
      expect.any(Object),
    );
  });

  it("payload que falla deja que el caller (route.js) decida degradar al cache", async () => {
    // Garantiza que readScanRows deja propagar el error, sin tragarlo. La
    // /api/leaderboards/route.js decide si caer al snapshot materializado.
    supabaseRpc.mockRejectedValue(new Error("Postgrest 404 (PGREST205)"));
    await expect(readScanRows({ maxRows: 100, sinceDays: 45 })).rejects.toThrow(/PGREST205/);
  });
});
