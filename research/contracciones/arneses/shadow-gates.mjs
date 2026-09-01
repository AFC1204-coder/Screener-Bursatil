// Shadow gates G1–G3 (VCP-3-gates). Research only — no prod / hunt UI.
// ADR: docs/adr-vcp-reconfig-selectividad-2026-09-01.md §3–§4

import {
  STRUCTURE_E2_MA_ONLY,
  STRUCTURE_E2_STRUCTURAL,
} from "@/lib/weeklyStageStructure";

/** Umbrales calibrados contra corpus + tanda3 (sep-2026). */
export const DEFAULT_SHADOW_GATE_SETTINGS = {
  /** G3: primera contracción del ancla (v7) en × ATR. */
  primeraMinAtr: 3.5,
  /** G3: última pata en × ATR del ancla del episodio. */
  ultimaMaxAtr: 3.0,
  /** G3: última / penúltima contracción (tightness relativa). */
  tightRatioMax: 0.72,
  /** G3: ventana reciente para cerrar fuga NDAQ (episodios largos). */
  episodeWindowBars: 35,
  /** G3: episodios más largos exigen primera en ventana reciente. */
  longEpisodeBars: 70,
  /** G2: pausa corta mínima (sesiones del primer al último tramo v7). */
  shortEpisodeMinBars: 18,
  /** G2: lejos del techo 52s en episodio muy corto (ELV-like). */
  shortEpisodeDistResMax: -7,
};

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function atrPct(bars, i, n = 20) {
  const xs = [];
  for (let k = Math.max(1, i - n + 1); k <= i; k++) {
    const pc = bars[k - 1].c;
    if (!(pc > 0)) continue;
    xs.push(
      Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - pc), Math.abs(bars[k].l - pc)) / pc * 100,
    );
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Primera contracción de la secuencia v7 cuyo máximo cae en las últimas
 * `windowBars` sesiones (ATR en la fecha del máximo). Cierra fuga NDAQ.
 *
 * @param {object[]} barsAsc research bars <= asOf
 * @param {string[]} fechas v7 `fechas`
 * @param {number[]} contracciones v7 `contracciones` (%)
 * @param {number} windowBars
 */
export function primeraEnAtrVentana(barsAsc, fechas = [], contracciones = [], windowBars = 35) {
  if (!barsAsc.length || !fechas.length || !contracciones.length) return null;
  const lastIdx = barsAsc.length - 1;
  const windowStart = Math.max(0, lastIdx - windowBars);
  for (let i = 0; i < fechas.length; i++) {
    const hiDate = String(fechas[i]).split("→")[0];
    const hiIdx = barsAsc.findIndex((b) => b.d === hiDate);
    if (hiIdx < windowStart) continue;
    const atrK = atrPct(barsAsc, hiIdx, 20);
    const depth = finite(contracciones[i]);
    if (!(atrK > 0) || !(depth > 0)) return null;
    return +(depth / atrK).toFixed(2);
  }
  return null;
}

/**
 * @param {object[]} barsAsc research bars <= asOf
 * @param {object} v7 salida detectV7
 * @param {object} [options]
 */
export function episodeGateMetrics(barsAsc = [], v7 = {}, options = {}) {
  const config = { ...DEFAULT_SHADOW_GATE_SETTINGS, ...options };
  const atr = finite(v7.atr);
  const contracciones = Array.isArray(v7.contracciones) ? v7.contracciones : [];
  const fechas = Array.isArray(v7.fechas) ? v7.fechas : [];
  const ultimaPct = finite(contracciones.at(-1));
  const penultPct = finite(contracciones.at(-2));
  const ultimaEnAtr = atr && ultimaPct ? +(ultimaPct / atr).toFixed(2) : null;
  const tightRatio = penultPct && ultimaPct ? +(ultimaPct / penultPct).toFixed(3) : null;

  let episodeBars = null;
  if (fechas.length) {
    const firstDate = String(fechas[0]).split("→")[0];
    const lastDate = String(fechas.at(-1)).split("→")[1];
    const beginIdx = barsAsc.findIndex((b) => b.d === firstDate);
    const endIdx = barsAsc.findIndex((b) => b.d === lastDate);
    if (beginIdx >= 0 && endIdx >= 0) episodeBars = endIdx - beginIdx;
  }

  return {
    primeraEnAtr: finite(v7.primeraEnAtr),
    primeraEnAtrVentana: primeraEnAtrVentana(
      barsAsc,
      fechas,
      contracciones,
      config.episodeWindowBars,
    ),
    ultimaEnAtr,
    tightRatio,
    dispRatio: finite(v7.dispRatio),
    episodeBars,
    contractionCount: contracciones.length,
  };
}

/**
 * G1: etapa 2 operativa; E2_ma_only solo si la pata final ya es tight (MSI-like fuera).
 *
 * @param {string} stage weeklyStage.state
 * @param {string} structure weeklyStageStructure
 * @param {number|null} ultimaEnAtr
 */
export function gateG1(stage, structure, ultimaEnAtr) {
  if (stage !== "stage2") {
    return { pass: false, reason: "not_stage2" };
  }
  if (structure === STRUCTURE_E2_MA_ONLY) {
    const tight = ultimaEnAtr !== null && ultimaEnAtr <= DEFAULT_SHADOW_GATE_SETTINGS.ultimaMaxAtr;
    if (!tight) {
      return { pass: false, reason: "e2_ma_only" };
    }
  }
  return { pass: true, reason: "ok" };
}

