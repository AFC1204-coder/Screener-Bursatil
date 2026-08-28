// tests/rsEnginePin.test.js — el interruptor del RS visible.
//
// EL FALLO QUE ESTE TEST EXISTE PARA IMPEDIR
//
// Hasta MET-1b, lib/globalRs.js resolvía el engine como "el de la fila más
// reciente por símbolo" (latest-wins). Con un solo motor escribiendo eso era
// inofensivo. Con dos, la PRIMERA escritura del motor global habría cambiado el
// RS visible de todos los símbolos US sin un solo diff que revisar: el número de
// la tabla cambia porque alguien corrió un script, no porque nadie decidiera
// nada. El spec (pregunta 6) exige que ese cutover sea explícito.
//
// Por eso este test comprueba dos cosas distintas:
//   1. Que el pin apunte HOY donde el ticket dice (línea privada = motor global).
//   2. Que la LECTURA filtre por ese pin — no que simplemente exista una
//      constante. Un pin que nadie consulta no protege nada, y es el modo de
//      fallo más fácil de introducir al refactorizar.
//
// Si alguien cambia el motor canónico a propósito, este test falla y hay que
// tocarlo: esa fricción ES la característica.

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
import { readGlobalRsForSymbols, readGlobalRsSeriesForSymbol, exclusionReasonText } from "@/lib/globalRs";
import {
  canonicalRsDisclosure,
  canonicalRsEngineVersion,
  DEFAULT_RS_LINE,
  LEGACY_EU_RS_ENGINE_VERSION,
  PRIVATE_GLOBAL_RS_ENGINE_VERSION,
  RS_LINE_PRIVATE,
  US_EQUITY_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";
import { canonicalRs } from "@/lib/rsCanonical";
import { attachWeeklyRs } from "@/lib/globalRs";

describe("pin del engine canónico", () => {
  it("la línea privada (default) apunta al motor global de MET-1b", () => {
    expect(DEFAULT_RS_LINE).toBe(RS_LINE_PRIVATE);
    expect(canonicalRsEngineVersion()).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
    expect(PRIVATE_GLOBAL_RS_ENGINE_VERSION).toBe("statsedge-private-global-rs-usd-v1");
  });

  it("el motor US sigue existiendo, congelado y distinto — es el canónico de la línea pública futura", () => {
    expect(US_EQUITY_RS_ENGINE_VERSION).toBe("statsedge-us-equity-rs-v1");
    expect(US_EQUITY_RS_ENGINE_VERSION).not.toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
  });

  it("el motor europeo de mayo de 2026 NO es candidato a canónico", () => {
    expect(LEGACY_EU_RS_ENGINE_VERSION).toBe("statsedge-global-rs-usd-v1");
    expect(canonicalRsEngineVersion()).not.toBe(LEGACY_EU_RS_ENGINE_VERSION);
  });

  it("la declaración de universo nombra moneda y carácter curado, nunca «global» a secas", () => {
    const disclosure = canonicalRsDisclosure();
    expect(disclosure).toContain("USD");
    expect(disclosure).toContain("privado curado");
  });
});

describe("la LECTURA respeta el pin (no basta con que la constante exista)", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("readGlobalRsForSymbols filtra por engine_version en la consulta del pin activo", async () => {
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-08-29" }]) // pin tiene snapshot
      .mockResolvedValue([]);
    await readGlobalRsForSymbols(["AAPL", "0700.HK"]);
    const queries = supabaseRequest.mock.calls.map(([, options]) => options?.query || "");
    const symbolQueries = queries.filter((q) => q.includes("symbol=in."));
    expect(symbolQueries.length).toBeGreaterThan(0);
    for (const query of symbolQueries) {
      expect(query).toContain(`engine_version=eq.${encodeURIComponent(canonicalRsEngineVersion())}`);
    }
  });

  it("sin snapshot del pin privado, la tabla cae al motor US (pre-cutover)", async () => {
    supabaseRequest
      .mockResolvedValueOnce([]) // pin sin snapshot
      .mockResolvedValueOnce([{ snapshot_date: "2026-08-29" }]) // US sí
      .mockResolvedValueOnce([
        {
          symbol: "AAPL",
          snapshot_date: "2026-08-29",
          week_key: "2026-W35",
          engine_version: US_EQUITY_RS_ENGINE_VERSION,
          rank_index: 12,
          rs_rating: 88,
          rs_raw: 250,
          sample_size: 4868,
          metrics: {},
        },
      ]);
    const { bySymbol } = await readGlobalRsForSymbols(["AAPL"]);
    expect(bySymbol.get("AAPL")?.available).toBe(true);
    expect(bySymbol.get("AAPL")?.rsRating).toBe(88);
    expect(bySymbol.get("AAPL")?.engineVersion).toBe(US_EQUITY_RS_ENGINE_VERSION);
    const symbolQuery = supabaseRequest.mock.calls.find(([, o]) => (o?.query || "").includes("symbol=in."));
    expect(symbolQuery?.[1]?.query).toContain(`engine_version=eq.${encodeURIComponent(US_EQUITY_RS_ENGINE_VERSION)}`);
  });

  it("una fila de un motor NO pinneado no puede alimentar el RS visible", async () => {
    // Si el filtro por engine_version desapareciera de la consulta, PostgREST
    // devolvería también las filas del motor US y este mock las colaría. El
    // contrato es que la consulta ya no las pide.
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-08-29" }])
      .mockResolvedValue([]);
    const { bySymbol } = await readGlobalRsForSymbols(["MAR"]);
    expect(bySymbol.get("MAR")?.available).toBe(false);
  });

  it("la serie de la ficha prefiere el engine pinneado aunque exista una fila más nueva de otro motor", async () => {
    // Orden real de la consulta: snapshot_date desc. La fila más reciente es de
    // un motor NO canónico; con latest-wins la ficha habría enseñado esa serie.
    supabaseRequest.mockResolvedValueOnce([
      {
        symbol: "MU",
        snapshot_date: "2026-09-05",
        week_key: "2026-W36",
        base_currency: "USD",
        engine_version: US_EQUITY_RS_ENGINE_VERSION,
        rank_index: 2,
        rs_rating: 99,
        rs_raw: 487,
        sample_size: 4868,
        metrics: {},
      },
      {
        symbol: "MU",
        snapshot_date: "2026-08-29",
        week_key: "2026-W35",
        base_currency: "USD",
        engine_version: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
        rank_index: 40,
        rs_rating: 71,
        rs_raw: 300,
        sample_size: 5600,
        metrics: {},
      },
    ]);
    const result = await readGlobalRsSeriesForSymbol("MU");
    expect(result.series).toHaveLength(1);
    expect(result.series[0].engineVersion).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
    expect(result.latest.rsRating).toBe(71);
  });

  it("si el símbolo no tiene historia bajo el pin, la ficha enseña la que hay ETIQUETADA con su engine", async () => {
    // El spec pide no ocultarla: un símbolo que solo existe en el motor US
    // conserva su serie, marcada con su engineVersion, sin mezclarse.
    supabaseRequest.mockResolvedValueOnce([
      {
        symbol: "OLD",
        snapshot_date: "2026-08-08",
        week_key: "2026-W32",
        base_currency: "USD",
        engine_version: US_EQUITY_RS_ENGINE_VERSION,
        rank_index: 10,
        rs_rating: 80,
        rs_raw: 200,
        sample_size: 4868,
        metrics: {},
      },
    ]);
    const result = await readGlobalRsSeriesForSymbol("OLD");
    expect(result.series).toHaveLength(1);
    expect(result.series[0].engineVersion).toBe(US_EQUITY_RS_ENGINE_VERSION);
  });
});

