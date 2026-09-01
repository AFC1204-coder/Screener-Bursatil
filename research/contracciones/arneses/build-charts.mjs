// Genera la página de etiquetado: gráficos diarios (velas + volumen),
// SIN ninguna marca del detector. Orden alfabético, deliberadamente neutro:
// no agrupa ni insinúa qué opina el detector de cada valor.
//
// La ventana visible coincide con la del detector v4: lookback (140) + media
// de 30 semanas (150) = 290 sesiones. Antes se fijaba FROM=2025-11-03 (199
// sesiones) y el dueño veía menos historia que el detector — NDAQ es el caso
// documentado en memory/corpus-etiquetado-ventana-del-grafico.md.
//
// Solo lee daily_bars. No escribe en Supabase.

import fs from "node:fs/promises";
import { supabaseRequestAll, supabaseConfig } from "@/lib/supabaseServer";
import { briefForSymbol } from "./chart-brief.mjs";

// Espejo de research/contracciones/detector/v4.mjs P.lookback / P.smaLen
const DETECTOR_LOOKBACK = 140;
const DETECTOR_SMA_LEN = 150;
const CHART_BARS = DETECTOR_LOOKBACK + DETECTOR_SMA_LEN;
const FETCH_ROWS = CHART_BARS + 30;

const TANDA3_DEFAULT =
  "APH,DELL,F,GE,HPE,MDLZ,MMM,MSI,NVDA,SCHW,STX,VLO";
// Doce valores fuera del corpus de 21; diseño original tanda 3 (avance/contexto).
// Override: SYMBOLS=... Excluir AAPL/JPM/MSFT/TXN/WELL (barras corruptas).

const SYMBOLS = (process.env.SYMBOLS || TANDA3_DEFAULT).split(",").map((s) => s.trim());
const TANDA = process.env.TANDA || "3";
const OUT = process.env.OUT || "/tmp/etiquetado-tanda3.html";
const PRICE_SCALE = (process.env.PRICE_SCALE || "log").toLowerCase(); // log | linear

