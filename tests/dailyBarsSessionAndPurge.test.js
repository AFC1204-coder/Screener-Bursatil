// D4 y D5 de la auditoría de producto 2026-11
// (research/auditoria-producto-2026-11/informe.md, sección 2).
//
// D4: la barra de la sesión en curso no se persiste (calendario y huso de su
//     mercado, cierre + 30 min), y la lectura no da por fresca una caché cuya
//     última barra se escribió antes del asentamiento de su sesión.
// D5: (1) cada escritura borra las fechas cacheadas dentro de [min, max] del
//     payload que el proveedor ya no devuelve; (2) guard de escala ×5/×10 que
//     descarta la barra y marca la serie para pedirla de nuevo completa.
//
// Sin base de datos: supabaseRequest es un espía (mismo patrón que
// tests/dailyBarsWriteCap.test.js).

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  absentCachedDates,
  dropScaleOutlierBars,
  needsFullRefetch,
  readDailyBarsCache,
  withDailyBarsCache,
  writeDailyBarsCache,
} from "@/lib/dailyBarsCache";
import {
  barSessionDate,
  isBarSessionInProgress,
  isLastNyseSessionOfWeek,
  isTradingDay,
  marketForSymbol,
  marketTimeLabel,
  nyseHolidays,
  nyseNonTradingDays,
  previousNyseSession,
  wasWrittenBeforeSettle,
} from "@/lib/marketCalendar";
import { supabaseRequest } from "@/lib/supabaseServer";

const DAY = 86400000;

// Barras diarias de lunes a viernes que terminan en `lastDate`, DESC.
function weekdayBars(lastDate, count, { close = 100, volume = 1_000_000, provider = "Yahoo Finance" } = {}) {
  const bars = [];
  let ms = Date.parse(`${lastDate}T00:00:00Z`);
  while (bars.length < count) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = bars.length;
      bars.push({
        date: new Date(ms).toISOString().slice(0, 10),
        open: close + i * 0.01,
        high: close + 1 + i * 0.01,
        low: close - 1 + i * 0.01,
        close: close + i * 0.01,
        adjClose: close + i * 0.01,
        volume: volume + i,
        provider,
      });
    }
    ms -= DAY;
  }
  return bars;
}

// Barras como las devuelve readDailyBarsCache (normalizeCachedBar).
function asCached(bars, updatedAt) {
  return bars.map((bar) => ({
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.adjClose ?? bar.close,
    rawClose: bar.close,
    adjClose: bar.adjClose ?? bar.close,
    volume: bar.volume,
    provider: bar.provider,
    updatedAt,
  }));
}

// Filas de daily_bars como las devuelve supabaseRequest en la lectura.
function asRows(bars, updatedAt) {
  return bars.map((bar) => ({
    symbol: "X",
    trade_date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    adj_close: bar.adjClose ?? bar.close,
    volume: bar.volume,
    provider: bar.provider,
    updated_at: updatedAt,
  }));
}

const posts = () => supabaseRequest.mock.calls.filter(([p, o]) => p === "daily_bars" && o?.method === "POST");
const deletes = () => supabaseRequest.mock.calls.filter(([p, o]) => p === "daily_bars" && o?.method === "DELETE");
const postedDates = () => posts().flatMap(([, o]) => o.body.map((row) => row.trade_date));

beforeEach(() => {
  supabaseRequest.mockReset();
  supabaseRequest.mockImplementation(async () => []);
});

// ===========================================================================
// Calendario
// ===========================================================================