/**
 * G2: tendencia marcada (fuga estructural) o pausa no trivial; corta episodios
 * cortos lejos del techo (ELV-like).
 *
 * @param {object} ctx
 * @param {string} ctx.structure
 * @param {number|null} ctx.episodeBars
 * @param {number|null} ctx.contractionCount
 * @param {number|null} ctx.distResistancePct
 * @param {object} [options]
 */
export function gateG2(ctx = {}, options = {}) {
  const config = { ...DEFAULT_SHADOW_GATE_SETTINGS, ...options };
  const {
    structure,
    episodeBars,
    contractionCount,
    distResistancePct,
  } = ctx;

  if (structure === STRUCTURE_E2_STRUCTURAL) {
    return { pass: true, reason: "e2_structural" };
  }

  const shortEpisode = episodeBars !== null && episodeBars < config.shortEpisodeMinBars;
  const fewLegs = contractionCount !== null && contractionCount <= 2;
  const farFromCeiling = distResistancePct !== null && distResistancePct < config.shortEpisodeDistResMax;
  if (shortEpisode && fewLegs && farFromCeiling) {
    return { pass: false, reason: "episodio_corto_lejos_techo" };
  }

  return { pass: true, reason: "ok" };
}

/**
 * G3: pata tight + primera en ATR del ancla; ventana reciente en episodios largos.
 *
 * @param {ReturnType<typeof episodeGateMetrics>} metrics
 * @param {object} [options]
 */
export function gateG3(metrics = {}, options = {}) {
  const config = { ...DEFAULT_SHADOW_GATE_SETTINGS, ...options };
  const primeraEnAtr = metrics.primeraEnAtr;
  const primeraEnAtrVentana = metrics.primeraEnAtrVentana;
  const { ultimaEnAtr, tightRatio, episodeBars } = metrics;

  if (!(primeraEnAtr >= config.primeraMinAtr)) {
    return { pass: false, reason: "primera_superficial" };
  }
  if (ultimaEnAtr !== null && ultimaEnAtr > config.ultimaMaxAtr) {
    return { pass: false, reason: "ultima_ancha" };
  }
  if (tightRatio !== null && tightRatio > config.tightRatioMax) {
    return { pass: false, reason: "sin_tight_ratio" };
  }
  if (episodeBars !== null && episodeBars > config.longEpisodeBars) {
    if (!(primeraEnAtrVentana >= config.primeraMinAtr)) {
      return { pass: false, reason: "primera_ventana_superficial" };
    }
  }
  return { pass: true, reason: "ok" };
}

/**
 * @param {object} input
 * @param {boolean} input.detectorHit v7.base
 * @param {string} input.stage
 * @param {string} input.structure
 * @param {number|null} [input.distResistancePct]
 * @param {ReturnType<typeof episodeGateMetrics>} input.metrics
 * @param {object} [options]
 */
export function evaluateShadowGates(input = {}, options = {}) {
  const metrics = input.metrics ?? {};
  const g1 = gateG1(input.stage, input.structure, metrics.ultimaEnAtr);
  const g2 = gateG2({
    structure: input.structure,
    episodeBars: metrics.episodeBars,
    contractionCount: metrics.contractionCount,
    distResistancePct: input.distResistancePct ?? null,
  }, options);
  const g3 = gateG3(metrics, options);

  const propuestaProducto = Boolean(
    input.detectorHit && g1.pass && g2.pass && g3.pass,
  );

  return {
    g1: g1.pass,
    g1Reason: g1.reason,
    g2: g2.pass,
    g2Reason: g2.reason,
    g3: g3.pass,
    g3Reason: g3.reason,
    propuestaProducto,
    metrics: {
      primeraEnAtr: metrics.primeraEnAtr,
      primeraEnAtrVentana: metrics.primeraEnAtrVentana,
      ultimaEnAtr: metrics.ultimaEnAtr,
      tightRatio: metrics.tightRatio,
      dispRatio: metrics.dispRatio,
      episodeBars: metrics.episodeBars,
      contractionCount: metrics.contractionCount,
    },
  };
}

/**
 * @param {Array<{ primary?: boolean, ownerVerdict?: string, veredicto?: string, propuestaProducto?: boolean, v7?: string }>} rows
 */
export function summarizeShadowGates(rows = []) {
  const primary = rows.filter((r) => r.primary !== false);
  const verdict = (r) => r.ownerVerdict ?? r.veredicto;
  const baseRows = primary.filter((r) => verdict(r) === "BASE");
  const noRows = primary.filter((r) => verdict(r) === "NO");
  const v7Hit = (r) => r.v7 === "BASE" || r.v7?.base === true;

  const recallHits = baseRows.filter((r) => r.propuestaProducto === true).length;
  const specHits = noRows.filter((r) => r.propuestaProducto !== true).length;

  return {
    propuestas: rows.filter((r) => r.propuestaProducto === true).length,
    recallBase: { hits: recallHits, total: baseRows.length },
    specificityNo: { hits: specHits, total: noRows.length },
    falsePositives: noRows.filter((r) => r.propuestaProducto === true).map((r) => r.id),
    falseNegatives: baseRows.filter((r) => r.propuestaProducto !== true && v7Hit(r)).map((r) => r.id),
  };
}
