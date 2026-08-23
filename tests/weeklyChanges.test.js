// tests/weeklyChanges.test.js — «qué ha cambiado esta semana».
//
// Tres frentes: (1) la elección de la pareja de escaneos, incluido el corte de
// criterio de etapa del 17-18 de agosto de 2026 (comparar a través del corte
// fabricaría transiciones falsas); (2) el cálculo puro de los cambios, con los
// bordes exactos de los umbrales de máximos; (3) el render de la línea y el
// panel — los ceros se escriben, las ausencias llevan motivo (principio 3).

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AT_HIGH_MIN_D52,
  NEAR_HIGH_MIN_D52,
  STAGE_CRITERIA_CUTOVER_SCAN_DATE,
  computeWeeklyChanges,
  dataAsOfFromRows,
  formatDayLabel,
  mondayOf,
  normalizeScanRows,
  pickComparisonPair,
  previousTradingDayEstimate,
  scanDateFromLocalId,
  stageVocabularyIncompatible,
  stageWord,
} from "@/lib/weeklyChanges";

// next/link fuera de Next no tiene router; para el render estático basta un <a>.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: function LinkMock({ href, children, prefetch: _prefetch, ...rest }) {
      return createElement("a", { href: typeof href === "string" ? href : "", ...rest }, children);
    },
  };
});

// vi.mock se iza por encima de los imports, así que este import ya ve el mock.
import { renderWeeklyChangesView } from "@/app/components/screener/WeeklyChangesLine";

// ── Fechas ─────────────────────────────────────────────────────────────────

describe("fechas", () => {
  it("previousTradingDayEstimate salta el fin de semana", () => {
    expect(previousTradingDayEstimate("2026-08-23")).toBe("2026-08-21"); // dom → vie
    expect(previousTradingDayEstimate("2026-08-22")).toBe("2026-08-21"); // sáb → vie
    expect(previousTradingDayEstimate("2026-08-17")).toBe("2026-08-14"); // lun → vie
    expect(previousTradingDayEstimate("2026-08-18")).toBe("2026-08-17"); // mar → lun
  });

  it("mondayOf devuelve el lunes ISO de la semana", () => {
    expect(mondayOf("2026-08-21")).toBe("2026-08-17"); // viernes
    expect(mondayOf("2026-08-17")).toBe("2026-08-17"); // el propio lunes
    expect(mondayOf("2026-08-23")).toBe("2026-08-17"); // domingo cierra la semana
  });

  it("formatDayLabel nombra el día en el vocabulario del producto", () => {
    expect(formatDayLabel("2026-08-17")).toBe("lun 17 ago");
    expect(formatDayLabel("2026-08-21")).toBe("vie 21 ago");
    expect(formatDayLabel("2026-08-19")).toBe("mié 19 ago");
    expect(formatDayLabel("")).toBe("");
  });

  it("scanDateFromLocalId lee la fecha del nocturno y rechaza otros formatos", () => {
    expect(scanDateFromLocalId("materialized:US:2026-08-23:t040159:o0:l5610")).toBe("2026-08-23");
    expect(scanDateFromLocalId("materialized:EU:2026-08-23:o0:l80")).toBeNull();
    expect(scanDateFromLocalId("test:materialized:US:2026-08-14:o0:l300")).toBeNull();
  });
});

// ── Elección de la pareja ──────────────────────────────────────────────────

function meta(scanDate, suffix = "t040000") {
  return {
    id: `id-${scanDate}`,
    localId: `materialized:US:${scanDate}:${suffix}:o0:l5610`,
    createdAt: `${scanDate}T04:00:00.000Z`,
    rowCount: 3300,
  };
}

