import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectLiquid } from "../scripts/ops/hk-liquid-universe.mjs";
import { parseArgs as parseBars, readLiquidList, runWriteLoop } from "../scripts/refresh-bars-hk.mjs";
import { localIdPrefixFor, parseArgs as parseScan } from "../scripts/scan-universe-hk.mjs";

describe("hk-liquid-universe: selectLiquid", () => {
  const rows = [
    { symbol: "0700.HK", n: 60, med: 8.5e9 },
    { symbol: "1234.HK", n: 60, med: 4_999_999 },
    { symbol: "2222.HK", n: 60, med: 5_000_000 },
    { symbol: "3333.HK", n: 10, med: 9e8 },
    { symbol: "4444.HK", n: 60, med: 1e6 },
  ];

  it("corta en 5 M HKD y exige 20 sesiones", () => {
    const out = selectLiquid(rows);
    expect(out.map((r) => r.symbol)).toEqual(["0700.HK", "2222.HK"]);
  });

  it("los curados entran siempre, también si no tienen barras", () => {
    const out = selectLiquid(rows, { curated: ["4444.HK", "9999.HK"] });
    const bySymbol = Object.fromEntries(out.map((r) => [r.symbol, r]));
    expect(bySymbol["4444.HK"].curated).toBe(true);
    expect(bySymbol["9999.HK"]).toMatchObject({ curated: true, medianTurnover: null, sessions: 0 });
    expect(out.map((r) => r.symbol)).toContain("0700.HK");
  });

  it("un líquido que además es curado no se marca como curado y no se duplica", () => {
    const out = selectLiquid(rows, { curated: ["0700.HK"] });
    expect(out.filter((r) => r.symbol === "0700.HK")).toHaveLength(1);
    expect(out.find((r) => r.symbol === "0700.HK").curated).toBe(false);
  });

  it("ordena por liquidez descendente", () => {
    const out = selectLiquid(rows, { minTurnover: 1 });
    const meds = out.map((r) => r.medianTurnover);
    expect([...meds].sort((a, b) => b - a)).toEqual(meds);
  });
});

describe("refresh-bars-hk", () => {
  it("--write gana sobre el dry-run por defecto; --dry-run explícito manda", () => {
    expect(parseBars([]).dryRun).toBe(true);
    expect(parseBars(["--write"]).dryRun).toBe(false);
    expect(parseBars(["--write", "--dry-run"]).dryRun).toBe(true);
  });

  it("tope de filas por defecto 600.000 y concurrencia acotada", () => {
    const a = parseBars(["--concurrency=99", "--max-filas=0"]);
    expect(a.maxRows).toBe(600000);
    expect(a.concurrency).toBe(8);
  });

  it("readLiquidList valida mercado y vacío", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hk-"));
    const good = path.join(dir, "ok.json");
    fs.writeFileSync(good, JSON.stringify({ market: "HK", generatedAt: "x", symbols: [{ symbol: "0700.HK" }, { symbol: " 9988.HK " }] }));
    expect(readLiquidList(good).symbols).toEqual(["0700.HK", "9988.HK"]);
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ market: "US", symbols: [{ symbol: "AAPL" }] }));
    expect(() => readLiquidList(bad)).toThrow(/no es una lista líquida de HK/);
    const empty = path.join(dir, "empty.json");
    fs.writeFileSync(empty, JSON.stringify({ market: "HK", symbols: [] }));
    expect(() => readLiquidList(empty)).toThrow(/vacía/);
  });

  it("runWriteLoop para por tope y reporta lo que queda", async () => {
    const items = Array.from({ length: 10 }, (_, i) => `S${i}`);
    const out = await runWriteLoop(items, {
      concurrency: 1,
      maxRows: 250,
      backfill: async (symbol) => ({ symbol, ok: true, barsWritten: 100 }),
    });
    expect(out.stoppedByCap).toBe(true);
    expect(out.processed).toBe(3);
    expect(out.remaining).toBe(7);
    expect(out.rowsWritten).toBe(300);
  });

  it("runWriteLoop sin tope procesa todo", async () => {
    const out = await runWriteLoop(["A", "B", "C"], { concurrency: 2, maxRows: 1000, backfill: async (symbol) => ({ symbol, ok: true, barsWritten: 10 }) });
    expect(out).toMatchObject({ processed: 3, remaining: 0, stoppedByCap: false, rowsWritten: 30 });
  });
});

describe("scan-universe-hk", () => {
  it("dry-run por defecto y --write lo desactiva", () => {
    expect(parseScan([]).dryRun).toBe(true);
    expect(parseScan(["--write"]).dryRun).toBe(false);
  });

  it("una corrida con --limit escribe con prefijo de prueba; la completa, sin prefijo", () => {
    expect(localIdPrefixFor({ limit: 50 })).toBe("test:");
    expect(localIdPrefixFor({ limit: 0 })).toBe("");
  });
});
