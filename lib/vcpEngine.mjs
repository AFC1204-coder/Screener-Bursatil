// Motor VCP unificado (v7 + G1–G3). Puerto desde research; sin import de research/ en runtime app.
// ADR: docs/adr-vcp-reconfig-selectividad-2026-09-01.md

import {
  STRUCTURE_E2_MA_ONLY,
  STRUCTURE_E2_STRUCTURAL,
} from "@/lib/weeklyStageStructure";

const DETECTOR_P = {
  smaLen: 150,
  smaSlopeLookback: 20,
  pivotRadius: 3,
  lookback: 140,
  maxLegBars: 45,
  ceilingTolAtr: 4.0,
  firstContractionMinAtr: 3.5,
  lastContractionMaxAtr: 3.0,
  displacementMaxRatio: 0.6,
  minContractions: 2,
  maxContractions: 6,
  decreaseTol: 1.02,
  firstContractionMaxPct: 35,
  volDryMax: 1.5,
  episodeFailMaxBars: 10,
};

/** Umbrales G1–G3 (shadow gates, sep-2026). */
export const DEFAULT_SHADOW_GATE_SETTINGS = {
  primeraMinAtr: 3.5,
  ultimaMaxAtr: 3.0,
  tightRatioMax: 0.72,
  episodeWindowBars: 35,
  longEpisodeBars: 70,
  shortEpisodeMinBars: 18,
  shortEpisodeDistResMax: -7,
};

