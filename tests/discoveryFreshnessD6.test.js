// D6 (auditoría de producto 2026-11): Listas, Research Desk y /api/discovery.
// Con un nocturno atrasado las nueve listas salían a 0 sin decir por qué, y se
// calculaban sobre 80 de 3.287 filas. Ahora:
//   - misma regla de frescura que el screener (opción B, lib/dataAge.js): si
//     TODO va atrasado el filtro no recorta y se marca freshnessSuspended; si
//     es mixto, recorta;
//   - se lee el nocturno completo (inputRows = row_count);
//   - cada lista vacía dice por qué (frescura, sin datos, criterio).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nightlyUsScan", () => ({ readNightlyUsScan: vi.fn() }));
vi.mock("@/lib/discoveryCache", () => ({
  discoveryCacheKeyForParams: vi.fn(() => ""),
  readMaterializedDiscoverySnapshot: vi.fn(async () => null),
}));
vi.mock("@/lib/globalRs", () => ({
  attachWeeklyRs: (item) => item,
  readGlobalRsForSymbols: vi.fn(async () => ({ configured: false, bySymbol: new Map() })),
}));
vi.mock("@/lib/supabaseServer", async (importOriginal) => ({
  ...(await importOriginal()),
  supabaseConfig: () => ({ configured: true, ownerId: "fixture", mode: "pg" }),
  supabaseRequestAll: vi.fn(),
}));

import { readNightlyUsScan } from "@/lib/nightlyUsScan";
import { supabaseRequestAll } from "@/lib/supabaseServer";
import { buildDiscoverySnapshot, listEmptyReason } from "@/lib/discovery";
import { GET } from "@/app/api/discovery/route";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/nightly-us-2026-10-muestra.json", import.meta.url), "utf8"));
const nightlyRows = fixture.rows.filter((row) => row.scanLocalId.startsWith("materialized:US:2026-10-18"));
// Hoy en la copia local: precios del 16-oct, tres semanas atrás.
const NOW = new Date("2026-11-07T10:00:00Z");
const EMPTY_REASON_KEYS = ["freshness", "no-data", "criteria"];

// El filtro de frescura cuenta los días con el reloj: se fija para que la
// prueba no caduque.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });

function withLastDate(row, lastDate, createdAt = "2026-11-06T04:00:00Z") {
  return { ...row, created_at: createdAt, metrics: { ...row.metrics, lastDate }, raw: { ...row.raw, lastDate } };
}

describe("buildDiscoverySnapshot · frescura con la regla del screener", () => {
  it("conjunto atrasado al completo: devuelve filas y freshnessSuspended=true", () => {
    const snapshot = buildDiscoverySnapshot(nightlyRows, { now: NOW });
    expect(snapshot.freshnessSuspended).toBe(true);
    expect(snapshot.criteria.freshnessSuspended).toBe(true);
    expect(snapshot.criteria.maxPriceFreshnessDays).toBe(5);
    expect(snapshot.rows.length).toBeGreaterThan(0);
    expect(snapshot.lists.reduce((sum, list) => sum + list.count, 0)).toBeGreaterThan(0);
    expect(snapshot.health.freshnessSuspended).toBe(true);
    expect(snapshot.health.note).toMatch(/Precios del 16 oct/);
    // El precio viejo se sigue diciendo en cada fila: solo deja de vaciar.
    expect(snapshot.rows.every((row) => /precio viejo/.test(row.priceFreshnessIssue))).toBe(true);
    expect(snapshot.health.staleRows).toBe(snapshot.rows.length);
  });

  it("conjunto mixto: recorta las filas atrasadas y no suspende", () => {
    const stale = new Set(nightlyRows.slice(0, 8).map((row) => row.symbol));
    const mixed = nightlyRows.map((row) => stale.has(row.symbol) ? withLastDate(row, "2026-10-16") : withLastDate(row, "2026-11-06"));
    const snapshot = buildDiscoverySnapshot(mixed, { now: NOW });
    expect(snapshot.freshnessSuspended).toBe(false);
    expect(snapshot.rows.length).toBeGreaterThan(0);
    for (const list of snapshot.lists) for (const item of list.items) expect(stale.has(item.symbol), item.symbol).toBe(false);
    // Esas mismas filas SÍ salen cuando todo va atrasado: lo que las quita es la frescura.
    const suspended = buildDiscoverySnapshot(nightlyRows, { now: NOW });
    const listed = new Set(suspended.lists.flatMap((list) => list.items.map((item) => item.symbol)));
    expect([...stale].some((symbol) => listed.has(symbol))).toBe(true);
  });

  it("toda lista vacía lleva su motivo", () => {
    const snapshot = buildDiscoverySnapshot(nightlyRows, { now: NOW });
    for (const list of snapshot.lists) {
      if (list.count > 0) expect(list.emptyReason).toBeNull();
      else expect(EMPTY_REASON_KEYS).toContain(list.emptyReason?.key);
    }
  });
});

