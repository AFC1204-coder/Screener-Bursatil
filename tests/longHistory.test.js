// Capa de histórico largo (lib/longHistory.js + scripts/long-history.mjs):
// series SINTÉTICAS semanales, sin red ni base de datos.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LONG_HISTORY_ROW_FIELDS,
  computeLongHistoryStats,
  longHistoryForSymbol,
  longHistoryFromDbRow,
  longHistoryRowPatch,
  longHistoryToDbRow,
  projectLongHistoryFields,
} from "@/lib/longHistory";
import { isFreshEnough, parseArgs, runLoop } from "@/scripts/long-history.mjs";

const NOW = new Date("2026-11-08T12:00:00Z");
const WEEK = 7 * 86400000;
const END = Date.UTC(2026, 10, 2); // lunes de la última barra

// weeks barras semanales terminando en END; priceAt(i, n) → cierre de la barra i.
function series(weeks, priceAt, { spread = 0.02 } = {}) {
  return Array.from({ length: weeks }, (_, i) => {
    const t = END - (weeks - 1 - i) * WEEK;
    const close = priceAt(i, weeks);
    return { date: new Date(t).toISOString().slice(0, 10), open: close, high: close * (1 + spread), low: close * (1 - spread), close };
  });
}
const stats = (bars, extra = {}) => computeLongHistoryStats(bars, { now: NOW, ...extra });

describe("máximo histórico verdadero", () => {
  it("usa TODA la serie, no solo 2 años: el pico de hace 8 años manda", () => {
    // sube hasta hace 8 años, cae 70 % y se recupera a la mitad
    const bars = series(520, (i, n) => {
      const peakAt = n - 8 * 52;
      return i <= peakAt ? 10 + i * 0.5 : Math.max(5, (10 + peakAt * 0.5) * 0.3) + (i - peakAt) * 0.05;
    });
    const s = stats(bars);
    expect(s.status).toBe("ok");
    expect(s.athYearsAgo).toBeGreaterThan(7.8);
    expect(s.athYearsAgo).toBeLessThan(8.3);
    expect(s.athDistancePct).toBeLessThan(-30);
  });

  it("en máximos históricos: distancia 0 y años desde el máximo ≈ 0", () => {
    const s = stats(series(400, (i) => 10 * 1.01 ** i, { spread: 0 }));
    expect(s.athDistancePct).toBe(0);
    expect(s.athYearsAgo).toBe(0);
  });

  it("un precio vivo por encima del máximo semanal lo supera y la distancia es 0", () => {
    const bars = series(300, (i) => 10 + i * 0.1);
    const s = stats(bars, { price: 999 });
    expect(s.athValue).toBe(999);
    expect(s.athDistancePct).toBe(0);
  });
});

describe("rendimientos por horizonte", () => {
  it("3 años = 3 años de FECHA aunque falten semanas", () => {
    const full = series(600, (i) => 100 * 1.002 ** i);
    const holes = full.filter((_, i) => i % 7 !== 3); // huecos sueltos
    const a = stats(full);
    const b = stats(holes);
    expect(b.ret3y).toBeCloseTo(a.ret3y, 0);
  });

  it("serie de 2 años: 1y sí, 3/5/10y null (nunca 0)", () => {
    const s = stats(series(110, (i) => 10 + i * 0.2));
    expect(s.ret1y).not.toBeNull();
    expect(s.ret3y).toBeNull();
    expect(s.ret5y).toBeNull();
    expect(s.ret10y).toBeNull();
    expect(s.maxDrawdown5y).toBeNull(); // exige ≥ 3 años
    expect(s.sma200wPosPct).toBeNull();
  });

  it("IPO reciente (< 1 año) → status short, sin horizontes, sin fallos", () => {
    const s = stats(series(30, (i) => 20 + i));
    expect(s.status).toBe("short");
    expect(s.ret1y).toBeNull();
    expect(s.retSinceIpo).not.toBeNull();
    expect(projectLongHistoryFields(s).lhRet3y).toBeNull();
  });

  it("rendimiento desde la salida a bolsa", () => {
    const s = stats(series(200, (i) => 10 * 1.01 ** i, { spread: 0 }));
    expect(s.retSinceIpo).toBeCloseTo((1.01 ** 199 - 1) * 100, 0);
  });
});