describe("marketCalendar · festivos NYSE y sesiones", () => {
  it("calcula los festivos NYSE de 2026 (incluye Viernes Santo y el 4 de julio trasladado)", () => {
    expect([...nyseHolidays(2026)].sort()).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
      "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]);
  });

  it("aplica las reglas de traslado: sábado→viernes, domingo→lunes, Año Nuevo en sábado no se traslada", () => {
    expect(nyseHolidays(2027).has("2027-07-05")).toBe(true); // 4-jul domingo
    expect(nyseHolidays(2027).has("2027-12-24")).toBe(true); // Navidad sábado
    expect(nyseHolidays(2022).has("2021-12-31")).toBe(false);
    expect(nyseHolidays(2021).has("2021-12-31")).toBe(false);
    expect(nyseHolidays(2025).has("2025-06-19")).toBe(true); // Juneteenth 2025 (faltaba en la lista a mano de a4)
    expect(nyseHolidays(2025).has("2025-01-09")).toBe(true); // cierre extraordinario
  });

  it("isTradingDay: festivos solo en EE. UU.; fines de semana en todos", () => {
    expect(isTradingDay("US", "2026-05-25")).toBe(false);
    expect(isTradingDay("US", "2026-05-26")).toBe(true);
    expect(isTradingDay("US", "2026-11-07")).toBe(false); // sábado
    expect(isTradingDay("HK", "2026-05-25")).toBe(true);
    expect(isTradingDay("DE", "2026-11-08")).toBe(false);
    expect(nyseNonTradingDays("2026-05-22", "2026-05-26")).toEqual(["2026-05-23", "2026-05-24", "2026-05-25"]);
  });

  it("semana NYSE: el jueves es la última sesión si el viernes es festivo; sesión previa salta festivos", () => {
    expect(isLastNyseSessionOfWeek("2026-04-02")).toBe(true);
    expect(isLastNyseSessionOfWeek("2026-04-01")).toBe(false);
    expect(isLastNyseSessionOfWeek("2026-10-16")).toBe(true);
    expect(previousNyseSession("2026-05-26")).toBe("2026-05-22");
  });

  it("mapea símbolos a su mercado (sufijo, índices, divisas) y la barra australiana del domingo a la sesión del lunes", () => {
    expect(marketForSymbol("AAPL")).toBe("US");
    expect(marketForSymbol("0700.HK")).toBe("HK");
    expect(marketForSymbol("SAP.DE")).toBe("DE");
    expect(marketForSymbol("^AXJO")).toBe("AU");
    expect(marketForSymbol("EURUSD=X")).toBe("FX");
    expect(barSessionDate("AU", "2026-11-08")).toBe("2026-11-09"); // AEDT: 10:00 = 23:00 UTC del domingo
    expect(barSessionDate("US", "2026-11-06")).toBe("2026-11-06");
    expect(marketTimeLabel("AAPL", "2026-11-06T19:53:00Z")).toBe("14:53 ET");
  });

  it("cierre + 30 min con horario de verano correcto (EE. UU., Hong Kong, Europa)", () => {
    // EE. UU., invierno (EST): 16:30 ET = 21:30 UTC.
    expect(isBarSessionInProgress("AAPL", "2026-11-06", "2026-11-06T21:29:00Z")).toBe(true);
    expect(isBarSessionInProgress("AAPL", "2026-11-06", "2026-11-06T21:30:00Z")).toBe(false);
    // EE. UU., verano (EDT): 16:30 ET = 20:30 UTC.
    expect(isBarSessionInProgress("AAPL", "2026-07-06", "2026-07-06T20:29:00Z")).toBe(true);
    expect(isBarSessionInProgress("AAPL", "2026-07-06", "2026-07-06T20:31:00Z")).toBe(false);
    // Hong Kong (sin horario de verano): 16:10 + 30 = 16:40 HKT = 08:40 UTC.
    expect(isBarSessionInProgress("0700.HK", "2026-11-06", "2026-11-06T08:39:00Z")).toBe(true);
    expect(isBarSessionInProgress("0700.HK", "2026-11-06", "2026-11-06T08:41:00Z")).toBe(false);
    // Xetra, verano (CEST): 17:35 + 30 = 18:05 CEST = 16:05 UTC.
    expect(isBarSessionInProgress("SAP.DE", "2026-07-06", "2026-07-06T16:04:00Z")).toBe(true);
    expect(isBarSessionInProgress("SAP.DE", "2026-07-06", "2026-07-06T16:06:00Z")).toBe(false);
    // Londres, invierno (GMT): 16:35 + 30 = 17:05 UTC.
    expect(isBarSessionInProgress("VOD.L", "2026-11-06", "2026-11-06T17:04:00Z")).toBe(true);
    expect(isBarSessionInProgress("VOD.L", "2026-11-06", "2026-11-06T17:06:00Z")).toBe(false);
    // Escrita a las 14:53 ET → parcial; a las 16:45 ET → asentada.
    expect(wasWrittenBeforeSettle("AAPL", "2026-11-06", "2026-11-06T19:53:00Z")).toBe(true);
    expect(wasWrittenBeforeSettle("AAPL", "2026-11-06", "2026-11-06T21:45:00Z")).toBe(false);
  });
});

