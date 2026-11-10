// Frescura veraz (auditoría de filtros 2026-11, propuesta 1).
//
// La antigüedad del precio se calcula AL LEER desde la fecha real del dato
// (lastDate) hasta hoy — no desde el priceFreshnessDays que el escáner congeló
// al escribir la fila. Un escaneo restaurado tres semanas después ya no
// «parece fresco». Lo leen igual el filtro, la salud de datos, las listas y
// la marca discreta de fila (miniatura atenuada con title).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDataAgeNotice, datasetPriceIsStale, livePriceFreshness, rowDataAgeMark, rowLastDate, screenerEmptyFilterText } from "@/lib/dataAge";
import { filterAnalyzedRows } from "@/lib/screenerPipeline";
import { buildScreenerFilterExplainPlan, screenerFilterRejectReason } from "@/lib/screenerFilters";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { rowReliabilityIssues } from "@/lib/listRationale";
import { huntTapeSparkWrapProps, HUNT_TAPE_STALE_PRICE_OPACITY } from "@/lib/screenerHuntTape";
import { toDate } from "@/lib/supabaseServer";

// 2026-11-06 es viernes.
const NOW = new Date("2026-11-06T12:00:00Z");
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

// La fila del nocturno US del 2026-10-18: el escáner guardó 3 días.
const frozen = { symbol: "MSFT", lastDate: "2026-10-15", priceFreshnessDays: 3, priceFreshnessOk: true, priceFreshnessLabel: "útil", priceFreshnessMaxDays: 5 };

describe("livePriceFreshness", () => {
  it("cuenta desde lastDate hasta hoy e ignora los días guardados", () => {
    const live = livePriceFreshness(frozen, { maxDays: 5 });
    expect(live).toMatchObject({ priceFreshnessDays: 22, priceFreshnessOk: false, priceFreshnessLabel: "viejo", source: "lastDate", lastDate: "2026-10-15" });
    expect(live.priceFreshnessIssue).toBe("precio viejo: 22d > 5d");
  });

  it("lee lastDate plano o anidado en metrics/snapshot/raw", () => {
    expect(rowLastDate({ metrics: { lastDate: "2026-11-05" } })).toBe("2026-11-05");
    expect(rowLastDate({ snapshot: { lastDate: "2026-11-04T00:00:00Z" } })).toBe("2026-11-04");
    expect(livePriceFreshness({ raw: { lastDate: "2026-11-05" } }, { maxDays: 5 })).toMatchObject({ priceFreshnessDays: 1, priceFreshnessOk: true, priceFreshnessLabel: "fresco" });
  });

  it("solo sin fecha cae al valor guardado; sin nada, «sin fecha»", () => {
    expect(livePriceFreshness({ priceFreshnessDays: 2 }, { maxDays: 5 })).toMatchObject({ priceFreshnessDays: 2, priceFreshnessOk: true, source: "stored" });
    expect(livePriceFreshness({}, { maxDays: 5 })).toMatchObject({ priceFreshnessDays: null, priceFreshnessOk: false, priceFreshnessLabel: "sin fecha", source: "none" });
  });
});

describe("el filtro de frescura usa la fecha real", () => {
  it("rechaza el escaneo viejo aunque el escáner guardara 3 días", () => {
    expect(screenerFilterRejectReason(frozen, { maxPriceFreshnessDays: 5 })).toEqual({
      field: "maxPriceFreshnessDays",
      reason: "precio de hace 22d > 5d",
    });
  });

  it("deja pasar un precio de ayer y rechaza «sin dato» una fila sin fecha ni días", () => {
    expect(screenerFilterRejectReason({ lastDate: "2026-11-05" }, { maxPriceFreshnessDays: 5 })).toBe("");
    expect(screenerFilterRejectReason({}, { maxPriceFreshnessDays: 5 })).toEqual({
      field: "maxPriceFreshnessDays",
      reason: "fecha del precio sin dato",
      missingData: true,
    });
  });

  it("la explicación por fila enseña los días reales", () => {
    const plan = buildScreenerFilterExplainPlan(frozen, { maxPriceFreshnessDays: 5 });
    expect(plan.failed).toContainEqual(expect.objectContaining({ field: "maxPriceFreshnessDays", value: 22 }));
  });
});

describe("los indicadores leen la misma frescura", () => {
  it("salud de datos: viejo, con los días reales", () => {
    const health = buildScreenerDataHealth(frozen);
    expect(health.freshness).toMatchObject({ days: 22, maxDays: 5, ok: false, stale: true });
  });

  it("fiabilidad de listas: marca el precio viejo", () => {
    expect(rowReliabilityIssues(frozen, { maxPriceFreshnessDays: 5 })).toContainEqual(expect.objectContaining({ key: "stale" }));
    expect(rowReliabilityIssues({ ...frozen, lastDate: "2026-11-05" }, { maxPriceFreshnessDays: 5 }).some((item) => item.key === "stale")).toBe(false);
  });
});

describe("marca discreta de fila", () => {
  it("solo cuando el precio lleva ≥2 sesiones sin actualizar (umbral del aviso de la lista)", () => {
    expect(rowDataAgeMark({ lastDate: "2026-11-05" }, NOW)).toBeNull();
    expect(rowDataAgeMark({ lastDate: "2026-11-04" }, NOW)).toBeNull();
    expect(rowDataAgeMark({ lastDate: "2026-11-03" }, NOW)).toEqual({
      lastDate: "2026-11-03",
      missedWeekdays: 2,
      title: "Precio del 3 nov: 2 sesiones sin actualizar",
    });
    expect(rowDataAgeMark({}, NOW)).toBeNull();
  });

  it("la miniatura de la cinta se atenúa y explica la fecha en su title; al día no cambia", () => {
    expect(huntTapeSparkWrapProps({ lastDate: "2026-11-05" }, "Gráfico semanal ~12 meses", NOW)).toEqual({
      className: "huntTapeSparkWrap",
      title: "Gráfico semanal ~12 meses",
    });
    expect(huntTapeSparkWrapProps(frozen, "Gráfico semanal ~12 meses", NOW)).toEqual({
      className: "huntTapeSparkWrap",
      title: "Gráfico semanal ~12 meses · Precio del 15 oct: 15 sesiones sin actualizar",
      style: { opacity: HUNT_TAPE_STALE_PRICE_OPACITY },
      "data-stale-price": "2026-10-15",
    });
  });
});

