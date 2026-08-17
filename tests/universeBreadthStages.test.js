// La distribución por etapas de «Amplitud del universo» no enseña como cero
// lo que el criterio anterior no podía medir: un escaneo con filas
// «base»/«mixed» viene del clasificador viejo, donde las etapas 1 y 3 no
// existían — mostrarlas a 0% junto a un 32% de «Base» afirmaría que nadie
// construye suelo ni techo, que es una medición que ese escaneo no hizo.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UniverseBreadthCard from "@/app/market-health/UniverseBreadth";

function cardHtml(stages) {
  return renderToStaticMarkup(React.createElement(UniverseBreadthCard, {
    breadth: {
      population: 3312,
      scan: { createdAt: "2026-08-17T04:01:37Z" },
      dataAsOf: "2026-08-14",
      staleRows: 0,
      indicators: [],
      stages,
    },
    loading: false,
  }));
}

describe("UniverseBreadth — distribución por etapas con escaneo del criterio anterior", () => {
  const legacyStages = {
    available: true,
    measured: 3267,
    population: 3312,
    unclassified: 45,
    buckets: [
      { key: "stage1", label: "Etapa 1", count: 0, pct: 0 },
      { key: "stage2", label: "Etapa 2", count: 1207, pct: 36.9 },
      { key: "stage3", label: "Etapa 3", count: 0, pct: 0 },
      { key: "stage4", label: "Etapa 4", count: 655, pct: 20 },
      { key: "base", label: "Base / transición (criterio anterior)", count: 1032, pct: 31.6 },
      { key: "mixed", label: "Mixta / débil (criterio anterior)", count: 373, pct: 11.4 },
    ],
  };

  it("con filas legacy, las etapas no medibles (1 y 3 a cero) no aparecen y el motivo se declara", () => {
    const html = cardHtml(legacyStages);
    expect(html).not.toContain("Etapa 1");
    expect(html).not.toContain("Etapa 3");
    expect(html).toContain("Etapa 2");
    expect(html).toContain("Etapa 4");
    expect(html).toContain("criterio anterior");
    expect(html).toContain("no existían y no se");
  });

  it("con un escaneo del criterio vigente, las cuatro etapas se muestran aunque alguna sea cero", () => {
    const freshStages = {
      available: true,
      measured: 3300,
      population: 3312,
      unclassified: 12,
      buckets: [
        { key: "stage1", label: "Etapa 1", count: 400, pct: 12.1 },
        { key: "stage2", label: "Etapa 2", count: 1500, pct: 45.5 },
        { key: "stage3", label: "Etapa 3", count: 0, pct: 0 },
        { key: "stage4", label: "Etapa 4", count: 1400, pct: 42.4 },
      ],
    };
    const html = cardHtml(freshStages);
    expect(html).toContain("Etapa 1");
    expect(html).toContain("Etapa 3");
    expect(html).not.toContain("no existían y no se");
  });
});
