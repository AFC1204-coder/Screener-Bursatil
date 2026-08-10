// Tests del cap de escritura + purga oportunista en daily_bars
// (lib/dailyBarsCache.js#writeDailyBarsCache).
//
// CONTEXTO — qué se testea y qué no, sin DB real:
//
// daily_bars es la tabla más pesada del proyecto (~2.28GB de ~2.85GB totales),
// porque writeDailyBarsCache escribía la serie histórica completa que devuelve
// el proveedor (range=MAX podía traer décadas para símbolos viejos) sin ningún
// cap de profundidad. La política de retención (paso 1 de 5, fase código):
//   - Cap de escritura: 400 barras por defecto, 1260 si el símbolo está
//     referenciado (favorito/nota/alerta activa del owner).
//   - Purga oportunista por símbolo: tras el upsert, si el payload excedió el
//     cap, DELETE de las filas viejas de ESE (owner, symbol, provider).
//   - Eliminación del campo `raw` del payload de escritura (columna write-only
//     que se va a DROP en paso posterior manual).
//   - listingDate en company-brief se calcula en memoria sobre la respuesta
//     cruda del fetch (longChart.bars), antes de pasar a la caché — para que la
//     profundidad completa viva solo en tránsito, no persistida.
//
// Estos tests mockean supabaseRequest para verificar el wiring:
//   - El payload POST tiene exactamente `writeCap` filas, las más recientes.
//   - El DELETE se dispara con el trade_date de corte correcto y SOLO sobre el
//     símbolo+provider escrito (nunca barrido de tabla).
//   - El cap sube a 1260 cuando favorites/notes/alerts tienen una fila para el
//     símbolo, y baja a 400 cuando ninguna de las 3 tiene.
//   - El payload POST no incluye el campo `raw` en ninguna fila.
//   - listingDate en company-brief proviene de longChart.bars (no de la caché
//     post-cap).
//
// Lo que NO cubren (pendiente de validación en runtime contra Postgres real):
//   - Que el DELETE con trade_date=lt.X efectivamente borra las filas viejas y
//     no toca las recientes (depende del índice y del planificador de Postgres).
//   - Que el cap holgado (1260) se aplica correctamente cuando el owner tiene
//     miles de favoritos (escala).
//   - Que `isSymbolReferenced` es suficientemente rápida en la práctica.
//   - Que el backstop semanal de pg_cron atrapa lo que esta purga oportunista
//     no cubre (cubren casos complementarios, no redundantes).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// supabaseConfig debe declararse "configured" para que writeDailyBarsCache no
// salga temprano con status:"disabled".
vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: () => ({
    configured: true,
    ownerId: "personal",
    url: "https://example.supabase.co",
    key: "test-key",
    missing: [],
  }),
  // supabaseRequest es el espía principal: captura método, query y body.
  supabaseRequest: vi.fn(async () => []),
  toDate: (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  },
}));

import { writeDailyBarsCache } from "@/lib/dailyBarsCache";
import { ESTIMATED_CHART_PROVIDER } from "@/lib/estimatedBars";
import { supabaseRequest } from "@/lib/supabaseServer";

function makeBars(count, { startYear = 2024, symbol = "AAPL", provider = "Yahoo Finance" } = {}) {
  // Genera `count` barras diarias descendentes (más reciente primera), desde
  // startYear hacia atrás. Cada barra tiene el shape que produce fetchYahooChart.
  const bars = [];
  const base = Date.UTC(startYear, 0, 1);
  const DAY = 86400_000;
  for (let i = 0; i < count; i += 1) {
    const date = new Date(base + i * DAY);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open: 100 + i * 0.01,
      high: 105 + i * 0.01,
      low: 95 + i * 0.01,
      close: 102 + i * 0.01,
      adjClose: 102 + i * 0.01,
      volume: 1_000_000 + i,
      currency: "USD",
      provider,
      time: Math.floor(date.getTime() / 1000),
    });
  }
  // fetchYahooChart devuelve bars ordenadas DESC (más reciente primero).
  return bars.reverse();
}