describe("pickComparisonPair", () => {
  it("con la retención real de esta semana ancla en el primer nocturno homogéneo y declara la ventana parcial", () => {
    const metas = ["2026-08-23", "2026-08-22", "2026-08-21", "2026-08-20", "2026-08-19", "2026-08-18", "2026-08-17"].map((d) => meta(d));
    const pair = pickComparisonPair(metas);
    expect(pair.current.scanDate).toBe("2026-08-23");
    expect(pair.anchor.scanDate).toBe(STAGE_CRITERIA_CUTOVER_SCAN_DATE);
    expect(pair.anchor.dataAsOfEstimate).toBe("2026-08-17");
    expect(pair.partialWeek).toBe(true);
    expect(pair.partialReason).toBe("stage-criteria-cutover");
  });

  it("cuando existe un cierre de la semana anterior homogéneo, lo prefiere y la ventana no es parcial", () => {
    const metas = ["2026-08-29", "2026-08-28", "2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23"].map((d) => meta(d));
    const pair = pickComparisonPair(metas);
    expect(pair.current.scanDate).toBe("2026-08-29");
    // El nocturno del lunes 24 y el del domingo 23 llevan las mismas barras
    // (viernes 21); cualquiera de los dos es el cierre semanal anterior.
    expect(pair.anchor.dataAsOfEstimate).toBe("2026-08-21");
    expect(pair.partialWeek).toBe(false);
    expect(pair.anchorPolicy).toBe("previous-week-close");
  });

  it("si todas las anclas posibles son anteriores al corte de criterio, lo dice como motivo", () => {
    const metas = [meta("2026-08-18"), meta("2026-08-17"), meta("2026-08-16")];
    const pair = pickComparisonPair(metas);
    expect(pair.current.scanDate).toBe("2026-08-18");
    expect(pair.anchor).toBeNull();
    expect(pair.reason).toBe("only-pre-cutover-anchors");
  });

  it("con un solo escaneo no hay comparación y el motivo lo distingue del corte", () => {
    const pair = pickComparisonPair([meta("2026-08-23")]);
    expect(pair.anchor).toBeNull();
    expect(pair.reason).toBe("single-comparable-scan");
  });

  it("dos corridas de la misma noche cuentan como una: vale la más reciente", () => {
    const early = { ...meta("2026-08-23", "t020000"), createdAt: "2026-08-23T02:00:00.000Z", id: "id-early" };
    const late = { ...meta("2026-08-23", "t040159"), createdAt: "2026-08-23T04:01:59.000Z", id: "id-late" };
    const pair = pickComparisonPair([early, late, meta("2026-08-18")]);
    expect(pair.current.id).toBe("id-late");
  });

  it("sin escaneos devuelve la ausencia con motivo", () => {
    expect(pickComparisonPair([]).reason).toBe("no-nightly-scans");
  });
});

// ── Cálculo de cambios ─────────────────────────────────────────────────────

function rowsMap(rows) {
  return normalizeScanRows(rows);
}

describe("computeWeeklyChanges", () => {
  it("detecta entradas y salidas de etapa 2 solo entre pares clasificados en ambos cortes", () => {
    const anchor = rowsMap([
      { symbol: "IN1", stage: "stage1", d52: -20 },
      { symbol: "OUT1", stage: "stage2", d52: -20 },
      { symbol: "KEEP", stage: "stage2", d52: -20 },
      { symbol: "NOCLS", stage: "insufficient_history", d52: -20 },
      { symbol: "NULLA", stage: null, d52: -20 },
    ]);
    const current = rowsMap([
      { symbol: "IN1", stage: "stage2", d52: -20 },
      { symbol: "OUT1", stage: "stage4", d52: -20 },
      { symbol: "KEEP", stage: "stage2", d52: -20 },
      { symbol: "NOCLS", stage: "stage2", d52: -20 },
      { symbol: "NULLA", stage: "stage2", d52: -20 },
    ]);
    const result = computeWeeklyChanges(anchor, current);
    expect(result.stage2.entries.map((row) => row.symbol)).toEqual(["IN1"]);
    expect(result.stage2.exits.map((row) => row.symbol)).toEqual(["OUT1"]);
    expect(result.stage2.entries[0].stageFrom).toBe("stage1");
    expect(result.stage2.entries[0].stageTo).toBe("stage2");
    // Los no clasificados en el ancla no cuentan como transiciones ni como pares de etapa.
    expect(result.population.stagePairs).toBe(3);
    expect(result.population.paired).toBe(5);
  });

  it("desglosa la zona de máximos con los bordes exactos de los umbrales", () => {
    const anchor = rowsMap([
      { symbol: "NEW", stage: "stage2", d52: -5.01 }, // venía de lejos → nuevo
      { symbol: "EDGE_NEAR", stage: "stage2", d52: NEAR_HIGH_MIN_D52 }, // -5 exacto → ya estaba cerca
      { symbol: "NEAR", stage: "stage2", d52: -0.5 },
      { symbol: "NODATA", stage: "stage2", d52: null },
      { symbol: "FAR", stage: "stage2", d52: -30 },
    ]);
    const current = rowsMap([
      { symbol: "NEW", stage: "stage2", d52: -0.2 },
      { symbol: "EDGE_NEAR", stage: "stage2", d52: AT_HIGH_MIN_D52 }, // -1 exacto → en zona
      { symbol: "NEAR", stage: "stage2", d52: 0 },
      { symbol: "NODATA", stage: "stage2", d52: -0.8 },
      { symbol: "FAR", stage: "stage2", d52: -1.01 }, // fuera de la zona por un céntimo
    ]);
    const result = computeWeeklyChanges(anchor, current);
    expect(result.highs.atHighNow).toBe(4);
    expect(result.highs.newThisWindow.map((row) => row.symbol)).toEqual(["NEW"]);
    expect(result.highs.alreadyNear.map((row) => row.symbol).sort()).toEqual(["EDGE_NEAR", "NEAR"]);
    expect(result.highs.noAnchor.map((row) => row.symbol)).toEqual(["NODATA"]);
  });

  it("los símbolos presentes en un solo escaneo no cuentan como cambios y se declaran aparte", () => {
    const anchor = rowsMap([
      { symbol: "BOTH", stage: "stage1", d52: -10 },
      { symbol: "GONE", stage: "stage2", d52: -10 },
    ]);
    const current = rowsMap([
      { symbol: "BOTH", stage: "stage2", d52: -10 },
      { symbol: "FRESH", stage: "stage2", d52: 0 },
    ]);
    const result = computeWeeklyChanges(anchor, current);
    // GONE salió de cobertura: NO es una «salida de etapa 2».
    expect(result.stage2.exits).toEqual([]);
    // FRESH entró en cobertura: NI entrada de etapa NI máximo comparado.
    expect(result.stage2.entries.map((row) => row.symbol)).toEqual(["BOTH"]);
    expect(result.highs.newThisWindow).toEqual([]);
    expect(result.population.enteredCoverage).toBe(1);
    expect(result.population.leftCoverage).toBe(1);
  });
});

