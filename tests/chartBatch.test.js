import { describe, expect, it } from "vitest";
import { BATCH_BARS_KEPT, BATCH_MAX_SYMBOLS, mapLimit, normalizeBatchSymbols, trimBarsForPreview } from "@/lib/chartBatch";

describe("chart batch", () => {
  it("normaliza símbolos: mayúsculas, sin vacíos ni duplicados, con tope", () => {
    expect(normalizeBatchSymbols(" ko, aapl,,KO ,msft")).toEqual(["KO", "AAPL", "MSFT"]);
    expect(normalizeBatchSymbols("")).toEqual([]);
    expect(normalizeBatchSymbols(undefined)).toEqual([]);
    const many = Array.from({ length: 100 }, (_, i) => `S${i}`).join(",");
    expect(normalizeBatchSymbols(many)).toHaveLength(BATCH_MAX_SYMBOLS);
  });

  it("recorta a las barras más recientes y deja solo campos de miniatura", () => {
    const bars = Array.from({ length: 400 }, (_, i) => ({
      date: `d${i}`, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, provider: "x", updatedAt: "y", adjClose: 1,
    }));
    const out = trimBarsForPreview(bars);
    expect(out).toHaveLength(BATCH_BARS_KEPT);
    expect(out[0].date).toBe("d0"); // el orden newest-first se conserva
    expect(Object.keys(out[0]).sort()).toEqual(["close", "date", "high", "low", "open", "volume"]);
    expect(trimBarsForPreview(undefined)).toEqual([]);
    expect(trimBarsForPreview(null)).toEqual([]);
  });

  it("mapLimit respeta la concurrencia y el orden de resultados", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
