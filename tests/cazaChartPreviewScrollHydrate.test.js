import { describe, expect, it } from "vitest";
import {
  collectSymbolsForChartPreviewHydrate,
  computeHuntChartPreviewHydrateLimit,
  computeHuntChartPreviewHydrateStart,
  huntRowsForChartPreviewHydrate,
  HUNT_CHART_PREVIEW_OVERSCAN,
  MAX_HUNT_CHART_PREVIEW_HYDRATE,
  MAX_SYMBOLS_PER_REQUEST,
} from "@/lib/scansChartPreviewHydrate";
import { huntTapeRowHeightPx } from "@/lib/screenerHuntTapeDensity";

function row(symbol) {
  return { symbol };
}

/** Espejo del plan page.jsx: en Caza solo hunt window; fuera, mesa+QR+hunt. */
function symbolsForHydratePlan({ cazaMode, pagedRows, quickReviewRows, huntWindowRows }) {
  return collectSymbolsForChartPreviewHydrate(
    cazaMode
      ? { huntRows: huntWindowRows }
      : { pagedRows, quickReviewRows, huntRows: huntWindowRows },
  );
}

describe("caza chartPreview scroll hydrate queue", () => {
  it("la ventana debe alinearse con la cola de la cinta (orden visible), no con pipeline", () => {
    const pipelineRows = [row("AAA"), row("BBB"), row("CCC"), row("DDD")];
    const tapeRows = [row("DDD"), row("CCC"), row("BBB"), row("AAA")];
    const start = 1;
    const tapeWindow = huntRowsForChartPreviewHydrate(tapeRows, true, { start, limit: 1 });
    const pipelineWindow = huntRowsForChartPreviewHydrate(pipelineRows, true, { start, limit: 1 });

    expect(tapeWindow[0].symbol).toBe("CCC");
    expect(pipelineWindow[0].symbol).toBe("BBB");
  });

  it("scroll profundo desplaza start; ventana = viewport + buffer, no 80 fijas", () => {
    const rowHeight = huntTapeRowHeightPx("compact");
    const listHeight = 12 * rowHeight;
    const limit = computeHuntChartPreviewHydrateLimit(listHeight, { rowHeight });
    expect(limit).toBe(12 + 2 * HUNT_CHART_PREVIEW_OVERSCAN);
    expect(limit).toBeLessThan(80);

    const scrollTop = 90 * rowHeight;
    const start = computeHuntChartPreviewHydrateStart(scrollTop, {
      rowHeight,
      rowCount: 200,
      limit,
    });
    expect(start).toBeGreaterThan(0);
    const windowed = huntRowsForChartPreviewHydrate(
      Array.from({ length: 200 }, (_, index) => row(`Q${index}`)),
      true,
      { start, limit },
    );
    expect(windowed).toHaveLength(limit);
    expect(windowed[0].symbol).toBe(`Q${start}`);
    expect(windowed.some((item) => item.symbol === "Q90")).toBe(true);
    expect(windowed.some((item) => item.symbol === "Q0")).toBe(false);
  });
});

describe("caza chartPreview entry hydrate (CAZA-CHARTPREVIEW-ENTRY-1)", () => {
  it("entrada a Caza: no une pagedRows/quickReview; batch ≤ viewport+buffer (no 80)", () => {
    const defaultLimit = computeHuntChartPreviewHydrateLimit();
    expect(defaultLimit).toBeLessThan(MAX_HUNT_CHART_PREVIEW_HYDRATE);
    expect(defaultLimit).toBeLessThanOrEqual(MAX_SYMBOLS_PER_REQUEST);

    const tape = Array.from({ length: 200 }, (_, index) => row(`H${index}`));
    const mesaPage = Array.from({ length: 60 }, (_, index) => row(`M${index}`));
    const quickReview = Array.from({ length: 40 }, (_, index) => row(`QR${index}`));
    const huntWindowRows = huntRowsForChartPreviewHydrate(tape, true, {
      start: 0,
      limit: defaultLimit,
    });

    const unionLegacy = collectSymbolsForChartPreviewHydrate({
      pagedRows: mesaPage,
      quickReviewRows: quickReview,
      huntRows: huntWindowRows,
    });
    expect(unionLegacy.length).toBeGreaterThan(defaultLimit);
    expect(unionLegacy.length).toBeGreaterThanOrEqual(MAX_SYMBOLS_PER_REQUEST);

    const entrySymbols = symbolsForHydratePlan({
      cazaMode: true,
      pagedRows: mesaPage,
      quickReviewRows: quickReview,
      huntWindowRows,
    });
    expect(entrySymbols).toHaveLength(defaultLimit);
    expect(entrySymbols[0]).toBe("H0");
    expect(entrySymbols.at(-1)).toBe(`H${defaultLimit - 1}`);
    expect(entrySymbols.some((symbol) => symbol.startsWith("M"))).toBe(false);
    expect(entrySymbols.some((symbol) => symbol.startsWith("QR"))).toBe(false);
  });

  it("fuera de Caza (Auditoría) sigue hidratando mesa + quickReview", () => {
    const symbols = symbolsForHydratePlan({
      cazaMode: false,
      pagedRows: [row("PAGE1"), row("PAGE2")],
      quickReviewRows: [row("QR1")],
      huntWindowRows: [],
    });
    expect(symbols).toEqual(["PAGE1", "PAGE2", "QR1"]);
  });
});
