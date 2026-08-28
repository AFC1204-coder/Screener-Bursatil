// Contrato de la fecha de salida a bolsa.
//
// Este archivo existe porque el modo de fallo YA OCURRIÓ y duró meses:
// `ipoDate` no vacío = 0 filas y `ipoAgeMonths` finito = 0 filas en el censo
// completo de las 3.314 filas del nocturno del 2026-08-15
// (docs/analisis-compuesto-2026-08-15.md), con `requireRecentIpo` y
// `maxIpoAgeMonths` filtrando por esos dos campos. La ficha Radar IPO salía
// vacía por ausencia de dato, no por un umbral estricto.
//
// Los tests cubren las cuatro junturas donde el dato se perdía:
//   1. la resolución (¿de dónde sale la fecha y en qué orden),
//   2. el ensamblado de la fila (los dos buildResearchRow del repo),
//   3. la persistencia (las dos proyecciones de scan_results),
//   4. el filtro (que la regla efectivamente muerda con la fila resultante).

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  IPO_DATE_SOURCES,
  IPO_DATE_UNAVAILABLE,
  firstTradeDateFromChartMeta,
  ipoDateFromEpochSeconds,
  ipoDateResult,
  monthsSince,
  resolveIpoDate,
} from "@/lib/ipoDate";
import { hydrateProfileIpoDate } from "@/lib/ipoDateSources";
import { buildResearchRow as buildLightRow } from "@/lib/researchRow";
import { _forTest as materializedForTest } from "@/lib/materializedScanner";
import { scanDecisionMetrics } from "@/lib/scanDecisionProjection";
import { SCAN_LIGHT_FIELDS, scanLightMetrics } from "@/lib/scanLightProjection";
import { monthsSince as scoringMonthsSince } from "@/lib/scoring";
import { applyScreenerFilters } from "@/lib/screenerFilters";
import { strideSample, summarize } from "../scripts/backfill-ipo-date.mjs";

// Primera cotización real de RDDT verificada contra el proveedor el
// 2026-08-28: meta.firstTradeDate = 1711027800 → 2024-03-21.
const RDDT_FIRST_TRADE = 1711027800;
const RDDT_IPO_DATE = "2024-03-21";

function barsForTest(count = 260, { start = 100 } = {}) {
  // Descendente por fecha, que es como las devuelven fetchYahooChart y
  // normalizeBars (la barra [0] es la más reciente).
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1) - i * 86400000);
    const close = start + (count - i) * 0.1;
    return {
      date: day.toISOString().slice(0, 10),
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_500_000,
    };
  });
}

function chartForTest(meta = {}) {
  return { bars: barsForTest(), meta: { regularMarketPrice: 126, dataProvider: "Yahoo Finance", ...meta } };
}

