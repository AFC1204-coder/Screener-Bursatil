import { describe, expect, it, vi, afterEach } from "vitest";
import {
  EXTENDED_RS_IDLE_TIMEOUT_MS,
  mergeExtendedRsIntoRows,
  pickExtendedRsFields,
  scheduleExtendedRsHydration,
  whenBrowserIdle,
} from "@/lib/scansRsBootstrap";

describe("mergeExtendedRsIntoRows · bootstrap core-first", () => {
  const coreRows = [
    { symbol: "AAPL", weeklyRsRating: 80, weeklyCountryRsAvailable: false, weeklyCountryRsRating: null },
    { symbol: "MSFT", weeklyRsRating: 75 },
  ];

  const extendedRows = [
    {
      symbol: "AAPL",
      weeklyCountryRsAvailable: true,
      weeklyCountryRsRating: 72,
      weeklyCountryRsWeekKey: "2026-W35",
      weeklyThemeRsAvailable: true,
      weeklyThemeRsRating: 84,
      weeklyThemeRsWeekKey: "2026-W35",
      weeklyRsRating: 80,
    },
    {
      symbol: "MSFT",
      weeklyCountryRsAvailable: true,
      weeklyCountryRsRating: 65,
      weeklyThemeRsAvailable: false,
      weeklyThemeRsRating: null,
    },
  ];

  it("parchea weeklyCountryRs* y weeklyThemeRs* sin tocar otros campos", () => {
    const merged = mergeExtendedRsIntoRows(coreRows, extendedRows);
    expect(merged).toHaveLength(2);
    expect(merged[0].weeklyRsRating).toBe(80);
    expect(merged[0].weeklyCountryRsRating).toBe(72);
    expect(merged[0].weeklyThemeRsRating).toBe(84);
    expect(merged[1].weeklyCountryRsRating).toBe(65);
    expect(merged[1].weeklyThemeRsRating).toBeNull();
  });

  it("no vacía la mesa si extended llega vacío", () => {
    expect(mergeExtendedRsIntoRows(coreRows, [])).toEqual(coreRows);
    expect(mergeExtendedRsIntoRows(coreRows, null)).toEqual(coreRows);
  });

  it("pickExtendedRsFields solo extrae prefijos país/tema", () => {
    const fields = pickExtendedRsFields(extendedRows[0]);
    expect(fields).toMatchObject({
      weeklyCountryRsAvailable: true,
      weeklyCountryRsRating: 72,
      weeklyThemeRsRating: 84,
    });
    expect(fields.weeklyRsRating).toBeUndefined();
    expect(fields.symbol).toBeUndefined();
  });
});

describe("scheduleExtendedRsHydration · fallo extended no borra core", () => {
  it("ignora resultado si isCancelled", async () => {
    const onMerged = vi.fn();
    await scheduleExtendedRsHydration({
      defer: false,
      fetchExtended: async () => ({ ok: true, configured: true, data: { scans: [{ rows: [{ symbol: "X" }] }] } }),
      extractRows: () => [{ symbol: "X", weeklyCountryRsRating: 50 }],
      isCancelled: () => true,
      onMerged,
    });
    expect(onMerged).not.toHaveBeenCalled();
  });

  it("no llama onMerged si extended falla", async () => {
    const onMerged = vi.fn();
    await scheduleExtendedRsHydration({
      defer: false,
      fetchExtended: async () => ({ ok: false, configured: true, message: "timeout" }),
      extractRows: () => [],
      onMerged,
    });
    expect(onMerged).not.toHaveBeenCalled();
  });

  it("llama onMerged con filas extended en éxito", async () => {
    const onMerged = vi.fn();
    const extended = [{ symbol: "NVDA", weeklyCountryRsRating: 90 }];
    await scheduleExtendedRsHydration({
      defer: false,
      fetchExtended: async () => ({ ok: true, configured: true }),
      extractRows: () => extended,
      onMerged,
    });
    expect(onMerged).toHaveBeenCalledWith(extended, { ok: true, configured: true });
  });
});

describe("scheduleExtendedRsHydration · defer idle post-paint (SCANS-HYDRATERS-COLD-1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("con defer:true no llama fetchExtended en el mismo tick", async () => {
    vi.useFakeTimers();
    const fetchExtended = vi.fn(async () => ({ ok: true, configured: true }));
    const onMerged = vi.fn();
    const pending = scheduleExtendedRsHydration({
      defer: true,
      idleTimeoutMs: 50,
      fetchExtended,
      extractRows: () => [{ symbol: "AAPL", weeklyCountryRsRating: 1 }],
      onMerged,
    });
    expect(fetchExtended).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchExtended).toHaveBeenCalledTimes(1);
    expect(onMerged).toHaveBeenCalled();
  });

  it("cancela antes del idle: no fetch", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const fetchExtended = vi.fn(async () => ({ ok: true, configured: true }));
    const pending = scheduleExtendedRsHydration({
      defer: true,
      idleTimeoutMs: 50,
      fetchExtended,
      extractRows: () => [{ symbol: "AAPL", weeklyCountryRsRating: 1 }],
      isCancelled: () => cancelled,
      onMerged: vi.fn(),
    });
    cancelled = true;
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchExtended).not.toHaveBeenCalled();
  });

  it("whenBrowserIdle expone timeout por defecto", () => {
    expect(EXTENDED_RS_IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(400);
    expect(EXTENDED_RS_IDLE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });

  it("whenBrowserIdle se puede cancelar antes de disparar", async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const cancel = whenBrowserIdle(cb, { timeout: 100 });
    cancel();
    await vi.runAllTimersAsync();
    expect(cb).not.toHaveBeenCalled();
  });
});