const W = 1440, ML = 62, MR = 16, MT = 14;
const HP = 380;   // panel de precio
const GAP = 18;
const HV = 100;   // panel de volumen
const MB = 52;    // margen inferior (eje de fechas)
const H = MT + HP + GAP + HV + MB;
const PLOTW = W - ML - MR;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtPrice(v) {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

function fmtVol(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function log10(v) {
  return Math.log(v) / Math.LN10;
}

function priceDomain(bars, logScale) {
  const lows = bars.map((b) => b.l), highs = bars.map((b) => b.h);
  let pMin = Math.max(0.01, Math.min(...lows));
  let pMax = Math.max(...highs);
  if (logScale) {
    const pad = (log10(pMax) - log10(pMin)) * 0.04;
    pMin = Math.pow(10, log10(pMin) - pad);
    pMax = Math.pow(10, log10(pMax) + pad);
  } else {
    const pad = (pMax - pMin) * 0.04;
    pMin -= pad;
    pMax += pad;
  }
  return { pMin, pMax, logScale };
}

function yPrice(p, domain) {
  const { pMin, pMax, logScale } = domain;
  const t = logScale
    ? (log10(p) - log10(pMin)) / (log10(pMax) - log10(pMin))
    : (p - pMin) / (pMax - pMin);
  return MT + HP - t * HP;
}

function priceTicks(domain, nTicks = 6) {
  const { pMin, pMax, logScale } = domain;
  const ticks = [];
  for (let k = 0; k <= nTicks; k++) {
    ticks.push(logScale
      ? Math.pow(10, log10(pMin) + (log10(pMax) - log10(pMin)) * (k / nTicks))
      : pMin + ((pMax - pMin) * k) / nTicks);
  }
  return ticks;
}

function chartSvg(symbol, bars) {
  const n = bars.length;
  const barW = PLOTW / n;
  const bodyW = Math.max(2, barW * 0.62);
  const domain = priceDomain(bars, PRICE_SCALE === "log");
  const { pMin, pMax } = domain;
  const vMax = Math.max(...bars.map((b) => b.v || 0)) || 1;

  const x = (i) => ML + (i + 0.5) * barW;
  const yP = (p) => yPrice(p, domain);
  const vTop = MT + HP + GAP;
  const yV = (v) => vTop + HV - (v / vMax) * HV;

  const parts = [];

  // Rejilla horizontal de precio + etiquetas del eje Y
  for (const p of priceTicks(domain)) {
    const y = yP(p);
    parts.push(`<line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}" stroke="#e6e8ec" stroke-width="1"/>`);
    parts.push(`<text x="${ML - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#6b7280">${fmtPrice(p)}</text>`);
  }
  if (domain.logScale) {
    parts.push(`<text x="${W - MR}" y="${MT + 10}" text-anchor="end" font-size="9" fill="#9ca3af">log</text>`);
  }
  // Eje de volumen: solo el máximo, para no recargar
  parts.push(`<line x1="${ML}" y1="${vTop + HV}" x2="${W - MR}" y2="${vTop + HV}" stroke="#d1d5db" stroke-width="1"/>`);
  parts.push(`<text x="${ML - 8}" y="${(vTop + 10).toFixed(1)}" text-anchor="end" font-size="10" fill="#6b7280">${fmtVol(vMax)}</text>`);

  // Separadores de mes + etiqueta de mes
  let prevMonth = null;
  for (let i = 0; i < n; i++) {
    const m = bars[i].d.slice(0, 7);
    if (prevMonth !== null && m !== prevMonth) {
      const xx = (ML + i * barW).toFixed(1);
      parts.push(`<line x1="${xx}" y1="${MT}" x2="${xx}" y2="${vTop + HV}" stroke="#c7cbd1" stroke-width="1" stroke-dasharray="3 3"/>`);
      const mi = Number(bars[i].d.slice(5, 7)) - 1;
      parts.push(`<text x="${xx}" y="${MT - 3}" font-size="10" font-weight="600" fill="#374151">${MESES[mi]} ${bars[i].d.slice(2, 4)}</text>`);
    }
    prevMonth = m;
  }

  // Velas
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const up = b.c >= b.o;
    const col = up ? "#137333" : "#b3261e";
    const cx = x(i);
    parts.push(`<line x1="${cx.toFixed(1)}" y1="${yP(b.h).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yP(b.l).toFixed(1)}" stroke="${col}" stroke-width="1"/>`);
    const yo = yP(b.o), yc = yP(b.c);
    const top = Math.min(yo, yc);
    const hgt = Math.max(1, Math.abs(yc - yo));
    parts.push(`<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${up ? "#fff" : col}" stroke="${col}" stroke-width="1"/>`);
    // Volumen
    const vh = vTop + HV - yV(b.v || 0);
    parts.push(`<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${yV(b.v || 0).toFixed(1)}" width="${bodyW.toFixed(1)}" height="${Math.max(0.5, vh).toFixed(1)}" fill="${col}" opacity="0.5"/>`);
  }

  // Eje de fechas: una etiqueta cada 5 sesiones (día y mes legibles)
  for (let i = 0; i < n; i += 5) {
    const xx = x(i);
    const d = bars[i].d;
    parts.push(`<line x1="${xx.toFixed(1)}" y1="${vTop + HV}" x2="${xx.toFixed(1)}" y2="${vTop + HV + 4}" stroke="#9ca3af" stroke-width="1"/>`);
    parts.push(`<text x="${xx.toFixed(1)}" y="${vTop + HV + 16}" text-anchor="middle" font-size="9" fill="#4b5563">${d.slice(8, 10)}/${d.slice(5, 7)}</text>`);
  }

  // Capa de interacción: crosshair + tooltip con la fecha exacta
  parts.push(`<line class="chx" x1="0" y1="${MT}" x2="0" y2="${vTop + HV}" stroke="#111827" stroke-width="1" opacity="0"/>`);
  parts.push(`<rect class="hit" x="${ML}" y="${MT}" width="${PLOTW}" height="${HP + GAP + HV}" fill="transparent"/>`);

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet"
    data-symbol="${symbol}" data-ml="${ML}" data-plotw="${PLOTW}" data-n="${n}">${parts.join("")}</svg>`;
}

async function main() {
  const cfg = supabaseConfig();
  if (!cfg.configured) throw new Error(`Supabase no configurado: ${cfg.missing.join(", ")}`);

  const data = {};
  for (const symbol of SYMBOLS) {
    const rows = await supabaseRequestAll("daily_bars", {
      query: {
        select: "trade_date,open,high,low,close,volume",
        owner_id: `eq.${cfg.ownerId}`,
        symbol: `eq.${symbol}`,
        order: "trade_date.desc",
      },
      timeoutMs: 20000,
    }, { maxRows: FETCH_ROWS });
    const bars = rows
      .map((r) => ({
        d: String(r.trade_date).slice(0, 10),
        o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close),
        v: r.volume === null ? 0 : Number(r.volume),
      }))
      .filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite))
      .reverse();
    data[symbol] = bars.length > CHART_BARS ? bars.slice(-CHART_BARS) : bars;
    process.stderr.write(`${symbol}:${data[symbol].length} `);
  }
  process.stderr.write("\n");

  const cards = SYMBOLS.map((s) => {
    const bars = data[s];
    const { html: briefHtml } = briefForSymbol(s, bars);
    const scaleLabel = PRICE_SCALE === "log" ? " · escala log" : "";
    return `<section class="card" id="s-${s}">
  <header><h2>${esc(s)}</h2><span class="rango">${bars[0].d} → ${bars.at(-1).d} · ${bars.length} sesiones${scaleLabel}</span></header>
  ${briefHtml}
  <div class="chart">${chartSvg(s, bars)}<div class="tip"></div></div>
</section>`;
  }).join("\n");

  const nav = SYMBOLS.map((s) => `<a href="#s-${s}">${esc(s)}</a>`).join("");

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Etiquetado de bases — tanda ${esc(TANDA)}</title>
<style>
:root{--bg:#fff;--fg:#111827;--mut:#6b7280;--line:#e5e7eb}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
nav{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.96);
  border-bottom:1px solid var(--line);padding:8px 16px;display:flex;flex-wrap:wrap;gap:4px;
  backdrop-filter:blur(6px)}
nav a{padding:3px 9px;border:1px solid var(--line);border-radius:5px;text-decoration:none;
  color:var(--fg);font-size:12px;font-weight:600}
nav a:hover{background:#f3f4f6}
.intro{padding:16px;max-width:900px}
.intro h1{font-size:19px;margin:0 0 8px}
.intro p{margin:6px 0;color:#374151}
.intro code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12.5px}
.card{padding:14px 16px 26px;border-top:1px solid var(--line);scroll-margin-top:46px}
.card header{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}
.card h2{font-size:17px;margin:0;letter-spacing:.02em}
.rango{color:var(--mut);font-size:12px}
.brief{margin:0 0 10px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;max-width:1100px}
.brief h3{font-size:13px;margin:0 0 6px;font-weight:600}
.brief .tag{font-size:10px;font-weight:500;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;padding:1px 5px;margin-left:6px}
.brief p{margin:5px 0;font-size:13px;color:#374151;line-height:1.45}
.brief .q{margin:8px 0 4px;font-size:12.5px}
.brief ul{margin:0 0 0 18px;padding:0;font-size:12.5px;color:#4b5563}
.brief li{margin:2px 0}
.chart{position:relative}
.tip{position:absolute;pointer-events:none;background:#111827;color:#fff;padding:6px 9px;
  border-radius:6px;font-size:11.5px;line-height:1.45;white-space:pre;opacity:0;
  transition:opacity .08s;z-index:5;box-shadow:0 4px 14px rgba(0,0,0,.25)}
svg{display:block}
@media print{nav{display:none}.card{page-break-inside:avoid}}
</style></head><body>
<nav>${nav}</nav>
<div class="intro">
  <h1>Etiquetado a mano — tanda ${esc(TANDA)}</h1>
  <p>Gráfico diario, <strong>${CHART_BARS} sesiones</strong>, precio en <strong>escala ${PRICE_SCALE === "log" ? "logarítmica" : "lineal"}</strong>
  (las bases tempranas de etapa 2 se ven mejor en log; el volumen sigue lineal). Ventana alineada con v4.
  <strong>Sin marcas del detector</strong> en el dibujo.</p>
  <p>Debajo del título de cada valor hay una <strong>lectura propuesta</strong> (código MM30s + calificador
  Pre-fuga/Con fuga, como la ficha de producto; pullbacks diarios solo como pista). Es borrador para
  contrastar contigo — no sustituye tu etiqueta.</p>
  <p><strong>Pasa el ratón</strong> sobre el gráfico para OHLCV. Plantilla:
  <code>SYM · BASE|NO|POTENCIAL · PERIODO · nota</code></p>
</div>
${cards}
<script>
const DATA = ${JSON.stringify(data)};
const DIAS = ${JSON.stringify(DIAS)};
const MESES = ${JSON.stringify(MESES)};
function fmtVol(v){
  if(v>=1e9) return (v/1e9).toFixed(2)+'B';
  if(v>=1e6) return (v/1e6).toFixed(1)+'M';
  if(v>=1e3) return (v/1e3).toFixed(0)+'K';
  return String(v);
}
function fmtFecha(d){
  const dt = new Date(d+'T00:00:00Z');
  return DIAS[dt.getUTCDay()]+' '+Number(d.slice(8,10))+' '+MESES[Number(d.slice(5,7))-1]+' '+d.slice(0,4);
}
document.querySelectorAll('.chart').forEach((wrap)=>{
  const svg = wrap.querySelector('svg');
  const tip = wrap.querySelector('.tip');
  const hit = svg.querySelector('.hit');
  const chx = svg.querySelector('.chx');
  const sym = svg.dataset.symbol;
  const bars = DATA[sym];
  const ML = +svg.dataset.ml, PLOTW = +svg.dataset.plotw, N = +svg.dataset.n;
  const VB = svg.viewBox.baseVal;
  hit.addEventListener('mousemove', (ev)=>{
    const r = svg.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (VB.width / r.width);
    let i = Math.floor((sx - ML) / (PLOTW / N));
    if(i<0) i=0; if(i>=N) i=N-1;
    const b = bars[i];
    const cx = ML + (i + 0.5) * (PLOTW / N);
    chx.setAttribute('x1', cx); chx.setAttribute('x2', cx);
    chx.setAttribute('opacity', '0.35');
    tip.textContent = sym+'  '+fmtFecha(b.d)
      +'\\nA '+b.o.toFixed(2)+'   M '+b.h.toFixed(2)
      +'\\nm '+b.l.toFixed(2)+'   C '+b.c.toFixed(2)
      +'\\nVol '+fmtVol(b.v);
    tip.style.opacity='1';
    const px = (cx / VB.width) * r.width;
    tip.style.left = Math.min(Math.max(px+12, 0), r.width-150)+'px';
    tip.style.top = (ev.clientY - r.top + 12)+'px';
  });
  hit.addEventListener('mouseleave', ()=>{ tip.style.opacity='0'; chx.setAttribute('opacity','0'); });
});
</script>
</body></html>`;

  await fs.writeFile(OUT, html);
  console.log(`escrito: ${OUT}`);
  console.log(`tanda: ${TANDA} · ventana: ${CHART_BARS} sesiones · precio: ${PRICE_SCALE}`);
  console.log(`símbolos: ${SYMBOLS.join(", ")}`);
  for (const s of SYMBOLS) console.log(`  ${s.padEnd(6)} ${data[s].length} barras  ${data[s][0].d} → ${data[s].at(-1).d}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