// ===========================================================================
// D4 · escritura
// ===========================================================================

describe("D4 · writeDailyBarsCache no persiste la barra de la sesión en curso", () => {
  const cases = [
    { market: "EE. UU.", symbol: "AAPL", during: "2026-11-06T19:53:00Z", after: "2026-11-06T21:31:00Z" },
    { market: "Hong Kong", symbol: "0700.HK", during: "2026-11-06T05:00:00Z", after: "2026-11-06T08:41:00Z" },
    { market: "Europa (Xetra)", symbol: "SAP.DE", during: "2026-11-06T15:00:00Z", after: "2026-11-06T17:06:00Z" },
  ];

  for (const { market, symbol, during, after } of cases) {
    it(`${market}: con now dentro de la sesión la barra de hoy no se escribe; tras el cierre + 30 min sí`, async () => {
      const bars = weekdayBars("2026-11-06", 30);

      const open = await writeDailyBarsCache(symbol, { bars, meta: {} }, { now: during, cachedBars: [] });
      expect(open.droppedUnsettled).toEqual(["2026-11-06"]);
      expect(postedDates()).not.toContain("2026-11-06");
      expect(postedDates()).toContain("2026-11-05");

      supabaseRequest.mockClear();
      const closed = await writeDailyBarsCache(symbol, { bars, meta: {} }, { now: after, cachedBars: [] });
      expect(closed.droppedUnsettled).toEqual([]);
      expect(postedDates()).toContain("2026-11-06");
    });
  }

  it("una barra cacheada parcial se reescribe aunque sus valores coincidan (el delta no la salta)", async () => {
    const bars = weekdayBars("2026-11-05", 10);
    const cached = asCached(bars, "2026-11-06T22:00:00.000Z");
    cached[0] = { ...cached[0], updatedAt: "2026-11-05T19:53:00.000Z" }; // 14:53 ET del 5-nov

    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} }, { now: "2026-11-07T12:00:00Z", cachedBars: cached });

    expect(result.count).toBe(1);
    expect(postedDates()).toEqual(["2026-11-05"]);
  });
});

// ===========================================================================
// D4 · lectura
// ===========================================================================

describe("D4 · readDailyBarsCache no da por fresca una última barra escrita antes del cierre", () => {
  it("última barra escrita a las 14:53 ET de su sesión → no es hit (partialLatest)", async () => {
    const bars = weekdayBars("2026-11-06", 20);
    const rows = asRows(bars, "2026-11-06T22:00:00.000Z");
    rows[0] = { ...rows[0], updated_at: "2026-11-06T19:53:00.000Z" };
    supabaseRequest.mockImplementation(async (path) => (path === "daily_bars" ? rows : []));

    const read = await readDailyBarsCache("AAPL", { range: "1M", maxAgeDays: 3650 });

    expect(read.hit).toBe(false);
    expect(read.partialLatest).toBe(true);
    expect(read.status).toBe("stale");
  });

  it("la misma barra escrita después del cierre + 30 min → hit", async () => {
    const rows = asRows(weekdayBars("2026-11-06", 20), "2026-11-06T21:45:00.000Z");
    supabaseRequest.mockImplementation(async (path) => (path === "daily_bars" ? rows : []));

    const read = await readDailyBarsCache("AAPL", { range: "1M", maxAgeDays: 3650 });

    expect(read.hit).toBe(true);
    expect(read.partialLatest).toBe(false);
  });
});

