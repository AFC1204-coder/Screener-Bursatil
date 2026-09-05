// tests/fichaRetiradas.test.js — contrato de superficie de la ficha tras la
// limpieza del 2026-08-21 (docs/analisis-ficha-cuadro-grafico-2026-08-21.md,
// Parte B) y del cuadro de identidad del lienzo (Parte A).
//
// Los cinco bloques retirados eran REPETICIÓN de la franja descriptiva o del
// cuadro (el RS llegó a aparecer cinco veces en una misma ficha); N3 se
// conserva ENTERO porque es auditoría: puede vivir colapsado sin que la
// ficha pierda lectura. Si alguno de estos asserts falla porque un bloque
// "volvió", releer el doc antes de reponerlo.
//
// Misma estrategia que el resto de tests de la ficha: renderToStaticMarkup
// (sin DOM, sin effects) — page.jsx ya server-renderiza StockClient en
// producción, así que todo lo asertado aquí es HTML que el usuario recibe.

import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StockClient, { stockRsUniverse } from "@/app/stock/[symbol]/StockClient";
import { buildChartIdentityCard } from "@/lib/chartIdentityCard";
import { compactDate } from "@/app/components/ui/QualityStrip";

vi.mock("lightweight-charts", () => ({
  createChart: () => null,
  CandlestickSeries: class {},
  LineSeries: class {},
  AreaSeries: class {},
  HistogramSeries: class {},
  createSeriesMarkers: () => {},
  PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2 },
}));

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

// Fixture deliberadamente COMPLETO en relativeStrength: los datos que
// alimentaban el panel «Fuerza relativa» (país/grupo/bench/quality/riesgo)
// están presentes para demostrar que el panel no se pinta AUNQUE haya dato.
function stockData(overrides = {}) {
  return {
    name: "Ficha Retiradas Inc.",
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
      rsCountryPct: 97,
      rsCountrySample: 900,
      rsSectorPct: 86,
      rsSectorSample: 40,
      benchmarkSymbol: "SPY",
      benchmarkRating: 58,
      countryRsRating: 72,
      countryRsSampleSize: 900,
      countryRsWeekKey: "2026-W35",
      rs3m: 12,
      rs6m: 18,
      rs12m: 24,
      rsQualityScore: 62,
      speculationRiskScore: 44,
      volatility63d: 28,
      maxDrawdown63d: 11,
      perf3m: 16,
      distance52w: -7.4,
    },
    growthMetrics: { revenueGrowth: 22, earningsGrowth: 15 },
    valuationMetrics: { sharesOutstanding: 100000000 },
    stage: { label: "Etapa 2 probable", weekly: { state: "stage2_confirmed", weekInStage: 12 } },
    financialResults: { incomeQuarterly: [], incomeAnnual: [] },
    links: {},
    news: [],
    ...overrides,
  };
}

function renderFicha(overrides = {}) {
  return renderToStaticMarkup(React.createElement(StockClient, {
    initialSymbol: "RETIR",
    initialData: stockData(overrides),
  }));
}

