import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");
const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");

const FORBIDDEN_COUNTRY_HEX = /#f8fbff|#0b1220|#0b0d11|#11141a|#b7bdc8/i;

function extractMarketChipActiveBlocks(css) {
  return css.match(/\.marketChip\.active[^{]*\{[^}]*\}/gs) ?? [];
}

function extractCountryMarketChipBlock(screenerCss, componentsCss) {
  const start = screenerCss.indexOf(".countryMarketChip {");
  const end = screenerCss.indexOf(".countryMarketChip .marketChipFlag {", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const base = screenerCss.slice(start, end);
  const active = componentsCss.match(/\.countryMarketChip\.active\s*\{[^}]*\}/s) ?? [];
  const activeBefore = componentsCss.match(/\.countryMarketChip\.active:before\s*\{[^}]*\}/s) ?? [];
  return base + active.join("") + activeBefore.join("");
}

describe("UX-BTN-6 · market / country chips CSS", () => {
  const marketActiveBlocks = extractMarketChipActiveBlocks(COMPONENTS_CSS);
  const countryBlock = extractCountryMarketChipBlock(SCREENER_CSS, COMPONENTS_CSS);

  it("define al menos una regla .marketChip.active", () => {
    expect(marketActiveBlocks.length).toBeGreaterThan(0);
  });

  it("ninguna regla .marketChip.active usa background:var(--accent) (fill tiza)", () => {
    for (const block of marketActiveBlocks) {
      expect(block).not.toMatch(/background\s*:\s*var\(--accent\)/);
    }
  });

  it(".marketChip.active global usa elevación --active-* o contorno --line2", () => {
    const globalActive = COMPONENTS_CSS.match(
      /^\.marketChip\.active\s*\{[^}]*\}/ms,
    );
    expect(globalActive).toBeTruthy();
    expect(globalActive[0]).toMatch(/--active-(?:bg|border|fg)|--line2/);
    expect(globalActive[0]).not.toMatch(/--senal-dim/);
    expect(globalActive[0]).not.toMatch(/background\s*:\s*var\(--accent\)/);
  });

  it(".marketChip.active no comparte regla con .layerToggle.on", () => {
    expect(COMPONENTS_CSS).not.toMatch(/\.layerToggle\.on,\s*\.marketChip\.active/);
  });

  it("countryMarketChip (base+active) sin hex legado", () => {
    expect(countryBlock).not.toMatch(FORBIDDEN_COUNTRY_HEX);
  });

  it("countryMarketChip base usa tokens --surface2 / --soft / --line", () => {
    const base = countryBlock.match(/\.countryMarketChip\s*\{[^}]*\}/s);
    expect(base).toBeTruthy();
    expect(base[0]).toMatch(/--surface2/);
    expect(base[0]).toMatch(/--soft/);
    expect(base[0]).toMatch(/--line/);
  });

  it("countryMarketChip.active usa elevación sin --senal-dim ni glow azul", () => {
    const active = COMPONENTS_CSS.match(/\.countryMarketChip\.active\s*\{[^}]*\}/s);
    expect(active).toBeTruthy();
    expect(active[0]).toMatch(/--active-(?:bg|border|fg)|--line2/);
    expect(active[0]).not.toMatch(/--senal-dim/);
    expect(active[0]).not.toMatch(/rgba\(147,\s*197,\s*253/);

    const dot = COMPONENTS_CSS.match(/\.countryMarketChip\.active:before\s*\{[^}]*\}/s);
    expect(dot).toBeTruthy();
    expect(dot[0]).not.toMatch(/box-shadow:\s*0\s+0\s+10px/);
  });

  it("disabled chips usan opacity 0.40 y --ghost", () => {
    expect(COMPONENTS_CSS).toMatch(/\.marketChip\.isDisabled[^}]*opacity:\s*0\.40/s);
    expect(COMPONENTS_CSS).toMatch(/\.marketChip\.isDisabled[^}]*--ghost/s);
    expect(SCREENER_CSS).toMatch(
      /\.screenerTerminalPage \.marketChip\.isDisabled[^}]*opacity:\s*0\.40/s,
    );
  });

  it("terminal .marketChip.active conserva contorno --line2 (no fill --accent)", () => {
    const terminalActive = SCREENER_CSS.match(
      /\.screenerTerminalPage \.marketChip\.active\s*\{[^}]*\}/s,
    );
    expect(terminalActive).toBeTruthy();
    expect(terminalActive[0]).toMatch(/--line2/);
    expect(terminalActive[0]).not.toMatch(/background\s*:\s*var\(--accent\)/);
  });
});
