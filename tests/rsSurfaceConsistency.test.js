// tests/rsSurfaceConsistency.test.js — el mismo símbolo, el mismo RS, en todas
// las pantallas.
//
// HISTORIA QUE ESTE TEST EXISTE PARA QUE NO SE REPITA
//
// Este patrón se cerró una vez y volvió por otra vía. En julio de 2026 la
// tabla y la ficha mostraban RS distintos porque mergeUniverseRelativeStrength
// leía el percentil del lote; se arregló en a8be2e1 SOLO para la ficha. En
// agosto de 2026 un evaluador externo encontró, en una sola sesión y con el
// mismo símbolo (MAR), cinco lecturas y cuatro valores:
//
//   Screener            RS "–"   (la fila nunca pasó por la hidratación)
//   Vista rápida        RS 88    (percentil del lote)
//   Panel de esa vista  RS "–"   (ranking semanal, no hidratado)
//   Ficha del valor     RS 66    (ranking semanal, sí leído)
//   Salud de mercado    RS 88    (percentil del lote)
//
// Su veredicto: mientras eso pase, la herramienta no sirve para decidir con
// dinero. Tenía razón.
//
// Los dos fallos eran distintos y hay que vigilar los dos:
//   (1) FUENTE — superficies que caían al percentil del lote (rsGlobalPct)
//       cuando no había ranking semanal, y lo enseñaban bajo la etiqueta "RS".
//   (2) HIDRATACIÓN — rutas que sirven filas sin adjuntarles el ranking
//       semanal, con lo que superficies correctas enseñaban ausencia para
//       símbolos que SÍ tienen RS.
//
// Un test que solo comprobara (1) habría pasado con el producto roto.

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import QuickReviewModal from "@/app/components/screener/QuickReviewModal";
import { mergeUniverseRelativeStrength } from "@/app/api/company-brief/route";
import { LeaderTape, PreviewCard, QuickPanel } from "@/app/screenerPanels";
import { attachWeeklyRs } from "@/lib/globalRs";
import { attachCachedMarketCap } from "@/lib/fundamentalsCache";
import { canonicalRs, canonicalRsSortValue, canonicalRsValue } from "@/lib/rsCanonical";
import { SCREENER_COLUMNS, stageWord } from "@/lib/screenerColumns";
import { stageWordForState } from "@/lib/stageDisplay";
import { CompactResultsTable } from "@/lib/screenerTable";

const ROOT = path.resolve(__dirname, "..");
const readSource = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

// El RS del ranking semanal (66) y el percentil del lote (88) son
// deliberadamente distintos y ambos "bonitos": si alguna superficie vuelve a
// caer al lote, el 88 aparecerá donde no debe y el test lo dirá.
const WEEKLY_RS = 66;
const BATCH_PCT = 88;

function rowFixture(overrides = {}) {
  return {
    symbol: "MAR",
    companyName: "Marriott International, Inc.",
    country: "US",
    exchange: "NasdaqGS",
    currency: "USD",
    price: 355.59,
    theme: "Consumo / marca",
    sector: "Consumer Cyclical",
    industry: "Lodging",
    // Ranking semanal del universo — la fuente.
    weeklyRsAvailable: true,
    weeklyRsRating: WEEKLY_RS,
    weeklyRsSampleSize: 4868,
    weeklyRsAsOf: "2026-08-09",
    weeklyRsWeekKey: "2026-W32",
    weeklyRsEngineVersion: "statsedge-us-equity-rs-v1",
    // Percentil del lote — sigue existiendo, alimenta el scoring, NO es el RS.
    rsGlobalPct: BATCH_PCT,
    rsGlobalSample: 50,
    rsRating: 51,
    rsQualityScore: BATCH_PCT,
    rsQualityLabel: "RS limpio",
    rsSectorPct: 59,
    weeklyStageState: "base",
    weeklyStageLabel: "Base / transicion",
    perf3m: 1.74,
    perf6m: 0.53,
    perf12m: 34.46,
    distance52w: -13.47,
    marketCap: 90102579200,
    objectiveScore: 52,
    totalScore: 53,
    chartPreview: [
      { date: "2026-08-10", close: 348.44, volume: 100 },
      { date: "2026-08-11", close: 349.49, volume: 120 },
      { date: "2026-08-12", close: 355.59, volume: 140 },
    ],
    ...overrides,
  };
}

