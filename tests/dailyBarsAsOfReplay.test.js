// Tests de contrato del recorte por asOf en lib/dailyBarsCache.js (paso 0 del
// ADR de replay histórico).
//
// CONTRATO QUE SE VALIDA:
//   1. Dado un asOf válido, NINGUNA barra devuelta tiene date > asOf — en los
//      tres caminos: cache-hit, live y stale-fallback.
//   2. meta.asOf hace eco del valor efectivamente aplicado (el cliente puede
//      auditar que el servidor honró el replay). "" cuando no hubo asOf.
//   3. El camino live escribe a caché la serie COMPLETA (sin recortar) — el
//      recorte por asOf es solo para lo que se devuelve al caller.
//
// El bug que esto arregla: barsThroughAsOf se usaba SOLO para contar (asOfRows)
// y el gating enough/fresh, pero el payload real devolvía cache.bars completas
// — entregando velas futuras a quien confiaba en ?asOf=.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock de supabaseServer: supabaseConfig configurado para que el camino cache
// funcione, y supabaseRequest como espía para inyectar barras cacheadas.
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

import { withDailyBarsCache, writeDailyBarsCache } from "@/lib/dailyBarsCache";
import { supabaseRequest } from "@/lib/supabaseServer";

// Barras DESC (más reciente primero). Por defecto del 2025-06-01 al 2025-06-10
// —足够 para los caminos live/stale/write (que no dependen de freshness). Para el
// camino cache-hit usamos makeFreshBars() con fechas de hoy, porque
// readDailyBarsCache solo marca "hit" cuando freshnessDays <= maxAgeDays.
function makeBars() {
  const bars = [];
  const base = Date.UTC(2025, 5, 1);
  for (let i = 0; i < 10; i += 1) {
    const date = new Date(base + i * 86400000);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open: 100, high: 105, low: 95, close: 100 + i,
      volume: 1_000_000, currency: "USD", provider: "Yahoo Finance",
    });
  }
  return bars.reverse(); // DESC
}

// Barras frescas (fecha de hoy) para forzar cache-hit. Desc, 10 barras, la
// más reciente es HOY. El asOf de corte es 5 días atrás.
function makeFreshBars() {
  const bars = [];
  const today = new Date();
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = 9; i >= 0; i -= 1) {
    const date = new Date(base - i * 86400000);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open: 100, high: 105, low: 95, close: 100 + (9 - i),
      volume: 1_000_000, currency: "USD", provider: "Yahoo Finance",
    });
  }
  return bars; // ya DESC (i descendente)
}

// asOf de corte para makeFreshBars: 5 días antes de hoy (formato YYYY-MM-DD).
function freshAsOf() {
  const today = new Date();
  const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 5 * 86400000);
  return cutoff.toISOString().slice(0, 10);
}

// Helper: cuenta cuántas barras tienen date > asOf (debe ser 0 si el recorte
// honra el contrato).
function futureBarsCount(bars = [], asOf = "") {
  return bars.filter((b) => b.date > asOf).length;
}

beforeEach(() => {
  supabaseRequest.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Camino 1: cache-hit — el asOf recorta las barras cacheadas devueltas
// ===========================================================================

describe("withDailyBarsCache · cache-hit recorta payload por asOf", () => {
  it("ninguna barra devuelta tiene date > asOf; meta.asOf refleja el valor aplicado", async () => {
    // Cache-hit real: barras frescas (fecha de hoy) + maxAgeDays holgado.
    // El asOf corta 5 días atrás → el payload debe excluir las barras de los
    // últimos 5 días aunque estén en caché.
    const allBars = makeFreshBars();
    const asOf = freshAsOf();
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "daily_bars") {
        return allBars.map((b) => ({
          trade_date: b.date, open: b.open, high: b.high, low: b.low,
          close: b.close, adj_close: b.close, volume: b.volume,
          currency: b.currency, provider: b.provider, updated_at: new Date().toISOString(),
        }));
      }
      return [];
    });

    const result = await withDailyBarsCache("AAPL", { range: "2A", asOf, maxAgeDays: 30, minBars: 1 }, async () => ({ bars: [] }));

    // Contrato 1: cero velas futuras respecto al asOf.
    expect(futureBarsCount(result.bars, asOf)).toBe(0);
    expect(result.bars.length).toBeGreaterThan(0);
    // La barra más reciente devuelta es exactamente la del asOf (o anterior).
    expect(result.bars[0].date <= asOf).toBe(true);
    // Contrato 2: meta.asOf hace eco del valor aplicado.
    expect(result.meta.asOf).toBe(asOf);
    // Y regularMarketPrice no se ancla en una barra futura.
    expect(result.meta.regularMarketPrice).toBe(result.bars[0].close);
  });

  it("sin asOf no recorta y meta.asOf es vacío (consulta normal)", async () => {
    const allBars = makeFreshBars();
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "daily_bars") {
        return allBars.map((b) => ({ trade_date: b.date, close: b.close, adj_close: b.close, provider: b.provider, updated_at: new Date().toISOString() }));
      }
      return [];
    });
    const result = await withDailyBarsCache("AAPL", { range: "2A", maxAgeDays: 30, minBars: 1 }, async () => ({ bars: [] }));
    expect(result.bars.length).toBe(allBars.length);
    expect(result.meta.asOf).toBe("");
  });
});

