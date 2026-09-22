import { describe, expect, it } from "vitest";
import {
  measureProjectedFieldWeights,
  measureRowsJsonBytes,
  mesaTransportOmitFields,
  topProjectedFieldWeights,
} from "@/lib/screenerColdPayload";
import {
  MESA_TRANSPORT_OMIT_FIELDS,
  projectScanRowForMesaTransport,
} from "@/lib/scanLightProjection";

describe("screenerColdPayload · medición", () => {
  const rows = [
    { symbol: "A", price: 10, setupDisplayLabel: "Observar" },
    { symbol: "B", price: 20, weeklyStageLabel: "Etapa 2" },
  ];

  it("measureRowsJsonBytes cuenta el lote", () => {
    expect(measureRowsJsonBytes(rows)).toBe(Buffer.byteLength(JSON.stringify(rows)));
  });

  it("measureProjectedFieldWeights ordena por bytes desc", () => {
    const weights = measureProjectedFieldWeights(rows);
    expect(weights.length).toBeGreaterThan(1);
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i - 1].bytes).toBeGreaterThanOrEqual(weights[i].bytes);
    }
  });

  it("topProjectedFieldWeights respeta el límite", () => {
    expect(topProjectedFieldWeights(rows, 1)).toHaveLength(1);
  });

  it("mesaTransportOmitFields refleja MESA_TRANSPORT_OMIT_FIELDS", () => {
    expect(mesaTransportOmitFields()).toEqual(MESA_TRANSPORT_OMIT_FIELDS);
  });
});

describe("SCREENER-COLD-PAYLOAD-1 · omit narrativa setup", () => {
  it("omite setupDisplayReason y derivados del wire compacto", () => {
    const projected = projectScanRowForMesaTransport({
      symbol: "NARR",
      price: 1,
      setupDisplayLabel: "Observar",
      setupDisplayReason: "Narrativa larga ".repeat(40),
      setupDisplayConfidenceLabel: "Alta confianza",
      setupVerdictShortLabel: "VCP estricto",
      weeklyStageLabel: "Etapa 2",
    }, { omitChartPreview: true });

    expect(projected.setupDisplayLabel).toBe("Observar");
    expect(projected.setupDisplayReason).toBeUndefined();
    expect(projected.setupDisplayConfidenceLabel).toBeUndefined();
    expect(projected.setupVerdictShortLabel).toBeUndefined();
  });

  it("ahorra bytes medibles cuando setupDisplayReason está poblado", () => {
    const fat = {
      symbol: "FAT",
      price: 42,
      setupDisplayLabel: "Observar",
      setupDisplayReason: "x".repeat(4000),
      setupDisplayConfidenceLabel: "Alta",
      setupVerdictShortLabel: "VCP",
      weeklyStageLabel: "Etapa 2",
      screenPassed: true,
      rowProjection: "full",
    };
    const before = measureRowsJsonBytes([fat]);
    const after = measureRowsJsonBytes([projectScanRowForMesaTransport(fat, { omitChartPreview: true })]);
    expect(before - after).toBeGreaterThan(3000);
  });
});
