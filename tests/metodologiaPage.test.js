import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MetodologiaPage from "@/app/metodologia/page";
import DescriptiveStrip from "@/app/stock/[symbol]/DescriptiveStrip";
import { buildMetodologiaSections } from "@/lib/metodologiaContent";
import {
  DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS,
} from "@/lib/weeklyStageStructure";
import { DEFAULT_WEEKLY_STAGE_SETTINGS } from "@/lib/weeklyStage";
import { STAGE_HEALTH_WEIGHTS } from "@/lib/stageHealth";

describe("metodologia page", () => {
  it("renderiza las cuatro secciones clave", () => {
    const html = renderToStaticMarkup(React.createElement(MetodologiaPage));
    expect(html).toContain("Etapa semanal (Weinstein)");
    expect(html).toContain("Subestado estructural");
    expect(html).toContain("Sostén de la tendencia");
    expect(html).toContain("Salud de etapa");
    expect(html).toContain('id="salud"');
    expect(html).toContain('id="sosten"');
  });

  it("publica umbrales desde constantes del motor, no hardcodeados en JSX", () => {
    const html = renderToStaticMarkup(React.createElement(MetodologiaPage));
    expect(html).toContain(String(STAGE_HEALTH_WEIGHTS.persistence30));
    expect(html).toContain(String(DEFAULT_WEEKLY_STAGE_SETTINGS.flatPct));
    expect(html).toContain(String(DEFAULT_WEEKLY_STAGE_STRUCTURE_SETTINGS.box26MaxPct));
    expect(html).toContain("Salud 90/100");
  });

  it("buildMetodologiaSections expone pesos que suman 100", () => {
    const sections = buildMetodologiaSections();
    const health = sections.find((section) => section.id === "salud");
    expect(health?.weightSum).toBe(100);
    expect(health?.workedExample?.score).toBe(90);
  });
});

describe("ficha — enlace contextual a metodología", () => {
  it("enlaza Sostén y Salud a /metodologia", () => {
    const html = renderToStaticMarkup(React.createElement(DescriptiveStrip, {
      data: {
        stage: { weekly: { state: "stage2", flatPct: 2 } },
        chartBars: [{ date: "2026-09-04", close: 10, high: 11, low: 9, volume: 1000 }],
        perf3m: 5,
        perf6m: 12,
        upDownVolRatio: 1.3,
      },
    }));
    expect(html).toContain('href="/metodologia#sosten"');
    expect(html).toContain('href="/metodologia#salud"');
  });
});
