// Guard de valores atípicos de volumen: una barra suelta dentro de un payload
// por lo demás diario no puede escribirse si su volumen es un múltiplo
// desproporcionado del de sus vecinas.
//
// EL AGUJERO QUE ESTE TEST IMPIDE QUE VUELVA, medido el 2026-08-20 sobre
// producción: 32 filas en 27 símbolos con barras MENSUALES sueltas
// incrustadas dentro de payloads por lo demás diarios (AAPL/WELL/MSFT con
// cuatro cada uno; COST/XOM/MCD/3988.HK con una). El guard de cadencia
// existente (dailyBarsCadenceGuard.test.js) opera sobre el payload
// COMPLETO — granularidad declarada y mediana de huecos de TODAS las
// barras — y por eso nunca vio estas: 1-4 barras contaminadas dentro de un
// payload de cientos no mueven ni la mediana ni la granularidad declarada.
//
// Efecto medido en los casos reales: la barra contaminada trae 40-90x el
// volumen de sus vecinas inmediatas (COST ~91x, MSFT hasta ~100x).

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

import { dropVolumeOutlierBars, writeDailyBarsCache } from "@/lib/dailyBarsCache";
import { supabaseRequest } from "@/lib/supabaseServer";

// Genera `count` barras descendentes (más reciente primero, el contrato de
// fetchYahooChart), volumen ~constante salvo overrides. Con stepDays=1
// (por defecto) salta fines de semana, como una serie diaria real; con un
// stepDays mayor genera huecos regulares (para simular histórico aislado).
function makeDailyBars(count, { startISO = "2026-08-14", volume = 1_000_000, stepDays = 1 } = {}) {
  const bars = [];
  let cursor = Date.parse(`${startISO}T00:00:00Z`);
  while (bars.length < count) {
    const d = new Date(cursor);
    const dow = d.getUTCDay();
    if (stepDays > 1 || (dow !== 0 && dow !== 6)) {
      bars.push({
        date: d.toISOString().slice(0, 10),
        open: 100, high: 105, low: 95, close: 102, adjClose: 102,
        volume,
        provider: "Yahoo Finance",
      });
    }
    cursor -= stepDays * 86400_000;
  }
  return bars;
}

const dailyBarsWrites = () =>
  supabaseRequest.mock.calls.filter(
    ([path, opts]) => path === "daily_bars" && (opts?.method === "POST" || opts?.method === "DELETE"),
  );

beforeEach(() => { supabaseRequest.mockClear(); });
afterEach(() => { vi.clearAllMocks(); });

describe("dropVolumeOutlierBars", () => {
  it("una serie diaria uniforme no descarta ninguna barra", () => {
    const bars = makeDailyBars(60);
    const { bars: kept, dropped } = dropVolumeOutlierBars(bars);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(60);
  });

  it("descarta una barra mensual incrustada (25x el volumen vecino)", () => {
    const bars = makeDailyBars(60);
    const target = bars[30].date;
    bars[30] = { ...bars[30], volume: 25_000_000 }; // 25x la línea base de 1.000.000
    const { bars: kept, dropped } = dropVolumeOutlierBars(bars);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].date).toBe(target);
    expect(kept).toHaveLength(59);
    expect(kept.some((b) => b.date === target)).toBe(false);
  });

  it("NO descarta un pico real de volumen (8x, por debajo del umbral)", () => {
    const bars = makeDailyBars(60);
    bars[30] = { ...bars[30], volume: 8_000_000 };
    const { bars: kept, dropped } = dropVolumeOutlierBars(bars);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(60);
  });

  it("NO descarta un pico sin suficientes vecinas densas a un lado (extremo del payload)", () => {
    // Solo 3 barras antes del pico (< VOLUME_OUTLIER_MIN_NEIGHBORS = 5).
    const bars = makeDailyBars(10);
    bars[3] = { ...bars[3], volume: 30_000_000 };
    const { dropped } = dropVolumeOutlierBars(bars);
    expect(dropped).toHaveLength(0);
  });

  it("NO descarta una barra aislada con vecinas a más de 4 días (histórico profundo tipo ^FCHI/FTNT)", () => {
    // Barra aislada rodeada de huecos de 30 días: nunca junta 5 vecinas a
    // ≤4 días naturales a ningún lado, así que la regla no se aplica.
    const bars = makeDailyBars(20, { stepDays: 30 });
    const isolated = { date: bars[10].date, open: 100, high: 105, low: 95, close: 102, adjClose: 102, volume: 50_000_000, provider: "Yahoo Finance" };
    bars[10] = isolated;
    const { dropped } = dropVolumeOutlierBars(bars);
    expect(dropped).toHaveLength(0);
  });
});

describe("writeDailyBarsCache · descarta solo la barra atípica, no el payload", () => {
  it("un payload de 60 barras con una mensual incrustada escribe 59 filas", async () => {
    const bars = makeDailyBars(60);
    const target = bars[30].date;
    bars[30] = { ...bars[30], volume: 25_000_000 };
    const result = await writeDailyBarsCache("COST", { bars, meta: {} });
    expect(result.status).toBe("supabase");
    expect(result.count).toBe(59);
    expect(result.droppedVolumeOutliers).toHaveLength(1);
    expect(result.droppedVolumeOutliers[0].date).toBe(target);
    const posted = dailyBarsWrites().filter(([, opts]) => opts.method === "POST");
    const writtenDates = posted.flatMap(([, opts]) => opts.body.map((row) => row.trade_date));
    expect(writtenDates).not.toContain(target);
  });

  it("un payload sin barras atípicas escribe todas las filas", async () => {
    const bars = makeDailyBars(60);
    const result = await writeDailyBarsCache("SPY", { bars, meta: {} });
    expect(result.status).toBe("supabase");
    expect(result.count).toBe(60);
    expect(result.droppedVolumeOutliers).toHaveLength(0);
  });
});
