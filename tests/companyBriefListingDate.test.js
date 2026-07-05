// Tests de computeListingDate (app/api/company-brief/route.js).
//
// CONTEXTO — por qué existe esta función y por qué se testea aparte:
//
// listingDate antes se derivaba de `chart.bars` DESPUÉS de mergeChartHistory y
// de que writeDailyBarsCache cacheara la serie. Con el cap de escritura
// introducido (400/1260 barras), leer listingDate desde la caché post-truncate
// devolvería una fecha equivocada: para un símbolo listado en 1990 fetcheado
// con range=MAX, la caché ahora retiene solo las últimas 400-1260 barras, así
// que `oldestBarDate(cachedBars)` devolvería ~2021 en vez de 1990.
//
// La solución: calcular listingDate en memoria sobre la respuesta cruda del
// fetch (longChart.bars = range MAX, profundidad completa) ANTES de pasar los
// datos a la caché. La profundidad completa existe solo en tránsito; lo que se
// cachea ya viene capado. El usuario ve el mismo listingDate que antes.
//
// Esta función está aislada como puro cálculo (sin I/O) para que sea testeable
// sin mockear todo el chain de company-brief (profile fetch, FX, fundamentals,
// RS, etc.). El test cubre la prioridad de fuentes y el caso clave: que la
// fecha proviene de longBars (profundidad completa) y NO de mergedBars (que
// podría estar truncada por el cap).

import { describe, expect, it } from "vitest";
import { computeListingDate } from "@/app/api/company-brief/route";

function barsFromDates(dates = []) {
  // bars con shape mínimo que oldestBarDate acepta (solo importa bar.date).
  return dates.map((date) => ({ date, close: 100, high: 105, low: 95 }));
}

describe("computeListingDate · prioridad de fuentes", () => {
  it("prioriza ipoDate del profile sobre cualquier barra", () => {
    const longBars = barsFromDates(["2000-01-03", "2024-01-02"]);
    const mergedBars = barsFromDates(["2021-06-01", "2024-01-02"]);
    const result = computeListingDate("1995-05-15", longBars, mergedBars);
    expect(result.listingDate).toBe("1995-05-15");
    expect(result.listingDateSource).toBe("Proveedor perfil");
  });

  it("usa longBars (range MAX, profundidad completa) cuando ipoDate falta", () => {
    const longBars = barsFromDates(["1990-01-25", "2024-01-02"]); // fecha vieja
    const mergedBars = barsFromDates(["2021-06-01", "2024-01-02"]); // fecha reciente
    const result = computeListingDate("", longBars, mergedBars);
    expect(result.listingDate).toBe("1990-01-25");
    expect(result.listingDateSource).toBe("Primera cotizacion historica disponible");
  });

  it("cae a mergedBars solo cuando longBars está vacío (fallback)", () => {
    const mergedBars = barsFromDates(["2021-06-01", "2024-01-02"]);
    const result = computeListingDate("", [], mergedBars);
    expect(result.listingDate).toBe("2021-06-01");
    expect(result.listingDateSource).toBe("Primera cotizacion (rango reciente)");
  });

  it("devuelve vacío cuando todas las fuentes están vacías", () => {
    const result = computeListingDate("", [], []);
    expect(result.listingDate).toBe("");
    expect(result.listingDateSource).toBe("");
  });
});

describe("computeListingDate · invariante: no depende de la caché capada", () => {
  it("longBars con fecha 1990 se preserva aunque mergedBars empiece en 2021", () => {
    // Caso clave: la caché (mergedBars vía mergeChartHistory o read-back)
    // podría estar truncada a 2021 por el cap de 400 barras. listingDate debe
    // venir de longBars (1990), no de mergedBars (2021).
    const longBars = barsFromDates(["1990-03-15", "1990-03-16", "2024-01-02"]);
    const mergedBars = barsFromDates(["2021-06-01", "2024-01-02"]);
    const result = computeListingDate("", longBars, mergedBars);
    expect(result.listingDate).toBe("1990-03-15");
    // CRÍTICO: NO debe ser la fecha de mergedBars.
    expect(result.listingDate).not.toBe("2021-06-01");
  });

  it("longBars con 15000 barras (range MAX de un símbolo muy viejo) funciona", () => {
    // Simula range=MAX para un símbolo listado hace décadas. oldestBarDate debe
    // encontrar la mínima sin importar el tamaño.
    const dates = [];
    const base = Date.UTC(1985, 0, 1);
    const DAY = 86400_000;
    for (let i = 0; i < 15000; i += 1) {
      dates.push(new Date(base + i * DAY).toISOString().slice(0, 10));
    }
    const longBars = barsFromDates(dates);
    const result = computeListingDate("", longBars, []);
    expect(result.listingDate).toBe("1985-01-01");
  });

  it("ignora fechas malformadas en longBars (formato no YYYY-MM-DD)", () => {
    const longBars = barsFromDates(["not-a-date", "", "1990-01-25", "2024-01-02"]);
    const result = computeListingDate("", longBars, []);
    expect(result.listingDate).toBe("1990-01-25");
  });

  it("trata longBars null/undefined como vacío (cae a mergedBars)", () => {
    const mergedBars = barsFromDates(["2020-01-02"]);
    const result1 = computeListingDate("", null, mergedBars);
    const result2 = computeListingDate("", undefined, mergedBars);
    expect(result1.listingDate).toBe("2020-01-02");
    expect(result2.listingDate).toBe("2020-01-02");
  });
});