// Fila del mismo símbolo SIN ranking semanal, pero con percentil de lote bien
// visible. Ninguna superficie puede enseñar ese percentil como RS.
function rowWithoutWeeklyRs() {
  return rowFixture({
    weeklyRsAvailable: false,
    weeklyRsRating: null,
    weeklyRsSampleSize: null,
    weeklyRsAsOf: null,
    weeklyRsReason: "no está en el ranking semanal",
  });
}

function renderTable(row) {
  return renderToStaticMarkup(React.createElement(CompactResultsTable, {
    rows: [row],
    favoriteSymbols: new Set(),
    onFavorite: () => {},
    onSelect: () => {},
  }));
}

function renderQuickReview(row) {
  return renderToStaticMarkup(React.createElement(QuickReviewModal, {
    activeModalRow: row,
    modalReviewRows: [row],
    closeQuickReview: () => {},
    moveQuickReview: () => {},
    selectQuickReview: () => {},
    saveQuickReviewStockOpen: () => {},
    reopenQuickReviewDecision: () => {},
    resolveQuickReviewDecision: () => {},
    updateChartScope: () => {},
    updateChartSettings: () => {},
  }));
}

function renderLeaderTape(row) {
  return renderToStaticMarkup(React.createElement(LeaderTape, {
    rows: [row],
    activeRow: row,
    onSelect: () => {},
    favoriteSymbols: new Set(),
  }));
}

function renderQuickPanel(row) {
  return renderToStaticMarkup(React.createElement(QuickPanel, { row, settings: {} }));
}

function renderPreviewCard(row) {
  return renderToStaticMarkup(React.createElement(PreviewCard, { variant: "grid", row }));
}

