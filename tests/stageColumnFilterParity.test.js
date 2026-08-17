// tests/stageColumnFilterParity.test.js — la columna y el filtro dicen lo mismo.
//
// El hallazgo central de docs/auditoria-etapas-2026-08-16.md (C-15): la tabla
// mostraba la etapa semanal y `requireStage2` comprobaba tres condiciones
// diarias que no miran la media de 30 semanas. Pedir "etapa 2" devolvía otra
// cosa: 53 filas pasaban sin llevar la etiqueta y 182 que la llevaban
// quedaban fuera.
//
// Este test renderiza la CELDA REAL de la tabla (lib/screenerColumns.jsx) y
// pasa la MISMA fila por el filtro REAL (lib/screenerFilters.js), y exige que
// coincidan. Si alguien vuelve a meter una condición ajena a la etapa en
// cualquiera de los dos lados, esto falla.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SCREENER_COLUMNS } from "@/lib/screenerColumns";
import { screenerFilterRejectReason } from "@/lib/screenerFilters";
import { weeklyStageForBars } from "@/lib/weeklyStage";

const stageColumn = SCREENER_COLUMNS.find((column) => column.key === "stage");

function renderStageCell(row) {
  return renderToStaticMarkup(stageColumn.cell(row, {}));
}

// Serie semanal sintética -> fila de screener, con el mismo camino que el
// escaneo: weeklyStageForBars decide, y la fila lleva lo que él escribe.
function rowFromCloses(closes, extra = {}) {
  const start = Date.UTC(2024, 0, 1);
  const bars = closes.map((close, index) => ({
    date: new Date(start + index * 7 * 86400000).toISOString().slice(0, 10),
    open: close, high: close, low: close, close, volume: 1_000_000,
  }));
  const stage = weeklyStageForBars(bars);
  return {
    symbol: "TEST",
    weeklyStageState: stage.state,
    weeklyStageConfirmation: stage.confirmation,
    weeklyStageLabel: stage.label,
    weeklySlowWeeks: stage.slowWeeks,
    ...extra,
  };
}

const CASES = [
  {
    name: "etapa 2 con estructura diaria rota",
    closes: Array.from({ length: 90 }, (_, i) => 50 + i),
    // Precio por debajo de su SMA50 diaria: el criterio ANTERIOR la habría
    // echado del filtro pese a estar en etapa 2.
    daily: { price: 100, sma50: 120, sma150: 95, sma200: 90, sma200Slope: 3 },
    stage: "stage2",
    enTabla: "Etapa 2",
  },
  {
    name: "etapa 4 con estructura diaria perfecta",
    closes: Array.from({ length: 90 }, (_, i) => 200 - i),
    // Medias diarias impecables: el criterio ANTERIOR la habría colado.
    daily: { price: 120, sma50: 110, sma150: 100, sma200: 90, sma200Slope: 5 },
    stage: "stage4",
    enTabla: "Etapa 4",
  },
  {
    name: "etapa 1 confirmada",
    closes: Array.from({ length: 90 }, (_, i) => (i < 45 ? 200 - i * 2 : 110)),
    daily: { price: 110, sma50: 108, sma150: 120, sma200: 130, sma200Slope: -4 },
    stage: "stage1",
    enTabla: "Etapa 1",
  },
  {
    name: "etapa 3 confirmada",
    closes: Array.from({ length: 90 }, (_, i) => (i < 45 ? 50 + i * 2 : 140)),
    daily: { price: 140, sma50: 138, sma150: 130, sma200: 120, sma200Slope: 4 },
    stage: "stage3",
    enTabla: "Etapa 3",
  },
];

describe("la columna Etapa y el filtro requireStage2 dicen lo mismo", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const row = rowFromCloses(testCase.closes, testCase.daily);
      expect(row.weeklyStageState).toBe(testCase.stage);

      const html = renderStageCell(row);
      expect(html).toContain(testCase.enTabla);

      const rejection = screenerFilterRejectReason(row, { requireStage2: true });
      const pasaElFiltro = !rejection;
      const laTablaDiceEtapa2 = html.includes("Etapa 2");
      expect(pasaElFiltro).toBe(laTablaDiceEtapa2);
    });
  }

  it("la marca de tentativa se pinta sin cambiar la palabra ni la etapa", () => {
    // Subida larga con desplome final: el precio pierde la media, la media
    // sigue subiendo. Es etapa 3 tentativa.
    const row = rowFromCloses(Array.from({ length: 90 }, (_, i) => (i < 84 ? 50 + i * 2 : 150)));
    expect(row.weeklyStageState).toBe("stage3");
    expect(row.weeklyStageConfirmation).toBe("tentative");
    const html = renderStageCell(row);
    expect(html).toContain("Etapa 3");
    expect(html).toContain("stageTagTentative");
    expect(html).toContain("tentativa");
  });

  it("una fila del criterio anterior sigue mostrando su palabra, marcada como tal", () => {
    // La retención conserva noches calculadas con la taxonomía vieja: hasta
    // que corra el próximo nocturno, esas filas no pueden quedarse en blanco.
    const html = renderStageCell({ weeklyStageState: "base", weeklyStageLabel: "Base / transicion" });
    expect(html).toContain("Base");
    expect(html).toContain("criterio anterior");
  });

  it("sin etapa, la celda declara la ausencia y el filtro rechaza", () => {
    const row = { symbol: "NADA", price: 120, sma50: 110, sma150: 100, sma200: 90, sma200Slope: 5 };
    expect(renderStageCell(row)).not.toContain("Etapa");
    expect(screenerFilterRejectReason(row, { requireStage2: true })).toBeTruthy();
  });
});
