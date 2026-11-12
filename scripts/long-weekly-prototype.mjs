#!/usr/bin/env node
// Prototipo (solo lectura de red, escribe ficheros locales): barras semanales de HISTORIA COMPLETA por símbolo,
// pensado para estudios largos (cuantificar reglas a lo largo de varios ciclos) y para sobrevivir a un cambio
// de proveedor: el resto del código lee el formato normalizado, solo `providers.<nombre>` sabe de Yahoo.
//
// Formato normalizado por barra semanal: { symbol, week (lunes ISO), date (primera sesión), open, high, low,
// closeRaw (sin ajustar por dividendos; ajustado por splits), closeAdj (retorno total: splits + dividendos),
// volume, provider }. Eventos aparte: dividendos y splits. closeRaw y closeAdj se guardan los dos: las reglas de
// precio y media (etapas) deben medirse sobre closeRaw o sobre closeAdj de forma consciente, no por accidente.
//
// Uso: node scripts/long-weekly-prototype.mjs --out=<dir> --symbols=AAPL,MSFT,... [--concurrency=3] [--delay-ms=250]
//      node scripts/long-weekly-prototype.mjs --out=<dir> --symbols-file=<fichero con un símbolo por línea>
// No escribe en la base. Sin credenciales.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.join("=") || "true"]; }));
const outDir = args.out;
if (!outDir) { console.error("Falta --out=<directorio>"); process.exit(2); }
const symbols = (args.symbols ? args.symbols.split(",") : fs.readFileSync(args["symbols-file"], "utf8").split("\n")).map((s) => s.trim().toUpperCase()).filter(Boolean);
const concurrency = Math.max(1, Number(args.concurrency || 3));
const delayMs = Math.max(0, Number(args["delay-ms"] || 250));

const mondayOf = (iso) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const round = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

const providers = {
  yahoo: {
    name: "yahoo",
    async fetchWeekly(symbol) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1wk&includePrePost=false&events=div%2Csplits`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const r = data?.chart?.result?.[0];
      if (!r) throw new Error(data?.chart?.error?.description || "sin datos");
      const g = String(r.meta?.dataGranularity || "");
      if (g && g !== "1wk") throw new Error(`granularidad ${g}`);
      const q = r.indicators?.quote?.[0] || {};
      const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
      const bars = [];
      (r.timestamp || []).forEach((t, i) => {
        const close = Number(q.close?.[i]);
        if (!Number.isFinite(close) || close <= 0) return;
        const date = new Date(t * 1000).toISOString().slice(0, 10);
        bars.push({ symbol, week: mondayOf(date), date, open: round(q.open?.[i]), high: round(q.high?.[i]), low: round(q.low?.[i]), closeRaw: round(close), closeAdj: round(Number(adj[i] ?? close)), volume: Number.isFinite(q.volume?.[i]) ? q.volume[i] : null, provider: "yahoo" });
      });
      // Yahoo añade una barra «viva» de la semana en curso además de la semanal (medido: 100 de 101 símbolos
      // duplican la semana del 2026-11-09): se queda la última de cada semana ISO.
      const byWeek = new Map(bars.map((b) => [b.week, b]));
      bars.splice(0, bars.length, ...byWeek.values());
      const dividends = Object.values(r.events?.dividends || {}).map((e) => ({ symbol, date: new Date(e.date * 1000).toISOString().slice(0, 10), amount: e.amount }));
      const splits = Object.values(r.events?.splits || {}).map((e) => ({ symbol, date: new Date(e.date * 1000).toISOString().slice(0, 10), numerator: e.numerator, denominator: e.denominator }));
      return { bars, dividends, splits, meta: { firstTradeDate: r.meta?.firstTradeDate ? new Date(r.meta.firstTradeDate * 1000).toISOString().slice(0, 10) : null, currency: r.meta?.currency || null, exchange: r.meta?.exchangeName || null } };
    },
  },
};
const provider = providers[args.provider || "yahoo"];

fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const results = [];
const failures = [];
let next = 0;
async function worker() {
  while (next < symbols.length) {
    const symbol = symbols[next++];
    try {
      const out = await provider.fetchWeekly(symbol);
      results.push({ symbol, ...out });
    } catch (e) { failures.push({ symbol, error: String(e.message || e) }); }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const seconds = (Date.now() - t0) / 1000;

const barsFile = path.join(outDir, "weekly_bars.jsonl.gz");
const eventsFile = path.join(outDir, "events.jsonl.gz");
const gz = (rows) => zlib.gzipSync(rows.map((x) => JSON.stringify(x)).join("\n"));
fs.writeFileSync(barsFile, gz(results.flatMap((r) => r.bars)));
fs.writeFileSync(eventsFile, gz(results.flatMap((r) => [...r.dividends.map((d) => ({ type: "dividend", ...d })), ...r.splits.map((s) => ({ type: "split", ...s }))])));

const nBars = results.reduce((a, r) => a + r.bars.length, 0);
const years = results.map((r) => r.bars.length ? (new Date(r.bars.at(-1).date) - new Date(r.bars[0].date)) / 31557600000 : 0).sort((a, b) => a - b);
const medianYears = years.length ? years[Math.floor(years.length / 2)] : 0;
const lastBar = results.map((r) => r.bars.at(-1)?.date).filter(Boolean).sort().at(-1);
const summary = {
  provider: provider.name, symbols: symbols.length, ok: results.length, failed: failures.length, seconds: round(seconds, 1),
  barsTotal: nBars, barsPerSymbolMedian: results.map((r) => r.bars.length).sort((a, b) => a - b)[Math.floor(results.length / 2)] || 0,
  historyYearsMedian: round(medianYears, 1), historyYearsMax: round(years.at(-1) || 0, 1), lastBar,
  withDividends: results.filter((r) => r.dividends.length).length, withSplits: results.filter((r) => r.splits.length).length,
  withVolume: results.filter((r) => r.bars.some((b) => b.volume > 0)).length,
  bytesBarsGz: fs.statSync(barsFile).size, bytesEventsGz: fs.statSync(eventsFile).size,
  failures: failures.slice(0, 15),
};
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
