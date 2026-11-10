import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HuntPeekPanel from "@/app/components/screener/HuntPeekPanel";
import HuntTapeView from "@/app/components/screener/HuntTapeView";
import {
  huntPeekChartPaths,
  huntPeekInclusion,
  huntPeekStageDot,
  huntTapePeekKeyAction,
} from "@/lib/screenerHuntTape";
import { HUNT_EMPTY_ACTIONS, HuntTapeEmpty, resolveHuntEmptyState } from "@/lib/screenerHuntTapeEmpty";
import { screenerEmptyFilterText } from "@/lib/dataAge";

function weeklyBars(n = 60) {
  const out = [];
  const start = Date.UTC(2025, 0, 6);
  for (let i = 0; i < n; i += 1) {
    out.push({ date: new Date(start + i * 7 * 86400000).toISOString().slice(0, 10), close: 100 + i });
  }
  return out;
}

const ROW = {
  symbol: "NVRA",
  companyName: "Novara Therapeutics",
  price: 142.3,
  currency: "USD",
  lastDate: "2026-10-15",
  weeklyStageState: "stage2",
  weeklyStageWeek: 10,
  distance52w: -5.9,
  marketCap: 6.6e9,
  theme: "Medtech / biotech",
  chartPreview: weeklyBars(60),
};

describe("Paso 7 · teclas del panel lateral", () => {
  const list = { tagName: "UL", getAttribute: () => null };
  const button = { tagName: "BUTTON", getAttribute: () => null };
  const input = { tagName: "INPUT", getAttribute: () => null };

  it("Space alterna, → abre, ← y Esc cierran", () => {
    expect(huntTapePeekKeyAction({ key: " ", target: list, peekOpen: false, rowCount: 3 })).toBe("toggle");
    expect(huntTapePeekKeyAction({ key: " ", target: list, peekOpen: true, rowCount: 3 })).toBe("toggle");
    expect(huntTapePeekKeyAction({ key: "ArrowRight", target: list, peekOpen: false, rowCount: 3 })).toBe("open");
    expect(huntTapePeekKeyAction({ key: "ArrowRight", target: list, peekOpen: true, rowCount: 3 })).toBe(null);
    expect(huntTapePeekKeyAction({ key: "ArrowLeft", target: list, peekOpen: true, rowCount: 3 })).toBe("close");
    expect(huntTapePeekKeyAction({ key: "Escape", target: list, peekOpen: true, rowCount: 3 })).toBe("close");
  });

  it("no roba Esc, Enter ni j/k cuando el panel está cerrado", () => {
    expect(huntTapePeekKeyAction({ key: "Escape", target: list, peekOpen: false, rowCount: 3 })).toBe(null);
    expect(huntTapePeekKeyAction({ key: "ArrowLeft", target: list, peekOpen: false, rowCount: 3 })).toBe(null);
    for (const key of ["Enter", "j", "k", "ArrowDown", "ArrowUp"]) {
      expect(huntTapePeekKeyAction({ key, target: list, peekOpen: true, rowCount: 3 })).toBe(null);
    }
  });

  it("Space sobre un botón o un campo sigue siendo del control; sin filas no actúa", () => {
    expect(huntTapePeekKeyAction({ key: " ", target: button, peekOpen: false, rowCount: 3 })).toBe(null);
    expect(huntTapePeekKeyAction({ key: " ", target: input, peekOpen: false, rowCount: 3 })).toBe(null);
    expect(huntTapePeekKeyAction({ key: " ", target: list, peekOpen: false, rowCount: 0 })).toBe(null);
  });
});

