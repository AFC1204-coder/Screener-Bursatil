// Tests de GET /api/scans — la ruta que arranque consulta al restaurar el
// último escaneo (docs/timeout-arranque-2026-08-13.md).
//
// cacheableLatest (app/api/scans/route.js) solo se activa con
// includeRows=1, includeDeleted=0, limit===1 y rowsLimit<=5000. Antes del
// cambio, el cliente pedía limit=10 y la caché nunca se usaba: cada
// arranque en frío repetía la consulta cara contra Supabase. Aquí se fija
// que limit=1 sí sirve de caché entre llamadas seguidas y que limit=10
// sigue golpeando Supabase en cada una (mismo comportamiento que documentó
// el inventario, para no romperlo sin darnos cuenta al tocar otra cosa).
//
// Mismo patrón de mocking que tests/scanApiProgressSelect.test.js: se
// mockea @/lib/supabaseServer completo y se reimplementan a mano los
// helpers puros que la ruta usa (finiteOrNull/textOrNull/toTimestamp), para
// no depender de una base real.

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.fn();

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest,
  supabaseRpc: vi.fn(async () => []),
  supabaseConfig: () => ({ url: "https://example.supabase.co", key: "k", ownerId: "personal", configured: true, missing: [] }),
  requirePersistenceAuth: () => null,
  disabledPayload: () => ({ configured: false, skipped: true, missing: [], message: "Supabase no configurado" }),
  finiteOrNull: (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
  textOrNull: (value) => {
    const text = String(value || "").trim();
    return text || null;
  },
  toTimestamp: (value) => {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  },
}));

const { GET } = await import("@/app/api/scans/route");
const { clearScansApiCache } = await import("@/lib/scansApiCache");

const SCAN_ID = "11111111-2222-3333-4444-555555555555";

function scanRow(rowCount) {
  return {
    id: SCAN_ID,
    local_id: "server-scan-1",
    name: "Scan grande",
    preset: "balanced",
    settings: {},
    market_score: null,
    market_regime: null,
    row_count: rowCount,
    created_at: "2026-08-12T23:29:35.023Z",
    updated_at: "2026-08-12T23:29:35.023Z",
    deleted_at: null,
  };
}

// Sin filas de resultado: readGlobalRsForSymbols/readMarketCapForSymbols
// devuelven de inmediato sin llamar a supabaseRequest cuando la lista de
// símbolos está vacía (lib/globalRs.js, lib/fundamentalsCache.js), así que
// el conteo de llamadas queda limpio: exactamente "scans" + "scan_results"
// por invocación real a Supabase.
function configureBackend(rowCount) {
  supabaseRequest.mockImplementation(async (path) => {
    if (path === "scans") return [scanRow(rowCount)];
    if (path === "scan_results") return [];
    return [];
  });
}

function getRequest(query) {
  return new Request(`https://statsedge.test/api/scans?${query}`);
}

describe("GET /api/scans · la caché de 2 minutos solo se activa con limit=1", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
    clearScansApiCache();
  });

  it("limit=1: la segunda llamada seguida sirve de caché, no vuelve a tocar Supabase", async () => {
    configureBackend(500);

    const first = await GET(getRequest("includeRows=1&limit=1&rowsLimit=500"));
    expect(first.status).toBe(200);
    const callsAfterFirst = supabaseRequest.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await GET(getRequest("includeRows=1&limit=1&rowsLimit=500"));
    expect(second.status).toBe(200);
    expect(supabaseRequest.mock.calls.length).toBe(callsAfterFirst);

    const payload = await second.json();
    expect(payload.scans[0].id).toBe("server-scan-1");
  });

  it("limit=10: cada llamada vuelve a golpear Supabase (sin caché)", async () => {
    configureBackend(500);

    await GET(getRequest("includeRows=1&limit=10&rowsLimit=500"));
    const callsAfterFirst = supabaseRequest.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await GET(getRequest("includeRows=1&limit=10&rowsLimit=500"));
    expect(supabaseRequest.mock.calls.length).toBe(callsAfterFirst * 2);
  });
});
