import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CHART_SETTINGS,
  QUICK_REVIEW_CHART_INDICATOR_DEFAULTS,
  applyQuickReviewChartDefaults,
  readChartSettings,
  writeChartSettings,
} from "@/lib/chartSettings";
import { STORAGE_KEYS } from "@/lib/localState";

function installFakeStorage() {
  const store = new Map();
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}

beforeEach(() => {
  installFakeStorage();
});

afterEach(() => {
  delete globalThis.localStorage;
  if (globalThis.window === globalThis) delete globalThis.window;
});

describe("CHART-QR-2 · chart settings scope quickReview", () => {
  it("applyQuickReviewChartDefaults deja RS global ON y RS país/tema OFF", () => {
    const next = applyQuickReviewChartDefaults(DEFAULT_CHART_SETTINGS);
    expect(next.indicators.rsLine).toBe(true);
    expect(next.indicators.rsCountryLine).toBe(false);
    expect(next.indicators.rsThemeLine).toBe(false);
    expect(next.indicators).toMatchObject(QUICK_REVIEW_CHART_INDICATOR_DEFAULTS);
  });

  it("readChartSettings global conserva RS país/tema ON", () => {
    const settings = readChartSettings({ scope: "global" });
    expect(settings.indicators.rsLine).toBe(true);
    expect(settings.indicators.rsCountryLine).toBe(true);
    expect(settings.indicators.rsThemeLine).toBe(true);
  });

  it("readChartSettings quickReview aplica defaults sin tocar global", () => {
    const quick = readChartSettings({ scope: "quickReview" });
    const global = readChartSettings({ scope: "global" });
    expect(quick.indicators.rsLine).toBe(true);
    expect(quick.indicators.rsCountryLine).toBe(false);
    expect(quick.indicators.rsThemeLine).toBe(false);
    expect(global.indicators.rsCountryLine).toBe(true);
    expect(global.indicators.rsThemeLine).toBe(true);
  });

  it("writeChartSettings quickReview persiste preset sin alterar global", () => {
    writeChartSettings({
      ...DEFAULT_CHART_SETTINGS,
      indicators: {
        ...DEFAULT_CHART_SETTINGS.indicators,
        rsCountryLine: true,
        rsThemeLine: false,
      },
    }, { scope: "quickReview" });

    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.chartSettings));
    expect(stored.quickReviewPreset.indicators.rsCountryLine).toBe(true);
    expect(stored.quickReviewPreset.indicators.rsThemeLine).toBe(false);
    expect(stored.indicators.rsCountryLine).toBe(true);
    expect(stored.indicators.rsThemeLine).toBe(true);

    const quick = readChartSettings({ scope: "quickReview" });
    expect(quick.indicators.rsCountryLine).toBe(true);
    expect(quick.indicators.rsThemeLine).toBe(false);

    const global = readChartSettings({ scope: "global" });
    expect(global.indicators.rsCountryLine).toBe(true);
    expect(global.indicators.rsThemeLine).toBe(true);
  });
});
