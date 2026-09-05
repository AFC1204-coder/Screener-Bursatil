// tests/screenerSevenColumns.test.js — contrato de la tabla de resultados.
// docs/principios-producto.md, principio 7 + READ-A: parrilla base sin RS tema;
// RS país solo si la mesa no es US-only.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactResultsTable } from "@/lib/screenerTable";
import { MobileResultRow } from "@/lib/screenerMobile";
import {
  PERFORMANCE_PERIODS,
  RS_THEME_COLUMN,
  SCREENER_COLUMNS,
  screenerShowsCountryRsColumn,
  screenerShowsWeaknessColumn,
  screenerSortOptions,
  screenerVisibleColumns,
  stageWord,
} from "@/lib/screenerColumns";
import { DEFAULT_PERFORMANCE_PERIOD } from "@/lib/screenerPeriods";

const fullRow = {
  symbol: "TREN",
  companyName: "Trend Systems Inc",
  country: "US",
  exchange: "NASDAQ",
  currency: "USD",
  price: 84.2,
  theme: "Semis / fotonica",
  sector: "Technology",
  industry: "Semiconductors",
  weeklyRsAvailable: true,
  weeklyRsRating: 92,
  weeklyCountryRsAvailable: true,
  weeklyCountryRsRating: 55,
  weeklyThemeRsAvailable: true,
  weeklyThemeRsRating: 84,
  weeklyStageState: "stage2",
  weeklyStageLabel: "Stage 2 probable",
  perf3m: 18.4,
  perf6m: 33.2,
  perf12m: 51.9,
  distance52w: -3.2,
  marketCap: 4200000000,
  chartPreview: [
    { date: "2026-08-05", close: 70, volume: 100 },
    { date: "2026-08-06", close: 78, volume: 120 },
    { date: "2026-08-07", close: 84.2, volume: 140 },
  ],
  // Datos que YA NO se muestran en la tabla, pero siguen en la fila.
  minerviniScore: 82,
  weinsteinScore: 86,
  rsQualityScore: 78,
  rsSectorPct: 71,
  weaknessScore: 12,
  weaknessLabel: "Sin deterioro claro",
  sma50: 76.4,
  objectiveScore: 88,
  contractionCount: 2,
  vcpCandidate: true,
  distanceToPivotPct: -2,
};

const emptyRow = {
  symbol: "VOID",
  companyName: "Void Data Corp",
  country: "US",
  theme: "",
  weeklyRsAvailable: false,
  weeklyRsRating: null,
  weeklyStageState: "insufficient_history",
  perf3m: null,
  perf6m: null,
  perf12m: null,
  distance52w: null,
  marketCap: null,
  chartPreview: [],
};

function renderTable(props = {}) {
  return renderToStaticMarkup(React.createElement(CompactResultsTable, {
    rows: [fullRow],
    favoriteSymbols: new Set(),
    onFavorite: () => {},
    onReview: () => {},
    onOpenStock: () => {},
    perfPeriod: DEFAULT_PERFORMANCE_PERIOD,
    onPerfPeriod: () => {},
    sort: "",
    setupMode: "",
    scannedMarkets: ["US"],
    ...props,
  }));
}

