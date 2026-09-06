import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCREENER_CSS = readFileSync(new URL("../styles/screener.css", import.meta.url), "utf8");
const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

function extractRuleBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

describe("LOOK-D · aside piel CSS", () => {
  it("aside desktop usa fondo --bg", () => {
    const sidebarBlocks = SCREENER_CSS.match(/\.sidebar\s*\{[^}]*background:\s*var\(--bg\)/gs) ?? [];
    expect(sidebarBlocks.length).toBeGreaterThan(0);
  });

  it("tarjeta familia: --surface + --line2 + --shadow-panel; off sin opacity en fila", () => {
    const row = extractRuleBlock(SCREENER_CSS, ".layerControlRow");
    expect(row).toMatch(/background:\s*var\(--surface\)/);
    expect(row).toMatch(/border:\s*1px solid var\(--line2\)/);
    expect(row).toMatch(/box-shadow:\s*var\(--shadow-panel\)/);
    expect(SCREENER_CSS).not.toMatch(/\.layerControlRow\.off\s*\{[^}]*opacity/s);
  });

  it("⏻ on usa --senal-dim + --line3", () => {
    const on = extractRuleBlock(SCREENER_CSS, ".layerPowerToggle.on");
    expect(on).toMatch(/--senal-dim/);
    expect(on).toMatch(/--line3/);
  });

  it("chips mercado: rejilla 2 columnas y link Personalizar --text-xs", () => {
    expect(SCREENER_CSS).toMatch(/\.marketPresetBar\s*\{[^}]*grid-template-columns:repeat\(2,/s);
    // Override de terminal no puede volver a 5 cols (pisa el aside 272).
    expect(SCREENER_CSS).toMatch(
      /\.screenerTerminalPage \.marketPresetBar\s*\{[^}]*grid-template-columns:repeat\(2,/s,
    );
    expect(SCREENER_CSS).not.toMatch(
      /\.screenerTerminalPage \.marketPresetBar\s*\{[^}]*grid-template-columns:repeat\(5,/s,
    );
    expect(SCREENER_CSS).toMatch(/\.marketGrid\s*\{[^}]*grid-template-columns:repeat\(2,/s);
    expect(SCREENER_CSS).toMatch(/\.marketCustomizeDisclosure summary span[\s\S]*font-size:var\(--text-xs\)/);
    expect(SCREENER_CSS).toMatch(/\.marketCustomizeDisclosure[\s\S]*background:transparent/);
  });

  it("intensidad: Personalizado tiza; rail sentence case", () => {
    const custom = extractRuleBlock(SCREENER_CSS, ".filterIntensityCustom");
    expect(custom).toMatch(/color:\s*var\(--tiza\)/);
    expect(custom).not.toMatch(/uppercase/);
    expect(custom).not.toMatch(/#fbbf24|#f59e0b|var\(--warn/);
    const rail = extractRuleBlock(SCREENER_CSS, ".filterIntensityRail");
    expect(rail).toMatch(/text-transform:\s*none/);
  });

  it("modal: inputs 6ch; checks sin #22c55e/#4ade80; cabecera display-s", () => {
    const modalStart = SCREENER_CSS.indexOf("/* LOOK-D — aside piel: modal compacto");
    const modalSlice = SCREENER_CSS.slice(
      modalStart > -1 ? modalStart : SCREENER_CSS.indexOf(".filterFamilyModal"),
      SCREENER_CSS.indexOf(".filterFamilyModal .filterFamilyPresetRail"),
    );
    expect(modalSlice).toMatch(/width:6ch/);
    expect(SCREENER_CSS).toMatch(/\.filterFamilyHeader h2[\s\S]*--display-s/);
    expect(SCREENER_CSS).toMatch(/\.filterToggleLine input:checked[\s\S]*--line3/);
    const toggleSlice = SCREENER_CSS.slice(
      SCREENER_CSS.indexOf(".filterToggleLine input {"),
      SCREENER_CSS.indexOf(".filterToggleLine span {"),
    );
    expect(toggleSlice).not.toMatch(/#22c55e|#4ade80|accent-color:\s*var\(--accent\)/);
    expect(SCREENER_CSS).toMatch(/\.filterFamilyPreset:active[\s\S]*--senal-dim/);
  });

  it("drawer móvil: cabecera sin negro v1; entrada --t-enter", () => {
    const drawerHeader = SCREENER_CSS.match(
      /\.sidebar\.mobileOpen \.mobileSidebarHeader\s*\{[^}]*\}/s,
    );
    expect(drawerHeader).toBeTruthy();
    expect(drawerHeader[0]).not.toMatch(/rgba\(5,\s*5,\s*6/);
    expect(drawerHeader[0]).toMatch(/var\(--surface\)/);
    expect(SCREENER_CSS).toMatch(/\.sidebar\.mobileOpen\s*\{[^}]*animation:\s*fadeIn var\(--t-enter\)/s);
    expect(SCREENER_CSS).toMatch(/\.sidebar\.mobileOpen\s*\{[^}]*inset:\s*0/s);
    expect(SCREENER_CSS).toMatch(/z-index:\s*1000/);
    // Terminal no puede dejar top:78 sobre el drawer abierto.
    expect(SCREENER_CSS).toMatch(
      /\.screenerTerminalPage \.sidebar\.mobileOpen\s*\{[^}]*inset:\s*0/s,
    );
    expect(SCREENER_CSS).toMatch(
      /\.screenerTerminalPage \.sidebar\.mobileOpen\s*\{[^}]*top:\s*0/s,
    );
  });

  it("sin !important en .layerControlRow / .mobileSidebarHeader / .marketChip (screener)", () => {
    for (const selector of [".layerControlRow", ".mobileSidebarHeader", ".marketChip"]) {
      const re = new RegExp(`${selector.replace(".", "\\.")}[^{]*\\{[^}]*\\}`, "gs");
      const blocks = SCREENER_CSS.match(re) ?? [];
      for (const block of blocks) {
        expect(block).not.toMatch(/!important/);
      }
    }
  });

  it("controlDotCustom usa --senal", () => {
    expect(SCREENER_CSS).toMatch(/\.controlDot\.controlDotCustom[\s\S]*background:var\(--senal\)/);
  });
});
