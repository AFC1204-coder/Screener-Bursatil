// Contrato de límites para el refresco de leaderboards desde un scan materializado.
// Todo Supabase y la escritura de snapshots están sustituidos por mocks.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", async () => {
  const actual = await vi.importActual("@/lib/supabaseServer");
  return {
    ...actual,
    supabaseConfig: vi.fn(() => ({ configured: true, ownerId: "owner-test" })),
    supabaseRpc: vi.fn(),
    supabaseRequest: vi.fn(),
  };
});

vi.mock("@/lib/leaderboards", async () => {
  const actual = await vi.importActual("@/lib/leaderboards");
  return {
    ...actual,
    writeMaterializedLeaderboards: vi.fn(),
  };
});

import { refreshDefaultLeaderboards } from "@/lib/materializedScanner";
import { supabaseRpc } from "@/lib/supabaseServer";
import { writeMaterializedLeaderboards } from "@/lib/leaderboards";

beforeEach(() => {
  vi.clearAllMocks();
  supabaseRpc.mockResolvedValue({ rows: [], rowsRead: 0, rowsPublished: 0, rowsExcluded: 0 });
  writeMaterializedLeaderboards.mockResolvedValue({ saved: 0 });
});

describe("refreshDefaultLeaderboards · límites del scan materializado", () => {
  it("pasa sinceDays=21 y maxRows=2000 a leaderboard_publishable_rows", async () => {
    await refreshDefaultLeaderboards({ sinceDays: 21, maxRows: 2000 });

    expect(supabaseRpc).toHaveBeenCalledWith(
      "leaderboard_publishable_rows",
      expect.objectContaining({ p_since_days: 21, p_max_rows: 2000 }),
      expect.any(Object),
    );
  });
});
