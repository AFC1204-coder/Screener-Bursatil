import { describe, expect, it } from "vitest";
import { extendUniverseRows, intlUniverseRows, universeFingerprint } from "../lib/rsGlobalUniverse.js";
import { parseArgs } from "../scripts/rs-global-private.mjs";

const hkCurated = () => intlUniverseRows(["HK"]);

describe("extendUniverseRows (HK líquidos en el RS global)", () => {
  it("conserva los curados primero y en su orden, y añade los nuevos al final", () => {
    const base = hkCurated();
    const curatedSymbol = base[0].symbol;
    const r = extendUniverseRows(base, [curatedSymbol, "ZZ01.HK", "ZZ02.HK"], { market: "HK", source: "hk-liquid-list", suffix: ".HK" });
    expect(r.rows.slice(0, base.length)).toEqual(base);
    expect(r.added).toEqual(["ZZ01.HK", "ZZ02.HK"]);
    expect(r.rows.at(-1)).toMatchObject({ symbol: "ZZ02.HK", market: "HK", currency: "HKD", source: "hk-liquid-list" });
    expect(r.rows).toHaveLength(base.length + 2);
  });

  it("no duplica un símbolo repetido en la lista ni uno que ya estaba", () => {
    const r = extendUniverseRows([], ["1.HK", "1.HK", " 1.hk "], { market: "HK", suffix: ".HK" });
    expect(r.added).toEqual(["1.HK"]);
  });

  it("rechaza símbolos que no son del mercado y los informa", () => {
    const r = extendUniverseRows([], ["0700.HK", "AAPL", "7203.T", ""], { market: "HK", suffix: ".HK" });
    expect(r.added).toEqual(["0700.HK"]);
    expect(r.rejected).toEqual(["AAPL", "7203.T"]);
  });

  it("sin lista no cambia nada (el RS global actual queda igual)", () => {
    const base = hkCurated();
    const r = extendUniverseRows(base, [], { market: "HK", suffix: ".HK" });
    expect(r.rows).toEqual(base);
    expect(r.added).toEqual([]);
  });

  it("exige el mercado", () => {
    expect(() => extendUniverseRows([], ["1.HK"], {})).toThrow(/market/);
  });

  it("la huella del universo cambia al ampliar y no depende del orden de la lista", () => {
    const base = hkCurated();
    const a = extendUniverseRows(base, ["1.HK", "2.HK", "3.HK"], { market: "HK", suffix: ".HK" });
    const b = extendUniverseRows(base, ["3.HK", "1.HK", "2.HK"], { market: "HK", suffix: ".HK" });
    const f0 = universeFingerprint(base.map((r) => r.symbol));
    const fa = universeFingerprint(a.rows.map((r) => r.symbol));
    const fb = universeFingerprint(b.rows.map((r) => r.symbol));
    expect(fa.hash).not.toBe(f0.hash);
    expect(fa.hash).toBe(fb.hash);
    expect(fa.count).toBe(f0.count + 3);
  });
});

describe("rs-global-private parseArgs", () => {
  it("--hk-liquid-list va apagado por defecto y se activa a propósito", () => {
    expect(parseArgs([]).hkLiquidList).toBe("");
    expect(parseArgs(["--hk-liquid-list=logs/hk-liquid-universe.json"]).hkLiquidList).toBe("logs/hk-liquid-universe.json");
  });

  it("--dump-ranked es diagnóstico: apagado por defecto y no activa la escritura", () => {
    expect(parseArgs([]).dumpRanked).toBe("");
    const a = parseArgs(["--dump-ranked=/tmp/r.json"]);
    expect(a.dumpRanked).toBe("/tmp/r.json");
    expect(a.dryRun).toBe(true);
  });

  it("sigue en dry-run salvo --write explícito", () => {
    expect(parseArgs(["--hk-liquid-list=x.json"]).dryRun).toBe(true);
    expect(parseArgs(["--hk-liquid-list=x.json", "--write"]).dryRun).toBe(false);
  });
});
