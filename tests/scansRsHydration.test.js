import { describe, expect, it } from "vitest";
import { scanRsHydrationMode } from "@/lib/scansRsHydration";

describe("scanRsHydrationMode · PERF-NAC", () => {
  it("compacto de mesa usa hidratación core (sin país/tema)", () => {
    expect(scanRsHydrationMode()).toBe("core");
    expect(scanRsHydrationMode({ full: false, decisionProjection: false })).toBe("core");
  });

  it("full y decision projection piden extended", () => {
    expect(scanRsHydrationMode({ full: true })).toBe("extended");
    expect(scanRsHydrationMode({ decisionProjection: true })).toBe("extended");
  });

  it("hydrateRs query param fuerza modo", () => {
    expect(scanRsHydrationMode({ hydrateRsParam: "1" })).toBe("extended");
    expect(scanRsHydrationMode({ hydrateRsParam: "0" })).toBe("core");
  });
});
