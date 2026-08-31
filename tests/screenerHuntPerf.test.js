import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setHuntPerfClock,
  huntPerfSnapshot,
  markHuntGesture,
  measureHuntTruthLineMs,
  recordTruthLinePaint,
  resetHuntPerf,
} from "@/lib/screenerHuntPerf";

describe("screenerHuntPerf · PERF-NAC", () => {
  afterEach(() => {
    resetHuntPerf();
    __setHuntPerfClock(null);
  });

  it("measureHuntTruthLineMs calcula delta válido", () => {
    expect(measureHuntTruthLineMs(100, 250)).toBe(150);
    expect(measureHuntTruthLineMs(100, 50)).toBeNull();
  });

  it("marca gesto y registra paint de truth line", () => {
    let now = 1000;
    __setHuntPerfClock(() => {
      now += 10;
      return now;
    });
    markHuntGesture("hunt-card");
    const ms = recordTruthLinePaint({ presetName: "Deterioro" });
    expect(ms).toBe(10);
    expect(huntPerfSnapshot().lastTruthLineMeta).toEqual({
      presetName: "Deterioro",
    });
  });

  it("recordTruthLinePaint sin gesto previo devuelve null", () => {
    expect(recordTruthLinePaint()).toBeNull();
  });

  it("recordTruthLinePaint solo reporta una vez por gesto", () => {
    markHuntGesture("hunt-card");
    expect(recordTruthLinePaint({ presetName: "Deterioro" })).not.toBeNull();
    expect(recordTruthLinePaint({ presetName: "Deterioro" })).toBeNull();
  });
});
