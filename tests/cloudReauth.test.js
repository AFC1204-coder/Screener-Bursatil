import { describe, expect, it, vi } from "vitest";
import { restartStatsEdgeSession } from "@/lib/cloudReauth";

describe("restartStatsEdgeSession", () => {
  it("borra la sesión y recarga la página", async () => {
    const reload = vi.fn();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { reload } });

    await restartStatsEdgeSession();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
