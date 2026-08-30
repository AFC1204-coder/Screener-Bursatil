import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHART_INTERVALS, CHART_RANGES, CHART_SCALE_MODES, DEFAULT_CHART_SETTINGS } from "@/lib/chartSettings";

const { default: ChartPreferences } = await import("@/app/ChartPreferences.jsx");
const COMPONENTS_CSS = readFileSync(new URL("../styles/components.css", import.meta.url), "utf8");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(ChartPreferences, {
    settings: DEFAULT_CHART_SETTINGS,
    onChange: () => {},
    symbol: "AAPL",
    compact: true,
    ...overrides,
  }));
}

describe("CHART-UI-1 · ChartPreferences compact", () => {
  it("agrupa rango y temporalidad en chartPrefClusterScope", () => {
    const html = render();
    expect(html).toContain('class="chartPrefs compact"');
    expect(html).toContain("chartPrefClusterScope");
    expect(html).toContain('aria-label="Rango"');
    expect(html).toContain('aria-label="Temporalidad"');
    const scopeStart = html.indexOf("chartPrefClusterScope");
    const displayStart = html.indexOf("chartPrefClusterDisplay");
    expect(scopeStart).toBeGreaterThan(-1);
    expect(displayStart).toBeGreaterThan(scopeStart);
    expect(html.indexOf('aria-label="Rango"', scopeStart)).toBeLessThan(displayStart);
    expect(html.indexOf('aria-label="Temporalidad"', scopeStart)).toBeLessThan(displayStart);
  });

  it("mantiene estilo, escala, RS, indicadores y notas en chartPrefClusterDisplay", () => {
    const html = render();
    expect(html).toContain("chartPrefClusterDisplay");
    expect(html).toContain('aria-label="Tipo de grafico"');
    for (const mode of CHART_SCALE_MODES) {
      expect(html).toContain(`>${mode.label}<`);
    }
    expect(html).toContain(">RS<");
    expect(html).toContain("Indicadores");
    expect(html).toContain("Notas");
  });

  it("modo no-compact no introduce clusters", () => {
    const html = renderToStaticMarkup(React.createElement(ChartPreferences, {
      settings: DEFAULT_CHART_SETTINGS,
      onChange: () => {},
      symbol: "AAPL",
      compact: false,
    }));
    expect(html).not.toContain("chartPrefClusterScope");
    expect(html).not.toContain("chartPrefClusterDisplay");
    expect(html).not.toContain('class="chartPrefs compact"');
  });

  it("deshabilita rangos incompatibles con la temporalidad activa", () => {
    const html = render({
      settings: { ...DEFAULT_CHART_SETTINGS, interval: "1m", range: "1D" },
    });
    const disabledRanges = CHART_RANGES
      .filter((item) => item.key !== "1D")
      .map((item) => `aria-label="Rango ${item.label}"`);
    for (const label of disabledRanges) {
      const match = html.match(new RegExp(`<button[^>]*${label.replace(/"/g, '\\"')}[^>]*>`));
      expect(match).toBeTruthy();
      expect(match[0]).toContain("disabled");
    }
  });

  it("expone todas las temporalidades en compact", () => {
    const html = render();
    for (const item of CHART_INTERVALS) {
      expect(html).toContain(`aria-label="Temporalidad ${item.label}"`);
    }
  });
});

describe("CHART-UI-1 · ChartPreferences compact CSS", () => {
  it("define clusters y layout en columna para compact", () => {
    expect(COMPONENTS_CSS).toMatch(/\.chartPrefCluster\s*\{/);
    expect(COMPONENTS_CSS).toMatch(/\.chartPrefs\.compact \.chartPrefsLine\s*\{[^}]*flex-direction:\s*column/s);
    expect(COMPONENTS_CSS).toMatch(/\.stockPage \.chartPrefs\.compact \.chartPrefsLine\s*\{[^}]*flex-direction:\s*column/s);
  });
});
