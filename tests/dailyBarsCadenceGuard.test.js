// Guard de cadencia de daily_bars: una barra que no sea DIARIA no se escribe.
//
// EL FALLO QUE ESTE TEST IMPIDE QUE VUELVA, medido el 2026-08-18 sobre
// producción: daily_bars contenía 1.840 filas que no eran sesiones diarias
// —barras mensuales y semanales— repartidas por 482 símbolos, entre ellos
// SPY, QQQ y ACWI, los tres índices de referencia del producto.
//
// Origen: fetchYahooChartDirect (lib/yahoo.js) pide SIEMPRE `interval=1d`
// para lo no intradía, pero Yahoo lo ignora cuando el `range` es largo y
// devuelve una granularidad más gruesa, declarándola en `meta.dataGranularity`
// (comprobado: range=max devuelve "1mo" para SPY/^FCHI/ACWI y "1wk" para
// 360.AX/1810.HK). Los dos llamadores con rango largo son
// /api/chart?range=MAX|5A y el brief (fetchChartForBrief con range "MAX").
// writeDailyBarsCache solo rechazaba intradía y estimados, así que esas barras
// entraban como diarias.
//
// Efecto medido antes del arreglo: +40,7 % en el avgVolume de 20 sesiones de
// SPY (66,0 M frente a 46,9 M reales) y +40,6 % en el de NVDA (169,2 M frente
// a 120,3 M); el reparto de volumen alcista/bajista a 50 sesiones de SPY
// cruzaba el 1,00 (1,127 crudo frente a 0,943 limpio).
//
// La comprobación es de ESCRITURA, no de lectura: el recorte de cadencia del
// gráfico (homogeneousDailyRowsImpl, lib/chartDataModel.js, 14-ago) tapa el
// síntoma al dibujar, pero el scoring, el RS y los indicadores de volumen leen
// la tabla cruda.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: () => ({
    configured: true,
    ownerId: "personal",
    url: "https://example.supabase.co",
    key: "test-key",
    missing: [],
  }),
  supabaseRequest: vi.fn(async () => []),
  toDate: (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  },
}));

import { nonDailyCadenceReason, writeDailyBarsCache } from "@/lib/dailyBarsCache";
import { supabaseRequest } from "@/lib/supabaseServer";

// Genera `count` barras separadas `stepDays` días naturales, descendentes
// (más reciente primero, el contrato de fetchYahooChart).
function makeBars(count, { stepDays = 1, startISO = "2026-08-14" } = {}) {
  const base = Date.parse(`${startISO}T00:00:00Z`);
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(base - i * stepDays * 86400_000);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open: 100, high: 105, low: 95, close: 102, adjClose: 102,
      volume: 1_000_000 + i,
      provider: "Yahoo Finance",
    });
  }
  return bars;
}

const dailyBarsWrites = () =>
  supabaseRequest.mock.calls.filter(
    ([path, opts]) => path === "daily_bars" && (opts?.method === "POST" || opts?.method === "DELETE"),
  );

beforeEach(() => { supabaseRequest.mockClear(); });
afterEach(() => { vi.clearAllMocks(); });

// ===========================================================================
// Regla 1 — granularidad DECLARADA por el proveedor
// ===========================================================================

