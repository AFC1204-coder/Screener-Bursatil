import { describe, expect, it } from "vitest";
import { createTtlCache } from "@/lib/serverCache";

describe("server cache", () => {
  it("permite inspeccionar una entrada expirada para degradar con stale-if-error", () => {
    const cache = createTtlCache({ name: "test", maxEntries: 2 });
    cache.set("latest", { ok: true }, -1);

    expect(cache.peek("latest")).toBeUndefined();
    const stale = cache.peek("latest", { allowExpired: true });
    expect(stale.value).toEqual({ ok: true });
    expect(stale.expired).toBe(true);
    expect(stale.staleForMs).toBeGreaterThanOrEqual(0);
  });
});