describe("listEmptyReason", () => {
  const board = (input) => ({ count: 0, input });
  it("frescura", () => {
    expect(listEmptyReason(board({ deduped: 100, eligible: 40, freshnessRejected: 40, missingDataRejected: 0 }), { maxPriceFreshnessDays: 5 }))
      .toEqual({ key: "freshness", text: "Las 40 candidatas tienen el precio de más de 5 días." });
    // Caídas ya en basePasses: eligible 0, pero 12 candidatas por estrategia.
    expect(listEmptyReason(board({ deduped: 100, eligible: 0, candidates: 12, freshnessRejected: 12 }), { maxPriceFreshnessDays: 5 }).key).toBe("freshness");
  });
  it("lista real vacía por frescura (conjunto mixto con filtro activo)", () => {
    const allStaleButOneFresh = nightlyRows.map((row, index) => withLastDate(row, index === 0 ? "2026-11-06" : "2026-10-16"));
    // Mediana atrasada → opción B: no recorta. Con 2/3 al día sí recorta.
    const mostlyFresh = nightlyRows.map((row, index) => withLastDate(row, index % 3 === 0 ? "2026-10-16" : "2026-11-06"));
    expect(buildDiscoverySnapshot(allStaleButOneFresh, { now: NOW }).freshnessSuspended).toBe(true);
    const snapshot = buildDiscoverySnapshot(mostlyFresh, { now: NOW });
    expect(snapshot.freshnessSuspended).toBe(false);
    for (const list of snapshot.lists.filter((item) => item.count === 0)) expect(EMPTY_REASON_KEYS).toContain(list.emptyReason.key);
  });
  it("sin datos", () => {
    expect(listEmptyReason(board({ deduped: 0, eligible: 0 }), {}).key).toBe("no-data");
    expect(listEmptyReason(board({ deduped: 50, eligible: 10, freshnessRejected: 0, missingDataRejected: 10 }), {}).key).toBe("no-data");
  });
  it("criterio", () => {
    // toLocaleString("es-ES"), como el resto de la pantalla (no agrupa 4 cifras).
    expect(listEmptyReason(board({ deduped: 3287, eligible: 0 }), {}).text).toBe(`Ninguno de los ${(3287).toLocaleString("es-ES")} valores analizados cumple el criterio de esta lista.`);
    expect(listEmptyReason(board({ deduped: 50, eligible: 10, freshnessRejected: 2, missingDataRejected: 0 }), { maxPriceFreshnessDays: 5 }).key).toBe("criteria");
  });
  it("con filas no hay motivo", () => {
    expect(listEmptyReason({ count: 3, input: {} })).toBeNull();
  });
});

describe("GET /api/discovery · lee el nocturno completo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readNightlyUsScan.mockResolvedValue({
      configured: true,
      scan: { id: `scan-${Math.random()}`, localId: "materialized:US:2026-10-18:t030032:o0:l5613", createdAt: "2026-10-18T03:00:32.322Z", status: "partial" },
      row: { row_count: nightlyRows.length },
    });
    supabaseRequestAll.mockImplementation(async (_path, _options, paging = {}) => nightlyRows.slice(0, paging.maxRows));
  });

  it("inputRows = row_count del nocturno aunque el cliente pida 80 filas", async () => {
    const response = await GET(new Request("http://localhost/api/discovery?limit=20&maxRows=5&sinceDays=10&minGroupSize=1"));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(supabaseRequestAll).toHaveBeenCalledWith("scan_results", expect.anything(), { maxRows: nightlyRows.length });
    expect(body.inputRows).toBe(nightlyRows.length);
    expect(body.nightly.rowCount).toBe(nightlyRows.length);
    expect(body.coverage).toMatchObject({ complete: true, label: "" });
    expect(body.effectiveRead).toMatchObject({ anchored: true, complete: true });
    expect(body.freshnessSuspended).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.dataAsOf.date).toBe("2026-10-16");
  });

  it("si la lectura no trae el nocturno entero, lo dice: «calculado sobre N de M filas»", async () => {
    supabaseRequestAll.mockImplementation(async () => nightlyRows.slice(0, 20));
    const response = await GET(new Request("http://localhost/api/discovery?limit=19&minGroupSize=1"));
    const body = await response.json();
    expect(body.coverage).toMatchObject({ inputRows: 20, nightlyRows: nightlyRows.length, complete: false, label: `calculado sobre 20 de ${nightlyRows.length} filas` });
    expect(body.health.note).toContain(`calculado sobre 20 de ${nightlyRows.length} filas`);
  });
});
