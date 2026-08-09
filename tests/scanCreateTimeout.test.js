// Tests de los dos fallos de docs/upstream-timeout-2026-08-09.md:
//
//  1. POST /api/scan creaba la fila del scan con `supabaseRequest` SIN pasar
//     timeoutMs. Sin ese valor, lib/supabaseServer.js deja el AbortSignal en
//     undefined y el fetch espera indefinidamente: el incidente observado se
//     quedó ~3 minutos colgado antes de fallar. Aquí se fija por contrato que
//     ese INSERT lleva un tope de tiempo finito y razonable.
//  2. El cartel previo al lanzamiento decía "Escaneando todo el universo:
//     10234/10234 acciones" ANTES de enviar el POST. No era un contador (eran
//     `symbols.length` y `base.length`, iguales por definición en modo "todo el
//     universo"), pero se leía como "ya analizado del todo". Aquí se fija que
//     el mensaje de preparación NO contiene un recuento de análisis.
//
// El polling y el contador real (publishPartial en app/page.jsx) no se tocan.

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRequest = vi.fn();
const runScanChunk = vi.fn(async () => ({ ok: true }));
const after = vi.fn();

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
  runScanChunk,
  clampChunkSize: (value) => Number(value) || 300,
  normalizeSymbols: (value) => (Array.isArray(value) ? value.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean) : []),
}));

vi.mock("@/lib/scansApiCache", () => ({ clearScansApiCache: vi.fn() }));

vi.mock("next/server", () => ({ after }));

const { POST } = await import("@/app/api/scan/route");

function scanRequest(symbols) {
  return new Request("https://statsedge.test/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols, name: "Scan de prueba", preset: "momentum", settings: {} }),
  });
}

function insertCall() {
  return supabaseRequest.mock.calls.find(([path, options]) => path === "scans" && options?.method === "POST");
}

describe("POST /api/scan · el INSERT que crea el scan lleva tope de tiempo", () => {
  beforeEach(() => {
    supabaseRequest.mockReset();
    supabaseRequest.mockResolvedValue([{ id: "scan-1", local_id: "server-scan-1" }]);
    runScanChunk.mockClear();
    after.mockClear();
  });

  it("REGRESIÓN: pasa timeoutMs a supabaseRequest — sin él el AbortSignal queda undefined y el fetch puede colgarse sin límite", async () => {
    const symbols = Array.from({ length: 500 }, (_, i) => `SYM${i}`);
    const res = await POST(scanRequest(symbols));
    expect(res.status).toBe(202);

    const call = insertCall();
    expect(call, "el POST debe insertar en `scans`").toBeTruthy();
    const [, options] = call;
    expect(options.timeoutMs).toBeTypeOf("number");
    expect(Number.isFinite(options.timeoutMs)).toBe(true);
    expect(options.timeoutMs).toBeGreaterThan(0);
  });

  it("el tope está en segundos, no en minutos: por debajo del maxDuration (300 s) de la ruta", async () => {
    await POST(scanRequest(["AAPL", "MSFT"]));
    const [, options] = insertCall();
    // Suficiente para una escritura grande (~181 KiB con el universo completo),
    // pero muy lejos de dejar al usuario esperando los ~3 minutos del incidente.
    expect(options.timeoutMs).toBeGreaterThanOrEqual(5000);
    expect(options.timeoutMs).toBeLessThanOrEqual(30000);
  });

  it("el tope se mantiene también con el universo completo — es justo el caso que falló", async () => {
    const symbols = Array.from({ length: 10234 }, (_, i) => `SYM${i}`);
    await POST(scanRequest(symbols));
    const [, options] = insertCall();
    expect(options.timeoutMs).toBeGreaterThan(0);
    expect(options.body[0].settings.scanSymbols).toHaveLength(10234);
  });

  it("si el INSERT se aborta por el tope, el POST responde 500 con el error crudo (que el cliente traduce)", async () => {
    supabaseRequest.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    const res = await POST(scanRequest(["AAPL"]));
    expect(res.status).toBe(500);
    const payload = await res.json();
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/aborted/i);
  });
});
