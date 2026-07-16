// Contrato del cron dedicado: conserva su ventana y límite propios.
// No hay red ni escrituras: todos los accesos están sustituidos por mocks.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internalAuth", () => ({
  isInternalRequest: vi.fn(() => true),
}));
vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: vi.fn(() => ({ configured: true, ownerId: "owner-test" })),
  supabaseRequest: vi.fn(),
}));
vi.mock("@/lib/materializedScanner", () => ({
  refreshDefaultLeaderboards: vi.fn(),
}));

import { supabaseRequest } from "@/lib/supabaseServer";
import { refreshDefaultLeaderboards } from "@/lib/materializedScanner";
import { GET } from "@/app/api/cron/leaderboards-refresh/route";

beforeEach(() => {
  vi.clearAllMocks();
  supabaseRequest.mockImplementation(async (table, options = {}) => {
    if (table === "provider_runs" && options.method === "POST") return [{ id: "run-test" }];
    return [];
  });
  refreshDefaultLeaderboards.mockResolvedValue({ saved: 0 });
});

describe("GET /api/cron/leaderboards-refresh · contrato de límites", () => {
  it("conserva sinceDays=21 y maxRows=2000", async () => {
    const response = await GET(new Request("http://localhost/api/cron/leaderboards-refresh"));

    expect(response.status).toBe(200);
    expect(refreshDefaultLeaderboards).toHaveBeenCalledWith({ sinceDays: 21, maxRows: 2000 });
    await expect(response.json()).resolves.toMatchObject({ sinceDays: 21, maxRows: 2000 });
  });
});
