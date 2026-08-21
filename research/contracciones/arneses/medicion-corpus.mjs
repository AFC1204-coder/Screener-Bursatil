// Medición del detector v4 (y v5) contra los 21 casos de corpus-manual.json.
//
// A diferencia de v5-test.mjs, que solo compara el sí/no, este arnés compara
// también LAS FECHAS: un caso donde el veredicto coincide pero la estructura
// está en otro sitio es un acierto parcial que esconde un problema.
//
// Además calcula, para los 21, las magnitudes con las que se podrían formular
// las reglas pendientes (R1 lateral perpetuo, R2 anidamiento, R3 calidad del
// trazo), para poder ver si separan o no. Solo lee daily_bars.

import fs from "node:fs";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { detectV4 } from "../detector/v4.mjs";
import { detectV5 } from "../detector/v5.mjs";

// v4 no exporta sus internos; se reimporta instrumentado desde el propio
// fichero para no duplicar la lógica ni tocar el detector.
const srcV4 = fs.readFileSync(new URL("../detector/v4.mjs", import.meta.url), "utf8")
  .replace("function pivots(", "export function pivots(")
  .replace("function atrPct(", "export function atrPct(")
  .replace("const P = {", "export const P = {");
const V4i = await import("data:text/javascript;base64," + Buffer.from(srcV4).toString("base64"));

const corpus = JSON.parse(fs.readFileSync(new URL("../corpus-manual.json", import.meta.url), "utf8"));
const cfg = supabaseConfig();

const cache = new Map();
async function barsFor(sym) {
  if (cache.has(sym)) return cache.get(sym);
  const rows = await supabaseRequestAll("daily_bars", {
    query: { select: "trade_date,open,high,low,close,adj_close,volume",
             owner_id: `eq.${cfg.ownerId}`, symbol: `eq.${sym}`, order: "trade_date.asc" },
    timeoutMs: 20000 }, { maxRows: 5000 });
  const bars = rows.map((r) => ({
    d: String(r.trade_date).slice(0, 10), o: Number(r.open), h: Number(r.high),
    l: Number(r.low), c: Number(r.adj_close ?? r.close),
    v: r.volume === null ? 0 : Number(r.volume),
  })).filter((b) => Number.isFinite(b.c) && b.c > 0);
  cache.set(sym, bars);
  return bars;
}

const idxDe = (bars, fecha) => {
  if (!fecha) return null;
  const f = String(fecha).slice(0, 10);
  // la etiqueta puede venir como "2026-06" (mes sin día)
  let mejor = null;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].d.startsWith(f)) { mejor = i; break; }
    if (bars[i].d < f) mejor = i;                 // último día previo
  }
  return mejor;
};