const dailyBarsCalls = () =>
  supabaseRequest.mock.calls.filter(([path]) => path === "daily_bars");

const dailyBarsPosts = () =>
  dailyBarsCalls().filter(([, opts]) => opts.method === "POST");

const dailyBarsDeletes = () =>
  dailyBarsCalls().filter(([, opts]) => opts.method === "DELETE");

beforeEach(() => {
  supabaseRequest.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Cap por defecto (400) — símbolo NO referenciado
// ===========================================================================

describe("writeDailyBarsCache · cap 400 para símbolo no referenciado", () => {
  it("trunca el payload a 400 barras cuando ninguna tabla referencia el símbolo", async () => {
    // supabaseRequest devuelve [] para favorites/notes/alerts (no referenciado).
    supabaseRequest.mockResolvedValue([]);

    const bars = makeBars(2000); // 2000 barras → debería truncar a 400.
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });

    expect(result.written).toBe(true);
    expect(result.count).toBe(400);
    expect(result.writeCap).toBe(400);
    expect(result.referenced).toBe(false);

    const posts = dailyBarsPosts();
    expect(posts.length).toBeGreaterThanOrEqual(1); // al menos 1 batch (400 ≤ 500).
    const allRows = posts.flatMap(([, opts]) => opts.body);
    expect(allRows).toHaveLength(400);

    // Las barras retenidas son las 400 MÁS RECIENTES. makeBars las pone DESC,
    // así que bars[0] es la más reciente → debe estar en el payload.
    const datesInPayload = allRows.map((r) => r.trade_date).sort();
    const expectedRecentDates = bars.slice(0, 400).map((b) => b.date).sort();
    expect(datesInPayload).toEqual(expectedRecentDates);
  });

  it("no excede el cap aunque el payload sea enorme (range=MAX)", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(15000); // ~ MAX para un símbolo muy viejo.
    const result = await writeDailyBarsCache("OLD.STOCK", { bars, meta: {} });
    expect(result.count).toBe(400);
    const allRows = dailyBarsPosts().flatMap(([, opts]) => opts.body);
    expect(allRows).toHaveLength(400);
  });

  it("no trunca si el payload ya está por debajo del cap", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(150); // menos del cap.
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });
    expect(result.count).toBe(150);
    expect(result.purgedBefore).toBeNull();
    // No debe haber DELETE cuando no hubo excedente.
    expect(dailyBarsDeletes()).toHaveLength(0);
  });
});

// ===========================================================================
// Cap holgado (1260) — símbolo SÍ referenciado
// ===========================================================================

describe("writeDailyBarsCache · cap 1260 para símbolo referenciado", () => {
  it("sube el cap a 1260 cuando favorites tiene el símbolo", async () => {
    // favorites devuelve una fila → referenciado. La función prueba favorites
    // primero, así que con eso basta.
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "favorites") return [{ id: "fav-1" }];
      return [];
    });

    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });

    expect(result.referenced).toBe(true);
    expect(result.writeCap).toBe(1260);
    expect(result.count).toBe(1260);
    const allRows = dailyBarsPosts().flatMap(([, opts]) => opts.body);
    expect(allRows).toHaveLength(1260);
  });

  it("sube el cap a 1260 cuando notes tiene el símbolo (favoritos vacío)", async () => {
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "notes") return [{ id: "note-1" }];
      return [];
    });
    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("MSFT", { bars, meta: {} });
    expect(result.referenced).toBe(true);
    expect(result.writeCap).toBe(1260);
  });

  it("sube el cap a 1260 cuando alerts tiene el símbolo activo", async () => {
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "alerts") return [{ id: "alert-1" }];
      return [];
    });
    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("TSLA", { bars, meta: {} });
    expect(result.referenced).toBe(true);
    expect(result.writeCap).toBe(1260);
  });

  it("resetea el cap a 400 cuando favorites está borrado (deleted_at is null excluye)", async () => {
    // favorites devuelve [] (el filtro deleted_at=is.null excluyó el tombstone),
    // notes/alerts también vacíos → no referenciado.
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("GONE", { bars, meta: {} });
    expect(result.referenced).toBe(false);
    expect(result.writeCap).toBe(400);
  });

  it("trata un error de consulta de referencia como no-referenciado (cap estricto)", async () => {
    // Si la consulta de referencia falla, preferimos el cap estricto (400)
    // antes que inflar la caché por un fallo transitorio. Solo la lectura de
    // referencia falla; el POST del upsert debe proceder.
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "favorites" || path === "notes" || path === "alerts") {
        throw new Error("network error");
      }
      return [];
    });
    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });
    expect(result.referenced).toBe(false);
    expect(result.writeCap).toBe(400);
    // El write principal aún debe proceder (la consulta de referencia es
    // best-effort, no bloquea el write).
    expect(result.written).toBe(true);
  });
});

