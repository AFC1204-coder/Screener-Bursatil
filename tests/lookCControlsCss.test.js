import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");
const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");
const BASE_CSS = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const STOCK_CSS = readFileSync(new URL("../styles/stock.css", import.meta.url), "utf8");
const SCREENER_SHELL = readFileSync(
  new URL("../app/components/screener/ScreenerShell.jsx", import.meta.url),
  "utf8",
);

function extractBtnSection8(css) {
  const start = css.indexOf("/* ── 8. Buttons (UX-BTN-2 + LOOK-C");
  const end = css.indexOf("/* ── 9. Table ──", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("LOOK-C · controles, tipo y transiciones", () => {
  const section8 = extractBtnSection8(COMPONENTS_CSS);

  it("§8 usa tokens --control-* y --t-state", () => {
    expect(section8).toMatch(/min-height:\s*var\(--control-m\)/);
    expect(section8).toMatch(/min-height:\s*var\(--control-s\)/);
    expect(section8).toMatch(/var\(--t-state\)/);
    expect(section8).toMatch(/@media \(max-width: 760px\)[\s\S]*min-height:\s*var\(--control-l\)/);
    expect(section8).toMatch(/\.btnPrimary[\s\S]*min-height:\s*44px/);
  });

  it("§8 .btn* sin !important", () => {
    expect(section8).not.toMatch(/!important/);
  });

  it("compactSeg keycaps usan --control-s", () => {
    expect(COMPONENTS_CSS).toMatch(/\.compactSeg button,[\s\S]*height:var\(--control-s\)/);
  });

  it("sin transition: all en styles tocados", () => {
    for (const css of [COMPONENTS_CSS, SCREENER_CSS, BASE_CSS, STOCK_CSS]) {
      expect(css).not.toMatch(/transition:\s*all/i);
    }
  });

  it("base.css tiene prefers-reduced-motion y fadeIn único", () => {
    expect(BASE_CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(BASE_CSS).toMatch(/@keyframes fadeIn/);
    expect(BASE_CSS).not.toMatch(/@keyframes brandShimmer/);
    expect(BASE_CSS).not.toMatch(/@keyframes slideDropdown/);
  });

  it("búsqueda móvil: ✕ en input, Limpiar ancho solo desktop", () => {
    expect(SCREENER_SHELL).toContain("searchClearBtn");
    expect(SCREENER_SHELL).toContain("searchClearWide");
    expect(SCREENER_CSS).toMatch(/\.searchClearBtn[\s\S]*display:inline-flex/);
    expect(SCREENER_CSS).toMatch(/\.searchBar \.searchClearWide[\s\S]*display:none/);
  });

  it("font-size px sueltos solo en héroes (30–56) en CSS tocados", () => {
    const scoped = [COMPONENTS_CSS, SCREENER_CSS, STOCK_CSS, BASE_CSS].join("\n");
    const numeric = [...scoped.matchAll(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g)].map((m) => parseFloat(m[1]));
    const heroes = numeric.filter((n) => n >= 30 || n === 0);
    expect(numeric.length).toBe(heroes.length);
  });
});
