// Tests focused en `lib/chartSeriesModel.js` (ADR §5.2 / §8 / §9.5).
//
// Cobertura:
//   - Proyecciones principales: `projectCandles`, `projectLineSeries`,
//     `projectAreaSeries` — formas canónicas y comportamiento en filas < 2.
//   - Indicadores: `projectVolumeSeries`, `movingAverage`,
//     `projectMovingAverages` (con y sin flags booleanos).
//   - RS: `projectRsRatingSeries`, `projectBenchmarkLineSeries`,
//     `projectRsVisibleRangeSummary`, gating intradía.
//   - Pattern markers: `projectPatternMarkers` (sin `color`, gating D-only).
//   - Helper: `shouldRenderRsLine`.

import { describe, expect, it } from "vitest";
import {
  movingAverage,
  projectAreaSeries,
  projectBenchmarkLineSeries,
  projectCandles,
  projectLineSeries,
  projectMovingAverages,
  projectPatternMarkers,
  projectRsRatingSeries,
  projectRsVisibleRangeSummary,
  projectVolumeSeries,
  rsLineHistory,
  RS_LINE_MIN_WEEKS,
  shouldRenderRsLine,
} from "@/lib/chartSeriesModel";

// 200 barras diarias, cierre con tendencia determinista (start=100, +0.1/día).
function buildDailyRows({ count = 200, start = 100, step = 0.1 } = {}) {
  const baseDate = Date.UTC(2024, 0, 1) / 1000;
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const close = start + index * step;
    rows.push({
      time: baseDate + index * 86400,
      date: new Date((baseDate + index * 86400) * 1000).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 100000 + index * 100,
    });
  }
  return rows;
}

describe("chartSeriesModel · velas / líneas / área", () => {
  it("projectCandles devuelve OHLC ordenado por time", () => {
    const rows = buildDailyRows({ count: 50 });
    const candles = projectCandles(rows);

    expect(candles).toHaveLength(50);
    expect(candles[0]).toEqual({
      time: rows[0].time,
      open: rows[0].open,
      high: rows[0].high,
      low: rows[0].low,
      close: rows[0].close,
    });
    expect(candles.at(-1).time).toBe(rows.at(-1).time);
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
    }
  });

  it("projectCandles devuelve [] cuando hay menos de 2 filas", () => {
    expect(projectCandles([])).toEqual([]);
    expect(projectCandles([buildDailyRows({ count: 1 })[0]])).toEqual([]);
  });

  it("projectLineSeries y projectAreaSeries exponen { time, value } desde close", () => {
    const rows = buildDailyRows({ count: 30 });
    const line = projectLineSeries(rows, "D");
    const area = projectAreaSeries(rows, "D");

    expect(line).toHaveLength(30);
    expect(area).toEqual(line);
    expect(line[0]).toEqual({ time: rows[0].time, value: rows[0].close });
  });

  it("projectLineSeries agrega por clave semanal ISO en intervalo W", () => {
    const rows = buildDailyRows({ count: 14 });
    const line = projectLineSeries(rows, "W");

    // 14 días = 2 semanas completas (lun-dom). Cada punto agregado usa el
    // último cierre del grupo, por tanto la primera entrada corresponde al
    // cierre del último día de la semana 1 (rows[6]) y la última al cierre
    // del último día de la semana 2 (rows[13]).
    expect(line).toHaveLength(2);
    expect(line[0].value).toBe(rows[6].close);
    expect(line.at(-1).value).toBe(rows.at(-1).close);
  });
});

describe("chartSeriesModel · volumen y medias móviles", () => {
  it("projectVolumeSeries produce { time, value } con fallback 0", () => {
    const rows = buildDailyRows({ count: 10 });
    const volume = projectVolumeSeries(rows);

    expect(volume).toHaveLength(10);
    expect(volume[0]).toEqual({ time: rows[0].time, value: rows[0].volume });
    expect(volume.at(-1).value).toBe(rows.at(-1).volume);
  });

  it("movingAverage devuelve [] si las filas son insuficientes", () => {
    const rows = buildDailyRows({ count: 10 });
    expect(movingAverage(rows, 50)).toEqual([]);
  });

  it("movingAverage devuelve la SMA alineada con el último cierre del grupo", () => {
    const rows = buildDailyRows({ count: 60, start: 100, step: 1 });
    const ma = movingAverage(rows, 50);

    expect(ma).toHaveLength(11); // rows.length - length + 1 = 60-50+1
    // Primera salida = filas[49], promedio 100..149 = 124.5
    expect(ma[0].time).toBe(rows[49].time);
    expect(ma[0].value).toBeCloseTo(124.5, 5);
    // Última salida = filas[59], promedio 110..159 = 134.5
    expect(ma.at(-1).time).toBe(rows[59].time);
    expect(ma.at(-1).value).toBeCloseTo(134.5, 5);
  });

  it("projectMovingAverages respeta flags y clamping", () => {
    const rows = buildDailyRows({ count: 60 });

    const all = projectMovingAverages(rows, {
      maFast: true,
      maSlow: true,
      maFastLength: 50,
      maSlowLength: 200,
    });
    expect(all.fast).toHaveLength(11);
    expect(all.slow).toEqual([]); // 200 > 60 → vacío

    const off = projectMovingAverages(rows, { maFast: false, maSlow: false, maFastLength: 50, maSlowLength: 50 });
    expect(off.fast).toEqual([]);
    expect(off.slow).toEqual([]);
  });
});

