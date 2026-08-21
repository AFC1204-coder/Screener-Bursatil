// Detector v6 — v4 con MONOTONÍA RELAJADA. Prototipo de research: no toca
// producción, no escribe en Supabase.
//
// ÚNICO cambio respecto a v4 (deliberadamente uno solo, para saber qué mejora
// qué). Ningún umbral se ha tocado: `decreaseTol` sigue existiendo con el mismo
// valor, pero deja de decidir.
//
// LO QUE HACÍA v4: cada contracción tenía que ser <= la anterior * 1,02. En
// cuanto un tramo repuntaba, ABORTABA la detección entera con `reexpansion`.
//
// LO QUE HACE v6: un tramo intermedio puede repuntar respecto al anterior —la
// secuencia no se corta—, pero la ÚLTIMA contracción tiene que ser la más
// superficial de toda la secuencia. Si no lo es, se rechaza con
// `ultima_no_es_la_mas_superficial`.
//
// De dónde sale: R5 del corpus (`corpus-manual.json` → reglasPendientes), que
// revela FCX — 22,5 → 10,9 → 11,1 → 7,9, aceptado por el dueño sin reparos y
// que v4 solo salvaba por los pelos (11,1 <= 10,9 * 1,02 = 11,118). La
// formulación es de Alejandro (2026-08-21).
//
// Lo que NO trae: ni la zona de salida de v5, ni R7 (proceso frente a evento),
// ni R8 (la base no se salta su propio suelo). Siguen sin implementar.
//
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
  topeRepunteEnAncla: false,  // VARIANTE, apagada: ningún tramo intermedio puede
                              // ser más profundo que el ancla. No es un umbral
                              // nuevo — el tope es la primera contracción.
  maxContractions: 6,
  decreaseTol: 1.02,      // heredado de v4 y SIN USAR: la monotonía estricta la
                          // sustituye la puerta de la última contracción. Se deja
                          // para poder comparar los dos detectores con los mismos
                          // parámetros.
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

export function detectV6(bars, opts = {}) {
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
    // MONOTONÍA RELAJADA: un repunte intermedio ya no corta la secuencia.
    // La condición se comprueba una sola vez, al final, sobre la última.
    seq.push(leg);
    ceiling = Math.max(ceiling, leg.hi.p);
  }
  if (seq.length < p.minContractions) return rejL("menos_de_2_contracciones", ctx);

  // Variante medida en el documento, apagada por defecto.
  if (p.topeRepunteEnAncla && seq.some((s, k) => k > 0 && s.depth > seq[0].depth)) {
    return rejL("repunte_supera_el_ancla", { ...ctx, seq: seq.map((s) => +s.depth.toFixed(1)) });
  }

  // ── Monotonía relajada: la última es la más superficial ─────────────────
  // Sustituye a la comparación par a par de v4. Es una condición sobre la
  // secuencia entera, no sobre cada paso: da igual el camino, importa dónde
  // termina. Sin tolerancia — «la más superficial» quiere decir el mínimo.
  const profundidades = seq.map((s) => s.depth);
  const minProf = Math.min(...profundidades);
  if (seq.at(-1).depth > minProf) {
    return rejL("ultima_no_es_la_mas_superficial", { ...ctx,
      seq: profundidades.map((d) => +d.toFixed(1)),
      ultima: +seq.at(-1).depth.toFixed(1), masSuperficial: +minProf.toFixed(1) });
  }

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
    repunteIntermedio: seq.some((s, k) => k > 0 && s.depth > seq[k - 1].depth),
    repunteSobreTolerancia: seq.some((s, k) => k > 0 && s.depth > seq[k - 1].depth * p.decreaseTol),
    repuntaSobreElAncla: seq.some((s, k) => k > 0 && s.depth > seq[0].depth),
    fechas: seq.map((s) => `${s.hi.d}→${s.lo.d}`),
    primeraEnAtr: +(seq[0].depth / atr).toFixed(1),
    dispRatio: +dispRatio.toFixed(2),
    volRatio: volRatio === null ? null : +volRatio.toFixed(2),
    techo: +ceiling.toFixed(2),
  };
}
