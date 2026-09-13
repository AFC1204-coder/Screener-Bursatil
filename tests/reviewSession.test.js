import { describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/lib/localState";
import { persistReviewQueue } from "@/lib/screenerPipeline";
import {
  buildReviewSessionIdentity,
  isStoredReviewSessionValid,
  resolveReviewFocus,
  reviewFocusStatusMessage,
  reviewFilterSignature,
  reviewQueueSymbols,
  reviewSessionIdentityMatches,
} from "@/lib/reviewSession";

const baseIdentity = buildReviewSessionIdentity({
  filterSignature: reviewFilterSignature({ setupMode: "leader" }, { useRegimeFilter: true, marketHealth: { marketScore: 72 } }),
  scanContext: { scannedAt: "2026-09-12T04:00:00.000Z" },
  markets: ["US"],
  manual: "",
  scanMode: "all",
  presetKey: "balanced",
  sort: "totalScore",
  sortAsc: false,
  perfPeriod: "3m",
  viewLayers: { rs: true },
  filterLayers: { relativeStrength: true },
  fieldRules: {},
});

function storedReview(overrides = {}) {
  return {
    source: "current",
    sourceLabel: "Screener actual",
    queueMode: "screener-review",
    rows: [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }],
    selectedSymbol: "BBB",
    currentIndex: 1,
    sessionIdentity: baseIdentity,
    ...overrides,
  };
}

describe("reviewSession identity", () => {
  it("no invalida la sesión cuando solo crece la población analizada", () => {
    const storedSig = reviewFilterSignature({ setupMode: "leader" }, { analyzed: 617, useRegimeFilter: true, marketHealth: { marketScore: 72 } });
    const currentSig = reviewFilterSignature({ setupMode: "leader" }, { analyzed: 3580, useRegimeFilter: true, marketHealth: { marketScore: 72 } });
    expect(storedSig).toBe(currentSig);
    expect(reviewSessionIdentityMatches(
      { ...baseIdentity, filterSignature: storedSig },
      { ...baseIdentity, filterSignature: currentSig },
    )).toBe(true);
  });

  it("invalida la sesión cuando cambian filtros o escaneo", () => {
    expect(reviewSessionIdentityMatches(baseIdentity, {
      ...baseIdentity,
      filterSignature: reviewFilterSignature({ setupMode: "weakness" }, { useRegimeFilter: true }),
    })).toBe(false);
    expect(reviewSessionIdentityMatches(baseIdentity, {
      ...baseIdentity,
      scanScannedAt: "2026-09-11T04:00:00.000Z",
    })).toBe(false);
  });

  it("valida sesión guardada con identidad y escaneo vigente", () => {
    expect(isStoredReviewSessionValid(storedReview(), {
      sessionIdentity: baseIdentity,
      screenerSession: { scanContext: { scannedAt: "2026-09-12T04:00:00.000Z" } },
      now: new Date("2026-09-12T18:00:00.000Z"),
    })).toBe(true);
  });

  it("rechaza sesión sin identidad o con datos caducados", () => {
    expect(isStoredReviewSessionValid(storedReview({ sessionIdentity: undefined }), {
      sessionIdentity: baseIdentity,
      screenerSession: { scanContext: { scannedAt: "2026-09-12T04:00:00.000Z" } },
    })).toBe(false);
    expect(isStoredReviewSessionValid(storedReview(), {
      sessionIdentity: baseIdentity,
      screenerSession: { scanContext: { scannedAt: "2026-09-10T04:00:00.000Z" } },
      now: new Date("2026-09-13T10:00:00.000Z"),
    })).toBe(false);
  });
});

function installFakeStorage() {
  const store = new Map();
  const fake = {
    get length() { return store.size; },
    key(index) { return [...store.keys()][index] ?? null; },
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
  globalThis.window = globalThis;
  globalThis.localStorage = fake;
  return fake;
}

function readStoredReview() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.review) || "{}");
}

