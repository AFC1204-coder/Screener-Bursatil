import { describe, expect, it } from "vitest";
import {
  computeHuntChartPreviewHydrateLimit,
  computeHuntChartPreviewHydrateStart,
  huntRowsForChartPreviewHydrate,
  HUNT_CHART_PREVIEW_OVERSCAN,
} from "@/lib/scansChartPreviewHydrate";
import { huntTapeRowHeightPx } from "@/lib/screenerHuntTapeDensity";

function row(symbol) {
  return { symbol };
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
