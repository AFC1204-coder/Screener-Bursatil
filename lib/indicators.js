// lib/indicators.js — indicadores puros sobre barras de precio, extraídos de app/page.jsx.
// Funciones movidas verbatim; el contrato de barras es descendente (b[0] = última sesión).
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const avgWithCoverage = (a, minCoverage = 0.8) => {
  if (!a.length) return null;
  const xs = a.filter(Number.isFinite);
  return xs.length / a.length >= minCoverage ? avg(xs) : null;
};
const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));
const sma = (b, n, o = 0) => b.length >= n + o ? avg(b.slice(o, o + n).map((x) => x.close)) : null;
const perf = (b, n) => b.length > n && b[0].close && b[n].close ? ((b[0].close / b[n].close) - 1) * 100 : null;
function hiLo(b, n) { const s = b.slice(0, Math.min(n, b.length)); return { hi: Math.max(...s.map((x) => x.high || x.close).filter(Number.isFinite)), lo: Math.min(...s.map((x) => x.low || x.close).filter(Number.isFinite)) }; }
function highValue(b, n) { return b.length ? hiLo(b, n).hi : null; }
function highDist(b, n) { if (b.length < 20) return null; const h = highValue(b, n); return h && b[0].close ? ((b[0].close / h) - 1) * 100 : null; }
function lowAdv(b, n) { if (b.length < 20) return null; const { lo } = hiLo(b, n); return lo && b[0].close ? ((b[0].close / lo) - 1) * 100 : null; }
function stdev(values = []) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - mean) ** 2)));
}
function dailyReturns(b, n = 63) {
  const out = [];
  for (let i = 0; i < Math.min(n, b.length - 1); i++) {
    const now = b[i]?.close;
    const prev = b[i + 1]?.close;
    if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) out.push((now / prev) - 1);
  }
  return out;
}
function annualizedVolatility(b, n = 63) {
  const sd = stdev(dailyReturns(b, n));
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}
function downsideVolatility(b, n = 63) {
  const negatives = dailyReturns(b, n).map((x) => Math.min(0, x));
  const sd = stdev(negatives);
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}
function maxDrawdown(b, n = 63) {
  const rows = b.slice(0, Math.min(n, b.length)).filter((x) => Number.isFinite(x.close)).reverse();
  if (rows.length < 2) return null;
  let peak = rows[0].close;
  let drawdown = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.close);
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - row.close) / peak) * 100);
  }
  return drawdown;
}
function maxDailyMovePct(b, n = 20) {
  const moves = dailyReturns(b, n).map((x) => Math.abs(x) * 100).filter(Number.isFinite);
  return moves.length ? Math.max(...moves) : null;
}
function dailyRangePcts(b, n = 20) {
  return b.slice(0, Math.min(n, b.length)).map((row) => {
    const high = firstFinite(row.high, row.close);
    const low = firstFinite(row.low, row.close);
    const close = firstFinite(row.close);
    return Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) && close > 0 ? ((high - low) / close) * 100 : null;
  }).filter(Number.isFinite);
}
function maxDailyRangePct(b, n = 20) {
  const ranges = dailyRangePcts(b, n);
  return ranges.length ? Math.max(...ranges) : null;
}
function avgDailyRangePct(b, n = 20) {
  const ranges = dailyRangePcts(b, n);
  return ranges.length ? avg(ranges) : null;
}
function priceRangePct(b, n = 63) {
  const rows = b.slice(0, Math.min(n, b.length)).filter((row) => Number.isFinite(row.high) && Number.isFinite(row.low) && row.low > 0);
  if (rows.length < Math.min(20, n)) return null;
  const high = Math.max(...rows.map((row) => row.high));
  const low = Math.min(...rows.map((row) => row.low));
  return low > 0 ? ((high / low) - 1) * 100 : null;
}
function riskAdjustedStats(b, perf3m) {
  const volatility63d = annualizedVolatility(b, 63);
  const downsideVolatility63d = downsideVolatility(b, 63);
  const maxDrawdown63d = maxDrawdown(b, 63);
  return {
    volatility63d,
    downsideVolatility63d,
    maxDrawdown63d,
    maxDailyMove20dPct: maxDailyMovePct(b, 20),
    maxDailyRange20dPct: maxDailyRangePct(b, 20),
    avgDailyRange20dPct: avgDailyRangePct(b, 20),
    range63dPct: priceRangePct(b, 63),
    returnToVol3m: Number.isFinite(perf3m) && volatility63d > 0 ? perf3m / volatility63d : null,
    returnToDownsideVol3m: Number.isFinite(perf3m) && downsideVolatility63d > 0 ? perf3m / downsideVolatility63d : null,
    returnToDrawdown3m: Number.isFinite(perf3m) && maxDrawdown63d > 0 ? perf3m / maxDrawdown63d : null,
  };
}
function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function firstFinite(...values) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function avgVolume(rows = [], minCoverage = 0.8) {
  return avgWithCoverage(rows.map((bar) => firstFinite(bar.volume)), minCoverage);
}
// Detecta series discontinuas: splits/contrasplits que el proveedor no
// ajusta (docs/splits-daily-bars-2026-08-09.md, docs/splits-eventos-2026-08-09.md).
// Compara SOLO barras consecutivas en el array (b[i] vs b[i+1]), nunca
// fechas de calendario — un hueco de fin de semana largo o una suspensión
// de cotización de varias semanas no es, por sí solo, un salto de precio;
// lo que se mide es el ratio entre el cierre de una sesión con barra y el
// de la sesión con barra inmediatamente anterior, sea cual sea la
// distancia en el calendario entre ambas. Contrato de `bars`: descendente,
// b[0] = sesión más reciente (mismo contrato que el resto de este
// archivo). Yahoo reporta eventos de split para 6 de 10 casos verificados,
// pero en ninguno el ratio/fecha reportado coincide con el salto real
// (docs/splits-eventos-2026-08-09.md Parte B) — por eso este detector
// infiere del precio, no del evento del proveedor.
function detectPriceDiscontinuities(bars = [], factorThreshold = 3) {
  const jumps = [];
  for (let i = 0; i < bars.length - 1; i++) {
    const newer = bars[i];
    const older = bars[i + 1];
    const c1 = Number(newer?.close);
    const c0 = Number(older?.close);
    if (!Number.isFinite(c1) || !Number.isFinite(c0) || c0 <= 0 || c1 <= 0) continue;
    const ratio = c1 / c0;
    const factor = ratio >= 1 ? ratio : 1 / ratio;
    if (factor >= factorThreshold) {
      jumps.push({
        date: newer.date,
        previousDate: older.date,
        factor,
        direction: ratio >= 1 ? "up" : "down",
        closeBefore: c0,
        closeAfter: c1,
      });
    }
  }
  jumps.sort((a, b) => b.factor - a.factor);
  return {
    discontinuous: jumps.length > 0,
    largestJump: jumps[0] || null,
    jumps,
  };
}
function udVol(b, n = 50) {
  let up = 0, down = 0, valid = 0;
  const limit = Math.min(n, b.length - 1);
  for (let i = 0; i < limit; i++) {
    const v = firstFinite(b[i].volume);
    if (!Number.isFinite(v)) continue;
    valid += 1;
    if (b[i].close >= b[i + 1].close) up += v;
    else down += v;
  }
  return limit && valid / limit >= 0.8 && down > 0 ? up / down : null;
}

