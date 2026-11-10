import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  HuntTapeDensityToggle,
  HuntTapeModeToggle,
  HuntTapeSparkline,
  formatVcpFootprintFromRow,
  formatVcpFootprintTitle,
  huntTapeDist52w,
  huntTapeEnterSymbol,
  huntTapeMoveFocus,
  huntTapeRsDisplay,
  huntTapeRsValue,
  huntTapeSparkTitle,
  huntTapeStageLine,
  huntTapeUserMark,
  huntTapeMarketSuffix,
  HUNT_TAPE_ABSENT,
  huntTapeThemeCell,
} from "@/lib/screenerHuntTape";
import {
  RESULT_VIEW_MODES,
  defaultResultViewMode,
  resolveResultViewMode,
} from "@/lib/screenerResultViewMode";

vi.mock("@/lib/screenerAtoms", () => ({
  CompanyMark: () => React.createElement("span", { className: "companyMark" }),
}));

describe("screenerResultViewMode", () => {
  it("default Caza en fichas del rail y Auditoría fuera", () => {
    expect(defaultResultViewMode("balanced")).toBe(RESULT_VIEW_MODES.CAZA);
    expect(defaultResultViewMode("nearPivot")).toBe(RESULT_VIEW_MODES.CAZA);
    expect(defaultResultViewMode("growth")).toBe(RESULT_VIEW_MODES.AUDIT);
  });

  it("respeta preferencia persistida cuando es válida", () => {
    expect(resolveResultViewMode("balanced", RESULT_VIEW_MODES.AUDIT)).toBe(RESULT_VIEW_MODES.AUDIT);
    expect(resolveResultViewMode("growth", RESULT_VIEW_MODES.CAZA)).toBe(RESULT_VIEW_MODES.CAZA);
  });
});

describe("formatVcpFootprintFromRow", () => {
  // Auditoría 2026-11 (P5): baseWeeks vale 13 en el 100 % de las filas
  // (ventana fija de 65 sesiones), así que el segmento XW se omite.
  it("formatea Y/Z NT sin semanas de base (no hay dato real de semanas)", () => {
    expect(formatVcpFootprintFromRow({
      baseWeeks: 19,
      contraction1DepthPct: 18,
      contraction2DepthPct: 11,
      contraction3DepthPct: 6,
    })).toBe("18/6 3T");
  });

  it("nunca pinta el 13W constante del escáner", () => {
    const footprint = formatVcpFootprintFromRow({
      baseWeeks: 13,
      contraction1DepthPct: 31,
      contraction2DepthPct: 3,
    });
    expect(footprint).toBe("31/3 2T");
    expect(footprint).not.toMatch(/W/);
  });

  it("devuelve null sin profundidades; las profundidades bastan", () => {
    expect(formatVcpFootprintFromRow({ baseWeeks: 10 })).toBeNull();
    expect(formatVcpFootprintFromRow({ contraction1DepthPct: 12 })).toBe("12/12 1T");
  });

  it("expone tooltip T1/T2/T3 y avisa de que las semanas no se miden", () => {
    const title = formatVcpFootprintTitle({
      contraction1DepthPct: 22,
      contraction2DepthPct: 14,
    });
    expect(title).toContain("T1=22%");
    expect(title).toContain("Semanas de base: sin medir");
  });
});

describe("huntTapeStageLine", () => {
  it("muestra etapa · sem. N", () => {
    expect(huntTapeStageLine({
      weeklyStageState: "stage2",
      weeklyStageWeek: 21,
    })).toEqual({
      line: "2 · sem. 21",
      title: "Etapa semanal 2 · 21 semanas en esta etapa",
    });
  });
});

