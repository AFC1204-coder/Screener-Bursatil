import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StockClient, { ComparativeContext, N0VerdictBlock, rsRankingStripValue } from "@/app/stock/[symbol]/StockClient";

/* Regresiones del análisis de la ficha (docs/analisis-ficha-2026-08-15.md):
   datos que parecían medidas del valor y no lo eran, más el guard que
   borraba los botones de la cabecera. */

function bars(count = 260) {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const close = 90 + index * 0.16;
    return {
      date: new Date(start + index * 86400000).toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.02,
      low: close * 0.98,
      close,
      volume: 900000 + index * 1200,
    };
  });
}

function stockData(overrides = {}) {
  return {
    name: "Ficha Test Inc.",
    currency: "USD",
    exchange: "NYSE",
    sector: "Technology",
    industry: "Software",
    country: "United States",
    marketCap: 12000000000,
    quoteSnapshot: { price: 131.44 },
    chartBars: bars(),
    dataQuality: {
      freshness: { priceDate: "2025-09-17", rsGlobalAsOf: "2025-09-17", rsGlobalSample: 4868 },
      coverage: { label: "Completa" },
    },
    relativeStrength: {
      globalRsSeries: [{ date: "2025-09-17", rsRating: 94, sampleSize: 4868 }],
      rsGlobalSample: 4868,
      benchmarkSymbol: "SPY",
      benchmarkRating: 58,
      rsQualityScore: 62,
    },
    growthMetrics: { revenueGrowth: 22, earningsGrowth: 15 },
    valuationMetrics: { sharesOutstanding: 100000000 },
    stage: { label: "Etapa 2 probable" },
    financialResults: { incomeQuarterly: [], incomeAnnual: [] },
    links: { official: "https://example.com" },
    news: [],
    ...overrides,
  };
}

function techLabels(html) {
  return [...html.matchAll(/class="stockTechRowLabel">([^<]+)</g)].map((match) => match[1]);
}

describe("cabecera N0: los botones se renderizan", () => {
  // El bug: `n0Actions` era un fragmento JSX y el guard exigía
  // `actions.length`, que en un elemento React es undefined. Resultado:
  // "Screener" y "Web oficial" no se renderizaban NUNCA.
  it("renderiza Screener y Web oficial en la ficha completa", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "ACTS",
      initialData: stockData(),
    }));
    expect(html).toContain("stockBackLink");
    expect(html).toContain(">Screener<");
    expect(html).toContain(">Web oficial<");
    expect(html).toContain("https://example.com");
  });

  it("sin web oficial mantiene el botón de vuelta al screener", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "ACTS",
      initialData: stockData({ links: {} }),
    }));
    expect(html).toContain(">Screener<");
    expect(html).not.toContain(">Web oficial<");
  });

  it("el guard de N0 acepta un fragmento JSX, no solo un array", () => {
    // Blindaje del bug concreto: si alguien vuelve a pasar un fragmento (o un
    // único elemento) en vez de un array, el bloque debe seguir renderizando.
    const fragment = React.createElement(
      React.Fragment,
      null,
      React.createElement("a", { className: "stockHeroLink", href: "/" }, "Screener"),
    );
    const html = renderToStaticMarkup(React.createElement(N0VerdictBlock, {
      symbol: "FRAG",
      data: { name: "Fragmento Inc." },
      priceSnapshot: { price: 10 },
      freshness: {},
      coverage: {},
      setupSummary: "",
      rsUniverse: null,
      actions: fragment,
    }));
    expect(html).toContain("stockVerdictLinks");
    expect(html).toContain(">Screener<");
  });

  it("sin acciones no pinta el contenedor vacío", () => {
    const html = renderToStaticMarkup(React.createElement(N0VerdictBlock, {
      symbol: "NONE",
      data: { name: "Sin acciones Inc." },
      priceSnapshot: { price: 10 },
      freshness: {},
      coverage: {},
      setupSummary: "",
      rsUniverse: null,
      actions: [],
    }));
    expect(html).not.toContain("stockVerdictLinks");
  });
});

