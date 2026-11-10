import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MobileResultList,
  MobileTapeRow,
  mobileDist52w,
  mobileFreshnessDates,
  mobileShortDay,
  mobileStageCell,
} from "@/lib/screenerMobile";
import { HUNT_TAPE_STALE_PRICE_OPACITY } from "@/lib/screenerHuntTape";
import HuntCardRail from "@/app/components/screener/HuntCardRail";
import MobilePeekSheet from "@/app/components/screener/MobilePeekSheet";

// Estudio móvil 2026-11 (research/movil-2026-11/propuesta.md, pasos 6-10).

const NOW_WEEK = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

const row = {
  symbol: "MRNA",
  companyName: "Moderna, Inc.",
  country: "US",
  currency: "USD",
  price: 218.01,
  lastDate: NOW_WEEK,
  weeklyStageState: "stage2",
  weeklyStageWeek: 41,
  weeklyRsAvailable: true,
  weeklyRsRating: 99,
  weeklyRsAsOf: "2026-09-27",
  weeklyRsWeekKey: "2026-W39",
  distance52w: -10,
  perf3m: 266.5,
  marketCap: 102_700_000_000,
  theme: "Medtech / biotech",
  contractionCount: 2,
  contraction1DepthPct: 28,
  contraction2DepthPct: 8,
  chartPreview: Array.from({ length: 40 }, (_, i) => ({ date: `2026-0${1 + Math.floor(i / 5)}-1${i % 5}`, close: 100 + i })),
};

const rsNull = { ...row, symbol: "TJGC", weeklyRsAvailable: true, weeklyRsRating: null, distance52w: null, weeklyStageWeek: null };

function render(el) {
  return renderToStaticMarkup(el);
}

describe("fila móvil de cinta (56 px)", () => {
  it("notación de escritorio compacta: «2·41» + calificador, RS canónico, Máx 52s", () => {
    const html = render(React.createElement(MobileTapeRow, { row }));
    expect(html).toContain(">MRNA<");
    expect(html).toContain("Moderna, Inc.");
    expect(html).toContain("2·41");
    expect(html).toContain(">99<");
    expect(html).toContain("-10,0%");
    expect(html).toContain("huntTapeSpark");
    // Cuatro datos y miniatura: nada de tema, VCP ni capitalización.
    expect(html).not.toContain("Medtech");
    expect(html).not.toContain("28/8");
    expect(html).not.toContain("Sin VCP");
  });

  it("RS nulo y Máx 52s nulo son «—» atenuado, nunca 0 (lib/scoreValue)", () => {
    const html = render(React.createElement(MobileTapeRow, { row: rsNull }));
    expect(html).not.toMatch(/>0</);
    expect(html).not.toContain("0,0%");
    expect(html).toMatch(/mobileTapeRs huntTapeGhost[^>]*>—</);
    expect(html).toMatch(/mobileTapeExt huntTapeGhost[^>]*>—</);
    expect(mobileDist52w({ distance52w: null })).toBeNull();
    expect(mobileDist52w({ distance52w: -3.2 })?.label).toBe("-3,2%");
  });

  it("marca discreta de precio atrasado: miniatura atenuada con la fecha en el title", () => {
    const stale = render(React.createElement(MobileTapeRow, { row: { ...row, lastDate: "2026-01-02" } }));
    expect(stale).toContain(`opacity:${HUNT_TAPE_STALE_PRICE_OPACITY}`);
    expect(stale).toContain("data-stale-price=\"2026-01-02\"");
    const fresh = render(React.createElement(MobileTapeRow, { row }));
    expect(fresh).not.toContain("data-stale-price");
  });

  it("marca del usuario (★ ● ◐ ○) a la izquierda del ticker", () => {
    const html = render(React.createElement(MobileTapeRow, {
      row,
      userMark: { glyph: "◐", title: "Tu clasificación: Vigilar", tone: "res" },
    }));
    expect(html).toMatch(/huntTapeMark huntTapeMark--res[^>]*>◐</);
  });

  it("helpers: etapa sin semanas, fecha corta y fechas de la cabecera", () => {
    expect(mobileStageCell({ weeklyStageState: "stage2", weeklyStageWeek: null }).text).toBe("2");
    expect(mobileStageCell({})).toBeNull();
    expect(mobileShortDay("2026-09-27")).toBe("27 sept");
    expect(mobileShortDay("")).toBe("");
    const dates = mobileFreshnessDates([row, { ...row, weeklyRsAsOf: "2026-09-20" }, row]);
    expect(dates.rsDate).toBe("2026-09-27");
    expect(dates.priceDate).toBe(NOW_WEEK);
  });
});

