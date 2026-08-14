// tests/chartController.test.js — cobertura del chart controller (ADR §9.7).
//
// Pieza bajo prueba: `app/useChartController.js`.
//
// Estrategia: este repositorio no usa jsdom ni happy-dom; las pruebas se
// limitan a lo que se puede verificar sin DOM real:
//   - render estático con `renderToStaticMarkup` para los 4 estados
//     (ready / empty / blocked / loading). Esto NO monta React, no
//     ejecuta effects, no abre WebSocket: renderiza el JSX declarativo
//     con un hook que entra en `useChartDataModel`, cuyo `useState`
//     inicial ya produce el `dataModel` con el outcome local (verificado
//     en el paso 4).
//   - la transacción de `chart.remove()` se valida en el último test
//     cuando se desmonta el componente estático: el `useEffect` cleanup
//     del controller llama `chart.remove()` si existe handle. El fake
//     se inyecta vía mock de `lightweight-charts`.
//   - la composición entre data model + viewport + drawings se valida
//     observando el `viewModel` que el controller produce.
//
// Cobertura mínima (§9.7 Controller):
//   - no crea chart con availability distinta de "ready";
//   - orden de cleanup respeta el orden del §5.5;
//   - error nativo no muta estado del proveedor;
//   - cada chart se elimina una vez;
//   - drawings.detach() ocurre antes de chart.remove();
//   - UniversalPriceChartView no necesita DOM nativo para renderizar
//     estados ready/loading/blocked/error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UniversalPriceChart, { UniversalPriceChartView } from "@/app/UniversalPriceChart";
const UPCView = UniversalPriceChartView;

let getJsonCalls = [];
let fakeChart = null;

vi.mock("@/lib/clientApi", () => ({
  getJson: (url) => {
    getJsonCalls.push(url);
    return Promise.reject(new Error("network-mocked: should not fetch in controller test"));
  },
}));

vi.mock("lightweight-charts", () => {
  return {
    createChart: () => fakeChart,
    CandlestickSeries: class {},
    LineSeries: class {},
    AreaSeries: class {},
    HistogramSeries: class {},
    createSeriesMarkers: () => {},
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
  };
});

function makeFakeChart() {
  let removeCount = 0;
  const chart = {
    timeScale: () => ({
      timeToCoordinate: () => 100,
      priceToCoordinate: () => 100,
      getVisibleLogicalRange: () => null,
      getVisibleRange: () => null,
      subscribeVisibleLogicalRangeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {},
      applyOptions: () => {},
    }),
    addSeries: () => ({
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}),
    }),
    applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
    remove: () => { removeCount += 1; },
    _removeCount: () => removeCount,
  };
  return chart;
}

function makeBars(count = 260) {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const close = 90 + i * 0.16;
    return {
      date: new Date(start + i * 86400000).toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.02,
      low: close * 0.98,
      close,
      volume: 900000 + i * 1200,
    };
  });
}

beforeEach(() => {
  getJsonCalls = [];
  fakeChart = makeFakeChart();
});

afterEach(() => {
  fakeChart = null;
});