describe("stageVocabularyIncompatible", () => {
  it("un lado con el vocabulario anterior (base/mixed) y otro sin él no son comparables", () => {
    const legacy = rowsMap([
      { symbol: "A", stage: "base" },
      { symbol: "B", stage: "mixed" },
      { symbol: "C", stage: "stage2" },
    ]);
    const strict = rowsMap([
      { symbol: "A", stage: "stage1" },
      { symbol: "B", stage: "stage3" },
      { symbol: "C", stage: "stage2" },
    ]);
    expect(stageVocabularyIncompatible(legacy, strict)).toBe(true);
    expect(stageVocabularyIncompatible(strict, strict)).toBe(false);
  });
});

describe("normalizeScanRows / dataAsOfFromRows", () => {
  it("normaliza símbolos y saca la fecha real de barras del máximo lastDate", () => {
    const bySymbol = normalizeScanRows([
      { symbol: " nvda ", stage: "STAGE2", d52: "-3.5", lastDate: "2026-08-21" },
      { symbol: "AAPL", stage: "stage1", d52: "no-numérico", lastDate: "2026-08-20" },
      { symbol: "", stage: "stage1" },
    ]);
    expect(bySymbol.size).toBe(2);
    expect(bySymbol.get("NVDA").stage).toBe("stage2");
    expect(bySymbol.get("NVDA").d52).toBe(-3.5);
    expect(bySymbol.get("AAPL").d52).toBeNull();
    expect(dataAsOfFromRows(bySymbol)).toBe("2026-08-21");
  });
});

describe("stageWord", () => {
  it("traduce al vocabulario del producto", () => {
    expect(stageWord("stage2")).toBe("etapa 2");
    expect(stageWord("insufficient_history")).toBe("sin histórico suficiente");
    expect(stageWord("")).toBe("sin clasificar");
  });
});

// ── Render ─────────────────────────────────────────────────────────────────

function okPayload(overrides = {}) {
  return {
    ok: true,
    state: "ok",
    window: {
      from: "2026-08-17",
      to: "2026-08-21",
      partialWeek: true,
      partialReason: "stage-criteria-cutover",
      cutover: "2026-08-18",
    },
    population: { paired: 3296, current: 3309, anchor: 3315, stagePairs: 3208, d52Pairs: 3296, enteredCoverage: 13, leftCoverage: 19 },
    stage2: {
      entries: { count: 2, rows: [
        { symbol: "AAA", name: "Alfa", theme: "Software", stageFrom: "stage1", stageTo: "stage2", d52Now: -2, d52Anchor: -8, rs: 91 },
        { symbol: "BBB", name: "Beta", theme: "Banca", stageFrom: "stage3", stageTo: "stage2", d52Now: -4, d52Anchor: -9, rs: null },
      ] },
      exits: { count: 1, rows: [
        { symbol: "CCC", name: "Gamma", theme: null, stageFrom: "stage2", stageTo: "stage4", d52Now: -22, d52Anchor: -12, rs: 14 },
      ] },
    },
    highs: {
      atHighNow: 3,
      thresholds: { atHighMinD52: -1, nearHighMinD52: -5 },
      newThisWindow: { count: 1, rows: [
        { symbol: "DDD", name: "Delta", theme: "Semiconductores", stageFrom: null, stageTo: null, d52Now: -0.4, d52Anchor: -8.3, rs: 95 },
      ] },
      alreadyNear: { count: 2, rows: [
        { symbol: "EEE", name: "Épsilon", theme: null, stageFrom: null, stageTo: null, d52Now: 0, d52Anchor: -2.1, rs: 88 },
        { symbol: "FFF", name: "Dseta", theme: null, stageFrom: null, stageTo: null, d52Now: -0.9, d52Anchor: -4.9, rs: 70 },
      ] },
      noAnchor: { count: 1 },
    },
    ...overrides,
  };
}