// ===========================================================================
// D5 (1) · fechas que el proveedor ya no devuelve
// ===========================================================================

describe("D5 · borrado de fechas ausentes del payload", () => {
  it("un payload sin la fecha X borra la X cacheada dentro de su rango, y no toca las de fuera", async () => {
    // Payload del 2026-05-11 al 2026-06-05 (laborables) — sin el 25-may.
    const bars = weekdayBars("2026-06-05", 20).filter((bar) => bar.date !== "2026-05-25");
    const cached = [
      ...asCached(bars, "2026-06-10T00:00:00.000Z"),
      ...asCached([{ date: "2026-05-25", open: 176, high: 256, low: 173, close: 255.55, volume: 89_577_800, provider: "Yahoo Finance" }], "2026-08-15T19:12:00.000Z"),
      // Fuera del rango del payload: no se toca aunque falte en el payload.
      ...asCached([{ date: "2026-04-03", open: 1, high: 1, low: 1, close: 1, volume: 1, provider: "Yahoo Finance" }], "2026-06-10T00:00:00.000Z"),
      // Dentro del rango pero de otro proveedor: no se toca.
      ...asCached([{ date: "2026-05-23", open: 1, high: 1, low: 1, close: 1, volume: 1, provider: "Stooq" }], "2026-06-10T00:00:00.000Z"),
    ];

    const result = await writeDailyBarsCache("SNOW", { bars, meta: { dataProvider: "Yahoo Finance" } }, { now: "2026-11-07T12:00:00Z", cachedBars: cached });

    expect(result.deletedAbsentDates).toEqual(["2026-05-25"]);
    expect(deletes()).toHaveLength(1);
    const query = deletes()[0][1].query;
    expect(query).toContain("symbol=eq.SNOW");
    expect(query).toContain("trade_date=in.(2026-05-25)");
    expect(query).toContain("provider=eq.Yahoo%20Finance");
    expect(query).not.toContain("2026-04-03");
    expect(query).not.toContain("2026-05-23");
  });

  it("sin caché leída por el llamador (refresh), lee las fechas del rango y borra igual", async () => {
    const bars = weekdayBars("2026-06-05", 20).filter((bar) => bar.date !== "2026-05-25");
    supabaseRequest.mockImplementation(async (path, opts) => {
      if (path === "daily_bars" && !opts?.method) {
        return [...bars.map((b) => ({ trade_date: b.date, provider: "Yahoo Finance" })), { trade_date: "2026-05-25", provider: "Yahoo Finance" }];
      }
      return [];
    });

    const result = await writeDailyBarsCache("SNOW", { bars, meta: { dataProvider: "Yahoo Finance" } }, { now: "2026-11-07T12:00:00Z" });

    expect(result.deletedAbsentDates).toEqual(["2026-05-25"]);
  });

  it("freno: si faltan más de 12 fechas (payload truncado) no borra nada", async () => {
    const full = weekdayBars("2026-06-30", 60);
    const bars = full.filter((_, i) => i % 3 !== 1); // faltan 20 fechas
    const result = await writeDailyBarsCache("SNOW", { bars, meta: { dataProvider: "Yahoo Finance" } }, {
      now: "2026-11-07T12:00:00Z",
      cachedBars: asCached(full, "2026-07-10T00:00:00.000Z"),
    });

    expect(deletes()).toHaveLength(0);
    expect(result.deletedAbsentDates).toEqual([]);
    expect(result.absentDeleteSkipped).toMatch(/truncado/);
  });

  it("absentCachedDates: rango cerrado [min, max] del payload", () => {
    const payload = [{ date: "2026-05-22" }, { date: "2026-05-26" }];
    const cached = [{ date: "2026-05-21" }, { date: "2026-05-25" }, { date: "2026-05-27" }];
    expect(absentCachedDates(payload, cached)).toEqual(["2026-05-25"]);
  });
});

