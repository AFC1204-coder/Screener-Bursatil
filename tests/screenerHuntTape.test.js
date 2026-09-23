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
  it("formatea XW Y/Z NT desde contracciones materializadas", () => {
    expect(formatVcpFootprintFromRow({
      baseWeeks: 19,
      contraction1DepthPct: 18,
      contraction2DepthPct: 11,
      contraction3DepthPct: 6,
    })).toBe("19W 18/6 3T");
  });

  it("devuelve null sin base o sin profundidades", () => {
    expect(formatVcpFootprintFromRow({ contraction1DepthPct: 12 })).toBeNull();
    expect(formatVcpFootprintFromRow({ baseWeeks: 10 })).toBeNull();
  });

  it("expone tooltip T1/T2/T3", () => {
    expect(formatVcpFootprintTitle({
      contraction1DepthPct: 22,
      contraction2DepthPct: 14,
    })).toContain("T1=22%");
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
    });
  });

  it("no usa guion mudo cuando falta RS", () => {
    const cell = huntTapeRsDisplay({ weeklyRsAvailable: false });
    expect(cell.missing).toBe(true);
    expect(cell.text).not.toMatch(/^[-–—]$/);
    expect(cell.text.length).toBeGreaterThan(1);
  });
});
