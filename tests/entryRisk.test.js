// Propuesta 2 de la auditoría de producto 2026-11: «decidir la entrada».
// Contrato de lib/entryRisk.js (cálculo puro), de la celda «Pivote · R» de la
// cinta y del bloque «Entrada» del panel y la vista rápida.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENTRY_ABSENT,
  POSITION_CALC_STORAGE_KEY,
  entryChipForRow,
  entryRiskForRow,
  lastContractionLowFromRow,
  parseDecimalInput,
  positionSize,
  riskToStopPct,
  sanitizePositionCalcSettings,
  stopReferenceForRow,
  weeklyMa10FromRow,
} from "@/lib/entryRisk";
import { HuntTapePivotCell } from "@/lib/entryPivotChip";
import { MobileTapeRow } from "@/lib/screenerMobile";
import { safeRead } from "@/lib/localState";
import { SCAN_LIGHT_FIELDS, projectScanRowForMesaTransport, scanLightMetrics } from "@/lib/scanLightProjection";
import EntryBlock from "@/app/components/screener/EntryBlock";
import HuntPeekPanel from "@/app/components/screener/HuntPeekPanel";
import MobilePeekSheet from "@/app/components/screener/MobilePeekSheet";

const base = {
  symbol: "ANF",
  companyName: "Abercrombie & Fitch Co.",
  price: 150,
  pivotPrice: 156,
  distanceToPivotPct: (150 / 156 - 1) * 100,
  weeklyFastWeeks: 10,
};

const viaContraction = {
  ...base,
  contractionSwings: [
    { low: 100.43, high: 119.92, depthPct: 16.25 },
    { low: 136.17, high: 154.58, depthPct: 11.9 },
  ],
  weeklyFastMa: 140,
};

const nulls = {
  symbol: "TJGC",
  companyName: "TJGC Group Limited",
  price: null,
  pivotPrice: null,
  distanceToPivotPct: null,
  weeklyFastMa: null,
  lastContractionLow: null,
  contractionSwings: null,
};

function render(el) {
  return renderToStaticMarkup(el);
}

describe("stop de referencia", () => {
  it("prefiere el mínimo de la última contracción (escalar o último swing válido)", () => {
    expect(lastContractionLowFromRow(viaContraction)).toBe(136.17);
    expect(lastContractionLowFromRow({ lastContractionLow: 120.5, contractionSwings: [{ low: 1 }] })).toBe(120.5);
    // Último swing sin low válido → el anterior.
    expect(lastContractionLowFromRow({ contractionSwings: [{ low: 90 }, { low: null }] })).toBe(90);
    expect(stopReferenceForRow(viaContraction)).toEqual({ value: 136.17, source: "contraction" });
  });

  it("si no hay contracción, la MM10s; solo si la media rápida es de 10 semanas", () => {
    expect(stopReferenceForRow({ ...base, weeklyFastMa: 140 })).toEqual({ value: 140, source: "ma10w" });
    expect(weeklyMa10FromRow({ weeklyFastWeeks: 8, weeklyFastMa: 140 })).toBeNull();
    expect(weeklyMa10FromRow({ weeklyFastWeeks: 8, weeklyFastMa: 140, sma10w: 139 })).toBe(139);
    expect(weeklyMa10FromRow({ weeklyFastMa: 141 })).toBe(141);
  });

  it("sin ninguno de los dos: no se inventa (null), y 0 / \"\" / null no son un stop", () => {
    expect(stopReferenceForRow(base)).toBeNull();
    expect(stopReferenceForRow({ lastContractionLow: 0, weeklyFastMa: "" })).toBeNull();
    expect(stopReferenceForRow({ contractionSwings: [{ low: 0 }], weeklyFastMa: null })).toBeNull();
  });
});