export function isVcpUnifiedEnabled(options = {}) {
  return options.vcpUnified === true || process.env.STATSEDGE_VCP_UNIFIED === "1";
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sma(vals, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += vals[k];
  return s / n;
}

function atrPct(bars, i, n = 20) {
  const xs = [];
  for (let k = Math.max(1, i - n + 1); k <= i; k++) {
    const pc = bars[k - 1].c;
    if (!(pc > 0)) continue;
    xs.push(Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - pc), Math.abs(bars[k].l - pc)) / pc * 100);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function pivots(bars, from, to, radius) {
  const out = [];
  for (let i = from + radius; i <= to - radius; i++) {
    const w = bars.slice(i - radius, i + radius + 1);
    if (bars[i].h === Math.max(...w.map((b) => b.h))) out.push({ t: "H", i, p: bars[i].h, d: bars[i].d });
    if (bars[i].l === Math.min(...w.map((b) => b.l))) out.push({ t: "L", i, p: bars[i].l, d: bars[i].d });
  }
  out.sort((a, b) => a.i - b.i);
  const merged = [];
  for (const pv of out) {
    const prev = merged.at(-1);
    if (prev?.t === pv.t) {
      if ((pv.t === "H" && pv.p > prev.p) || (pv.t === "L" && pv.p < prev.p)) merged[merged.length - 1] = pv;
    } else merged.push(pv);
  }
  return merged;
}

function mergeLegPivots(pv, maxLegBars) {
  const copy = pv.map((p) => ({ ...p }));
  for (let k = 1; k < copy.length - 1; k++) {
    if (copy[k].t === "H" && copy[k - 1].t === "L" && copy[k + 1].t === "L"
        && copy[k + 1].p < copy[k - 1].p) {
      const anterior = k >= 2 && copy[k - 2].t === "H" ? copy[k - 2] : null;
      const rompeArriba = anterior !== null && copy[k].p > anterior.p;
      const inicio = anterior ? anterior.i : copy[k - 1].i;
      if (!rompeArriba && copy[k + 1].i - inicio <= maxLegBars) {
        copy.splice(k - 1, 3, copy[k + 1]);
        k = 0;
      }
    }
  }
  return copy;
}

function legsFromPivots(pv) {
  const legs = [];
  for (let k = 0; k < pv.length - 1; k++) {
    if (pv[k].t !== "H" || pv[k + 1].t !== "L") continue;
    const hi = pv[k];
    const lo = pv[k + 1];
    const depth = (hi.p - lo.p) / hi.p * 100;
    if (depth > 0) legs.push({ hi, lo, depth, bars: lo.i - hi.i });
  }
  return legs;
}

function isTightLeg(leg, atr, maxAtr) {
  return leg.depth / atr <= maxAtr;
}

function breakoutScanFrom(seq) {
  return (seq.length >= 2 ? seq[1] : seq[0]).lo.i + 1;
}

function findBreakoutFailure(bars, seq, ceiling, scanFrom, last, maxBars) {
  for (let i = scanFrom; i <= last; i++) {
    if (bars[i].h <= ceiling) continue;
    for (let j = i; j <= Math.min(last, i + maxBars); j++) {
      if (bars[j].c < ceiling) return j;
    }
  }
  return null;
}

function findAnchor(legs, bars, p, atrNow, minLegIdx, requireFirstMinAtr) {
  let start = -1;
  let atr = atrNow;
  let mejor = 0;
  for (let k = minLegIdx; k < legs.length; k++) {
    const atrK = atrPct(bars, legs[k].hi.i, 20) || atrNow;
    const enAtr = legs[k].depth / atrK;
    if (enAtr > mejor) mejor = enAtr;
    if (requireFirstMinAtr && enAtr < p.firstContractionMinAtr) continue;
    if (legs[k].depth > p.firstContractionMaxPct) continue;
    if (start < 0 || legs[k].hi.p > legs[start].hi.p) {
      start = k;
      atr = atrK;
    }
  }
  return { start, atr, mejor };
}

function buildSequence(legs, bars, p, start, atr, last) {
  const seq = [legs[start]];
  let ceiling = legs[start].hi.p;

  for (let k = start + 1; k < legs.length && seq.length < p.maxContractions; k++) {
    const leg = legs[k];
    const belowCeilingAtr = (ceiling - leg.hi.p) / ceiling * 100 / atr;
    if (belowCeilingAtr > p.ceilingTolAtr) continue;

    if (leg.depth > seq.at(-1).depth * p.decreaseTol) {
      if (seq.length >= p.minContractions && isTightLeg(seq.at(-1), atr, p.lastContractionMaxAtr)) {
        return { ok: false, closeEpisode: true, seq, reexpandLegIdx: k, ceiling, atr };
      }
      return { ok: false, closeEpisode: false, reason: "reexpansion", seq, corta: leg.depth, ceiling, atr };
    }

    seq.push(leg);
    ceiling = Math.max(ceiling, leg.hi.p);

    if (seq.length >= p.minContractions) {
      const failBar = findBreakoutFailure(
        bars, seq, ceiling, breakoutScanFrom(seq), last, p.episodeFailMaxBars,
      );
      if (failBar !== null) {
        return { ok: true, seq: [...seq], ceiling, atr, failBar, closedByFailure: true };
      }
    }
  }

  if (seq.length < p.minContractions) {
    return { ok: false, closeEpisode: false, reason: "menos_de_2_contracciones", seq, ceiling, atr };
  }
  return { ok: true, seq, ceiling, atr, failBar: null, closedByFailure: false };
}

function validateEpisode(bars, p, seq, atr, ceiling, last, legsDbg, ctx) {
  const rejL = (reason, extra = {}) => ({ ok: false, reason, ...extra, legs: legsDbg });

  const displacementPct = (seq.at(-1).hi.p - seq[0].hi.p) / seq[0].hi.p * 100;
  const dispRatio = displacementPct / seq[0].depth;
  if (dispRatio > p.displacementMaxRatio) {
    return rejL("tendencia_no_lateral", { ...ctx, dispRatio: +dispRatio.toFixed(2) });
  }

  const lastLeg = seq.at(-1);
  if (lastLeg.depth / atr > p.lastContractionMaxAtr) {
    return rejL("ultima_contraccion_ancha", {
      ...ctx,
      ultima: +(lastLeg.depth / atr).toFixed(1),
      seq: seq.map((s) => +s.depth.toFixed(1)),
    });
  }

  const vol50 = bars.slice(Math.max(0, last - 49), last + 1).map((b) => b.v).filter((v) => v > 0);
  const avg50 = vol50.length ? vol50.reduce((a, b) => a + b, 0) / vol50.length : null;
  const inLeg = bars.slice(lastLeg.hi.i + 1, lastLeg.lo.i + 1).map((b) => b.v).filter((v) => v > 0);
  const volRatio = avg50 && inLeg.length ? (inLeg.reduce((a, b) => a + b, 0) / inLeg.length) / avg50 : null;
  if (volRatio !== null && volRatio > p.volDryMax) {
    return rejL("volumen_no_seco", {
      ...ctx,
      volRatio: +volRatio.toFixed(2),
      seq: seq.map((s) => +s.depth.toFixed(1)),
      ultimaLeg: `${lastLeg.hi.d}→${lastLeg.lo.d}`,
    });
  }

  return {
    ok: true,
    reason: "ok",
    ...ctx,
    atr: +atr.toFixed(2),
    contracciones: seq.map((s) => +s.depth.toFixed(1)),
    fechas: seq.map((s) => `${s.hi.d}→${s.lo.d}`),
    primeraEnAtr: +(seq[0].depth / atr).toFixed(1),
    dispRatio: +dispRatio.toFixed(2),
    volRatio: volRatio === null ? null : +volRatio.toFixed(2),
    techo: +ceiling.toFixed(2),
    episodeEndBar: seq.at(-1).lo.i,
  };
}

function tryEpisodeFrom(legs, bars, p, minLegIdx, last, legsDbg, ctx, episodeNum) {
  const atrNow = atrPct(bars, last, 20);
  const requireFirstMinAtr = episodeNum === 0;
  const { start, atr, mejor } = findAnchor(legs, bars, p, atrNow, minLegIdx, requireFirstMinAtr);
  if (start < 0) {
    return {
      ok: false,
      reason: requireFirstMinAtr ? "primera_contraccion_superficial" : "sin_ancla_post_fallo",
      mejor: +mejor.toFixed(1),
      nextLegIdx: minLegIdx + 1,
    };
  }

  const built = buildSequence(legs, bars, p, start, atr, last);
  if (!built.ok) {
    if (built.closeEpisode) {
      return {
        ok: false,
        reason: "reexpansion_cierre",
        closeEpisode: true,
        seq: built.seq,
        reexpandLegIdx: built.reexpandLegIdx,
        ceiling: built.ceiling,
        atr: built.atr,
        nextLegIdx: built.reexpandLegIdx,
      };
    }
    return { ok: false, reason: built.reason, seq: built.seq, corta: built.corta, ceiling: built.ceiling, atr: built.atr, nextLegIdx: start + 1 };
  }

  const failBar = built.failBar ?? findBreakoutFailure(
    bars, built.seq, built.ceiling, breakoutScanFrom(built.seq), last, p.episodeFailMaxBars,
  );
  const validated = validateEpisode(bars, p, built.seq, built.atr, built.ceiling, last, legsDbg, ctx);
  if (!validated.ok) {
    return { ...validated, nextLegIdx: start + 1 };
  }

  return {
    ...validated,
    failBar,
    closedByFailure: built.closedByFailure === true,
    anchorLegIdx: start,
    nextLegIdx: start + built.seq.length,
  };
}

function postFailureAnchorBar(bars, failBar, last) {
  let maxI = failBar;
  let maxP = bars[failBar].h;
  for (let i = failBar + 1; i <= last; i++) {
    if (bars[i].h > maxP) {
      maxP = bars[i].h;
      maxI = i;
    }
  }
  return maxI;
}

function firstLegIdxAfterAnchor(legs, anchorBarIdx) {
  for (let k = 0; k < legs.length; k++) {
    if (legs[k].hi.i >= anchorBarIdx) return k;
  }
  return legs.length;
}

function detectEpisodes(bars, p, ctx, legs, legsDbg, legsRaw) {
  const last = bars.length - 1;
  const episodes = [];
  let minLegIdx = 0;
  let episodeNum = 0;
  let useRawLegs = false;

  while (minLegIdx < legs.length && episodeNum < 4) {
    const legSet = (episodeNum > 0 && useRawLegs) ? legsRaw : legs;
    const attempt = tryEpisodeFrom(legSet, bars, p, minLegIdx, last, legsDbg, ctx, episodeNum);
    if (attempt.ok) {
      episodes.push({ ...attempt, episode: episodeNum + 1 });
      if (attempt.failBar !== null && attempt.failBar !== undefined) {
        const anchorBar = postFailureAnchorBar(bars, attempt.failBar, last);
        minLegIdx = firstLegIdxAfterAnchor(legSet, anchorBar);
        useRawLegs = true;
        episodeNum += 1;
        continue;
      }
      break;
    }

    if (attempt.closeEpisode && attempt.seq?.length >= p.minContractions) {
      const closed = validateEpisode(bars, p, attempt.seq, attempt.atr, attempt.ceiling, last, legsDbg, ctx);
      if (closed.ok) {
        const failBar = findBreakoutFailure(
          bars, attempt.seq, attempt.ceiling, breakoutScanFrom(attempt.seq), last, p.episodeFailMaxBars,
        );
        episodes.push({
          ...closed,
          episode: episodeNum + 1,
          failBar,
          anchorLegIdx: minLegIdx,
          episodeEndBar: attempt.seq.at(-1).lo.i,
        });
        episodeNum += 1;
      }
      const anchorBar = legs[attempt.reexpandLegIdx]?.hi?.i ?? postFailureAnchorBar(bars, attempt.seq.at(-1).lo.i, last);
      minLegIdx = Math.max(attempt.reexpandLegIdx ?? 0, firstLegIdxAfterAnchor(legSet, anchorBar));
      continue;
    }

    if (attempt.reason === "reexpansion" && attempt.seq?.length >= p.minContractions) {
      const closed = validateEpisode(
        bars, p, attempt.seq, attempt.atr ?? atrPct(bars, last), attempt.ceiling, last, legsDbg, ctx,
      );
      if (closed.ok) {
        const failBar = findBreakoutFailure(
          bars, attempt.seq, attempt.ceiling, breakoutScanFrom(attempt.seq), last, p.episodeFailMaxBars,
        ) ?? attempt.seq.at(-1).lo.i;
        episodes.push({
          ...closed,
          episode: episodeNum + 1,
          failBar,
          episodeEndBar: attempt.seq.at(-1).lo.i,
        });
        episodeNum += 1;
        const anchorBar = postFailureAnchorBar(bars, failBar, last);
        minLegIdx = firstLegIdxAfterAnchor(legsRaw, anchorBar);
        useRawLegs = true;
        continue;
      }
    }

    if (episodeNum > 0 && attempt.reason === "sin_ancla_post_fallo") break;
    minLegIdx = Math.max(minLegIdx + 1, attempt.nextLegIdx ?? minLegIdx + 1);
    if (attempt.reason === "primera_contraccion_superficial" && minLegIdx >= legSet.length) break;
  }

  return episodes;
}

function pickActiveEpisode(episodes, last) {
  if (!episodes.length) return null;
  for (let i = episodes.length - 1; i >= 0; i--) {
    const ep = episodes[i];
    if (ep.ok && ep.episodeEndBar <= last) return ep;
  }
  return episodes.at(-1)?.ok ? episodes.at(-1) : null;
}

function allowsReconfigRescue(v4, active) {
  if (!active?.ok || active.failBar == null) return false;
  if (active.episode > 1) return true;
  if (v4.base) return true;
  if (v4.reason !== "reexpansion" || !v4.seq || !active.contracciones) return false;
  if (active.contracciones.length !== 2 || v4.seq.length < 3) return false;
  if (active.contracciones.length >= v4.seq.length) return false;
  const thirdDepth = v4.seq[2];
  const secondDepth = active.contracciones[1];
  return thirdDepth >= secondDepth * 0.95;
}

export function detectV4(bars, opts = {}) {
  const p = { ...DETECTOR_P, ...opts };
  const n = bars.length;
  const last = n - 1;
  const rej = (reason, extra = {}) => ({ base: false, reason, ...extra });

  if (n < p.smaLen + p.smaSlopeLookback + 10) return rej("sin_historia");

  const closes = bars.map((b) => b.c);
  const smaNow = sma(closes, last, p.smaLen);
  const smaPrev = sma(closes, last - p.smaSlopeLookback, p.smaLen);
  if (smaNow === null || smaPrev === null) return rej("sin_historia");
  const smaSlopePct = (smaNow / smaPrev - 1) * 100;
  const priceVsSma = (bars[last].c / smaNow - 1) * 100;
  const ctx = { smaSlopePct: +smaSlopePct.toFixed(2), priceVsSma: +priceVsSma.toFixed(1) };
  if (smaSlopePct <= 0) return rej("contexto_no_etapa2", ctx);

  const atrNow = atrPct(bars, last, 20);
  if (!(atrNow > 0)) return rej("sin_atr", ctx);

  const from = Math.max(1, n - p.lookback);
  let pv = pivots(bars, from, last, p.pivotRadius);
  if (pv.length < 3) return rej("sin_estructura", ctx);

  pv = mergeLegPivots(pv, p.maxLegBars);
  const legs = legsFromPivots(pv);
  const legsDbg = legs.map((l) => `${l.hi.d}→${l.lo.d} ${l.depth.toFixed(1)}%`);
  const rejL = (reason, extra = {}) => rej(reason, { ...extra, legs: legsDbg });
  if (legs.length < p.minContractions) return rejL("menos_de_2_contracciones", ctx);

  let start = -1;
  let atr = atrNow;
  let mejor = 0;
  for (let k = 0; k < legs.length; k++) {
    const atrK = atrPct(bars, legs[k].hi.i, 20) || atrNow;
    const enAtr = legs[k].depth / atrK;
    if (enAtr > mejor) mejor = enAtr;
    if (enAtr < p.firstContractionMinAtr) continue;
    if (legs[k].depth > p.firstContractionMaxPct) continue;
    if (start < 0 || legs[k].hi.p > legs[start].hi.p) {
      start = k;
      atr = atrK;
    }
  }
  if (start < 0) {
    return rejL("primera_contraccion_superficial", { ...ctx, mejor: +mejor.toFixed(1) });
  }

  const seq = [legs[start]];
  let ceiling = legs[start].hi.p;
  for (let k = start + 1; k < legs.length && seq.length < p.maxContractions; k++) {
    const leg = legs[k];
    const belowCeilingAtr = (ceiling - leg.hi.p) / ceiling * 100 / atr;
    if (belowCeilingAtr > p.ceilingTolAtr) continue;
    if (leg.depth > seq.at(-1).depth * p.decreaseTol) {
      return rejL("reexpansion", { ...ctx, seq: seq.map((s) => +s.depth.toFixed(1)), corta: +leg.depth.toFixed(1) });
    }
    seq.push(leg);
    ceiling = Math.max(ceiling, leg.hi.p);
  }
  if (seq.length < p.minContractions) return rejL("menos_de_2_contracciones", ctx);

  const displacementPct = (seq.at(-1).hi.p - seq[0].hi.p) / seq[0].hi.p * 100;
  const dispRatio = displacementPct / seq[0].depth;
  if (dispRatio > p.displacementMaxRatio) {
    return rejL("tendencia_no_lateral", { ...ctx, dispRatio: +dispRatio.toFixed(2) });
  }

  const lastLeg = seq.at(-1);
  if (lastLeg.depth / atr > p.lastContractionMaxAtr) {
    return rejL("ultima_contraccion_ancha", { ...ctx, ultima: +(lastLeg.depth / atr).toFixed(1), seq: seq.map((s) => +s.depth.toFixed(1)) });
  }
  const vol50 = bars.slice(Math.max(0, last - 49), last + 1).map((b) => b.v).filter((v) => v > 0);
  const avg50 = vol50.length ? vol50.reduce((a, b) => a + b, 0) / vol50.length : null;
  const inLeg = bars.slice(lastLeg.hi.i + 1, lastLeg.lo.i + 1).map((b) => b.v).filter((v) => v > 0);
  const volRatio = avg50 && inLeg.length ? (inLeg.reduce((a, b) => a + b, 0) / inLeg.length) / avg50 : null;
  if (volRatio !== null && volRatio > p.volDryMax) {
    return rejL("volumen_no_seco", { ...ctx, volRatio: +volRatio.toFixed(2), seq: seq.map((s) => +s.depth.toFixed(1)), ultimaLeg: `${lastLeg.hi.d}→${lastLeg.lo.d}` });
  }

  return {
    base: true,
    reason: "ok",
    ...ctx,
    atr: +atr.toFixed(2),
    contracciones: seq.map((s) => +s.depth.toFixed(1)),
    fechas: seq.map((s) => `${s.hi.d}→${s.lo.d}`),
    primeraEnAtr: +(seq[0].depth / atr).toFixed(1),
    dispRatio: +dispRatio.toFixed(2),
    volRatio: volRatio === null ? null : +volRatio.toFixed(2),
    techo: +ceiling.toFixed(2),
    seq: seq.map((s) => +s.depth.toFixed(1)),
  };
}

export function detectV7(bars, opts = {}) {
  const p = { ...DETECTOR_P, ...opts };
  const n = bars.length;
  const last = n - 1;
  const rej = (reason, extra = {}) => ({ base: false, reason, ...extra });

  if (n < p.smaLen + p.smaSlopeLookback + 10) return rej("sin_historia");

  const closes = bars.map((b) => b.c);
  const smaNow = sma(closes, last, p.smaLen);
  const smaPrev = sma(closes, last - p.smaSlopeLookback, p.smaLen);
  if (smaNow === null || smaPrev === null) return rej("sin_historia");
  const smaSlopePct = (smaNow / smaPrev - 1) * 100;
  const priceVsSma = (bars[last].c / smaNow - 1) * 100;
  const ctx = { smaSlopePct: +smaSlopePct.toFixed(2), priceVsSma: +priceVsSma.toFixed(1) };
  if (smaSlopePct <= 0) return rej("contexto_no_etapa2", ctx);

  const atrNow = atrPct(bars, last, 20);
  if (!(atrNow > 0)) return rej("sin_atr", ctx);

  const from = Math.max(1, n - p.lookback);
  let pv = pivots(bars, from, last, p.pivotRadius);
  if (pv.length < 3) return rej("sin_estructura", ctx);

  pv = mergeLegPivots(pv, p.maxLegBars);
  const legsMerged = legsFromPivots(pv);
  const legsRaw = legsFromPivots(pivots(bars, from, last, p.pivotRadius));
  const legsDbg = legsMerged.map((l) => `${l.hi.d}→${l.lo.d} ${l.depth.toFixed(1)}%`);
  if (legsMerged.length < p.minContractions) return rej("menos_de_2_contracciones", { ...ctx, legs: legsDbg });

  const episodes = detectEpisodes(bars, p, ctx, legsMerged, legsDbg, legsRaw);
  const active = pickActiveEpisode(episodes, last);
  const v4 = detectV4(bars, opts);

  if (active?.ok && allowsReconfigRescue(v4, active)) {
    return {
      base: true,
      reason: "ok",
      episode: active.episode ?? 1,
      episodes: episodes.length,
      ...active,
    };
  }

  if (v4.base) {
    return { ...v4, episode: 1, episodes: episodes.length || 1 };
  }

  const lastEp = episodes.at(-1);
  return rej(v4.reason ?? lastEp?.reason ?? "sin_episodio", {
    ...ctx,
    legs: legsDbg,
    seq: v4.seq ?? lastEp?.seq?.map((s) => +s.depth.toFixed(1)),
    corta: v4.corta ?? lastEp?.corta,
    episodes: episodes.length,
  });
}

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

/** Barras diarias desc (prod) → asc research `{ d,o,h,l,c,v }`. */
export function dailyBarsToResearch(barsDesc = []) {
  return [...barsDesc]
    .map((bar) => {
      const c = finite(bar.close);
      if (!bar?.date || !Number.isFinite(c) || c <= 0) return null;
      return {
        d: String(bar.date).slice(0, 10),
        o: finite(bar.open) ?? c,
        h: finite(bar.high) ?? c,
        l: finite(bar.low) ?? c,
        c,
        v: finite(bar.volume) ?? 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.d.localeCompare(b.d));
}

/**
 * Evalúa v7 + G1–G3 sobre barras diarias desc (mismo orden que setupPatternForBars).
 *
 * @param {object[]} barsDesc
 * @param {object} context
 * @param {string} [context.stage] weeklyStage.state
 * @param {string} [context.structure] weeklyStageStructure
 * @param {number|null} [context.distResistancePct]
 */
export function evaluateUnifiedVcpFromDailyBars(barsDesc = [], context = {}) {
  const researchBars = dailyBarsToResearch(barsDesc);
  const v7 = detectV7(researchBars);
  const metrics = episodeGateMetrics(researchBars, v7);
  const shadow = evaluateShadowGates({
    detectorHit: v7.base === true,
    stage: context.stage ?? null,
    structure: context.structure ?? null,
    distResistancePct: context.distResistancePct ?? null,
    metrics,
  });

  return {
    vcpCandidate: shadow.propuestaProducto,
    v7,
    shadow,
    metrics,
  };
}