// ===========================================================================
// Purga oportunista por símbolo — DELETE con rango correcto
// ===========================================================================

describe("writeDailyBarsCache · purga oportunista DELETE por símbolo", () => {
  it("dispara DELETE con trade_date=lt.<cutoff> cuando el payload excede el cap", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(2000); // cap 400, excedente de 1600.
    await writeDailyBarsCache("AAPL", { bars, meta: {} });

    const deletes = dailyBarsDeletes();
    expect(deletes).toHaveLength(1);
    const [, deleteOpts] = deletes[0];
    expect(deleteOpts.method).toBe("DELETE");
    expect(deleteOpts.query).toContain("symbol=eq.AAPL");
    expect(deleteOpts.query).toContain("owner_id=eq.personal");
    expect(deleteOpts.query).toMatch(/trade_date=lt\.\d{4}-\d{2}-\d{2}/);
    expect(deleteOpts.query).toContain("provider=eq.Yahoo%20Finance");
  });

  it("el cutoff de DELETE es la trade_date de la barra cap-ésima más reciente", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });
    // bars[399] (0-indexed) es la 400ª más reciente — su fecha es el cutoff.
    const expectedCutoff = bars[399].date;
    expect(result.purgedBefore).toBe(expectedCutoff);
    const [, deleteOpts] = dailyBarsDeletes()[0];
    expect(deleteOpts.query).toContain(`trade_date=lt.${expectedCutoff}`);
  });

  it("el cutoff sube a la barra 1260 cuando el símbolo está referenciado", async () => {
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "favorites") return [{ id: "fav-1" }];
      return [];
    });
    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });
    // bars[1259] (0-indexed) es la 1260ª más reciente — su fecha es el cutoff.
    const expectedCutoff = bars[1259].date;
    expect(result.purgedBefore).toBe(expectedCutoff);
    const [, deleteOpts] = dailyBarsDeletes()[0];
    expect(deleteOpts.query).toContain(`trade_date=lt.${expectedCutoff}`);
  });

  it("NO dispara DELETE si el payload no excedió el cap", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(400); // exactamente el cap, sin excedente.
    await writeDailyBarsCache("AAPL", { bars, meta: {} });
    expect(dailyBarsDeletes()).toHaveLength(0);
  });

  it("el DELETE es best-effort: un fallo no rompe el write principal", async () => {
    supabaseRequest.mockImplementation(async (path, opts) => {
      if (opts.method === "DELETE") throw new Error("delete failed");
      if (path === "favorites") return [];
      return [];
    });
    const bars = makeBars(2000);
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });
    expect(result.written).toBe(true);
    expect(result.count).toBe(400);
    // El error del DELETE no se propaga al caller.
    expect(result.status).toBe("supabase");
  });

  it("el DELETE toca SOLO el símbolo escrito, no barrido de tabla", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(2000);
    await writeDailyBarsCache("UNIQUE.SYMBOL", { bars, meta: {} });
    const [, deleteOpts] = dailyBarsDeletes()[0];
    // El filtro symbol=eq debe estar presente y apuntar al símbolo exacto.
    expect(deleteOpts.query).toContain("symbol=eq.UNIQUE.SYMBOL");
    // No debe haber un DELETE sin filtro symbol (barrido de tabla).
    expect(deleteOpts.query).not.toMatch(/^$/);
  });
});

