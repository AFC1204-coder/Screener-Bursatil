import { describe, expect, it } from "vitest";
import { PERIOD_RETURN_FIELDS, periodReturns, yearToDateReturn } from "../lib/periodReturns.js";

// Barras de la más reciente a la más antigua, como en el resto del código.
function bars(closes, lastDate = "2026-11-06") {
  const out = [];
  let day = new Date(`${lastDate}T00:00:00Z`);
  for (const close of closes) {
    while ([0, 6].includes(day.getUTCDay())) day = new Date(day.getTime() - 86400000);
    out.push({ date: day.toISOString().slice(0, 10), close });
    day = new Date(day.getTime() - 86400000);
  }
  return out;
}

describe("periodReturns", () => {
  it("calcula 1 día, 1 semana y 1 mes con la convención de perf() (5 y 21 sesiones)", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 - i); // 100, 99, 98 … (más reciente primero)
    const r = periodReturns(bars(closes));
    expect(r.perf1d).toBeCloseTo((100 / 99 - 1) * 100, 2);
    expect(r.perf1w).toBeCloseTo((100 / 95 - 1) * 100, 2);
    expect(r.perf1m).toBeCloseTo((100 / 79 - 1) * 100, 2);
  });

  it("devuelve null, nunca 0, si no hay histórico suficiente", () => {
    const r = periodReturns(bars([10, 9, 8]));
    expect(r.perf1d).not.toBeNull();
    expect(r.perf1w).toBeNull();
    expect(r.perf1m).toBeNull();
    expect(periodReturns([])).toEqual({ perf1d: null, perf1w: null, perf1m: null, perfYtd: null });
    expect(periodReturns(undefined).perf1m).toBeNull();
  });

  it("no inventa un rendimiento con cierres no válidos", () => {
    const b = bars(Array.from({ length: 30 }, () => 10));
    b[5].close = 0;
    b[21].close = null;
    const r = periodReturns(b);
    expect(r.perf1w).toBeNull();
    expect(r.perf1m).toBeNull();
    expect(r.perf1d).toBe(0); // dos cierres válidos iguales: 0 % real, no ausencia
  });

  it("un descenso da rendimiento negativo", () => {
    const r = periodReturns(bars([90, 95, 96, 97, 98, 100, 100, 100]));
    expect(r.perf1w).toBeCloseTo((90 / 100 - 1) * 100, 2);
    expect(r.perf1d).toBeLessThan(0);
  });
});

describe("yearToDateReturn", () => {
  it("mide contra el último cierre del año anterior", () => {
    const b = [
      { date: "2026-11-06", close: 120 },
      { date: "2026-06-01", close: 110 },
      { date: "2026-01-02", close: 104 },
      { date: "2025-12-31", close: 100 },
      { date: "2025-12-30", close: 90 },
    ];
    expect(yearToDateReturn(b)).toBeCloseTo(20, 2);
  });

  it("es null si el histórico no llega al año anterior (IPO de este año o serie corta)", () => {
    const b = [
      { date: "2026-11-06", close: 120 },
      { date: "2026-03-02", close: 100 },
    ];
    expect(yearToDateReturn(b)).toBeNull();
  });

  it("en los primeros días del año sigue midiendo el año del último dato", () => {
    const b = [
      { date: "2026-01-05", close: 102 },
      { date: "2026-01-02", close: 101 },
      { date: "2025-12-31", close: 100 },
    ];
    expect(yearToDateReturn(b)).toBeCloseTo(2, 2);
  });

  it("es null con fechas ausentes o ilegibles", () => {
    expect(yearToDateReturn([{ close: 10 }, { close: 9 }])).toBeNull();
    expect(yearToDateReturn([{ date: "2026-11-06", close: 10 }, { date: "basura", close: 9 }])).toBeNull();
    expect(yearToDateReturn([{ date: "2026-11-06", close: 0 }, { date: "2025-12-31", close: 9 }])).toBeNull();
  });

  it("expone la lista de campos que viajan en la fila", () => {
    expect(PERIOD_RETURN_FIELDS).toEqual(["perf1d", "perf1w", "perf1m", "perfYtd"]);
  });
});
