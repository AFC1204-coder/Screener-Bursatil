// Tests de lib/globalRs.js#readGlobalRsSeriesForSymbol.
//
// CONTEXTO: rs_weekly_items filtra solo por owner_id+symbol, sin
// engine_version — un símbolo puede tener filas de más de un motor de
// cálculo (ej. "statsedge-global-rs-usd-v1", la corrida europea de mayo
// de 2026 más su backfill de ~53 semanas, y "statsedge-us-equity-rs-v1",
// el ranking sobre el universo US escrito en agosto de 2026). Mezclar
// ambos en una sola serie temporal afirma una continuidad de metodología
// que no existe. La función filtra de solo lectura al engine_version de
// la fila más reciente (la consulta ya ordena por snapshot_date desc).
//
// Mockea supabaseRequest para no depender de una base real — mismo
// patrón que tests/dailyBarsWriteCap.test.js.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseServer", () => ({
  supabaseConfig: () => ({
    configured: true,
    ownerId: "personal",
    url: "https://example.supabase.co",
    key: "test-key",
    missing: [],
  }),
  supabaseRequest: vi.fn(),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  toDate: (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  },
}));

import { supabaseRequest } from "@/lib/supabaseServer";
import { RS_LINE_MIN_WEEKS } from "@/lib/chartSeriesModel";
import { readGlobalRsSeriesForSymbol } from "@/lib/globalRs";

