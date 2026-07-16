import { beforeEach, describe, expect, it, vi } from "vitest";

const leaderboard = {
  key: "global-momentum",
  strategy: "momentum",
  strategyLabel: "Momentum",
  count: 0,
  items: [],
};

vi.mock("@/lib/leaderboards", () => ({
  DEFAULT_LEADERBOARD_SPECS: [
    { key: "global-momentum", title: "Top Momentum Global", strategy: "momentum", scopeType: "global", scopeValue: "" },
  ],
  buildGroupedLeaderboards: vi.fn(),
  buildLeaderboard: vi.fn(() => leaderboard),
  readMaterializedLeaderboard: vi.fn(),
  readScanRows: vi.fn(),
  writeMaterializedLeaderboards: vi.fn(),
}));

vi.mock("@/lib/screenerFilters", () => ({ SCREENER_FILTER_QUERY_KEYS: [] }));
vi.mock("@/lib/supabaseServer", () => ({ requirePersistenceAuth: vi.fn() }));

import { buildLeaderboard, readMaterializedLeaderboard, readScanRows } from "@/lib/leaderboards";
import { GET } from "@/app/api/leaderboards/route";

beforeEach(() => {
  vi.clearAllMocks();
  readScanRows.mockResolvedValue({ configured: true, rows: [], rowsRead: 0, rowsPublished: 0, rowsExcluded: 0 });
  readMaterializedLeaderboard.mockResolvedValue(null);
});

describe("GET /api/leaderboards · curatedDiscovery", () => {
  it("pasa curatedDiscovery=true a buildLeaderboard y no usa el snapshot normal", async () => {
    const response = await GET(new Request("http://localhost/api/leaderboards?strategy=momentum&curatedDiscovery=1"));
    expect(response.status).toBe(200);
    expect(readMaterializedLeaderboard).not.toHaveBeenCalled();
    expect(buildLeaderboard).toHaveBeenCalledWith([], expect.objectContaining({ strategy: "momentum", curatedDiscovery: true }));
  });

  it("sin parámetro conserva la ruta normal de leaderboards", async () => {
    const response = await GET(new Request("http://localhost/api/leaderboards?strategy=momentum&cache=0"));
    expect(response.status).toBe(200);
    expect(buildLeaderboard).toHaveBeenCalledWith([], expect.objectContaining({ strategy: "momentum", curatedDiscovery: false }));
    expect(readScanRows).toHaveBeenCalledTimes(1);
  });

  it("no degrada a un snapshot normal si la variante curada no puede leer filas", async () => {
    readScanRows.mockRejectedValueOnce(new Error("leaderboard timeout"));

    const response = await GET(new Request("http://localhost/api/leaderboards?strategy=momentum&curatedDiscovery=true"));

    expect(response.status).toBe(200);
    expect(readMaterializedLeaderboard).not.toHaveBeenCalled();
    expect(buildLeaderboard).toHaveBeenCalledWith([], expect.objectContaining({ curatedDiscovery: true }));
  });
});