describe("bloques retirados el 2026-08-21: no vuelven por accidente", () => {
  const html = renderFicha();

  it("N1 «Lectura técnica» no se renderiza", () => {
    expect(html).not.toContain("Lectura técnica");
    expect(html).not.toContain(">RS QUALITY<");
  });

  it("N2 «Contexto» y sus fundamentales operativos no se renderizan", () => {
    expect(html).not.toContain("stockContext");
    expect(html).not.toContain("Fundamentales operativos");
    expect(html).not.toContain("Sin narrativa del screener");
  });

  it("el panel «Fuerza relativa» retirado no se renderiza aunque haya país/grupo/bench en el brief", () => {
    expect(html).not.toContain("rsPanel");
    expect(html).not.toContain("RS bench");
    expect(html).not.toContain("Riesgo técnico");
    // RS país en la tarjeta de identidad (MET-2) es ranking semanal, no el panel retirado.
    expect(html).toContain("RS país");
    expect(html).not.toContain("rsCountryPct");
  });

  it("el panel «Estado del volumen» no se renderiza", () => {
    expect(html).not.toContain("stockVolumePanel");
    expect(html).not.toContain("Estado del volumen");
  });

  it("el «Contexto comparativo» no se renderiza", () => {
    expect(html).not.toContain("Contexto comparativo");
  });

  it("N3 (la auditoría) se conserva entero: sus cuatro cajones colapsados", () => {
    expect(html).toContain("Desglose del score");
    expect(html).toContain("Bloque empresa");
    expect(html).toContain("Calidad de datos");
    expect(html).toContain("Metodología y gates");
  });

  it("los datos únicos de los bloques retirados viven ahora en la franja", () => {
    // MA50/MA200 (de N1) como medias diarias; impulso (del panel
    // de volumen). El reparto up/down vive solo en Sostén (prosa).
    // El volumen seco NO se duplica: sigue siendo una sola
    // celda «Volumen 10d/50d».
    expect(html).toContain("Media 50d");
    expect(html).toContain("Media 200d");
    expect(html).not.toContain("Reparto vol. 50d");
    expect(html).toContain("Impulso vol. 5/20d");
    expect(html).toContain("Volumen 10d/50d");
  });
});