// ── magnitudes candidatas para las reglas pendientes ──────────────────────
function metricas(bars, seqIdx) {
  const last = bars.length - 1;
  const cl = bars.map((b) => b.c);

  const i130 = Math.max(0, last - 129);
  const avance130 = (cl[last] / cl[i130] - 1) * 100;

  const w52 = bars.slice(Math.max(0, last - 251));
  const hi52 = Math.max(...w52.map((b) => b.h));
  const lo52 = Math.min(...w52.map((b) => b.l));
  const rango52 = (hi52 - lo52) / hi52 * 100;
  const techoVsMax52 = cl[last] / hi52 * 100;

  // eficiencia de Kaufman sobre 130 sesiones: recorrido neto / recorrido bruto.
  // Un trazo limpio recorre poco para avanzar mucho; uno errático, al revés.
  let bruto = 0;
  for (let i = i130 + 1; i <= last; i++) bruto += Math.abs(cl[i] - cl[i - 1]);
  const eficiencia = bruto > 0 ? Math.abs(cl[last] - cl[i130]) / bruto : null;

  // densidad de pivotes: cuántos giros por 100 sesiones en la ventana del detector
  const from = Math.max(1, bars.length - 140);
  const pv = V4i.pivots(bars, from, last, 3);
  const densidadPivotes = pv.length / (last - from + 1) * 100;

  // ruido barra a barra: mediana de |apertura - cierre previo| / ATR%
  const gaps = [];
  for (let i = Math.max(1, last - 129); i <= last; i++) {
    const pc = cl[i - 1];
    if (pc > 0) gaps.push(Math.abs(bars[i].o - pc) / pc * 100);
  }
  gaps.sort((a, b) => a - b);
  const atr20 = V4i.atrPct(bars, last, 20);
  const gapMed = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const gapVsAtr = atr20 ? gapMed / atr20 : null;

  // ── anidamiento: ¿la estructura detectada vive dentro de otra mayor sin
  //    resolver? Estructura mayor = desde el máximo más alto de 250 sesiones.
  let anid = null;
  if (seqIdx) {
    const { hiIdx, loIdx } = seqIdx;
    const techoSeq = Math.max(...hiIdx.map((i) => bars[i].h));
    const sueloSeq = Math.min(...loIdx.map((i) => bars[i].l));
    const profSeq = (techoSeq - sueloSeq) / techoSeq * 100;
    let iMax = 0;
    for (let i = Math.max(0, last - 251); i <= last; i++) if (bars[i].h > bars[iMax].h) iMax = i;
    const maxMayor = bars[iMax].h;
    let minTrasMax = Infinity;
    for (let i = iMax; i <= last; i++) minTrasMax = Math.min(minTrasMax, bars[i].l);
    const profMayor = (maxMayor - minTrasMax) / maxMayor * 100;
    anid = {
      profSeq: +profSeq.toFixed(1),
      profMayor: +profMayor.toFixed(1),
      pesoRel: profMayor > 0 ? +(profSeq / profMayor).toFixed(2) : null,
      techoSeqVsMaxMayor: +(techoSeq / maxMayor * 100).toFixed(1),
      mayorSinResolver: cl[last] < maxMayor,
      fechaMaxMayor: bars[iMax].d,
      duracionSeqBarras: loIdx.at(-1) - hiIdx[0],
    };
  }

  return {
    avance130: +avance130.toFixed(1),
    rango52: +rango52.toFixed(1),
    precioVsMax52: +techoVsMax52.toFixed(1),
    eficiencia: eficiencia === null ? null : +eficiencia.toFixed(3),
    densidadPivotes: +densidadPivotes.toFixed(1),
    gapVsAtr: gapVsAtr === null ? null : +gapVsAtr.toFixed(2),
    atr20: atr20 === null ? null : +atr20.toFixed(2),
    anid,
  };
}


// ── geometría interna de la secuencia detectada ───────────────────────────
// Mide lo que la secuencia de profundidades por sí sola no dice: si los
// mínimos suben o se perforan, si el techo cae, si hay huecos temporales
// entre tramos, y si el mínimo real de la ventana queda FUERA de la
// secuencia (síntoma de que se han pegado dos estructuras distintas).
function geometria(bars, seqIdx) {
  if (!seqIdx) return null;
  const { hiIdx, loIdx } = seqIdx;
  const last = bars.length - 1;
  const minimos = loIdx.map((i) => bars[i].l);
  const techos = hiIdx.map((i) => bars[i].h);

  let perforacion = 0, dondePerfora = null;
  for (let k = 1; k < minimos.length; k++) {
    const p = (minimos[k - 1] - minimos[k]) / minimos[k - 1] * 100;
    if (p > perforacion) { perforacion = p; dondePerfora = bars[loIdx[k]].d; }
  }
  let techoCae = 0;
  for (let k = 1; k < techos.length; k++) {
    const c = (techos[k - 1] - techos[k]) / techos[k - 1] * 100;
    if (c > techoCae) techoCae = c;
  }
  let hueco = 0, dondeHueco = null;
  for (let k = 1; k < hiIdx.length; k++) {
    const h = hiIdx[k] - loIdx[k - 1];
    if (h > hueco) { hueco = h; dondeHueco = `${bars[loIdx[k - 1]].d}→${bars[hiIdx[k]].d}`; }
  }
  // mínimo más bajo de toda la ventana de la base, esté o no en la secuencia
  let iMinVent = hiIdx[0];
  for (let i = hiIdx[0]; i <= last; i++) if (bars[i].l < bars[iMinVent].l) iMinVent = i;
  const minSeq = Math.min(...minimos);
  const fuera = (minSeq - bars[iMinVent].l) / minSeq * 100;


  // ¿la caída es un PROCESO o un EVENTO? Una contracción reparte la caída a lo
  // largo de sesiones; un gap por noticia la concentra en una barra.
  const tramoInfo = hiIdx.map((hi, k) => {
    const lo = loIdx[k];
    const prof = (bars[hi].h - bars[lo].l) / bars[hi].h * 100;
    let peorBarra = 0;
    for (let i = hi + 1; i <= lo; i++) {
      const cae = (bars[i - 1].c - bars[i].c) / bars[i - 1].c * 100;
      if (cae > peorBarra) peorBarra = cae;
    }
    return { barras: lo - hi, profPct: +prof.toFixed(1),
             peorBarraPct: +peorBarra.toFixed(1),
             concentracion: prof > 0 ? +(peorBarra / prof).toFixed(2) : null };
  });

  // regla profundidad-tiempo del libro (TLSMW p.212), la que ya usa v3:
  //    semanas exigidas = 3 + 0,8 · max(0, profundidad% − 15)
  const techoSeq = Math.max(...techos), sueloSeq = Math.min(...minimos);
  const profTotal = (techoSeq - sueloSeq) / techoSeq * 100;
  const semanasExigidas = 3 + 0.8 * Math.max(0, profTotal - 15);
  const semanasHasta = (last - hiIdx[0]) / 5;
  const semanasSeq = (loIdx.at(-1) - hiIdx[0]) / 5;

  return {
    tramoInfo,
    minimos: minimos.map((v) => +v.toFixed(2)),
    techos: techos.map((v) => +v.toFixed(2)),
    perforacionPct: +perforacion.toFixed(2), dondePerfora,
    techoCaePct: +techoCae.toFixed(2),
    huecoBarras: hueco, dondeHueco,
    minFueraPct: +fuera.toFixed(2), fechaMinVentana: bars[iMinVent].d,
    profTotal: +profTotal.toFixed(1),
    semanasExigidas: +semanasExigidas.toFixed(1),
    semanasSeq: +semanasSeq.toFixed(1),
    semanasHastaCorte: +semanasHasta.toFixed(1),
    cumpleTiempo: semanasHasta >= semanasExigidas,
  };
}

