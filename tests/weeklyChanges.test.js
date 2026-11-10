// tests/weeklyChanges.test.js — «qué ha cambiado esta semana».
//
// Tres frentes: (1) la elección de la pareja de escaneos, incluido el corte de
// criterio de etapa del 17-18 de agosto de 2026 (comparar a través del corte
// fabricaría transiciones falsas); (2) el cálculo puro de los cambios, con los
// bordes exactos de los umbrales de máximos; (3) el render de la línea y el
// panel — los ceros se escriben, las ausencias llevan motivo (principio 3).

import { describe, expect, it, vi } from "vitest";
import React from "react";
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
  closedWeekEndFor,
  displayedStageIsOfficial,
  fridayOf,
  validateAgainstDisplayed,
  verifyWeeklyPair,
  weeklyHeadingFromPayload,
  weeklyWindowLabel,
  WEEKLY_ANCHOR_TOLERANCE_DAYS,
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
import {
  isWeeklyChangesSoftFailure,
  loadWeeklyChangesPayload,
  renderWeeklyChangesView,
} from "@/app/components/screener/WeeklyChangesLine";

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

describe("pickComparisonPair · viernes a viernes con el escaneo mostrado (D2)", () => {
  // Semana real de la auditoría: nocturnos del 12 al 18 de octubre de 2026,
  // más los del fin de semana anterior (sábado 10 y domingo 11, barras del 9).
  const october = ["2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12", "2026-10-11", "2026-10-10"];

  it("el actual es el escaneo mostrado y el ancla, el cierre del viernes anterior", () => {
    const metas = october.map((d) => meta(d));
    const pair = pickComparisonPair(metas, { currentLocalId: meta("2026-10-18").localId });
    expect(pair.current.localId).toBe(meta("2026-10-18").localId);
    expect(pair.currentWeekEnd).toBe("2026-10-16");
    expect(pair.anchorWeekEnd).toBe("2026-10-09");
    // Sábado 10, domingo 11 y lunes 12 llevan barras del viernes 9; vale el
    // que corrió antes (el más pegado al cierre).
    expect(pair.anchor.scanDate).toBe("2026-10-10");
    expect(pair.anchor.dataAsOfEstimate).toBe("2026-10-09");
    expect(pair.anchorPolicy).toBe("weekly-close");
    expect(pair.partialWeek).toBe(false);
  });

  it("REGRESIÓN auditoría: createdAt como Date no elige el miércoles como «actual»", () => {
    const metas = october.map((d) => ({ ...meta(d), createdAt: new Date(`${d}T03:00:32.000Z`) }));
    const pair = pickComparisonPair(metas);
    expect(pair.current.scanDate).toBe("2026-10-18");
    expect(pair.anchor.dataAsOfEstimate).toBe("2026-10-09");
  });

  it("con un escaneo mostrado de entre semana, compara su última semana cerrada con la anterior", () => {
    const metas = [...october, "2026-10-04", "2026-10-03"].map((d) => meta(d));
    // Miércoles 14: barras del martes 13, semana en curso; su semana cerrada
    // es la del 9 y el ancla, la del 2 de octubre.
    const pair = pickComparisonPair(metas, { currentLocalId: meta("2026-10-14").localId });
    expect(pair.currentWeekEnd).toBe("2026-10-09");
    expect(pair.anchorWeekEnd).toBe("2026-10-02");
    expect(pair.anchor.scanDate).toBe("2026-10-03");
  });

  it("sin el cierre del viernes anterior dentro de la tolerancia no hay par (nunca uno de días sueltos)", () => {
    // Solo hay nocturnos de la misma semana: el 12-oct (barras del 9) no
    // existe; el más cercano sería el martes 13, que no es un viernes.
    const metas = ["2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13"].map((d) => meta(d));
    const pair = pickComparisonPair(metas, { currentLocalId: meta("2026-10-18").localId });
    expect(pair.anchor).toBeNull();
    expect(pair.reason).toBe("no-weekly-anchor");
  });

  it("un viernes festivo (barras del jueves) entra en la tolerancia", () => {
    // Semana del Viernes Santo 2026: viernes 3-abr festivo. El nocturno del
    // sábado 4 trae barras del jueves 2 (la estimación dice viernes; la ruta
    // verifica la real). La semana está cerrada igual.
    const metas = ["2026-04-11", "2026-04-04"].map((d) => meta(d));
    const pair = pickComparisonPair(metas, { cutoverScanDate: "2026-01-01" });
    expect(pair.anchor.scanDate).toBe("2026-04-04");
    const ok = verifyWeeklyPair({ current: pair.current, anchor: pair.anchor, currentAsOf: "2026-04-10", anchorAsOf: "2026-04-02" });
    expect(ok).toMatchObject({ ok: true, currentWeekEnd: "2026-04-10", anchorWeekEnd: "2026-04-03" });
  });

  it("la verificación con fechas reales rechaza un ancla fuera de tolerancia", () => {
    const pair = pickComparisonPair(["2026-10-18", "2026-10-10"].map((d) => meta(d)));
    const bad = verifyWeeklyPair({ current: pair.current, anchor: pair.anchor, currentAsOf: "2026-10-16", anchorAsOf: "2026-10-06" });
    expect(bad).toMatchObject({ ok: false, reason: "anchor-outside-tolerance" });
    expect(WEEKLY_ANCHOR_TOLERANCE_DAYS).toBe(2);
  });

  it("si el escaneo mostrado no es un nocturno publicable, no hay par", () => {
    const pair = pickComparisonPair(october.map((d) => meta(d)), { currentLocalId: "materialized:US:2026-09-01:t040000:o0:l5610" });
    expect(pair.current).toBeNull();
    expect(pair.reason).toBe("displayed-scan-not-nightly");
  });

  it("si el único ancla posible es anterior al corte de criterio, lo dice como motivo", () => {
    const pair = pickComparisonPair([meta("2026-08-22"), meta("2026-08-15")]);
    expect(pair.anchor).toBeNull();
    expect(pair.reason).toBe("only-pre-cutover-anchors");
  });

  it("con un solo escaneo no hay comparación", () => {
    const pair = pickComparisonPair([meta("2026-08-23")]);
    expect(pair.anchor).toBeNull();
    expect(pair.reason).toBe("no-weekly-anchor");
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

  it("closedWeekEndFor: la semana cierra cuando el escaneo corre después del viernes", () => {
    expect(closedWeekEndFor("2026-10-16", "2026-10-17")).toBe("2026-10-16"); // sábado
    expect(closedWeekEndFor("2026-10-15", "2026-10-16")).toBe("2026-10-09"); // viernes de madrugada
    expect(closedWeekEndFor("2026-10-12", "2026-10-13")).toBe("2026-10-09"); // martes
    expect(fridayOf("2026-10-18")).toBe("2026-10-16");
  });
});

describe("contrato D2 · entradas validadas contra el escaneo mostrado", () => {
  it("una entrada está en E2 en el mostrado y una salida no; lo que no cumpla se descarta y se cuenta", () => {
    const anchor = normalizeScanRows([
      { symbol: "IN", stage: "stage1" }, { symbol: "OUT", stage: "stage2" }, { symbol: "GHOST", stage: "stage1" },
    ]);
    const current = normalizeScanRows([
      { symbol: "IN", stage: "stage2" }, { symbol: "OUT", stage: "stage3" }, { symbol: "GHOST", stage: "stage2" },
    ]);
    const changes = computeWeeklyChanges(anchor, current);
    // Un «mostrado» distinto del actual (el bug de la auditoría): GHOST ya
    // está en etapa 3 y OUT vuelve a etapa 2.
    const displayed = normalizeScanRows([
      { symbol: "IN", stage: "stage2" }, { symbol: "OUT", stage: "stage2" }, { symbol: "GHOST", stage: "stage3" },
    ]);
    const validated = validateAgainstDisplayed(changes, displayed);
    expect(validated.stage2.entries.map((r) => r.symbol)).toEqual(["IN"]);
    expect(validated.stage2.exits).toEqual([]);
    expect(validated.validation).toEqual({ entriesDropped: 1, exitsDropped: 1 });
    // Con el mostrado = actual no se descarta nada.
    const same = validateAgainstDisplayed(changes, current);
    expect(same.validation).toEqual({ entriesDropped: 0, exitsDropped: 0 });
    expect(same.stage2.entries.every((r) => current.get(r.symbol).stage === "stage2")).toBe(true);
  });

  it("la etapa de un nocturno antiguo de entre semana no es oficial; la de fin de semana sí", () => {
    const legacy = normalizeScanRows([{ symbol: "A", stage: "stage2", lastDate: "2026-10-13" }]);
    expect(displayedStageIsOfficial(legacy, { dataAsOf: "2026-10-13", scanDate: "2026-10-14" })).toBe(false);
    const weekend = normalizeScanRows([{ symbol: "A", stage: "stage2", lastDate: "2026-10-16" }]);
    expect(displayedStageIsOfficial(weekend, { dataAsOf: "2026-10-16", scanDate: "2026-10-18" })).toBe(true);
    const d1 = normalizeScanRows([{ symbol: "A", metrics: { weeklyStageState: "stage2", weeklyStageWeekStart: "2026-10-05" } }]);
    expect(displayedStageIsOfficial(d1, { dataAsOf: "2026-10-13", scanDate: "2026-10-14" })).toBe(true);
  });

  it("rótulos: fechas de la ventana o «Sin comparación esta semana»", () => {
    expect(weeklyWindowLabel("2026-10-09", "2026-10-16")).toBe("Semana 9 → 16 oct");
    expect(weeklyWindowLabel("2026-09-25", "2026-10-02")).toBe("Semana 25 sep → 2 oct");
    expect(weeklyWindowLabel("2025-12-26", "2026-01-02")).toBe("Semana 26 dic 2025 → 2 ene 2026");
    expect(weeklyHeadingFromPayload({ state: "ok", window: { from: "2026-10-09", to: "2026-10-16", fromWeekEnd: "2026-10-09", toWeekEnd: "2026-10-16" } })).toBe("Semana 9 → 16 oct");
    expect(weeklyHeadingFromPayload({ state: "not-comparable", reason: "no-weekly-anchor" })).toBe("Sin comparación esta semana");
    expect(weeklyHeadingFromPayload(null)).toBe("Cambios de la semana");
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

  it("mapea filas pg (company_name + metrics) al shape interno", () => {
    const bySymbol = normalizeScanRows([
      {
        symbol: "MSFT",
        company_name: "Microsoft",
        theme: "Software",
        metrics: {
          weeklyStageState: "stage2",
          distance52w: "-2.5",
          lastDate: "2026-08-21",
        },
      },
    ]);
    const row = bySymbol.get("MSFT");
    expect(row.name).toBe("Microsoft");
    expect(row.stage).toBe("stage2");
    expect(row.d52).toBe(-2.5);
    expect(row.lastDate).toBe("2026-08-21");
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
      from: "2026-08-14",
      to: "2026-08-21",
      fromWeekEnd: "2026-08-14",
      toWeekEnd: "2026-08-21",
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
    expect(html).toContain("Semana 14 → 21 ago");
    expect(html).not.toContain("Esta noche");
    expect(html).toContain("2 entradas");
    expect(html).toContain("1 salida");
    expect(html).toContain("1 nuevo");
    expect(html).toContain("2 ya cerca");
    expect(html).toContain("ver detalle");
    // Jamás un total agregado del estilo «N cambios».
    expect(html).not.toMatch(/\d+\s+cambios/);
  });

  it("compacto (ticket, rediseño 2026-11): un solo enlace al panel; las cifras quedan en el title", () => {
    const html = renderToStaticMarkup(renderWeeklyChangesView({ payload: okPayload(), compact: true }));
    expect(html).toContain("weeklyChangesLine--compact");
    expect(html).toContain(">Cambios de la semana<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/title="Semana 14 → 21 ago · Etapa 2: 2 entradas, 1 salida · Máximos de 52 semanas: 1 nuevo, 2 ya cerca"/);
    expect(html).not.toContain("weeklyChangesFigure");
    expect(html).not.toContain("ver detalle");
    const open = renderToStaticMarkup(renderWeeklyChangesView({ payload: okPayload(), compact: true, open: true }));
    expect(open).toContain("weeklyChangesPanel");
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
    expect(html).toContain("<h2>Semana 14 → 21 ago</h2>");
    expect(html).toContain("Comparación del cierre del vie 14 ago al cierre del vie 21 ago");
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

  it("sin dos escaneos comparables por el corte de criterio, no ocupa el subtítulo (P10)", () => {
    const html = renderToStaticMarkup(renderWeeklyChangesView({
      payload: { ok: true, state: "not-comparable", reason: "only-pre-cutover-anchors" },
    }));
    expect(html).toBe("");
    expect(html).not.toContain("0 entradas");
  });

  it("carga / nube / no-scan / error quiet: silencio hasta haber delta útil (P10)", () => {
    expect(renderToStaticMarkup(renderWeeklyChangesView({ loading: true }))).toBe("");
    expect(renderToStaticMarkup(renderWeeklyChangesView({
      payload: { ok: false, state: "cloud-off", message: "La copia en la nube no está activada." },
    }))).toBe("");
    expect(renderToStaticMarkup(renderWeeklyChangesView({
      payload: { ok: true, state: "no-scan" },
    }))).toBe("");
    expect(renderToStaticMarkup(renderWeeklyChangesView({ error: "no disponibles ahora mismo." }))).toBe("");
  });

  it("un timeout / mensaje de infra no deja línea de error permanente en la cabecera", () => {
    const timeoutCopy = "El servidor de datos tardó demasiado en responder. Inténtalo de nuevo en unos minutos.";
    expect(renderToStaticMarkup(renderWeeklyChangesView({ error: timeoutCopy }))).toBe("");
    expect(renderToStaticMarkup(renderWeeklyChangesView({ loading: false, payload: null }))).toBe("");
  });
});

describe("WeeklyChangesLine · defer (T9)", () => {
  it("con defer=true no pinta la línea de comprobando…", async () => {
    const { default: WeeklyChangesLine } = await import("@/app/components/screener/WeeklyChangesLine");
    const html = renderToStaticMarkup(React.createElement(WeeklyChangesLine, { defer: true }));
    expect(html).toBe("");
    expect(html).not.toContain("comprobando");
  });
});

describe("isWeeklyChangesSoftFailure / loadWeeklyChangesPayload", () => {
  it("trata timeout y AbortError como fallo blando (reintento / ocultar)", () => {
    expect(isWeeklyChangesSoftFailure(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isWeeklyChangesSoftFailure(Object.assign(new Error("timeout"), { code: "FETCH_TIMEOUT" }))).toBe(true);
    expect(isWeeklyChangesSoftFailure(new Error("HTTP 503"))).toBe(true);
    expect(isWeeklyChangesSoftFailure(new Error("HTTP 401"))).toBe(false);
  });

  it("reintenta en silencio ante timeout y luego degrada a softFailure", async () => {
    const timeoutErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const getJsonImpl = vi.fn()
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(timeoutErr);
    const sleep = vi.fn(async () => {});

    const result = await loadWeeklyChangesPayload({
      getJsonImpl,
      maxAttempts: 3,
      retryDelayMs: 10,
      sleep,
      timeoutMs: 100,
    });

    expect(result.softFailure).toBe(true);
    expect(getJsonImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("si un reintento recupera datos, no degrada", async () => {
    const timeoutErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const payload = { ok: true, state: "ok" };
    const getJsonImpl = vi.fn()
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce(payload);
    const sleep = vi.fn(async () => {});

    const result = await loadWeeklyChangesPayload({
      getJsonImpl,
      maxAttempts: 3,
      retryDelayMs: 10,
      sleep,
    });

    expect(result).toEqual({ payload });
    expect(getJsonImpl).toHaveBeenCalledTimes(2);
  });

  it("un 4xx duro no reintenta y propaga el error", async () => {
    const hard = new Error("HTTP 403");
    const getJsonImpl = vi.fn().mockRejectedValue(hard);
    const sleep = vi.fn(async () => {});

    await expect(loadWeeklyChangesPayload({
      getJsonImpl,
      maxAttempts: 3,
      sleep,
    })).rejects.toThrow("HTTP 403");
    expect(getJsonImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});