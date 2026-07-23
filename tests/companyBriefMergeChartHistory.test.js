// Tests de mergeChartHistory (app/api/company-brief/route.js).
//
// Regresion P0 de integridad de datos: cuando longChart (historico largo,
// tipicamente servido desde cache) es real pero recentChart (ventana reciente,
// que depende de fetch en vivo) cae en fallback sintetico por presupuesto
// agotado o caida del proveedor, el chart fusionado mezcla barras reales
// antiguas con barras fabricadas recientes. Antes de este fix, el flag
// `estimated` del recentChart se perdia en la fusion (mergeChartHistory heredaba
// solo de longChart.meta), de modo que las velas mas recientes —las que un
// trader mira primero para timing de entrada— aparecian como datos reales sin
// serlo. Eso alimenta el riesgo "synthetic data undetected on decision
// surfaces" cerrado parcialmente en bae94f4 / 5fe4bea, pero alli el flag se
// asume bien calculado; aqui es donde nace mal calculado, antes de esa logica.
//
// El fix hace de `estimated` una union logica (OR) entre las dos fuentes, en
// ambos portadores que aguas abajo inspecciona chartEstimated (linea ~1360):
// meta.estimated y dataQuality.estimated.

import { describe, expect, it } from "vitest";
import { ESTIMATED_CHART_PROVIDER } from "@/lib/estimatedBars";
import { mergeChartHistory } from "@/app/api/company-brief/route";

const realBar = (date, close) => ({ date, open: close, close, high: close + 1, low: close - 1, volume: 1000 });
const estimatedBar = (date, close) => ({ ...realBar(date, close), estimated: true });

describe("mergeChartHistory · propagacion del flag estimated", () => {
  it("longChart real + recentChart estimado (meta.estimated) → chart fusionado estimado", () => {
    // longChart real: historico largo limpio, sin flag estimated.
    const longChart = {
      bars: [realBar("2024-01-02", 100), realBar("2024-06-03", 120)],
      meta: { dataProvider: "Yahoo Finance", requestedRange: "MAX" },
    };
    // recentChart sintetico: ventanas recientes fabricadas por estimatedChartForSymbol.
    const recentChart = {
      ok: false,
      bars: [estimatedBar("2026-07-15", 180), estimatedBar("2026-07-16", 182)],
      meta: {
        dataProvider: ESTIMATED_CHART_PROVIDER,
        requestedRange: "5A",
        requestedInterval: "D",
        estimated: true,
      },
      dataQuality: { status: "estimated", estimated: true, degraded: true, source: "estimator" },
    };

    const merged = mergeChartHistory(longChart, recentChart);

    // Nucleo de la regresion: el flag debe llegar true pese a que longChart era real.
    expect(merged.meta.estimated).toBe(true);
    // Y por el segundo portador que chartEstimated tambien inspecciona.
    expect(merged.dataQuality?.estimated).toBe(true);
    // Las barras de ambas fuentes se conservan (mergeLongAndRecentBars sin tocar).
    expect(merged.bars.map((b) => b.date)).toEqual(["2026-07-16", "2026-07-15", "2024-06-03", "2024-01-02"]);
  });

  it("longChart real + recentChart estimado solo via dataQuality.estimated (sin meta.estimated) → sigue estimado", () => {
    // Cubre el caso en que el estimado llega unicamente por el portador dataQuality
    // (objeto separado de meta), que antes tambien se perdia al hacer ...longChart.
    const longChart = {
      bars: [realBar("2024-01-02", 100)],
      meta: { dataProvider: "Yahoo Finance" },
    };
    const recentChart = {
      bars: [estimatedBar("2026-07-16", 182)],
      meta: { dataProvider: ESTIMATED_CHART_PROVIDER, requestedRange: "5A" },
      dataQuality: { status: "estimated", estimated: true },
    };

    const merged = mergeChartHistory(longChart, recentChart);

    expect(merged.meta.estimated).toBe(true);
    expect(merged.dataQuality?.estimated).toBe(true);
  });

  it("ambas fuentes reales → NO se marca estimado y no se inyecta dataQuality espurio", () => {
    // Happy path: no se debe alterar el shape de un chart 100% real.
    const longChart = {
      bars: [realBar("2024-01-02", 100)],
      meta: { dataProvider: "Yahoo Finance", requestedRange: "MAX" },
    };
    const recentChart = {
      bars: [realBar("2026-07-16", 182)],
      meta: { dataProvider: "Yahoo Finance", requestedRange: "5A", requestedInterval: "D" },
    };

    const merged = mergeChartHistory(longChart, recentChart);

    expect(merged.meta.estimated).toBe(false);
    // longChart y recentChart reales no llevan dataQuality: no debe aparecer.
    expect(merged.dataQuality).toBeUndefined();
  });

  it("longChart estimado + recentChart real → sigue estimado (OR en ambas direcciones)", () => {
    const longChart = {
      bars: [estimatedBar("2024-01-02", 100)],
      meta: { dataProvider: ESTIMATED_CHART_PROVIDER, estimated: true },
      dataQuality: { status: "estimated", estimated: true },
    };
    const recentChart = {
      bars: [realBar("2026-07-16", 182)],
      meta: { dataProvider: "Yahoo Finance", requestedRange: "5A", requestedInterval: "D" },
    };

    const merged = mergeChartHistory(longChart, recentChart);

    expect(merged.meta.estimated).toBe(true);
    expect(merged.dataQuality?.estimated).toBe(true);
  });

  it("recentChart vacio/ausente → preserva el flag estimado del longChart", () => {
    const longChart = {
      bars: [estimatedBar("2024-01-02", 100)],
      meta: { dataProvider: ESTIMATED_CHART_PROVIDER, estimated: true },
      dataQuality: { status: "estimated", estimated: true },
    };

    const merged = mergeChartHistory(longChart, {});

    expect(merged.meta.estimated).toBe(true);
    expect(merged.dataQuality?.estimated).toBe(true);
  });
});
