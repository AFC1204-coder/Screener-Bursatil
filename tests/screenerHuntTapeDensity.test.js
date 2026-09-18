import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_HUNT_TAPE_DENSITY,
  HUNT_TAPE_DENSITIES,
  HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX,
  HUNT_TAPE_ROW_HEIGHT_BY_DENSITY,
  estimateVisibleHuntTapeRows,
  huntTapeRowHeightPx,
  persistHuntTapeDensity,
  readPersistedHuntTapeDensity,
  resolveHuntTapeDensity,
  resolvePersistedHuntTapeDensity,
  SCREENER_HUNT_TAPE_DENSITY_KEY,
} from "@/lib/screenerHuntTapeDensity";

vi.mock("@/lib/localState", () => {
  const store = new Map();
  return {
    safeRead: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    safeWrite: (key, value) => {
      store.set(key, value);
      return true;
    },
    __store: store,
  };
});

import { safeWrite } from "@/lib/localState";

describe("screenerHuntTapeDensity", () => {
  beforeEach(() => {
    // reset via overwrite
    safeWrite(SCREENER_HUNT_TAPE_DENSITY_KEY, null);
  });

  it("default compact y alturas P4", () => {
    expect(DEFAULT_HUNT_TAPE_DENSITY).toBe(HUNT_TAPE_DENSITIES.COMPACT);
    expect(huntTapeRowHeightPx("compact")).toBe(36);
    expect(huntTapeRowHeightPx("comfort")).toBe(52);
    expect(HUNT_TAPE_ROW_HEIGHT_BY_DENSITY.compact).toBe(36);
  });

  it("resuelve valores inválidos al default", () => {
    expect(resolveHuntTapeDensity("nope")).toBe("compact");
    expect(resolveHuntTapeDensity("comfort")).toBe("comfort");
  });

  it("meta ≥8 filas en lista típica 1080p con compacto", () => {
    const visible = estimateVisibleHuntTapeRows(
      HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX,
      HUNT_TAPE_DENSITIES.COMPACT,
    );
    expect(visible).toBeGreaterThanOrEqual(8);
    expect(visible).toBe(Math.floor(320 / 36));
  });

  it("persiste y lee densidad", () => {
    expect(resolvePersistedHuntTapeDensity(null)).toBe("compact");
    persistHuntTapeDensity("comfort");
    expect(readPersistedHuntTapeDensity()).toBe("comfort");
    expect(resolvePersistedHuntTapeDensity()).toBe("comfort");
  });
});
