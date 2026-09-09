import { describe, expect, it } from "vitest";
import { weekKey } from "@/lib/chartDataModel";
import {
  MARKET_HEALTH_SERIES_MAX_POINTS,
  buildRegimePointFromPayload,
  mergeRegimeSeries,
  normalizeRegimeSeries,
  regimeSeriesDelta,
} from "@/lib/marketHealthSeries";

describe("mergeRegimeSeries", () => {
  const w31 = { weekKey: "2026-W31", asOf: "2026-07-31T12:00:00.000Z", marketScore: 55, above30wPct: 60 };
  const w32a = { weekKey: "2026-W32", asOf: "2026-08-07T12:00:00.000Z", marketScore: 58, above30wPct: 62 };
  const w32b = { weekKey: "2026-W32", asOf: "2026-08-08T12:00:00.000Z", marketScore: 61, above30wPct: 64 };
  const w33 = { weekKey: "2026-W33", asOf: "2026-08-14T12:00:00.000Z", marketScore: 63, above30wPct: 66 };

  it("ordena cronológicamente y deduplica por weekKey (última gana)", () => {
    const merged = mergeRegimeSeries([w33, w31, w32a], w32b);
    expect(merged.map((p) => p.weekKey)).toEqual(["2026-W31", "2026-W32", "2026-W33"]);
    expect(merged[1].marketScore).toBe(61);
    expect(merged[1].above30wPct).toBe(64);
  });

  it("capa a 13 puntos conservando los más recientes", () => {
    const points = Array.from({ length: 15 }, (_, index) => ({
      weekKey: `2026-W${String(index + 1).padStart(2, "0")}`,
      asOf: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
      marketScore: 50 + index,
      above30wPct: 40 + index,
    }));
    const capped = normalizeRegimeSeries(points);
    expect(capped).toHaveLength(MARKET_HEALTH_SERIES_MAX_POINTS);
    expect(capped[0].weekKey).toBe("2026-W03");
    expect(capped.at(-1).weekKey).toBe("2026-W15");
  });

  it("regimeSeriesDelta devuelve null con menos de 2 puntos", () => {
    expect(regimeSeriesDelta([])).toBeNull();
    expect(regimeSeriesDelta([w31])).toBeNull();
  });

  it("regimeSeriesDelta calcula Δ score y Δ amplitud vs semana previa", () => {
    const delta = regimeSeriesDelta([w31, w32b, w33]);
    expect(delta.current.weekKey).toBe("2026-W33");
    expect(delta.previous.weekKey).toBe("2026-W32");
    expect(delta.marketScoreDelta).toBe(2);
    expect(delta.above30wPctDelta).toBe(2);
  });
});

describe("buildRegimePointFromPayload", () => {
  it("prioriza amplitud US del escaneo nocturno sobre breadthProxy de índices", () => {
    const point = buildRegimePointFromPayload({
      generatedAt: "2026-09-05T15:00:00.000Z",
      marketScore: 72,
      regime: { label: "Mercado constructivo pero selectivo" },
      breadthProxy: { pctAbove30w: 40 },
      regimes: {
        US: {
          breadth: {
            above30w: { available: true, pct: 68, count: 2200, measured: 3200 },
          },
        },
      },
    });
    expect(point.weekKey).toBe(weekKey("2026-09-05"));
    expect(point.marketScore).toBe(72);
    expect(point.above30wPct).toBe(68);
    expect(point.above30w).toEqual({ count: 2200, measured: 3200 });
    expect(point.regimeLabel).toMatch(/constructivo/i);
  });
});
