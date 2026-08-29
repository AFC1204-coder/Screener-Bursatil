import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/app/BottomNav";

describe("BottomNav NAV_ITEMS", () => {
  it("incluye enlace IPO a /ipo-radar", () => {
    const ipo = NAV_ITEMS.find((item) => item.href === "/ipo-radar");
    expect(ipo).toBeTruthy();
    expect(ipo.label).toMatch(/IPO/i);
  });
});