describe("lista móvil", () => {
  it("cabecera de columnas y filas, sin paginador", () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ ...row, symbol: `S${i}` }));
    const html = render(React.createElement(MobileResultList, { rows }));
    expect(html).toMatch(/mobileTapeHead[\s\S]*Valor[\s\S]*12M[\s\S]*Etapa[\s\S]*RS[\s\S]*Máx 52s/);
    // Se montan 60 y se añaden más al bajar.
    expect(html.match(/class="mobileTapeRow/g)).toHaveLength(60);
    expect(html).toContain("60 de 80 · se cargan más al bajar");
    expect(html).not.toContain("página");
  });

  it("vacío: la causa y una salida, como la cinta de escritorio", () => {
    const html = render(React.createElement(MobileResultList, {
      rows: [],
      emptyLabel: "Ningún valor pasa.",
      emptyAction: { label: "Ajustar filtro", onClick: () => {} },
    }));
    expect(html).toContain("Ningún valor pasa.");
    expect(html).toContain("Ajustar filtro");
  });
});

describe("vistas como pestañas (mismo raíl que escritorio)", () => {
  const props = {
    presetKey: "balanced",
    markets: ["US"],
    cardCounts: { "cerca-pivot": 20 },
    activeCount: 937,
    weeklyViews: [{ id: "entradas-e2", label: "Entradas en Etapa 2", glyph: "+", count: 51, symbols: [] }],
    favoritesView: { id: "favoritos", label: "Favoritos", glyph: "★", count: 0, symbols: [] },
  };

  it("mismas vistas, conteos y activa que el raíl; grupos separados", () => {
    const tabs = render(React.createElement(HuntCardRail, { ...props, layout: "tabs" }));
    const rail = render(React.createElement(HuntCardRail, props));
    expect(tabs).toContain("mobileViewTabs");
    expect(tabs).not.toContain("screenerViewRail");
    for (const label of ["Líderes Etapa 2", "Cerca de pivot", "Entradas en Etapa 2", "★ Favoritos"]) {
      expect(tabs).toContain(label);
    }
    expect(tabs).toMatch(/mobileViewTab isOn[^>]*>Líderes Etapa 2<b>937<\/b>/);
    expect(tabs).toContain("Cerca de pivot<b>20</b>");
    expect(tabs.match(/mobileViewTabSep/g)).toHaveLength(2);
    // El raíl de escritorio sigue intacto.
    expect(rail).toContain("screenerViewRail");
    expect(rail).not.toContain("mobileViewTabs");
  });
});

describe("vista rápida en hoja", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sale de la fila en memoria: no pide nada a la red", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = render(React.createElement(MobilePeekSheet, {
      rows: [row, rsNull],
      index: 0,
      resolutionKey: "watch",
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(html).toContain('role="dialog"');
    expect(html).toContain("MRNA");
    expect(html).toContain("218,01");
    expect(html).toContain("2 · sem. 41");
    expect(html).toContain("W39 · 27 sept");
    expect(html).toContain("28/8 2T");
    expect(html).toContain("+266,5%");
    expect(html).toContain("1 / 2");
    expect(html).toMatch(/mobilePeekClassBtn--watch isOn/);
    expect(html).toContain("Abrir ficha");
    // Sin temporalidades intradía ni botonera de gráfico.
    for (const interval of [">1m<", ">5m<", ">15m<", ">1H<", ">4H<"]) expect(html).not.toContain(interval);
    expect(html).not.toContain("TradingView");
  });

  it("RS ausente en la hoja: «—», nunca 0", () => {
    const html = render(React.createElement(MobilePeekSheet, { rows: [row, rsNull], index: 1 }));
    expect(html).toContain("TJGC");
    expect(html).not.toMatch(/<dd[^>]*>0</);
    expect(html).toContain("2 / 2");
  });

  it("cerrada no pinta nada", () => {
    expect(render(React.createElement(MobilePeekSheet, { rows: [row], index: -1 }))).toBe("");
  });
});
