import { describe, expect, it } from "vitest";
import { BRIEF_CACHE_VERSION } from "@/app/api/company-brief/route";

describe("company-brief cache version", () => {
  it("BRIEF_CACHE_VERSION es 6 (invalida entradas v5 con la serie RS del motor heredado)", () => {
    expect(BRIEF_CACHE_VERSION).toBe(6);
  });

  it("cache v5 no cuenta como hit fresco", () => {
    const brief = { symbol: "TEST" };
    const cacheVersion = 5;
    const ageDays = 0;
    const maxAgeDays = 1;
    const fresh = Boolean(
      brief && cacheVersion === BRIEF_CACHE_VERSION && ageDays !== null && ageDays <= maxAgeDays,
    );
    expect(fresh).toBe(false);
  });
});