describe("de dónde sale la fecha", () => {
  it("convierte los segundos epoch del meta del gráfico a YYYY-MM-DD", () => {
    expect(ipoDateFromEpochSeconds(RDDT_FIRST_TRADE)).toBe(RDDT_IPO_DATE);
  });

  it("no acepta 0 como primera cotización: es el relleno del proveedor, no una fecha", () => {
    expect(ipoDateFromEpochSeconds(0)).toBe("");
    expect(ipoDateFromEpochSeconds(-1)).toBe("");
    expect(ipoDateFromEpochSeconds(null)).toBe("");
    expect(firstTradeDateFromChartMeta({ firstTradeDate: 0 })).toBe(null);
  });

  it("lee las tres formas en que Yahoo ha expuesto la primera cotización", () => {
    expect(firstTradeDateFromChartMeta({ firstTradeDate: RDDT_FIRST_TRADE })).toBe(RDDT_FIRST_TRADE);
    expect(firstTradeDateFromChartMeta({ firstTradeDateEpochUtc: { raw: RDDT_FIRST_TRADE } })).toBe(RDDT_FIRST_TRADE);
    expect(firstTradeDateFromChartMeta({ firstTradeDateMilliseconds: RDDT_FIRST_TRADE * 1000 })).toBe(RDDT_FIRST_TRADE);
    expect(firstTradeDateFromChartMeta({})).toBe(null);
    expect(firstTradeDateFromChartMeta(null)).toBe(null);
  });

  it("el meta del gráfico gana al perfil: es el valor en vivo del proveedor", () => {
    const resolved = resolveIpoDate({
      chartMeta: { firstTradeDate: RDDT_FIRST_TRADE },
      profile: { ipoDate: "2019-01-02", ipoDateSource: IPO_DATE_SOURCES.fmp },
    });
    expect(resolved.ipoDate).toBe(RDDT_IPO_DATE);
    expect(resolved.ipoDateSource).toBe(IPO_DATE_SOURCES.chartMeta);
    expect(resolved.ipoDateReason).toBe(null);
  });

  it("usa el perfil cuando el meta no la trae, conservando su procedencia", () => {
    // Este es el caso normal del nocturno: las barras vienen de daily_bars y
    // chartFromCache reconstruye el meta sin firstTradeDate.
    const resolved = resolveIpoDate({
      chartMeta: { dataProvider: "StatsEdge daily_bars cache" },
      profile: { ipoDate: "2019-01-02", ipoDateSource: IPO_DATE_SOURCES.fmp },
    });
    expect(resolved.ipoDate).toBe("2019-01-02");
    expect(resolved.ipoDateSource).toBe(IPO_DATE_SOURCES.fmp);
  });

  it("declara la ausencia con motivo estable en vez de inventar una fecha", () => {
    const resolved = resolveIpoDate({ chartMeta: {}, profile: { ipoDate: "" } });
    expect(resolved).toEqual({
      ipoDate: "",
      ipoAgeMonths: null,
      ipoDateSource: null,
      ipoDateReason: IPO_DATE_UNAVAILABLE,
    });
  });

  it("una fecha ilegible se trata como ausencia, no como fecha inválida", () => {
    expect(ipoDateResult("no es una fecha").ipoDateReason).toBe(IPO_DATE_UNAVAILABLE);
    expect(resolveIpoDate({ profile: { ipoDate: "sin dato" } }).ipoDate).toBe("");
  });

  it("monthsSince da el MISMO resultado que la copia que ya usaba el screener", () => {
    // La aritmética no puede cambiar: movería el umbral de 60 meses de todos
    // los presets a la vez. lib/scoring.js es la copia que consumen
    // researchRow y screenerMarket.
    for (const date of ["2024-03-21", "2019-01-02", "1980-12-12", "2026-08-01"]) {
      expect(monthsSince(date)).toBe(scoringMonthsSince(date));
    }
    expect(monthsSince("")).toBe(null);
    expect(monthsSince("basura")).toBe(null);
  });
});

describe("el path nocturno pide la fecha solo cuando hace falta", () => {
  const cacheOff = { cache: false }; // sin escritura a Supabase en tests

  it("no pide nada si el meta del gráfico ya la trae", async () => {
    let called = 0;
    const profile = await hydrateProfileIpoDate("RDDT", { sector: "Tech" }, {
      ...cacheOff,
      chartMeta: { firstTradeDate: RDDT_FIRST_TRADE },
      fetchIpoDate: async () => { called += 1; return ipoDateResult(""); },
    });
    expect(called).toBe(0);
    expect(profile.ipoDate).toBe(RDDT_IPO_DATE);
    expect(profile.ipoDateSource).toBe(IPO_DATE_SOURCES.chartMeta);
  });

  it("no pide nada si el perfil cacheado ya la trae", async () => {
    let called = 0;
    const profile = await hydrateProfileIpoDate("AAA", { ipoDate: "2019-01-02" }, {
      ...cacheOff,
      chartMeta: {},
      fetchIpoDate: async () => { called += 1; return ipoDateResult(""); },
    });
    expect(called).toBe(0);
    expect(profile.ipoDate).toBe("2019-01-02");
  });

  it("la pide cuando ni el meta ni el perfil la traen — el caso de las dos cachés acertando", async () => {
    let called = 0;
    const profile = await hydrateProfileIpoDate("RDDT", { sector: "Tech", ipoDate: "" }, {
      ...cacheOff,
      chartMeta: { dataProvider: "StatsEdge daily_bars cache" },
      fetchIpoDate: async () => { called += 1; return ipoDateResult(RDDT_IPO_DATE, IPO_DATE_SOURCES.fmp); },
    });
    expect(called).toBe(1);
    expect(profile.ipoDate).toBe(RDDT_IPO_DATE);
    expect(profile.ipoDateSource).toBe(IPO_DATE_SOURCES.fmp);
    expect(profile.sector).toBe("Tech");
  });

  it("si el proveedor tampoco la tiene, la fila sale con motivo y sin fecha", async () => {
    const profile = await hydrateProfileIpoDate("AAA", {}, {
      ...cacheOff,
      chartMeta: {},
      fetchIpoDate: async () => ipoDateResult(""),
    });
    expect(profile.ipoDate).toBe("");
    expect(profile.ipoAgeMonths).toBe(null);
    expect(profile.ipoDateReason).toBe(IPO_DATE_UNAVAILABLE);
  });

  it("hydrateIpoDate:false desactiva la petición sin desactivar la resolución local", async () => {
    let called = 0;
    const profile = await hydrateProfileIpoDate("AAA", {}, {
      ...cacheOff,
      chartMeta: {},
      hydrateIpoDate: false,
      fetchIpoDate: async () => { called += 1; return ipoDateResult(RDDT_IPO_DATE); },
    });
    expect(called).toBe(0);
    expect(profile.ipoDateReason).toBe(IPO_DATE_UNAVAILABLE);
  });
});

