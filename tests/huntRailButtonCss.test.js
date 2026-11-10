import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");

/** Bloque UX-BTN-5 — elementos del raíl de vistas (paso 6: vertical). */
function extractHuntRailBlock(css) {
  const start = css.indexOf(".screenerViewRailItem {");
  const end = css.indexOf(".screenerViewRailItem:disabled {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

/** Bloque filtros terminal — resultFilterSelect activo + summary de «+ Filtro».
 * Paso 5 (rediseño 2026-11): el chip «+ Filtro» de capas de vista pasa a ser el
 * disparador del popover (.screenerFilterPopover) y su rejilla interna, el
 * panel del popover. */
function extractResultFilterBlock(css) {
  const start = css.indexOf(".screenerTerminalPage .resultFilterSelect {");
  const end = css.indexOf(".screenerTerminalPage .screenerFilterPopoverPanel {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("UX-BTN-5 · hunt rail + filtro CSS", () => {
  const huntBlock = extractHuntRailBlock(SCREENER_CSS);
  const filterBlock = extractResultFilterBlock(SCREENER_CSS);

  it("raíl: elemento base usa --radius (no 8px)", () => {
    const base = huntBlock.match(/\.screenerViewRailItem\s*\{[^}]*\}/s);
    expect(base).toBeTruthy();
    expect(base[0]).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(base[0]).not.toMatch(/border-radius:\s*8px/);
  });

  it("raíl: activo usa elevación --active-* sin --senal-dim ni --accent", () => {
    const active = huntBlock.match(/\.screenerViewRailItem\.active\s*\{[^}]*\}/s);
    expect(active).toBeTruthy();
    expect(active[0]).toMatch(/--active-bg/);
    expect(active[0]).toMatch(/--active-fg/);
    expect(active[0]).not.toMatch(/--senal-dim/);
    expect(active[0]).not.toMatch(/--accent/);
  });

  it("raíl: bloque no contiene --senal-dim", () => {
    expect(huntBlock).not.toMatch(/--senal-dim/);
  });

  it("raíl: hover usa --surface2 / --text sin ámbar", () => {
    const hover = huntBlock.match(/\.screenerViewRailItem:not\(:disabled\):hover\s*\{[^}]*\}/s);
    expect(hover).toBeTruthy();
    expect(hover[0]).toMatch(/--surface2/);
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

  it("«+ Filtro» (popover) alineado con hover/open --line2", () => {
    expect(filterBlock).toMatch(/\.screenerFilterPopover > summary:hover[^}]*--line2/s);
    expect(filterBlock).toMatch(/\.screenerFilterPopover\[open\] > summary[^}]*--line2/s);
  });
});
