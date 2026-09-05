import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

const LEGACY_HEX = /#d3d5dc|#9ee8b1|#f2d28c|#ffaaa4|#cbd5e1|#e8e9ed|#e5e7eb|#6f7786/i;

/** Bloque FICHA-UI — menú compacto de clasificación. */
function extractDecisionMenuBlock(css) {
  const start = css.indexOf(".stockPage .stockDecisionActionMenu {");
  const end = css.indexOf(".stockPage .stockAddToList {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("FICHA-UI · stock decision action menu CSS", () => {
  const block = extractDecisionMenuBlock(COMPONENTS_CSS);

  it("bloque menú no contiene hex legados", () => {
    expect(block).not.toMatch(LEGACY_HEX);
  });

  it("summary y botones del panel usan --radius", () => {
    expect(block).toMatch(/\.stockDecisionActionMenu > summary\s*\{[^}]*border-radius:\s*var\(--radius\)/s);
    expect(block).toMatch(/\.stockDecisionActionMenuPanel button\s*\{[^}]*border-radius:\s*var\(--radius\)/s);
  });

  it("variantes de veredicto usan tokens semánticos", () => {
    expect(block).toMatch(/button\.good[^}]*--decision-vigilar/s);
    expect(block).toMatch(/button\.warn[^}]*--decision-auditar/s);
    expect(block).toMatch(/button\.bad[^}]*--risk/s);
    expect(block).toMatch(/button\.neutral[^}]*--line2/s);
  });

  it(".active usa elevación --active-bg / --active-border / --active-fg", () => {
    const active = block.match(/button\.active\s*\{[^}]*\}/s);
    expect(active).toBeTruthy();
    expect(active[0]).toMatch(/--active-bg/);
    expect(active[0]).toMatch(/--active-border/);
    expect(active[0]).toMatch(/--active-fg/);
  });

  it("disabled usa opacity ~0.40 y --ghost", () => {
    const disabled = block.match(/button:disabled\s*\{[^}]*\}/s);
    expect(disabled).toBeTruthy();
    expect(disabled[0]).toMatch(/opacity:\s*\.40/);
    expect(disabled[0]).toMatch(/--ghost/);
  });
});
