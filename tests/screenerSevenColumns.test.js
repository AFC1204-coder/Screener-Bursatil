// tests/screenerSevenColumns.test.js — contrato de la tabla de resultados.
// docs/principios-producto.md, principio 7: siete columnas, definidas en UN
// sitio (lib/screenerColumns.jsx), iguales en escritorio y en móvil.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactResultsTable } from "@/lib/screenerTable";
import { MobileResultRow } from "@/lib/screenerMobile";
import {
  PERFORMANCE_PERIODS,
  SCREENER_COLUMNS,
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
    ...props,
  }));
}

describe("tabla de resultados: las siete columnas", () => {
  it("define exactamente siete columnas en un solo sitio", () => {
    expect(SCREENER_COLUMNS).toHaveLength(7);
    expect(SCREENER_COLUMNS.map((column) => column.key)).toEqual([
      "ticker", "theme", "rs", "stage", "performance", "distance52w", "marketCap",
    ]);
  });

  it("pinta siete cabeceras y siete celdas por fila", () => {
    const html = renderTable();
    expect(html.match(/<th /g)).toHaveLength(7);
    expect(html.match(/<td /g)).toHaveLength(7);
  });

  it("muestra los siete datos de la fila", () => {
    const html = renderTable();
    expect(html).toContain(">TREN<");
    expect(html).toContain("miniSparkline");        // 1. ticker con miniatura
    expect(html).toContain("Semis / fotonica");     // 2. tema
    expect(html).toContain(">92<");                 // 3. RS semanal del universo
    expect(html).toContain("Etapa 2");              // 4. etapa en una palabra
    expect(html).toContain("+18,4%");               // 5. rendimiento del periodo
    expect(html).toContain("-3,2%");                // 6. distancia al máximo 52s
    expect(html).toContain("4,2B");                 // 7. capitalización
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
    expect(html).not.toContain(">82<");   // minerviniScore
    expect(html).not.toContain(">86<");   // weinsteinScore
    expect(html).not.toContain(">78<");   // rsQualityScore
    expect(html).not.toContain(">71<");   // rsSectorPct (RS de grupo)
    expect(html).not.toContain("SMA50");
    expect(html).not.toContain("Deterioro");
  });

  it("deja un solo RS y lo explica en la cabecera", () => {
    const html = renderTable();
    expect(html.match(/>RS</g)).toHaveLength(1);
    expect(html).toContain("Fuerza relativa semanal");
    expect(html).not.toContain(">Grp<");
    expect(html).not.toContain(">Q<");
  });

  it("no recorta los porcentajes con puntos suspensivos", () => {
    const html = renderTable();
    // El valor va completo dentro de su propio <b class="cellNumber">.
    expect(html).toContain('class="cellNumber up">+18,4%</b>');
    expect(html).not.toContain("…");
  });
});

describe("dato ausente", () => {
  it("muestra un guion con el motivo, sin etiquetas de estado", () => {
    const html = renderTable({ rows: [emptyRow] });
    // Seis columnas de dato + la miniatura, que también falta en esta fila.
    expect(html.match(/class="cellMissing"/g)).toHaveLength(7);
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

  it("el orden sigue al periodo elegido", () => {
    expect(screenerSortOptions({ perfPeriod: "perf6m" }).map((item) => item.value))
      .toEqual(["rsGlobalPct", "perf6m", "distance52w", "marketCap"]);
    expect(screenerSortOptions({ perfPeriod: "perf12m" })[1])
      .toEqual({ value: "perf12m", label: "Rendimiento 12M" });
  });

  it("solo deja ordenar por columnas visibles", () => {
    const values = screenerSortOptions({}).map((item) => item.value);
    expect(values).not.toContain("objectiveScore");
    expect(values).not.toContain("weaknessScore");
    expect(values).not.toContain("decisionPriority");
  });
});

describe("columna Deterioro (modo weakness / orden weaknessScore)", () => {
  it("muestra la columna cuando el modo es weakness o el orden es weaknessScore", () => {
    expect(screenerShowsWeaknessColumn({ setupMode: "weakness" })).toBe(true);
    expect(screenerShowsWeaknessColumn({ sort: "weaknessScore" })).toBe(true);
    expect(screenerShowsWeaknessColumn({})).toBe(false);
    expect(screenerVisibleColumns({ setupMode: "weakness" }).map((c) => c.key))
      .toEqual(["ticker", "theme", "rs", "stage", "weakness", "performance", "distance52w", "marketCap"]);
  });

  it("pinta cabecera y valor de deterioro en escritorio", () => {
    const html = renderTable({ setupMode: "weakness", sort: "weaknessScore" });
    expect(html.match(/<th /g)).toHaveLength(8);
    expect(html.match(/<td /g)).toHaveLength(8);
    expect(html).toContain(">Deterioro<");
    expect(html).toContain(">12</b>");
    expect(html).toContain("Sin deterioro claro");
  });

  it("incluye weaknessScore en opciones de orden cuando la columna es visible", () => {
    const values = screenerSortOptions({ setupMode: "weakness", sort: "weaknessScore" }).map((item) => item.value);
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
});

describe("vista móvil", () => {
  function renderMobile(row = fullRow, perfPeriod = DEFAULT_PERFORMANCE_PERIOD, options = {}) {
    return renderToStaticMarkup(React.createElement(MobileResultRow, {
      row,
      perfPeriod,
      sort: options.sort || "",
      setupMode: options.setupMode || "",
      onReview: () => {},
      onFavorite: () => {},
      onOpenStock: () => {},
      isFavorite: false,
    }));
  }

  it("lee las mismas siete columnas que escritorio", () => {
    const html = renderMobile();
    expect(html).toContain(">TREN<");
    expect(html).toContain("miniSparkline");
    expect(html).toContain("Semis / fotonica");
    expect(html).toContain(">92<");
    expect(html).toContain("Etapa 2");
    expect(html).toContain("+18,4%");
    expect(html).toContain("-3,2%");
    expect(html).toContain("4,2B");
    // Las seis columnas de dato, con su etiqueta.
    expect(html.match(/class="mobileResultField/g)).toHaveLength(6);
  });

  it("sigue al mismo selector global de periodo", () => {
    expect(renderMobile(fullRow, "perf12m")).toContain("+51,9%");
    expect(renderMobile(fullRow, "perf12m")).toContain("Rend. 12M");
  });

  it("muestra deterioro en móvil cuando el modo es weakness", () => {
    const html = renderMobile(fullRow, DEFAULT_PERFORMANCE_PERIOD, { setupMode: "weakness" });
    expect(html).toContain(">Deterioro<");
    expect(html).toContain(">12</b>");
    expect(html.match(/class="mobileResultField/g)).toHaveLength(7);
  });

  it("muestra las ausencias igual que escritorio", () => {
    const html = renderMobile(emptyRow);
    expect(html.match(/class="cellMissing"/g)).toHaveLength(7);
    expect(html).toContain("Sin RS semanal");
  });
});