// ===========================================================================
// Campo `raw` ausente del payload de escritura
// ===========================================================================

describe("writeDailyBarsCache · campo `raw` ausente del payload POST", () => {
  it("ninguna fila del payload POST contiene el campo `raw`", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(50);
    await writeDailyBarsCache("AAPL", { bars, meta: {} });
    const allRows = dailyBarsPosts().flatMap(([, opts]) => opts.body);
    expect(allRows.length).toBeGreaterThan(0);
    for (const row of allRows) {
      expect(row).not.toHaveProperty("raw");
    }
  });

  it("los campos OHLCV/adj_close/volume/currency/provider siguen presentes", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(5);
    await writeDailyBarsCache("AAPL", { bars, meta: {} });
    const [firstPost] = dailyBarsPosts();
    const row = firstPost[1].body[0];
    for (const field of ["symbol", "trade_date", "open", "high", "low", "close", "adj_close", "volume", "currency", "provider", "owner_id", "updated_at"]) {
      expect(row).toHaveProperty(field);
    }
  });
});

// ===========================================================================
// Aislamiento: no toca scan_results / favorites / favorite_snapshots
// ===========================================================================

describe("writeDailyBarsCache · aislamiento de otras tablas", () => {
  it("todos los writes son a la tabla daily_bars, nunca a scan_results/favorites", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(2000);
    await writeDailyBarsCache("AAPL", { bars, meta: {} });
    const writes = supabaseRequest.mock.calls.filter(([, opts]) => opts.method === "POST" || opts.method === "DELETE" || opts.method === "PATCH");
    const tables = new Set(writes.map(([path]) => path));
    expect(tables.has("daily_bars")).toBe(true);
    expect(tables.has("scan_results")).toBe(false);
    expect(tables.has("favorites")).toBe(false);
    expect(tables.has("favorite_snapshots")).toBe(false);
  });

  it("las consultas de referencia solo LEEN favorites/notes/alerts, nunca escriben", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(2000);
    await writeDailyBarsCache("AAPL", { bars, meta: {} });
    const refs = supabaseRequest.mock.calls.filter(([path]) => ["favorites", "notes", "alerts"].includes(path));
    expect(refs.length).toBeGreaterThan(0);
    for (const call of refs) {
      const opts = call[1] || {};
      expect(opts.method || "GET").toBe("GET");
    }
  });
});

// ===========================================================================
// Guard anti-estimados — barras sintéticas nunca llegan a daily_bars
// ===========================================================================

describe("writeDailyBarsCache · guard anti-estimados", () => {
  // La invariant que sostiene este guard: lo que sale de la caché es siempre
  // mercado real (decision-grade). Si una serie estimada se colase al write,
  // chartFromCache emitiría status:"real" sobre barras sintéticas — un bug
  // silencioso que corrompe el scoring. Por eso el rechazo es completo: o se
  // escribe toda la serie real, o nada.

  it("rechaza el write cuando dataQuality.estimated === true (no escribe nada)", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(50);
    const result = await writeDailyBarsCache("AAPL", {
      bars,
      meta: {},
      dataQuality: { status: "estimated", estimated: true },
    });

    expect(result).toMatchObject({ status: "rejected-estimated", written: false, count: 0 });
    // Cero writes a daily_bars — ni POST ni DELETE.
    expect(dailyBarsPosts()).toHaveLength(0);
    expect(dailyBarsDeletes()).toHaveLength(0);
  });

  it("rechaza cuando meta.estimated === true (sin dataQuality top-level)", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(50);
    const result = await writeDailyBarsCache("AAPL", { bars, meta: { estimated: true } });

    expect(result.status).toBe("rejected-estimated");
    expect(dailyBarsPosts()).toHaveLength(0);
  });

  it("rechaza cuando alguna barra trae estimated === true", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10);
    // Una sola barra sintética contamina toda la serie.
    bars[3] = { ...bars[3], estimated: true };
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });

    expect(result.status).toBe("rejected-estimated");
    expect(dailyBarsPosts()).toHaveLength(0);
  });

  it("rechaza cuando alguna barra trae provider === ESTIMATED_CHART_PROVIDER", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10);
    bars[5] = { ...bars[5], provider: ESTIMATED_CHART_PROVIDER };
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });

    expect(result.status).toBe("rejected-estimated");
    expect(dailyBarsPosts()).toHaveLength(0);
  });

  it("NO ejecuta la consulta de referencia (isSymbolReferenced) cuando rechaza por estimado", async () => {
    // El guard corre antes que la consulta de referencia, así que un rechazo
    // no debe tocar favorites/notes/alerts en absoluto.
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(50);
    await writeDailyBarsCache("AAPL", {
      bars,
      meta: {},
      dataQuality: { estimated: true },
    });

    const refs = supabaseRequest.mock.calls.filter(([path]) => ["favorites", "notes", "alerts"].includes(path));
    expect(refs).toHaveLength(0);
  });

  it("escribe normalmente cuando la serie es real (sin señales estimated)", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(50);
    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} });

    expect(result.written).toBe(true);
    expect(dailyBarsPosts().flatMap(([, opts]) => opts.body)).toHaveLength(50);
  });
});

