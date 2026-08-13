// Tests del recorte silencioso (docs/timeout-arranque-2026-08-13.md, punto 6):
// rowsLimit puede devolver menos filas de las que el escaneo realmente
// tiene (scans.row_count), y hasta ahora nada lo decía — el escaneo
// "restaurado" tenía menos filas que el real y no había aviso. scanFromDb
// (app/api/scans/route.js) ahora compara row_count contra las filas
// devueltas y expone rowsAvailable/rowsReturned/rowsTruncated; scanFromDb es
// una función pura (no toca Supabase), así que se testea directo, sin mocks
// — mismo patrón que tests/scanDecisionProjection.test.js.

import { describe, expect, it } from "vitest";
import { scanFromDb } from "@/app/api/scans/route";

function resultRow(scanId, rank) {
  return {
    scan_id: scanId,
    rank_index: rank,
    raw: { symbol: `SYM${rank}`, price: 10 },
    symbol: `SYM${rank}`,
    company_name: `Company ${rank}`,
    country: "US",
    sector: "Technology",
    industry: "Software",
    theme: null,
    total_score: 90,
    weinstein_score: 80,
    minervini_score: 70,
    risk_score: 10,
    rs_rating: 60,
    metrics: {},
  };
}

describe("scanFromDb · reporta el recorte silencioso de rowsLimit", () => {
  it("marca rowsTruncated cuando llegan menos filas que scans.row_count", () => {
    const results = Array.from({ length: 5 }, (_, i) => resultRow("scan-1", i + 1));
    const scan = scanFromDb({ id: "scan-1", local_id: "local-1", row_count: 9918 }, results, { includeRows: true });

    expect(scan.rowsAvailable).toBe(9918);
    expect(scan.rowsReturned).toBe(5);
    expect(scan.rowsTruncated).toBe(true);
  });

  it("NO marca truncado cuando el escaneo cabe entero en la respuesta", () => {
    const results = Array.from({ length: 5 }, (_, i) => resultRow("scan-1", i + 1));
    const scan = scanFromDb({ id: "scan-1", local_id: "local-1", row_count: 5 }, results, { includeRows: true });

    expect(scan.rowsAvailable).toBe(5);
    expect(scan.rowsReturned).toBe(5);
    expect(scan.rowsTruncated).toBe(false);
  });

  it("NO marca truncado cuando includeRows=0: no se pidieron filas, no se recortaron", () => {
    const scan = scanFromDb({ id: "scan-1", local_id: "local-1", row_count: 9918 }, [], { includeRows: false });

    expect(scan.rowsAvailable).toBe(9918);
    expect(scan.rowsReturned).toBe(0);
    expect(scan.rowsTruncated).toBe(false);
  });

  it("no confunde filas de otros scan_id: rowsReturned cuenta solo las de este escaneo", () => {
    const results = [
      ...Array.from({ length: 3 }, (_, i) => resultRow("scan-1", i + 1)),
      ...Array.from({ length: 40 }, (_, i) => resultRow("scan-otro", i + 1)),
    ];
    const scan = scanFromDb({ id: "scan-1", local_id: "local-1", row_count: 3 }, results, { includeRows: true });

    expect(scan.rowsReturned).toBe(3);
    expect(scan.rowsTruncated).toBe(false);
  });
});