describe("readGlobalRsSeriesForSymbol", () => {
  it("con filas de dos engine_version, devuelve solo las del más reciente", async () => {
    // Reproduce el caso real verificado en producción para MU: 54 filas del
    // motor europeo (mayo 2026) más 1 fila del motor US nuevo (agosto 2026).
    // La consulta real ordena por snapshot_date desc, así que el mock debe
    // devolver la fila más reciente primero.
    supabaseRequest.mockResolvedValueOnce([
      {
        symbol: "MU",
        snapshot_date: "2026-08-08",
        week_key: "2026-W32",
        base_currency: "USD",
        engine_version: "statsedge-us-equity-rs-v1",
        rank_index: 2,
        rs_rating: 99,
        rs_raw: 487.37,
        sample_size: 4217,
        metrics: {},
      },
      {
        symbol: "MU",
        snapshot_date: "2026-05-22",
        week_key: "2026-W21",
        base_currency: "USD",
        engine_version: "statsedge-global-rs-usd-v1",
        rank_index: 4,
        rs_rating: 98,
        rs_raw: 200,
        sample_size: 500,
        metrics: {},
      },
      {
        symbol: "MU",
        snapshot_date: "2026-05-15",
        week_key: "2026-W20",
        base_currency: "USD",
        engine_version: "statsedge-global-rs-usd-v1",
        rank_index: 3,
        rs_rating: 98,
        rs_raw: 195,
        sample_size: 500,
        metrics: {},
      },
    ]);

    const result = await readGlobalRsSeriesForSymbol("MU");

    expect(result.series).toHaveLength(1);
    expect(result.series.every((point) => point.engineVersion === "statsedge-us-equity-rs-v1")).toBe(true);
    expect(result.latest.engineVersion).toBe("statsedge-us-equity-rs-v1");
    expect(result.latest.rsRating).toBe(99);
    expect(result.latest.date).toBe("2026-08-08");
  });

  it("con un solo engine_version, devuelve la serie completa sin cambios", async () => {
    supabaseRequest.mockResolvedValueOnce([
      {
        symbol: "NOKIA.HE",
        snapshot_date: "2026-05-25",
        week_key: "2026-W22",
        base_currency: "USD",
        engine_version: "statsedge-global-rs-usd-v1",
        rank_index: 1,
        rs_rating: 99,
        rs_raw: 161.16,
        sample_size: 69,
        metrics: {},
      },
      {
        symbol: "NOKIA.HE",
        snapshot_date: "2026-05-15",
        week_key: "2026-W20",
        base_currency: "USD",
        engine_version: "statsedge-global-rs-usd-v1",
        rank_index: 2,
        rs_rating: 97,
        rs_raw: 150,
        sample_size: 300,
        metrics: {},
      },
    ]);

    const result = await readGlobalRsSeriesForSymbol("NOKIA.HE");

    expect(result.series).toHaveLength(2);
    expect(result.series.every((point) => point.engineVersion === "statsedge-global-rs-usd-v1")).toBe(true);
    expect(result.latest.rsRating).toBe(99);
  });

  it("sin filas, devuelve serie vacía sin lanzar", async () => {
    supabaseRequest.mockResolvedValueOnce([]);

    const result = await readGlobalRsSeriesForSymbol("SYMBOLQUENOEXISTE");

    expect(result.series).toEqual([]);
    expect(result.latest).toBeNull();
    expect(result.ratingLatest).toBeNull();
  });

  it("pin pobre con legacy suficiente: la serie usa el legacy, no el pin de 1 semana", async () => {
    const legacyRows = Array.from({ length: RS_LINE_MIN_WEEKS }, (_, index) => ({
      symbol: "AAPL",
      snapshot_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      week_key: `2026-W${String(20 + index).padStart(2, "0")}`,
      base_currency: "USD",
      engine_version: "statsedge-global-rs-usd-v1",
      rank_index: index + 1,
      rs_rating: 60 + index,
      rs_raw: 100 + index,
      sample_size: 500,
      metrics: {},
    }));
    supabaseRequest.mockResolvedValueOnce([
      {
        symbol: "AAPL",
        snapshot_date: "2026-08-29",
        week_key: "2026-W35",
        base_currency: "USD",
        engine_version: "statsedge-private-global-rs-usd-v1",
        rank_index: 120,
        rs_rating: 64,
        rs_raw: 50,
        sample_size: 6442,
        metrics: {},
      },
      ...legacyRows,
    ]);

    const result = await readGlobalRsSeriesForSymbol("AAPL");

    expect(result.series.length).toBeGreaterThanOrEqual(RS_LINE_MIN_WEEKS);
    expect(result.series.every((point) => point.engineVersion === "statsedge-global-rs-usd-v1")).toBe(true);
    expect(result.latest.engineVersion).toBe("statsedge-global-rs-usd-v1");
    expect(result.ratingLatest).toMatchObject({
      engineVersion: "statsedge-private-global-rs-usd-v1",
      rsRating: 64,
    });
    expect(result.latest.rsRating).not.toBe(result.ratingLatest.rsRating);
  });

  it("dedupe por weekKey: dos filas W32 conservan la de snapshot_date más reciente", async () => {
    supabaseRequest.mockResolvedValueOnce([
      {
        symbol: "AAPL",
        snapshot_date: "2026-08-29",
        week_key: "2026-W35",
        base_currency: "USD",
        engine_version: "statsedge-us-equity-rs-v1",
        rank_index: 120,
        rs_rating: 64,
        rs_raw: 50,
        sample_size: 4200,
        metrics: {},
      },
      {
        symbol: "AAPL",
        snapshot_date: "2026-08-08",
        week_key: "2026-W32",
        base_currency: "USD",
        engine_version: "statsedge-us-equity-rs-v1",
        rank_index: 80,
        rs_rating: 70,
        rs_raw: 55,
        sample_size: 4200,
        metrics: {},
      },
      {
        symbol: "AAPL",
        snapshot_date: "2026-08-01",
        week_key: "2026-W32",
        base_currency: "USD",
        engine_version: "statsedge-us-equity-rs-v1",
        rank_index: 90,
        rs_rating: 80,
        rs_raw: 60,
        sample_size: 4200,
        metrics: {},
      },
    ]);

    const result = await readGlobalRsSeriesForSymbol("AAPL");

    expect(result.series).toHaveLength(2);
    expect(result.series.map((p) => p.weekKey)).toEqual(["2026-W32", "2026-W35"]);
    expect(result.series[0].rsRating).toBe(70);
    expect(result.latest).toMatchObject({ weekKey: "2026-W35", rsRating: 64 });
  });
});
