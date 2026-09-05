import { describe, expect, it } from "vitest";
import { RS_LINE_MIN_WEEKS } from "@/lib/chartSeriesModel";
import { selectGlobalRsSeriesEngineVersion } from "@/lib/globalRs";
import {
  LEGACY_EU_RS_ENGINE_VERSION,
  PRIVATE_GLOBAL_RS_ENGINE_VERSION,
  US_EQUITY_RS_ENGINE_VERSION,
} from "@/lib/rsEngines";

function weeklyRow(engineVersion, weekKey, snapshotDate = "2026-08-01", rsRating = 70) {
  return {
    engine_version: engineVersion,
    week_key: weekKey,
    snapshot_date: snapshotDate,
    rs_rating: rsRating,
  };
}

function weeksForEngine(engineVersion, count, startWeek = 1) {
  return Array.from({ length: count }, (_, index) => weeklyRow(
    engineVersion,
    `2026-W${String(startWeek + index).padStart(2, "0")}`,
    `2026-08-${String(Math.min(28, index + 1)).padStart(2, "0")}`,
    60 + index,
  ));
}

describe("selectGlobalRsSeriesEngineVersion", () => {
  it("pin rico: conserva el motor pinneado aunque exista legacy con más semanas", () => {
    const rows = [
      ...weeksForEngine(PRIVATE_GLOBAL_RS_ENGINE_VERSION, RS_LINE_MIN_WEEKS),
      ...weeksForEngine(LEGACY_EU_RS_ENGINE_VERSION, RS_LINE_MIN_WEEKS + 10),
    ];
    expect(selectGlobalRsSeriesEngineVersion(rows)).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
  });

  it("pin pobre: cae al legacy con historia suficiente", () => {
    const rows = [
      weeklyRow(PRIVATE_GLOBAL_RS_ENGINE_VERSION, "2026-W35", "2026-08-29", 64),
      ...weeksForEngine(LEGACY_EU_RS_ENGINE_VERSION, RS_LINE_MIN_WEEKS),
    ];
    expect(selectGlobalRsSeriesEngineVersion(rows)).toBe(LEGACY_EU_RS_ENGINE_VERSION);
  });

  it("solo legacy: sin filas del pin, elige el motor con semanas suficientes", () => {
    const rows = weeksForEngine(LEGACY_EU_RS_ENGINE_VERSION, RS_LINE_MIN_WEEKS);
    expect(selectGlobalRsSeriesEngineVersion(rows)).toBe(LEGACY_EU_RS_ENGINE_VERSION);
  });

  it("pin pobre sin alternativa suficiente: conserva el pin", () => {
    const rows = [
      weeklyRow(PRIVATE_GLOBAL_RS_ENGINE_VERSION, "2026-W35", "2026-08-29", 64),
      weeklyRow(US_EQUITY_RS_ENGINE_VERSION, "2026-W36", "2026-09-05", 99),
    ];
    expect(selectGlobalRsSeriesEngineVersion(rows)).toBe(PRIVATE_GLOBAL_RS_ENGINE_VERSION);
  });

  it("sin pin: conserva el engine de la fila más reciente cuando ninguno alcanza el mínimo", () => {
    const rows = [
      weeklyRow(US_EQUITY_RS_ENGINE_VERSION, "2026-W32", "2026-08-08", 99),
      weeklyRow(LEGACY_EU_RS_ENGINE_VERSION, "2026-W21", "2026-05-22", 98),
      weeklyRow(LEGACY_EU_RS_ENGINE_VERSION, "2026-W20", "2026-05-15", 97),
    ];
    expect(selectGlobalRsSeriesEngineVersion(rows)).toBe(US_EQUITY_RS_ENGINE_VERSION);
  });
});