// Replica el merge de app/review/page.jsx tras el fix REVIEW-SESSION-1.
function reviewPagePersistAfterNavigation(previousReview, patch) {
  return { ...previousReview, ...patch };
}

describe("review page persist preserves session identity", () => {
  it("mantiene sessionIdentity y presetKey tras actualizar foco en Review", () => {
    installFakeStorage();
    const rows = [{ symbol: "AAA" }, { symbol: "BBB" }, { symbol: "CCC" }];
    const initialPayload = {
      source: "current",
      sourceLabel: "Screener actual",
      queueMode: "screener-review",
      rows,
      activeSettings: { setupMode: "leader" },
      presetKey: "balanced",
      sessionIdentity: baseIdentity,
      currentIndex: 0,
      selectedSymbol: "AAA",
      reviewedSymbols: [],
      hiddenSymbols: [],
      decisionResolutions: {},
      decisionResolutionLog: [],
      resolutionFilter: "all",
      digestFilter: "all",
      updatedAt: "2026-09-13T10:00:00.000Z",
    };
    expect(persistReviewQueue(initialPayload)).toBe(true);

    const previousReview = readStoredReview();
    const navigationPatch = {
      source: "current",
      sourceLabel: "Screener actual",
      sourceDetail: "",
      queueMode: "screener-review",
      rows,
      activeSettings: { setupMode: "leader" },
      currentIndex: 2,
      selectedSymbol: "CCC",
      reviewedSymbols: [],
      hiddenSymbols: [],
      decisionResolutions: {},
      decisionResolutionLog: [],
      resolutionFilter: "all",
      digestFilter: "all",
      updatedAt: "2026-09-13T10:05:00.000Z",
    };
    expect(persistReviewQueue(reviewPagePersistAfterNavigation(previousReview, navigationPatch))).toBe(true);

    const stored = readStoredReview();
    expect(stored.sessionIdentity).toEqual(baseIdentity);
    expect(stored.presetKey).toBe("balanced");
    expect(stored.currentIndex).toBe(2);
    expect(stored.selectedSymbol).toBe("CCC");
    expect(isStoredReviewSessionValid(stored, {
      sessionIdentity: baseIdentity,
      screenerSession: { scanContext: { scannedAt: "2026-09-12T04:00:00.000Z" } },
      now: new Date("2026-09-12T18:00:00.000Z"),
    })).toBe(true);
  });

  it("falla si la persistencia de Review no mergea el snapshot previo", () => {
    installFakeStorage();
    const rows = [{ symbol: "AAA" }, { symbol: "BBB" }];
    const initialPayload = {
      source: "current",
      rows,
      presetKey: "balanced",
      sessionIdentity: baseIdentity,
      currentIndex: 0,
      selectedSymbol: "AAA",
    };
    expect(persistReviewQueue(initialPayload)).toBe(true);

    const buggyPatch = {
      source: "current",
      rows,
      currentIndex: 1,
      selectedSymbol: "BBB",
      updatedAt: "2026-09-13T10:05:00.000Z",
    };
    expect(persistReviewQueue(buggyPatch)).toBe(true);
    expect(readStoredReview().sessionIdentity).toBeUndefined();
  });
});

describe("resolveReviewFocus", () => {
  it("conserva símbolo solicitado cuando pertenece a la cola", () => {
    const focus = resolveReviewFocus(storedReview(), "CCC");
    expect(focus).toMatchObject({ symbol: "CCC", index: 2, resolved: "requested", inQueue: true });
    expect(reviewQueueSymbols(storedReview())).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("restaura foco almacenado y avisa si el símbolo de URL no está en cola", () => {
    const focus = resolveReviewFocus(storedReview(), "ZZZ");
    expect(focus).toMatchObject({
      symbol: "BBB",
      index: 1,
      resolved: "stored_fallback",
      requestedMissing: "ZZZ",
    });
    expect(reviewFocusStatusMessage(focus, 3)).toContain("ZZZ no está en la cola");
    expect(reviewFocusStatusMessage(focus, 3)).toContain("BBB");
  });
});
