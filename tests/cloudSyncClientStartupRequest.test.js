// Tests de lib/cloudSyncClient.js#getLatestScanFromCloud.
//
// Contexto (docs/timeout-arranque-2026-08-13.md): el arranque pedía
// `/api/scans?includeRows=1&limit=10&rowsLimit=2000` — diez escaneos
// mezclados, hasta 20.202 filas candidatas en producción, y `limit=10`
// desactivaba sin querer la caché de 15 minutos de app/api/scans/route.js
// (cacheableLatest exige limit===1). Este test fija que el arranque pide
// UN escaneo, el nocturno estadounidense.
//
// SCREENER-BOOTSTRAP-CORE-FIRST-1: arranque pide hydrateRs=0 (core) primero;
// extended (hydrateRs=1) en segunda fase vía getLatestScanFromCloudExtended*.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLatestScanFromCloud,
  getLatestScanFromCloudExtended,
  getLatestScanFromCloudForMarkets,
  getLatestScanFromCloudForMarketsExtended,
  pullCloudState,
  STARTUP_ROWS_LIMIT,
} from "@/lib/cloudSyncClient";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOUD_SYNC_SOURCE = readFileSync(resolve(ROOT, "lib/cloudSyncClient.js"), "utf8");

const MESA_CORE_FUNCTIONS = [
  "getLatestScanFromCloud",
  "getLatestScanFromCloudForMarkets",
];

const MESA_EXTENDED_FUNCTIONS = [
  "getLatestScanFromCloudExtended",
  "getLatestScanFromCloudForMarketsExtended",
];

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function parseFetchUrl(fetchMock, index = 0) {
  const [url] = fetchMock.mock.calls[index];
  return new URL(String(url), "https://statsedge.test");
}

describe("getLatestScanFromCloud · bootstrap core-first", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide limit=1, nightly-us y hydrateRs=0 (core) en arranque", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, configured: true, scans: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestScanFromCloud();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parsed = parseFetchUrl(fetchMock);

    expect(parsed.pathname).toBe("/api/scans");
    expect(parsed.searchParams.get("limit")).toBe("1");
    expect(parsed.searchParams.get("includeRows")).toBe("1");
    expect(parsed.searchParams.get("anchor")).toBe("nightly-us");
    expect(parsed.searchParams.get("hydrateRs")).toBe("0");

    const rowsLimit = Number(parsed.searchParams.get("rowsLimit"));
    expect(Number.isFinite(rowsLimit)).toBe(true);
    expect(rowsLimit).toBe(STARTUP_ROWS_LIMIT);
    expect(rowsLimit).toBeGreaterThanOrEqual(5609);
    expect(rowsLimit).toBeLessThanOrEqual(8000);
  });

  it("getLatestScanFromCloudExtended pide hydrateRs=1", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, configured: true, scans: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestScanFromCloudExtended();

    const parsed = parseFetchUrl(fetchMock);
    expect(parsed.searchParams.get("anchor")).toBe("nightly-us");
    expect(parsed.searchParams.get("hydrateRs")).toBe("1");
  });

  it("getLatestScanFromCloudForMarkets normaliza mercados y pide core", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, configured: true, scans: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestScanFromCloudForMarkets(["jp"]);

    const parsed = parseFetchUrl(fetchMock);
    expect(parsed.searchParams.get("anchor")).toBe("markets");
    expect(parsed.searchParams.get("markets")).toBe("JP");
    expect(parsed.searchParams.get("rowsLimit")).toBe(String(STARTUP_ROWS_LIMIT));
    expect(parsed.searchParams.get("hydrateRs")).toBe("0");
  });

  it("getLatestScanFromCloudForMarketsExtended pide hydrateRs=1", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, configured: true, scans: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestScanFromCloudForMarketsExtended(["us", "jp"]);

    const parsed = parseFetchUrl(fetchMock);
    expect(parsed.searchParams.get("markets")).toBe("JP,US");
    expect(parsed.searchParams.get("hydrateRs")).toBe("1");
  });
});

describe("call sites GET /api/scans · bootstrap core → extended", () => {
  function functionBody(name) {
    return CLOUD_SYNC_SOURCE.match(new RegExp(`export async function ${name}[\\s\\S]*?(?=\\nexport |$)`))?.[0] || "";
  }

  it.each(MESA_CORE_FUNCTIONS)("%s delega en buildStartupScanUrl con hydrateRs=0", (name) => {
    const body = functionBody(name);
    expect(body).toMatch(/buildStartupScanUrl/);
    expect(body).toMatch(/hydrateRs:\s*["']0["']/);
  });

  it.each(MESA_EXTENDED_FUNCTIONS)("%s delega en buildStartupScanUrl con hydrateRs=1", (name) => {
    const body = functionBody(name);
    expect(body).toMatch(/buildStartupScanUrl/);
    expect(body).toMatch(/hydrateRs:\s*["']1["']/);
  });

  it("buildStartupScanUrl centraliza /api/scans, includeRows y hydrateRs", () => {
    const builder = CLOUD_SYNC_SOURCE.match(/function buildStartupScanUrl[\s\S]*?(?=\nexport |$)/)?.[0] || "";
    expect(builder).toMatch(/\/api\/scans/);
    expect(builder).toMatch(/includeRows/);
    expect(builder).toMatch(/hydrateRs:\s*String\(hydrateRs\)/);
  });
});

describe("pullCloudState · importación Research Desk alineada con arranque", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide filas completas e hidratación RS extended (importación, no bootstrap)", async () => {
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