describe("writeDailyBarsCache · rechaza la granularidad declarada no diaria", () => {
  it.each(["1mo", "1wk", "3mo", "1Mo", "5d"])(
    "dataGranularity=%s no escribe ninguna fila",
    async (granularity) => {
      const result = await writeDailyBarsCache("SPY", {
        bars: makeBars(60),
        meta: { dataGranularity: granularity, yahooInterval: "1d" },
      });
      expect(result.status).toBe("rejected-non-daily");
      expect(result.written).toBe(false);
      expect(result.count).toBe(0);
      expect(dailyBarsWrites()).toHaveLength(0);
    },
  );

  it("no se deja engañar por yahooInterval: lo que manda es dataGranularity", async () => {
    // Este es EXACTAMENTE el payload que produjo el fallo: se pidió 1d
    // (yahooInterval), Yahoo devolvió 1mo (dataGranularity).
    const result = await writeDailyBarsCache("SPY", {
      bars: makeBars(40, { stepDays: 30 }),
      meta: { yahooInterval: "1d", requestedInterval: "D", dataGranularity: "1mo" },
    });
    expect(result.status).toBe("rejected-non-daily");
    expect(dailyBarsWrites()).toHaveLength(0);
  });

  it("dataGranularity=1d sí escribe", async () => {
    const result = await writeDailyBarsCache("SPY", {
      bars: makeBars(60),
      meta: { dataGranularity: "1d" },
    });
    expect(result.status).toBe("supabase");
    expect(result.count).toBe(60);
  });

  it("sin dataGranularity (Stooq / Alpha Vantage) una serie diaria sigue escribiéndose", async () => {
    const result = await writeDailyBarsCache("SPY", { bars: makeBars(60), meta: {} });
    expect(result.status).toBe("supabase");
    expect(result.count).toBe(60);
  });
});

// ===========================================================================
// Regla 2 — cadencia ESTRUCTURAL del payload (proveedor que no la declara)
// ===========================================================================

describe("writeDailyBarsCache · rechaza la cadencia no diaria del payload", () => {
  it("una serie semanal sin meta (huecos de 7 días) no se escribe", async () => {
    const result = await writeDailyBarsCache("1810.HK", { bars: makeBars(40, { stepDays: 7 }), meta: {} });
    expect(result.status).toBe("rejected-non-daily");
    expect(result.reason).toMatch(/cadencia del payload/);
    expect(dailyBarsWrites()).toHaveLength(0);
  });

  it("una serie mensual sin meta (huecos de ~30 días) no se escribe", async () => {
    const result = await writeDailyBarsCache("^FCHI", { bars: makeBars(40, { stepDays: 30 }), meta: {} });
    expect(result.status).toBe("rejected-non-daily");
    expect(dailyBarsWrites()).toHaveLength(0);
  });

  it("una serie diaria con fines de semana (huecos de 1 y 3 días) sí se escribe", async () => {
    // Sesiones reales lun-vie durante 12 semanas: la mediana del hueco es 1.
    const bars = [];
    let cursor = Date.parse("2026-08-14T00:00:00Z");
    while (bars.length < 60) {
      const d = new Date(cursor);
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        bars.push({
          date: d.toISOString().slice(0, 10),
          open: 100, high: 105, low: 95, close: 102, adjClose: 102,
          volume: 1_000_000, provider: "Yahoo Finance",
        });
      }
      cursor -= 86400_000;
    }
    const result = await writeDailyBarsCache("SPY", { bars, meta: {} });
    expect(result.status).toBe("supabase");
    expect(result.count).toBe(60);
  });

  it("un payload corto (< 10 barras) no se juzga por cadencia: no hay muestra", async () => {
    // Un símbolo recién listado o un rango 5D no debe caer por el backstop
    // estructural. Solo la granularidad declarada puede rechazarlo.
    const result = await writeDailyBarsCache("NEWCO", { bars: makeBars(5, { stepDays: 30 }), meta: {} });
    expect(result.status).toBe("supabase");
  });
});

// ===========================================================================
// La regla, aislada
// ===========================================================================

describe("nonDailyCadenceReason", () => {
  it("devuelve cadena vacía para una serie diaria", () => {
    expect(nonDailyCadenceReason({ bars: makeBars(30), meta: { dataGranularity: "1d" } })).toBe("");
  });

  it("nombra la granularidad declarada en el motivo", () => {
    expect(nonDailyCadenceReason({ bars: makeBars(30), meta: { dataGranularity: "1mo" } }))
      .toMatch(/granularidad declarada por el proveedor: 1mo/);
  });

  it("un valor ilíquido que cotiza 2 veces por semana (hueco mediano 3-4) no se marca", () => {
    expect(nonDailyCadenceReason({ bars: makeBars(30, { stepDays: 4 }), meta: {} })).toBe("");
  });
});
