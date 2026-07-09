import { afterEach, describe, expect, it } from "vitest";
import {
  HIT_TOLERANCE_PX,
  add,
  clipLogicalSegment,
  createTrendline,
  hitTestLines,
  list,
  pointSegmentDistance,
  projectTrendline,
  remove,
  subscribe,
  timeToFractionalIndex,
  timeToFractionalIndexExtrapolated,
  update,
  validateTrendline,
  __resetDrawingsStore,
} from "@/lib/chartDrawings";

afterEach(() => {
  __resetDrawingsStore();
});

// Serie semanal sintética: cada barra W es aprox. 5 días (5 * 86400 segundos).
const WEEKLY_ROW_TIMES = Array.from({ length: 12 }, (_, i) => 1_700_000_000 + i * 5 * 86400);
const WEEKLY_LAST = WEEKLY_ROW_TIMES[WEEKLY_ROW_TIMES.length - 1];
const WEEKLY_FIRST = WEEKLY_ROW_TIMES[0];

describe("chartDrawings · esquema y serialización", () => {
  it("createTrendline normaliza los puntos y asigna id + symbol", () => {
    const drawing = createTrendline({
      symbol: "AAPL",
      p1: { time: WEEKLY_FIRST, price: 100 },
      p2: { time: WEEKLY_LAST, price: 150 },
    });
    expect(drawing.kind).toBe("trendline");
    expect(drawing.symbol).toBe("AAPL");
    expect(drawing.points).toEqual([
      { time: WEEKLY_FIRST, price: 100 },
      { time: WEEKLY_LAST, price: 150 },
    ]);
    expect(typeof drawing.id).toBe("string");
    expect(drawing.id.length).toBeGreaterThan(0);
    expect(drawing.createdAtInterval).toBe("D");
    expect(typeof drawing.createdAt).toBe("string");
  });

  it("createTrendline lanza si los puntos no son finitos", () => {
    expect(() => createTrendline({ symbol: "AAPL", p1: { time: NaN, price: 1 }, p2: { time: 2, price: 3 } }))
      .toThrow();
    expect(() => createTrendline({ symbol: "AAPL", p1: { time: 1, price: 1 }, p2: { time: 2, price: NaN } }))
      .toThrow();
  });

  it("validateTrendline acepta sólo líneas bien formadas", () => {
    const ok = createTrendline({
      symbol: "AAPL",
      p1: { time: WEEKLY_FIRST, price: 100 },
      p2: { time: WEEKLY_LAST, price: 150 },
    });
    expect(validateTrendline(ok)).toBe(true);

    expect(validateTrendline(null)).toBe(false);
    expect(validateTrendline({ kind: "trendline" })).toBe(false);
    expect(validateTrendline({ ...ok, kind: "hline" })).toBe(false);
    expect(validateTrendline({ ...ok, points: [ok.points[0]] })).toBe(false);
    expect(validateTrendline({ ...ok, points: [ok.points[0], { time: NaN, price: 1 }] })).toBe(false);
  });

  it("la forma serializa 1:1 a JSON (futura fila Supabase)", () => {
    const drawing = createTrendline({
      symbol: "AAPL",
      p1: { time: WEEKLY_FIRST, price: 100 },
      p2: { time: WEEKLY_LAST, price: 150 },
      createdAtInterval: "D",
      createdAt: "2026-07-09T10:32:00Z",
    });
    const json = JSON.parse(JSON.stringify(drawing));
    expect(json).toEqual({
      id: drawing.id,
      symbol: "AAPL",
      kind: "trendline",
      points: [
        { time: WEEKLY_FIRST, price: 100 },
        { time: WEEKLY_LAST, price: 150 },
      ],
      createdAtInterval: "D",
      createdAt: "2026-07-09T10:32:00Z",
    });
  });
});

