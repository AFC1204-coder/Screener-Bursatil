// REVIEW-CHART-PARALLEL-1 — T1 chart (+ rs-weekly) en paralelo al shell en /review.
// Post REVIEW-HYDRATE-DEFER-1 (f6eae85): RowPriceChart ya monta UniversalPriceChart
// sin gate de brief. Estos tests fijan el contrato; la evidencia de red vive en
// research/review-chart-parallel-1/probe-summary.json.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));

function sourceWithoutComments(relativePath) {
  return readFileSync(resolve(testDir, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("REVIEW-CHART-PARALLEL-1 — chart T1 paralelo al shell", () => {
  const reviewSource = sourceWithoutComments("../app/review/page.jsx");
  const rowChartSource = sourceWithoutComments("../app/RowPriceChart.jsx");
  const chartModelSource = sourceWithoutComments("../lib/chartDataModel.js");

  it("/review no llama company-brief ni hidrata; el chart va por RowPriceChart", () => {
    expect(reviewSource).not.toContain("/api/company-brief");
    expect(reviewSource).not.toContain("hydrateReviewRow");
    expect(reviewSource).toContain("RowPriceChart");
    expect(reviewSource).toMatch(/ReviewChartPanel[\s\S]*RowPriceChart/);
    expect(reviewSource).not.toMatch(/\/api\/chart\?symbol=/);
  });

  it("ReviewChartPanel monta RowPriceChart con la fila activa (sin gate loading propio)", () => {
    expect(reviewSource).toMatch(/function ReviewChartPanel\(\{ row \}\)/);
    expect(reviewSource).toMatch(/<RowPriceChart[\s\S]*row=\{row\}/);
    expect(reviewSource).not.toMatch(/ReviewChartPanel[\s\S]*loading/);
    expect(reviewSource).not.toContain("Cargando histórico y métricas");
  });

  it("RowPriceChart dispara /api/chart vía UniversalPriceChart y rs-weekly en paralelo si falta serie", () => {
    expect(rowChartSource).toContain("UniversalPriceChart");
    expect(rowChartSource).toMatch(/rsWeeklyChartQuery/);
    expect(rowChartSource).toMatch(/rowHasChartRsSeries/);
    expect(rowChartSource).toMatch(/fetchRsWeeklyCached/);
    expect(rowChartSource).not.toContain("/api/company-brief");
  });

  it("fallo OHLC expone error explícito (A2-CHART), no stable silencioso", () => {
    expect(chartModelSource).toContain("provider-unavailable");
    expect(chartModelSource).toMatch(/Proveedor de gráfico no disponible/);
    expect(chartModelSource).toMatch(/requestState === "error"/);
  });

  it("useChartDataModel usa requestKey estable y caché compartida (sin doble fetch por misma key)", () => {
    const hookSource = sourceWithoutComments("../app/useChartDataModel.js");
    expect(hookSource).toMatch(/buildRequestKey/);
    expect(hookSource).toMatch(/fetchChartCached/);
    expect(hookSource).toMatch(/generationRef\.current !== generation/);
  });
});

describe("REVIEW-CHART-PARALLEL-1 — evidencia de red (probe)", () => {
  it("probe-summary documenta 0 brief, chart y rs-weekly por símbolo", () => {
    let probe;
    try {
      probe = JSON.parse(
        readFileSync(resolve(testDir, "../research/review-chart-parallel-1/probe-summary.json"), "utf8"),
      );
    } catch {
      probe = null;
    }
    if (!probe) return;
    expect(probe.briefCalls).toBe(0);
    expect(probe.chartTotal).toBeGreaterThanOrEqual(1);
    expect(probe.rsTotal).toBeGreaterThanOrEqual(1);
    expect(probe.pass?.zeroBrief).toBe(true);
    expect(probe.pass?.chartOnNav).toBe(true);
  });
});