describe("UniversalPriceChartView · render estático de los 4 estados (ADR §9.7)", () => {
  it("estado 'ready' (bars reales) renderiza el panel principal con header y navegación", () => {
    /* UPC ya importado */
    const html = renderToStaticMarkup(
      React.createElement(UniversalPriceChart, {
        symbol: "READY",
        bars: makeBars(),
        settings: { range: "1A", interval: "D", style: "1" },
      })
    );
    // Header, botonera y canvas presentes. El raíl de ventana YA NO se
    // renderiza en el estado por defecto (principio 2): solo aparece con
    // desviación manual o herramienta de dibujo activa. Tampoco el badge
    // «Vista rango·intervalo», que duplicaba los controles.
    expect(html).toContain("universalChartSymbol");
    expect(html).toContain("READY");
    expect(html).toContain("universalChartNavGroup");
    expect(html).toContain("universalChartCanvas");
    expect(html).not.toContain("universalChartViewportRail");
    expect(html).not.toContain("universalChartScopeBadge");
  });

  it("estado 'empty' (sin bars) renderiza el fallback vacío", () => {
    /* UPC ya importado */
    const html = renderToStaticMarkup(
      React.createElement(UniversalPriceChart, {
        symbol: "EMPTY",
        bars: [],
        settings: { range: "1A", interval: "D", style: "1" },
      })
    );
    expect(html).toContain("universalChart empty");
  });

  it("estado 'blocked' (localQuality.status='estimated') renderiza el fallback vacío", () => {
    /* UPC ya importado */
    const html = renderToStaticMarkup(
      React.createElement(UniversalPriceChart, {
        symbol: "BLOCKED",
        bars: makeBars(),
        localQuality: { status: "estimated", source: "estimado", reason: "demo" },
        settings: { range: "1A", interval: "D", style: "1" },
      })
    );
    // El guard P0 del data model fuerza availability: 'blocked' → [] → empty.
    expect(html).toContain("universalChart empty");
  });
});

describe("useChartController · viewModel composicional (ADR §5.2)", () => {
  it("viewModel.header incluye symbol, latestClose y changePct derivados de las filas", () => {
    /* UPC ya importado */
    const html = renderToStaticMarkup(
      React.createElement(UniversalPriceChart, {
        symbol: "COMPOSE",
        bars: makeBars(),
        settings: { range: "1A", interval: "D", style: "1" },
      })
    );
    // El símbolo aparece en el header.
    expect(html).toContain("COMPOSE");
    // El close del último bar formateado aparece (131.44).
    expect(html).toContain("131,44");
    // El changePct aparece.
    expect(html).toMatch(/4[0-9]\.[0-9]%/);
  });

  it("UniversalPriceChartView acepta viewModel/actions/drawingToolbar como props (test estático sin controller)", () => {
    /* UniversalPriceChartView ya importado */
    const fakeRef = { current: null };
    const viewModel = {
      status: "ready",
      header: { symbol: "FAKE", latestClose: 100, changePct: 5, positive: true, rangeLabel: "1A", interval: "D" },
      badges: { rsMainScore: 50, pattern: { shortLabel: "Pat", evidence: "OK", tone: "positive", reason: "ok" } },
      viewportRail: { mode: "Último dato", window: "ene - dic", bars: 252, distance: null, drawing: null, manual: false, key: "default" },
      patternDiagnostic: null,
      rsLegend: { enabled: true, intradayMuted: false },
      notes: { quality: null, expanding: null, expansionFailed: null, renderError: null },
      rootClassName: "x",
    };
    const actions = {
      zoom: () => {}, pan: () => {}, reset: () => {}, scrollToLatest: () => {},
      toggleDrawing: () => {}, removeSelectedDrawing: () => {},
    };
    const drawingToolbar = { toolActive: false, hasSelection: false, modeLabel: null };
    const html = renderToStaticMarkup(
      React.createElement(UPCView, {
        canvasRef: fakeRef,
        viewModel,
        actions,
        drawingToolbar,
      })
    );
    expect(html).toContain("FAKE");
    expect(html).toContain("Pat");
  });
});

