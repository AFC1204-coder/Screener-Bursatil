import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

const BTN_GROUPED_WITH_COMPACT_SEG = /\.btn[^,{]*,\s*[^.{]*\.compactSeg button/g;

describe("UX-BTN-1 · segmented keycaps CSS", () => {
  it("no agrupa .compactSeg button con .btn* en reglas de min-height/borde", () => {
    expect(COMPONENTS_CSS).not.toMatch(BTN_GROUPED_WITH_COMPACT_SEG);
  });

  it("define la familia keycap con tokens v2 en el bloque base", () => {
    expect(COMPONENTS_CSS).toMatch(/\.compactSeg,\s*\n\.chartSegmented\s*\{[^}]*--surface-inset/s);
    expect(COMPONENTS_CSS).toMatch(/\.compactSeg button\.active[^}]*--surface/s);
    expect(COMPONENTS_CSS).toMatch(/\.compactSeg button\.active[^}]*--line2/s);
    expect(COMPONENTS_CSS).toMatch(/\.compactSeg button\.active[^}]*0 1px 2px rgba\(0,\s*0,\s*0,\s*\.35\)/s);
    expect(COMPONENTS_CSS).toMatch(/\.compactSeg button,\s*\n\.chartSegmented button[^}]*--font-data/s);
    expect(COMPONENTS_CSS).toMatch(/\.compactSeg button,\s*\n\.chartSegmented button[^}]*--radius-s/s);
  });

  it("no usa hex claros ni senal-dim en teclas activas segmented", () => {
    const activeBlocks = COMPONENTS_CSS.match(
      /\.(?:compactSeg|chartSegmented) button(?:\.active|\[aria-pressed="true"\])[^}]*\}/gs,
    ) ?? [];
    expect(activeBlocks.length).toBeGreaterThan(0);
    for (const block of activeBlocks) {
      expect(block).not.toMatch(/#f4f4f5|#fff\b|#ffffff|--senal-dim/i);
    }
  });
});
