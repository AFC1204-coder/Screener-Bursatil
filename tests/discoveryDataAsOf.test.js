// La fecha que la pantalla declara es la de los DATOS, no la del cálculo.
//
// El evaluador contó cinco fechas repartidas por el producto sin que ninguna
// dijera cuál manda. La única que viajaba en el payload era generatedAt, que
// contesta "cuándo se calculó esto" — no "de cuándo son los precios".
import { describe, expect, it } from "vitest";
import { dataAsOfFrom, rsAsOfFrom } from "@/lib/discovery";

const lista = (items) => ({ lists: [{ key: "leaders", items }] });

describe("dataAsOf", () => {
  it("con una sola fecha la declara sin marcarla mezclada", () => {
    const result = dataAsOfFrom(lista([{ symbol: "A", lastDate: "2026-08-12" }, { symbol: "B", lastDate: "2026-08-12" }]));
    expect(result).toMatchObject({ date: "2026-08-12", latest: "2026-08-12", mixed: false });
  });

  it("con fechas distintas manda LA MÁS ANTIGUA, que es la que acota", () => {
    // El caso real de agosto de 2026: filas de Hong Kong a cierre del 10
    // entre filas estadounidenses a cierre del 12. Enseñar el 12 habría
    // afirmado que todo está al día.
    const result = dataAsOfFrom(lista([
      { symbol: "US1", lastDate: "2026-08-12" },
      { symbol: "8321.HK", lastDate: "2026-08-10" },
      { symbol: "US2", lastDate: "2026-08-12" },
    ]));
    expect(result.date).toBe("2026-08-10");
    expect(result.latest).toBe("2026-08-12");
    expect(result.mixed).toBe(true);
    expect(result.dates).toEqual(["2026-08-10", "2026-08-12"]);
  });

  it("mira también las filas deduplicadas, no solo las listas", () => {
    const result = dataAsOfFrom({ lists: [], rows: [{ symbol: "A", lastDate: "2026-08-11" }] });
    expect(result.date).toBe("2026-08-11");
  });

  it("sin ninguna fecha devuelve null en vez de inventarse hoy", () => {
    expect(dataAsOfFrom(lista([{ symbol: "A" }]))).toBeNull();
    expect(dataAsOfFrom({})).toBeNull();
  });
});

describe("rsAsOf", () => {
  it("declara el corte del ranking semanal con su tamaño de muestra", () => {
    const result = rsAsOfFrom(lista([
      { symbol: "A", weeklyRsAvailable: true, weeklyRsAsOf: "2026-08-09", weeklyRsSampleSize: 4868 },
    ]));
    expect(result).toEqual({ date: "2026-08-09", sampleSize: 4868 });
  });

  it("es una fecha DISTINTA de la del cierre, y esa es la razón de que viaje aparte", () => {
    const snapshot = lista([
      { symbol: "A", lastDate: "2026-08-12", weeklyRsAvailable: true, weeklyRsAsOf: "2026-08-09", weeklyRsSampleSize: 4868 },
    ]);
    expect(dataAsOfFrom(snapshot).date).toBe("2026-08-12");
    expect(rsAsOfFrom(snapshot).date).toBe("2026-08-09");
  });

  it("ignora las filas sin ranking en vez de dejar que bajen la fecha", () => {
    const result = rsAsOfFrom(lista([
      { symbol: "A", weeklyRsAvailable: true, weeklyRsAsOf: "2026-08-09", weeklyRsSampleSize: 4868 },
      { symbol: "B", weeklyRsAvailable: false, weeklyRsAsOf: null },
    ]));
    expect(result.date).toBe("2026-08-09");
  });

  it("sin ninguna fila hidratada devuelve null", () => {
    expect(rsAsOfFrom(lista([{ symbol: "A", weeklyRsAvailable: false }]))).toBeNull();
  });
});
