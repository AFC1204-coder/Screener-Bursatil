import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");
const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");
const SCREENER_SHELL = readFileSync(
  new URL("../app/components/screener/ScreenerShell.jsx", import.meta.url),
  "utf8",
);

describe("LOOK-E · mesa + chrome /stock", () => {
  it(".stockPreview sin gradiente negro v1", () => {
    expect(SCREENER_CSS).not.toMatch(/linear-gradient\(180deg,rgba\(17,\s*16,\s*13/);
    expect(SCREENER_CSS).toMatch(/\.stockPreview\s*\{[^}]*background:var\(--surface\)/s);
    expect(SCREENER_CSS).toMatch(/\.stockPreview\s*\{[^}]*box-shadow:var\(--shadow-panel\)/s);
  });

  it("preview de búsqueda flotante (popover)", () => {
    expect(SCREENER_SHELL).toContain("searchPopoverHost");
    expect(COMPONENTS_CSS).toMatch(/\.searchPopoverHost\s*\{[^}]*position:relative/s);
    expect(COMPONENTS_CSS).toMatch(/\.searchResult\.searchResultPrimary\s*\{[^}]*position:absolute/s);
  });

  it("pager legible con --soft", () => {
    expect(COMPONENTS_CSS).toMatch(/\.resultPagerRange\s*\{[^}]*color:var\(--soft\)/s);
    expect(SCREENER_CSS).toMatch(/\.screenerTerminalPage \.resultPagerRange\s*\{[^}]*color:var\(--soft\)/s);
  });

  it("keycaps mesa 3M/6M/12M usan --text-xs y --control-s en pozo inset", () => {
    expect(SCREENER_CSS).toMatch(/\.screenerPeriodPicker \.chartSegmented\s*\{[^}]*background:var\(--surface-inset\)/s);
    expect(SCREENER_CSS).toMatch(/\.screenerPeriodPicker \.chartSegmented button\s*\{[^}]*height:var\(--control-s\)/s);
    expect(SCREENER_CSS).toMatch(/\.screenerPeriodPicker \.chartSegmented button\s*\{[^}]*font-size:var\(--text-xs\)/s);
  });

  it("sparklines CSS usan --serie-alza / --serie-baja", () => {
    expect(COMPONENTS_CSS).toMatch(/\.sparkPrice\s*\{[^}]*stroke:var\(--serie-alza\)/s);
    expect(COMPONENTS_CSS).toMatch(/\.miniSparkline\.down \.sparkPrice\s*\{[^}]*stroke:var\(--serie-baja\)/s);
    expect(SCREENER_CSS).toMatch(/\.screenerTerminalPage \.compactSparkCell \.sparkPrice\s*\{[^}]*stroke:var\(--serie-alza\)/s);
    expect(SCREENER_CSS).not.toMatch(/#22c55e/);
  });

  it("/stock keycaps: desktop --control-s; móvil ≤760 --control-l (sin residual 22px)", () => {
    expect(COMPONENTS_CSS).toMatch(
      /\.stockPage \.chartPrefs \.chartSegmented button\s*\{[^}]*height:var\(--control-s\)/s,
    );
    expect(COMPONENTS_CSS).not.toMatch(
      /\.stockPage \.chartPrefs \.chartSegmented button\s*\{[^}]*height:22px/s,
    );
    // No invertir: control-l solo en max-width móvil, no en min-width desktop.
    expect(COMPONENTS_CSS).not.toMatch(
      /@media\(min-width:1024px\)[\s\S]{0,800}\.stockPage \.chartPrefs \.chartSegmented button\s*\{[^}]*height:var\(--control-l\)/s,
    );
    expect(COMPONENTS_CSS).toMatch(
      /@media\(max-width:760px\)[\s\S]*\.stockPage \.chartPrefs \.chartSegmented button[\s\S]*height:var\(--control-l\)/s,
    );
  });

  it("/stock rail clasificación usa --control-m (desktop) y --control-l (≤760)", () => {
    expect(COMPONENTS_CSS).toMatch(/\.stockPage \.stockDecisionActionMenu > summary\s*\{[^}]*min-height:var\(--control-m\)/s);
    expect(COMPONENTS_CSS).toMatch(/@media\(max-width:760px\)[\s\S]*\.stockPage \.stockDecisionActionMenu > summary\s*\{[^}]*min-height:var\(--control-l\)/s);
  });
});
