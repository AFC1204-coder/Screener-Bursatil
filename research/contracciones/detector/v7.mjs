// Detector v7 — v4 + episodios (cierre por fallo de ruptura / reexpansión + re-ancla).
//
// Research only. No toca producción.
//
// Cambios respecto a v4 (ADR §2.4, ticket VCP-3-reconfig):
//  1. Cerrar episodio N si el precio rompe el techo y cierra de vuelta debajo
//     en ≤ episodeFailMaxBars sesiones.
//  2. Re-anclar N+1 desde patas posteriores al fallo (no el techo de 140 barras
//     del episodio anterior).
//  3. Si aparece reexpansion a mitad de seq: no abortar el símbolo; cerrar N si
//     ya tenía ≥2 contracciones con última pata tight; reintentar ancla después.
//  4. Episodio N+1: misma geometría v4 salvo primera_contraccion_min (ADR §2.4
//     exige pata final tight en N+1, no repetir el ancla del bloque previo).
//  5. Devolver el episodio válido más reciente (VLO vcp1 @ may-15, vcp2 @ jul-08).
//
// Prohibido: v5 fuera_de_rango como cierre; v6 monotonía relajada.

import { detectV4 } from "./v4.mjs";

const P = {
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
  /** @type {Array<object>} */
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

export function detectV7(bars, opts = {}) {
  const p = { ...P, ...opts };
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
