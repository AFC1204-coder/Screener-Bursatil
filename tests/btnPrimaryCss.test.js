import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

/** Bloque §8 Buttons (UX-BTN-2) — desde el comentario hasta §9 Table. */
function extractBtnSection8(css) {
  const start = css.indexOf("/* ── 8. Buttons (UX-BTN-2");
  const end = css.indexOf("/* ── 9. Table ──", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("UX-BTN-2 · primary / ghost / pager CSS", () => {
  const section8 = extractBtnSection8(COMPONENTS_CSS);

  it(".btnPrimary en §8 no usa gradient ni translateY", () => {
    const primaryBlocks = section8.match(/\.btnPrimary[^{]*\{[^}]*\}/gs) ?? [];
    expect(primaryBlocks.length).toBeGreaterThan(0);
    for (const block of primaryBlocks) {
      expect(block).not.toMatch(/linear-gradient/i);
      expect(block).not.toMatch(/translateY/i);
      expect(block).not.toMatch(/inset\s+0\s+1px/i);
    }
  });

  it(".btnPrimary en §8 usa tokens CTA", () => {
    expect(section8).toMatch(/\.btnPrimary\s*\{[^}]*--cta-bg/s);
    expect(section8).toMatch(/\.btnPrimary\s*\{[^}]*--cta-fg/s);
    expect(section8).toMatch(/\.btnPrimary\s*\{[^}]*--cta-border/s);
  });

  it("ghost/base usan --radius y alturas 36/32", () => {
    expect(section8).toMatch(/\.btn,\s*\n\.btnGhost\s*\{[^}]*min-height:\s*36px/s);
    expect(section8).toMatch(/\.btnSmall\s*\{[^}]*min-height:\s*32px/s);
    expect(section8).toMatch(/border-radius:\s*var\(--radius\)/);
  });

  it("disabled usa --ghost y opacity ~0.40", () => {
    expect(section8).toMatch(/:disabled[^}]*--ghost/s);
    expect(section8).toMatch(/:disabled[^}]*opacity:\s*\.40/s);
    expect(section8).not.toMatch(/#626b78/);
  });

  it(".resultPagerStep es caja 32×32 centrada", () => {
    expect(section8).toMatch(/\.resultPagerStep\s*\{[^}]*width:\s*32px/s);
    expect(section8).toMatch(/\.resultPagerStep\s*\{[^}]*height:\s*32px/s);
    expect(section8).toMatch(/\.resultPagerStep\s*\{[^}]*inline-flex/s);
    expect(section8).toMatch(/\.resultPagerStep\s*\{[^}]*justify-content:\s*center/s);
  });

  it("components.css completo no contiene gradient legado en .btnPrimary", () => {
    const allPrimary = COMPONENTS_CSS.match(/\.btnPrimary[^{]*\{[^}]*\}/gs) ?? [];
    for (const block of allPrimary) {
      expect(block).not.toMatch(/linear-gradient\s*\(\s*180deg,\s*#f6f8fc/i);
      expect(block).not.toMatch(/translateY\s*\(\s*-0\.5px/i);
    }
  });
});