describe("chartDrawings · store por símbolo", () => {
  it("add/list/remove/update funcionan y están aislados por símbolo", () => {
    const dAAPL = createTrendline({
      symbol: "AAPL",
      p1: { time: WEEKLY_FIRST, price: 100 },
      p2: { time: WEEKLY_LAST, price: 150 },
    });
    const dNVDA = createTrendline({
      symbol: "NVDA",
      p1: { time: WEEKLY_FIRST, price: 200 },
      p2: { time: WEEKLY_LAST, price: 250 },
    });
    add("AAPL", dAAPL);
    add("NVDA", dNVDA);
    expect(list("AAPL")).toHaveLength(1);
    expect(list("NVDA")).toHaveLength(1);
    expect(list("AAPL")[0].id).toBe(dAAPL.id);

    const dAAPL2 = {
      ...dAAPL,
      points: [dAAPL.points[0], { time: WEEKLY_LAST, price: 175 }],
    };
    expect(update("AAPL", dAAPL2)).toBe(true);
    expect(list("AAPL")[0].points[1].price).toBe(175);

    expect(remove("AAPL", dAAPL.id)).toBe(true);
    expect(list("AAPL")).toHaveLength(0);
    expect(list("NVDA")).toHaveLength(1);
  });

  it("subscribe notifica a todos los suscriptores del símbolo", () => {
    const d = createTrendline({
      symbol: "AAPL",
      p1: { time: WEEKLY_FIRST, price: 100 },
      p2: { time: WEEKLY_LAST, price: 150 },
    });
    const events = [];
    const unsub = subscribe("AAPL", (list) => events.push(list.length));
    add("AAPL", d);
    update("AAPL", { ...d, points: [d.points[0], { time: WEEKLY_LAST, price: 160 }] });
    remove("AAPL", d.id);
    unsub();
    add("AAPL", d);
    expect(events).toEqual([1, 1, 0]);
  });
});

describe("chartDrawings · proyección time ↔ índice lógico fraccional", () => {
  it("interpolación exacta dentro del rango", () => {
    // mitad exacta entre la barra 1 y la barra 2 → índice lógico 1.5
    const t = (WEEKLY_ROW_TIMES[1] + WEEKLY_ROW_TIMES[2]) / 2;
    expect(timeToFractionalIndex(WEEKLY_ROW_TIMES, t)).toBeCloseTo(1.5, 6);
  });

  it("ancla con tiempo que NO coincide con una barra (caso W/M)", () => {
    // Tiempo cualquiera que cae entre dos barras — el caso real que motiva
    // la interpolación porque timeToCoordinate() devuelve null.
    const t = WEEKLY_ROW_TIMES[3] + (WEEKLY_ROW_TIMES[4] - WEEKLY_ROW_TIMES[3]) * 0.3;
    const idx = timeToFractionalIndex(WEEKLY_ROW_TIMES, t);
    expect(idx).toBeGreaterThan(3);
    expect(idx).toBeLessThan(4);
    expect(idx).toBeCloseTo(3.3, 6);
  });

  it("ancla exactamente sobre una barra devuelve su índice entero", () => {
    expect(timeToFractionalIndex(WEEKLY_ROW_TIMES, WEEKLY_ROW_TIMES[5])).toBe(5);
  });

  it("tiempo anterior al primero → 0", () => {
    expect(timeToFractionalIndex(WEEKLY_ROW_TIMES, WEEKLY_FIRST - 100)).toBe(0);
  });

  it("tiempo posterior al último → length-1", () => {
    expect(timeToFractionalIndex(WEEKLY_ROW_TIMES, WEEKLY_LAST + 100)).toBe(WEEKLY_ROW_TIMES.length - 1);
  });

  it("extrapolación usa el delta del último par", () => {
    const step = WEEKLY_ROW_TIMES[1] - WEEKLY_ROW_TIMES[0];
    // Ancla un step más allá del último: extrapolación = (n-1) + step/step = n.
    const idx = timeToFractionalIndexExtrapolated(WEEKLY_ROW_TIMES, WEEKLY_LAST + step);
    expect(idx).toBeCloseTo(WEEKLY_ROW_TIMES.length, 6);
    // Ancla a mitad del último step: índice entre (n-1) y n.
    const idxInside = timeToFractionalIndexExtrapolated(WEEKLY_ROW_TIMES, WEEKLY_LAST + step * 0.5);
    expect(idxInside).toBeGreaterThan(WEEKLY_ROW_TIMES.length - 1);
    expect(idxInside).toBeLessThan(WEEKLY_ROW_TIMES.length);
    // Ancla anterior al primero: extrapolación negativa hacia 0.
    const idxBefore = timeToFractionalIndexExtrapolated(WEEKLY_ROW_TIMES, WEEKLY_FIRST - step);
    expect(idxBefore).toBeCloseTo(-1, 6);
  });
});

