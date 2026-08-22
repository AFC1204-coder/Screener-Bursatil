import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StockClient, { N0VerdictBlock, rsRankingStripValue } from "@/app/stock/[symbol]/StockClient";

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
      actions: [],
    }));
    expect(html).not.toContain("stockVerdictLinks");
  });
});

describe("fuera los datos que no son medidas del valor", () => {
  // La «Lectura técnica» (N1) se retiró entera el 2026-08-21 por repetición
  // con la franja descriptiva (docs/analisis-ficha-cuadro-grafico-2026-08-21
  // .md, Parte B; tests/fichaRetiradas.test.js cubre la retirada). Las
  // garantías de ESTE describe siguen vigentes sobre las superficies que
  // quedan: ni BASE/PIVOT del detector ni la etiqueta «ATH» pueden volver a
  // ninguna fila clave-valor, y las medidas reales viven en franja + cuadro.
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

  it("la distancia al máximo de 52 semanas no se llama ATH en ninguna superficie", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "MAX52",
      initialData: stockData(),
    }));
    expect(techLabels(html)).not.toContain("ATH");
    expect(html).not.toContain(">ATH<");
    // El dato vive con su nombre honesto en la tarjeta 2c del lienzo
    // («Máx. 52s») — y solo ahí: la franja se lo cedió.
    expect(html).toContain("Máx. 52s");
  });

  it("las medidas que N1 aportaba viven ahora en la franja (Media 50d/200d)", () => {
    const html = renderToStaticMarkup(React.createElement(StockClient, {
      initialSymbol: "KEEP",
      initialData: stockData(),
    }));
    expect(html).toContain("Media 50d");
    expect(html).toContain("Media 200d");
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

/* El describe «contexto comparativo: mismas retiradas que N1» vivía aquí:
   probaba que ComparativeContext no publicaba base/pivote y que sus celdas
   cuadraban. El bloque entero se retiró de la ficha el 2026-08-21 (era la
   tabla de negaciones — docs/analisis-ficha-cuadro-grafico-2026-08-21.md,
   Parte B) y tests/fichaRetiradas.test.js vigila que no vuelva. Si vuelve
   algún día con un detector que valide de verdad, recuperar del historial
   estas dos garantías: sin «sem» ni «Pivot»/«Base», y celdas = cabeceras. */

describe("franja de calidad: el RS ausente se muestra ausente", () => {
  // La franja "Calidad de dato" de N0 (donde vivía "Sin ranking"/"n=0") se
  // retiró el 2026-08-22; el mismo texto, con el mismo criterio de
  // ausencia, vive ahora en el detalle auditable de N3 ("RS global"). Las
  // garantías de este describe siguen probando el criterio sobre el HTML
  // completo de la ficha, ahora vía esa superficie.
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