describe("Paso 7 · contenido del panel (sin peticiones)", () => {
  it("MM30 sobre toda la serie: sin media parcial y solo 52 puntos de cierre", () => {
    const paths = huntPeekChartPaths(weeklyBars(60));
    expect(paths.hasMa).toBe(true);
    expect(paths.pricePath.match(/[ML]/g)).toHaveLength(52);
    // 60 barras → la MM30 existe desde la barra 30; en la ventana de 52 hay 52-(30-1-8)=31 puntos.
    expect(paths.maPath.match(/[ML]/g)).toHaveLength(31);
    expect(huntPeekChartPaths(weeklyBars(20)).hasMa).toBe(false);
    expect(huntPeekChartPaths([])).toBe(null);
  });

  it("motivo de inclusión: vista activa, cola o favoritos — nunca un veredicto", () => {
    expect(huntPeekInclusion({ presetName: "Líderes Etapa 2" })).toBe("Pasa «Líderes Etapa 2»");
    expect(huntPeekInclusion({ queue: { label: "Entradas en Etapa 2" }, sinceLabel: "vie 30 oct" }))
      .toBe("En «Entradas en Etapa 2» desde el vie 30 oct");
    expect(huntPeekInclusion({ queue: { label: "Favoritos", kind: "favorites" } })).toBe("En tus favoritos");
  });

  it("punto del glifo de etapa según la etapa semanal", () => {
    expect(huntPeekStageDot(ROW)).toEqual([44, 18]);
    expect(huntPeekStageDot({})).toBe(null);
  });

  it("pinta identidad, etapa, gráfico, hechos, clasificación y abrir ficha", () => {
    const html = renderToStaticMarkup(React.createElement(HuntPeekPanel, {
      row: ROW,
      inclusion: "Pasa «Líderes Etapa 2»",
      resolutionKey: "watch",
    }));
    expect(html).toContain("huntPeekPanel");
    expect(html).toContain("NVRA");
    expect(html).toContain("Novara Therapeutics");
    expect(html).toContain("Pasa «Líderes Etapa 2»");
    expect(html).toContain("cierre jue 15 oct");
    expect(html).toContain("Etapa 2");
    expect(html).toContain("semana 10");
    expect(html).toContain("MM30");
    expect(html).toContain("Medtech / biotech");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Vigilar</);
    expect(html).toContain('href="/stock/NVRA"');
    expect(html).toContain("★ Favorito");
    // Sin veredictos del sistema.
    expect(html).not.toMatch(/Auditar antes|Esperar confirmación|score/i);
  });

  it("ausencias en --ghost y favorito ya guardado", () => {
    const html = renderToStaticMarkup(React.createElement(HuntPeekPanel, {
      row: { symbol: "AAA" },
      isFavorite: true,
    }));
    expect(html).toContain("★ En favoritos");
    expect(html).toContain("huntTapeGhost");
    expect(html).toContain("Sin etapa");
    expect(html).toContain("Sin serie semanal");
  });

  it("HuntTapeView cerrado no pinta el panel y anuncia Space en el pie", () => {
    const html = renderToStaticMarkup(React.createElement(HuntTapeView, { rows: [ROW] }));
    expect(html).not.toContain("huntPeekPanel");
    expect(html).not.toContain("isPeekOpen");
    expect(html).toContain("<kbd>Space</kbd> panel");
    expect(html).toContain("<kbd>Enter</kbd> ficha");
  });
});

