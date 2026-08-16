// tests/marketBreadth.test.js — la amplitud del universo se agrega sobre el
// escaneo nocturno con cobertura declarada por indicador.
//
// docs/principios-producto.md, principio 3: un indicador medido sobre menos
// del umbral de población se declara ausente, no se sirve parcial. Y la
// divergencia índice/participación se describe con números medidos, sin
// predicción: aquí se fija el cálculo puro que alimenta esa frase.

import { describe, expect, it } from "vitest";
import {
  aggregateUniverseBreadth,
  attachIndexCloses,
  BREADTH_MIN_COVERAGE_PCT,
  dedupeWeeklySnapshots,
  participationSummary,
} from "@/lib/marketBreadth";

function row(overrides = {}) {
  return {
    symbol: "AAA",
    country: "US",
    stage: "stage2",
    extSma50: 5,
    sma200Slope: 1,
    distance52w: -4,
    upDownVolRatio: 1.2,
    lastDate: "2026-08-14",
    ...overrides,
  };
}

describe("aggregateUniverseBreadth", () => {
  it("cuenta cada indicador sobre su población medida y declara la fecha del dato", () => {
    const rows = [
      row(),
      row({ symbol: "BBB", stage: "base", extSma50: -2, sma200Slope: -1, distance52w: -0.5, upDownVolRatio: 0.8 }),
      row({ symbol: "CCC", stage: "stage4", extSma50: -30, sma200Slope: -2, distance52w: -45, upDownVolRatio: 0.5 }),
      row({ symbol: "DDD", stage: "mixed", extSma50: 0, distance52w: -31 }),
    ];
    const breadth = aggregateUniverseBreadth(rows);
    expect(breadth.population).toBe(4);
    expect(breadth.dataAsOf).toBe("2026-08-14");
    expect(breadth.staleRows).toBe(0);
    const byKey = Object.fromEntries(breadth.indicators.map((item) => [item.key, item]));
    // stage2 + base = sobre la media de 30 semanas (lib/weeklyStage.js).
    expect(byKey.above30w.count).toBe(2);
    expect(byKey.above30w.measured).toBe(4);
    // extSma50 >= 0 cuenta el 0 exacto como sobre la media, igual que el screener.
    expect(byKey.aboveSma50.count).toBe(2);
    expect(byKey.sma200Up.count).toBe(2);
    expect(byKey.nearHigh52w.count).toBe(1);
    expect(byKey.deepBelowHigh52w.count).toBe(2);
    // AAA y DDD llevan ratio 1.2 (DDD hereda el del fixture): dos sobre 1.
    expect(byKey.upVolume.count).toBe(2);
    expect(breadth.stages.buckets.find((bucket) => bucket.key === "stage2").count).toBe(1);
    expect(breadth.stages.unclassified).toBe(0);
  });

  it("declara ausente un indicador con cobertura bajo el umbral, sin inventar un número", () => {
    // 10 filas, solo 3 con pendiente de SMA200: 30% < umbral.
    const rows = Array.from({ length: 10 }, (_, index) => row({
      symbol: `S${index}`,
      sma200Slope: index < 3 ? 1 : null,
    }));
    const breadth = aggregateUniverseBreadth(rows);
    const sma200 = breadth.indicators.find((item) => item.key === "sma200Up");
    expect(sma200.available).toBe(false);
    expect(sma200.pct).toBe(null);
    expect(sma200.count).toBe(null);
    expect(sma200.reason).toContain(`${BREADTH_MIN_COVERAGE_PCT}%`);
    // Los demás indicadores, con cobertura completa, siguen disponibles.
    expect(breadth.indicators.find((item) => item.key === "aboveSma50").available).toBe(true);
  });

  it("declara ausente la distribución por etapas si la etapa semanal no cubre", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row({
      symbol: `S${index}`,
      stage: index < 5 ? "stage2" : "insufficient_history",
    }));
    const breadth = aggregateUniverseBreadth(rows);
    expect(breadth.stages.available).toBe(false);
    expect(breadth.stages.buckets.every((bucket) => bucket.count === null)).toBe(true);
    expect(breadth.stages.unclassified).toBe(5);
  });

  it("cuenta filas con precio más viejo que la fecha del dato y agrega por país", () => {
    const rows = [
      row(),
      row({ symbol: "OLD", lastDate: "2026-08-01" }),
      row({ symbol: "JPN", country: "JP", extSma50: -1 }),
    ];
    const breadth = aggregateUniverseBreadth(rows);
    expect(breadth.dataAsOf).toBe("2026-08-14");
    expect(breadth.staleRows).toBe(1);
    expect(breadth.countries.US).toEqual({ total: 2, sma50Measured: 2, sma50Above: 2 });
    expect(breadth.countries.JP).toEqual({ total: 1, sma50Measured: 1, sma50Above: 0 });
  });
});

