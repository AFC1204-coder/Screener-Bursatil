// tests/marketVolume.test.js — la agregación de los cuatro indicadores de
// volumen sobre el escaneo nocturno. Funciones puras: filas de scan_results
// → estructura con disponibilidad por indicador.
//
// Documento de origen: docs/diseno-indicadores-mercado-2026-08-17.md, C.3.
import { describe, expect, it } from "vitest";
import {
  aggregateVolumeIndicators,
  MARKET_VOLUME_MIN_COVERAGE_PCT,
  volumeFactLine,
} from "@/lib/marketVolume";

function row(overrides = {}) {
  return {
    symbol: "AAA",
    country: "US",
    upDownVolRatio: 1.2,
    volumeDryUpRatio: 0.9,
    volumeSurgePct: 10,
    avgVolume: 1000000,
    latestVolume: 1100000,
    lastDate: "2026-08-14",
    ...overrides,
  };
}

describe("aggregateVolumeIndicators", () => {
  it("cuenta los cuatro KPIs sobre la población medida y declara la fecha del dato", () => {
    const rows = [
      row(),
      // upDownVolRatio < 1 → no cuenta en upDownVolumeRatio; sí en volumeDryUp (< 1)
      row({ symbol: "BBB", upDownVolRatio: 0.7, volumeDryUpRatio: 0.95, volumeSurgePct: 4 }),
      // upDownVolRatio >= 1.25 y surge >= 15
      row({ symbol: "CCC", upDownVolRatio: 1.4, volumeDryUpRatio: 1.2, volumeSurgePct: 28 }),
      // Sin dato: la cobertura la cuenta, no la fila
      row({ symbol: "DDD", upDownVolRatio: null, volumeDryUpRatio: null, volumeSurgePct: null }),
    ];
    const volume = aggregateVolumeIndicators(rows);
    expect(volume.population).toBe(4);
    expect(volume.dataAsOf).toBe("2026-08-14");
    expect(volume.staleRows).toBe(0);
    // AAA y CCC con upDownVolRatio >= 1 (count=2 de 3 medidos)
    const upDown = volume.indicators.upDownVolumeRatio;
    expect(upDown.count).toBe(2);
    expect(upDown.measured).toBe(3);
    expect(upDown.population).toBe(4);
    expect(upDown.pct).toBeCloseTo((2 / 3) * 100, 4);
    expect(upDown.available).toBe(true);
    // participationUp: count >= 1.25 → solo CCC
    const participationUp = volume.indicators.participationUp;
    expect(participationUp.count).toBe(1);
    expect(participationUp.measured).toBe(3);
    // volumeDryUp: < 1 → AAA (0.9) y BBB (0.95), 2 de 3; CCC (1.2) no
    const dryUp = volume.indicators.volumeDryUp;
    expect(dryUp.count).toBe(2);
    expect(dryUp.measured).toBe(3);
    // volumeSurge: >= 15 → solo CCC
    const surge = volume.indicators.volumeSurge;
    expect(surge.count).toBe(1);
    expect(surge.measured).toBe(3);
    // Media de upDownVolRatio: (1.2 + 0.7 + 1.4) / 3 = 1.1
    expect(volume.upDownMean).toBeCloseTo(1.1, 5);
    // Conteo bajo 1
    expect(volume.upDownBelow).toBe(1);
    expect(volume.upDownAbove).toBe(2);
  });

  it("declara ausente el KPI si la cobertura cae por debajo del 60%", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row({
      symbol: `S${index}`,
      // Solo 5 de 10 con upDownVolRatio sabido
      upDownVolRatio: index < 5 ? 1.1 : null,
      volumeDryUpRatio: 1.0,
      volumeSurgePct: 5,
    }));
    const volume = aggregateVolumeIndicators(rows);
    const upDown = volume.indicators.upDownVolumeRatio;
    expect(upDown.measured).toBe(5);
    expect(upDown.coveragePct).toBe(50);
    expect(upDown.available).toBe(false);
    expect(upDown.pct).toBe(null);
    expect(upDown.count).toBe(null);
    expect(upDown.reason).toContain(`${MARKET_VOLUME_MIN_COVERAGE_PCT}%`);
    // El resto, con cobertura 100%, sigue disponible
    expect(volume.indicators.volumeDryUp.available).toBe(true);
  });

  it("declara ausente si el campo viene explícitamente a null con cobertura < 60%", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row({
      symbol: `S${index}`,
      upDownVolRatio: 1.0,
      volumeDryUpRatio: index < 4 ? 0.9 : null,
      volumeSurgePct: 10,
    }));
    const volume = aggregateVolumeIndicators(rows);
    const dryUp = volume.indicators.volumeDryUp;
    expect(dryUp.measured).toBe(4);
    expect(dryUp.available).toBe(false);
  });

  it("acepta filas con metrics anidado (compatibilidad con consumo alternativo)", () => {
    const rows = [
      { symbol: "AAA", metrics: { upDownVolRatio: 1.5, volumeDryUpRatio: 0.8, volumeSurgePct: 20 }, lastDate: "2026-08-14" },
      { symbol: "BBB", metrics: { upDownVolRatio: 0.9, volumeDryUpRatio: 1.1, volumeSurgePct: 5 }, lastDate: "2026-08-14" },
    ];
    const volume = aggregateVolumeIndicators(rows);
    expect(volume.indicators.upDownVolumeRatio.count).toBe(1);
    expect(volume.indicators.volumeDryUp.count).toBe(1);
    expect(volume.indicators.volumeSurge.count).toBe(1);
  });

  it("cuenta filas con lastDate anterior a la fecha del dato como staleRows", () => {
    const rows = [
      row({ symbol: "AAA", lastDate: "2026-08-14" }),
      row({ symbol: "OLD", lastDate: "2026-08-01" }),
    ];
    const volume = aggregateVolumeIndicators(rows);
    expect(volume.dataAsOf).toBe("2026-08-14");
    expect(volume.staleRows).toBe(1);
  });

  it("las etiquetas de umbral y ventana describen cada KPI", () => {
    const rows = [row()];
    const volume = aggregateVolumeIndicators(rows);
    expect(volume.indicators.upDownVolumeRatio.windowLabel).toBe("50 sesiones");
    expect(volume.indicators.upDownVolumeRatio.thresholdLabel).toBe("up/down >= 1×");
    expect(volume.indicators.volumeDryUp.windowLabel).toBe("10 vs 50 sesiones");
    expect(volume.indicators.volumeSurge.windowLabel).toBe("5 vs 20 sesiones");
    expect(volume.indicators.volumeSurge.thresholdLabel).toBe("media 5 / media 20 ≥ +15%");
  });
});

describe("volumeFactLine", () => {
  it("genera una línea de hecho con la media y la ventana, sin recomendar exposición", () => {
    const volume = aggregateVolumeIndicators([
      row({ upDownVolRatio: 1.5 }),
      row({ symbol: "EEE", upDownVolRatio: 1.2, volumeDryUpRatio: 0.7, volumeSurgePct: 30 }),
    ]);
    const fact = volumeFactLine(volume);
    expect(fact).not.toBe(null);
    expect(fact.text).toContain("50 sesiones");
    expect(fact.text).toContain("media");
    expect(fact.text).toContain("más volumen en sesiones de subida");
    expect(fact.window).toBe("50 sesiones");
    expect(fact.dataAsOf).toBe("2026-08-14");
  });

  it("devuelve null si el indicador no está disponible", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row({
      symbol: `S${index}`,
      upDownVolRatio: index < 3 ? 1.1 : null,
    }));
    const volume = aggregateVolumeIndicators(rows);
    expect(volumeFactLine(volume)).toBe(null);
  });
});