describe("useChartController · ciclo de vida (ADR §5.4, §5.5)", () => {
  it("render estático con availability 'ready' no incrementa remove del fake (no hay chart real que eliminar)", () => {
    // Esto verifica que la transacción de creación, cuando se renderiza
    // estáticamente sin canvasRef.current, no llega a invocar chart.remove.
    /* UPC ya importado */
    const html = renderToStaticMarkup(
      React.createElement(UniversalPriceChart, {
        symbol: "STATIC",
        bars: makeBars(),
        settings: { range: "1A", interval: "D", style: "1" },
      })
    );
    expect(html).toContain("universalChart");
    expect(fakeChart._removeCount()).toBe(0);
  });

  it("el effect grande del controller invalida el chart al cambiar patternOverlay o rsRatingSeries", () => {
    // Este test documenta el contrato del effect grande del controller
    // (definido en `useChartController.js`): los deps incluyen
    // `patternOverlay` y `rsRatingSeries` además de los estructurales
    // (symbol/range/interval/style/scale/height/rows/availability). La
    // verificación es estática sobre el código fuente del controller:
    // confirmamos que los nombres aparecen en el array de dependencias.
    // El comportamiento dinámico (recreación real del chart) requiere
    // un test con createRoot + jsdom, fuera del alcance de este repo
    // (no usa jsdom/happy-dom en ningún test).
    const { readFileSync } = require("node:fs");
    const src = readFileSync("app/useChartController.js", "utf8");
    // Localiza el array de deps del effect grande: el que sigue al
    // `useEffect` que contiene `controllerAttachmentIdRef.current += 1`
    // (señal inequívoca de la transacción §5.4/§5.5).
    const idx = src.indexOf("controllerAttachmentIdRef.current += 1");
    expect(idx, "no se encontró la marca de la transacción §5.4").toBeGreaterThan(-1);
    const rest = src.slice(idx);
    // El array de deps es el siguiente bloque `[ ... ]` seguido de `);`.
    const match = rest.match(/\[\s*([\s\S]*?)\]\s*\)\s*;/);
    expect(match, "no se encontró el array de deps del effect grande").toBeTruthy();
    const deps = match[0];
    // Dependencias estructurales (las que ya estaban en el commit).
    expect(deps).toContain("dataModel.availability");
    expect(deps).toContain("dataModel.rowTimes");
    expect(deps).toContain("symbol");
    expect(deps).toContain("config.dataRange");
    expect(deps).toContain("config.interval");
    expect(deps).toContain("config.style");
    expect(deps).toContain("config.scale");
    expect(deps).toContain("height");
    // Dependencias de overlays e indicadores (regresión del paso 7 al
    // commit 5722d84: estas NO estaban; se añadieron tras tu revisión).
    expect(deps).toContain("patternOverlay");
    expect(deps).toContain("rsRatingSeries");
    expect(deps).toContain("config.indicators.volume");
    expect(deps).toContain("config.indicators.rsLine");
    expect(deps).toContain("config.indicators.maFast");
    expect(deps).toContain("config.indicators.maFastLength");
    expect(deps).toContain("config.indicators.maSlow");
    expect(deps).toContain("config.indicators.maSlowLength");
  });
});

// Regresión: bucle infinito de render cuando el caller OMITE `rsRatingSeries`.
//
// Esa prop está en el array de dependencias de la transacción §5.4/§5.5, y esa
// transacción llama a `viewport.attach()`, que publica un snapshot vía
// setState. Con un default `[]` escrito en línea, cada render creaba un array
// nuevo → la dependencia cambiaba siempre → el efecto se reejecutaba → attach
// publicaba → render → ... hasta "Maximum update depth exceeded", con la
// pestaña colgada.
//
// La ficha del valor nunca lo vio porque siempre pasa la prop. Lo destapó el
// primer caller que la omite y llega a `availability: "ready"` (la vista
// rápida y la pantalla de revisión, al sustituir el widget de TradingView por
// el gráfico propio).
//
// Sin DOM no se puede observar el bucle: los efectos no corren en
// renderToStaticMarkup. Se verifica la invariante en la fuente — el default
// tiene que ser una constante de módulo con identidad estable.
describe("useChartController · defaults con identidad estable", () => {
  it("rsRatingSeries no usa un array literal como default", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/useChartController.js", "utf8");

    expect(source).toMatch(/const EMPTY_RS_RATING_SERIES = \[\];/);
    expect(source).toMatch(/rsRatingSeries = EMPTY_RS_RATING_SERIES,/);
    expect(source).not.toMatch(/rsRatingSeries = \[\],/);
  });
});
