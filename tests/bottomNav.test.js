import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/app/BottomNav";

describe("BottomNav NAV_ITEMS", () => {
  it("no incluye enlace IPO en header/bottom nav (/ipo-radar sigue existiendo fuera del nav)", () => {
    expect(NAV_ITEMS.some((item) => item.href === "/ipo-radar")).toBe(false);
    expect(NAV_ITEMS.some((item) => /IPO/i.test(item.label))).toBe(false);
  });

  it("incluye Metodología en nav principal", () => {
    const item = NAV_ITEMS.find((entry) => entry.href === "/metodologia");
    expect(item).toBeTruthy();
    expect(item.label).toBe("Metodología");
  });
});
