import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

/** Bloque UX-BTN-3 — desde `.universalChartNavButton` hasta `.universalChart.drawing`. */
function extractChartNavButtonBlock(css) {
  const start = css.indexOf(".universalChartNavButton {");
  const end = css.indexOf(".universalChart.drawing .universalChartCanvas", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("UX-BTN-3 · chart floating nav CSS", () => {
  const block = extractChartNavButtonBlock(COMPONENTS_CSS);

  it("reposo no usa --senal-dim ni --accent", () => {
    const baseMatch = block.match(/\.universalChartNavButton\s*\{[^}]*\}/s);
    expect(baseMatch).toBeTruthy();
    const base = baseMatch[0];
    expect(base).not.toMatch(/--senal-dim/);
    expect(base).not.toMatch(/--accent/);
    expect(base).toMatch(/--line2/);
    expect(base).toMatch(/--soft/);
  });

  it("bloque nav no contiene hex legados (#626b78, #eff6ff, #f8d999)", () => {
    expect(block).not.toMatch(/#626b78/i);
    expect(block).not.toMatch(/#eff6ff/i);
    expect(block).not.toMatch(/#f8d999/i);
  });

  it("activo conserva tokens --active-bg / --active-border / --active-fg", () => {
    expect(block).toMatch(/\.universalChartNavButton\.active[^}]*--active-bg/s);
    expect(block).toMatch(/\.universalChartNavButton\.active[^}]*--active-border/s);
    expect(block).toMatch(/\.universalChartNavButton\.active[^}]*--active-fg/s);
    expect(block).toMatch(/\[aria-pressed="true"\][^}]*--active-bg/s);
  });

  it("disabled usa --ghost y opacity ~0.40", () => {
    expect(block).toMatch(/:disabled[^}]*--ghost/s);
    expect(block).toMatch(/:disabled[^}]*opacity:\s*\.40/s);
  });

  it(".icon es 32×32 con --radius-s y place-items center", () => {
    expect(block).toMatch(/\.universalChartNavButton\.icon\s*\{[^}]*width:\s*32px/s);
    expect(block).toMatch(/\.universalChartNavButton\.icon\s*\{[^}]*height:\s*32px/s);
    expect(block).toMatch(/\.universalChartNavButton\.icon\s*\{[^}]*border-radius:\s*var\(--radius-s\)/s);
    expect(block).toMatch(/\.universalChartNavButton\.icon\s*\{[^}]*place-items:\s*center/s);
  });

  it("hover habilitado usa --line3 y --text sin re-pintar ámbar", () => {
    expect(block).toMatch(/:not\(:disabled\):hover[^}]*--line3/s);
    expect(block).toMatch(/:not\(:disabled\):hover[^}]*--text/s);
    const hoverMatch = block.match(/:not\(:disabled\):hover\s*\{[^}]*\}/s);
    expect(hoverMatch).toBeTruthy();
    expect(hoverMatch[0]).not.toMatch(/--senal-dim/);
    expect(hoverMatch[0]).not.toMatch(/--accent/);
  });
});
