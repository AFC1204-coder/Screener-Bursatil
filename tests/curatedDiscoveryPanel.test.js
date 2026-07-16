import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { curatedDiscoveryReadState, renderCuratedDiscoveryView } from "@/app/components/screener/CuratedDiscoveryPanel";

function text(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function render(props) {
  return renderToStaticMarkup(React.createElement(renderCuratedDiscoveryView, props));
}

describe("CuratedDiscoveryPanel · disclosure F-A3", () => {
  it("con candidatas batch muestra título, estrategia, muestra parcial, scope y no-comparabilidad", () => {
    const html = render({
      leaderboard: {
        strategy: "momentum",
        strategyLabel: "Momentum",
        items: [
          { rank: 1, symbol: "AAA", companyName: "Alpha", country: "US", lastDate: "2026-07-14", percentileScope: "batch" },
          { rank: 2, symbol: "BBB", companyName: "Beta", country: "ES", lastDate: "2026-07-12", percentileScope: "batch" },
        ],
      },
    });
    const visible = text(html);

    expect(visible).toContain("Descubrimiento global curado");
    expect(visible).toContain("Muestra parcial");
    expect(visible).toContain("No es un ranking global comparable");
    expect(visible).toContain("Estrategia activa Momentum");
    expect(visible).toContain("Mercados incluidos ES · US");
    expect(visible).toContain("Dato más antiguo: 2026-07-12");
    expect(visible).toContain("percentil por lote");
    expect(visible).toContain("no es RS global");
    expect(html).not.toContain("rsGlobalPct");
  });

  it("sin candidatas explica el estado vacío sin afirmar fallo", () => {
    const visible = text(render({ leaderboard: { strategyLabel: "Momentum", items: [] } }));

    expect(visible).toContain("Sin candidatas curadas publicables todavía");
    expect(visible).toContain("no implica un fallo del sistema");
    expect(visible).toContain("No es un ranking global comparable");
  });

  it("payload degradado con leaderboard vacío muestra indisponibilidad, no ausencia de candidatas", () => {
    const payload = { degraded: true, source: "scan_results_unavailable", configured: true, leaderboard: { items: [] } };
    const visible = text(render({ leaderboard: payload.leaderboard, unavailable: curatedDiscoveryReadState(payload) === "unavailable" }));

    expect(curatedDiscoveryReadState(payload)).toBe("unavailable");
    expect(visible).toContain("No se puede confirmar la disponibilidad de candidatas curadas ahora");
    expect(visible).toContain("No es un ranking global comparable");
    expect(visible).not.toContain("Sin candidatas curadas publicables todavía");
  });

  it("configured=false se trata como lectura no disponible", () => {
    const payload = { configured: false, leaderboard: { items: [] } };
    const visible = text(render({ leaderboard: payload.leaderboard, unavailable: curatedDiscoveryReadState(payload) === "unavailable" }));

    expect(curatedDiscoveryReadState(payload)).toBe("unavailable");
    expect(visible).toContain("La cobertura por mercado se mantiene como contexto independiente");
    expect(visible).not.toContain("Sin candidatas curadas publicables todavía");
  });

  it("error HTTP o de red usa un estado distinto de la degradación", () => {
    const visible = text(render({ error: "network" }));

    expect(visible).toContain("No se pudo leer la disponibilidad de candidatas curadas");
    expect(visible).toContain("No es un ranking global comparable");
    expect(visible).not.toContain("No se puede confirmar la disponibilidad");
  });

  it("con datos incompletos declara las ausencias sin inventar mercados ni frescura", () => {
    const visible = text(render({
      leaderboard: {
        strategyLabel: "Momentum",
        items: [{ rank: 1, symbol: "UNKNOWN", companyName: "Unknown", percentileScope: "batch" }],
      },
    }));

    expect(visible).toContain("Mercados incluidos No disponible en estas filas");
    expect(visible).toContain("Frescura No disponible en estas filas");
    expect(visible).not.toContain("Dato más antiguo:");
  });

  it("no lista una fila final bajo la etiqueta de muestra parcial", () => {
    const visible = text(render({
      leaderboard: {
        strategyLabel: "Momentum",
        items: [
          { rank: 1, symbol: "BATCH", companyName: "Batch", percentileScope: "batch" },
          { rank: 2, symbol: "FINAL", companyName: "Final", percentileScope: "final" },
        ],
      },
    }));

    expect(visible).toContain("Muestra parcial");
    expect(visible).toContain("BATCH");
    expect(visible).not.toContain("FINAL");
  });
});
