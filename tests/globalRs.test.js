// Tests de lib/globalRs.js#readGlobalRsSeriesForSymbol.
//
// CONTEXTO: rs_weekly_items admite, para un mismo símbolo, filas de
// más de un engine_version — un símbolo puede tener filas de más de un motor de
// cálculo (ej. "statsedge-global-rs-usd-v1", la corrida europea de mayo
// de 2026 más su backfill de ~53 semanas, y "statsedge-us-equity-rs-v1",
// el ranking sobre el universo US escrito en agosto de 2026). Mezclar
// ambos en una sola serie temporal afirma una continuidad de metodología
// que no existe. Desde 2026-11 la función lee SOLO el motor que resuelve la
// tabla (el pin; el US si el pin no tiene ningún snapshot), sin respaldo.
//
// Mockea supabaseRequest para no depender de una base real — mismo
// patrón que tests/dailyBarsWriteCap.test.js.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  LEGACY_EU_RS_ENGINE_VERSION,
  PRIVATE_GLOBAL_RS_ENGINE_VERSION,
  US_EQUITY_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";

// Orden real de llamadas: 1) cabecera del pin (¿tiene snapshot?), [2) cabecera
// del motor US si el pin no tiene], 3) filas del símbolo YA filtradas por motor.
// El mock de filas devuelve a propósito filas de otros motores, como si el
// filtro de la consulta no existiera: la función tampoco debe colarlas.
function weeklyRow(engineVersion, snapshotDate, weekKey, rsRating, extra = {}) {
  return {
    symbol: "AAPL",
    snapshot_date: snapshotDate,
    week_key: weekKey,
    base_currency: "USD",
    engine_version: engineVersion,
    rank_index: 10,
    rs_rating: rsRating,
    rs_raw: 100,
    sample_size: 5600,
    metrics: {},
    ...extra,
  };
}

describe("readGlobalRsSeriesForSymbol · un solo motor, el de la tabla", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("la consulta de filas filtra por el engine del pin", async () => {
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-09-27" }])
      .mockResolvedValueOnce([]);
    await readGlobalRsSeriesForSymbol("AAPL");
    const rowsQuery = supabaseRequest.mock.calls.find(([, o]) => (o?.query || "").includes("symbol=eq.AAPL"));
    expect(rowsQuery?.[1]?.query).toContain(`engine_version=eq.${encodeURIComponent(PRIVATE_GLOBAL_RS_ENGINE_VERSION)}`);
  });

  it("con filas de varios motores, solo devuelve las del pin", async () => {
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-09-27" }])
      .mockResolvedValueOnce([
        weeklyRow(US_EQUITY_RS_ENGINE_VERSION, "2026-10-03", "2026-W40", 99),
        weeklyRow(PRIVATE_GLOBAL_RS_ENGINE_VERSION, "2026-09-27", "2026-W39", 82),
        weeklyRow(LEGACY_EU_RS_ENGINE_VERSION, "2026-05-22", "2026-W21", 72),
      ]);

    const result = await readGlobalRsSeriesForSymbol("AAPL");

    expect(result.engineVersion).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
    expect(result.series).toHaveLength(1);
    expect(result.series[0].engineVersion).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
    expect(result.latest.rsRating).toBe(82);
    expect(result.ratingLatest).toBe(result.latest);
  });

  it("un símbolo que solo existe en el motor europeo congelado NO recibe esa serie", async () => {
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-09-27" }])
      .mockResolvedValueOnce([
        weeklyRow(LEGACY_EU_RS_ENGINE_VERSION, "2026-05-25", "2026-W22", 99),
        weeklyRow(LEGACY_EU_RS_ENGINE_VERSION, "2026-05-15", "2026-W20", 97),
      ]);

    const result = await readGlobalRsSeriesForSymbol("NOKIA.HE");

    expect(result.series).toEqual([]);
    expect(result.latest).toBeNull();
    expect(result.ratingLatest).toBeNull();
  });

  it("sin filas, devuelve serie vacía sin lanzar", async () => {
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-09-27" }])
      .mockResolvedValueOnce([]);

    const result = await readGlobalRsSeriesForSymbol("SYMBOLQUENOEXISTE");

    expect(result.series).toEqual([]);
    expect(result.latest).toBeNull();
    expect(result.ratingLatest).toBeNull();
  });

  it("pin pobre con legacy suficiente: la serie se queda en el pin (corta), sin respaldo europeo", async () => {
    const legacyRows = Array.from({ length: RS_LINE_MIN_WEEKS + 10 }, (_, index) => weeklyRow(
      LEGACY_EU_RS_ENGINE_VERSION,
      `2026-0${1 + Math.floor(index / 4)}-${String(1 + (index % 4) * 7).padStart(2, "0")}`,
      `2026-W${String(2 + index).padStart(2, "0")}`,
      60 + index,
    ));
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-08-29" }])
      .mockResolvedValueOnce([
        weeklyRow(PRIVATE_GLOBAL_RS_ENGINE_VERSION, "2026-08-29", "2026-W35", 64),
        ...legacyRows,
      ]);

    const result = await readGlobalRsSeriesForSymbol("AAPL");

    expect(result.series).toHaveLength(1);
    expect(result.series[0]).toMatchObject({ engineVersion: PRIVATE_GLOBAL_RS_ENGINE_VERSION, rsRating: 64 });
    expect(result.latest).toMatchObject({ engineVersion: PRIVATE_GLOBAL_RS_ENGINE_VERSION, rsRating: 64 });
    expect(result.ratingLatest).toBe(result.latest);
  });

  it("pre-cutover (el pin sin ningún snapshot): usa el motor US, igual que la tabla, y deduplica por weekKey", async () => {
    supabaseRequest
      .mockResolvedValueOnce([]) // pin sin snapshot
      .mockResolvedValueOnce([{ snapshot_date: "2026-08-29" }]) // US sí
      .mockResolvedValueOnce([
        weeklyRow(US_EQUITY_RS_ENGINE_VERSION, "2026-08-29", "2026-W35", 64),
        weeklyRow(US_EQUITY_RS_ENGINE_VERSION, "2026-08-08", "2026-W32", 70),
        weeklyRow(US_EQUITY_RS_ENGINE_VERSION, "2026-08-01", "2026-W32", 80),
      ]);

    const result = await readGlobalRsSeriesForSymbol("AAPL");

    expect(result.engineVersion).toBe(US_EQUITY_RS_ENGINE_VERSION);
    expect(result.series).toHaveLength(2);
    expect(result.series.map((p) => p.weekKey)).toEqual(["2026-W32", "2026-W35"]);
    expect(result.series[0].rsRating).toBe(70);
    expect(result.latest).toMatchObject({ weekKey: "2026-W35", rsRating: 64 });
  });
});
