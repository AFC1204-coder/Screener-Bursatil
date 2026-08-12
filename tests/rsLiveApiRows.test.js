// tests/rsLiveApiRows.test.js — las filas REALES que /api/scans sirvió hoy en
// la sesión del navegador, pasadas por los componentes REALES de cada
// superficie.
//
// Es el complemento de tests/rsSurfaceConsistency.test.js: aquel usa un
// fixture inventado y comprueba el contrato; este usa el JSON literal que la
// API devolvió (capturado el 13-08-2026 desde la sesión autenticada) y
// comprueba que lo que se pinta con datos de verdad son los mismos números.
//
// El fixture se congela a propósito: si el ranking semanal cambia en
// producción, este test NO debe empezar a fallar. Lo que fija es la relación
// entre lo que la API entrega y lo que cada superficie enseña.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import QuickReviewModal from "@/app/components/screener/QuickReviewModal";
import { LeaderTape, QuickPanel } from "@/app/screenerPanels";
import { canonicalRs } from "@/lib/rsCanonical";
import { SCREENER_COLUMNS } from "@/lib/screenerColumns";
import { stageWordForState } from "@/lib/stageDisplay";
import { cap } from "@/lib/formatters";

// Capturado con:
//   fetch('/api/scans?includeRows=1&limit=10&rowsLimit=2000')
// en la sesión real, tras la unificación. Recortado a los campos que las
// superficies leen.
const API_ROWS = [
  {
    symbol: "MAR",
    companyName: "Marriott International, Inc.",
    country: "US",
    exchange: "NasdaqGS",
    currency: "USD",
    price: 355.5899963378906,
    theme: "Consumo / marca",
    sector: "Consumer Cyclical",
    industry: "Lodging",
    weeklyRsAvailable: true,
    weeklyRsRating: 66,
    weeklyRsSampleSize: 4868,
    weeklyRsAsOf: "2026-08-09",
    weeklyRsWeekKey: "2026-W32",
    weeklyRsEngineVersion: "statsedge-us-equity-rs-v1",
    weeklyRsReason: null,
    // Los tres números que ANTES se enseñaban como "RS" en distintas pantallas.
    rsGlobalPct: 60,
    rsRating: 42,
    rsQualityScore: 59.84,
    rsQualityLabel: "RS debil",
    rsSectorPct: 65,
    rsCountryPct: 57,
    weeklyStageState: "base",
    weeklyStageLabel: "Base / transicion",
    perf3m: 1.742452686855711,
    perf6m: 0.5351706957762659,
    perf12m: 34.46881578768188,
    distance52w: -13.47754469019179,
    marketCap: 90102579200,
    objectiveScore: 55.61788121190682,
    totalScore: 53.453948265060646,
    volumeEffectScore: 35,
    relativeVolume: 0.15257027997669656,
    chartPreview: [
      { date: "2026-08-10", close: 348.44, volume: 1716600 },
      { date: "2026-08-11", close: 349.49, volume: 2390400 },
      { date: "2026-08-12", close: 355.59, volume: 391832 },
    ],
  },
  {
    symbol: "AAPL",
    companyName: "Apple Inc.",
    country: "US",
    exchange: "NasdaqGS",
    currency: "USD",
    price: 302.05999755859375,
    theme: "Consumer tech / hardware",
    sector: "Technology",
    industry: "Consumer Electronics",
    weeklyRsAvailable: true,
    weeklyRsRating: 70,
    weeklyRsSampleSize: 4868,
    weeklyRsAsOf: "2026-08-09",
    weeklyRsWeekKey: "2026-W32",
    weeklyRsEngineVersion: "statsedge-us-equity-rs-v1",
    weeklyRsReason: null,
    rsGlobalPct: 65,
    rsRating: 53,
    rsQualityScore: 65.26,
    rsQualityLabel: "RS debil",
    rsSectorPct: 65,
    rsCountryPct: 62,
    weeklyStageState: "base",
    weeklyStageLabel: "Base / transicion",
    perf3m: 2.55105793995285,
    perf6m: 9.836318074389826,
    perf12m: 29.934344305529635,
    distance52w: -12.337118397430846,
    marketCap: 4572794322944,
    objectiveScore: 62.6652576556119,
    totalScore: 59.08381020992643,
    volumeEffectScore: 44,
    relativeVolume: 0.3519492201359634,
    chartPreview: [
      { date: "2026-08-10", close: 308.26, volume: 44812500 },
      { date: "2026-08-11", close: 304.91, volume: 37401700 },
      { date: "2026-08-12", close: 302.06, volume: 19138171 },
    ],
  },
];

// Lo que la ficha /stock/[symbol] enseñó en el navegador para esas mismas dos
// acciones, en la misma sesión y el mismo día.
const FICHA = {
  MAR: { rs: 66, etapa: "Base", cap: "90.1B" },
  AAPL: { rs: 70, etapa: "Base", cap: "4.57T" },
};

const visibleText = (html = "") => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function cellText(key, row, ctx = {}) {
  const column = SCREENER_COLUMNS.find((item) => item.key === key);
  return visibleText(renderToStaticMarkup(column.cell(row, ctx)));
}

function quickReviewHtml(row) {
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

describe("filas reales de /api/scans: el mismo número en todas las superficies", () => {
  for (const row of API_ROWS) {
    const esperado = FICHA[row.symbol];

    it(`${row.symbol}: RS ${esperado.rs} en tabla, cinta, panel de vista rápida y ficha`, () => {
      // La API entrega los dos números; solo uno puede llamarse RS.
      expect(row.weeklyRsRating).toBe(esperado.rs);
      expect(row.rsGlobalPct).not.toBe(esperado.rs);

      // 1. Tabla del screener.
      expect(cellText("rs", row)).toBe(String(esperado.rs));
      // 2. Cinta de líderes de la vista rápida.
      expect(visibleText(renderToStaticMarkup(
        React.createElement(LeaderTape, { rows: [row], activeRow: row, onSelect: () => {}, favoriteSymbols: new Set() }),
      ))).toContain(String(esperado.rs));
      // 3. Panel de métricas del modal de vista rápida.
      expect(visibleText(quickReviewHtml(row))).toContain(String(esperado.rs));
      // 4. Panel rápido.
      expect(visibleText(renderToStaticMarkup(
        React.createElement(QuickPanel, { row, settings: {} }),
      ))).toContain(String(esperado.rs));
      // 5. Lector compartido (salud de mercado, sectores, agrupaciones).
      expect(canonicalRs(row).value).toBe(esperado.rs);
    });

    it(`${row.symbol}: ninguna superficie enseña el percentil del lote bajo la etiqueta RS`, () => {
      const batch = new RegExp(`RS[^\\d]{0,15}(${row.rsGlobalPct}|${row.rsRating}|${Math.round(row.rsQualityScore)})\\b`);
      expect(cellText("rs", row)).not.toContain(String(row.rsGlobalPct));
      for (const html of [quickReviewHtml(row)]) {
        expect(visibleText(html)).not.toMatch(batch);
      }
    });

    it(`${row.symbol}: etapa y capitalización coinciden con la ficha`, () => {
      expect(cellText("stage", row)).toBe(esperado.etapa);
      expect(stageWordForState(row.weeklyStageState, row.weeklyStageLabel).word).toBe(esperado.etapa);
      // La ficha imprime la capitalización con el mismo formateador.
      expect(cap(row.marketCap)).toBe(esperado.cap);
      expect(cellText("marketCap", row)).toBe(esperado.cap);
    });
  }
});