describe("tabla de resultados: parrilla READ-A", () => {
  it("define nueve columnas base en un solo sitio (sin RS tema)", () => {
    expect(SCREENER_COLUMNS).toHaveLength(9);
    expect(SCREENER_COLUMNS.map((column) => column.key)).toEqual([
      "ticker", "theme", "rs", "rsCountry", "stage", "vcp", "performance", "distance52w", "marketCap",
    ]);
    expect(RS_THEME_COLUMN.key).toBe("rsTheme");
    expect(SCREENER_COLUMNS.some((column) => column.key === "rsTheme")).toBe(false);
  });

  it("mesa US-only: ocho columnas visibles sin RS país ni RS tema", () => {
    const html = renderTable({ scannedMarkets: ["US"] });
    expect(html.match(/<th /g)).toHaveLength(8);
    expect(html.match(/<td /g)).toHaveLength(8);
    expect(html).not.toContain(">RS país<");
    expect(html).not.toContain(">RS tema<");
  });

  it("mesa mixta: nueve columnas con RS país y sin RS tema", () => {
    const html = renderTable({ scannedMarkets: ["US", "HK"] });
    expect(html.match(/<th /g)).toHaveLength(9);
    expect(html).toContain(">RS país<");
    expect(html).not.toContain(">RS tema<");
    expect(html).toContain(">55<");
  });

  it("muestra los datos de la fila en mesa US", () => {
    const html = renderTable({ scannedMarkets: ["US"] });
    expect(html).toContain(">TREN<");
    expect(html).toContain("miniSparkline");
    expect(html).toContain("Semis / fotonica");
    expect(html).toContain(">92<");
    expect(html).not.toContain(">84<"); // RS tema fuera de mesa
    expect(html).toContain("Etapa 2");
    expect(html).toContain("+18,4%");
    expect(html).toContain("-3,2%");
    expect(html).toContain("4,2B");
  });

  it("llama Tema al grupo temático, no sector", () => {
    const html = renderTable();
    expect(html).toContain(">Tema<");
    expect(html).not.toContain(">Sector<");
  });

  it("no muestra veredicto ni maquinaria de fiabilidad en la fila", () => {
    const html = renderTable();
    for (const marker of [
      "rowTrustBadge", "decisionIssueBadge", "dataHealthBadge", "scoreAuditMini",
      "objectiveMetricTruthPill", "reviewFocusPill", "vcpReliabilityPill",
      "Revisar datos", "Vigilancia", "Auditar", "Candidato largo",
    ]) {
      expect(html).not.toContain(marker);
    }
  });

  it("no muestra los scores que se mudaron a la ficha del valor", () => {
    const html = renderTable();
    expect(html).not.toContain(">82<");
    expect(html).not.toContain(">86<");
    expect(html).not.toContain(">78<");
    expect(html).not.toContain(">71<");
    expect(html).not.toContain("SMA50");
    expect(html).not.toContain("Deterioro");
  });

  it("deja RS global y lo explica en la cabecera; RS tema fuera de mesa", () => {
    const html = renderTable({ scannedMarkets: ["US", "HK"] });
    expect(html.match(/>RS</g)).toHaveLength(1);
    expect(html).toContain(">RS país<");
    expect(html).not.toContain(">RS tema<");
    expect(html).toContain("Fuerza relativa semanal");
    expect(html).toContain("universo privado curado");
    expect(html).not.toContain(">Grp<");
    expect(html).not.toContain(">Q<");
  });

  it("no recorta los porcentajes con puntos suspensivos", () => {
    const html = renderTable();
    expect(html).toContain('class="cellNumber up">+18,4%</b>');
    expect(html).not.toContain("…");
  });
});

describe("RS país condicional a mercados en mesa", () => {
  it("oculta RS país en mesa US-only o sin mesa cargada", () => {
    expect(screenerShowsCountryRsColumn({ scannedMarkets: ["US"] })).toBe(false);
    expect(screenerShowsCountryRsColumn({ scannedMarkets: [] })).toBe(false);
    expect(screenerVisibleColumns({ scannedMarkets: ["US"] }).map((c) => c.key))
      .not.toContain("rsCountry");
  });

  it("muestra RS país cuando hay otros mercados en mesa", () => {
    expect(screenerShowsCountryRsColumn({ scannedMarkets: ["US", "HK"] })).toBe(true);
    expect(screenerVisibleColumns({ scannedMarkets: ["HK"] }).map((c) => c.key))
      .toContain("rsCountry");
  });
});

describe("dato ausente", () => {
  it("muestra un guion con el motivo, sin etiquetas de estado", () => {
    const html = renderTable({ rows: [emptyRow], scannedMarkets: ["US"] });
    expect(html.match(/class="cellMissing"/g)).toHaveLength(8);
    expect(html).toContain("Sin miniatura");
    expect(html).toContain("Sin RS semanal");
    expect(html).toContain("Histórico semanal insuficiente para clasificar la etapa");
    expect(html).toContain("Sin histórico suficiente para calcular el rendimiento a 3 meses");
    expect(html).toContain("Sin máximo de 52 semanas");
    expect(html).toContain("El proveedor no publica capitalización");
    expect(html).toContain("no se puede agrupar por tema");
    expect(html).toContain("infoHint");
  });

  it("trata como ausente el dato que la auditoría no puede verificar", () => {
    const html = renderTable({
      scannedMarkets: ["US"],
      rows: [{
        ...fullRow,
        objectiveMetricAudit: {
          status: "bad",
          items: [{ key: "perf3m", label: "Perf 3M", status: "mismatch", severity: "bad", proxy: false }],
          issues: [{ key: "perf3m", label: "Perf 3M", status: "mismatch", severity: "bad" }],
        },
      }],
    });
    expect(html).not.toContain("+18,4%");
    expect(html).toContain("no coincide con el recalculado sobre la serie de precios");
  });
});