describe("huntTape row helpers", () => {
  const row = {
    symbol: "NVDA",
    weeklyRsAvailable: true,
    weeklyRsRating: 92,
    distance52w: -1.2,
    chartPreview: Array.from({ length: 60 }, (_, i) => ({
      date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`,
      close: 100 + i * 0.5,
      sma50: 99 + i * 0.4,
    })),
  };

  it("lee RS canónico", () => {
    expect(huntTapeRsValue(row).value).toBe(92);
  });

  it("marca dist52w caliente bajo -10%", () => {
    expect(huntTapeDist52w({ distance52w: -11 }).hot).toBe(true);
    expect(huntTapeDist52w({ distance52w: -3 }).hot).toBe(false);
  });

  it("mueve foco circular", () => {
    expect(huntTapeMoveFocus(0, 1, 5)).toBe(1);
    expect(huntTapeMoveFocus(4, 1, 5)).toBe(0);
    expect(huntTapeMoveFocus(0, -1, 5)).toBe(4);
  });

  it("Enter devuelve símbolo de la fila enfocada", () => {
    expect(huntTapeEnterSymbol({
      key: "Enter",
      target: { tagName: "UL" },
      rows: [row],
      focusIndex: 0,
    })).toBe("NVDA");
  });
});

describe("HuntTapeModeToggle", () => {
  it("renderiza Caza y Auditoría con aria-pressed", () => {
    const html = renderToStaticMarkup(
      React.createElement(HuntTapeModeToggle, { mode: "caza", onChange: () => {} }),
    );
    expect(html).toContain("Caza");
    expect(html).toContain("Auditoría");
    expect(html).toContain('aria-pressed="true"');
  });
});

describe("HuntTapeDensityToggle", () => {
  it("renderiza Compacto y Cómodo", () => {
    const html = renderToStaticMarkup(
      React.createElement(HuntTapeDensityToggle, { density: "compact", onChange: () => {} }),
    );
    expect(html).toContain("Compacto");
    expect(html).toContain("Cómodo");
    expect(html).toContain("Densidad de cinta");
  });
});

describe("HuntTapeSparkline", () => {
  it("pinta paths cuando hay chartPreview", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ date: `2026-01-${i + 1}`, close: 10 + i }));
    const html = renderToStaticMarkup(React.createElement(HuntTapeSparkline, { bars }));
    expect(html).toContain("huntTapeSparkPrice");
    expect(html).toContain("huntTapeSparkMa");
  });

  it("muestra skeleton pendiente en vez de guión cuando status=pending", () => {
    const html = renderToStaticMarkup(
      React.createElement(HuntTapeSparkline, { bars: [], status: "pending" }),
    );
    expect(html).toContain("huntTapeSparkPending");
    expect(html).toContain("Cargando gráfico semanal");
    expect(html).toContain("huntTapeSparkSkeleton");
    expect(html).not.toContain("Sin serie");
    expect(html).not.toContain(">–<");
  });

  it("muestra «Sin serie» tipográfico cuando el vacío es real (status=empty)", () => {
    const html = renderToStaticMarkup(
      React.createElement(HuntTapeSparkline, { bars: [], status: "empty" }),
    );
    expect(html).toContain("huntTapeSparkMissing");
    expect(html).toContain("Sin serie");
    expect(html).toContain("Sin serie semanal");
    expect(html).not.toContain("huntTapeSparkPending");
    expect(html).not.toContain(">–<");
  });
});

describe("huntTapeSparkTitle", () => {
  it("no usa jerga de laboratorio", () => {
    expect(huntTapeSparkTitle("ready")).toBe("Gráfico semanal ~12 meses");
    expect(huntTapeSparkTitle("pending")).toBe("Cargando gráfico semanal");
    expect(huntTapeSparkTitle("empty")).toBe("Sin serie semanal");
    for (const status of ["ready", "pending", "empty"]) {
      const title = huntTapeSparkTitle(status);
      expect(title).not.toMatch(/chartPreview/i);
      expect(title).not.toMatch(/materializ/i);
      expect(title).not.toMatch(/hydrate/i);
      expect(title).not.toMatch(/^Spark /);
    }
  });
});

describe("huntTapeRsDisplay", () => {
  it("muestra número cuando RS está disponible", () => {
    expect(huntTapeRsDisplay({
      weeklyRsAvailable: true,
      weeklyRsRating: 92,
    })).toEqual({
      text: "92",
      title: "RS canónico semanal",
      missing: false,
      ghost: false,
    });
  });

  // Rediseño 2026-11 (paso 3): lo ausente pierde tinta. «—» en --ghost en vez
  // de «Sin RS»; el motivo sigue entero en el title (antes: «no usa guion mudo»).
  it("RS ausente → «—» ghost con motivo en el title", () => {
    const cell = huntTapeRsDisplay({ weeklyRsAvailable: false });
    expect(cell.missing).toBe(true);
    expect(cell.ghost).toBe(true);
    expect(cell.text).toBe(HUNT_TAPE_ABSENT);
    expect(cell.title.length).toBeGreaterThan(1);
  });

  it("serie corta / split → «—» ghost; «Sin histórico» y 52 semanas en el title", () => {
    const cell = huntTapeRsDisplay({
      weeklyRsAvailable: false,
      weeklyRsReason: "Sin RS semanal: no hay suficiente histórico de precios (se necesitan 52 semanas).",
    });
    expect(cell.missing).toBe(true);
    expect(cell.ghost).toBe(true);
    expect(cell.text).toBe("—");
    expect(cell.text).not.toBe("Sin RS");
    expect(cell.title).toContain("Sin histórico");
    expect(cell.title).toContain("52 semanas");
  });

  it("fila sin hidratar → «…» (pendiente, no ausente) con motivo en title", () => {
    const cell = huntTapeRsDisplay({ symbol: "AAA" });
    expect(cell.missing).toBe(true);
    expect(cell.ghost).toBe(false);
    expect(cell.text).toBe("…");
    expect(cell.title.length).toBeGreaterThan(10);
  });
});

describe("huntTapeUserMark", () => {
  it("sin favorito ni clasificación → sin marca", () => {
    expect(huntTapeUserMark({})).toBeNull();
    expect(huntTapeUserMark({ favorite: false, resolutionKey: "pending" })).toBeNull();
  });

  it("★ para favorito", () => {
    expect(huntTapeUserMark({ favorite: true })).toEqual({ glyph: "★", title: "Favorito", tone: "fav" });
  });

  it("●/◐/○ para tu clasificación; manda sobre el favorito y el title nombra ambos", () => {
    expect(huntTapeUserMark({ resolutionKey: "candidate" }).glyph).toBe("●");
    expect(huntTapeUserMark({ resolutionKey: "watch" }).glyph).toBe("◐");
    expect(huntTapeUserMark({ resolutionKey: "reject" })).toMatchObject({ glyph: "○", tone: "dis" });
    const both = huntTapeUserMark({ favorite: true, resolutionKey: "watch" });
    expect(both.glyph).toBe("◐");
    expect(both.title).toContain("Favorito");
    expect(both.title).toContain("Vigilar");
  });
});

describe("huntTapeMarketSuffix", () => {
  it("null en US; código en mono para no-US", () => {
    expect(huntTapeMarketSuffix({ symbol: "NVDA" })).toBeNull();
    expect(huntTapeMarketSuffix({ symbol: "NVDA", country: "US" })).toBeNull();
    expect(huntTapeMarketSuffix({ symbol: "SAP.DE", country: "DE" })).toBe("DE");
  });
});

describe("HuntTapeView · marca del usuario, nombre y sufijo (rediseño 2026-11, paso 3)", () => {
  it("pinta ★/◐ antes del ticker, nombre tras el ticker y sufijo de mercado no-US", async () => {
    const { default: HuntTapeView } = await import("@/app/components/screener/HuntTapeView");
    const html = renderToStaticMarkup(React.createElement(HuntTapeView, {
      rows: [
        { symbol: "NVDA", companyName: "NVIDIA Corp" },
        { symbol: "SAP.DE", country: "DE", companyName: "SAP SE" },
        { symbol: "KO", companyName: "Coca-Cola" },
      ],
      favoriteSymbols: new Set(["NVDA"]),
      decisionResolutions: { "SAP.DE": { symbol: "SAP.DE", key: "watch" } },
    }));
    expect(html).toContain('title="Favorito"');
    expect(html).toContain(">★<");
    expect(html).toContain(">◐<");
    expect(html).toContain('class="huntTapeMarket">DE<');
    expect(html).not.toContain('class="huntTapeMarket">US<');
    expect(html).toContain('class="huntTapeName" title="NVIDIA Corp"');
    expect(html.indexOf(">★<")).toBeLessThan(html.indexOf(">NVDA<"));
    expect(html.indexOf(">NVDA<")).toBeLessThan(html.indexOf("NVIDIA Corp"));
  });
});

describe("huntTapeThemeCell (paso 6)", () => {
  it("tema del scan, sector si falta, «—» si no hay ninguno; desglose en el title", () => {
    expect(huntTapeThemeCell({ theme: "Software / IA", sector: "Technology", industry: "Software" }))
      .toEqual({ label: "Software / IA", title: "Software / IA · Technology · Software" });
    expect(huntTapeThemeCell({ theme: "General", sector: "Energy" }).label).toBe("Energy");
    expect(huntTapeThemeCell({}).label).toBe("");
  });
});
