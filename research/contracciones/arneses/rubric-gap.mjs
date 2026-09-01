// Arnés gap mecánico VCP-2: corpus-manual + tanda3 (HPE/VLO) vs v4/v5/producción.
// Rúbrica: docs/rubrica-vcp-producto-2026-09-01.md
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     research/contracciones/arneses/rubric-gap.mjs
//
// Solo lectura sobre daily_bars. No toca lib/setupPatterns.js ni pipeline scan.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { setupPatternForBars } from "@/lib/setupPatterns";
import { weeklyStageForBars } from "@/lib/weeklyStage.js";
import { weeklyStageStructureForBars } from "@/lib/weeklyStageStructure.js";
import { detectV4 } from "../detector/v4.mjs";
import { detectV5 } from "../detector/v5.mjs";
import { detectV7 } from "../detector/v7.mjs";
import {
  episodeGateMetrics,
  evaluateShadowGates,
  summarizeShadowGates,
} from "./shadow-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const RUBRICA_REF = "docs/rubrica-vcp-producto-2026-09-01.md";

/** @typedef {"BASE"|"NO"|"POTENCIAL"} OwnerVerdict */
/** @typedef {"match"|"miss"|"false_positive"|"n/a"} MatchKind */

/**
 * @param {boolean|null|undefined} detected
 * @returns {"BASE"|"no"}
 */
export function detectorLabel(detected) {
  return detected ? "BASE" : "no";
}

/**
 * @param {OwnerVerdict} owner
 * @param {boolean} detected
 * @returns {MatchKind}
 */
export function classifyMatch(owner, detected) {
  if (owner === "POTENCIAL") return "n/a";
  if (owner === "BASE") return detected ? "match" : "miss";
  if (owner === "NO") return detected ? "false_positive" : "match";
  return "n/a";
}

/**
 * @param {Array<{ veredicto?: OwnerVerdict, primary?: boolean, v4?: { base?: boolean }, v5?: { base?: boolean }, prod?: { vcpCandidate?: boolean } }>} rows
 * @param {"v4"|"v5"|"v7"|"prod"} detector
 */
export function summarizeDetector(rows, detector) {
  const primary = rows.filter((r) => r.primary !== false);
  const verdict = (r) => r.ownerVerdict ?? r.veredicto;
  const baseRows = primary.filter((r) => verdict(r) === "BASE");
  const noRows = primary.filter((r) => verdict(r) === "NO");

  const isHit = (row) => {
    if (detector === "v4") return row.v4 === "BASE" || row.v4?.base === true;
    if (detector === "v5") return row.v5 === "BASE" || row.v5?.base === true;
    if (detector === "v7") return row.v7 === "BASE" || row.v7?.base === true;
    return row.prod === "BASE" || row.prod?.vcpCandidate === true;
  };

  const recallHits = baseRows.filter((r) => isHit(r)).length;
  const specHits = noRows.filter((r) => !isHit(r)).length;

  return {
    recallBase: { hits: recallHits, total: baseRows.length },
    specificityNo: { hits: specHits, total: noRows.length },
    falsePositives: noRows.filter((r) => isHit(r)).map((r) => r.id),
    falseNegatives: baseRows.filter((r) => !isHit(r)).map((r) => r.id),
  };
}

/**
 * @param {object[]} corpusCases
 * @param {object[]} tanda3Cases
 */
export function expandEvaluationCases(corpusCases = [], tanda3Cases = []) {
  /** @type {object[]} */
  const out = [];

  const pushCase = (caso, source) => {
    out.push({
      ...caso,
      source,
      primary: true,
      evalId: caso.id,
      evalAsOf: caso.asOf,
      ownerVerdict: caso.veredicto,
    });
    for (const ep of caso.episodios ?? []) {
      out.push({
        ...caso,
        ...ep,
        source,
        primary: false,
        parentId: caso.id,
        episodio: ep.id,
        evalId: `${caso.id}::${ep.id}`,
        evalAsOf: ep.asOf,
        ownerVerdict: ep.veredicto ?? caso.veredicto,
        nota: ep.nota ?? caso.nota,
      });
    }
  };

  for (const c of corpusCases) pushCase(c, "corpus");
  for (const c of tanda3Cases) pushCase(c, "tanda3");
  return out;
}

