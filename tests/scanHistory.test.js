import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { materializedScanHistoryObservations } from "@/lib/materializedScanner";
import { micCodeForSymbol } from "@/lib/micCodes";
import { SCORING_ENGINE_VERSION } from "@/lib/scoringEngine";
import { weeklyStageForBars } from "@/lib/weeklyStage";
import {
  notInUniverseHistoryObservations,
  scanHistoryChangeReasons,
  selectScanHistoryInserts,
} from "@/lib/scanHistory";

const MIGRATION = fs.readFileSync(
  new URL("../supabase/migrations/20260729130755_scan_symbol_history.sql", import.meta.url),
  "utf8",
);

const DEFAULTS = {
  ownerId: "owner-test",
  sourceScanId: "11111111-1111-4111-8111-111111111111",
  observedAt: "2026-07-29T12:00:00.000Z",
  sourcePipeline: "materialized_scan",
  scoringEngineVersion: SCORING_ENGINE_VERSION,
  dataProvider: "yahoo",
};

function observation(overrides = {}) {
  return {
    symbol: "AAA",
    mic_code: "XNYS",
    observed_at: "2026-07-29T12:00:00.000Z",
    data_as_of: "2026-07-28",
    stage: "stage2",
    stage_week: 4,
    rs_global: 80,
    rs_benchmark: 78,
    rs_country: 82,
    rs_sector: 76,
    composite_score: 74,
    composite_coverage: 0.84,
    composite_partial: true,
    passed_screen: true,
    absence_reason: null,
    absence_detail: null,
    ...overrides,
  };
}

function latest(overrides = {}) {
  return {
    ...observation(),
    owner_id: DEFAULTS.ownerId,
    source_scan_id: "00000000-0000-4000-8000-000000000000",
    source_pipeline: DEFAULTS.sourcePipeline,
    scoring_engine_version: DEFAULTS.scoringEngineVersion,
    data_provider: DEFAULTS.dataProvider,
    observed_week: "2026-07-27",
    ...overrides,
  };
}

describe("scan_symbol_history · decisión change-only", () => {
  it("primera aparición escribe una fila con versión, cobertura y proveedor", () => {
    const [inserted] = selectScanHistoryInserts({
      observations: [observation()],
      latestRows: [],
      defaults: DEFAULTS,
    });
    expect(inserted.change_reasons).toEqual(["first_appearance"]);
    expect(inserted.scoring_engine_version).toBe("composite-11t");
    expect(inserted.composite_coverage).toBe(0.84);
    expect(inserted.composite_partial).toBe(true);
    expect(inserted.data_provider).toBe("yahoo");
  });

  it("cambio de etapa escribe", () => {
    const [inserted] = selectScanHistoryInserts({
      observations: [observation({ stage: "stage4", stage_week: 1 })],
      latestRows: [latest()],
      defaults: DEFAULTS,
    });
    expect(inserted.change_reasons).toEqual(["stage_changed", "stage_week_changed"]);
  });

  it("RS moviéndose 3 puntos NO escribe", () => {
    const inserts = selectScanHistoryInserts({
      observations: [observation({ rs_global: 83 })],
      latestRows: [latest()],
      defaults: DEFAULTS,
    });
    expect(inserts).toEqual([]);
  });

  it("RS moviéndose 7 puntos SÍ escribe", () => {
    const [inserted] = selectScanHistoryInserts({
      observations: [observation({ rs_sector: 83 })],
      latestRows: [latest()],
      defaults: DEFAULTS,
    });
    expect(inserted.change_reasons).toEqual(["rs_sector_moved"]);
  });

  it("ancla semanal escribe aunque no cambie el estado", () => {
    const current = observation({ observed_at: "2026-08-03T08:00:00.000Z" });
    const [inserted] = selectScanHistoryInserts({
      observations: [current],
      latestRows: [latest()],
      defaults: { ...DEFAULTS, observedAt: current.observed_at },
    });
    expect(inserted.change_reasons).toEqual(["weekly_anchor"]);
    expect(inserted.observed_week).toBe("2026-08-03");
  });

  it("not_in_universe cambia una vez y NO genera anclas semanales posteriores", () => {
    const absent = observation({
      observed_at: "2026-08-03T08:00:00.000Z",
      data_as_of: null,
      stage: null,
      stage_week: null,
      rs_global: null,
      rs_benchmark: null,
      rs_country: null,
      rs_sector: null,
      composite_score: null,
      composite_coverage: 0,
      composite_partial: true,
      passed_screen: false,
      absence_reason: "not_in_universe",
      absence_detail: "fuera del snapshot",
    });
    const [firstAbsent] = selectScanHistoryInserts({
      observations: [absent],
      latestRows: [latest()],
      defaults: { ...DEFAULTS, observedAt: absent.observed_at },
    });
    expect(firstAbsent.change_reasons).toEqual(["screening_changed", "absence_reason_changed"]);

    const nextWeek = { ...absent, observed_at: "2026-08-10T08:00:00.000Z" };
    expect(scanHistoryChangeReasons(firstAbsent, {
      ...nextWeek,
      observed_week: "2026-08-10",
    })).toEqual([]);
  });
});