describe("años bajistas y caída máxima", () => {
  it("cuenta bloques de 52 semanas con retorno < 0 en los últimos 10 años", () => {
    // 10 años: alterna año alcista / bajista empezando por bajista hace 10 años
    const weeks = 10 * 52 + 1;
    const bars = series(weeks, (i) => {
      const year = Math.floor(i / 52);
      const within = (i % 52) / 52;
      const base = 100 * 1.0 ** year;
      const level = Array.from({ length: year }, (_, y) => (y % 2 === 0 ? 0.8 : 1.3)).reduce((a, b) => a * b, 100);
      const f = year % 2 === 0 ? 1 - 0.2 * within : 1 + 0.3 * within;
      return level * f * (base / 100);
    });
    const s = stats(bars);
    expect(s.coveredYears10).toBe(10);
    expect(s.downYears10).toBe(5);
  });

  it("serie de 4 años: solo cubre 4 bloques", () => {
    const s = stats(series(4 * 52 + 2, (i) => 10 + i * 0.1));
    expect(s.coveredYears10).toBe(4);
    expect(s.downYears10).toBe(0);
  });

  it("caída máxima a 5 años: pico→valle", () => {
    // sube a 100, cae a 40 (−60 %), vuelve a 90
    const bars = series(300, (i) => (i < 100 ? 50 + i * 0.5 : i < 150 ? 100 - (i - 100) * 1.2 : 40 + (i - 150) * 0.33));
    const s = stats(bars);
    expect(s.maxDrawdown5y).toBeLessThan(-55);
    expect(s.maxDrawdown5y).toBeGreaterThan(-65);
  });
});

describe("media de 200 semanas, pendiente y regularidad", () => {
  it("tendencia exponencial limpia: R² ≈ 1, pendiente = crecimiento anual, sobre la media", () => {
    const weekly = 1.01;
    const s = stats(series(520, (i) => 10 * weekly ** i, { spread: 0 }));
    expect(s.trendR2_5y).toBeGreaterThan(0.99);
    expect(s.trendSlopeAnnPct5y).toBeCloseTo((weekly ** 52.18 - 1) * 100, -1);
    expect(s.sma200wPosPct).toBeGreaterThan(0);
    expect(s.sma200wSlopePct).toBeGreaterThan(0);
  });

  it("gráfico largo SUCIO (lateral con sierra) → R² bajo aunque suba en el último tramo", () => {
    const bars = series(520, (i) => (i < 450 ? 50 + 20 * Math.sin(i / 6) : 50 + (i - 450) * 2));
    const s = stats(bars);
    expect(s.trendR2_5y).toBeLessThan(0.5);
  });

  it("caso estrella: sube fuerte pero viene de años bajistas ≠ máximos históricos sostenidos", () => {
    const sostenido = stats(series(520, (i) => 10 * 1.012 ** i, { spread: 0 }));
    const sucio = stats(series(520, (i, n) => (i < n - 60 ? 100 * 0.995 ** i : 100 * 0.995 ** (n - 60) * (1 + (i - (n - 60)) * 0.03))));
    expect(sostenido.athDistancePct).toBe(0);
    expect(sostenido.downYears10).toBe(0);
    expect(sucio.downYears10).toBeGreaterThanOrEqual(5);
    expect(sucio.athDistancePct).toBeLessThan(-30);
    expect(sucio.ret1y).toBeGreaterThan(50);
  });

  it("menos de 200 semanas → media larga null", () => {
    const s = stats(series(150, (i) => 10 + i));
    expect(s.sma200wPosPct).toBeNull();
    expect(s.sma200wSlopePct).toBeNull();
  });
});