describe("Paso 8 · vacío contractual (una causa, una salida)", () => {
  it("pasan N pero una capa de vista los oculta → la causa es la vista, la salida quitar la última", () => {
    const state = resolveHuntEmptyState({
      emptyLabel: screenerEmptyFilterText(3287, null),
      analyzedCount: 3287,
      passCount: 937,
      chips: [{ key: "country", label: "País: Alemania" }, { key: "sectorStrength", label: "Fuerza: Fuertes" }],
      presetName: "Líderes Etapa 2",
    });
    expect(state.cause).toBe("Pasan 937 de «Líderes Etapa 2», pero ninguno cumple País: Alemania + Fuerza: Fuertes.");
    expect(state.action).toEqual({ kind: HUNT_EMPTY_ACTIONS.CLEAR_CHIP, label: "Quitar Fuerza: Fuertes", chipKey: "sectorStrength" });
  });

  it("precios viejos: conserva la frase de dataAge y ofrece traer datos frescos", () => {
    const diagnostics = { freshnessRejected: 3, freshnessMaxDays: 5 };
    const state = resolveHuntEmptyState({
      emptyLabel: screenerEmptyFilterText(3, diagnostics),
      analyzedCount: 3,
      passCount: 0,
      diagnostics,
      presetName: "Líderes Etapa 2",
    });
    expect(state.cause).toBe("Ningún valor de los 3 analizados pasa: todos tienen el precio de más de 5 días.");
    expect(state.action.kind).toBe(HUNT_EMPTY_ACTIONS.REFRESH);
  });

  it("precio atrasado parcial: la frase de dataAge con las dos causas + ajustar filtro", () => {
    const diagnostics = { freshnessRejected: 4, freshnessMaxDays: 5 };
    const state = resolveHuntEmptyState({
      emptyLabel: screenerEmptyFilterText(10, diagnostics),
      analyzedCount: 10,
      passCount: 0,
      diagnostics,
      presetName: "Cerca de pivot",
    });
    expect(state.cause).toMatch(/4 quedan fuera por precio de más de 5 días/);
    expect(state.action.kind).toBe(HUNT_EMPTY_ACTIONS.ADJUST_FILTER);
  });

  it("cero pasan el filtro: una frase con la vista, sin el consejo duplicado del botón", () => {
    const state = resolveHuntEmptyState({
      emptyLabel: screenerEmptyFilterText(1902, null),
      analyzedCount: 1902,
      passCount: 0,
      presetName: "Cerca de pivot",
    });
    expect(state.cause).toBe("Ningún valor de los 1902 analizados pasa «Cerca de pivot».");
    expect(state.action).toEqual({ kind: HUNT_EMPTY_ACTIONS.ADJUST_FILTER, label: "Ajustar filtro" });
  });

  it("cola externa vacía → volver a la ficha", () => {
    const state = resolveHuntEmptyState({
      emptyLabel: "x",
      analyzedCount: 3287,
      passCount: 0,
      queue: { label: "Nuevos máximos 52s", symbols: new Set(["A", "B"]) },
    });
    expect(state.cause).toBe("Ninguno de los 2 valores de «Nuevos máximos 52s» está en los datos cargados.");
    expect(state.action.kind).toBe(HUNT_EMPTY_ACTIONS.CLOSE_QUEUE);
  });

  it("estados pasivos (carga, desalineación, sin escaneo) no añaden salida", () => {
    expect(resolveHuntEmptyState({ emptyLabel: "Cargando datos de la selección…", passive: true, analyzedCount: 10 }))
      .toEqual({ cause: "Cargando datos de la selección…", action: null });
    expect(resolveHuntEmptyState({ emptyLabel: "Sin escaneo en mesa.", analyzedCount: 0 }).action).toBe(null);
  });

  it("etiqueta de familia IPO con su enlace: no se añade una segunda salida", () => {
    const label = React.createElement("span", { familyKey: "ipo", showIpoRadarCta: true });
    expect(resolveHuntEmptyState({ emptyLabel: label, analyzedCount: 10, passCount: 0 }).action).toBe(null);
    const rs = React.createElement("span", { familyKey: "relativeStrength" });
    expect(resolveHuntEmptyState({ emptyLabel: rs, analyzedCount: 10, passCount: 0 }).action.kind)
      .toBe(HUNT_EMPTY_ACTIONS.ADJUST_FILTER);
  });

  it("se pinta como una frase y un botón, sin tarjeta ni ilustración", () => {
    const html = renderToStaticMarkup(React.createElement(HuntTapeEmpty, {
      label: "Ningún valor de los 10 analizados pasa «X».",
      action: { label: "Ajustar filtro", onClick: () => {} },
    }));
    expect(html).toContain("huntTapeEmptyCause");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toMatch(/<svg|<img|mesaEmptyCard/);
  });
});