describe("entryRiskForRow", () => {
  it("riesgo = (precio − stop) / precio, con el origen del stop", () => {
    const entry = entryRiskForRow(viaContraction);
    expect(entry.pivot).toBe(156);
    expect(entry.stop).toBe(136.17);
    expect(entry.stopSource).toBe("contraction");
    expect(entry.riskPct).toBeCloseTo(((150 - 136.17) / 150) * 100, 6);
    expect(entry.distanceToPivotPct).toBeCloseTo(-3.846, 2);
    expect(entry.inEntryZone).toBe(false);
    expect(entry.zoneHigh).toBeCloseTo(163.8, 6);
  });

  it("sin stop: riesgo null y motivo; el pivote y la distancia se mantienen", () => {
    const entry = entryRiskForRow(base);
    expect(entry.stop).toBeNull();
    expect(entry.riskPct).toBeNull();
    expect(entry.stopIssue).toBe("missing");
    expect(entry.distanceToPivotPct).not.toBeNull();
  });

  it("stop ≥ precio: no hay stop medible (null), se conserva la referencia para el title", () => {
    const entry = entryRiskForRow({ ...base, weeklyFastMa: 150 });
    expect(entry.stop).toBeNull();
    expect(entry.riskPct).toBeNull();
    expect(entry.stopIssue).toBe("at-or-above-price");
    expect(entry.stopReference).toEqual({ value: 150, source: "ma10w" });
    expect(entryRiskForRow({ ...base, weeklyFastMa: 170 }).riskPct).toBeNull();
  });

  it("precio nulo: todo lo que depende del precio es null, nunca 0", () => {
    const entry = entryRiskForRow({ ...viaContraction, price: null });
    expect(entry.price).toBeNull();
    expect(entry.riskPct).toBeNull();
    expect(entry.stop).toBeNull();
    expect(entry.stopIssue).toBe("no-price");
    expect(riskToStopPct(null, 10)).toBeNull();
    expect(riskToStopPct(0, 10)).toBeNull();
  });

  it("zona de entrada: dato neutro de 0 a +5 %", () => {
    expect(entryRiskForRow({ ...base, distanceToPivotPct: 0 }).inEntryZone).toBe(true);
    expect(entryRiskForRow({ ...base, distanceToPivotPct: 5 }).inEntryZone).toBe(true);
    expect(entryRiskForRow({ ...base, distanceToPivotPct: 5.01 }).inEntryZone).toBe(false);
    expect(entryRiskForRow({ ...base, distanceToPivotPct: null }).inEntryZone).toBeNull();
  });

  it("riesgo extremo: se calcula y marca más del 10 %", () => {
    const entry = entryRiskForRow({ ...base, weeklyFastMa: 15 });
    expect(entry.riskPct).toBeCloseTo(90, 6);
    expect(entry.riskOverLimit).toBe(true);
  });
});

describe("chip de la cinta", () => {
  it("«-3,8% · R 9,2%» con el detalle en el title", () => {
    const chip = entryChipForRow({ ...viaContraction, currency: "USD" });
    expect(chip.text).toBe("-3,8% · R 9,2%");
    expect(chip.title).toContain("Pivote 156,00 USD");
    expect(chip.title).toContain("al stop 136,17 USD (mín. última contracción)");
  });

  it("sin divisa en la fila: sin símbolo de moneda", () => {
    const chip = entryChipForRow(viaContraction);
    expect(chip.title).toContain("Pivote 156,00 ·");
    expect(chip.title).not.toMatch(/USD|\$|€/);
  });

  it("sin stop: riesgo «—»; sin nada: «—» solo", () => {
    expect(entryChipForRow(base).text).toBe("-3,8% · R —");
    expect(entryChipForRow(base).title).toContain("sin stop");
    const empty = entryChipForRow(nulls);
    expect(empty.empty).toBe(true);
    expect(empty.text).toBe(ENTRY_ABSENT);
  });

  it("render: «—» en ghost con nulos, nunca 0", () => {
    const html = render(React.createElement(HuntTapePivotCell, { row: nulls }));
    expect(html).toMatch(/huntTapePivot huntTapeGhost[^>]*>—</);
    expect(html).not.toMatch(/>0</);
    expect(html).not.toContain("0,0%");
    const partial = render(React.createElement(HuntTapePivotCell, { row: base }));
    expect(partial).toContain("-3,8%");
    expect(partial).toMatch(/class="huntTapeGhost">—</);
  });

  it("móvil: la segunda línea vuelve a ser el nombre; el chip no se pinta", () => {
    const html = render(React.createElement(MobileTapeRow, { row: viaContraction }));
    expect(html).not.toContain("mobileTapePivot");
    expect(html).toContain("mobileTapeName");
    expect(html).toContain("Abercrombie &amp; Fitch Co.");
    // Sin símbolo (IPO vigilada): el nombre ya es la primera línea.
    const ipo = render(React.createElement(MobileTapeRow, { row: { companyName: "Nueva SA" } }));
    expect(ipo).not.toContain("mobileTapePivot");
    expect(ipo).toContain("<b>Nueva SA</b>");
  });
});

