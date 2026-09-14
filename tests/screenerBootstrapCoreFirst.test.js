import { describe, expect, it, vi } from "vitest";
import {
  mergeExtendedRsIntoRows,
  pickExtendedRsFields,
  scheduleExtendedRsHydration,
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
      fetchExtended: async () => ({ ok: true, configured: true }),
      extractRows: () => extended,
      onMerged,
    });
    expect(onMerged).toHaveBeenCalledWith(extended, { ok: true, configured: true });
  });
});
