import { describe, expect, it } from "vitest";
import { LONG_HISTORY_ROW_FIELDS, longHistoryFieldsFromRow, projectLongHistoryFields } from "../lib/longHistory.js";
import { LONG_HISTORY_MAX_AGE_DAYS, asOfToMs, loadLongHistoryForScan } from "../lib/longHistoryStore.js";
import { SCAN_LIGHT_FIELDS, scanLightMetrics } from "../lib/scanLightProjection.js";
import { scanResultPayload } from "../lib/materializedScanner.js";

const NOW = Date.UTC(2026, 10, 9);
const stat = (asOf, over = {}) => ({ status: "ok", asOf, athDistancePct: -5, ret5y: 120, ...over });
const readerOf = (entries) => async () => new Map(entries);

describe("campos lh* en la fila del escaneo", () => {
  it("longHistoryFieldsFromRow devuelve solo las claves presentes (nunca null por relleno)", () => {
    expect(longHistoryFieldsFromRow({ symbol: "AAPL", perf1w: 1 })).toEqual({});
    expect(longHistoryFieldsFromRow({ lhRet5y: 132, lhAthDistPct: -3.7, lhRet3y: null })).toEqual({ lhRet5y: 132, lhAthDistPct: -3.7 });
    expect(longHistoryFieldsFromRow(undefined)).toEqual({});
  });

  it("scanResultPayload persiste los lh* presentes en metrics y no añade los ausentes", () => {
    const con = scanResultPayload({ symbol: "AAPL", lhRet5y: 132, lhAthDistPct: -3.7 }, "scan-1", "owner", 0, {});
    expect(con.metrics.lhRet5y).toBe(132);
    expect(con.metrics.lhAthDistPct).toBe(-3.7);
    const sin = scanResultPayload({ symbol: "ZZZZ" }, "scan-1", "owner", 1, {});
    for (const key of LONG_HISTORY_ROW_FIELDS) expect(key in sin.metrics).toBe(false);
  });

  it("todos los lh* viajan en la fila ligera de /api/scans", () => {
    for (const key of LONG_HISTORY_ROW_FIELDS) expect(SCAN_LIGHT_FIELDS).toContain(key);
    const proj = projectLongHistoryFields(stat("2026-11-08", { ret3y: 80, ret10y: 300, retSinceIpo: 9000, downYears10: 1 }));
    const light = scanLightMetrics({ symbol: "AAPL", ...proj });
    expect(light.lhRet5y).toBe(120);
    expect(light.lhAthDistPct).toBe(-5);
  });
});

describe("loadLongHistoryForScan", () => {
  it("conserva lo vigente y descarta lo más antiguo que el máximo, avisando", async () => {
    const notes = [];
    const map = await loadLongHistoryForScan({
      reader: readerOf([["AAA", stat("2026-11-08")], ["BBB", stat("2026-10-01")], ["CCC", stat("2026-09-01")]]),
      now: NOW,
      onNote: (n) => notes.push(n),
    });
    expect([...map.keys()].sort()).toEqual(["AAA", "BBB"]);
    expect(notes.join(" ")).toMatch(/2 símbolos con estadística vigente/);
    expect(notes.join(" ")).toMatch(/1 descartados por antigüedad/);
  });

  it("el máximo por defecto son 45 días", async () => {
    expect(LONG_HISTORY_MAX_AGE_DAYS).toBe(45);
    const justo = await loadLongHistoryForScan({ reader: readerOf([["A", stat("2026-09-25")]]), now: NOW }); // 45 días
    const pasado = await loadLongHistoryForScan({ reader: readerOf([["A", stat("2026-09-24")]]), now: NOW }); // 46 días
    expect(justo.size).toBe(1);
    expect(pasado.size).toBe(0);
  });

  it("si la lectura falla devuelve un Map vacío y NO lanza (el escaneo sigue sin lh*)", async () => {
    const notes = [];
    const map = await loadLongHistoryForScan({ reader: async () => { throw new Error("tabla no existe"); }, now: NOW, onNote: (n) => notes.push(n) });
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
    expect(notes[0]).toMatch(/no disponible.*tabla no existe.*sin campos lh/);
  });

  it("una fecha ilegible cuenta como caducada, nunca como vigente", async () => {
    const map = await loadLongHistoryForScan({ reader: readerOf([["A", { status: "ok" }], ["B", stat("basura")]]), now: NOW });
    expect(map.size).toBe(0);
  });

  it("acepta la fecha como objeto Date (adaptador antiguo del Mini) además de texto", async () => {
    const map = await loadLongHistoryForScan({
      reader: readerOf([["A", stat(new Date(2026, 10, 8))], ["B", stat("2026-11-08T00:00:00.000Z")], ["C", stat(new Date(2026, 8, 1))]]),
      now: NOW,
    });
    expect([...map.keys()].sort()).toEqual(["A", "B"]);
    expect(asOfToMs(new Date(2026, 10, 8))).toBe(Date.UTC(2026, 10, 8));
    expect(Number.isNaN(asOfToMs(new Date("x")))).toBe(true);
    expect(Number.isNaN(asOfToMs(undefined))).toBe(true);
  });

  it("sin datos devuelve Map vacío", async () => {
    expect((await loadLongHistoryForScan({ reader: readerOf([]), now: NOW })).size).toBe(0);
  });
});