describe("motivo de exclusión persistido llega hasta la superficie", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("una fila de exclusión (rs_rating null + metrics) NO se cuela como RS disponible", async () => {
    supabaseRequest
      .mockResolvedValueOnce([{ snapshot_date: "2026-08-29" }])
      .mockResolvedValue([
      {
        symbol: "0005.HK",
        snapshot_date: "2026-08-29",
        week_key: "2026-W35",
        engine_version: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
        rank_index: 0, // centinela de exclusión
        rs_rating: null,
        rs_raw: null,
        sample_size: 5600,
        metrics: { excluded: true, exclusionReason: "fx-stale", exclusionDetail: "FX más reciente (2026-07-20) a 30 sesiones" },
      },
    ]);
    const { bySymbol } = await readGlobalRsForSymbols(["0005.HK"]);
    const entry = bySymbol.get("0005.HK");
    expect(entry.available).toBe(false);
    expect(entry.exclusionReason).toBe("fx-stale");
    expect(entry.reason).toContain("tipo de cambio");
  });

  it("el motivo viaja de la hidratación a canonicalRs — la ausencia deja de ser muda", () => {
    const bySymbol = new Map([["0005.HK", {
      available: false,
      reason: exclusionReasonText("fx-stale"),
      exclusionReason: "fx-stale",
      exclusionDetail: "",
    }]]);
    const row = attachWeeklyRs({ symbol: "0005.HK" }, bySymbol);
    const rs = canonicalRs(row);
    expect(rs.available).toBe(false);
    expect(rs.value).toBe(null);
    expect(rs.reason).toBe(exclusionReasonText("fx-stale"));
    // Y no es el texto genérico de "no está en el ranking".
    expect(rs.reason).toContain("tipo de cambio");
  });

  it("cada código de exclusión del motor tiene texto de usuario, sin jerga de laboratorio", () => {
    const codes = ["insufficient-bars", "discontinuous", "fx-currency-unknown", "fx-unavailable", "fx-stale", "fx-discontinuous"];
    for (const code of codes) {
      const text = exclusionReasonText(code);
      expect(text, `sin texto para ${code}`).toBeTruthy();
      // El código interno nunca se enseña tal cual al usuario.
      expect(text).not.toContain(code);
      expect(text.toLowerCase()).not.toContain("engine_version");
    }
  });

  it("un código desconocido no rompe: devuelve vacío y el lector cae al texto genérico", () => {
    expect(exclusionReasonText("motivo-que-no-existe")).toBe("");
    expect(exclusionReasonText("")).toBe("");
  });
});