// ── zona de salida de v3, evaluada SIEMPRE (aunque v4 no la use) ──────────
function zonaSalida(bars, seqIdx, atr) {
  if (!seqIdx) return null;
  const last = bars.length - 1;
  const techoSeq = Math.max(...seqIdx.hiIdx.map((i) => bars[i].h));
  const sueloSeq = Math.min(...seqIdx.loIdx.map((i) => bars[i].l));
  const profSeq = (techoSeq - sueloSeq) / techoSeq * 100;
  const cl = (v) => Math.min(12, Math.max(1, v));
  const up = cl(0.80 * Math.pow(Math.max(0.01, atr), 0.55) * Math.pow(Math.max(0.01, profSeq), 0.35));
  const dn = cl(1.05 * Math.pow(Math.max(0.01, atr), 0.80) * Math.pow(Math.max(0.01, profSeq), 0.10));
  const hiLim = techoSeq * (1 + up / 100), loLim = sueloSeq * (1 - dn / 100);
  let uc = 0, dc = 0, salida = null;
  for (let i = seqIdx.hiIdx[0] + 1; i <= last; i++) {
    uc = bars[i].c > hiLim ? uc + 1 : 0;
    dc = bars[i].c < loLim ? dc + 1 : 0;
    if (uc >= 2) { salida = { i, tipo: "ruptura" }; break; }
    if (dc >= 2) { salida = { i, tipo: "rotura" }; break; }
  }
  return { banda: `+${up.toFixed(1)}/-${dn.toFixed(1)}%`,
           salida: salida ? bars[salida.i].d : null,
           tipo: salida ? salida.tipo : null,
           hace: salida ? last - salida.i : null,
           caduca: salida ? (last - salida.i) > 10 : false };
}

