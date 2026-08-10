// Tests de GET /api/scan — el sondeo que el navegador hace cada 2 segundos
// (SERVER_SCAN_POLL_MS, lib/screenerConfig.js) mientras dura el escaneo.
//
// Contexto (docs/timeout-tres-minutos-2026-08-10.md): esta ruta pedía
// `select=...,settings,...` y de toda esa columna solo usaba
// `scan.settings.progress`. Con el universo completo, `settings` lleva dentro
// settings.scanSymbols — los 10.000 símbolos, ~84 KB medidos — así que cada
// sondeo arrastraba ese peso: ~110 lecturas por corrida, concurrentes con el
// bucle del runner sobre la misma fila de `scans`.
//
// Aquí se fija que la ruta pide solo settings->progress y que la respuesta
// pública no cambia de forma.

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.fn();

vi.mock("@/lib/supabaseServer", () => ({
  supabaseRequest,
  supabaseConfig: () => ({ url: "https://example.supabase.co", key: "k", ownerId: "personal", configured: true, missing: [] }),
  requirePersistenceAuth: () => null,
  disabledPayload: () => ({ configured: false, skipped: true, missing: [], message: "Supabase no configurado" }),
  textOrNull: (value) => {
    const text = String(value || "").trim();
    return text || null;
  },
}));

vi.mock("@/lib/serverScanRunner", () => ({
  runScanChunk: vi.fn(async () => ({ ok: true })),
  clampChunkSize: (value) => Number(value) || 300,
  normalizeSymbols: (value) => (Array.isArray(value) ? value : []),
}));

vi.mock("@/lib/scansApiCache", () => ({ clearScansApiCache: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { GET } = await import("@/app/api/scan/route");

const SCAN_ID = "11111111-2222-3333-4444-555555555555";

const PROGRESS = {
  status: "running",
  cursor: 2400,
  completed: 2652,
  total: 10000,
  saved: 2482,
  currentSymbol: "BFH",
  errors: [],
  errorsTotal: 19,
};

// Shape que devuelve PostgREST con `progress:settings->progress`: la clave es
// el alias, y `settings` NO viaja.
function scanRow(progress = PROGRESS) {
  return {
    id: SCAN_ID,
    local_id: "server-scan-1",
    name: "Scan servidor",
    preset: "momentum",
    progress,
    row_count: 2482,
    created_at: "2026-08-10T18:25:36.092Z",
    updated_at: "2026-08-10T18:29:15.594Z",
  };
}

function configureScanRow(row) {
  supabaseRequest.mockImplementation(async (path) => {
    if (path === "scans") return [row];
    return [];
  });
}

function scanReadQuery() {
  const call = supabaseRequest.mock.calls.find(([path, options]) => path === "scans" && (!options?.method || options.method === "GET"));
  return String(call?.[1]?.query || "");
}

function getRequest(extra = "") {
  return new Request(`https://statsedge.test/api/scan?id=${SCAN_ID}${extra}`);
}

describe("GET /api/scan · el sondeo no arrastra el universo entero", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
  });

  it("REGRESIÓN: no pide la columna `settings`, solo la ruta settings->progress", async () => {
    configureScanRow(scanRow());

    const res = await GET(getRequest("&includeRows=0"));
    expect(res.status).toBe(200);

    const query = scanReadQuery();
    expect(query).toContain("progress:settings->progress");
    expect(query).not.toMatch(/select=[^&]*,settings,/);
    expect(query).not.toMatch(/select=[^&]*,settings(&|$)/);
  });

  it("sigue pidiendo los campos que la respuesta publica", async () => {
    configureScanRow(scanRow());
    await GET(getRequest("&includeRows=0"));

    const query = scanReadQuery();
    for (const field of ["id", "local_id", "name", "preset", "row_count", "created_at", "updated_at"]) {
      expect(query).toContain(field);
    }
  });

  it("la forma de la respuesta no cambia: progress, status, degraded y publishable", async () => {
    configureScanRow(scanRow());

    const res = await GET(getRequest("&includeRows=0"));
    const payload = await res.json();

    expect(payload.ok).toBe(true);
    expect(payload.progress).toEqual(PROGRESS);
    expect(payload.status).toBe("running");
    expect(payload.degraded).toBe(false);
    expect(payload.publishable).toBe(false);
    expect(payload.scan).toEqual(expect.objectContaining({
      id: SCAN_ID,
      localId: "server-scan-1",
      rowCount: 2482,
    }));
  });

  it("un scan terminado en 'partial' sigue saliendo como degradado y publicable", async () => {
    configureScanRow(scanRow({ ...PROGRESS, status: "partial" }));

    const payload = await (await GET(getRequest("&includeRows=0"))).json();
    expect(payload.status).toBe("partial");
    expect(payload.degraded).toBe(true);
    expect(payload.publishable).toBe(true);
  });

  it("si la fila no trae progress, el estado cae a 'unknown' en vez de romper", async () => {
    configureScanRow(scanRow(null));

    const payload = await (await GET(getRequest("&includeRows=0"))).json();
    expect(payload.status).toBe("unknown");
    expect(payload.progress).toEqual({ status: "unknown" });
  });
});
