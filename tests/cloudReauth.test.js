import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_SESSION_HINT_KEY } from "@/lib/authBoot";
import { restartStatsEdgeSession } from "@/lib/cloudReauth";

function installFakeStorage() {
  const store = new Map();
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}

describe("restartStatsEdgeSession", () => {
  beforeEach(() => {
    installFakeStorage();
  });

  afterEach(() => {
    delete globalThis.localStorage;
    vi.unstubAllGlobals();
  });

  it("borra la sesión, limpia la señal local y recarga la página", async () => {
    const reload = vi.fn();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    globalThis.window.location = { reload };
    localStorage.setItem(AUTH_SESSION_HINT_KEY, "1");

    await restartStatsEdgeSession();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
    expect(localStorage.getItem(AUTH_SESSION_HINT_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
