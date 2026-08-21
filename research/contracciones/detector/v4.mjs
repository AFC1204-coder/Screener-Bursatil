// Detector v4 — prototipo fuera del repo. No toca producción ni escribe en Supabase.
//
// Construido a partir de las nueve etiquetas manuales del dueño (ago 2026).
// Cambios respecto al detector de producción (lib/setupPatterns.js):
//
//  0. FILTRO DE CONTEXTO (nuevo, y es previo): media de 30 semanas subiendo.
//     Sale de ORCL e ICE, los dos únicos fracasos del corpus; los dos tenían
//     la media girada. v3 filtra por "techo >=88% del máximo de 52 semanas",
//     que caza ORCL pero deja pasar ICE.
//  1. PRIMERA CONTRACCIÓN >= 3,5x ATR20 (nuevo). Positivos del corpus: 4,4x-9,1x.
//     Negativos: 1,9x-3,0x. Producción exige ~0,9x ATR, cuatro veces menos.
//  2. LATERALIDAD: el techo no puede desplazarse mucho respecto a la anchura
//     del rango. Admite la base ascendente (MPC +0,21) y rechaza la sierra (+1,68).
//  3. Mínimo para la PRIMERA y máximo para la ÚLTIMA, en vez de un umbral común.
//  4. >=2 contracciones, no >=3 (la taza con asa tiene dos por definición: GOOGL).
//  5. Mínimos consecutivos a menos del 2% se funden: son el mismo soporte, no dos
//     contracciones (arregla el corte espurio de ICE el 17-mar).
//  6. Un máximo solo abre contracción nueva si está cerca del techo (arregla el
//     rebote de PNC del 25-mar, un 14% por debajo).
//  7. VOLUMEN medido DENTRO de la última contracción, no con media móvil 10/50.
//  8. Sin `lower_low_drift`: una perforación no invalida (v3, parte A).

const P = {
  smaLen: 150,            // 30 semanas
  smaSlopeLookback: 20,
  pivotRadius: 3,
  lookback: 140,
  maxLegBars: 45,         // una contracción no puede durar más de 9 semanas
  ceilingTolAtr: 4.0,     // un máximo abre contracción si está a <4 ATR del techo
  firstContractionMinAtr: 3.5,
  lastContractionMaxAtr: 3.0,
  displacementMaxRatio: 0.6,   // entre +0,21 (MPC, positivo) y +1,23 (NDAQ, negativo)
  minContractions: 2,
  maxContractions: 6,
  decreaseTol: 1.02,      // cada contracción <= anterior * 1,02
  firstContractionMaxPct: 35,  // tope de profundidad: O'Neil pide taza 12-33%,
                               // v3 y producción usan 35%. Sin él la corrida
                               // marcaba ARM con 51,5% y AAOI con 60,8%.
  volDryMax: 1.5,         // NO es puerta discriminante (positivos 0,71-1,05 y
                          // el negativo 1,05): es solo cordura, para no admitir
                          // una última contracción con 3x el volumen medio.        // volumen medio de la última contracción vs media 50
};

