import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

const LEGACY_HEX = /#d3d5dc|#9ee8b1|#f2d28c|#ffaaa4|#cbd5e1|#e8e9ed|#e5e7eb|#6f7786/i;

/** Bloque UX-BTN-4 — resolve rail + input nota, hasta historial. */
function extractDecisionRailBlock(css) {
  const start = css.indexOf(".stockPage .stockDecisionResolveRail {");
  const end = css.indexOf(".stockPage .stockDecisionHistory {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("UX-BTN-4 · stock decision resolve rail CSS", () => {
  const block = extractDecisionRailBlock(COMPONENTS_CSS);

  it("bloque rail no contiene hex legados", () => {
    expect(block).not.toMatch(LEGACY_HEX);
  });

  it("botones e input usan --radius", () => {
    const buttonBase = block.match(/\.stockDecisionResolveRail button\s*\{[^}]*\}/s);
    const noteInput = block.match(/\.stockDecisionValidationNote input\s*\{[^}]*\}/s);
    expect(buttonBase).toBeTruthy();
    expect(noteInput).toBeTruthy();
    expect(buttonBase[0]).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(noteInput[0]).toMatch(/border-radius:\s*var\(--radius\)/);
  });

  it("reposo base usa superficie pizarra sin hex", () => {
    const buttonBase = block.match(/\.stockDecisionResolveRail button\s*\{[^}]*\}/s)[0];
    expect(buttonBase).toMatch(/border:\s*1px solid var\(--stock-line\)/);
    expect(buttonBase).toMatch(/background:\s*var\(--surface\)/);
    expect(buttonBase).toMatch(/color:\s*var\(--soft\)/);
  });

  it("variantes de veredicto usan tokens semánticos", () => {
    expect(block).toMatch(/button\.good[^}]*--decision-vigilar/s);
    expect(block).toMatch(/button\.warn[^}]*--decision-auditar/s);
    expect(block).toMatch(/button\.bad[^}]*--risk/s);
    expect(block).toMatch(/button\.neutral[^}]*--line2/s);
    expect(block).toMatch(/button\.neutral[^}]*--soft/s);
  });

  it(".active usa elevación --active-bg / --active-border / --active-fg", () => {
    const active = block.match(/button\.active\s*\{[^}]*\}/s);
    expect(active).toBeTruthy();
    expect(active[0]).toMatch(/--active-bg/);
    expect(active[0]).toMatch(/--active-border/);
    expect(active[0]).toMatch(/--active-fg/);
    expect(active[0]).not.toMatch(/--cta-bg/);
    expect(active[0]).not.toMatch(/#e8e9ed/i);
    expect(active[0]).not.toMatch(/color:\s*var\(--bg\)/);
  });

  it("input nota usa --text y placeholder --ghost", () => {
    expect(block).toMatch(/\.stockDecisionValidationNote input\s*\{[^}]*color:\s*var\(--text\)/s);
    expect(block).toMatch(/input::placeholder\s*\{[^}]*--ghost/s);
  });

  it("disabled usa opacity ~0.40 y --ghost", () => {
    const disabled = block.match(/button:disabled\s*\{[^}]*\}/s);
    expect(disabled).toBeTruthy();
    expect(disabled[0]).toMatch(/opacity:\s*\.40/);
    expect(disabled[0]).toMatch(/--ghost/);
  });
});