describe("chartSeriesModel · RS (rating y línea)", () => {
  it("projectRsRatingSeries acepta array plano y formato { points }", () => {
    const rows = buildDailyRows({ count: 10 });
    const start = rows[0].time;
    const end = rows.at(-1).time;

    const plain = projectRsRatingSeries(rows, [
      { time: start + 86400, date: "2024-01-02", value: 70.5 },
      { time: end, date: "2024-01-10", value: 80.123 },
    ], { rsLine: true });

    const wrapped = projectRsRatingSeries(rows, {
      points: [
        { time: start + 86400, snapshotDate: "2024-01-02", rating: 70 },
        { time: end, snapshotDate: "2024-01-10", rating: 80 },
      ],
    }, { rsLine: true });

    expect(plain).toHaveLength(2);
    expect(plain.at(-1).value).toBe(80.12);
    expect(wrapped).toHaveLength(2);
  });

  it("projectRsRatingSeries descarta puntos fuera de la ventana de rows", () => {
    const rows = buildDailyRows({ count: 10 });
    const out = projectRsRatingSeries(rows, [
      { time: rows[0].time - 99999, value: 10 }, // antes
      { time: rows.at(-1).time, value: 90 }, // dentro
      { time: rows.at(-1).time + 99999, value: 10 }, // después
    ], { rsLine: true });

    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(90);
  });

  it("projectRsRatingSeries devuelve [] en intradía", () => {
    const rows = buildDailyRows({ count: 10 });
    expect(projectRsRatingSeries(rows, [{ time: rows[0].time, value: 50 }], { rsLine: true }, "15m")).toEqual([]);
  });

  it("projectRsRatingSeries devuelve [] si rsLine está desactivado", () => {
    const rows = buildDailyRows({ count: 10 });
    expect(projectRsRatingSeries(rows, [{ time: rows[0].time, value: 50 }], { rsLine: false })).toEqual([]);
  });

  it("projectBenchmarkLineSeries produce rawValue (lineal) y value (log) desde base", () => {
    const rows = buildDailyRows({ count: 10 });
    const points = projectBenchmarkLineSeries(rows, [
      { time: rows[0].time, rsLine: 100, date: "2024-01-01" },
      { time: rows[5].time, rsLine: 110, date: "2024-01-06" },
      { time: rows.at(-1).time, rsLine: 90, date: "2024-01-10" },
    ], "D", { rsLine: true });

    expect(points).toHaveLength(3);
    // El pipeline aplica `.toFixed(2)` para `value` y `rawValue`, por lo que
    // basta con `toBeCloseTo(..., 2)` (precisión consistente con el contrato
    // canónico del componente original).
    expect(points[0].rawValue).toBeCloseTo(100, 2);
    expect(points[0].value).toBeCloseTo(0, 2);
    expect(points[1].rawValue).toBeCloseTo(110, 2);
    expect(points[1].value).toBeCloseTo(Math.log(1.1) * 100, 2);
    expect(points.at(-1).rawValue).toBeCloseTo(90, 2);
    expect(points.at(-1).value).toBeCloseTo(Math.log(0.9) * 100, 2);
  });

  it("projectBenchmarkLineSeries devuelve [] si la base no es positiva", () => {
    const rows = buildDailyRows({ count: 5 });
    expect(projectBenchmarkLineSeries(rows, [
      { time: rows[0].time, rsLine: 0 },
      { time: rows.at(-1).time, rsLine: -1 },
    ], "D", { rsLine: true })).toEqual([]);
  });

  it("projectRsVisibleRangeSummary devuelve score/changePct/positionScore", () => {
    const summary = projectRsVisibleRangeSummary([
      { rawValue: 100 },
      { rawValue: 110 },
      { rawValue: 120 },
    ]);

    expect(summary.score).toBeGreaterThan(50);
    expect(summary.changePct).toBeCloseTo(20, 5);
    expect(summary.positionScore).toBe(99);
  });

  it("projectRsVisibleRangeSummary devuelve null si los puntos son insuficientes", () => {
    expect(projectRsVisibleRangeSummary([])).toBeNull();
    expect(projectRsVisibleRangeSummary([{ rawValue: 100 }])).toBeNull();
  });
});