const out = [];
for (const caso of corpus.casos) {
  const todas = await barsFor(caso.symbol);
  const bars = todas.filter((b) => b.d <= caso.asOf);
  const last = bars.length - 1;
  const r4 = detectV4(bars), r5 = detectV5(bars);

  // reconstruye los índices de la secuencia detectada a partir de sus fechas
  let seqIdx = null;
  if (r4.base && r4.fechas) {
    const hiIdx = [], loIdx = [];
    for (const f of r4.fechas) {
      const [a, b] = f.split("→");
      hiIdx.push(bars.findIndex((x) => x.d === a));
      loIdx.push(bars.findIndex((x) => x.d === b));
    }
    if (!hiIdx.includes(-1) && !loIdx.includes(-1)) seqIdx = { hiIdx, loIdx };
  }

  const m = metricas(bars, seqIdx);
  const g = geometria(bars, seqIdx);
  const z = seqIdx ? zonaSalida(bars, seqIdx, r4.atr ?? m.atr20) : null;

  // comparación de fechas contra la etiqueta
  const tramos = caso.tramos ?? [];
  let cmp = null;
  if (seqIdx && tramos.length && tramos[0].max) {
    const iMaxEt = idxDe(bars, tramos[0].max);
    const iMinEt = idxDe(bars, tramos.at(-1).min);
    const dAncla = iMaxEt === null ? null : seqIdx.hiIdx[0] - iMaxEt;
    const dFin = iMinEt === null ? null : seqIdx.loIdx.at(-1) - iMinEt;
    // solape de intervalos [inicio,fin]
    let solape = null;
    if (iMaxEt !== null && iMinEt !== null) {
      const a0 = seqIdx.hiIdx[0], a1 = seqIdx.loIdx.at(-1), b0 = iMaxEt, b1 = iMinEt;
      const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
      const union = Math.max(a1, b1) - Math.min(a0, b0);
      solape = union > 0 ? +(inter / union).toFixed(2) : null;
    }
    cmp = { nDet: r4.contracciones.length, nEt: tramos.length,
            dAnclaSesiones: dAncla, dFinSesiones: dFin, solape };
  }

  out.push({
    id: caso.id, symbol: caso.symbol, asOf: caso.asOf, tanda: caso.tanda,
    etiqueta: caso.veredicto,
    v4: r4.base ? "BASE" : "no", motivo4: r4.reason,
    v5: r5.base ? "BASE" : "no", motivo5: r5.reason,
    ok4: (r4.base && caso.veredicto === "BASE") || (!r4.base && caso.veredicto === "NO"),
    ok5: (r5.base && caso.veredicto === "BASE") || (!r5.base && caso.veredicto === "NO"),
    contracciones: r4.contracciones ?? null,
    fechasDet: r4.fechas ?? null,
    fechasEt: tramos.length ? tramos.map((t) => `${t.max ?? "?"}→${t.min ?? "?"}`) : null,
    primeraEnAtr: r4.primeraEnAtr ?? null, dispRatio: r4.dispRatio ?? null,
    volRatio: r4.volRatio ?? null, atrBase: r4.atr ?? null,
    smaSlopePct: r4.smaSlopePct ?? null,
    legs: r4.legs ?? null, mejor: r4.mejor ?? null, seqRech: r4.seq ?? null, corta: r4.corta ?? null,
    cmpFechas: cmp, metricas: m, zona: z, geo: g,
    barras: bars.length, ultimaBarra: bars[last]?.d,
  });
}

fs.writeFileSync(new URL("../resultados/medicion-v4-corpus.json", import.meta.url),
  JSON.stringify(out, null, 2));

// ── salida por consola ────────────────────────────────────────────────────
const pad = (s, n) => String(s ?? "").padEnd(n);
console.log("\n### VEREDICTO Y ESTRUCTURA ###");
for (const r of out) {
  const marca = r.ok4 ? "ok" : (r.etiqueta === "BASE" ? "FN" : "FP");
  console.log(`\n${marca}  ${pad(r.id, 20)} dueño=${pad(r.etiqueta, 5)} v4=${pad(r.v4, 5)} (${r.motivo4})  v5=${r.v5} (${r.motivo5})`);
  if (r.contracciones) console.log(`      det : [${r.contracciones.join(" → ")}]  ${r.fechasDet.join("  ")}`);
  else if (r.legs) console.log(`      legs: ${r.legs.join("  ")}${r.mejor ? `   mejor 1ª=${r.mejor}x ATR` : ""}${r.seqRech ? `  seq=[${r.seqRech}] corta=${r.corta}` : ""}`);
  if (r.fechasEt) console.log(`      due : ${r.fechasEt.join("  ")}`);
  if (r.cmpFechas) console.log(`      cmp : n ${r.cmpFechas.nDet} vs ${r.cmpFechas.nEt} · ancla ${r.cmpFechas.dAnclaSesiones >= 0 ? "+" : ""}${r.cmpFechas.dAnclaSesiones} ses · fin ${r.cmpFechas.dFinSesiones >= 0 ? "+" : ""}${r.cmpFechas.dFinSesiones} ses · solape ${r.cmpFechas.solape}`);
  if (r.geo) console.log(`      geo : mín [${r.geo.minimos.join(" ")}] perfora ${r.geo.perforacionPct}%${r.geo.dondePerfora ? " el " + r.geo.dondePerfora : ""} · techo cae ${r.geo.techoCaePct}% · hueco ${r.geo.huecoBarras} ses${r.geo.dondeHueco ? " (" + r.geo.dondeHueco + ")" : ""} · mín fuera ${r.geo.minFueraPct}% (${r.geo.fechaMinVentana})`);
  if (r.geo) console.log(`      trmo: ${r.geo.tramoInfo.map((t) => `${t.barras}b ${t.profPct}% (peor barra ${t.peorBarraPct}% = ${Math.round((t.concentracion ?? 0) * 100)}%)`).join(" · ")}`);
  if (r.geo) console.log(`      tpo : prof total ${r.geo.profTotal}% → exige ${r.geo.semanasExigidas} sem · lleva ${r.geo.semanasHastaCorte} sem ${r.geo.cumpleTiempo ? "✓" : "✗ INMADURA"}`);
  if (r.zona) console.log(`      zona: banda ${r.zona.banda} · salida ${r.zona.salida ?? "ninguna"}${r.zona.salida ? ` (${r.zona.tipo}, hace ${r.zona.hace}${r.zona.caduca ? ", CADUCA" : ""})` : ""}`);
}

