import { describe, expect, it } from "vitest";
import { parseArgs, readSymbols, runLoop } from "../scripts/refresh-fundamentals.mjs";

describe("refresh-fundamentals", () => {
  it("dry-run por defecto; --write lo apaga", () => {
    expect(parseArgs([]).dryRun).toBe(true);
    expect(parseArgs(["--write"]).dryRun).toBe(false);
    expect(parseArgs(["--write", "--dry-run"]).dryRun).toBe(true);
  });
  it("símbolos sin duplicados y con --limit", () => {
    const args = parseArgs(["--symbols=AAPL,AAPL,0425.HK,SHEL.L", "--limit=2"]);
    expect(readSymbols(args)).toEqual(["AAPL", "0425.HK"]);
    expect(() => readSymbols(parseArgs([]))).toThrow(/--symbols/);
  });
  it("el tope de perfiles detiene el bucle", async () => {
    const out = await runLoop(["A", "B", "C", "D"], { concurrency: 1, maxProfiles: 2, refreshOne: async (symbol) => ({ symbol, ok: true }) });
    expect(out.written).toBe(2);
    expect(out.stoppedByCap).toBe(true);
    expect(out.remaining).toBe(2);
  });
});

describe("tope exacto", () => {
  it("si el tope coincide con el total no es parada por tope", async () => {
    const out = await runLoop(["A", "B"], { concurrency: 1, maxProfiles: 2, refreshOne: async (symbol) => ({ symbol, ok: true }) });
    expect(out.stoppedByCap).toBe(false);
    expect(out.remaining).toBe(0);
  });
});