// Texto visible: quita atributos (title, aria-label…) para que un motivo de
// ausencia que MENCIONE el percentil no cuente como "enseñar el percentil".
function visibleText(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// La celda de RS de la tabla, aislada de las demás columnas: si buscáramos
// "66" en toda la fila, cualquier otro número podría enmascarar el fallo.
function tableRsCellText(row) {
  const column = SCREENER_COLUMNS.find((item) => item.key === "rs");
  return visibleText(renderToStaticMarkup(column.cell(row, {})));
}

describe("RS: una sola fuente en las cinco superficies", () => {
  it("con ranking semanal, todas enseñan el MISMO número y ninguna el percentil del lote", () => {
    const row = rowFixture();

    // 1. Tabla del screener.
    expect(tableRsCellText(row)).toBe(String(WEEKLY_RS));
    // 2 y 3. Vista rápida: cinta y panel de métricas del modal.
    expect(visibleText(renderLeaderTape(row))).toContain(String(WEEKLY_RS));
    expect(visibleText(renderQuickReview(row))).toContain(String(WEEKLY_RS));
    // 4. Ficha del valor (contrato del servidor que la alimenta).
    const brief = mergeUniverseRelativeStrength(
      { rating: row.rsRating, volatility63d: 27.5, maxDrawdown63d: 14.2 },
      { rsGlobalPct: row.rsGlobalPct, rsGlobalSample: row.rsGlobalSample },
      { latest: { date: row.weeklyRsAsOf, rsRating: WEEKLY_RS, sampleSize: 4868 }, series: [] },
    );
    expect(brief.rating).toBe(WEEKLY_RS);
    expect(brief.ratingSource).toBe("weekly-universe");
    // 5. Salud de mercado y el resto usan el mismo lector.
    expect(canonicalRsValue(row)).toBe(WEEKLY_RS);

    // Y el percentil del lote no se cuela en ninguna celda de RS.
    expect(tableRsCellText(row)).not.toContain(String(BATCH_PCT));
    expect(brief.rating).not.toBe(BATCH_PCT);
  });

  it("sin ranking semanal, todas enseñan AUSENCIA — nunca el percentil del lote", () => {
    const row = rowWithoutWeeklyRs();

    expect(canonicalRs(row).available).toBe(false);
    expect(tableRsCellText(row)).not.toContain(String(BATCH_PCT));
    expect(tableRsCellText(row)).toContain("–");

    // La ficha tampoco: el respaldo a scan_results se eliminó.
    const brief = mergeUniverseRelativeStrength(
      { rating: 51 },
      { rsGlobalPct: BATCH_PCT, rsGlobalSample: 50 },
      null,
    );
    expect(brief.rating).toBe(null);
    expect(brief.ratingSource).toBe("weekly-missing");
    // El percentil del lote no desaparece: conserva su nombre propio.
    expect(brief.rsGlobalPct).toBe(BATCH_PCT);
    // Y su calidad derivada tampoco se enseña como si fuera la del RS.
    expect(brief.rsQualityScore).toBe(null);

    // Ninguna superficie de la vista rápida enseña el percentil del lote bajo
    // una etiqueta que empiece por "RS". Los paneles de auditoría SÍ lo
    // enseñan —es la entrada real del score y ocultarlo sería peor— pero con
    // su nombre propio ("Percentil lote", "Calidad lote"), que es justo lo que
    // esta comprobación exige: ningún segundo número llamado RS.
    const rsLabelledBatch = new RegExp(`RS[^\\d]{0,15}${BATCH_PCT}`);
    for (const html of [renderLeaderTape(row), renderQuickReview(row), renderQuickPanel(row), renderPreviewCard(row)]) {
      expect(visibleText(html)).not.toMatch(rsLabelledBatch);
    }
  });

  it("una fila sin hidratar dice que NO está hidratada, no que el símbolo no tenga RS", () => {
    // Son dos cosas distintas y confundirlas es lo que hizo que el screener
    // afirmara "sin RS semanal" para un símbolo con RS 66 en la ficha.
    const { weeklyRsAvailable, weeklyRsRating, ...noHydration } = rowFixture();
    const state = canonicalRs(noHydration);

    expect(state.available).toBe(false);
    expect(state.hydrated).toBe(false);
    expect(state.reason).toMatch(/no trae cargado el ranking semanal/i);
    expect(canonicalRs(rowWithoutWeeklyRs()).hydrated).toBe(true);
  });

  it("la ordenación de la columna RS usa el mismo número que la celda", () => {
    // Ordenar por un número que la celda no enseña es la misma incoherencia
    // por otra vía: dos filas con "–" salían ordenadas por su percentil de
    // lote y el usuario no podía explicar el orden.
    expect(canonicalRsSortValue(rowFixture())).toBe(WEEKLY_RS);
    expect(canonicalRsSortValue(rowWithoutWeeklyRs())).toBeLessThan(0);
  });

  it("el lector encuentra el RS venga la fila plana, bajo snapshot, metrics o raw", () => {
    // Las filas llegan por cuatro caminos distintos (scan en vivo, favoritos
    // rehidratados, proyección de scan_results, cache materializada). Si el
    // lector solo mirara el nivel plano, una superficie volvería a enseñar
    // ausencia con el dato delante.
    const flat = { weeklyRsAvailable: true, weeklyRsRating: WEEKLY_RS };
    expect(canonicalRsValue({ snapshot: flat })).toBe(WEEKLY_RS);
    expect(canonicalRsValue({ metrics: flat })).toBe(WEEKLY_RS);
    expect(canonicalRsValue({ raw: flat })).toBe(WEEKLY_RS);
  });
});

describe("RS: hidratación en TODAS las rutas que producen filas", () => {
  // El fallo de agosto de 2026 no fue de lectura: /api/scans hidrataba y
  // /api/scan (polling del escaneo en vivo) y /api/leaderboards no. La tabla
  // enseñaba "–" con el dato disponible en la base.
  const ROUTES = [
    ["app/api/scans/route.js", "snapshots guardados"],
    ["app/api/scan/route.js", "polling del escaneo en vivo"],
    ["app/api/leaderboards/route.js", "previsualización cacheada del screener"],
  ];

  for (const [file, what] of ROUTES) {
    it(`${file} (${what}) adjunta el ranking semanal a las filas que sirve`, () => {
      const source = readSource(file);
      expect(source).toMatch(/attachWeeklyRs|hydrateRowsWithWeeklyRs/);
    });
  }

  it("la búsqueda del screener, que arma la fila en cliente, también pide el ranking", () => {
    // Cuarta ruta y la más fácil de olvidar: loadSearchResult no pasa por
    // ninguna route de scans, construye la fila con /api/chart + /api/profile.
    const source = readSource("app/page.jsx");
    expect(source).toMatch(/api\/rs-weekly\?symbol=/);
    expect(source).toMatch(/weeklyRsAvailable: true/);
  });

  it("attachWeeklyRs marca explícitamente los tres estados posibles", () => {
    const bySymbol = new Map([
      ["MAR", { available: true, rsRating: WEEKLY_RS, sampleSize: 4868, asOf: "2026-08-09" }],
      ["NORS", { available: false, reason: "no está en el ranking semanal" }],
    ]);

    expect(canonicalRs(attachWeeklyRs({ symbol: "MAR" }, bySymbol)).value).toBe(WEEKLY_RS);

    const notRanked = canonicalRs(attachWeeklyRs({ symbol: "NORS" }, bySymbol));
    expect(notRanked.available).toBe(false);
    expect(notRanked.hydrated).toBe(true);

    // Símbolo que el lote no devolvió: hidratado y no disponible, no "sin
    // hidratar" — la ruta sí lo consultó.
    const absent = canonicalRs(attachWeeklyRs({ symbol: "OTHER" }, bySymbol));
    expect(absent.available).toBe(false);
    expect(absent.hydrated).toBe(true);
  });
});

describe("RS: ninguna superficie de display vuelve a leer el percentil del lote", () => {
  // Guardia de código, no de render. Los tests de arriba comprueban lo que se
  // ve con UNA fila; este impide que un cambio futuro reintroduzca la lectura
  // en una rama que ninguna fila de prueba recorra.
  const DISPLAY_SURFACES = [
    "lib/screenerColumns.jsx",
    "lib/screenerMarket.jsx",
    "app/components/screener/QuickReviewModal.jsx",
    "app/market-health/page.jsx",
    "app/sectors/page.jsx",
    "lib/grouping.js",
    "lib/screenerFiltersView.jsx",
    "lib/screenerResultView.js",
  ];

  for (const file of DISPLAY_SURFACES) {
    it(`${file} lee el RS por lib/rsCanonical.js y no por rsGlobalPct`, () => {
      const code = readSource(file)
        // Los comentarios explican precisamente por qué NO se usa rsGlobalPct.
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      expect(code).toMatch(/from "@\/lib\/rsCanonical"/);
      // Leer el valor del percentil del lote para pintarlo.
      expect(code).not.toMatch(/\brsUniverseValue\s*\(/);
      expect(code).not.toMatch(/\browRsPrimary\s*\(/);
      expect(code).not.toMatch(/row\??\.rsGlobalPct/);
      // Releer weeklyRs* a mano en vez de pasar por el lector único: es como
      // volvieron a divergir la tabla y el panel de la vista rápida.
      expect(code).not.toMatch(/weeklyRsAvailable\s*===/);
    });
  }

  it("el lector único no tiene respaldo al percentil del lote", () => {
    const code = readSource("lib/rsCanonical.js").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/rsGlobalPct/);
    expect(code).not.toMatch(/rsRating[^:]/);
  });

  it("la ficha del valor no cae al percentil del lote", () => {
    const code = readSource("app/stock/[symbol]/StockClient.jsx").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/rs\.rsGlobalPct/);
  });
});

describe("Etapa y capitalización: la misma clasificación se escribe igual y el mismo número se lee del mismo sitio", () => {
  it("tabla y ficha escriben la MISMA palabra para la misma clasificación", () => {
    // Antes: la tabla decía "Base" y la ficha "Base / transición" para el
    // mismo `state`. Dos textos para el mismo estado se leen como dos datos.
    const row = rowFixture();
    const tabla = stageWord(row);
    const ficha = stageWordForState(row.weeklyStageState, row.weeklyStageLabel);

    expect(tabla).not.toBe(null);
    expect(ficha.word).toBe(tabla.word);
    expect(stageWordForState("stage2", "Stage 2 probable").word).toBe("Etapa 2");
    expect(stageWordForState("insufficient_history", "")).toBe(null);
  });

  it("la etapa se escribe en un solo sitio: la tabla no tiene su propio diccionario", () => {
    const code = readSource("lib/screenerColumns.jsx");
    expect(code).toMatch(/from "@\/lib\/stageDisplay"/);
    expect(code).not.toMatch(/stage2:\s*\{\s*word:/);
  });

  it("la capitalización del screener se rehidrata desde la tabla que lee la ficha", () => {
    // La ficha lee fundamental_snapshots en vivo; el screener enseñaba la
    // copia congelada del escaneo. 95,2 B contra 90,1 B para el mismo símbolo
    // en la misma sesión.
    const frozen = rowFixture({ marketCap: 95_200_000_000 });
    const caps = new Map([["MAR", { marketCap: 90_102_579_200, updatedAt: "2026-08-10T17:32:54Z" }]]);
    const rehydrated = attachCachedMarketCap(frozen, caps);

    expect(rehydrated.marketCap).toBe(90_102_579_200);
    expect(rehydrated.marketCapSource).toBe("fundamental_snapshots");
    // Sin entrada en la caché la fila no se toca: fail-open, nunca se inventa.
    expect(attachCachedMarketCap(frozen, new Map()).marketCap).toBe(95_200_000_000);
  });

  it("las rutas que sirven filas al screener rehidratan la capitalización", () => {
    for (const file of ["app/api/scans/route.js", "app/api/leaderboards/route.js"]) {
      expect(readSource(file)).toMatch(/attachCachedMarketCap/);
    }
  });
});
