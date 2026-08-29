import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");

/** Bloque UX-BTN-5 — hunt card rail buttons hasta huntCardModeStrip. */
function extractHuntRailBlock(css) {
  const start = css.indexOf(".huntCardRail button {");
  const end = css.indexOf(".huntCardModeStrip {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

/** Bloque filtros terminal — resultFilterSelect activo + viewLayerFilters summary. */
function extractResultFilterBlock(css) {
  const start = css.indexOf(".screenerTerminalPage .resultFilterSelect {");
  const end = css.indexOf(".screenerTerminalPage .viewLayerFilterGrid {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("UX-BTN-5 · hunt rail + filtro CSS", () => {
  const huntBlock = extractHuntRailBlock(SCREENER_CSS);
  const filterBlock = extractResultFilterBlock(SCREENER_CSS);

  it("huntCardRail button base usa --radius (no 8px)", () => {
    const base = huntBlock.match(/\.huntCardRail button\s*\{[^}]*\}/s);
    expect(base).toBeTruthy();
    expect(base[0]).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(base[0]).not.toMatch(/border-radius:\s*8px/);
  });

  it("huntCardRail button.active usa elevación --active-* sin --senal-dim ni --accent", () => {
    const active = huntBlock.match(/\.huntCardRail button\.active\s*\{[^}]*\}/s);
    expect(active).toBeTruthy();
    expect(active[0]).toMatch(/--active-bg/);
    expect(active[0]).toMatch(/--active-border/);
    expect(active[0]).toMatch(/--active-fg/);
    expect(active[0]).not.toMatch(/--senal-dim/);
    expect(active[0]).not.toMatch(/--accent/);
  });

  it("huntCardRail bloque no contiene --senal-dim", () => {
    expect(huntBlock).not.toMatch(/--senal-dim/);
  });

  it("hover no activo usa --line2 / --text sin ámbar", () => {
    const hover = huntBlock.match(/\.huntCardRail button:not\(\.active\):hover\s*\{[^}]*\}/s);
    expect(hover).toBeTruthy();
    expect(hover[0]).toMatch(/--line2/);
    expect(hover[0]).toMatch(/--text/);
    expect(hover[0]).not.toMatch(/--senal-dim/);
    expect(hover[0]).not.toMatch(/--accent/);
  });

  it("resultFilterSelect[data-active] sin azul legado rgba(59, 120, 240)", () => {
    const activeSelect = filterBlock.match(
      /\.screenerTerminalPage \.resultFilterSelect\[data-active="true"\]\s*\{[^}]*\}/s,
    );
    expect(activeSelect).toBeTruthy();
    expect(activeSelect[0]).not.toMatch(/59,\s*120,\s*240/);
    expect(activeSelect[0]).toMatch(/--active-border/);
    expect(activeSelect[0]).toMatch(/--active-bg/);
  });

  it("viewLayerFilters summary alineado con hover/open --line2", () => {
    expect(filterBlock).toMatch(/\.viewLayerFilters > summary:hover[^}]*--line2/s);
    expect(filterBlock).toMatch(/\.viewLayerFilters\[open\] > summary[^}]*--line2/s);
  });
});
