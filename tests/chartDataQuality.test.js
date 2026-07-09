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
import { assertDecisionGrade, chartQuality, isDecisionGrade } from "@/lib/chartDataQuality";
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