console.log("\n\n### GEOMETRÍA DE LAS 13 SECUENCIAS DETECTADAS ###");
console.log(pad("caso", 20) + pad("et", 5) + pad("perfora%", 10) + pad("techoCae%", 11)
  + pad("hueco", 7) + pad("minFuera%", 11) + pad("prof%", 7) + pad("exige", 7) + pad("lleva", 7) + "tiempo");
for (const r of out) {
  if (!r.geo) continue;
  console.log(pad(r.id, 20) + pad(r.etiqueta, 5) + pad(r.geo.perforacionPct, 10)
    + pad(r.geo.techoCaePct, 11) + pad(r.geo.huecoBarras, 7) + pad(r.geo.minFueraPct, 11)
    + pad(r.geo.profTotal, 7) + pad(r.geo.semanasExigidas, 7) + pad(r.geo.semanasHastaCorte, 7)
    + (r.geo.cumpleTiempo ? "ok" : "INMADURA"));
}

console.log("\n\n### ¿PROCESO O EVENTO? tramo 1 y tramos de una sola barra ###");
console.log(pad("caso", 20) + pad("et", 5) + pad("t1 barras", 11) + pad("t1 prof%", 10)
  + pad("peor barra", 12) + pad("concentr.", 11) + pad("tramos<=1b", 12) + "reduccion 1ª→2ª");
for (const r of out) {
  if (!r.geo) continue;
  const t = r.geo.tramoInfo;
  const cortos = t.filter((x) => x.barras <= 1).length;
  const red = t.length > 1 ? `${Math.round((1 - t[1].profPct / t[0].profPct) * 100)}%` : "-";
  console.log(pad(r.id, 20) + pad(r.etiqueta, 5) + pad(t[0].barras, 11) + pad(t[0].profPct, 10)
    + pad(t[0].peorBarraPct + "%", 12) + pad(Math.round((t[0].concentracion ?? 0) * 100) + "%", 11)
    + pad(cortos, 12) + red);
}

console.log("\n\n### MAGNITUDES PARA LAS REGLAS PENDIENTES ###");
console.log(pad("caso", 20) + pad("et", 5) + pad("v4", 5) + pad("av130%", 8) + pad("rg52%", 7)
  + pad("efic", 7) + pad("piv/100", 9) + pad("gap/atr", 9) + pad("pesoRel", 9) + pad("techo/mayor", 12) + "dur");
for (const r of out) {
  const a = r.metricas.anid;
  console.log(pad(r.id, 20) + pad(r.etiqueta, 5) + pad(r.v4, 5)
    + pad(r.metricas.avance130, 8) + pad(r.metricas.rango52, 7)
    + pad(r.metricas.eficiencia, 7) + pad(r.metricas.densidadPivotes, 9)
    + pad(r.metricas.gapVsAtr, 9)
    + pad(a?.pesoRel ?? "-", 9) + pad(a?.techoSeqVsMaxMayor ?? "-", 12) + (a?.duracionSeqBarras ?? "-"));
}