// ── Nuevos máximos/mínimos relativos (docs/diseno-nuevos-maximos-minimos-2026-11.md, 2.2 y 2.3) ──
// Swing = pivote fractal sobre CIERRES (basis "close") con `radius` barras a cada lado, alternando
// altos y bajos como localPivots. La zona del máximo relativo es el cierre del pivote y la ruptura se
// confirma por cierre (una mecha que cierra por debajo no cuenta). Evento = primera barra que cierra
// por encima (por debajo) del último swing alto (bajo) confirmado; sin mirar al futuro.
export const NEW_EXTREMES_DEFAULTS = {
  daily: { radius: 3, lookback: 252, minBars: 60 },
  weekly: { radius: 2, lookback: 52, minBars: 30 },
};

function mondayKey(dateText = "") {
  const t = new Date(`${String(dateText).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t.getTime())) return "";
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

// Barras diarias descendentes → semanales ascendentes (cierre = último cierre de la semana).
function weeklyCloses(descBars) {
  const weeks = new Map();
  for (const b of [...descBars].reverse()) {
    const key = mondayKey(b.date);
    if (!key || !Number.isFinite(b.close)) continue;
    const w = weeks.get(key);
    if (w) { w.close = b.close; w.last = b.date; } else weeks.set(key, { key, close: b.close, last: b.date });
  }
  return [...weeks.values()];
}

function closePivots(closes, radius) {
  const raw = [];
  for (let i = radius; i < closes.length - radius; i += 1) {
    let isH = true;
    let isL = true;
    for (let k = 1; k <= radius; k += 1) {
      if (closes[i] < closes[i - k] || closes[i] < closes[i + k]) isH = false;
      if (closes[i] > closes[i - k] || closes[i] > closes[i + k]) isL = false;
    }
    if (isH) raw.push({ type: "high", index: i, price: closes[i] });
    if (isL) raw.push({ type: "low", index: i, price: closes[i] });
  }
  const merged = [];
  for (const p of raw) {
    const prev = merged[merged.length - 1];
    if (prev?.type === p.type) {
      if ((p.type === "high" && p.price > prev.price) || (p.type === "low" && p.price < prev.price)) merged[merged.length - 1] = p;
    } else merged.push(p);
  }
  return merged;
}

// bars: descendentes (b[0] = última), con { date, close }. Devuelve null si el dato no alcanza
// (nunca 0); si no, { timeframe, radius, partial, high, low } con high/low = null (sin evento) o
// { kind: "continuacion" | "giro" | "inicial", level } (level = cierre del swing roto).
function newExtremes(bars = [], { timeframe = "daily", radius, lookback, basis = "close" } = {}) {
  if (basis !== "close") return null;
  const cfg = NEW_EXTREMES_DEFAULTS[timeframe];
  if (!cfg) return null;
  const r = radius ?? cfg.radius;
  const look = lookback ?? cfg.lookback;
  const series = timeframe === "weekly" ? weeklyCloses(bars) : [...bars].reverse().filter((b) => Number.isFinite(b.close)).map((b) => ({ close: b.close, last: b.date }));
  if (series.length < cfg.minBars) return null;
  const closes = series.slice(-look).map((b) => b.close);
  const w = closes.length - 1;
  const swings = closePivots(closes, r);
  const probe = (type, broke) => {
    const list = swings.filter((p) => p.type === type);
    const sw = list[list.length - 1];
    if (!sw || !broke(closes[w], sw.price)) return null;
    for (let j = sw.index + 1; j < w; j += 1) if (broke(closes[j], sw.price)) return null; // ya roto antes: no es evento nuevo
    const prev = list[list.length - 2];
    const rising = type === "high" ? (prev ? sw.price > prev.price : null) : (prev ? sw.price < prev.price : null);
    return { kind: prev ? (rising ? "continuacion" : "giro") : "inicial", level: sw.price };
  };
  const lastDate = bars[0]?.date ? String(bars[0].date).slice(0, 10) : "";
  return {
    timeframe,
    radius: r,
    partial: timeframe === "weekly" && lastDate ? new Date(`${lastDate}T00:00:00Z`).getUTCDay() !== 5 : false,
    high: probe("high", (c, level) => c > level),
    low: probe("low", (c, level) => c < level),
  };
}

// Campos planos para la fila del nocturno: 1 = evento hoy, 0 = sin evento, null = dato insuficiente
// (nunca 0). Se descartan las barras de fin de semana (existen en la base y no son sesiones). Las dos
// copias de la fila (researchRow y materializedScanner) llaman aquí para que no diverjan.
const NEW_EXTREMES_FIELD_KEYS = ["newHighRelD", "newHighRelDKind", "newLowRelD", "newLowRelDKind", "newHighRelW", "newHighRelWKind", "newLowRelW", "newLowRelWKind", "newExtremesWPartial"];
function newExtremesFields(bars = []) {
  const sessions = bars.filter((b) => {
    const day = new Date(`${String(b?.date || "").slice(0, 10)}T00:00:00Z`).getUTCDay();
    return Number.isFinite(day) && day !== 0 && day !== 6;
  });
  const out = Object.fromEntries(NEW_EXTREMES_FIELD_KEYS.map((k) => [k, null]));
  for (const [suffix, timeframe] of [["D", "daily"], ["W", "weekly"]]) {
    const ev = newExtremes(sessions, { timeframe });
    if (!ev) continue;
    out[`newHighRel${suffix}`] = ev.high ? 1 : 0;
    out[`newHighRel${suffix}Kind`] = ev.high?.kind ?? null;
    out[`newLowRel${suffix}`] = ev.low ? 1 : 0;
    out[`newLowRel${suffix}Kind`] = ev.low?.kind ?? null;
    if (timeframe === "weekly") out.newExtremesWPartial = ev.partial;
  }
  return out;
}

export {
  avg,
  avgWithCoverage,
  clamp,
  sma,
  perf,
  hiLo,
  highValue,
  highDist,
  lowAdv,
  stdev,
  dailyReturns,
  annualizedVolatility,
  downsideVolatility,
  maxDrawdown,
  maxDailyMovePct,
  dailyRangePcts,
  maxDailyRangePct,
  avgDailyRangePct,
  priceRangePct,
  riskAdjustedStats,
  finiteNumber,
  firstFinite,
  avgVolume,
  udVol,
  detectPriceDiscontinuities,
  newExtremes,
  newExtremesFields,
  NEW_EXTREMES_FIELD_KEYS,
};
