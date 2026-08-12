import { describe, expect, it } from "vitest";
import { chartQualityFromBrief, isDecisionGrade } from "@/lib/chartDataQuality";
import { UNAVAILABLE_CHART_PROVIDER, unavailableChartForSymbol } from "@/lib/estimatedBars";

// Regresión del fallo crítico: /stock/<ticker-inexistente> devolvía una ficha
// completa —precio, variación, fecha de cierre y veredicto de etapa— porque el
// fallback por fallo de proveedor fabricaba una serie de precios. El aviso de
// "datos estimados" no bastaba: el dato inventado no debe generarse.
describe("ausencia de serie · contrato de extremo a extremo", () => {
  it("el payload de ausencia no es decision-grade y no lleva precio", () => {
    const chart = unavailableChartForSymbol("ZZZZQQ", { range: "2A" }, new Error("Yahoo chart HTTP 404"));

    expect(isDecisionGrade(chart)).toBe(false);
    expect(chart.bars).toHaveLength(0);
    expect(chart.meta.regularMarketPrice).toBeNull();
  });

  it("el brief que declara ausencia se clasifica missing, no real ni estimated", () => {
    const quality = chartQualityFromBrief({
      bars: [],
      dataQuality: { freshness: { chartUnavailable: true } },
      chartProvider: UNAVAILABLE_CHART_PROVIDER,
    });

    expect(quality.status).toBe("missing");
    expect(quality.estimated).toBe(false);
    expect(quality.degraded).toBe(true);
  });

  it("bars vacío durante la carga NO se confunde con ausencia confirmada", () => {
    // Sin banderas explícitas del productor, un array vacío es "todavía no ha
    // llegado", no "no existe". Confundirlos pintaría el estado vacío en cada
    // carga inicial de la ficha.
    const quality = chartQualityFromBrief({ bars: [], dataQuality: { freshness: {} }, chartProvider: "Yahoo Finance" });

    expect(quality.status).toBe("real");
  });
});
