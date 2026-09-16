import { describe, expect, it } from "vitest";
import { scanFromDb } from "@/app/api/scans/route";
import {
  MESA_TRANSPORT_OMIT_FIELDS,
  projectScanRowForMesaTransport,
  SCAN_LIGHT_EXCLUDED_FIELDS,
  SCAN_LIGHT_FIELDS,
} from "@/lib/scanLightProjection";

function fatFullRow(symbol = "FAT") {
  return {
    symbol,
    companyName: "Fat Corp",
    country: "US",
    price: 42.5,
    chartBarsCount: 260,
    weinsteinScore: 70,
    minerviniScore: 65,
    rsRating: 88,
    weeklyStageState: 2,
    weeklyStageLabel: "Etapa 2",
    screenPassed: true,
    rowProjection: "full",
    chartPreview: [
      { date: "2026-01-01", close: 10, sma50: 9, sma200: 8, volume: 1000 },
      { date: "2026-01-02", close: 11, sma50: 9.1, sma200: 8.1, volume: 1100 },
    ],
    setupDisplayEvidence: "Evidence prose ".repeat(40),
    setupDisplayLine: "Line prose ".repeat(40),
    weeklyBreakoutVolDetail: "Breakout detail ".repeat(40),
    methodologyReliabilityReason: "Reliability ".repeat(40),
    contractionStructureReason: "Structure ".repeat(40),
    setupDisplayLabel: "Observar",
    weeklyStageStructureDetail: "keep-structure-detail",
    growthMetrics: { revenueGrowth: 0.2, nested: { statements: ["x".repeat(2000)] } },
    signalCoverage: { a: 1, b: 2, narrative: "y".repeat(4000) },
    businessSummary: "z".repeat(8000),
    measuredContractionSwings: Array.from({ length: 40 }, (_, i) => ({ i, depth: i * 0.1 })),
    ratingModel: { weights: Array.from({ length: 50 }, (_, i) => i) },
    objectiveMetricAudit: {
      items: [
        { key: "perf3m", status: "mismatch", label: "3m", value: 1, expected: 2, source: "bars", formula: "x" },
        { key: "perf6m", status: "verified", label: "6m", value: 1 },
        { key: "distance52w", status: "unverified-value", label: "52w", value: 3 },
      ],
    },
    decisionTrace: { engineVersion: "decision-trace-v9", brief: "w".repeat(3000) },
  };
}