describe("calculadora de posición", () => {
  it("acciones = (capital × riesgo %) / (precio − stop), hacia abajo", () => {
    const out = positionSize({ capital: 100000, riskPerTradePct: 1, price: 150, stop: 136.17 });
    expect(out.ok).toBe(true);
    expect(out.shares).toBe(Math.floor(1000 / 13.83));
    expect(out.positionValue).toBeCloseTo(out.shares * 150, 6);
    expect(out.pctOfCapital).toBeCloseTo((out.shares * 150) / 1000, 6);
    expect(out.warnings).toEqual([]);
  });

  it("avisa si la posición supera el 25 % del capital o el riesgo al stop el 10 %", () => {
    const tight = positionSize({ capital: 10000, riskPerTradePct: 1, price: 100, stop: 99 });
    expect(tight.shares).toBe(100);
    expect(tight.warnings).toContain("position-over-25");
    const wide = positionSize({ capital: 10000, riskPerTradePct: 1, price: 100, stop: 80 });
    expect(wide.warnings).toEqual(["risk-over-10"]);
  });

  it("casos límite: sin stop, stop ≥ precio, precio nulo, capital o riesgo inválidos", () => {
    expect(positionSize({ capital: 1000, riskPerTradePct: 1, price: 100, stop: null })).toEqual({ ok: false, reason: "stop" });
    expect(positionSize({ capital: 1000, riskPerTradePct: 1, price: 100, stop: 100 })).toEqual({ ok: false, reason: "stop-above-price" });
    expect(positionSize({ capital: 1000, riskPerTradePct: 1, price: 100, stop: 120 }).reason).toBe("stop-above-price");
    expect(positionSize({ capital: 1000, riskPerTradePct: 1, price: null, stop: 90 }).reason).toBe("price");
    expect(positionSize({ capital: 0, riskPerTradePct: 1, price: 100, stop: 90 }).reason).toBe("capital");
    expect(positionSize({ capital: 1000, riskPerTradePct: 0, price: 100, stop: 90 }).reason).toBe("risk");
    expect(positionSize({ capital: 1000, riskPerTradePct: 101, price: 100, stop: 90 }).reason).toBe("risk");
  });

  it("riesgo extremo por acción: 0 acciones, sin dividir por cero ni NaN", () => {
    const out = positionSize({ capital: 1000, riskPerTradePct: 0.5, price: 5000, stop: 10 });
    expect(out.ok).toBe(true);
    expect(out.shares).toBe(0);
    expect(out.positionValue).toBe(0);
    expect(out.warnings).toEqual(["risk-over-10"]);
  });

  it("entrada en es-ES: miles con punto y decimales con coma", () => {
    expect(parseDecimalInput("10.000")).toBe(10000);
    expect(parseDecimalInput("10.000,5")).toBe(10000.5);
    expect(parseDecimalInput("1,5")).toBe(1.5);
    expect(parseDecimalInput("1.5")).toBe(1.5);
    expect(parseDecimalInput(" 2 500 ")).toBe(2500);
    expect(parseDecimalInput("1 %")).toBe(1);
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput(null)).toBeNull();
  });
});

describe("preferencias de la calculadora en localStorage", () => {
  const original = { window: globalThis.window, localStorage: globalThis.localStorage };
  afterEach(() => {
    globalThis.window = original.window;
    globalThis.localStorage = original.localStorage;
  });

  function install(value) {
    const store = new Map(value === undefined ? [] : [[POSITION_CALC_STORAGE_KEY, value]]);
    globalThis.window = globalThis;
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, v) => store.set(key, String(v)),
      removeItem: (key) => store.delete(key),
    };
  }

  it("JSON corrupto o con otra forma → valores por defecto (capital vacío, 1 %)", () => {
    install("{no es json");
    expect(sanitizePositionCalcSettings(safeRead(POSITION_CALC_STORAGE_KEY, null))).toEqual({ capital: null, riskPerTradePct: 1 });
    install(JSON.stringify(["x"]));
    expect(sanitizePositionCalcSettings(safeRead(POSITION_CALC_STORAGE_KEY, null))).toEqual({ capital: null, riskPerTradePct: 1 });
    install(JSON.stringify({ capital: "mucho", riskPerTradePct: 400 }));
    expect(sanitizePositionCalcSettings(safeRead(POSITION_CALC_STORAGE_KEY, null))).toEqual({ capital: null, riskPerTradePct: 1 });
    install(JSON.stringify({ capital: -5, riskPerTradePct: 0 }));
    expect(sanitizePositionCalcSettings(safeRead(POSITION_CALC_STORAGE_KEY, null))).toEqual({ capital: null, riskPerTradePct: 1 });
  });

  it("lectura que lanza (modo privado) → valores por defecto", () => {
    globalThis.window = globalThis;
    globalThis.localStorage = { getItem: () => { throw new Error("SecurityError"); } };
    expect(sanitizePositionCalcSettings(safeRead(POSITION_CALC_STORAGE_KEY, null))).toEqual({ capital: null, riskPerTradePct: 1 });
  });

  it("lo guardado válido se conserva", () => {
    install(JSON.stringify({ capital: 25000, riskPerTradePct: 0.75 }));
    expect(sanitizePositionCalcSettings(safeRead(POSITION_CALC_STORAGE_KEY, null))).toEqual({ capital: 25000, riskPerTradePct: 0.75 });
  });
});