describe("persistir la fecha no falsea la frescura del perfil", () => {
  // readProfileCache decide el acierto por `ageDays(updated_at) <= maxAgeDays`.
  // Si el PATCH que añade la fecha volviera a sellar `updated_at`, unos
  // fundamentales leídos de la caché pasarían por recién pedidos y el refresco
  // real de sector/industria/crecimiento se aplazaría hasta maxAgeDays después.
  // La fecha de una IPO es inmutable: no justifica reiniciar ese reloj.
  const source = readFileSync(new URL("../lib/fundamentalsCache.js", import.meta.url), "utf8");
  const patchFn = source.slice(source.indexOf("export async function patchProfileCacheIpoDate"));
  const patchBody = patchFn.slice(0, patchFn.indexOf("\nexport "));

  it("patchProfileCacheIpoDate no escribe updated_at", () => {
    expect(patchBody).toContain("method: \"PATCH\"");
    expect(patchBody).not.toContain("updated_at:");
  });

  it("patchProfileCacheIpoDate no escribe period_end (no crea la fila de hoy)", () => {
    expect(patchBody).not.toContain("period_end:");
  });

  it("el path nocturno no persiste vía writeProfileCache, que sí sella updated_at", () => {
    const sources = readFileSync(new URL("../lib/ipoDateSources.js", import.meta.url), "utf8");
    expect(sources).toContain("patchProfileCacheIpoDate");
    expect(sources).not.toContain("writeProfileCache");
  });
});

describe("los dos ensambladores de fila la llevan", () => {
  const cases = [
    ["lib/materializedScanner.js (nocturno)", (chart, profile) => materializedForTest.buildResearchRow("RDDT", chart, profile, {}, {})],
    ["lib/researchRow.js (escaneo en servidor y ficha)", (chart, profile) => buildLightRow("RDDT", chart, profile, {}, {})],
  ];

  for (const [label, build] of cases) {
    it(`${label}: fecha y edad desde el meta del gráfico`, () => {
      const row = build(chartForTest({ firstTradeDate: RDDT_FIRST_TRADE }), { sector: "Tech" });
      expect(row.ipoDate).toBe(RDDT_IPO_DATE);
      expect(row.ipoAgeMonths).toBe(monthsSince(RDDT_IPO_DATE));
      expect(row.ipoDateSource).toBe(IPO_DATE_SOURCES.chartMeta);
      expect(row.ipoDateReason).toBe(null);
    });

    it(`${label}: fecha desde el perfil cuando el meta viene de la caché`, () => {
      const row = build(chartForTest(), { sector: "Tech", ipoDate: RDDT_IPO_DATE, ipoDateSource: IPO_DATE_SOURCES.fmp });
      expect(row.ipoDate).toBe(RDDT_IPO_DATE);
      expect(row.ipoDateSource).toBe(IPO_DATE_SOURCES.fmp);
    });

    it(`${label}: sin fecha, motivo declarado y edad ausente (no 0)`, () => {
      const row = build(chartForTest(), { sector: "Tech" });
      expect(row.ipoDate).toBe("");
      expect(row.ipoAgeMonths).toBe(null);
      expect(row.ipoDateReason).toBe(IPO_DATE_UNAVAILABLE);
    });
  }
});