export function toResearchBars(rows = []) {
  return rows
    .map((r) => {
      const c = Number(r.adj_close ?? r.close);
      if (!r.trade_date || !Number.isFinite(c) || c <= 0) return null;
      return {
        d: String(r.trade_date).slice(0, 10),
        o: Number(r.open ?? c),
        h: Number(r.high ?? c),
        l: Number(r.low ?? c),
        c,
        v: r.volume === null ? 0 : Number(r.volume),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.d.localeCompare(b.d));
}

export function toProdDailyBars(researchBarsAsc = []) {
  return [...researchBarsAsc]
    .map((b) => ({
      date: b.d,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * @param {ReturnType<typeof toResearchBars>} researchBarsAsc
 * @param {string} asOf
 */
export function evaluateAtAsOf(researchBarsAsc, asOf, options = {}) {
  const bars = researchBarsAsc.filter((b) => b.d <= asOf);
  const dailyAsc = bars.map((b) => ({
    date: b.d,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
  const prodBars = toProdDailyBars(bars);
  const stage = weeklyStageForBars(dailyAsc);
  const structure = weeklyStageStructureForBars(dailyAsc, { weeklyStageState: stage.state });
  const r4 = detectV4(bars);
  const r5 = detectV5(bars);
  const r7 = detectV7(bars);
  const prod = setupPatternForBars(prodBars, {
    rawBars: prodBars,
    referenceDate: `${asOf}T23:59:59Z`,
    asOfDate: asOf,
    vcpUnified: options.vcpUnified ?? process.env.STATSEDGE_VCP_UNIFIED === "1",
    weeklyStage: stage,
    weeklyStageStructure: structure,
  });
  const gateMetrics = episodeGateMetrics(bars, r7);
  const shadow = evaluateShadowGates({
    detectorHit: r7.base === true,
    stage: stage.state,
    structure: structure.structure,
    distResistancePct: structure.distResistancePct,
    metrics: gateMetrics,
  });

  return {
    bars: bars.length,
    lastBar: bars.at(-1)?.d ?? null,
    v4: r4,
    v5: r5,
    v7: r7,
    prod: {
      vcpCandidate: prod.vcpCandidate === true,
      patternFamily: prod.patternFamily,
      contractionCount: prod.contractionCount,
      contractionsDecreasing: prod.contractionsDecreasing,
      volumeDryUpRatio: prod.volumeDryUpRatio,
      baseDepthPct: prod.baseDepthPct,
    },
    stage: {
      state: stage.state,
      label: stage.label,
    },
    structure: {
      state: structure.structure,
      label: structure.label,
      distResistancePct: structure.distResistancePct,
      rng26Pct: structure.rng26Pct,
    },
    shadow,
  };
}

/**
 * @param {object} evalCase
 * @param {object} detection
 */
export function buildResultRow(evalCase, detection) {
  const owner = evalCase.ownerVerdict ?? evalCase.veredicto;
  const v4Hit = detection.v4.base === true;
  const v5Hit = detection.v5.base === true;
  const v7Hit = detection.v7.base === true;
  const prodHit = detection.prod.vcpCandidate === true;

  return {
    id: evalCase.evalId ?? evalCase.id,
    parentId: evalCase.parentId ?? null,
    episodio: evalCase.episodio ?? null,
    primary: evalCase.primary !== false,
    source: evalCase.source,
    symbol: evalCase.symbol,
    asOf: evalCase.evalAsOf ?? evalCase.asOf,
    ownerVerdict: owner,
    stage: detection.stage.state,
    stageLabel: detection.stage.label,
    weeklyStageStructure: detection.structure.state,
    weeklyStageStructureLabel: detection.structure.label,
    v4: detectorLabel(v4Hit),
    v5: detectorLabel(v5Hit),
    v7: detectorLabel(v7Hit),
    prod: detectorLabel(prodHit),
    v4Match: classifyMatch(owner, v4Hit),
    v5Match: classifyMatch(owner, v5Hit),
    v7Match: classifyMatch(owner, v7Hit),
    prodMatch: classifyMatch(owner, prodHit),
    motivoV4: detection.v4.reason ?? null,
    motivoV5: detection.v5.reason ?? null,
    motivoV7: detection.v7.reason ?? null,
    episodeV7: detection.v7.episode ?? null,
    g1: detection.shadow.g1,
    g2: detection.shadow.g2,
    g3: detection.shadow.g3,
    g1Reason: detection.shadow.g1Reason,
    g2Reason: detection.shadow.g2Reason,
    g3Reason: detection.shadow.g3Reason,
    propuestaProducto: detection.shadow.propuestaProducto,
    primeraEnAtr: detection.shadow.metrics.primeraEnAtr,
    primeraEnAtrVentana: detection.shadow.metrics.primeraEnAtrVentana,
    dispRatio: detection.shadow.metrics.dispRatio,
    ultimaEnAtr: detection.shadow.metrics.ultimaEnAtr,
    tightRatio: detection.shadow.metrics.tightRatio,
    episodeBars: detection.shadow.metrics.episodeBars,
    reconfig: evalCase.reconfig === true,
    nota: evalCase.nota ?? null,
    bars: detection.bars,
    lastBar: detection.lastBar,
  };
}

function pad(s, n) {
  return String(s ?? "").padEnd(n);
}

function padL(s, n) {
  return String(s ?? "").padStart(n);
}

function fmtRatio({ hits, total }) {
  if (!total) return "—";
  return `${hits}/${total} (${Math.round((100 * hits) / total)}%)`;
}

export function printSummaryTable(rows, metricas) {
  console.log("\n### Gap mecánico — resumen ###\n");
  console.log(`| Métrica | v4 | v5 | v7 | Producción | Shadow |`);
  console.log(`|---------|-----|-----|-----|------------|--------|`);
  console.log(`| Recall BASE (${metricas.v4.recallBase.total}) | ${fmtRatio(metricas.v4.recallBase)} | ${fmtRatio(metricas.v5.recallBase)} | ${fmtRatio(metricas.v7.recallBase)} | ${fmtRatio(metricas.prod.recallBase)} | ${fmtRatio(metricas.shadow.recallBase)} |`);
  console.log(`| Especificidad NO (${metricas.v4.specificityNo.total}) | ${fmtRatio(metricas.v4.specificityNo)} | ${fmtRatio(metricas.v5.specificityNo)} | ${fmtRatio(metricas.v7.specificityNo)} | ${fmtRatio(metricas.prod.specificityNo)} | ${fmtRatio(metricas.shadow.specificityNo)} |`);
  console.log(`| Propuestas producto (todas) | — | — | — | — | ${metricas.shadow.propuestas} |`);

  console.log("\n### Detalle por caso ###\n");
  console.log(
    `${pad("id", 22)}${pad("sym", 6)}${pad("asOf", 12)}${pad("esp", 6)}${pad("stage", 8)}${pad("v7", 6)}${pad("G123", 6)}${pad("prod", 6)}${pad("1ªATR", 6)}nota`,
  );
  console.log("-".repeat(120));
  for (const r of rows) {
    const tag = r.primary ? "" : ` [${r.episodio}]`;
    const gates = `${r.g1 ? "1" : ""}${r.g2 ? "2" : ""}${r.g3 ? "3" : ""}` || "—";
    const prop = r.propuestaProducto ? "Sí" : "no";
    console.log(
      `${pad(r.id + tag, 22)}${pad(r.symbol, 6)}${pad(r.asOf, 12)}${pad(r.ownerVerdict, 6)}${pad(r.stage, 8)}${pad(r.v7, 6)}${pad(prop === "Sí" ? gates : "—", 6)}${pad(r.prod, 6)}${pad(r.primeraEnAtr ?? "—", 6)}${r.nota ?? ""}`,
    );
  }
}

export async function runRubricGap(options = {}) {
  const vcpUnified = options.vcpUnified ?? process.env.STATSEDGE_VCP_UNIFIED === "1";
  const corpusPath = options.corpusPath ?? path.join(ROOT, "corpus-manual.json");
  const tanda3Path = options.tanda3Path ?? path.join(ROOT, "tanda3-gap-casos.json");
  const outDir = options.outDir ?? path.join(ROOT, "resultados");

  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  const tanda3 = JSON.parse(fs.readFileSync(tanda3Path, "utf8"));
  const evalCases = expandEvaluationCases(corpus.casos ?? [], tanda3.casos ?? []);

  const cfg = supabaseConfig();
  if (!cfg.configured && !options.fetchBars) {
    throw new Error(`Supabase no configurado: ${cfg.missing?.join(", ") ?? "?"}`);
  }

  const cache = new Map();
  const fetchBars = options.fetchBars ?? (async (sym) => {
    if (cache.has(sym)) return cache.get(sym);
    const rows = await supabaseRequestAll("daily_bars", {
      query: {
        select: "trade_date,open,high,low,close,adj_close,volume",
        owner_id: `eq.${cfg.ownerId}`,
        symbol: `eq.${sym}`,
        order: "trade_date.asc",
      },
      timeoutMs: 25000,
    }, { maxRows: 5000 });
    const bars = toResearchBars(rows);
    cache.set(sym, bars);
    return bars;
  });

  const symbols = [...new Set(evalCases.map((c) => c.symbol))];
  const barsBySymbol = new Map();
  for (const sym of symbols) {
    barsBySymbol.set(sym, await fetchBars(sym));
  }

  const rows = [];
  for (const evalCase of evalCases) {
    const allBars = barsBySymbol.get(evalCase.symbol) ?? [];
    const asOf = evalCase.evalAsOf ?? evalCase.asOf;
    const detection = evaluateAtAsOf(allBars, asOf, { ...options, vcpUnified });
    rows.push(buildResultRow(evalCase, detection));
  }

  const metricas = {
    v4: summarizeDetector(rows, "v4"),
    v5: summarizeDetector(rows, "v5"),
    v7: summarizeDetector(rows, "v7"),
    prod: summarizeDetector(rows, "prod"),
    shadow: summarizeShadowGates(rows),
  };

  const generado = options.generado ?? new Date().toISOString().slice(0, 10);
  const payload = {
    generado,
    rubrica: RUBRICA_REF,
    corpus: corpusPath,
    tanda3: tanda3Path,
    nCasos: rows.filter((r) => r.primary).length,
    nEvaluaciones: rows.length,
    metricas,
    shadowGates: {
      g1: "stage2 && (weeklyStageStructure !== E2_ma_only || ultimaEnAtr <= 3)",
      g2: "E2_structural || !(episodeBars < 18 && nContractions <= 2 && distResistancePct < -7)",
      g3: "primeraEnAtr >= 3.5; ultimaEnAtr <= 3; tightRatio <= 0.72; ventana 35s si episodeBars > 70",
      propuestaProducto: "v7.base && G1 && G2 && G3",
    },
    prodVcpUnified: vcpUnified,
    casos: rows,
  };

  if (options.writeJson !== false) {
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `rubric-gap-${generado}.json`);
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
    payload.outFile = outFile;
  }

  return payload;
}

async function main() {
  const payload = await runRubricGap();
  printSummaryTable(payload.casos, payload.metricas);
  if (payload.outFile) {
    console.log(`\nJSON: ${payload.outFile}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
