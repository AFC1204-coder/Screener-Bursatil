import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_SCREENER_CHROME_MODE,
  MARKET_PRESET_CHIP_OPTIONS,
  SCREENER_CHROME_MODE_KEY,
  SCREENER_CHROME_MODES,
  isDiarioChromeMode,
  isExpertChromeMode,
  persistScreenerChromeMode,
  readPersistedScreenerChromeMode,
  resolveActiveMarketPresetLabel,
  resolvePersistedScreenerChromeMode,
  resolveScreenerChromeMode,
} from "@/lib/screenerChromeMode";

vi.mock("@/lib/localState", () => {
  const store = new Map();
  return {
    safeRead: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    safeWrite: (key, value) => {
      store.set(key, value);
      return true;
    },
  };
});

import { safeWrite } from "@/lib/localState";

describe("screenerChromeMode", () => {
  beforeEach(() => {
    safeWrite(SCREENER_CHROME_MODE_KEY, null);
  });

  it("default Diario (caza diaria)", () => {
    expect(DEFAULT_SCREENER_CHROME_MODE).toBe(SCREENER_CHROME_MODES.DIARIO);
    expect(isDiarioChromeMode(undefined)).toBe(true);
    expect(isExpertChromeMode("expert")).toBe(true);
  });

  it("resuelve valores inválidos al default", () => {
    expect(resolveScreenerChromeMode("nope")).toBe("diario");
    expect(resolveScreenerChromeMode("expert")).toBe("expert");
  });

  it("persiste y lee modo Expert", () => {
    expect(resolvePersistedScreenerChromeMode(null)).toBe("diario");
    persistScreenerChromeMode("expert");
    expect(readPersistedScreenerChromeMode()).toBe("expert");
    expect(resolvePersistedScreenerChromeMode()).toBe("expert");
  });

  it("etiqueta de chip de mercados", () => {
    expect(resolveActiveMarketPresetLabel(() => false)).toBe("Personalizado");
    expect(resolveActiveMarketPresetLabel((key) => key === "us")).toBe("EE. UU.");
    expect(resolveActiveMarketPresetLabel((key) => key === "global")).toBe("Global");
    expect(MARKET_PRESET_CHIP_OPTIONS.length).toBeGreaterThanOrEqual(5);
  });
});