// ===========================================================================
// Delta de escritura — options.cachedBars (docs/rango-corto-escritura-2026-08-10.md)
// ===========================================================================
// writeDailyBarsCache ya no reescribe una fila cuya fecha ya está en
// options.cachedBars con los mismos valores. `cachedBars` tiene el shape que
// produce normalizeCachedBar (lib/dailyBarsCache.js): `close` es el ADJUSTED
// close (columna adj_close), `rawClose` es la columna `close` sin ajustar.
// Todos los payloads de este bloque usan menos de 400 barras (el cap por
// defecto) para que ninguno dispare la purga oportunista por excedente —
// eso ya está cubierto en el bloque de purga de arriba y no es lo que se
// está probando aquí.

function makeCachedBars(rows, { currency = "USD", provider = "Yahoo Finance" } = {}) {
  // Réplica del shape de normalizeCachedBar: en este pipeline close===adj_close
  // siempre (docs/rango-corto-escritura-2026-08-10.md §B.6, confirmado también
  // en docs/splits-daily-bars-2026-08-09.md §A.4), así que rawClose/adjClose
  // parten del mismo valor salvo que el test pida explícitamente lo contrario.
  return rows.map((row) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    rawClose: row.rawClose ?? row.close,
    adjClose: row.close,
    volume: row.volume,
    currency,
    provider,
    updatedAt: "2026-08-01T00:00:00.000Z",
  }));
}

