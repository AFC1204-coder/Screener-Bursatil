import { describe, expect, it } from "vitest";
import {
  computeHuntChartPreviewHydrateStart,
  huntRowsForChartPreviewHydrate,
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

  it("scroll profundo (>80) desplaza start con rowHeight compacto", () => {
    const rowHeight = huntTapeRowHeightPx("compact");
    const scrollTop = 90 * rowHeight;
    const start = computeHuntChartPreviewHydrateStart(scrollTop, {
      rowHeight,
      rowCount: 200,
    });
    expect(start).toBeGreaterThan(0);
    const windowed = huntRowsForChartPreviewHydrate(
      Array.from({ length: 200 }, (_, index) => row(`Q${index}`)),
      true,
      { start },
    );
    expect(windowed).toHaveLength(80);
    expect(windowed[0].symbol).toBe(`Q${start}`);
    expect(windowed.some((item) => item.symbol === "Q90")).toBe(true);
  });
});