describe("deslistados, vacíos, splits y calidad", () => {
  it("serie sin barras → empty", () => {
    expect(stats([]).status).toBe("empty");
    expect(stats(undefined).status).toBe("empty");
  });

  it("último dato de hace > 3 semanas (deslistado/suspendido) → stale, no se proyecta", () => {
    const old = Date.UTC(2026, 4, 4);
    const bars = Array.from({ length: 200 }, (_, i) => ({ date: new Date(old - (199 - i) * WEEK).toISOString().slice(0, 10), high: 11, low: 9, close: 10 }));
    const s = stats(bars);
    expect(s.status).toBe("stale");
    expect(projectLongHistoryFields(s).lhAthDistPct).toBeNull();
    expect(longHistoryRowPatch({ longHistory: s }, "XYZ").lhRet3y).toBeNull();
  });

  it("split NO ajustado antiguo sin evento: se descarta la historia previa y el máximo es sano", () => {
    const jumpAt = 100; // hace ~15 años
    const bars = series(900, (i) => (i < jumpAt ? 400 + i * 0.2 : 100 + (i - jumpAt) * 0.1), { spread: 0 });
    const s = stats(bars);
    expect(s.status).toBe("ok");
    expect(s.quality.truncatedAt).not.toBeNull();
    expect(s.athValue).toBeLessThan(200); // no arrastra los 460 sin ajustar
    expect(s.retSinceIpo).toBeNull(); // la serie ya no arranca en la salida a bolsa
  });

  it("el mismo salto CON evento de split cercano no cuenta como defecto", () => {
    const jumpAt = 300;
    const bars = series(900, (i) => (i < jumpAt ? 100 + i * 0.1 : 25 + (i - jumpAt) * 0.03), { spread: 0 });
    const jumpDate = bars[jumpAt].date;
    const s = stats(bars, { splitEvents: [{ date: jumpDate, ratio: 4 }] });
    expect(s.quality.truncatedAt).toBeNull();
    expect(s.quality.recentJumps).toBe(0);
  });

  it("salto reciente sin split (hundimiento real −65 % en una semana) se CONSERVA y se cuenta", () => {
    const bars = series(300, (i) => (i < 250 ? 100 + i * 0.2 : 30 + (i - 250) * 0.1), { spread: 0 });
    const s = stats(bars);
    expect(s.quality.truncatedAt).toBeNull();
    expect(s.quality.recentJumps).toBe(1);
    expect(s.athDistancePct).toBeLessThan(-60); // el máximo previo sigue contando
  });

  it("serie con inicio fijado a 1970-01-01 (BA/GE en Yahoo): no calcula «desde la salida a bolsa»", () => {
    const weeks = 600;
    const start = Date.UTC(1970, 0, 1);
    const bars = Array.from({ length: weeks }, (_, i) => ({ date: new Date(start + i * WEEK).toISOString().slice(0, 10), high: 10 + i * 0.01, low: 9, close: 10 + i * 0.01 }));
    const s = computeLongHistoryStats(bars, { now: new Date(start + weeks * WEEK) });
    expect(s.quality.startClamped).toBe(true);
    expect(s.retSinceIpo).toBeNull();
  });

  it("firstTradeDate muy anterior a la primera barra → sin retorno desde la salida a bolsa", () => {
    const bars = series(300, (i) => 10 + i * 0.1);
    const firstBar = Date.parse(bars[0].date) / 1000;
    expect(stats(bars, { firstTradeDate: firstBar - 5 * 365 * 86400 }).retSinceIpo).toBeNull();
    expect(stats(bars, { firstTradeDate: firstBar }).retSinceIpo).not.toBeNull();
  });

  it("barras con high absurdo (sin ajustar por split) no inflan el máximo", () => {
    const bars = series(300, (i) => 10 + i * 0.1, { spread: 0 });
    bars[100] = { ...bars[100], high: bars[100].close * 40 };
    const s = stats(bars);
    expect(s.athValue).toBeLessThan(45);
  });

  it("acepta barras en cualquier orden (Yahoo las da recientes primero) y duplicados", () => {
    const asc = series(300, (i) => 10 + i * 0.1);
    const desc = [...asc].reverse().concat(asc.slice(0, 3));
    expect(stats(desc).ret1y).toBe(stats(asc).ret1y);
  });
});