describe("writeDailyBarsCache · delta contra options.cachedBars", () => {
  it("primera descarga (sin cachedBars) escribe todo, igual que antes", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10);
    // Sin options.cachedBars en absoluto — el caso de un symbol que nunca se
    // descargó, o de cualquier llamada directa que no pase por
    // withDailyBarsCache (como el resto de tests de este archivo).
    const result = await writeDailyBarsCache("NEW.SYMBOL", { bars, meta: {} });

    expect(result.status).toBe("supabase");
    expect(result.written).toBe(true);
    expect(result.count).toBe(10);
    expect(result.candidates).toBe(10);
    const allRows = dailyBarsPosts().flatMap(([, opts]) => opts.body);
    expect(allRows).toHaveLength(10);
  });

  it("refresco con una barra nueva escribe solo esa barra", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10, { symbol: "AAPL" }); // 10 fechas, la más nueva es bars[0].
    const cachedBars = makeCachedBars(bars.slice(1)); // las 9 más viejas, sin cambios.

    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} }, { cachedBars });

    expect(result.status).toBe("supabase");
    expect(result.written).toBe(true);
    expect(result.count).toBe(1);
    expect(result.candidates).toBe(10);
    const allRows = dailyBarsPosts().flatMap(([, opts]) => opts.body);
    expect(allRows).toHaveLength(1);
    expect(allRows[0].trade_date).toBe(bars[0].date);
  });

  it("refresco sin novedades no escribe nada — cero peticiones a daily_bars", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10, { symbol: "AAPL" });
    const cachedBars = makeCachedBars(bars); // las 10 fechas, valores idénticos.

    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} }, { cachedBars });

    expect(result.status).toBe("unchanged");
    expect(result.written).toBe(false);
    expect(result.count).toBe(0);
    expect(result.candidates).toBe(10);
    // Cero peticiones de escritura: ni POST (upsert) ni DELETE (purga — no
    // aplica de todos modos, 10 barras no exceden el cap de 400).
    expect(dailyBarsPosts()).toHaveLength(0);
    expect(dailyBarsDeletes()).toHaveLength(0);
  });

  it("una barra con precio corregido sí se escribe, aunque la fecha ya existiera", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10, { symbol: "AAPL" });
    const cachedBars = makeCachedBars(bars);
    // Corrige el close de la barra más antigua del lote (índice 9) en más de
    // la tolerancia relativa (1e-6): un cambio real de precio, no ruido.
    cachedBars[9] = { ...cachedBars[9], close: cachedBars[9].close + 5, rawClose: cachedBars[9].rawClose + 5, adjClose: cachedBars[9].adjClose + 5 };

    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} }, { cachedBars });

    expect(result.status).toBe("supabase");
    expect(result.count).toBe(1);
    const allRows = dailyBarsPosts().flatMap(([, opts]) => opts.body);
    expect(allRows).toHaveLength(1);
    expect(allRows[0].trade_date).toBe(bars[9].date);
  });

  it("una diferencia de volumen por debajo de la tolerancia NO dispara reescritura", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10, { symbol: "AAPL" });
    const cachedBars = makeCachedBars(bars);
    // Ruido de 0.1 acciones (imposible en la realidad, pero sirve para
    // probar el margen 0.5 sin acercarse a un cambio real de una acción).
    cachedBars[0] = { ...cachedBars[0], volume: cachedBars[0].volume + 0.1 };

    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} }, { cachedBars });

    expect(result.status).toBe("unchanged");
    expect(dailyBarsPosts()).toHaveLength(0);
  });

  it("una diferencia de precio por debajo de la tolerancia relativa (ruido de coma flotante) NO dispara reescritura", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(10, { symbol: "AAPL" });
    const cachedBars = makeCachedBars(bars);
    // Precio ~102: 1e-6 relativo son ~0.0001 — muy por debajo de cualquier
    // variación de precio real, y consistente con el ruido de round-trip
    // que dos descargas independientes del mismo dato pueden introducir.
    cachedBars[0] = { ...cachedBars[0], close: cachedBars[0].close + 0.00002, rawClose: cachedBars[0].rawClose + 0.00002, adjClose: cachedBars[0].adjClose + 0.00002 };

    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} }, { cachedBars });

    expect(result.status).toBe("unchanged");
    expect(dailyBarsPosts()).toHaveLength(0);
  });

  it("la purga oportunista sigue disparándose por excedente aunque el delta esté vacío", async () => {
    supabaseRequest.mockResolvedValue([]);
    const bars = makeBars(2000); // 2000 > cap 400 → purga siempre elegible.
    const first400 = bars.slice(0, 400);
    const cachedBars = makeCachedBars(first400); // las 400 que se escribirían, sin cambios.

    const result = await writeDailyBarsCache("AAPL", { bars, meta: {} }, { cachedBars });

    expect(result.status).toBe("unchanged");
    expect(result.count).toBe(0);
    // Cero POST (nada que escribir)...
    expect(dailyBarsPosts()).toHaveLength(0);
    // ...pero la purga por excedente de cap SÍ se dispara — es una operación
    // de mantenimiento independiente del delta (ver comentario en el código).
    const deletes = dailyBarsDeletes();
    expect(deletes).toHaveLength(1);
    expect(result.purgedBefore).toBe(bars[399].date);
  });
});