// ===========================================================================
// Camino 2: live — recorta el retorno pero escribe a caché la serie COMPLETA
// ===========================================================================

describe("withDailyBarsCache · live recorta el retorno, no la escritura a caché", () => {
  it("ninguna barra devuelta tiene date > asOf; meta.asOf refleja el valor", async () => {
    const allBars = makeBars();
    // Fetcher live: devuelve la serie completa. No hay cache-hit (mock vacío).
    const fetcher = async () => ({ bars: allBars, meta: { dataProvider: "Yahoo Finance" } });
    // useCache:false para evitar la escritura y aislar el camino live puro.
    const result = await withDailyBarsCache("AAPL", { range: "2A", asOf: "2025-06-05", useCache: false }, fetcher);

    expect(futureBarsCount(result.bars, "2025-06-05")).toBe(0);
    expect(result.bars[0].date <= "2025-06-05").toBe(true);
    expect(result.meta.asOf).toBe("2025-06-05");
  });

  it("escribe a caché la serie COMPLETA (sin recortar por asOf)", async () => {
    const allBars = makeBars();
    const fetcher = async () => ({ bars: allBars, meta: { dataProvider: "Yahoo Finance" } });
    // isSymbolReferenced devuelve [] (no referenciado) y el POST captura el body.
    supabaseRequest.mockResolvedValue([]);
    await withDailyBarsCache("AAPL", { range: "2A", asOf: "2025-06-05" }, fetcher);

    // Contrato 3: el body del POST a daily_bars contiene TODAS las barras,
    // incluidas las futuras respecto al asOf. El recorte no empobrece la caché.
    const posts = supabaseRequest.mock.calls.filter(([p, o]) => p === "daily_bars" && o.method === "POST");
    const writtenRows = posts.flatMap(([, o]) => o.body);
    expect(writtenRows.length).toBe(allBars.length);
    // Las barras futuras (date > asOf) SÍ están en lo escrito a caché.
    const futureInCache = writtenRows.filter((r) => r.trade_date > "2025-06-05");
    expect(futureInCache.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Camino 3: stale-fallback — el asOf recorta las barras stale devueltas
// ===========================================================================

describe("withDailyBarsCache · stale-fallback recorta payload por asOf", () => {
  it("ninguna barra devuelta tiene date > asOf; meta.asOf refleja el valor", async () => {
    const allBars = makeBars();
    // Cache stale (hay barras pero no hit fresco) + fetcher live que falla.
    supabaseRequest.mockImplementation(async (path) => {
      if (path === "daily_bars") {
        return allBars.map((b) => ({ trade_date: b.date, close: b.close, adj_close: b.close, provider: b.provider }));
      }
      return [];
    });
    // maxAgeDays:0 fuerza stale (las barras son de 2025, siempre viejas).
    const fetcher = async () => { throw new Error("live provider failed"); };
    const result = await withDailyBarsCache("AAPL", { range: "2A", asOf: "2025-06-05", maxAgeDays: 0 }, fetcher);

    // El stale-fallback entrega barras (no lanza), y recortadas por asOf.
    expect(result.bars.length).toBeGreaterThan(0);
    expect(futureBarsCount(result.bars, "2025-06-05")).toBe(0);
    expect(result.meta.asOf).toBe("2025-06-05");
  });
});

// ===========================================================================
// writeDailyBarsCache ignora asOf — nunca recorta lo que persiste
// ===========================================================================

describe("writeDailyBarsCache · asOf no afecta la profundidad escrita", () => {
  it("escribe todas las barras independientemente del asOf en options", async () => {
    supabaseRequest.mockResolvedValue([]);
    const allBars = makeBars();
    const result = await writeDailyBarsCache("AAPL", { bars: allBars, meta: {} }, { asOf: "2025-06-05" });
    expect(result.written).toBe(true);
    expect(result.count).toBe(allBars.length);
    const posts = supabaseRequest.mock.calls.filter(([p, o]) => p === "daily_bars" && o.method === "POST");
    expect(posts.flatMap(([, o]) => o.body)).toHaveLength(allBars.length);
  });
});
