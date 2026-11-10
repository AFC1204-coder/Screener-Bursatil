// D3 (auditoría de producto 2026-11): el régimen de mercado lleva su fecha y,
// caducado, no se presenta como actual en ningún consumidor.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  assessMarketRegime,
  assessSectorTape,
  regimeFilterNote,
  regimeStamp,
  usableMarketHealth,
} from "@/lib/marketRegimeFreshness";
import { regimeRejectReason } from "@/lib/scoring";
import { createFavoriteFromRow } from "@/lib/stockRows";
import MarketRegimeHeadline from "@/app/market-health/MarketRegimeHeadline";
import RegionalRegimeChips from "@/app/market-health/RegionalRegimeChips";
import MarketSectorOverview from "@/app/sectors/MarketSectorOverview";

const BULL = { label: "Riesgo favorable / mercado alcista", color: "green", stance: "Índices mayoritariamente sobre medias clave y momentum positivo." };
const PRESSURE = { label: "Mercado bajo presión", color: "amber", stance: "Medias y amplitud mixtas." };

function payload({ indexDates, sectorDate, regime = BULL, marketScore = 90, freshness = {}, extra = {} }) {
  return {
    generatedAt: `${indexDates[0]}T23:00:00.000Z`,
    marketScore,
    regime,
    heroScope: "US",
    indexes: indexDates.map((lastDate, i) => ({ symbol: ["SPY", "QQQ", "IWM", "DIA", "ACWI"][i], name: "Índice", lastDate, price: 100, weight: 20 })),
    sectorTape: [
      { symbol: "XLK", name: "Tecnología", group: "Crecimiento", lastDate: sectorDate, score: 100, weinsteinScore: 100, state: { label: "Líder fuerte", bias: "alcista" }, rs1m: 5.3, price: 2, sma50: 1, sma200: 1 },
      { symbol: "XLU", name: "Utilities", group: "Defensivo", lastDate: sectorDate, score: 0, weinsteinScore: 0, state: { label: "Muy débil", bias: "bajista" }, rs1m: -7.7, price: 1, sma50: 2, sma200: 2 },
    ],
    sectorSummary: { count: 2, avgScore: 50, above50: 1, leaders: ["Tecnología"], laggards: ["Utilities"], best1m: "Tecnología", worst1m: "Utilities" },
    regimes: {
      US: { name: "Estados Unidos", flag: "US", benchmarkLabel: "S&P 500 (SPY)", regime, score: marketScore, etfSnapshot: { lastDate: indexDates[0], stageState: "stage2" }, breadth: {} },
    },
    freshness,
    ...extra,
  };
}

// La caché real que sirve la copia local (verificado 2026-11-07): generada el
// 24-sep, índices del 21/22-sep, cacheStale y ~1.067 h de antigüedad.
const STALE = payload({
  indexDates: ["2026-09-22", "2026-09-22", "2026-09-22", "2026-09-21", "2026-09-21"],
  sectorDate: "2026-09-22",
  freshness: { cacheHit: false, cacheStale: true, cacheAgeHours: 1067, cacheMaxAgeHours: 4 },
  extra: { nightlyScan: { found: false, reason: "scan-read-failed" } },
});
const NOW = new Date("2026-11-07T12:00:00Z"); // sábado
const FRESH = payload({ indexDates: ["2026-11-06", "2026-11-06", "2026-11-06", "2026-11-06", "2026-11-06"], sectorDate: "2026-11-06" });

// Payload neutral que la ruta devuelve sin caché ni proveedor: régimen «bajo
// presión» con score 50 inventados.
const DEGRADED = { ...payload({ indexDates: [""], sectorDate: "", regime: PRESSURE, marketScore: 50 }), degraded: true, indexes: [{ symbol: "SPY", lastDate: "", price: null }], sectorTape: [] };

const html = (element) => renderToStaticMarkup(element);

describe("assessMarketRegime", () => {
  it("caché caducada (cacheStale, >2 sesiones): fecha sí, régimen no", () => {
    const read = assessMarketRegime(STALE, { now: NOW });
    expect(read.status).toBe("stale");
    expect(read.usable).toBe(false);
    expect(read.asOf).toBe("2026-09-22");
    expect(read.dateText).toBe("Índices al 22 sep");
    expect(read.headline).toBe("Régimen sin actualizar desde el 22 sep");
    expect(read.regimeLabel).toBeNull();
    expect(read.regimeColor).toBeNull();
    expect(read.marketScore).toBeNull();
  });

  it("datos de ayer: régimen vigente con su fecha", () => {
    const read = assessMarketRegime(FRESH, { now: NOW });
    expect(read.status).toBe("fresh");
    expect(read.regimeLabel).toBe(BULL.label);
    expect(read.marketScore).toBe(90);
    expect(read.dateText).toBe("Índices al 6 nov");
  });

  it("cacheStale por sí solo (la caché tiene >4 h) no apaga un cierre de ayer", () => {
    const read = assessMarketRegime({ ...FRESH, freshness: { cacheStale: true, cacheAgeHours: 30 } }, { now: NOW });
    expect(read.usable).toBe(true);
  });

  it("umbral: 1 sesión sin cierre es vigente; 2 sesiones, caducado", () => {
    const wednesday = payload({ indexDates: ["2026-11-04"], sectorDate: "2026-11-04" });
    expect(assessMarketRegime(wednesday, { now: new Date("2026-11-06T12:00:00Z") }).status).toBe("fresh");
    expect(assessMarketRegime(wednesday, { now: new Date("2026-11-09T12:00:00Z") }).status).toBe("stale");
  });

  it("sin caché o payload degradado: «Sin datos de mercado», nunca un régimen por defecto", () => {
    for (const input of [null, undefined, {}, DEGRADED]) {
      const read = assessMarketRegime(input, { now: NOW });
      expect(read.status).toBe("missing");
      expect(read.headline).toBe("Sin datos de mercado");
      expect(read.regimeLabel).toBeNull();
      expect(read.marketScore).toBeNull();
    }
  });
});

