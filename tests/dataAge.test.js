import { describe, expect, it } from "vitest";
import { buildDataAgeNotice, medianLastDate, missedWeekdays } from "@/lib/dataAge";
import { buildSnapshotFreshnessNotice } from "@/lib/snapshotFreshness";

const rowsOn = (date, n = 10) => Array.from({ length: n }, () => ({ lastDate: date }));
// 2026-11-06 es viernes.
const FRI = new Date("2026-11-06T09:00:00Z");

describe("antigüedad de precios", () => {
  it("cuenta solo días hábiles completos entre el último precio y hoy", () => {
    expect(missedWeekdays("2026-11-05", FRI)).toBe(0); // ayer
    expect(missedWeekdays("2026-11-04", FRI)).toBe(1);
    expect(missedWeekdays("2026-11-03", FRI)).toBe(2);
    // lunes con datos del viernes: el fin de semana no cuenta
    expect(missedWeekdays("2026-11-06", new Date("2026-11-09T09:00:00Z"))).toBe(0);
    expect(missedWeekdays("2026-11-05", new Date("2026-11-09T09:00:00Z"))).toBe(1);
  });

  it("usa la fecha mediana: unas pocas filas rezagadas no disparan el aviso", () => {
    const rows = [...rowsOn("2026-11-05", 9), { lastDate: "2026-10-01" }];
    expect(medianLastDate(rows)).toBe("2026-11-05");
    expect(buildDataAgeNotice(rows, FRI)).toBeNull();
  });

  it("no avisa con datos al día, con un festivo de margen ni sin fechas", () => {
    expect(buildDataAgeNotice(rowsOn("2026-11-05"), FRI)).toBeNull();
    expect(buildDataAgeNotice(rowsOn("2026-11-04"), FRI)).toBeNull();
    expect(buildDataAgeNotice([], FRI)).toBeNull();
    expect(buildDataAgeNotice([{ symbol: "AAPL" }], FRI)).toBeNull();
    expect(buildDataAgeNotice(undefined, FRI)).toBeNull();
  });

  it("avisa en lenguaje de producto cuando van dos sesiones retrasados", () => {
    const notice = buildDataAgeNotice(rowsOn("2026-11-03"), FRI);
    expect(notice.tone).toBe("warn");
    expect(notice.label).toBe("Precios del 3 nov");
    expect(notice.detail).toContain("2 sesiones");
    expect(notice.source).toBe("data-age");
    expect(notice.detail).not.toMatch(/supabase|yahoo|postgres|cron/i);
  });

  it("buildSnapshotFreshnessNotice la usa solo si no hay otro motivo de aviso", () => {
    const old = { rows: rowsOn("2026-11-03") };
    expect(buildSnapshotFreshnessNotice({ stale: false }, old, { now: FRI })?.source).toBe("data-age");
    expect(buildSnapshotFreshnessNotice({ stale: false }, { rows: rowsOn("2026-11-05") }, { now: FRI })).toBeNull();
    // otro motivo (copia cacheada) tiene prioridad: slot único
    expect(buildSnapshotFreshnessNotice({ stale: true }, old, { now: FRI }).label).toBe("Sin actualizar hoy");
  });
});