describe("mesa de observación retirada el 2026-08-22: el veredicto no vuelve", () => {
  // La mesa solo aparecía con el contexto del screener en localStorage, que
  // este arnés (renderToStaticMarkup, sin effects) no puede simular. Por eso
  // el contrato tiene dos capas: lo que la ficha renderiza SIEMPRE (la
  // clasificación manual, por cualquier ruta de entrada) se aserta sobre el
  // HTML; que el veredicto del motor no pueda volver por la puerta del
  // contexto se aserta sobre el FUENTE de StockClient, porque una versión
  // resucitada volvería a estar oculta al render sin origin.
  const html = renderFicha();
  const testDir = dirname(fileURLToPath(import.meta.url));
  // Sin comentarios: la constancia de POR QUÉ se retiró la mesa vive en
  // comentarios que nombran lo retirado, y eso no debe disparar el guard.
  const source = readFileSync(resolve(testDir, "../app/stock/[symbol]/StockClient.jsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("la clasificación manual del inversor se renderiza sin contexto de origen (URL directa)", () => {
    expect(html).toContain("stockUserClassification");
    expect(html).toContain("Nota del inversor");
    for (const label of ["Reabrir", "Candidata", "Vigilar", "Descartar"]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("nada de la mesa queda en el HTML", () => {
    expect(html).not.toContain("stockDecisionDesk");
    expect(html).not.toContain("Observación:");
    expect(html).not.toContain("Coherencia gráfico");
    expect(html).not.toContain("Foco a observar");
    expect(html).not.toContain("Vista método");
    expect(html).not.toContain("Vista entrada");
  });

  it("el fuente de la ficha no reconstruye el veredicto del motor", () => {
    // El mecanismo exacto que resucitaba el veredicto (análisis del 15, A2):
    // imprimir readiness/decisionBrief/decisionTrace del contexto de origen.
    expect(source).not.toContain("buildStockDecisionDesk");
    expect(source).not.toMatch(/readiness\??\.label/);
    expect(source).not.toContain("decisionBrief");
    expect(source).not.toContain("screenerStockContextFromSession");
    // Estado interno de la aplicación como texto de usuario:
    expect(source).not.toContain("RS overlay");
    expect(source).not.toContain('"Apagado"');
  });

  it("el trío Validado/Pendiente/Bloquea se fue con la mesa", () => {
    expect(html).not.toContain(">Validado<");
    expect(html).not.toContain(">Bloquea<");
    expect(source).not.toContain("STOCK_DECISION_VALIDATION_STATES");
  });
});

describe("franja «Calidad de dato» y resumen de Setup retirados de N0 el 2026-08-22", () => {
  // Motivo: la franja era diagnóstico interno (cobertura, tamaño de muestra
  // del ranking) que el usuario no necesita para leer la ficha; el resumen
  // de Setup enumeraba condiciones que el detector no evalúa de forma
  // fiable (base = ventana fija del detector, contracciones sin integrar en
  // producción). La fecha de cierre —lo único que sí hacía falta— se quedó
  // junto al precio; el resto de la franja (Cobertura, RS·n=, Histórico) y
  // «Cotización» (antes solo visible si había desvío) viven en el desglose
  // auditable de N3 «Calidad de datos», que sigue existiendo para quien
  // quiera comprobarlo.
  const html = renderFicha();

  it("la franja «Calidad de dato» no se renderiza en N0", () => {
    expect(html).not.toContain("stockQualityStrip");
    expect(html).not.toContain("Calidad de dato<");
    expect(html).not.toContain("Cobertura alta");
  });

  it("el resumen de Setup no se renderiza en N0", () => {
    expect(html).not.toContain("stockVerdictSetup");
    expect(html).not.toContain(">Setup<");
    expect(html).not.toContain("condiciones · falta");
    expect(html).not.toContain("Setup sin checklist disponible");
  });

  it("la fecha de cierre sigue visible, discreta, junto al precio en N0", () => {
    const expectedDate = compactDate("2025-09-17");
    expect(expectedDate).not.toBe("");
    expect(html).toContain("stockVerdictQuoteDate");
    expect(html).toContain(expectedDate);
    // Sigue dentro de N0, no solo en el desglose colapsado de N3: debe
    // aparecer ANTES del primer cajón de auditoría.
    const dateIndex = html.indexOf("stockVerdictQuoteDate");
    const auditIndex = html.indexOf("Desglose del score");
    expect(dateIndex).toBeGreaterThan(-1);
    expect(dateIndex).toBeLessThan(auditIndex);
  });

  it("cobertura, RS·n= e histórico siguen auditables en el desglose de N3", () => {
    expect(html).toContain("Calidad de datos");
    expect(html).toContain("Cobertura");
    expect(html).toContain(">RS global<");
    expect(html).toContain(">Histórico<");
    expect(html).toContain(">Cotización<");
  });
});

describe("tarjeta de identidad del lienzo (variante 2c encogida)", () => {
  const html = renderFicha();

  it("se renderiza visible por defecto con TODO el contenido denso (cuarta iteración)", () => {
    expect(html).toContain("chartIdentityCard");
    // Fila de ticker + precio + nombre·mercado fusionados.
    expect(html).toContain("chartIdCardQuoteRow");
    expect(html).toContain(">RETIR<");
    expect(html).toContain("Ficha Retiradas Inc.");
    expect(html).toContain("· NYSE");
    // Resumen de negocio (el fixture no trae summary → ausencia declarada).
    expect(html).toContain("chartIdCardSummary");
    // Tema + rango (ausente con motivo) + capitalización.
    expect(html).toContain(">Technology<");
    expect(html).toContain("chartIdCardCap");
    expect(html).toContain("12,0B");
    // Raíl vertical de etapa: dígito + semana + tramos.
    expect(html).toContain("chartIdCardStageRail");
    expect(html).toContain("sem. 12");
    // RS y estructura.
    expect(html).toContain("chartIdCardRsValue");
    expect(html).toContain("Máx. 52s");
    // Crecimiento trimestral: en la tarjeta (densidad MarketSmith).
    expect(html).toContain("Crecimiento trimestral");
    // Pie de tres marcas: marca + atribuciones.
    expect(html).toContain("chartIdCardFoot");
    expect(html).toContain("StatsEdge");
    expect(html).toContain("Gráfico TradingView");
  });

  it("con la tarjeta visible no hay fila de head: los controles flotan sobre el lienzo", () => {
    // La fila del head era la banda muerta encima de la tarjeta (cuarta
    // iteración): con la tarjeta visible desaparece, y el badge de patrón +
    // botonera flotan arriba a la derecha del lienzo. Al plegar, el head
    // vuelve como fila con ticker/precio/RS.
    expect(html).not.toContain("universalChartHead");
    expect(html).toContain("universalChartFloatControls");
    expect(html).not.toContain('class="universalChartSymbol"');
    expect(html).not.toContain('class="universalChartBadges ');
  });

  it("las ausencias declaradas van como guion con motivo, no inventadas", () => {
    // base y rango de sector no tienen dato hoy: la tarjeta no pinta celdas
    // fantasma (STOCK-CARD-1). Otras ausencias reales siguen con motivo.
    expect(html).not.toContain("Sin medida de base");
    expect(html).not.toContain("Sin rango dentro del sector");
    expect(html).toContain("Sin serie trimestral suficiente");
  });

  it("nada se repite entre la tarjeta y la franja", () => {
    const count = (needle) => html.split(needle).length - 1;
    // Como DATO, la fuerza relativa vive solo en la tarjeta (la otra
    // aparición del texto es el checkbox del indicador en las preferencias
    // del gráfico — un control, no un dato).
    expect(count("RS</span>")).toBe(1);
    expect(count("Crecimiento trimestral")).toBe(1);
    expect(count("Máx. 52s")).toBe(1);
    expect(count('class="chartIdCardFoot"')).toBe(1);
    // La franja ya no pinta identidad, resumen, crecimiento ni pie propios.
    expect(html).not.toContain("stockDescIdentity");
    expect(html).not.toContain('class="stockDescGrowth"');
    expect(html).not.toContain('stockDescStructLabel">Base<');
    expect(html).not.toContain('class="stockDescFoot"');
    expect(html).not.toContain("stockDescRsValue");
    expect(html).not.toContain("stockDescStage");
  });

  it("el control de plegar vive en la botonera flotante, fuera de la tarjeta y de la captura", () => {
    // Cuarta iteración: la botonera ya no es una fila sobre el lienzo (esa
    // era la banda muerta) sino un grupo flotante que el CSS solo muestra al
    // pasar el ratón (o con foco) — una captura del área de dibujo sigue
    // saliendo sin controles. Aquí se aserta la estructura; la visibilidad
    // por hover es CSS y se verifica en navegador.
    const buttonIdx = html.indexOf('aria-label="Plegar tarjeta de identidad"');
    const floatIdx = html.indexOf("universalChartFloatControls");
    const cardIdx = html.indexOf('class="chartIdentityCard"');
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(floatIdx).toBeGreaterThan(-1);
    // El botón está dentro del grupo flotante, no dentro de la tarjeta.
    expect(buttonIdx).toBeGreaterThan(floatIdx);
    expect(buttonIdx).toBeLessThan(cardIdx);
    expect(html.slice(cardIdx)).not.toContain("Plegar tarjeta de identidad");
    expect(html.slice(cardIdx)).not.toContain("universalChartNavButton");
  });

  it("la franja queda en una banda: medias y volumen (reparto solo en Sostén)", () => {
    expect(html).not.toContain("stockDescNameRow");
    expect(html).toContain("stockDescStrip");
    expect(html).toContain("Media 50d");
    expect(html).not.toContain("Reparto vol. 50d");
  });

  it("N0 no muestra sector/exchange crudo: solo tema de producto si existe", () => {
    expect(html).not.toContain("stockIdentityKicker");
    expect(html).not.toMatch(/TECHNOLOGY|Technology · NYSE/);
  });
});

describe("READ-D kicker con tema", () => {
  it("muestra el tema StatsEdge en N0 cuando existe", () => {
    const html = renderFicha({ theme: "Software / IA" });
    expect(html).toContain('stockIdentityKicker">Software / IA<');
    expect(html).not.toMatch(/stockIdentityKicker[^<]*Technology/);
  });
});

describe("READ-D RS país en tarjeta", () => {
  it("oculta RS país en US cuando coincide con RS canónico", () => {
    const html = renderFicha({
      relativeStrength: {
        globalRsSeries: [{ date: "2025-09-17", rsRating: 94, sampleSize: 4868 }],
        countryRsRating: 94,
        countryRsSampleSize: 900,
      },
    });
    const cardStart = html.indexOf('class="chartIdCard"');
    const cardEnd = html.indexOf('class="chartIdCardFoot"', cardStart);
    const cardSlice = html.slice(cardStart, cardEnd);
    expect(cardSlice).not.toContain("RS país");
  });
});

describe("stockRsUniverse: RS de la ficha", () => {
  it("con serie legacy y rating pin, el RS sigue el pin y no la cola de la serie", () => {
    const rs = {
      rating: 64,
      globalRsSeries: Array.from({ length: 8 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
        rsRating: 70 + index,
        sampleSize: 500,
        engineVersion: "statsedge-global-rs-usd-v1",
      })),
    };
    expect(stockRsUniverse(rs)).toBe(64);
    expect(stockRsUniverse(rs)).not.toBe(rs.globalRsSeries.at(-1).rsRating);
    expect(buildChartIdentityCard({ symbol: "AAPL", data: stockData({ relativeStrength: rs }), rsUniverse: stockRsUniverse(rs) }).rs.value).toBe(64);
    expect(buildChartIdentityCard({ symbol: "AAPL", data: stockData({ relativeStrength: rs }), rsUniverse: stockRsUniverse(rs) }).rs.from).toBeNull();
  });

  it("sin pin, cae al último punto de la serie", () => {
    const rs = {
      globalRsSeries: [{ date: "2025-09-17", rsRating: 94, sampleSize: 4868 }],
    };
    expect(stockRsUniverse(rs)).toBe(94);
  });
});

describe("buildChartIdentityCard: modelo de la tarjeta 2c", () => {
  it("con datos completos compone identidad, etapa, RS, estructura y pie", () => {
    // El ticker no viaja en el modelo: la fila de precio de la tarjeta lo
    // pinta el contenedor con el header del propio chart. El tema y el
    // rango de sector volvieron a la franja al estrechar.
    const card = buildChartIdentityCard({ symbol: "full", data: stockData(), rsUniverse: 94 });
    expect(card.name).toBe("Ficha Retiradas Inc.");
    expect(card.exchange).toBe("NYSE");
    expect(card.theme).toBe("Technology");
    expect(card.capText).toContain("12,0B");
    expect(card.sectorRank).toBeNull();
    expect(card.sectorRankReason).toBe("");
    expect(card.stage.digit).toBe("2");
    expect(card.stage.week).toBe(12);
    expect(card.stage.qualifier).toBe("");
    expect(card.rs.value).toBe(94);
    expect(card.structure.distance52w).toBeCloseTo(-7.4);
    expect(card.structure.base).toBeNull();
    expect(card.structure.baseReason).toBe("");
    expect(card.growth.usable).toBeFalsy();
    expect(card.foot.provider).toBe("Yahoo Finance");
  });

  it("cada pieza ausente viaja como null con su motivo (principio 3)", () => {
    const card = buildChartIdentityCard({
      symbol: "EMPTY",
      data: { name: "Sin Datos SA", stage: {}, relativeStrength: {} },
      rsUniverse: null,
    });
    expect(card.stage.digit).toBe("");
    expect(card.stage.missingReason).toBeTruthy();
    expect(card.rs.value).toBeNull();
    expect(card.rs.absenceReason).toMatch(/Sin RS semanal/);
    expect(card.structure.distance52w).toBeNull();
  });

  it("sin data (o notFound) no hay tarjeta", () => {
    expect(buildChartIdentityCard({ symbol: "X", data: null, rsUniverse: 50 })).toBeNull();
    expect(buildChartIdentityCard({ symbol: "X", data: { notFound: true }, rsUniverse: 50 })).toBeNull();
  });
});
