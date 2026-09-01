import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER_LAYERS } from "@/lib/screenerFilterCatalog";
import { effectiveSettingsFromLayers } from "@/lib/screenerFilterLayers";
import { applyScreenerFilters, screenerFilterRejectReason } from "@/lib/screenerFilters";

function vcpRow(overrides = {}) {
  return {
    symbol: "VCP1",
    patternDataStatus: "ok",
    patternEligible: true,
    patternVolumeEligible: true,
    contractionStructureStatus: "ok",
    weeklyStageState: "stage2",
    weeklyStageLabel: "Stage 2",
    weeklyStageStructure: "E2_structural",
    contractionCount: 2,
    lastContractionDepthPct: 8,
    distanceToPivotPct: -2,
    volumeDryUpRatio: 0.8,
    vcpCandidate: true,
    ...overrides,
  };
}

const minerviniSettings = effectiveSettingsFromLayers(
  {
    requireVcpCandidate: true,
    vcpRequireStage2: true,
    vcpMinContractionCount: 2,
    vcpMaxLastContractionDepthPct: 12,
    vcpMinDistanceToPivotPct: -8,
    vcpMaxDistanceToPivotPct: 3,
    vcpMaxVolumeDryUpRatio: 1,
  },
  { ...DEFAULT_FILTER_LAYERS, vcp: true },
);

const formingSettings = effectiveSettingsFromLayers(
  {
    requireVcpCandidate: false,
    vcpMinContractionCount: 2,
    vcpMaxLastContractionDepthPct: 12,
  },
  { ...DEFAULT_FILTER_LAYERS, vcp: true },
);

describe("filtros VCP (familia vcp)", () => {
  it("familia vcp off por defecto neutraliza reglas", () => {
    const effective = effectiveSettingsFromLayers(
      { requireVcpCandidate: true, vcpMinContractionCount: 2 },
      DEFAULT_FILTER_LAYERS,
    );
    expect(effective.requireVcpCandidate).toBe(false);
    expect(effective.vcpMinContractionCount).toBe(0);
    expect(screenerFilterRejectReason(vcpRow(), effective)).toBe("");
  });

  it("preset Minervini pasa fila candidata y rechaza sin candidato", () => {
    expect(screenerFilterRejectReason(vcpRow(), minerviniSettings)).toBe("");
    expect(screenerFilterRejectReason(vcpRow({ vcpCandidate: false }), minerviniSettings)).toMatchObject({
      field: "requireVcpCandidate",
    });
  });

  it("≥2 contracciones reduce filas comprensiblemente", () => {
    const { rows, rejections } = applyScreenerFilters(
      [vcpRow(), vcpRow({ symbol: "LOWC", contractionCount: 1 })],
      { enabled: true, values: formingSettings },
    );
    expect(rows.map((r) => r.symbol)).toEqual(["VCP1"]);
    expect(rejections[0].field).toBe("vcpMinContractionCount");
  });

  it("en formación no exige vcpCandidate", () => {
    expect(screenerFilterRejectReason(vcpRow({ vcpCandidate: false }), formingSettings)).toBe("");
  });

  it("rechaza última contracción demasiado profunda", () => {
    const reason = screenerFilterRejectReason(
      vcpRow({ lastContractionDepthPct: 18 }),
      minerviniSettings,
    );
    expect(reason).toMatchObject({ field: "vcpMaxLastContractionDepthPct" });
  });
});