// ===========================================================================
// D5 (2) · guard de escala
// ===========================================================================

describe("D5 · guard de escala (contrasplit sin ajustar)", () => {
  // VEEA real (daily_bars local): 3,16 → 0,126 (19,3 M) → 2,52 con unos 80-120 k.
  function veeaLike() {
    const bars = weekdayBars("2026-08-25", 20, { close: 3, volume: 50_000 });
    const idx = bars.findIndex((bar) => bar.date === "2026-08-11");
    bars[idx] = { ...bars[idx], open: 0.12, high: 0.13, low: 0.12, close: 0.126, adjClose: 0.126, volume: 19_340_900 };
    return bars;
  }

  it("dropScaleOutlierBars descarta la barra ×5 frente a sus dos vecinas con volumen ×10", () => {
    const { bars, dropped } = dropScaleOutlierBars(veeaLike());
    expect(dropped.map((d) => d.date)).toEqual(["2026-08-11"]);
    expect(bars.some((bar) => bar.date === "2026-08-11")).toBe(false);
  });

  it("no descarta un movimiento ×5 sin volumen ×10, ni uno que no vuelve al día siguiente", () => {
    const quiet = veeaLike().map((bar) => (bar.date === "2026-08-11" ? { ...bar, volume: 200_000 } : bar));
    expect(dropScaleOutlierBars(quiet).dropped).toEqual([]);
    const realCrash = weekdayBars("2026-08-25", 20, { close: 3, volume: 50_000 }).map((bar) =>
      bar.date <= "2026-08-11" ? bar : { ...bar, close: 0.5, adjClose: 0.5, volume: 2_000_000 });
    expect(dropScaleOutlierBars(realCrash).dropped).toEqual([]);
  });

  it("writeDailyBarsCache no escribe la barra, marca la serie y la siguiente pasada la pide completa sin caché en memoria", async () => {
    const bars = veeaLike();
    const write = await writeDailyBarsCache("VEEA", { bars, meta: {} }, { now: "2026-11-07T12:00:00Z", cachedBars: [] });

    expect(write.needsFullRefetch).toBe(true);
    expect(write.droppedScaleOutliers.map((d) => d.date)).toEqual(["2026-08-11"]);
    expect(postedDates()).not.toContain("2026-08-11");
    expect(needsFullRefetch("VEEA")).toBe(true);

    // La lectura ya no da la caché por fresca…
    const rows = asRows(bars.filter((bar) => bar.date !== "2026-08-11"), "2026-08-26T00:00:00.000Z");
    supabaseRequest.mockImplementation(async (path) => (path === "daily_bars" ? rows : []));
    const read = await readDailyBarsCache("VEEA", { range: "1M", maxAgeDays: 3650 });
    expect(read.hit).toBe(false);
    expect(read.refetchPending).toBe(true);

    // …y withDailyBarsCache vuelve a pedirla con refresh:true. Con un payload
    // ya limpio, la marca se borra.
    const clean = weekdayBars("2026-08-25", 20, { close: 3, volume: 50_000 });
    const fetcher = vi.fn(async () => ({ bars: clean, meta: {} }));
    await withDailyBarsCache("VEEA", { range: "1M", interval: "D", maxAgeDays: 3650, now: "2026-11-07T12:00:00Z" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].refresh).toBe(true);
    expect(needsFullRefetch("VEEA")).toBe(false);
  });
});