describe("renderWeeklyChangesView", () => {
  it("la línea declara desde cuándo compara, con día nombrado y cifras con nombre", () => {
    const html = renderToStaticMarkup(renderWeeklyChangesView({ payload: okPayload() }));
    expect(html).toContain("Desde el lun 17 ago");
    expect(html).toContain("2 entradas");
    expect(html).toContain("1 salida");
    expect(html).toContain("1 nuevo");
    expect(html).toContain("2 ya cerca");
    expect(html).toContain("ver detalle");
    // Jamás un total agregado del estilo «N cambios».
    expect(html).not.toMatch(/\d+\s+cambios/);
  });

  it("un día sin novedades escribe los ceros — nunca huecos ni ausencia muda", () => {
    const payload = okPayload({
      stage2: { entries: { count: 0, rows: [] }, exits: { count: 0, rows: [] } },
      highs: {
        atHighNow: 0,
        thresholds: { atHighMinD52: -1, nearHighMinD52: -5 },
        newThisWindow: { count: 0, rows: [] },
        alreadyNear: { count: 0, rows: [] },
        noAnchor: { count: 0 },
      },
    });
    const html = renderToStaticMarkup(renderWeeklyChangesView({ payload }));
    expect(html).toContain("0 entradas");
    expect(html).toContain("0 salidas");
    expect(html).toContain("0 nuevos");
    expect(html).toContain("0 ya cerca");
  });

  it("el panel abierto enseña las listas, la población y el motivo de la ventana parcial", () => {
    const html = renderToStaticMarkup(renderWeeklyChangesView({ payload: okPayload(), open: true }));
    expect(html).toContain("Cambios del lun 17 ago al vie 21 ago");
    expect(html).toContain("etapa 1 → etapa 2");
    expect(html).toContain("etapa 2 → etapa 4");
    expect(html).toContain("venía de un 8,3%");
    expect(html).toContain("en máximo");
    expect(html).toContain("RS 91");
    expect(html).toContain("RS –"); // RS ausente: guion, no cero
    // El separador de miles depende del ICU del entorno (node lo omite, el
    // navegador lo pinta); la cifra y su frase son lo estable.
    expect(html).toMatch(/Sobre 3\.?296 valores de EE\. UU\./);
    expect(html).toContain("13 entraron en cobertura y 19 salieron");
    expect(html).toContain("el criterio de clasificación de etapa se");
    expect(html).toContain("/stock/AAA");
  });

  it("una lista vacía se muestra con su texto, no se oculta", () => {
    const payload = okPayload({
      stage2: { entries: { count: 0, rows: [] }, exits: { count: 1, rows: okPayload().stage2.exits.rows } },
    });
    const html = renderToStaticMarkup(renderWeeklyChangesView({ payload, open: true }));
    expect(html).toContain("Ninguna en esta ventana.");
  });

  it("sin dos escaneos comparables por el corte de criterio, la ausencia lleva ese motivo", () => {
    const html = renderToStaticMarkup(renderWeeklyChangesView({
      payload: { ok: true, state: "not-comparable", reason: "only-pre-cutover-anchors" },
    }));
    expect(html).toContain("el criterio de etapa se actualizó el 17 de agosto");
    expect(html).not.toContain("0 entradas"); // jamás un cero por defecto
  });

  it("los estados de carga y de nube apagada hablan lenguaje de producto", () => {
    expect(renderToStaticMarkup(renderWeeklyChangesView({ loading: true }))).toContain("comprobando");
    const html = renderToStaticMarkup(renderWeeklyChangesView({
      payload: { ok: false, state: "cloud-off", message: "La copia en la nube no está activada." },
    }));
    expect(html).toContain("La copia en la nube no está activada.");
  });
});