describe("chartDrawings · clip al viewport", () => {
  it("recorta un segmento que sale por la derecha", () => {
    // p1 = 0, p2 = 100, viewport [0, 50] → debería devolver aprox [0, 50].
    const clip = clipLogicalSegment(0, 100, 0, 50);
    expect(clip).not.toBeNull();
    expect(clip.p1Logical).toBeCloseTo(0, 6);
    expect(clip.p2Logical).toBeCloseTo(50, 6);
  });

  it("segmento totalmente fuera del viewport devuelve null", () => {
    expect(clipLogicalSegment(200, 300, 0, 100)).toBeNull();
  });

  it("segmento totalmente dentro del viewport no se recorta", () => {
    const clip = clipLogicalSegment(10, 90, 0, 100);
    expect(clip.p1Logical).toBeCloseTo(10, 6);
    expect(clip.p2Logical).toBeCloseTo(90, 6);
  });

  it("projectTrendline interpola anclas que no coinciden con barras", () => {
    const drawing = createTrendline({
      symbol: "AAPL",
      p1: { time: WEEKLY_ROW_TIMES[2] + 86400, price: 120 },
      p2: { time: WEEKLY_ROW_TIMES[7] - 2 * 86400, price: 150 },
    });
    const projected = projectTrendline(drawing, {
      rowTimes: WEEKLY_ROW_TIMES,
      visibleLogicalRange: { from: 0, to: WEEKLY_ROW_TIMES.length - 1 },
    });
    expect(projected).not.toBeNull();
    expect(projected.p1Logical).toBeGreaterThan(2);
    expect(projected.p1Logical).toBeLessThan(3);
    expect(projected.p2Logical).toBeGreaterThan(5);
    expect(projected.p2Logical).toBeLessThan(7);
    expect(projected.clipped.p1Logical).toBeCloseTo(projected.p1Logical, 6);
    expect(projected.clipped.p2Logical).toBeCloseTo(projected.p2Logical, 6);
  });

  it("projectTrendline recorta anclas fuera del viewport", () => {
    const drawing = createTrendline({
      symbol: "AAPL",
      p1: { time: WEEKLY_FIRST - 30 * 86400, price: 90 },
      p2: { time: WEEKLY_LAST + 30 * 86400, price: 200 },
    });
    const projected = projectTrendline(drawing, {
      rowTimes: WEEKLY_ROW_TIMES,
      visibleLogicalRange: { from: 0, to: WEEKLY_ROW_TIMES.length - 1 },
    });
    expect(projected).not.toBeNull();
    expect(projected.clipped.p1Logical).toBeGreaterThanOrEqual(-0.0001);
    expect(projected.clipped.p1Logical).toBeLessThan(0.5);
    expect(projected.clipped.p2Logical).toBeGreaterThan(WEEKLY_ROW_TIMES.length - 1 - 0.5);
    expect(projected.clipped.p2Logical).toBeLessThanOrEqual(WEEKLY_ROW_TIMES.length - 1 + 0.0001);
  });
});

describe("chartDrawings · hit-test", () => {
  it("distance dentro de tolerancia al cuerpo del segmento", () => {
    // Segmento horizontal de (0,0) a (100,0). Punto (50,3) está a 3px.
    expect(pointSegmentDistance(50, 3, 0, 0, 100, 0)).toBeCloseTo(3, 6);
    expect(pointSegmentDistance(50, 6, 0, 0, 100, 0)).toBeCloseTo(6, 6);
  });

  it("distance a un punto más allá de los extremos cae al extremo más cercano", () => {
    // (200, 0) está más allá del extremo derecho (100,0) → distancia a (100,0) = 100.
    expect(pointSegmentDistance(200, 0, 0, 0, 100, 0)).toBeCloseTo(100, 6);
  });

  it("distance a un punto degenerado (segmento de longitud 0)", () => {
    expect(pointSegmentDistance(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
  });

  it("hitTestLines selecciona la línea más cercana dentro de tolerancia", () => {
    const lines = [
      {
        drawing: { id: "a", kind: "trendline" },
        endpoints: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
        handles: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
      },
      {
        drawing: { id: "b", kind: "trendline" },
        endpoints: { p1: { x: 0, y: 200 }, p2: { x: 100, y: 200 } },
        handles: { p1: { x: 0, y: 200 }, p2: { x: 100, y: 200 } },
      },
    ];
    const hitBody = hitTestLines(lines, 50, 4, HIT_TOLERANCE_PX);
    expect(hitBody?.drawingId).toBe("a");
    expect(hitBody?.kind).toBe("body");

    // Tirador más generoso (8px) en p2 de la primera línea.
    const hitHandle = hitTestLines(lines, 97, 3, HIT_TOLERANCE_PX);
    expect(hitHandle?.drawingId).toBe("a");
    expect(hitHandle?.handle).toBe("p2");
    expect(hitHandle?.kind).toBe("handle");
  });

  it("hitTestLines devuelve null cuando no hay diana dentro de tolerancia", () => {
    const lines = [
      {
        drawing: { id: "a", kind: "trendline" },
        endpoints: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
        handles: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
      },
    ];
    expect(hitTestLines(lines, 50, 50, HIT_TOLERANCE_PX)).toBeNull();
  });

  it("hitTestLines tolera payloads parciales sin romper", () => {
    expect(hitTestLines(null, 0, 0, HIT_TOLERANCE_PX)).toBeNull();
    expect(hitTestLines([null, undefined], 0, 0, HIT_TOLERANCE_PX)).toBeNull();
  });
});