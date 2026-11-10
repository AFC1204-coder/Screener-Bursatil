// «Max» del gráfico (range=MAX con interval W/M) sirve el histórico entero con
// cadencia semanal/mensual REAL y NO toca daily_bars: ni lee ni escribe.
//
// Motivo: daily_bars ya sufrió 1.840 filas no diarias escritas por esta misma
// causa (Yahoo degrada la granularidad con range=MAX; ver la cabecera de
// lib/dailyBarsCache.js). Estas barras viven solo en memoria del proceso.
//
// El espía es supabaseRequest/supabaseRpc: cualquier acceso a la tabla
// `daily_bars` (o a una RPC de barras) haría fallar el test. El caso D actúa
// de control: demuestra que el espía SÍ ve el camino de daily_bars.

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseCalls = [];

vi.mock("@/lib/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabaseConfig: () => ({
      configured: true,
      ownerId: "personal",
      url: "https://example.supabase.co",
      key: "test-key",
      missing: [],
    }),
    supabaseRequest: vi.fn(async (path, options = {}) => {
      supabaseCalls.push({ kind: "request", path, method: options.method || "GET" });
      return [];
    }),
    supabaseRequestAll: vi.fn(async (path, options = {}) => {
      supabaseCalls.push({ kind: "requestAll", path, method: options.method || "GET" });
      return [];
    }),
    supabaseRpc: vi.fn(async (name) => {
      supabaseCalls.push({ kind: "rpc", path: name, method: "POST" });
      return null;
    }),
  };
});

const DAY = 86400;
function bars(count, stepDays, { start = Date.UTC(1990, 0, 1) / 1000 } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const time = start + i * stepDays * DAY;
    return { time, date: new Date(time * 1000).toISOString().slice(0, 10), open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 1000 };
  }).reverse();
}

const fullHistory = vi.fn(async (symbol, { barInterval }) => ({
  bars: barInterval === "1mo" ? bars(400, 30) : bars(1800, 7),
  meta: { dataProvider: "Yahoo Finance", dataGranularity: barInterval, barInterval },
}));
const dailyChart = vi.fn(async () => ({
  bars: bars(300, 1, { start: Date.UTC(2025, 0, 1) / 1000 }),
  meta: { dataProvider: "Yahoo Finance", dataGranularity: "1d" },
}));

vi.mock("@/lib/marketData", () => ({
  fetchYahooChart: (...args) => dailyChart(...args),
  fetchYahooFullHistoryChart: (...args) => fullHistory(...args),
}));

const { GET, fullHistoryBarInterval } = await import("@/app/api/chart/route");

function chartRequest(query) {
  return new Request(`http://localhost/api/chart?${query}`);
}
const touchesDailyBars = () => supabaseCalls.filter((call) => /daily_bars|bars/i.test(String(call.path || "")));

beforeEach(() => {
  supabaseCalls.length = 0;
  fullHistory.mockClear();
  dailyChart.mockClear();
});

describe("/api/chart · Max no escribe en daily_bars", () => {
  it("range=MAX&interval=W: histórico semanal entero, cero accesos a daily_bars", async () => {
    const res = await GET(chartRequest("symbol=AAPL&range=MAX&interval=W"));
    const json = await res.json();

    expect(fullHistory).toHaveBeenCalledWith("AAPL", expect.objectContaining({ barInterval: "1wk" }));
    expect(dailyChart).not.toHaveBeenCalled();
    expect(touchesDailyBars()).toEqual([]);
    expect(supabaseCalls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(json.bars).toHaveLength(1800);
    expect(json.meta.barInterval).toBe("1wk");
    expect(json.dataQuality.status).toBe("real");
  });

  it("range=MAX&interval=M: mensual, cero accesos a daily_bars", async () => {
    const res = await GET(chartRequest("symbol=KO&range=MAX&interval=M"));
    const json = await res.json();

    expect(fullHistory).toHaveBeenCalledWith("KO", expect.objectContaining({ barInterval: "1mo" }));
    expect(touchesDailyBars()).toEqual([]);
    expect(json.meta.barInterval).toBe("1mo");
  });

  it("si Yahoo falla, la respuesta es ausencia explícita y tampoco se recurre a daily_bars", async () => {
    fullHistory.mockRejectedValueOnce(new Error("Yahoo chart HTTP 429"));
    const res = await GET(chartRequest("symbol=AAPL&range=MAX&interval=W"));
    const json = await res.json();

    expect(json.bars || []).toHaveLength(0);
    expect(json.dataQuality?.status).toBe("missing");
    expect(touchesDailyBars()).toEqual([]);
    expect(dailyChart).not.toHaveBeenCalled();
  });

  it("control: range=MAX&interval=D sigue el camino diario (el espía sí ve daily_bars)", async () => {
    await GET(chartRequest("symbol=AAPL&range=MAX&interval=D"));
    expect(fullHistory).not.toHaveBeenCalled();
    expect(touchesDailyBars().length).toBeGreaterThan(0);
  });

  it("solo MAX con W/M toma el camino de histórico completo", () => {
    expect(fullHistoryBarInterval("MAX", "W")).toBe("1wk");
    expect(fullHistoryBarInterval("MAX", "M")).toBe("1mo");
    expect(fullHistoryBarInterval("MAX", "D")).toBeNull();
    expect(fullHistoryBarInterval("5A", "W")).toBeNull();
    expect(fullHistoryBarInterval("MAX", "1H")).toBeNull();
  });
});
