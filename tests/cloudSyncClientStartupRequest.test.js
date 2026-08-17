// Tests de lib/cloudSyncClient.js#getLatestScanFromCloud.
//
// Contexto (docs/timeout-arranque-2026-08-13.md): el arranque pedía
// `/api/scans?includeRows=1&limit=10&rowsLimit=2000` — diez escaneos
// mezclados, hasta 20.202 filas candidatas en producción, y `limit=10`
// desactivaba sin querer la caché de 2 minutos de app/api/scans/route.js
// (cacheableLatest exige limit===1). Este test fija que el arranque pide
// UN escaneo y un rowsLimit proporcional a lo que se muestra (no miles de
// filas para una pantalla de 50).

import { afterEach, describe, expect, it, vi } from "vitest";
import { getLatestScanFromCloud } from "@/lib/cloudSyncClient";

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe("getLatestScanFromCloud · el arranque pide un escaneo, no diez", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide limit=1 (activa la caché) y un rowsLimit acotado, no 10/2000", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, configured: true, scans: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestScanFromCloud();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url), "https://statsedge.test");

    expect(parsed.pathname).toBe("/api/scans");
    expect(parsed.searchParams.get("limit")).toBe("1");
    expect(parsed.searchParams.get("includeRows")).toBe("1");
    // Y ese escaneo es el nocturno estadounidense, no "el más reciente": el
    // cron europeo corre después (tests/screenerStartupAnchor.test.js).
    expect(parsed.searchParams.get("anchor")).toBe("nightly-us");

    const rowsLimit = Number(parsed.searchParams.get("rowsLimit"));
    expect(Number.isFinite(rowsLimit)).toBe(true);
    // Proporcional a lo que se pinta (DEFAULT_RESULT_PAGE_SIZE=50,
    // lib/screenerConfig.js): varias páginas de margen, no las 2.000 filas
    // repartidas entre diez escaneos de antes, y muy por debajo de un
    // escaneo grande real (9.918 filas, ver el diagnóstico).
    expect(rowsLimit).toBeGreaterThanOrEqual(50);
    expect(rowsLimit).toBeLessThan(2000);
  });
});
