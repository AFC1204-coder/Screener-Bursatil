// Tests de lib/cloudSyncClient.js#getLatestScanFromCloud.
//
// Contexto (docs/timeout-arranque-2026-08-13.md): el arranque pedía
// `/api/scans?includeRows=1&limit=10&rowsLimit=2000` — diez escaneos
// mezclados, hasta 20.202 filas candidatas en producción, y `limit=10`
// desactivaba sin querer la caché de 2 minutos de app/api/scans/route.js
// (cacheableLatest exige limit===1). Este test fija que el arranque pide
// UN escaneo, el nocturno estadounidense.
//
// Y fija la segunda mitad del contrato, que cambió el 2026-08-17: ese escaneo
// se pide ENTERO. Con rowsLimit=500 sobre 3.312 filas el usuario filtraba
// sobre la mejor sexta parte del universo —el recorte iba por rank_index, que
// ordena por puntuación— y ningún filtro de valores débiles podía devolver
// nada. El tope tiene que cubrir el universo estadounidense completo
// (5.609 símbolos analizados el 17 de agosto de 2026) sin pasarse del techo
// que mantiene viva la caché de la ruta (CACHEABLE_ROWS_LIMIT = 8.000).

import { afterEach, describe, expect, it, vi } from "vitest";
import { getLatestScanFromCloud, STARTUP_ROWS_LIMIT } from "@/lib/cloudSyncClient";

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe("getLatestScanFromCloud · el arranque pide un escaneo, no diez", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide limit=1 (activa la caché) y el universo entero, no 10/2000", async () => {
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
    expect(rowsLimit).toBe(STARTUP_ROWS_LIMIT);
    // Cubre el universo estadounidense completo con margen: el nocturno del
    // 17 de agosto de 2026 analizó 5.609 símbolos y guardó 3.312 filas.
    expect(rowsLimit).toBeGreaterThanOrEqual(5609);
    // Y no se pasa del techo de la caché de 2 minutos de /api/scans
    // (CACHEABLE_ROWS_LIMIT): por encima, cada arranque en frío repetiría la
    // consulta más cara de la app contra Supabase.
    expect(rowsLimit).toBeLessThanOrEqual(8000);
  });
});