describe("projectScanRowForMesaTransport", () => {
  it("recorta campos gordos y conserva filtro/tabla + screenPassed", () => {
    const projected = projectScanRowForMesaTransport(fatFullRow(), { omitChartPreview: true });
    expect(projected.symbol).toBe("FAT");
    expect(projected.price).toBe(42.5);
    expect(projected.screenPassed).toBe(true);
    expect(projected.rowProjection).toBe("full");
    expect(projected.chartPreview).toBeUndefined();
    expect(projected.setupDisplayLabel).toBe("Observar");
    expect(projected.weeklyStageStructureDetail).toBe("keep-structure-detail");
    for (const field of SCAN_LIGHT_EXCLUDED_FIELDS) {
      expect(projected[field]).toBeUndefined();
    }
    for (const field of MESA_TRANSPORT_OMIT_FIELDS) {
      expect(projected[field]).toBeUndefined();
    }
    expect(projected.signalCoverage).toBeUndefined();
    expect(projected.businessSummary).toBeUndefined();
    expect(projected.metricAuditFlags).toEqual({
      perf3m: "mismatch",
      distance52w: "unverified-value",
    });
  });

  it("omite strings vacíos y conserva null explícitos de RS", () => {
    const projected = projectScanRowForMesaTransport({
      symbol: "EMP",
      price: 1,
      setupDisplayLabel: "",
      screenRejectReason: "",
      weeklyStageLabel: "Etapa 2",
      weeklyCountryRsAvailable: false,
      weeklyCountryRsRating: null,
    }, { omitChartPreview: true });
    expect(projected.weeklyStageLabel).toBe("Etapa 2");
    expect("setupDisplayLabel" in projected).toBe(false);
    expect("screenRejectReason" in projected).toBe(false);
    expect(projected.weeklyCountryRsAvailable).toBe(false);
    expect(projected.weeklyCountryRsRating).toBeNull();
  });

  it("con omitChartPreview=false conserva miniatura compacta", () => {
    const projected = projectScanRowForMesaTransport(fatFullRow("SPK"), { omitChartPreview: false });
    expect(projected.chartPreview).toHaveLength(2);
    expect(projected.chartPreview[0]).toEqual({
      date: "2026-01-01",
      close: 10,
      sma50: 9,
      sma200: 8,
      volume: 1000,
    });
  });

  it("ahorra bytes medibles vs fila full sin preview", () => {
    const fat = fatFullRow("BYTES");
    const { chartPreview, ...deferredFat } = fat;
    const before = Buffer.byteLength(JSON.stringify(deferredFat));
    const after = Buffer.byteLength(JSON.stringify(
      projectScanRowForMesaTransport(fat, { omitChartPreview: true }),
    ));
    expect(before).toBeGreaterThan(15_000);
    expect(after).toBeLessThan(before * 0.35);
    expect(before - after).toBeGreaterThan(10_000);
  });

  it("MESA_TRANSPORT_OMIT_FIELDS son subconjunto de SCAN_LIGHT (no inventados)", () => {
    const light = new Set(SCAN_LIGHT_FIELDS);
    expect(MESA_TRANSPORT_OMIT_FIELDS.every((field) => light.has(field))).toBe(true);
  });
});

describe("scanFromDb · projectLightRow", () => {
  const scanMeta = {
    id: "cloud-1",
    local_id: "scan-1",
    name: "US",
    settings: {},
    row_count: 1,
  };

  it("compacto de mesa aplica allowlist light", () => {
    const scan = scanFromDb(scanMeta, [{
      scan_id: "cloud-1",
      rank_index: 1,
      symbol: "FAT",
      company_name: "Fat Corp",
      country: "US",
      sector: "Tech",
      industry: "Software",
      theme: "Software",
      raw: {
        symbol: "FAT",
        price: 42.5,
        chartBarsCount: 260,
        screenPassed: true,
        rowProjection: "full",
        businessSummary: "huge ".repeat(2000),
        growthMetrics: { revenueGrowth: 1 },
        setupDisplayEvidence: "omit-me ".repeat(50),
        chartPreview: [
          { date: "2026-01-01", close: 10, sma50: 9, sma200: 8, volume: 1 },
          { date: "2026-01-02", close: 11, sma50: 9.1, sma200: 8.1, volume: 2 },
        ],
      },
      metrics: { price: 42.5, screenPassed: true, rowProjection: "full" },
    }], {
      omitDecisionTrace: true,
      omitChartPreview: true,
      projectLightRow: true,
    });

    const row = scan.rows[0];
    expect(row.price).toBe(42.5);
    expect(row.screenPassed).toBe(true);
    expect(row.chartPreview).toBeUndefined();
    expect(row.businessSummary).toBeUndefined();
    expect(row.growthMetrics).toBeUndefined();
    expect(row.setupDisplayEvidence).toBeUndefined();
    expect(row.decisionTrace).toBeUndefined();
  });

  it("sin projectLightRow no recorta businessSummary (ruta full/legacy)", () => {
    const scan = scanFromDb(scanMeta, [{
      scan_id: "cloud-1",
      rank_index: 1,
      symbol: "FAT",
      raw: {
        symbol: "FAT",
        price: 10,
        businessSummary: "keep-me",
      },
      metrics: {},
    }], {
      omitDecisionTrace: true,
      omitChartPreview: true,
      projectLightRow: false,
    });
    expect(scan.rows[0].businessSummary).toBe("keep-me");
  });
});
