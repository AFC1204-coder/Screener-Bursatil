import { describe, expect, it } from "vitest";

import { dedupeWeeklyRsSeriesByWeekKey } from "@/lib/rsWeeklySeries";

describe("dedupeWeeklyRsSeriesByWeekKey", () => {
  it("con dos filas mismo weekKey conserva la de snapshot_date más reciente", () => {
    const series = dedupeWeeklyRsSeriesByWeekKey([
      { date: "2026-08-01", weekKey: "2026-W32", rsRating: 80 },
      { date: "2026-08-08", weekKey: "2026-W32", rsRating: 70 },
      { date: "2026-08-29", weekKey: "2026-W35", rsRating: 64 },
    ]);

    expect(series).toHaveLength(2);
    expect(series.map((p) => p.weekKey)).toEqual(["2026-W32", "2026-W35"]);
    expect(series[0].rsRating).toBe(70);
    expect(series[0].date).toBe("2026-08-08");
    expect(series.at(-1).rsRating).toBe(64);
  });

  it("reproduce caso AAPL W32×2: un punto por semana y latest correcto", () => {
    const series = dedupeWeeklyRsSeriesByWeekKey([
      { date: "2026-07-25", weekKey: "2026-W30", rsRating: 75 },
      { date: "2026-08-01", weekKey: "2026-W32", rsRating: 80 },
      { date: "2026-08-08", weekKey: "2026-W32", rsRating: 70 },
      { date: "2026-08-29", weekKey: "2026-W35", rsRating: 64 },
    ]);

    expect(series.map((p) => `${p.weekKey}:${p.rsRating}`)).toEqual([
      "2026-W30:75",
      "2026-W32:70",
      "2026-W35:64",
    ]);
    expect(series.at(-1)).toMatchObject({ weekKey: "2026-W35", rsRating: 64 });
  });

  it("con weekKeys únicos devuelve la serie ordenada sin cambios", () => {
    const input = [
      { date: "2026-05-15", weekKey: "2026-W20", rsRating: 97 },
      { date: "2026-05-25", weekKey: "2026-W22", rsRating: 99 },
    ];
    const series = dedupeWeeklyRsSeriesByWeekKey(input);

    expect(series).toEqual(input);
  });

  it("ordena ascendente por date tras dedupe", () => {
    const series = dedupeWeeklyRsSeriesByWeekKey([
      { date: "2026-08-29", weekKey: "2026-W35", rsRating: 64 },
      { date: "2026-08-01", weekKey: "2026-W32", rsRating: 80 },
      { date: "2026-08-08", weekKey: "2026-W32", rsRating: 70 },
    ]);

    expect(series.map((p) => p.date)).toEqual(["2026-08-08", "2026-08-29"]);
  });
});