describe("N1: fuera los datos que no son medidas del valor", () => {
  it("no muestra BASE ni PIVOT (ventana fija del detector y su máximo)", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "NOBASE",
      initialData: stockData(),
    }));
    const labels = techLabels(html);
    expect(labels).not.toContain("BASE");
    expect(labels).not.toContain("PIVOT");
    expect(html).not.toContain("sem<");
  });

  it("la distancia al máximo de 52 semanas no se llama ATH", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "MAX52",
      initialData: stockData(),
    }));
    const labels = techLabels(html);
    expect(labels).not.toContain("ATH");
    expect(labels).toContain("MÁX 52S");
  });

  it("la lectura técnica conserva las filas que sí son medidas", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "KEEP",
      initialData: stockData(),
    }));
    expect(techLabels(html)).toEqual(
      expect.arrayContaining(["RS", "RS QUALITY", "ETAPA", "MA50", "MA200", "MÁX 52S"]),
    );
  });

  it("el desglose del patrón nombra la ventana del detector", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "VENT",
      initialData: stockData(),
    }));
    expect(html).toContain("Rango 65 sesiones");
    expect(html).toContain("Dist. techo 65 sesiones");
  });
});

describe("contexto comparativo: mismas retiradas que N1", () => {
  const rows = [
    {
      symbol: "PEER",
      companyName: "Peer Inc.",
      relation: { label: "Mismo grupo" },
      baseDepthPct: 18.4,
      baseWeeks: 13,
      distanceToPivotPct: -4.2,
      volumeDryUpRatio: 0.82,
      rsSectorPct: 71,
      contractionDepths: [12, 7],
      patternDataStatus: "ok",
      patternEligible: true,
    },
  ];

  it("no publica la duración de base ni la distancia al pivote", () => {
    const html = renderToStaticMarkup(React.createElement(ComparativeContext, { rows, symbol: "PEER" }));
    expect(html).not.toContain("sem");
    expect(html).not.toContain(">Pivot<");
    expect(html).not.toContain(">Base<");
    expect(html).toContain(">Rango 65s<");
  });

  it("las celdas siguen cuadrando con las cabeceras", () => {
    const html = renderToStaticMarkup(React.createElement(ComparativeContext, { rows, symbol: "PEER" }));
    const headers = [...html.matchAll(/<th>([^<]*)<\/th>/g)].length;
    const cells = [...html.matchAll(/<td>/g)].length;
    expect(headers).toBe(8);
    expect(cells).toBe(headers);
  });
});

describe("franja de calidad: el RS ausente se muestra ausente", () => {
  it("sin ranking semanal no inventa fecha ni muestra cero", () => {
    expect(rsRankingStripValue(null, { rsGlobalAsOf: "2026-08-15", rsGlobalSample: 0 })).toBe("Sin ranking");
    expect(rsRankingStripValue(undefined, { rsGlobalAsOf: "2026-08-15" })).toBe("Sin ranking");
  });

  it("con ranking pero sin muestra útil muestra la fecha sin n=0", () => {
    expect(rsRankingStripValue(94, { rsGlobalAsOf: "2026-08-15", rsGlobalSample: 0 })).not.toMatch(/n=/);
    expect(rsRankingStripValue(94, { rsGlobalAsOf: "2026-08-15" })).not.toMatch(/n=/);
  });

  it("con ranking y muestra mantiene fecha · n=", () => {
    expect(rsRankingStripValue(94, { rsGlobalAsOf: "2026-08-15", rsGlobalSample: 4868 })).toMatch(/n=/);
  });

  it("sin snapshot de RS no promete uno", () => {
    expect(rsRankingStripValue(94, {})).toBe("Sin snapshot");
  });

  it("la ficha de un símbolo sin RS semanal no imprime n=0 en la cabecera", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "NORS",
      initialData: stockData({
        relativeStrength: { rsGlobalSample: 0, benchmarkSymbol: "SPY" },
        dataQuality: {
          freshness: { priceDate: "2025-09-17", rsGlobalAsOf: "2025-09-17", rsGlobalSample: 0 },
          coverage: { label: "Completa" },
        },
      }),
    }));
    expect(html).not.toContain("n=0");
    expect(html).toContain("Sin ranking");
    // La cabecera y el panel de abajo dicen lo mismo sobre el mismo dato.
    expect(html).toContain("Sin RS semanal");
  });
});
