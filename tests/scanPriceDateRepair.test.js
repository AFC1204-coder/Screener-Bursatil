// D9 (auditoría de producto 2026-11): los nocturnos anteriores a a34389a
// guardaron lastDate y chartPreview corridos −1 día (node-postgres + huso de
// Madrid) con el precio de la sesión siguiente. Se corrige AL LEER, en los
// puntos únicos de proyección, y toda pantalla da la misma fecha.
//
// Muestra real (copia local, solo lectura): 30 filas del nocturno US del
// 18-oct (corrido) y 5 del 17-oct (barras en vivo, sanas), con sus cierres de
// daily_bars alrededor de lastDate.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { scanDecisionRowFromDb } from "@/lib/scanDecisionProjection";
import { rowFromScanResult } from "@/lib/leaderboards";
import { buildDiscoverySnapshot } from "@/lib/discovery";
import {
  chartPreviewLooksShifted,
  nextCalendarDay,
  PG_DATE_SHIFT_FIXED_AT,
  repairShiftedChartPreview,
  repairShiftedPriceDate,
  scanPredatesDateFix,
} from "@/lib/scanPriceDateRepair";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/nightly-us-2026-10-muestra.json", import.meta.url), "utf8"));
const shiftedRows = fixture.rows.filter((row) => row.scanLocalId.startsWith("materialized:US:2026-10-18"));
const liveRows = fixture.rows.filter((row) => row.scanLocalId.startsWith("materialized:US:2026-10-17"));
const SCAN_18_OCT_CREATED_AT = "2026-10-18T03:00:32.322Z";

// Fecha de daily_bars cuyo cierre coincide con el precio de la fila (0,1 %).
function barDateForPrice(symbol, price) {
  const bars = fixture.dailyBars.filter((bar) => bar.symbol === symbol);
  const match = bars.find((bar) => Math.abs(Number(bar.close) - price) / Number(bar.close) < 0.001);
  return match ? match.date : null;
}

describe("regla de corrección", () => {
  it("+1 día natural, incluido el paso de jueves a viernes y de domingo a lunes", () => {
    expect(nextCalendarDay("2026-10-15")).toBe("2026-10-16");
    expect(nextCalendarDay("2026-10-11")).toBe("2026-10-12");
    expect(nextCalendarDay("2026-09-07")).toBe("2026-09-08");
    expect(nextCalendarDay("2026-12-31")).toBe("2027-01-01");
  });

  it("solo escaneos anteriores al arreglo; sin fecha, ninguno", () => {
    expect(scanPredatesDateFix("2026-10-18T03:00:32Z")).toBe(true);
    expect(scanPredatesDateFix(new Date("2026-10-22T10:00:00Z"))).toBe(true);
    expect(scanPredatesDateFix(PG_DATE_SHIFT_FIXED_AT)).toBe(false);
    expect(scanPredatesDateFix("2026-10-24T03:00:00Z")).toBe(false);
    expect(scanPredatesDateFix("")).toBe(false);
  });

  it("la serie del 18-oct delata el desfase; la del 17-oct (en vivo) no", () => {
    expect(shiftedRows.length).toBeGreaterThan(20);
    // 29 de 30: SHEL se descargó en vivo esa noche (tiene viernes) y ya estaba bien.
    const detected = shiftedRows.filter((row) => chartPreviewLooksShifted(row.metrics.chartPreview || row.raw.chartPreview));
    expect(detected.length).toBeGreaterThanOrEqual(shiftedRows.length - 2);
    expect(liveRows.length).toBe(5);
    expect(liveRows.some((row) => chartPreviewLooksShifted(row.metrics.chartPreview))).toBe(false);
  });

  it("no corrige dos veces ni corrige escaneos posteriores al arreglo", () => {
    const item = shiftedRows[0];
    const once = scanDecisionRowFromDb(item, { scanCreatedAt: SCAN_18_OCT_CREATED_AT });
    expect(repairShiftedPriceDate(once, SCAN_18_OCT_CREATED_AT)).toBe(once);
    // Misma fila, pero de un escaneo posterior al 23-oct: intacta.
    const after = scanDecisionRowFromDb(item, { scanCreatedAt: "2026-10-24T03:00:00Z" });
    expect(after.lastDate).toBe(item.metrics.lastDate);
    expect(after.priceDateRepaired).toBeUndefined();
    const preview = item.metrics.chartPreview;
    expect(repairShiftedChartPreview(preview, "2026-10-24T03:00:00Z")).toBe(preview);
  });
});

describe("lastDate de la fila = fecha de daily_bars cuyo cierre coincide con price", () => {
  it("nocturno del 18-oct (corrido), por /api/scans (scanDecisionRowFromDb)", () => {
    let checked = 0;
    for (const item of shiftedRows) {
      const row = scanDecisionRowFromDb(item, { scanCreatedAt: SCAN_18_OCT_CREATED_AT });
      const expected = barDateForPrice(item.symbol, Number(row.price));
      if (!expected) continue;
      expect(row.lastDate, item.symbol).toBe(expected);
      if (row.priceDateRepaired) {
        expect(row.priceDateRepaired).toMatchObject({ from: item.metrics.lastDate, to: expected });
        // La serie entera se mueve con la fecha: su última barra es la del precio.
        expect(row.chartPreview.at(-1).date).toBe(expected);
      } else {
        // Sin firma de desfase no se toca (y ya coincidía).
        expect(row.lastDate).toBe(item.metrics.lastDate);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it("nocturno del 17-oct (sano) no se toca y ya coincidía", () => {
    for (const item of liveRows) {
      const row = scanDecisionRowFromDb(item, { scanCreatedAt: item.created_at });
      expect(row.lastDate).toBe(item.metrics.lastDate);
      const expected = barDateForPrice(item.symbol, Number(row.price));
      if (expected) expect(row.lastDate).toBe(expected);
    }
  });

  it("misma fecha en /api/scans, /api/discovery y la ficha (daily_bars)", () => {
    // Lunes 19-oct: precios del viernes 16, al día (sin opción B).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    let snapshot;
    try { snapshot = buildDiscoverySnapshot(shiftedRows, { now: new Date() }); } finally { vi.useRealTimers(); }
    const discoveryItems = new Map();
    for (const list of snapshot.lists) for (const item of list.items) discoveryItems.set(item.symbol, item);
    expect(discoveryItems.size).toBeGreaterThan(0);
    for (const [symbol, item] of discoveryItems) {
      const source = shiftedRows.find((row) => row.symbol === symbol);
      const scansRow = scanDecisionRowFromDb(source, { scanCreatedAt: SCAN_18_OCT_CREATED_AT });
      const leaderboardRow = rowFromScanResult(source);
      expect(item.lastDate).toBe(scansRow.lastDate);
      expect(leaderboardRow.lastDate).toBe(scansRow.lastDate);
      const fichaDate = barDateForPrice(symbol, Number(scansRow.price));
      if (fichaDate) expect(item.lastDate).toBe(fichaDate);
    }
    expect(snapshot.dataAge).toBeNull();
  });
});