function sma(vals, i, n) {
  if (i + 1 < n) return null;
  let s = 0; for (let k = i - n + 1; k <= i; k++) s += vals[k];
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

// Pivotes con radio fijo, alternando máximo/mínimo y quedándose con el mejor
// de cada racha (mismo criterio que producción).
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

export function detectV4(bars, opts = {}) {
  const p = { ...P, ...opts };
  const n = bars.length;
  const last = n - 1;
  const rej = (reason, extra = {}) => ({ base: false, reason, ...extra });

  if (n < p.smaLen + p.smaSlopeLookback + 10) return rej("sin_historia");

  // ── Criterio 0: contexto ────────────────────────────────────────────────
  const closes = bars.map((b) => b.c);
  const smaNow = sma(closes, last, p.smaLen);
  const smaPrev = sma(closes, last - p.smaSlopeLookback, p.smaLen);
  if (smaNow === null || smaPrev === null) return rej("sin_historia");
  const smaSlopePct = (smaNow / smaPrev - 1) * 100;
  const priceVsSma = (bars[last].c / smaNow - 1) * 100;
  const ctx = { smaSlopePct: +smaSlopePct.toFixed(2), priceVsSma: +priceVsSma.toFixed(1) };
  if (smaSlopePct <= 0) return rej("contexto_no_etapa2", ctx);

  // ATR de referencia: se recalcula más abajo en la fecha del máximo que abre
  // la base. La significancia de la primera contracción hay que juzgarla contra
  // la volatilidad que tenía el valor ENTONCES, no contra la de hoy: en KO la
  // diferencia entre una y otra cambia el veredicto.
  const atrNow = atrPct(bars, last, 20);
  if (!(atrNow > 0)) return rej("sin_atr", ctx);

  // ── Estructura ──────────────────────────────────────────────────────────
  const from = Math.max(1, n - p.lookback);
  let pv = pivots(bars, from, last, p.pivotRadius);
  if (pv.length < 3) return rej("sin_estructura", ctx);

  // (5) FUSIÓN DE TRAMOS — versión de la iteración 4, que es la que mejor
  //     reprodujo las lecturas del dueño (3 de sus 4 positivos, exactas).
  //
  //     Mientras los mínimos sigan haciendo mínimos más bajos, la caída no ha
  //     terminado: es una contracción con una pausa dentro, no dos. Con dos
  //     salvaguardas, ambas necesarias:
  //       · no se fusiona a través de un máximo que supera al pico anterior
  //         (eso es estructura nueva; sin esto el ancla se iba dos meses atrás)
  //       · tope de duración, o la fusión encadena un trimestre entero.
  //
  //     NO captura la taza de GOOGL (3-feb→30-mar, 22,0%) porque el 13-mar hace
  //     un mínimo intermedio más alto y corta la cadena. Intenté arreglarlo de
  //     dos maneras —umbral de recuperación al techo, y mirada hacia delante
  //     buscando mínimos más bajos— y las dos arreglaban GOOGL rompiendo PNC,
  //     KO y MPC. Con nueve casos etiquetados no hay forma de distinguir los dos
  //     regímenes sin sobreajustar; queda pendiente de más etiquetas.
  for (let k = 1; k < pv.length - 1; k++) {
    if (pv[k].t === "H" && pv[k - 1].t === "L" && pv[k + 1].t === "L"
        && pv[k + 1].p < pv[k - 1].p) {
      const anterior = k >= 2 && pv[k - 2].t === "H" ? pv[k - 2] : null;
      const rompeArriba = anterior !== null && pv[k].p > anterior.p;
      const inicio = anterior ? anterior.i : pv[k - 1].i;
      if (!rompeArriba && pv[k + 1].i - inicio <= p.maxLegBars) {
        pv.splice(k - 1, 3, pv[k + 1]);
        k = 0;
      }
    }
  }

  // Pares máximo→mínimo
  const legs = [];
  for (let k = 0; k < pv.length - 1; k++) {
    if (pv[k].t !== "H" || pv[k + 1].t !== "L") continue;
    const hi = pv[k], lo = pv[k + 1];
    const depth = (hi.p - lo.p) / hi.p * 100;
    if (depth > 0) legs.push({ hi, lo, depth, bars: lo.i - hi.i });
  }
  const legsDbg = legs.map((l) => `${l.hi.d}→${l.lo.d} ${l.depth.toFixed(1)}%`);
  const rejL = (reason, extra = {}) => rej(reason, { ...extra, legs: legsDbg });
  if (legs.length < p.minContractions) return rejL("menos_de_2_contracciones", ctx);

  // Ancla: la primera contracción que cumple el mínimo, medida con el ATR
  // vigente en la fecha de SU máximo.
  // El ancla NO es el primer tramo que pasa el umbral, sino el que arranca del
  // MÁXIMO MÁS ALTO de entre los que lo pasan — el techo de la consolidación,
  // que es desde donde mide el libro. Cogiendo el primero, en KO anclaba en
  // diciembre y en MPC en noviembre, y la secuencia salía reexpandiéndose.
  let start = -1, atr = atrNow, mejor = 0;
  for (let k = 0; k < legs.length; k++) {
    const atrK = atrPct(bars, legs[k].hi.i, 20) || atrNow;
    const enAtr = legs[k].depth / atrK;
    if (enAtr > mejor) mejor = enAtr;
    if (enAtr < p.firstContractionMinAtr) continue;
    if (legs[k].depth > p.firstContractionMaxPct) continue;
    if (start < 0 || legs[k].hi.p > legs[start].hi.p) { start = k; atr = atrK; }
  }
  if (start < 0) {
    return rejL("primera_contraccion_superficial", { ...ctx, mejor: +mejor.toFixed(1) });
  }

  const seq = [legs[start]];
  let ceiling = legs[start].hi.p;
  for (let k = start + 1; k < legs.length && seq.length < p.maxContractions; k++) {
    const leg = legs[k];
    // (6) el máximo debe estar cerca del techo (o por encima: base ascendente)
    const belowCeilingAtr = (ceiling - leg.hi.p) / ceiling * 100 / atr;
    if (belowCeilingAtr > p.ceilingTolAtr) continue;
    // decreciente
    if (leg.depth > seq.at(-1).depth * p.decreaseTol) {
      return rejL("reexpansion", { ...ctx, seq: seq.map((s) => +s.depth.toFixed(1)), corta: +leg.depth.toFixed(1) });
    }
    seq.push(leg);
    ceiling = Math.max(ceiling, leg.hi.p);
  }
  if (seq.length < p.minContractions) return rejL("menos_de_2_contracciones", ctx);

  // ── Criterio 2: lateralidad ─────────────────────────────────────────────
  const displacementPct = (seq.at(-1).hi.p - seq[0].hi.p) / seq[0].hi.p * 100;
  const dispRatio = displacementPct / seq[0].depth;
  if (dispRatio > p.displacementMaxRatio) {
    return rejL("tendencia_no_lateral", { ...ctx, dispRatio: +dispRatio.toFixed(2) });
  }

  // ── Última contracción: superficial y con volumen seco DENTRO ───────────
  const lastLeg = seq.at(-1);
  if (lastLeg.depth / atr > p.lastContractionMaxAtr) {
    return rejL("ultima_contraccion_ancha", { ...ctx, ultima: +(lastLeg.depth / atr).toFixed(1), seq: seq.map((s)=>+s.depth.toFixed(1)) });
  }
  const vol50 = bars.slice(Math.max(0, last - 49), last + 1).map((b) => b.v).filter((v) => v > 0);
  const avg50 = vol50.length ? vol50.reduce((a, b) => a + b, 0) / vol50.length : null;
  const inLeg = bars.slice(lastLeg.hi.i + 1, lastLeg.lo.i + 1).map((b) => b.v).filter((v) => v > 0);
  const volRatio = avg50 && inLeg.length ? (inLeg.reduce((a, b) => a + b, 0) / inLeg.length) / avg50 : null;
  if (volRatio !== null && volRatio > p.volDryMax) {
    return rejL("volumen_no_seco", { ...ctx, volRatio: +volRatio.toFixed(2), seq: seq.map((s)=>+s.depth.toFixed(1)), ultimaLeg: `${lastLeg.hi.d}→${lastLeg.lo.d}` });
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
  };
}