describe("selector global de periodo", () => {
  it("ofrece tres periodos y marca el activo", () => {
    const html = renderTable({ perfPeriod: "perf6m" });
    expect(PERFORMANCE_PERIODS).toHaveLength(3);
    expect(html).toContain("chartSegmented");
    expect(html).toContain('aria-label="Periodo de rendimiento"');
    expect(html).toContain('class="active" aria-pressed="true" title="Rendimiento a 6 meses');
  });

  it("cambia la cabecera y el valor de la columna de rendimiento", () => {
    expect(renderTable({ perfPeriod: "perf3m" })).toContain("Rend. 3M");
    expect(renderTable({ perfPeriod: "perf3m" })).toContain("+18,4%");
    expect(renderTable({ perfPeriod: "perf6m" })).toContain("Rend. 6M");
    expect(renderTable({ perfPeriod: "perf6m" })).toContain("+33,2%");
    expect(renderTable({ perfPeriod: "perf12m" })).toContain("Rend. 12M");
    expect(renderTable({ perfPeriod: "perf12m" })).toContain("+51,9%");
  });

  it("es global: una sola vez por tabla, no uno por fila", () => {
    const html = renderTable({ rows: [fullRow, { ...fullRow, symbol: "OTRA" }] });
    expect(html.match(/screenerPeriodPicker/g)).toHaveLength(1);
  });

  it("el orden sigue al periodo elegido (mesa US: sin RS país ni RS tema)", () => {
    expect(screenerSortOptions({ perfPeriod: "perf6m", scannedMarkets: ["US"] }).map((item) => item.value))
      .toEqual(["rsGlobalPct", "contractionCount", "perf6m", "distance52w", "marketCap"]);
    expect(screenerSortOptions({ perfPeriod: "perf12m", scannedMarkets: ["US"] })[2])
      .toEqual({ value: "perf12m", label: "Rendimiento 12M" });
  });

  it("incluye RS país en orden cuando la mesa no es US-only", () => {
    const values = screenerSortOptions({ scannedMarkets: ["US", "HK"] }).map((item) => item.value);
    expect(values).toContain("weeklyCountryRsRating");
    expect(values).not.toContain("weeklyThemeRsRating");
  });

  it("solo deja ordenar por columnas visibles", () => {
    const values = screenerSortOptions({ scannedMarkets: ["US"] }).map((item) => item.value);
    expect(values).not.toContain("objectiveScore");
    expect(values).not.toContain("weaknessScore");
    expect(values).not.toContain("decisionPriority");
    expect(values).not.toContain("weeklyThemeRsRating");
    expect(values).not.toContain("weeklyCountryRsRating");
  });
});

describe("columna Deterioro (modo weakness / orden weaknessScore)", () => {
  it("muestra la columna cuando el modo es weakness o el orden es weaknessScore", () => {
    expect(screenerShowsWeaknessColumn({ setupMode: "weakness" })).toBe(true);
    expect(screenerShowsWeaknessColumn({ sort: "weaknessScore" })).toBe(true);
    expect(screenerShowsWeaknessColumn({})).toBe(false);
    expect(screenerVisibleColumns({ setupMode: "weakness", scannedMarkets: ["US"] }).map((c) => c.key))
      .toEqual(["ticker", "theme", "rs", "stage", "weakness", "vcp", "performance", "distance52w", "marketCap"]);
  });

  it("pinta cabecera y valor de deterioro en escritorio", () => {
    const html = renderTable({ setupMode: "weakness", sort: "weaknessScore", scannedMarkets: ["US"] });
    expect(html.match(/<th /g)).toHaveLength(9);
    expect(html.match(/<td /g)).toHaveLength(9);
    expect(html).toContain(">Deterioro<");
    expect(html).toContain(">12</b>");
    expect(html).toContain("Sin deterioro claro");
  });

  it("incluye weaknessScore en opciones de orden cuando la columna es visible", () => {
    const values = screenerSortOptions({ setupMode: "weakness", sort: "weaknessScore", scannedMarkets: ["US"] }).map((item) => item.value);
    expect(values).toContain("weaknessScore");
  });
});

