// Tests de lib/cloudSyncClient.js#getLatestScanFromCloud.
//
// Contexto (docs/timeout-arranque-2026-08-13.md): el arranque pedía
// `/api/scans?includeRows=1&limit=10&rowsLimit=2000` — diez escaneos
// mezclados, hasta 20.202 filas candidatas en producción, y `limit=10`
// desactivaba sin querer la caché de 15 minutos de app/api/scans/route.js
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

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLatestScanFromCloud, getLatestScanFromCloudForMarkets, pullCloudState, STARTUP_ROWS_LIMIT } from "@/lib/cloudSyncClient";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOUD_SYNC_SOURCE = readFileSync(resolve(ROOT, "lib/cloudSyncClient.js"), "utf8");

const MESA_GET_SCAN_FUNCTIONS = [
  "getLatestScanFromCloud",
  "getLatestScanFromCloudForMarkets",
  "pullCloudState",
];

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
    // PERF-NAC: API compact default es core; arranque de producto pide país/tema.
    expect(parsed.searchParams.get("hydrateRs")).toBe("1");

    const rowsLimit = Number(parsed.searchParams.get("rowsLimit"));
    expect(Number.isFinite(rowsLimit)).toBe(true);
    expect(rowsLimit).toBe(STARTUP_ROWS_LIMIT);
    // Cubre el universo estadounidense completo con margen: el nocturno del
    // 17 de agosto de 2026 analizó 5.609 símbolos y guardó 3.312 filas.
    expect(rowsLimit).toBeGreaterThanOrEqual(5609);
    // Y no se pasa del techo de la caché de 15 minutos de /api/scans
    // (CACHEABLE_ROWS_LIMIT): por encima, cada arranque en frío repetiría la
    // consulta más cara de la app contra Supabase.
    expect(rowsLimit).toBeLessThanOrEqual(8000);
  });

  it("getLatestScanFromCloudForMarkets normaliza mercados en la URL", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, configured: true, scans: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestScanFromCloudForMarkets(["jp"]);

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url), "https://statsedge.test");
    expect(parsed.searchParams.get("anchor")).toBe("markets");
    expect(parsed.searchParams.get("markets")).toBe("JP");
    expect(parsed.searchParams.get("rowsLimit")).toBe(String(STARTUP_ROWS_LIMIT));
    expect(parsed.searchParams.get("hydrateRs")).toBe("1");
  });
});

describe("call sites GET /api/scans · mesa de producto exige hydrateRs=1", () => {
  function functionBody(name) {
    return CLOUD_SYNC_SOURCE.match(new RegExp(`export async function ${name}[\\s\\S]*?(?=\\nexport |$)`))?.[0] || "";
  }

  it.each(MESA_GET_SCAN_FUNCTIONS)("%s pide filas con hydrateRs=1", (name) => {
    const body = functionBody(name);
    expect(body).toMatch(/\/api\/scans/);
    expect(body).toMatch(/includeRows/);
    expect(body).toMatch(/hydrateRs\s*[=:]\s*["']?1/);
  });

  it("no hay otro GET con includeRows sin hydrateRs en cloudSyncClient", () => {
    const getCalls = [...CLOUD_SYNC_SOURCE.matchAll(/requestJson\((`[^`]*\/api\/scans[^`]*`|"[^"]*\/api\/scans[^"]*")/g)];
    const rowFetchingGets = getCalls
      .map((match) => match[1].replace(/^[`"]|[`"]$/g, ""))
      .filter((url) => url.includes("includeRows"));
    expect(rowFetchingGets.length).toBeGreaterThan(0);
    for (const url of rowFetchingGets) {
      expect(url).toMatch(/hydrateRs=1/);
    }
    const hydrateRsParams = [...CLOUD_SYNC_SOURCE.matchAll(/hydrateRs:\s*"1"/g)];
    expect(hydrateRsParams.length).toBeGreaterThan(0);
  });
});

describe("pullCloudState · importación Research Desk alineada con arranque", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide filas completas e hidratación RS, no el default truncado", async () => {
    const fetchMock = vi.fn(async (url) => {
      const parsed = new URL(String(url), "https://statsedge.test");
      if (parsed.pathname === "/api/scans") return jsonResponse({ ok: true, configured: true, scans: [] });
      return jsonResponse({ ok: true, configured: true, favorites: [], alerts: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await pullCloudState();

    const scanCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/scans"));
    expect(scanCall).toBeTruthy();
    const parsed = new URL(String(scanCall[0]), "https://statsedge.test");
    expect(parsed.searchParams.get("includeDeleted")).toBe("1");
    expect(parsed.searchParams.get("rowsLimit")).toBe(String(STARTUP_ROWS_LIMIT));
    expect(parsed.searchParams.get("hydrateRs")).toBe("1");
    expect(Number(parsed.searchParams.get("limit"))).toBeGreaterThanOrEqual(1);
  });

  it("propaga configured false y vacía datos cuando la nube no está activa", async () => {
    const fetchMock = vi.fn(async (url) => {
      const parsed = new URL(String(url), "https://statsedge.test");
      if (parsed.pathname === "/api/scans") {
        return jsonResponse({ ok: false, configured: false, message: "Supabase no configurado" });
      }
      return jsonResponse({ ok: true, configured: true, favorites: [], alerts: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pullCloudState();

    expect(result.configured).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("La copia en la nube no está activada");
    expect(result.scans).toEqual([]);
    expect(result.favorites).toEqual([]);
    expect(result.alerts).toEqual([]);
  });

  it("devuelve ok false cuando /api/scans responde HTTP 500", async () => {
    const fetchMock = vi.fn(async (url) => {
      const parsed = new URL(String(url), "https://statsedge.test");
      if (parsed.pathname === "/api/scans") {
        return jsonResponse({ error: "Error interno" }, false);
      }
      return jsonResponse({ ok: true, configured: true, favorites: [], alerts: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pullCloudState();

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Error interno");
    expect(result.scans).toEqual([]);
  });
});
