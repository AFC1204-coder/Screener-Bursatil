import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

describe("READ-H · badge patrón visible con tarjeta desplegada", () => {
  it("identityCardShown mantiene float controls visibles (opacity 1)", () => {
    expect(COMPONENTS_CSS).toMatch(
      /\.universalChart\.identityCardShown \.universalChartFloatControls\s*\{[^}]*opacity:\s*1/s,
    );
  });

  it("identityCardShown oculta nav en reposo y la muestra al hover del lienzo", () => {
    expect(COMPONENTS_CSS).toMatch(
      /\.universalChart\.identityCardShown \.universalChartNavGroup[\s\S]*?opacity:\s*0/s,
    );
    expect(COMPONENTS_CSS).toMatch(
      /\.universalChart\.identityCardShown \.universalChartCanvasWrap:hover \.universalChartNavGroup[\s\S]*?opacity:\s*1/s,
    );
  });

  it("identityCardShown deja el badge de patrón legible sin hover", () => {
    expect(COMPONENTS_CSS).toMatch(
      /\.universalChart\.identityCardShown \.universalChartPatternBadge\s*\{[^}]*opacity:\s*1/s,
    );
  });

  it("≤640 oculta badge en float controls salvo con tarjeta desplegada (compacto)", () => {
    const mobileBlock = COMPONENTS_CSS.match(/@media \(max-width: 640px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(mobileBlock).toMatch(/\.universalChartFloatControls \.universalChartPatternBadge\s*\{[^}]*display:\s*none/s);
    expect(mobileBlock).toMatch(
      /\.universalChart\.identityCardShown \.universalChartFloatControls \.universalChartPatternBadge\s*\{[^}]*display:\s*flex/s,
    );
  });

  it("touch (hover: none) sigue mostrando nav con tarjeta desplegada", () => {
    expect(COMPONENTS_CSS).toMatch(
      /@media \(hover: none\)\s*\{[^}]*\.universalChart\.identityCardShown \.universalChartNavGroup[^}]*opacity:\s*1/s,
    );
  });
});