// Origen del desfase de un día en la fecha del precio (nocturnos US del 12,
// 14, 15, 16 y 18-oct-2026 en la copia local): node-postgres parsea una
// columna `date` como Date a MEDIANOCHE LOCAL y toDate() la pasaba por
// toISOString(), que en Europe/Madrid la movía al día anterior. Toda la serie
// de daily_bars leída por caché salía corrida −1 día (viernes → jueves, lunes
// → domingo) y el precio del 16-oct quedaba fechado el 15-oct. Corregido en
// a34389a (parser de `date` como texto + toDate con componentes locales);
// este test fija la regresión.
describe("toDate con un Date de columna `date` (modo pg)", () => {
  it("devuelve el día del calendario, no el de UTC", () => {
    expect(toDate(new Date(2026, 9, 16))).toBe("2026-10-16");
    expect(toDate(new Date(2026, 9, 12))).toBe("2026-10-12");
    expect(toDate("2026-10-16")).toBe("2026-10-16");
  });
});

// Opción B (2026-11-06): si TODA la lista va atrasada (mediana de lastDate a
// ≥2 sesiones, criterio de lib/dataAge.js), el filtro de frescura no recorta;
// se ven las filas con el aviso único y la marca por fila. Solo recorta con
// datos mixtos. Igual por reglas y por el atajo del veredicto nocturno.
describe("opción B: frescura en pausa cuando toda la lista va atrasada", () => {
  const settings = { maxPriceFreshnessDays: 5 };
  const precomputed = { enabled: true, values: { ...settings } };
  const base = (symbol, lastDate) => ({ symbol, lastDate, chartBarsCount: 250, price: 30, sma50: 28, sma150: 26, sma200: 24, sma200Slope: 0.3, weeklyStageState: "stage2", weeklyFastWeeks: 30, weeklySlowWeeks: 40, totalScore: 60, objectiveScore: 60 });
  // El nocturno escribió su veredicto el día del escaneo, con precios al día.
  const stamp = (rows) => {
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    const out = rows.map((row) => ({ ...row, screenPassed: !screenerFilterRejectReason(row, precomputed, { stage: "scan" }), screenRejectField: null }));
    vi.setSystemTime(NOW);
    return out;
  };
  const views = (rows) => [
    filterAnalyzedRows(rows, settings, { useRegimeFilter: false }),
    filterAnalyzedRows(stamp(rows), settings, { useRegimeFilter: false, screenerFilters: precomputed }),
  ];

  it("todo viejo: no recorta por frescura (reglas y atajo) y lo dice el diagnóstico", () => {
    const rows = [base("A", "2026-10-15"), base("B", "2026-10-16"), base("C", "2026-10-15")];
    expect(datasetPriceIsStale(rows, NOW)).toBe(true);
    const [rules, fast] = views(rows);
    expect(rules.path).toBe("rules");
    expect(fast.path).toBe("screen-passed");
    for (const view of [rules, fast]) {
      expect(view.rows.map((row) => row.symbol).sort()).toEqual(["A", "B", "C"]);
      expect(view.diagnostics).toMatchObject({ freshnessSuspended: true, freshnessRejected: 0 });
    }
  });

  it("mixto: recorta solo las filas atrasadas (reglas y atajo)", () => {
    const rows = [base("A", "2026-11-05"), base("B", "2026-11-05"), base("OLD", "2026-10-15")];
    expect(datasetPriceIsStale(rows, NOW)).toBe(false);
    for (const view of views(rows)) {
      expect(view.rows.map((row) => row.symbol).sort()).toEqual(["A", "B"]);
      expect(view.diagnostics).toMatchObject({ freshnessSuspended: false, freshnessRejected: 1 });
    }
  });

  it("todo fresco: no recorta nada", () => {
    const rows = [base("A", "2026-11-05"), base("B", "2026-11-04")];
    for (const view of views(rows)) {
      expect(view.rows).toHaveLength(2);
      expect(view.diagnostics).toMatchObject({ freshnessSuspended: false, freshnessRejected: 0 });
    }
  });

  it("estado vacío: si la causa son precios viejos lo dice, sin «Afloja alguna condición»", () => {
    expect(screenerEmptyFilterText(3, { freshnessRejected: 3, freshnessMaxDays: 5 })).toBe("Ningún valor de los 3 analizados pasa: todos tienen el precio de más de 5 días.");
    expect(screenerEmptyFilterText(10, { freshnessRejected: 4, freshnessMaxDays: 5 })).toBe("Ningún valor de los 10 analizados pasa: 4 quedan fuera por precio de más de 5 días y el resto no cumple el filtro.");
    expect(screenerEmptyFilterText(10, { freshnessRejected: 0 })).toMatch(/Afloja alguna condición/);
  });

  it("el aviso de precios viejos no promete resultados (no contradice una lista vacía)", () => {
    const notice = buildDataAgeNotice([{ lastDate: "2026-10-15" }], NOW);
    expect(notice.detail).not.toMatch(/resultados siguen siendo válidos/);
    expect(notice.detail).toMatch(/el filtro de frescura no recorta/);
  });
});
