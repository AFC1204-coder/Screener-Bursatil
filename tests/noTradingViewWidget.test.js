import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { localBarsForRow, resolveRowChartSource } from "@/app/RowPriceChart";

// El widget incrustado de TradingView se retiró de la vista rápida y de la
// pantalla de revisión: las tres superficies (ficha, vista rápida, revisión)
// usan el gráfico propio. El widget pintaba velas en verde y rojo puros —lo
// que el sistema de diseño prohíbe— y mostraba la marca del proveedor.
//
// Los ENLACES externos a tradingview.com (abrir el valor en su web) se
// conservan a propósito: no son el widget.

const ROOTS = ["app", "lib", "styles"];
const EXTENSIONS = [".js", ".jsx", ".mjs", ".css"];

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((root) => sourceFiles(root));

describe("widget incrustado de TradingView retirado", () => {
  it("ningún archivo carga el script del widget", () => {
    const offenders = FILES.filter((file) =>
      readFileSync(file, "utf8").includes("embed-widget-advanced-chart"));

    expect(offenders).toEqual([]);
  });

  it("no queda ningún contenedor ni clase del widget", () => {
    const offenders = FILES.filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes("tradingview-widget-container")
        || source.includes("tvPreviewBox")
        || source.includes("tvPreviewNative")
        || source.includes("reviewTvChart");
    });

    expect(offenders).toEqual([]);
  });

  it("los enlaces externos a TradingView siguen existiendo", () => {
    const symbols = readFileSync("lib/symbols.js", "utf8");
    expect(symbols).toContain("https://www.tradingview.com/chart/");
  });
});

// El preview del screener es close-only ({date, close, volume, sma50, sma200}).
// En estilo vela no se puede dibujar, y el data model NO pide más histórico por
// su cuenta porque la suficiencia se mide en número de barras. Descartarlo es
// lo que hace que el chart pida la serie OHLC real en vez de quedarse en
// "Sin dato".
describe("localBarsForRow · qué preview vale como fuente local", () => {
  const closeOnly = [
    { date: "2026-07-01", close: 100, volume: 10 },
    { date: "2026-07-02", close: 101, volume: 12 },
  ];
  const ohlc = [
    { date: "2026-07-01", open: 99, high: 103, low: 98, close: 100 },
    { date: "2026-07-02", open: 100, high: 104, low: 99, close: 101 },
  ];

  it("descarta el preview close-only en estilo vela", () => {
    expect(localBarsForRow({ chartPreview: closeOnly }, "1")).toEqual([]);
  });

  it("acepta el preview close-only en línea y área", () => {
    expect(localBarsForRow({ chartPreview: closeOnly }, "8")).toHaveLength(2);
    expect(localBarsForRow({ chartPreview: closeOnly }, "3")).toHaveLength(2);
  });

  it("acepta OHLC real en estilo vela", () => {
    expect(localBarsForRow({ chartPreview: ohlc }, "1")).toHaveLength(2);
  });

  it("fila sin preview → sin barras locales", () => {
    expect(localBarsForRow(null, "1")).toEqual([]);
    expect(localBarsForRow({}, "1")).toEqual([]);
  });
});

describe("resolveRowChartSource · preview interino en línea (B2)", () => {
  const closeOnly = [
    { date: "2026-07-01", close: 100, volume: 10 },
    { date: "2026-07-02", close: 101, volume: 12 },
  ];
  const settings = { range: "1A", interval: "D", style: "1", scale: "price" };

  it("con vela + preview close-only usa línea interina y conserva preferredStyle", () => {
    const out = resolveRowChartSource({ chartPreview: closeOnly }, settings);
    expect(out.bars).toHaveLength(2);
    expect(out.settings.style).toBe("8");
    expect(out.preferredStyle).toBe("1");
  });

  it("con línea pedida devuelve el preview directamente", () => {
    const out = resolveRowChartSource({ chartPreview: closeOnly }, { ...settings, style: "8" });
    expect(out.bars).toHaveLength(2);
    expect(out.settings.style).toBe("8");
    expect(out.preferredStyle).toBeNull();
  });

  it("sin preview no inventa barras", () => {
    const out = resolveRowChartSource({ symbol: "TEST" }, settings);
    expect(out.bars).toEqual([]);
    expect(out.preferredStyle).toBeNull();
  });
});