describe("chartSeriesModel · pattern markers", () => {
  it("projectPatternMarkers devuelve descriptores sin color y solo en intervalo D", () => {
    const rows = buildDailyRows({ count: 30 });
    const overlay = {
      contractionSwings: [
        { toDate: rows[5].date },
        { toDate: rows[10].date },
        { toDate: rows[15].date },
      ],
    };

    const markers = projectPatternMarkers(overlay, rows, "D");

    expect(markers).toHaveLength(3);
    for (const marker of markers) {
      expect(marker).not.toHaveProperty("color"); // ADR §5.2: sin color.
      expect(typeof marker.time).toBe("number");
      expect(marker.position).toBe("belowBar");
      expect(marker.shape).toBe("circle");
      expect(marker.size).toBe(1);
    }
    expect(markers.map((m) => m.text)).toEqual(["C1", "C2", "C3"]);
  });

  it("projectPatternMarkers descarta swings sin fecha resoluble", () => {
    const rows = buildDailyRows({ count: 10 });
    const markers = projectPatternMarkers(
      { contractionSwings: [{ toDate: "1999-01-01" }, { toDate: rows[5].date }] },
      rows,
      "D",
    );

    expect(markers).toHaveLength(1);
    expect(markers[0].text).toBe("C2");
  });

  it("projectPatternMarkers devuelve [] fuera de intervalo D", () => {
    const rows = buildDailyRows({ count: 10 });
    const overlay = { contractionSwings: [{ toDate: rows[5].date }] };

    expect(projectPatternMarkers(overlay, rows, "W")).toEqual([]);
    expect(projectPatternMarkers(overlay, rows, "1H")).toEqual([]);
    expect(projectPatternMarkers(null, rows, "D")).toEqual([]);
  });
});

describe("chartSeriesModel · shouldRenderRsLine", () => {
  it("false cuando rsLine desactivado o intradía o sin puntos", () => {
    expect(shouldRenderRsLine({ rsLine: false }, false, 100)).toBe(false);
    expect(shouldRenderRsLine({ rsLine: true }, true, 100)).toBe(false);
    expect(shouldRenderRsLine({ rsLine: true }, false, 1)).toBe(false);
  });

  it("true solo con rsLine activo, no intradía y >1 punto", () => {
    expect(shouldRenderRsLine({ rsLine: true }, false, 2)).toBe(true);
    expect(shouldRenderRsLine({ rsLine: true }, false, 90)).toBe(true);
  });
});

describe("chartSeriesModel · rsLineHistory", () => {
  it("cuenta semanas ISO distintas, no puntos", () => {
    // Cinco lecturas dentro de la misma semana (lunes a viernes) siguen
    // siendo UN dato semanal: no hay serie que dibujar.
    const sameWeek = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]
      .map((date) => ({ date, value: 60 }));
    expect(rsLineHistory(sameWeek)).toMatchObject({ weeks: 1, sufficient: false });
  });

  it("es suficiente justo al llegar al mínimo, y no antes", () => {
    const weekly = (count) => Array.from({ length: count }, (_, index) => ({
      date: new Date(Date.UTC(2026, 0, 5) + index * 7 * 86400000).toISOString().slice(0, 10),
      value: 50,
    }));
    expect(rsLineHistory(weekly(RS_LINE_MIN_WEEKS - 1))).toMatchObject({
      weeks: RS_LINE_MIN_WEEKS - 1,
      sufficient: false,
    });
    expect(rsLineHistory(weekly(RS_LINE_MIN_WEEKS))).toMatchObject({
      weeks: RS_LINE_MIN_WEEKS,
      sufficient: true,
    });
  });

  it("deriva la semana del timestamp cuando el punto no trae fecha", () => {
    const points = [0, 7, 14].map((offset) => ({ time: Date.UTC(2026, 0, 5) / 1000 + offset * 86400 }));
    expect(rsLineHistory(points).weeks).toBe(3);
  });

  it("tolera entradas vacías o no-array", () => {
    expect(rsLineHistory([])).toMatchObject({ weeks: 0, sufficient: false });
    expect(rsLineHistory(null)).toMatchObject({ weeks: 0, sufficient: false });
  });
});