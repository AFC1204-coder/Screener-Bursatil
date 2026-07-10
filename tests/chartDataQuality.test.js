// Tests de lib/chartDataQuality.js — normalización canónica del veredicto de
// calidad de una serie de gráfico.
//
// El contrato que se valida aquí es el punto de no-regresión crítico del
// feature de dataQuality: barras sintéticas (estimated) NUNCA deben colarse
// como decision-grade, sin importar por qué camino llegaron. Cuatro casos:
//   1. Payload real nuevo con dataQuality explícito (status:"real").
//   2. Payload legacy sin dataQuality → asume real.
//   3. Estimado marcado top-level (dataQuality.status:"estimated").
//   4. Estimado detectable solo por barras/provider, sin campo top-level.

import { describe, expect, it } from "vitest";
import { assertDecisionGrade, barsAreCandleGrade, chartQuality, isDecisionGrade } from "@/lib/chartDataQuality";
import { ESTIMATED_CHART_PROVIDER } from "@/lib/estimatedBars";

describe("chartQuality · normalización canónica", () => {
  it("payload real nuevo con dataQuality explícito → status real, decision-grade", () => {
    const json = {
      bars: [{ date: "2026-07-01", close: 100, estimated: false }],
      meta: { dataProvider: "Yahoo Finance", estimated: false },
      dataQuality: { status: "real", source: "provider" },
    };

    expect(chartQuality(json)).toMatchObject({
      status: "real",
      estimated: false,
      degraded: false,
      source: "provider",
    });
    expect(isDecisionGrade(json)).toBe(true);
    expect(() => assertDecisionGrade(json, "scoring")).not.toThrow();
  });

  it("payload legacy sin dataQuality → asume status real (mercado real)", () => {
    const json = {
      bars: [{ date: "2026-07-01", close: 100 }],
      meta: { dataProvider: "Yahoo Finance" },
      // sin dataQuality
    };

    expect(chartQuality(json).status).toBe("real");
    expect(chartQuality(json).estimated).toBe(false);
    expect(isDecisionGrade(json)).toBe(true);
  });

  it("estimado marcado top-level (dataQuality.status estimated) → no decision-grade", () => {
    const json = {
      bars: [{ date: "2026-07-01", close: 100, estimated: true }],
      meta: { dataProvider: ESTIMATED_CHART_PROVIDER, estimated: true },
      dataQuality: {
        status: "estimated",
        estimated: true,
        degraded: true,
        reason: "timeout del proveedor",
        fallbackError: "timeout del proveedor",
      },
    };

    const q = chartQuality(json);
    expect(q.status).toBe("estimated");
    expect(q.estimated).toBe(true);
    expect(q.degraded).toBe(true);
    expect(q.reason).toContain("timeout");
    expect(isDecisionGrade(json)).toBe(false);
    expect(() => assertDecisionGrade(json, "scoring")).toThrow(/Serie estimada excluida de scoring/);
  });

  it("estimado detectable solo por barras/provider, sin dataQuality → degradado a estimated", () => {
    // Legacy sin campo top-level, PERO las barras delatan que es sintético.
    const byBars = {
      bars: [{ date: "2026-07-01", close: 100, estimated: true }],
      meta: { dataProvider: "Yahoo Finance" },
    };
    expect(chartQuality(byBars).status).toBe("estimated");
    expect(isDecisionGrade(byBars)).toBe(false);

    const byProvider = {
      bars: [{ date: "2026-07-01", close: 100 }],
      meta: { dataProvider: ESTIMATED_CHART_PROVIDER },
    };
    expect(chartQuality(byProvider).status).toBe("estimated");
    expect(isDecisionGrade(byProvider)).toBe(false);

    const byMetaEstimated = {
      bars: [{ date: "2026-07-01", close: 100 }],
      meta: { estimated: true },
    };
    expect(chartQuality(byMetaEstimated).status).toBe("estimated");
  });
});

// barsAreCandleGrade evita que un fallback de preview close-only (p.ej. el
// chartPreview persistido en review, que guarda {date, close, volume, sma50,
// sma200}) se renderice como velas degeneradas cuando el fetch remoto de OHLC
// real falla por red. Es la pieza testeable que decide si UniversalPriceChart
// cae al estado empty limpio en lugar de pintar datos visualmente rotos.
describe("barsAreCandleGrade · barras aptas para velas coherentes", () => {
  it("barras OHLC nativas (high o low != close) → true", () => {
    const bars = [
      { date: "2026-07-01", open: 100, high: 105, low: 98, close: 102 },
      { date: "2026-07-02", open: 102, high: 104, low: 99, close: 101 },
    ];
    expect(barsAreCandleGrade(bars)).toBe(true);
  });

  it("barras close-only ({close} sin OHLC) → false (preview degenerado)", () => {
    // Shape exacta del chartPreview persistido en review (chartPreviewFromBars).
    const bars = [
      { date: "2026-07-01", close: 100, volume: 1000, sma50: 99, sma200: 98 },
      { date: "2026-07-02", close: 101, volume: 1100, sma50: 99.5, sma200: 98.2 },
    ];
    expect(barsAreCandleGrade(bars)).toBe(false);
  });

  it("barras con OHLC degenerado a close (open=high=low=close) → false", () => {
    // normalizeRows (UniversalPriceChart) expande close-only a este shape
    // degenerado; barsAreCandleGrade debe detectarlo como NO candle-grade.
    const bars = [
      { date: "2026-07-01", open: 100, high: 100, low: 100, close: 100 },
      { date: "2026-07-02", open: 101, high: 101, low: 101, close: 101 },
    ];
    expect(barsAreCandleGrade(bars)).toBe(false);
  });

  it("basta una sola barra con rango real para considerar el conjunto candle-grade", () => {
    // .some: una barra con OHLC real salva el render aunque otras sean degeneradas.
    const bars = [
      { date: "2026-07-01", open: 100, high: 100, low: 100, close: 100 },
      { date: "2026-07-02", open: 101, high: 103, low: 100, close: 102 },
    ];
    expect(barsAreCandleGrade(bars)).toBe(true);
  });

  it("array vacío o no-array → false", () => {
    expect(barsAreCandleGrade([])).toBe(false);
    expect(barsAreCandleGrade(null)).toBe(false);
    expect(barsAreCandleGrade(undefined)).toBe(false);
  });

  it("barras con OHLC no numérico → false (datos corruptos)", () => {
    const bars = [
      { date: "2026-07-01", open: "n/a", high: 105, low: 98, close: 102 },
      { date: "2026-07-02", open: 102, high: "n/a", low: 99, close: 101 },
    ];
    expect(barsAreCandleGrade(bars)).toBe(false);
  });
});
