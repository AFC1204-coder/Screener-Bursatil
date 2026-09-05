// GET /api/weekly-changes — la franja «Cambios de la semana» del screener.
//
// Regresión WEEKLY-PG-1: el adaptador pg no entiende alias PostgREST del tipo
// `progress_status:settings->progress->>status` (lo trata como columna literal).
// La ruta debe pedir `settings` y leer settings.progress.status en JS.
//
// Regresión WEEKLY-PG-1b: scan_results tampoco admite alias (`name:company_name`,
// `stage:metrics->>…`). Pedir columnas pg reales y mapear en normalizeRow.

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
let scansResponse = [];
let scanRowsById = new Map();

vi.mock("@/lib/supabaseServer", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabaseConfig: () => ({ configured: true, ownerId: "personal", url: "https://x.test", key: "k", missing: [] }),
    requirePersistenceAuth: () => null,
    supabaseRequest: async (path, options) => {
      calls.push({ path, query: options?.query || "" });
      if (path === "scans") return scansResponse;
      return [];
    },
    supabaseRequestAll: async (path, options) => {
      calls.push({ path, query: options?.query || "" });
      if (path !== "scan_results") return [];
      const scanId = decodeURIComponent(String(options?.query || "").match(/scan_id=eq\.([^&]+)/)?.[1] || "");
      return scanRowsById.get(scanId) || [];
    },
    supabaseCount: async () => 0,
  };
});

vi.mock("@/lib/globalRs", () => ({
  hydrateRowsWithWeeklyRs: vi.fn(async (rows) => rows),
}));

const { GET } = await import("@/app/api/weekly-changes/route");
const { scanProgressStatus, PUBLISHABLE_PARENT_STATUS } = await import("@/lib/nightlyUsScan");

function nightlyScan(scanDate, { status = "partial", id = `id-${scanDate}` } = {}) {
  return {
    id,
    local_id: `materialized:US:${scanDate}:t040000:o0:l5610`,
    created_at: `${scanDate}T04:00:00.000Z`,
    row_count: 3300,
    settings: { progress: { status } },
  };
}

function lightRow(symbol, lastDate, stage = "stage2") {
  return {
    symbol,
    company_name: symbol,
    theme: "Software",
    metrics: {
      weeklyStageState: stage,
      distance52w: "-5",
      lastDate,
    },
  };
}

function getRequest(extra = "") {
  return new Request(`https://statsedge.test/api/weekly-changes${extra}`);
}

function scansListQuery() {
  const call = calls.find((entry) => entry.path === "scans");
  return decodeURIComponent(String(call?.query || ""));
}

function scanResultsQueries() {
  return calls
    .filter((entry) => entry.path === "scan_results")
    .map((entry) => decodeURIComponent(String(entry.query || "")));
}

beforeEach(() => {
  calls.length = 0;
  scansResponse = [];
  scanRowsById = new Map();
});

describe("scanProgressStatus", () => {
  it("lee settings.progress.status y normaliza espacios", () => {
    expect(scanProgressStatus({ settings: { progress: { status: " partial " } } })).toBe("partial");
    expect(scanProgressStatus({ settings: { progress: { status: "complete" } } })).toBe("complete");
    expect(scanProgressStatus({ settings: {} })).toBe("");
    expect(scanProgressStatus({})).toBe("");
  });
});

describe("GET /api/weekly-changes · select de scans", () => {
  it("REGRESIÓN: pide settings entera, no alias progress_status sobre JSON", async () => {
    scansResponse = [nightlyScan("2026-08-23")];

    const res = await GET(getRequest());
    expect(res.status).not.toBe(502);

    const query = scansListQuery();
    expect(query).toContain("select=id,local_id,created_at,row_count,settings");
    expect(query).not.toContain("progress_status:");
    expect(query).not.toContain("settings->progress");
  });

  it("filtra escaneos no publicables leyendo settings.progress.status", async () => {
    scansResponse = [
      nightlyScan("2026-08-23", { status: "failed", id: "failed-scan" }),
      nightlyScan("2026-08-22", { status: "partial", id: "publishable-scan" }),
    ];

    const res = await GET(getRequest());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.state).toBe("not-comparable");
    expect(payload.reason).toBe("single-comparable-scan");
    expect(PUBLISHABLE_PARENT_STATUS).toContain(scanProgressStatus(scansResponse[1]));
    expect(PUBLISHABLE_PARENT_STATUS).not.toContain(scanProgressStatus(scansResponse[0]));
  });

  it("con dos nocturnos publicables comparables devuelve state ok, no 502", async () => {
    const anchor = nightlyScan("2026-08-18", { status: "complete", id: "anchor-scan" });
    const current = nightlyScan("2026-08-23", { status: "partial", id: "current-scan" });
    scansResponse = [current, anchor];
    scanRowsById.set("anchor-scan", [lightRow("AAA", "2026-08-17")]);
    scanRowsById.set("current-scan", [lightRow("AAA", "2026-08-21")]);

    const res = await GET(getRequest("?refresh=1"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.state).toBe("ok");
  });
});

describe("GET /api/weekly-changes · select de scan_results", () => {
  it("REGRESIÓN: pide columnas pg reales, no alias PostgREST sobre scan_results", async () => {
    const anchor = nightlyScan("2026-08-18", { status: "complete", id: "anchor-scan" });
    const current = nightlyScan("2026-08-23", { status: "partial", id: "current-scan" });
    scansResponse = [current, anchor];
    scanRowsById.set("anchor-scan", [lightRow("AAA", "2026-08-17")]);
    scanRowsById.set("current-scan", [lightRow("AAA", "2026-08-21")]);

    const res = await GET(getRequest("?refresh=1"));
    expect(res.status).not.toBe(502);

    const queries = scanResultsQueries();
    expect(queries.length).toBeGreaterThanOrEqual(2);
    for (const query of queries) {
      expect(query).toContain("select=symbol,company_name,theme,metrics");
      expect(query).not.toMatch(/[a-zA-Z0-9_]+:[a-zA-Z0-9_]+/);
      expect(query).not.toContain("metrics->>");
    }
  });
});