describe("bloque «Entrada» (panel y vista rápida)", () => {
  it("con datos: pivote, distancia, zona, stop con su origen y riesgo", () => {
    const html = render(React.createElement(EntryBlock, { row: viaContraction }));
    expect(html).toContain("Entrada");
    expect(html).toContain("156,00");
    expect(html).toContain("-3,8%");
    expect(html).toContain("156,00–163,80");
    expect(html).toContain("precio por debajo");
    expect(html).toContain("136,17");
    expect(html).toContain("mín. última contracción");
    expect(html).toContain("9,2%");
    // Sin capital: la calculadora lo pide, no inventa una posición.
    expect(html).toContain("Indica el capital.");
    // Sin señales ni colores de compra.
    expect(html).not.toMatch(/comprar|compra\b|buy/i);
  });

  it("con nulos: «—» en cada dato, nunca 0, y la calculadora no calcula", () => {
    const html = render(React.createElement(EntryBlock, { row: nulls }));
    expect((html.match(/entryAbsent[^>]*>—</g) || []).length).toBe(5);
    expect(html).not.toMatch(/>0</);
    expect(html).not.toContain("0,00");
    expect(html).not.toContain("0,0%");
  });

  it("MM10s como stop cuando no hay contracción; stop por encima del precio → «—»", () => {
    const viaMa = render(React.createElement(EntryBlock, { row: { ...base, weeklyFastMa: 140 } }));
    expect(viaMa).toContain("MM10s");
    expect(viaMa).toContain("140,00");
    const above = render(React.createElement(EntryBlock, { row: { ...base, weeklyFastMa: 151 } }));
    expect(above).toContain("no está por debajo del precio");
    expect(above).not.toContain("MM10s</small>");
  });

  it("panel de escritorio y vista rápida móvil montan el bloque", () => {
    const peek = render(React.createElement(HuntPeekPanel, { row: viaContraction }));
    expect(peek).toContain("entryBlock entryBlock--desktop");
    const sheet = render(React.createElement(MobilePeekSheet, { rows: [viaContraction], index: 0 }));
    expect(sheet).toContain("entryBlock entryBlock--mobile");
  });
});

describe("proyección ligera: el nocturno guarda los dos stops", () => {
  it("lastContractionLow y weeklyFastMa viajan en la fila ligera", () => {
    expect(SCAN_LIGHT_FIELDS).toContain("lastContractionLow");
    expect(SCAN_LIGHT_FIELDS).toContain("weeklyFastMa");
    const metrics = scanLightMetrics({ symbol: "X", price: 10, lastContractionLow: 9.1, weeklyFastMa: 9.5 });
    expect(metrics.lastContractionLow).toBe(9.1);
    expect(metrics.weeklyFastMa).toBe(9.5);
  });

  it("transporte de mesa: una fila completa antigua deriva el mínimo de sus contractionSwings", () => {
    const out = projectScanRowForMesaTransport({ ...viaContraction, weeklyFastMa: 140 });
    expect(out.contractionSwings).toBeUndefined();
    expect(out.lastContractionLow).toBe(136.17);
    expect(out.weeklyFastMa).toBe(140);
    expect(stopReferenceForRow(out)).toEqual({ value: 136.17, source: "contraction" });
    expect(projectScanRowForMesaTransport(base).lastContractionLow).toBeUndefined();
  });
});