describe("scan_symbol_history · tres motivos de ausencia", () => {
  it("distingue fuera de universo, datos insuficientes y filtrado", () => {
    const scored = {
      symbol: "FILTER",
      micCode: "XNYS",
      lastDate: "2026-07-28",
      weeklyStageState: "stage2",
      weeklyStageWeek: 3,
      rsGlobalPct: 70,
      rsRating: 72,
      rsCountryPct: 74,
      rsSectorPct: 68,
      compositeScore: 66,
      compositeCoverage: 1,
      compositePartial: false,
      dataProviderOrigin: "Yahoo Finance",
    };
    const observations = materializedScanHistoryObservations({
      analyzed: [
        { symbol: "MISS", micCode: "XNYS", ok: false, rejection: "Historico insuficiente: 30/180" },
        { symbol: "FILTER", ok: false, rejection: "importe medio bajo 100", row: scored },
      ],
      scoredRows: [scored],
      passedRows: [],
      filterRejections: [],
      observedAt: DEFAULTS.observedAt,
    });
    expect(observations.map((row) => row.absence_reason)).toEqual([
      "insufficient_data",
      "filtered_out",
    ]);

    const outOfUniverse = observation({
      passed_screen: false,
      absence_reason: "not_in_universe",
      absence_detail: "fuera del snapshot",
      data_as_of: null,
      stage: null,
      stage_week: null,
      rs_global: null,
      rs_benchmark: null,
      rs_country: null,
      rs_sector: null,
      composite_score: null,
      composite_coverage: 0,
      composite_partial: true,
    });
    const [inserted] = selectScanHistoryInserts({
      observations: [outOfUniverse],
      latestRows: [],
      defaults: DEFAULTS,
    });
    expect(inserted.absence_reason).toBe("not_in_universe");
  });

  it("genera not_in_universe solo para la salida nueva del snapshot autoritativo", () => {
    const rows = notInUniverseHistoryObservations({
      latestRows: [
        latest({ symbol: "GONE" }),
        latest({ symbol: "PRESENT" }),
        latest({ symbol: "ALREADY_GONE", absence_reason: "not_in_universe", passed_screen: false }),
      ],
      universeSymbols: ["PRESENT"],
      defaults: DEFAULTS,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: "GONE",
      mic_code: "XNYS",
      passed_screen: false,
      absence_reason: "not_in_universe",
      composite_coverage: 0,
      composite_partial: true,
    });
  });
});

describe("scan_symbol_history · contrato MIC y migración", () => {
  it("resuelve MIC por bolsa exacta, no por country/market", () => {
    expect(micCodeForSymbol("AAPL", { exchange: "NasdaqGS" })).toBe("XNGS");
    expect(micCodeForSymbol("SMCI", { exchange: "NasdaqGM" })).toBe("XNMS");
    expect(micCodeForSymbol("SMFL", { exchange: "NasdaqCM" })).toBe("XNCM");
    expect(micCodeForSymbol("SAP.DE")).toBe("XETR");
    expect(micCodeForSymbol("AMBIGUOUS", { exchange: "NASDAQ" })).toBe("");
  });

  it("la migración es aditiva, usa mic_code y cierra la tabla con RLS", () => {
    expect(MIGRATION).toMatch(/create table public\.scan_symbol_history/);
    expect(MIGRATION).toMatch(/mic_code text not null/);
    expect(MIGRATION).not.toMatch(/\bmarket text not null\b/);
    expect(MIGRATION).toMatch(/scan_symbol_history_mic_latest_idx/);
    expect(MIGRATION).toMatch(/enable row level security/);
    expect(MIGRATION).not.toMatch(/alter table public\.(?:scan_results|daily_bars)/);
  });

  it("todos los escritores del scan materializado persisten el histórico", () => {
    const routeUrls = [
      new URL("../app/api/jobs/scan-refresh/route.js", import.meta.url),
      new URL("../app/api/cron/scan-refresh/route.js", import.meta.url),
      new URL("../app/api/cron/shadow-europe-refresh/route.js", import.meta.url),
    ];
    for (const routeUrl of routeUrls) {
      const source = fs.readFileSync(routeUrl, "utf8");
      expect(source).toMatch(/import\s+\{\s*writeScanSymbolHistory\s*\}\s+from\s+"@\/lib\/scanHistory"/);
      expect(source).toMatch(/await\s+writeScanSymbolHistory\s*\(/);
    }
  });
});

describe("scan_symbol_history · semana dentro de etapa", () => {
  it("weeklyStageForBars calcula la racha semanal de la etapa actual", () => {
    const start = Date.UTC(2024, 0, 1);
    const bars = Array.from({ length: 90 }, (_, index) => {
      const close = 50 + index;
      return {
        date: new Date(start + index * 7 * 86400000).toISOString().slice(0, 10),
        open: close - 1,
        high: close + 1,
        low: close - 2,
        close,
        volume: 1_000_000,
      };
    });
    const stage = weeklyStageForBars(bars);
    expect(stage.state).toBe("stage2");
    expect(stage.weekInStage).toBeGreaterThan(0);
  });
});
