// Tests del recorte silencioso (docs/timeout-arranque-2026-08-13.md, punto 6):
// rowsLimit puede devolver menos filas de las que el escaneo realmente
// tiene (scans.row_count), y hasta ahora nada lo decía — el escaneo
// "restaurado" tenía menos filas que el real y no había aviso. scanFromDb
// (app/api/scans/route.js) ahora compara row_count contra las filas
// devueltas y expone rowsAvailable/rowsReturned/rowsTruncated; scanFromDb es
// una función pura (no toca Supabase), así que se testea directo, sin mocks
// — mismo patrón que tests/scanDecisionProjection.test.js.

import { describe, expect, it } from "vitest";
import { scanFromDb, scanResultPageOffsets } from "@/app/api/scans/route";

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

  it("rowsSampled solo es true si además hubo recorte", () => {
    const results = Array.from({ length: 5 }, (_, i) => resultRow("scan-1", i + 1));
    const entero = scanFromDb({ id: "scan-1", local_id: "local-1", row_count: 5 }, results, { includeRows: true, rowsSampled: true });
    expect(entero.rowsTruncated).toBe(false);
    expect(entero.rowsSampled).toBe(false);

    const recortado = scanFromDb({ id: "scan-1", local_id: "local-1", row_count: 9918 }, results, { includeRows: true, rowsSampled: true });
    expect(recortado.rowsSampled).toBe(true);
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

// Paginación y criterio del recorte (2026-08-17). Dos hechos medidos contra
// producción ese día mandan aquí:
//   1. PostgREST no devuelve más de 1.000 filas por respuesta, diga lo que
//      diga el `limit` (pidiendo 3.400 sobre un escaneo de 3.312 llegaban
//      1.000 y `content-range: 0-999/3312`). Sin paginar, subir rowsLimit no
//      trae una fila más.
//   2. Cuando no caben todas, el recorte NO puede ser "las primeras por
//      rank_index": rank_index ordena por puntuación, así que sesga la muestra
//      hacia los mejores y deja sin resultados cualquier filtro de valores
//      débiles.
describe("scanResultPageOffsets · páginas de 1.000 y muestra repartida", () => {
  it("pagina de mil en mil cuando el escaneo cabe entero", () => {
    const plan = scanResultPageOffsets(3312, 6000);
    expect(plan.sampled).toBe(false);
    expect(plan.offsets).toEqual([0, 1000, 2000, 3000]);
  });

  it("una sola página cuando el escaneo es pequeño", () => {
    expect(scanResultPageOffsets(62, 6000)).toEqual({ offsets: [0], sampled: false, step: 1000 });
  });

  it("reparte las páginas por todo el ranking cuando el escaneo no cabe", () => {
    const plan = scanResultPageOffsets(20000, 6000);
    expect(plan.sampled).toBe(true);
    expect(plan.offsets).toHaveLength(6);
    expect(plan.offsets[0]).toBe(0);
    // La última página arranca cerca del final del ranking: la cola —los
    // valores débiles— entra en la muestra en vez de perderse.
    expect(plan.offsets.at(-1)).toBeGreaterThan(20000 - 6000);
    expect(plan.offsets.at(-1) + 1000).toBeLessThanOrEqual(20000);
  });

  it("sin tope no pide nada", () => {
    expect(scanResultPageOffsets(3312, 0).offsets).toEqual([]);
  });

  it("sin row_count fiable se guía por el tope pedido", () => {
    const plan = scanResultPageOffsets(0, 2500);
    expect(plan.sampled).toBe(false);
    expect(plan.offsets).toEqual([0, 1000, 2000]);
  });
});
