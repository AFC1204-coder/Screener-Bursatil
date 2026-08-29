// tests/screenerColumnLegends.test.js — UX-23: InfoHint solo en cabeceras no obvias.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactResultsTable } from "@/lib/screenerTable";
import {
  SCREENER_COLUMNS,
  screenerVisibleColumns,
} from "@/lib/screenerColumns";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";
import { canonicalRsDisclosure } from "@/lib/rsEngines";

const NO_LEGEND_KEYS = ["ticker", "performance", "distance52w", "marketCap"];
const LEGEND_KEYS = ["theme", "rs", "stage"];

function columnByKey(key, columns = SCREENER_COLUMNS) {
  return columns.find((column) => column.key === key);
}

function renderTableHead(props = {}) {
  return renderToStaticMarkup(React.createElement(CompactResultsTable, {
    rows: [{
      symbol: "TREN",
      companyName: "Trend Systems Inc",
      country: "US",
      theme: "Semis",
      weeklyRsAvailable: true,
      weeklyRsRating: 92,
      weeklyStageState: "stage2",
      perf3m: 18.4,
      distance52w: -3.2,
      marketCap: 4200000000,
      chartPreview: [{ close: 1 }, { close: 2 }],
    }],
    favoriteSymbols: new Set(),
    onFavorite: () => {},
    onReview: () => {},
    onOpenStock: () => {},
    perfPeriod: DEFAULT_PERFORMANCE_PERIOD,
    onPerfPeriod: () => {},
    sort: "",
    setupMode: "",
    ...props,
  }));
}

function countTheadInfoHints(html) {
  const thead = html.match(/<thead[\s\S]*?<\/thead>/)?.[0] || "";
  return (thead.match(/class="infoHint/g) || []).length;
}

describe("UX-23: leyendas de cabecera en SCREENER_COLUMNS", () => {
  it("columnas obvias no llevan legend", () => {
    for (const key of NO_LEGEND_KEYS) {
      const column = columnByKey(key);
      expect(column?.legend).toBeFalsy();
    }
  });

  it("columnas no obvias conservan legend no vacío", () => {
    for (const key of LEGEND_KEYS) {
      const column = columnByKey(key);
      expect(column?.legend).toBeTruthy();
      expect(String(column.legend).length).toBeGreaterThan(0);
    }
  });

  it("rs incluye la declaración canónica MET-1", () => {
    expect(columnByKey("rs").legend).toContain(canonicalRsDisclosure());
  });

  it("weakness conserva legend cuando la columna es visible", () => {
    const weakness = columnByKey("weakness", screenerVisibleColumns({ setupMode: "weakness" }));
    expect(weakness?.legend).toBeTruthy();
    expect(String(weakness.legend)).toContain("0 a 100");
  });

  it("columnas sin legend conservan title para accesibilidad", () => {
    for (const key of NO_LEGEND_KEYS) {
      const column = columnByKey(key);
      expect(column?.title).toBeTruthy();
    }
  });
});

describe("UX-23: cabecera de escritorio sin ruido de InfoHint", () => {
  it("pinta como máximo tres InfoHint en thead por defecto (tema, RS, etapa)", () => {
    const html = renderTableHead();
    expect(countTheadInfoHints(html)).toBe(3);
  });

  it("añade un cuarto InfoHint en thead cuando Deterioro es visible", () => {
    const html = renderTableHead({ setupMode: "weakness" });
    expect(countTheadInfoHints(html)).toBe(4);
  });

  it("no pinta InfoHint en ticker, rendimiento, distancia ni capitalización", () => {
    const html = renderTableHead();
    for (const className of ["colTicker", "colPerformance", "colDistance", "colCap"]) {
      const cell = html.match(new RegExp(`<th class="${className}"[\\s\\S]*?</th>`))?.[0] || "";
      expect(cell).not.toMatch(/class="infoHint/);
    }
  });
});