describe("Mercado: cabecera del régimen", () => {
  it("caducado: el render contiene la fecha y no el texto del régimen", () => {
    const out = html(React.createElement(MarketRegimeHeadline, { data: STALE, now: NOW }));
    expect(out).toContain("Índices al 22 sep");
    expect(out).toContain("Régimen sin actualizar desde el 22 sep");
    expect(out).not.toContain("Riesgo favorable");
    expect(out).not.toContain("alcista");
    expect(out).not.toContain("momentum positivo");
  });

  it("vigente: régimen normal con fecha", () => {
    const out = html(React.createElement(MarketRegimeHeadline, { data: FRESH, now: NOW }));
    expect(out).toContain("Riesgo favorable / mercado alcista");
    expect(out).toContain("Índices al 6 nov");
  });

  it("caché ausente: «Sin datos de mercado»", () => {
    const out = html(React.createElement(MarketRegimeHeadline, { data: DEGRADED, now: NOW }));
    expect(out).toContain("Sin datos de mercado");
    expect(out).not.toContain("bajo presión");
  });

  it("veredictos por región con la misma regla", () => {
    const stale = html(React.createElement(RegionalRegimeChips, { regimes: STALE.regimes, now: NOW }));
    expect(stale).toContain("Sin actualizar · 22 sep");
    expect(stale).not.toContain("Riesgo favorable");
    const fresh = html(React.createElement(RegionalRegimeChips, { regimes: FRESH.regimes, now: NOW }));
    expect(fresh).toContain("Riesgo favorable / mercado alcista");
  });
});

describe("Sectores: «Estado sectorial»", () => {
  it("caducado: fecha propia, atenuado, sin régimen ni colores de estado", () => {
    const out = html(React.createElement(MarketSectorOverview, { data: STALE, now: NOW }));
    expect(out).toContain("Sin actualizar desde el 22 sep");
    expect(out).toContain("independiente de la fuente");
    expect(out).toContain('data-stale="true"');
    expect(out).not.toContain("Riesgo favorable");
    expect(out).not.toContain("sentimentPill bullish");
    expect(out).not.toContain("sentimentPill bearish");
  });

  it("vigente: fecha de los ETF y régimen", () => {
    const out = html(React.createElement(MarketSectorOverview, { data: FRESH, now: NOW }));
    expect(out).toContain("ETF sectoriales al 6 nov");
    expect(out).toContain("Riesgo favorable / mercado alcista");
    expect(out).not.toContain("data-stale");
  });

  it("sin datos: «Sin datos de mercado»", () => {
    const out = html(React.createElement(MarketSectorOverview, { data: DEGRADED, now: NOW }));
    expect(out).toContain("Sin datos de mercado");
    expect(assessSectorTape(DEGRADED, { now: NOW }).status).toBe("missing");
  });
});

describe("Screener: filtro «Régimen»", () => {
  // Fila que el régimen «bajo presión» (score 45) dejaría fuera.
  const weakRow = { symbol: "WEAK", objectiveScore: 40, riskScore: 30, weinsteinScore: 30, minerviniScore: 30 };
  const pressureStale = { ...STALE, marketScore: 45, regime: PRESSURE };
  const pressureFresh = { ...FRESH, marketScore: 45, regime: PRESSURE };

  it("régimen caducado: no recorta", () => {
    expect(regimeRejectReason(weakRow, pressureStale, true, {}, NOW)).toBeNull();
    expect(regimeFilterNote(pressureStale, true, { now: NOW })).toBe("sin aplicar: régimen sin actualizar desde el 22 sep");
  });

  it("régimen vigente: recorta como siempre", () => {
    expect(regimeRejectReason(weakRow, pressureFresh, true, {}, NOW)?.key).toBe("regime");
    expect(regimeFilterNote(pressureFresh, true, { now: NOW })).toBe("");
  });

  it("sin datos: no recorta y lo dice; apagado: sin nota", () => {
    expect(regimeRejectReason(weakRow, null, true, {}, NOW)).toBeNull();
    expect(regimeFilterNote(null, true, { now: NOW })).toBe("sin aplicar: sin datos de mercado");
    expect(regimeFilterNote(pressureStale, false, { now: NOW })).toBe("");
  });
});

describe("Sellos de régimen en snapshots y favoritos", () => {
  it("caducado: «sin dato», nunca el veredicto viejo", () => {
    expect(regimeStamp(STALE, { now: NOW })).toEqual({ marketScore: null, marketRegime: "sin dato" });
    expect(regimeStamp(FRESH, { now: NOW })).toEqual({ marketScore: 90, marketRegime: BULL.label });
    expect(usableMarketHealth(STALE, { now: NOW })).toBeNull();
  });

  it("createFavoriteFromRow no sella un régimen caducado", () => {
    const favorite = createFavoriteFromRow({ symbol: "AAPL" }, { marketHealth: STALE });
    expect(favorite.marketRegime).toBe("sin dato");
    expect(favorite.marketScore ?? null).toBeNull();
  });
});