describe("las dos proyecciones de scan_results la conservan", () => {
  const row = {
    symbol: "RDDT",
    price: 126,
    ipoDate: RDDT_IPO_DATE,
    ipoAgeMonths: monthsSince(RDDT_IPO_DATE),
    ipoDateSource: IPO_DATE_SOURCES.chartMeta,
    ipoDateReason: null,
  };

  it("la proyección ligera declara los cuatro campos", () => {
    for (const field of ["ipoDate", "ipoAgeMonths", "ipoDateSource", "ipoDateReason"]) {
      expect(SCAN_LIGHT_FIELDS).toContain(field);
    }
  });

  it("la proyección ligera los escribe", () => {
    const metrics = scanLightMetrics(row);
    expect(metrics.ipoDate).toBe(RDDT_IPO_DATE);
    expect(metrics.ipoAgeMonths).toBe(row.ipoAgeMonths);
    expect(metrics.ipoDateSource).toBe(IPO_DATE_SOURCES.chartMeta);
    // ipoDateReason es null con fecha presente: un dato ausente sigue ausente.
    expect("ipoDateReason" in metrics).toBe(false);
  });

  it("la proyección ligera escribe el motivo cuando no hay fecha", () => {
    const metrics = scanLightMetrics({ symbol: "AAA", ipoDate: "", ipoAgeMonths: null, ipoDateReason: IPO_DATE_UNAVAILABLE });
    expect(metrics.ipoDateReason).toBe(IPO_DATE_UNAVAILABLE);
    expect("ipoAgeMonths" in metrics).toBe(false);
  });

  it("la proyección completa los lleva en metrics, no solo en raw", () => {
    // ?projection=decision no pide la columna raw: si la fecha viviera solo
    // ahí, el filtro IPO no mordería en la superficie más consultada.
    const metrics = scanDecisionMetrics(row);
    expect(metrics.ipoDate).toBe(RDDT_IPO_DATE);
    expect(metrics.ipoAgeMonths).toBe(row.ipoAgeMonths);
    expect(metrics.ipoDateSource).toBe(IPO_DATE_SOURCES.chartMeta);
  });
});

describe("el filtro muerde con la fila resultante", () => {
  function scoredRow(overrides = {}) {
    return {
      symbol: "AAA",
      price: 100,
      sma50: 90,
      sma150: 85,
      sma200: 80,
      sma200Slope: 5,
      distance52w: -5,
      extSma50: 10,
      perf3m: 20,
      momentumScore: 60,
      totalScore: 70,
      rsGlobalPct: 80,
      avgVolume: 2_000_000,
      avgTurnover: 20_000_000,
      marketCap: 3_000_000_000,
      priceFreshnessOk: true,
      priceFreshnessDays: 1,
      ...overrides,
    };
  }

  const settings = { enabled: true, requireRecentIpo: true, maxIpoAgeMonths: 60 };

  it("una fila con edad IPO dentro del umbral pasa requireRecentIpo", () => {
    const { rows } = applyScreenerFilters([scoredRow({ ipoDate: RDDT_IPO_DATE, ipoAgeMonths: 20 })], settings);
    expect(rows.map((r) => r.symbol)).toEqual(["AAA"]);
  });

  it("una fila madura la rechaza por edad, no por ausencia", () => {
    const { rejections } = applyScreenerFilters([scoredRow({ ipoDate: "1980-12-12", ipoAgeMonths: 548 })], settings);
    expect(rejections[0]?.field).toBe("requireRecentIpo");
  });

  it("sin fecha sigue sin pasar — el dato ausente no se cuela como reciente", () => {
    const { rows, rejections } = applyScreenerFilters([scoredRow({ ipoDate: "", ipoAgeMonths: null, ipoDateReason: IPO_DATE_UNAVAILABLE })], settings);
    expect(rows).toEqual([]);
    expect(rejections[0]?.field).toBe("requireRecentIpo");
  });
});

describe("el script de backfill", () => {
  it("muestrea con paso constante, no por la cabeza de la lista", () => {
    const items = Array.from({ length: 100 }, (_, i) => `S${i}`);
    const sample = strideSample(items, 10);
    expect(sample).toHaveLength(10);
    expect(sample[0]).toBe("S0");
    expect(sample[9]).toBe("S90");
    // Con limit >= lista devuelve la lista entera, sin recortar ni repetir.
    expect(strideSample(items, 500)).toHaveLength(100);
  });

  it("resume cobertura y reparto de edades sin contar las ausencias como 0", () => {
    const stats = summarize([
      { symbol: "A", ipoDate: "2024-03-21", ipoAgeMonths: 20, ipoDateSource: IPO_DATE_SOURCES.chartMeta },
      { symbol: "B", ipoDate: "2019-01-02", ipoAgeMonths: 91, ipoDateSource: IPO_DATE_SOURCES.chartMeta },
      { symbol: "C", ipoDate: "", ipoAgeMonths: null, ipoDateSource: null },
    ]);
    expect(stats).toMatchObject({
      examined: 3,
      resolved: 2,
      unresolved: 1,
      age24: 1,
      age60: 1,
      age84: 1,
      older: 1,
      newest: 20,
      oldest: 91,
    });
    expect(stats.bySource[IPO_DATE_SOURCES.chartMeta]).toBe(2);
  });
});