describe("aislamiento del scoring (addendum §4, conservado sin relajación)", () => {
  it("attachWeeklyRs no toca rsGlobalPct ni ningún score", () => {
    const original = {
      symbol: "MAR",
      rsGlobalPct: 88,
      objectiveScore: 71,
      compositeScore: 64,
      totalScore: 68,
    };
    const bySymbol = new Map([["MAR", {
      available: true,
      rsRating: 66,
      rsRaw: 120,
      rank: 400,
      sampleSize: 5600,
      asOf: "2026-08-29",
      weekKey: "2026-W35",
      engineVersion: PRIVATE_GLOBAL_RS_ENGINE_VERSION,
    }]]);
    const row = attachWeeklyRs(original, bySymbol);
    expect(row.rsGlobalPct).toBe(88);
    expect(row.objectiveScore).toBe(71);
    expect(row.compositeScore).toBe(64);
    expect(row.totalScore).toBe(68);
    // El RS que se ENSEÑA es el del ranking, no el percentil del lote.
    expect(canonicalRs(row).value).toBe(66);
  });

  it("una exclusión tampoco convierte el percentil del lote en el RS visible", () => {
    const row = attachWeeklyRs(
      { symbol: "0005.HK", rsGlobalPct: 88, objectiveScore: 50 },
      new Map([["0005.HK", { available: false, reason: exclusionReasonText("fx-unavailable"), exclusionReason: "fx-unavailable" }]]),
    );
    expect(row.rsGlobalPct).toBe(88); // intacto para el scoring
    expect(canonicalRs(row).value).toBe(null); // pero NO se enseña como RS
    expect(canonicalRs(row).available).toBe(false);
  });
});