describe("proyección a la fila y mapeo a base de datos", () => {
  const s = stats(series(520, (i) => 10 * 1.01 ** i, { spread: 0 }));

  it("solo los campos lh* declarados; todos numéricos o null; nunca NaN", () => {
    const patch = projectLongHistoryFields(s);
    expect(Object.keys(patch).sort()).toEqual([...LONG_HISTORY_ROW_FIELDS].sort());
    for (const [key, value] of Object.entries(patch)) {
      expect(value === null || Number.isFinite(value)).toBe(true);
    }
  });

  it("sin estadística → {} (los campos se omiten, no viajan como null)", () => {
    expect(longHistoryRowPatch({}, "AAPL")).toEqual({});
    expect(longHistoryRowPatch({ longHistoryBySymbol: new Map() }, "AAPL")).toEqual({});
  });

  it("resuelve por símbolo en mayúsculas (Map y objeto) o por options.longHistory", () => {
    expect(longHistoryForSymbol({ longHistoryBySymbol: new Map([["AAPL", s]]) }, "aapl")).toBe(s);
    expect(longHistoryForSymbol({ longHistoryBySymbol: { AAPL: s } }, "AAPL")).toBe(s);
    expect(longHistoryForSymbol({ longHistory: s }, "ZZZ")).toBe(s);
    expect(longHistoryRowPatch({ longHistory: s }, "AAPL").lhAthDistPct).toBe(0);
  });

  it("ida y vuelta a base de datos conserva las métricas", () => {
    const back = longHistoryFromDbRow(longHistoryToDbRow("aapl", s));
    expect(projectLongHistoryFields(back)).toEqual(projectLongHistoryFields(s));
    expect(longHistoryToDbRow("aapl", s).symbol).toBe("AAPL");
  });

  it("researchRow y materializedScanner usan el MISMO parche (coherencia de las dos copias)", () => {
    for (const file of ["lib/researchRow.js", "lib/materializedScanner.js"]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toContain('import { longHistoryRowPatch } from "@/lib/longHistory"');
      expect(source).toContain("...longHistoryRowPatch(options, symbol)");
    }
  });
});

describe("script del lote (scripts/long-history.mjs)", () => {
  it("por defecto es dry-run; --write y --fetch-only lo desactivan; son excluyentes", () => {
    expect(parseArgs([]).dryRun).toBe(true);
    expect(parseArgs(["--write"]).dryRun).toBe(false);
    expect(parseArgs(["--fetch-only"]).dryRun).toBe(false);
    expect(parseArgs(["--write", "--dry-run"]).dryRun).toBe(true);
    expect(() => parseArgs(["--write", "--fetch-only"])).toThrow();
  });

  it("limita la concurrencia y normaliza --symbols", () => {
    expect(parseArgs(["--concurrency=99"]).concurrency).toBe(6);
    expect(parseArgs(["--symbols=aapl, rddt"]).symbols).toEqual(["AAPL", "RDDT"]);
  });

  it("cadencia: salta lo calculado hace menos de --min-age-days salvo --force", () => {
    const now = Date.parse("2026-11-08T00:00:00Z");
    expect(isFreshEnough({ asOf: "2026-11-05" }, { minAgeDays: 6, now })).toBe(true);
    expect(isFreshEnough({ asOf: "2026-10-26" }, { minAgeDays: 6, now })).toBe(false);
    expect(isFreshEnough({ asOf: "2026-11-05" }, { minAgeDays: 6, now, force: true })).toBe(false);
    expect(isFreshEnough(null, { minAgeDays: 6, now })).toBe(false);
  });

  it("se detiene por tope de filas (código 2 en main) sin procesar el resto", async () => {
    const items = Array.from({ length: 20 }, (_, i) => `S${i}`);
    const r = await runLoop(items, { concurrency: 1, maxRows: 5, worker: async () => ({ ok: true, rowsToWrite: 1 }) });
    expect(r.stoppedByCap).toBe(true);
    expect(r.processed).toBe(5);
    expect(r.remaining).toBe(15);
  });

  it("se detiene tras 5 respuestas 429 seguidas y no insiste", async () => {
    const items = Array.from({ length: 50 }, (_, i) => `S${i}`);
    const r = await runLoop(items, { concurrency: 1, maxRows: 1000, worker: async () => ({ ok: false, rateLimited: true }) });
    expect(r.rateLimited).toBe(true);
    expect(r.processed).toBe(5);
  });

  it("un 429 aislado no corta el lote", async () => {
    let n = 0;
    const r = await runLoop(Array.from({ length: 20 }, (_, i) => i), {
      concurrency: 1, maxRows: 1000,
      worker: async () => ({ ok: true, rateLimited: ++n % 3 === 0, rowsToWrite: 1 }),
    });
    expect(r.rateLimited).toBe(false);
    expect(r.processed).toBe(20);
  });
});