describe("cabeceras ordenables", () => {
  it("marca la columna activa con indicador de dirección", () => {
    const html = renderTable({
      perfPeriod: "perf6m",
      sort: "perf6m",
      sortAsc: false,
      onSortColumn: () => {},
    });
    expect(html).toContain("columnHeadBtn isActive");
    expect(html).toContain("aria-sort=\"descending\"");
    expect(html).toContain("sortIndicator");
    expect(html).toContain("↓");
    expect(html).toContain("Rend. 6M");
  });

  it("muestra flecha ascendente cuando sortAsc es true", () => {
    const html = renderTable({
      sort: "rsGlobalPct",
      sortAsc: true,
      onSortColumn: () => {},
    });
    expect(html).toContain("aria-sort=\"ascending\"");
    expect(html).toContain("↑");
  });
});

describe("etapa de Weinstein en una palabra", () => {
  it("traduce cada estado semanal", () => {
    expect(stageWord({ weeklyStageState: "stage2" }).word).toBe("Etapa 2");
    expect(stageWord({ weeklyStageState: "stage4" }).word).toBe("Etapa 4");
    expect(stageWord({ weeklyStageState: "base" }).word).toBe("Base");
    expect(stageWord({ weeklyStageState: "mixed" }).word).toBe("Mixta");
    expect(stageWord({ weeklyStageState: "insufficient_history" })).toBeNull();
  });

  it("cae a la etiqueta guardada en filas de sesiones antiguas", () => {
    expect(stageWord({ weeklyStageLabel: "Stage 4 probable" }).word).toBe("Etapa 4");
    expect(stageWord({ weeklyStageLabel: "Base / transicion" }).word).toBe("Base");
    expect(stageWord({})).toBeNull();
  });

  it("pinta el calificador Pre-fuga bajo Etapa 2", () => {
    const html = renderTable({
      rows: [{
        ...fullRow,
        weeklyStageStructure: "E2_ma_only",
        weeklyStageStructureLabel: "Pre-fuga",
      }],
    });
    expect(html).toContain("Etapa 2");
    expect(html).toContain("Pre-fuga");
    expect(html).toContain("stageTagQualifier");
  });
});

describe("vista móvil", () => {
  function renderMobile(row = fullRow, perfPeriod = DEFAULT_PERFORMANCE_PERIOD, options = {}) {
    return renderToStaticMarkup(React.createElement(MobileResultRow, {
      row,
      perfPeriod,
      sort: options.sort || "",
      setupMode: options.setupMode || "",
      scannedMarkets: options.scannedMarkets ?? ["US"],
      onReview: () => {},
      onFavorite: () => {},
      onOpenStock: () => {},
      isFavorite: false,
    }));
  }

  it("lee las mismas columnas visibles que escritorio (mesa US)", () => {
    const html = renderMobile();
    expect(html).toContain(">TREN<");
    expect(html).toContain("miniSparkline");
    expect(html).toContain("Semis / fotonica");
    expect(html).toContain(">92<");
    expect(html).not.toContain(">55<");
    expect(html).toContain("Etapa 2");
    expect(html).toContain("+18,4%");
    expect(html).toContain("-3,2%");
    expect(html).toContain("4,2B");
    expect(html.match(/class="mobileResultField/g)).toHaveLength(7);
  });

  it("muestra RS país en móvil cuando la mesa no es US-only", () => {
    const html = renderMobile(fullRow, DEFAULT_PERFORMANCE_PERIOD, { scannedMarkets: ["US", "HK"] });
    expect(html).toContain(">55<");
    expect(html.match(/class="mobileResultField/g)).toHaveLength(8);
  });

  it("sigue al mismo selector global de periodo", () => {
    expect(renderMobile(fullRow, "perf12m")).toContain("+51,9%");
    expect(renderMobile(fullRow, "perf12m")).toContain("Rend. 12M");
  });

  it("muestra deterioro en móvil cuando el modo es weakness", () => {
    const html = renderMobile(fullRow, DEFAULT_PERFORMANCE_PERIOD, { setupMode: "weakness" });
    expect(html).toContain(">Deterioro<");
    expect(html).toContain(">12</b>");
    expect(html.match(/class="mobileResultField/g)).toHaveLength(8);
  });

  it("muestra las ausencias igual que escritorio", () => {
    const html = renderMobile(emptyRow);
    expect(html.match(/class="cellMissing"/g)).toHaveLength(8);
    expect(html).toContain("Sin RS semanal");
  });
});