describe("dedupeWeeklySnapshots", () => {
  it("se queda con el último snapshot de cada semana, en orden temporal", () => {
    // 2026-W32 tuvo tres corridas reales (08-07, 08-08, 08-09): vale la última.
    const weeks = dedupeWeeklySnapshots([
      { date: "2026-08-09", weekKey: "2026-W32", sampleSize: 4868 },
      { date: "2026-08-07", weekKey: "2026-W32", sampleSize: 4865 },
      { date: "2026-08-08", weekKey: "2026-W32", sampleSize: 4217 },
      { date: "2026-07-31", weekKey: "2026-W31", sampleSize: 4860 },
    ]);
    expect(weeks.map((week) => week.date)).toEqual(["2026-07-31", "2026-08-09"]);
    expect(weeks.at(-1).sampleSize).toBe(4868);
  });
});

describe("attachIndexCloses", () => {
  it("asigna el cierre de la fecha del snapshot o el último anterior (festivos)", () => {
    const weeks = [
      { date: "2026-08-07", weekKey: "2026-W32" },
      { date: "2026-08-14", weekKey: "2026-W33" },
    ];
    const bars = [
      { trade_date: "2026-08-06", close: 100 },
      { trade_date: "2026-08-13", close: 110 },
      { trade_date: "2026-08-14", close: 111 },
    ];
    const withCloses = attachIndexCloses(weeks, bars);
    expect(withCloses[0].indexClose).toBe(100);
    expect(withCloses[1].indexClose).toBe(111);
  });

  it("deja el cierre ausente si no hay barra anterior al snapshot", () => {
    const withCloses = attachIndexCloses(
      [{ date: "2026-01-02", weekKey: "2026-W01" }],
      [{ trade_date: "2026-02-01", close: 100 }],
    );
    expect(withCloses[0].indexClose).toBe(null);
  });
});

describe("participationSummary", () => {
  const week = (date, pct, indexClose) => ({ date, weekKey: date, pct, indexClose });

  it("mide la ventana y marca divergencia solo si el índice sube y la participación baja", () => {
    const summary = participationSummary([
      week("2026-05-01", 60, 100),
      week("2026-05-08", 58, 103),
      week("2026-05-15", 55, 106),
    ], 3);
    expect(summary.weeks).toBe(3);
    expect(summary.indexChangePct).toBeCloseTo(6);
    expect(summary.participationDeltaPp).toBeCloseTo(-5);
    expect(summary.divergence).toBe(true);
  });

  it("no marca divergencia cuando la participación acompaña al índice", () => {
    const summary = participationSummary([
      week("2026-05-01", 55, 100),
      week("2026-05-08", 59, 104),
    ], 2);
    expect(summary.divergence).toBe(false);
  });

  it("devuelve null sin dos semanas comparables (índice y participación medidos)", () => {
    expect(participationSummary([week("2026-05-01", 60, 100)])).toBe(null);
    expect(participationSummary([
      week("2026-05-01", 60, null),
      week("2026-05-08", 58, null),
    ])).toBe(null);
  });

  it("recorta a la ventana pedida: las semanas viejas no entran en la variación", () => {
    const summary = participationSummary([
      week("2026-04-01", 40, 90),
      week("2026-05-01", 60, 100),
      week("2026-05-08", 61, 101),
    ], 2);
    expect(summary.participationStartPct).toBe(60);
    expect(summary.indexChangePct).toBeCloseTo(1);
  });
});
