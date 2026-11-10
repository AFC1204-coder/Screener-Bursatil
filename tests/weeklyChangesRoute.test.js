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
    expect(payload.reason).toBe("no-weekly-anchor");
    expect(PUBLISHABLE_PARENT_STATUS).toContain(scanProgressStatus(scansResponse[1]));
    expect(PUBLISHABLE_PARENT_STATUS).not.toContain(scanProgressStatus(scansResponse[0]));
  });

  it("con dos nocturnos publicables comparables devuelve state ok, no 502", async () => {
    const anchor = nightlyScan("2026-10-10", { status: "complete", id: "anchor-scan" });
    const current = nightlyScan("2026-10-18", { status: "partial", id: "current-scan" });
    scansResponse = [current, anchor];
    scanRowsById.set("anchor-scan", [lightRow("AAA", "2026-10-09")]);
    scanRowsById.set("current-scan", [lightRow("AAA", "2026-10-16")]);

    const res = await GET(getRequest("?refresh=1"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.state).toBe("ok");
  });
});

describe("GET /api/weekly-changes · select de scan_results", () => {
  it("REGRESIÓN: pide columnas pg reales, no alias PostgREST sobre scan_results", async () => {
    const anchor = nightlyScan("2026-10-10", { status: "complete", id: "anchor-scan" });
    const current = nightlyScan("2026-10-18", { status: "partial", id: "current-scan" });
    scansResponse = [current, anchor];
    scanRowsById.set("anchor-scan", [lightRow("AAA", "2026-10-09")]);
    scanRowsById.set("current-scan", [lightRow("AAA", "2026-10-16")]);

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

// ── Contrato D2 (auditoría de producto 2026-11) ────────────────────────────
// El par es el escaneo MOSTRADO frente al cierre del viernes anterior, y
// ninguna «entrada en E2» puede estar en otra etapa en el escaneo mostrado.
describe("GET /api/weekly-changes · contrato D2", () => {
  function octoberWeek() {
    // Nocturnos reales de la auditoría: 12→18 oct (barras 9→16) + sábado 10.
    const dates = ["2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12", "2026-10-10"];
    return dates.map((d) => ({ ...nightlyScan(d), created_at: new Date(`${d}T03:00:32.000Z`) }));
  }
  const lastDateOf = { "2026-10-18": "2026-10-16", "2026-10-17": "2026-10-16", "2026-10-16": "2026-10-15", "2026-10-15": "2026-10-14", "2026-10-14": "2026-10-13", "2026-10-13": "2026-10-12", "2026-10-12": "2026-10-09", "2026-10-10": "2026-10-09" };

  function seed() {
    scansResponse = octoberWeek();
    for (const scan of scansResponse) {
      const date = scan.local_id.split(":")[2];
      const ld = lastDateOf[date];
      // ENT entra en E2 durante la semana; SAL sale; ZIG parpadea entre
      // nocturnos de entre semana (E2 el miércoles, E3 el resto).
      const anchorSide = date <= "2026-10-12";
      scanRowsById.set(scan.id, [
        lightRow("ENT", ld, anchorSide ? "stage1" : "stage2"),
        lightRow("SAL", ld, anchorSide ? "stage2" : "stage3"),
        lightRow("ZIG", ld, date === "2026-10-14" ? "stage2" : "stage3"),
        lightRow("FIX", ld, "stage2"),
      ]);
    }
  }

  it("toScan es el escaneo mostrado y fromScan, el cierre del viernes anterior", async () => {
    seed();
    const displayed = scansResponse[0].local_id; // 18-oct
    const res = await GET(getRequest(`?refresh=1&scan=${encodeURIComponent(displayed)}`));
    const payload = await res.json();
    expect(payload.state).toBe("ok");
    expect(payload.window.toScan.localId).toBe(displayed);
    expect(payload.window.fromScan.scanDate).toBe("2026-10-10");
    expect(payload.window).toMatchObject({ from: "2026-10-09", to: "2026-10-16", fromWeekEnd: "2026-10-09", toWeekEnd: "2026-10-16", policy: "weekly-close" });
    const displayedRows = new Map(scanRowsById.get(scansResponse[0].id).map((r) => [r.symbol, r.metrics.weeklyStageState]));
    expect(payload.stage2.entries.rows.map((r) => r.symbol)).toEqual(["ENT"]);
    expect(payload.stage2.entries.rows.every((r) => displayedRows.get(r.symbol) === "stage2")).toBe(true);
    expect(payload.stage2.exits.rows.every((r) => displayedRows.get(r.symbol) !== "stage2")).toBe(true);
    expect(payload.validation).toEqual({ entriesDropped: 0, exitsDropped: 0 });
  });

  it("sin ?scan= usa el nocturno más reciente por instante real (no el miércoles)", async () => {
    seed();
    const payload = await (await GET(getRequest("?refresh=1"))).json();
    expect(payload.window.toScan.scanDate).toBe("2026-10-18");
  });

  it("un mostrado antiguo de entre semana no da cifras: su etapa no es la oficial", async () => {
    seed();
    const wednesday = scansResponse.find((s) => s.local_id.includes("2026-10-14")).local_id;
    const payload = await (await GET(getRequest(`?refresh=1&scan=${encodeURIComponent(wednesday)}`))).json();
    expect(payload.state).toBe("not-comparable");
    expect(payload.stage2).toBeUndefined();
  });

  it("sin par válido: «not-comparable», sin cifras", async () => {
    seed();
    // Sin los nocturnos con barras del viernes 9 no hay ancla en tolerancia.
    scansResponse = scansResponse.filter((s) => !/2026-10-1[02]:/.test(s.local_id));
    const payload = await (await GET(getRequest(`?refresh=1&scan=${encodeURIComponent(scansResponse[0].local_id)}`))).json();
    expect(payload.state).toBe("not-comparable");
    expect(payload.reason).toBe("no-weekly-anchor");
    expect(payload.stage2).toBeUndefined();
    expect(payload.highs).toBeUndefined();
  });

  it("un ?scan= que no es nocturno US se ignora (vale el más reciente)", async () => {
    seed();
    const payload = await (await GET(getRequest("?refresh=1&scan=local-123"))).json();
    expect(payload.window.toScan.scanDate).toBe("2026-10-18");
  });
});
