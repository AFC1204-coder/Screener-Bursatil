// lib/longHistory.js — métricas de contexto de LARGO PLAZO por símbolo.
//
// Por qué existe: daily_bars guarda ~400 barras diarias (~1,6 años) y las filas
// del escaneo solo tienen perf3m/6m/12m. `distanceATH` NO es máximo histórico
// (se calcula sobre las barras de cálculo, ~2 años). Para distinguir «máximos
// históricos de verdad con tendencia alcista sostenida» de «alcista a medio
// plazo con gráfico largo sucio» hace falta el histórico entero, que solo
// existe en Yahoo (`period1=0`, `interval=1wk`; ver fetchYahooFullHistoryChart).
//
// Este módulo es PURO (sin red ni base de datos): recibe las barras semanales y
// devuelve las métricas. Lo usan el script del lote (scripts/long-history.mjs),
// researchRow y materializedScanner (vía projectLongHistoryFields, para que las
// dos copias de la fila lleven exactamente los mismos campos).
//
// Convenciones:
//  - Las barras vienen de Yahoo ajustadas por splits Y dividendos (adjclose),
//    igual que el gráfico «Max»: los rendimientos son de retorno total.
//  - Todo en porcentaje (no fracción) y redondeado a 2 decimales, como el resto
//    de campos de la fila. Un dato no medible es null, nunca 0.
//  - Los horizontes se miden por FECHA (no por número de barras): una semana
//    festiva o un hueco no desplaza el horizonte.

export const LONG_HISTORY_VERSION = "long-history-v1";

const DAY_MS = 86400000;
const YEAR_DAYS = 365.25;
// Tolerancia al ubicar la barra de un horizonte: si la primera barra de la
// serie es posterior al objetivo en más de esto, la serie no cubre el horizonte.
const HORIZON_TOLERANCE_DAYS = 21;
const SMA_WEEKS = 200;
const SLOPE_LOOKBACK_WEEKS = 26;
const MIN_TREND_YEARS = 3;
const TREND_WINDOW_YEARS = 5;
const MIN_BARS_OK = 26;
// Una serie cuya última barra es más vieja que esto está deslistada/suspendida.
export const STALE_AFTER_DAYS = 21;
// Salto semanal sospechoso de split no ajustado: cierre ×0,4 o ×2,5 de una
// semana a la siguiente sin un evento de split cercano.
const JUMP_DOWN = 0.4;
const JUMP_UP = 2.5;
// Un salto sin split que cae a más de esto del final se considera un defecto
// ANTIGUO del proveedor (split no ajustado: SHEL.L 1997, ASML 1999, medido el
// 2026-11-08) y se descarta la historia previa. Uno más reciente se conserva
// porque casi siempre es un movimiento real (hundimiento tras resultados, etc.)
// y descartar la historia anterior falsearía el máximo histórico.
const OLD_JUMP_YEARS = 12;
// Yahoo fija a 1970-01-01 el inicio de las series que arrancan antes de 1970
// (BA, GE: 2.968 barras «desde 1970-01-01» con firstTradeDate en 1962).
const EPOCH_CLAMP_T = Date.UTC(1970, 1, 1);
// Las barras de un valor reciente deben empezar cerca de su primera cotización.
const FIRST_TRADE_TOLERANCE_DAYS = 45;

export const LONG_HISTORY_STATUS = Object.freeze({
  ok: "ok",
  short: "short", // < 1 año de historia: solo métricas que no necesitan horizonte
  stale: "stale", // última barra vieja → deslistado/suspendido; no se proyecta
  suspect: "suspect", // saltos sin split: serie no fiable; no se proyecta
  empty: "empty",
});

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

function pct(from, to) {
  return Number.isFinite(from) && Number.isFinite(to) && from > 0 ? ((to / from) - 1) * 100 : null;
}

function ts(date) {
  const t = Date.parse(String(date).slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(t) ? t : NaN;
}

function isoDate(t) {
  return new Date(t).toISOString().slice(0, 10);
}

/** Normaliza a barras válidas ascendentes por fecha {t,date,high,low,close}. */
export function normalizeWeeklyBars(bars = []) {
  const byDate = new Map();
  for (const bar of Array.isArray(bars) ? bars : []) {
    const t = ts(bar?.date);
    const close = Number(bar?.close);
    if (!Number.isFinite(t) || !Number.isFinite(close) || close <= 0) continue;
    const high = Number(bar?.high);
    const low = Number(bar?.low);
    byDate.set(t, {
      t,
      date: isoDate(t),
      close,
      // high/low incoherentes con el cierre (p. ej. high sin ajustar por split, SHEL.L 1997) → cierre.
      high: Number.isFinite(high) && high >= close * 0.999 && high <= close * 2.5 ? high : close,
      low: Number.isFinite(low) && low > 0 && low <= close * 1.001 && low >= close / 2.5 ? low : close,
    });
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t);
}

/** Cierre de la última barra con fecha ≤ target; null si la serie no llega hasta el horizonte. */
function closeAtOrBefore(series, target) {
  if (!series.length || series[0].t > target + HORIZON_TOLERANCE_DAYS * DAY_MS) return null;
  let lo = 0;
  let hi = series.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= target) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 ? series[found].close : series[0].close;
}

// Años de CALENDARIO (misma fecha N años antes), no N×365,25 días: así un
// «1 año» desde el 2026-11-06 apunta al 2025-11-06 y no a 6 horas antes.
function yearsAgo(asOfT, years) {
  const d = new Date(asOfT);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.getTime();
}

function findJumps(series, splitEvents = []) {
  const splitTimes = (Array.isArray(splitEvents) ? splitEvents : [])
    .map((event) => ts(event?.date))
    .filter(Number.isFinite);
  const jumps = [];
  for (let i = 1; i < series.length; i += 1) {
    const ratio = series[i].close / series[i - 1].close;
    if (ratio > JUMP_DOWN && ratio < JUMP_UP) continue;
    const nearSplit = splitTimes.some((t) => Math.abs(t - series[i].t) <= 14 * DAY_MS);
    if (!nearSplit) jumps.push({ index: i, t: series[i].t, ratio });
  }
  return jumps;
}

function maxDrawdownPct(series) {
  let peak = -Infinity;
  let worst = 0;
  for (const bar of series) {
    if (bar.close > peak) peak = bar.close;
    const dd = (bar.close / peak - 1) * 100;
    if (dd < worst) worst = dd;
  }
  return worst;
}

// Regresión lineal de ln(cierre) sobre el tiempo (en años). Devuelve la
// pendiente anualizada en % y R² (0–1): cuánto de la trayectoria es una línea.
function logTrend(series) {
  const n = series.length;
  if (n < 20) return { slopeAnnPct: null, r2: null };
  const x = series.map((bar) => (bar.t - series[0].t) / (YEAR_DAYS * DAY_MS));
  const y = series.map((bar) => Math.log(bar.close));
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return { slopeAnnPct: null, r2: null };
  const slope = sxy / sxx;
  return { slopeAnnPct: (Math.exp(slope) - 1) * 100, r2: (sxy * sxy) / (sxx * syy) };
}

/**
 * Calcula las métricas de largo plazo.
 * @param bars  barras semanales (cualquier orden): {date, high, low, close}
 * @param opts  { asOf?: 'YYYY-MM-DD' (por defecto la última barra), price?: precio vivo,
 *                splitEvents?: [{date,ratio}], now?: Date (para el test de caducidad) }
 */
export function computeLongHistoryStats(bars = [], opts = {}) {
  const allBars = normalizeWeeklyBars(bars);
  if (!allBars.length) return { status: LONG_HISTORY_STATUS.empty, version: LONG_HISTORY_VERSION };

  const last = allBars[allBars.length - 1];
  const nowT = opts.now instanceof Date ? opts.now.getTime() : Date.now();
  const staleDays = Math.floor((nowT - last.t) / DAY_MS);
  // Una barra semanal lleva la fecha del lunes de su semana: 7 días de margen.
  const base = {
    version: LONG_HISTORY_VERSION,
    asOf: opts.asOf || last.date,
    lastBarDate: last.date,
    barCount: allBars.length,
  };
  if (staleDays - 7 > STALE_AFTER_DAYS) return { ...base, status: LONG_HISTORY_STATUS.stale, staleDays };

  // Saltos sin split: los antiguos truncan la historia previa; los recientes se cuentan.
  const jumps = findJumps(allBars, opts.splitEvents);
  const lastT = last.t;
  const oldJumps = jumps.filter((j) => (lastT - j.t) / (YEAR_DAYS * DAY_MS) > OLD_JUMP_YEARS);
  let truncatedAt = null;
  let work = allBars;
  if (oldJumps.length) {
    const cut = oldJumps[oldJumps.length - 1];
    work = allBars.slice(cut.index);
    truncatedAt = work[0].date;
  }
  const recentJumps = jumps.length - oldJumps.length;
  if (truncatedAt && (work.length < MIN_BARS_OK || (work[work.length - 1].t - work[0].t) / (YEAR_DAYS * DAY_MS) < 1)) {
    return { ...base, status: LONG_HISTORY_STATUS.suspect, suspectJumps: jumps.length, truncatedAt };
  }
  const startClamped = work[0].t < EPOCH_CLAMP_T && truncatedAt === null;
  const firstTradeT = Number.isFinite(Number(opts.firstTradeDate)) ? Number(opts.firstTradeDate) * 1000 : NaN;
  // «Desde la salida a bolsa» solo si la serie realmente arranca en la primera cotización.
  const startsAtIpo = !startClamped && truncatedAt === null
    && (!Number.isFinite(firstTradeT) || work[0].t - firstTradeT <= FIRST_TRADE_TOLERANCE_DAYS * DAY_MS);
  const quality = { truncatedAt, recentJumps, startClamped };

  const series = work;
  const asOfT = Number.isFinite(ts(opts.asOf)) ? ts(opts.asOf) : last.t;
  const price = Number.isFinite(Number(opts.price)) && Number(opts.price) > 0 ? Number(opts.price) : last.close;

  // Máximo histórico verdadero: el mayor high de TODA la serie (o el precio vivo si lo supera).
  let athBar = series[0];
  for (const bar of series) if (bar.high >= athBar.high) athBar = bar;
  const athValue = Math.max(athBar.high, price);
  const athDate = price > athBar.high ? last.date : athBar.date;

  const historyYears = (asOfT - series[0].t) / (YEAR_DAYS * DAY_MS);
  const ret = (years) => {
    const from = closeAtOrBefore(series, yearsAgo(asOfT, years));
    return from == null ? null : round(pct(from, price));
  };

  // «Años bajistas» en los últimos 10: bloques consecutivos de 52 semanas hacia
  // atrás; solo cuentan los bloques que la serie cubre por completo.
  let downYears = 0;
  let coveredYears = 0;
  for (let k = 0; k < 10; k += 1) {
    const endT = yearsAgo(asOfT, k);
    const startT = yearsAgo(asOfT, k + 1);
    if (series[0].t > startT + HORIZON_TOLERANCE_DAYS * DAY_MS) break;
    const to = k === 0 ? price : closeAtOrBefore(series, endT);
    const from = closeAtOrBefore(series, startT);
    const r = pct(from, to);
    if (r == null) break;
    coveredYears += 1;
    if (r < 0) downYears += 1;
  }

  // Ventana de 5 años para caída máxima y regularidad (exige ≥ 3 años de historia).
  const windowStartT = yearsAgo(asOfT, TREND_WINDOW_YEARS);
  const windowSeries = series.filter((bar) => bar.t >= windowStartT);
  if (price !== last.close && windowSeries.length) windowSeries[windowSeries.length - 1] = { ...windowSeries[windowSeries.length - 1], close: price };
  const hasTrendHistory = historyYears >= MIN_TREND_YEARS && windowSeries.length >= 20;
  const trend = hasTrendHistory ? logTrend(windowSeries) : { slopeAnnPct: null, r2: null };

  // Media larga de 200 semanas: posición y pendiente (a 26 semanas).
  const closes = series.map((bar) => bar.close);
  let smaPos = null;
  let smaSlope = null;
  if (closes.length >= SMA_WEEKS) {
    const smaNow = closes.slice(-SMA_WEEKS).reduce((a, b) => a + b, 0) / SMA_WEEKS;
    smaPos = round(pct(smaNow, price));
    if (closes.length >= SMA_WEEKS + SLOPE_LOOKBACK_WEEKS) {
      const prev = closes.slice(-SMA_WEEKS - SLOPE_LOOKBACK_WEEKS, -SLOPE_LOOKBACK_WEEKS);
      const smaPrev = prev.reduce((a, b) => a + b, 0) / SMA_WEEKS;
      smaSlope = round(pct(smaPrev, smaNow));
    }
  }

  const status = historyYears >= 1 && series.length >= MIN_BARS_OK ? LONG_HISTORY_STATUS.ok : LONG_HISTORY_STATUS.short;
  return {
    ...base,
    status,
    firstBarDate: series[0].date,
    quality,
    historyYears: round(historyYears, 1),
    athValue: round(athValue, 4),
    athDate,
    athDistancePct: round(Math.min(0, pct(athValue, price))),
    athYearsAgo: round((asOfT - ts(athDate)) / (YEAR_DAYS * DAY_MS), 1),
    ret1y: ret(1),
    ret3y: ret(3),
    ret5y: ret(5),
    ret10y: ret(10),
    retSinceIpo: startsAtIpo && series.length >= 2 ? round(pct(series[0].close, price)) : null,
    maxDrawdown5y: hasTrendHistory ? round(maxDrawdownPct(windowSeries)) : null,
    downYears10: coveredYears > 0 ? downYears : null,
    coveredYears10: coveredYears,
    sma200wPosPct: smaPos,
    sma200wSlopePct: smaSlope,
    trendSlopeAnnPct5y: round(trend.slopeAnnPct),
    trendR2_5y: round(trend.r2, 3),
  };
}

// ── Proyección a la fila del escaneo ────────────────────────────────────────
// Solo los pocos campos de FILTRO (cada campo × ~3.300 filas pesa en
// /api/scans). Prefijo `lh` para no confundirlos con los de 2 años
// (`distanceATH`, `perf12m`...). Una única función → researchRow y
// materializedScanner no pueden divergir.
export const LONG_HISTORY_ROW_FIELDS = Object.freeze([
  "lhAthDistPct",
  "lhAthYearsAgo",
  "lhRet3y",
  "lhRet5y",
  "lhRet10y",
  "lhRetSinceIpo",
  "lhMaxDd5y",
  "lhDownYears10",
  "lhSma200wPos",
  "lhTrendR2",
  "lhTrendSlopeAnn",
]);

const EMPTY_PROJECTION = Object.freeze(Object.fromEntries(LONG_HISTORY_ROW_FIELDS.map((key) => [key, null])));

/** Campos `lh*` de una fila. Sin estadística utilizable → todos null (nunca 0). */
export function projectLongHistoryFields(stat) {
  if (!stat || (stat.status !== LONG_HISTORY_STATUS.ok && stat.status !== LONG_HISTORY_STATUS.short)) return { ...EMPTY_PROJECTION };
  const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
  return {
    lhAthDistPct: n(stat.athDistancePct),
    lhAthYearsAgo: n(stat.athYearsAgo),
    lhRet3y: n(stat.ret3y),
    lhRet5y: n(stat.ret5y),
    lhRet10y: n(stat.ret10y),
    lhRetSinceIpo: n(stat.retSinceIpo),
    lhMaxDd5y: n(stat.maxDrawdown5y),
    lhDownYears10: n(stat.downYears10),
    lhSma200wPos: n(stat.sma200wPosPct),
    lhTrendR2: n(stat.trendR2_5y),
    lhTrendSlopeAnn: n(stat.trendSlopeAnnPct5y),
  };
}

/**
 * Campos `lh*` que YA trae una fila, solo los presentes (para persistirlos en scan_results.metrics
 * sin añadir claves null a las ~3.500 filas que no tengan estadística).
 */
export function longHistoryFieldsFromRow(row = {}) {
  const out = {};
  for (const key of LONG_HISTORY_ROW_FIELDS) {
    const value = row?.[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/** Estadística de un símbolo desde options.longHistory (objeto) o options.longHistoryBySymbol (Map/objeto). */
export function longHistoryForSymbol(options = {}, symbol = "") {
  if (options?.longHistory && typeof options.longHistory === "object") return options.longHistory;
  const map = options?.longHistoryBySymbol;
  if (!map) return null;
  const key = String(symbol || "").trim().toUpperCase();
  return (typeof map.get === "function" ? map.get(key) : map[key]) || null;
}

/**
 * Parche para la fila del escaneo. Sin estadística asociada → {} (los campos
 * se OMITEN en vez de viajar como null: ahorra ~170 B por fila en /api/scans).
 * Es lo único que llaman researchRow y materializedScanner.
 */
export function longHistoryRowPatch(options = {}, symbol = "") {
  const stat = longHistoryForSymbol(options, symbol);
  return stat ? projectLongHistoryFields(stat) : {};
}

// ── Mapeo fila de base de datos ↔ estadística ───────────────────────────────

export function longHistoryToDbRow(symbol, stat, { ownerId = "personal", provider = "Yahoo Finance", interval = "1wk" } = {}) {
  return {
    owner_id: ownerId,
    symbol: String(symbol).trim().toUpperCase(),
    as_of: stat.asOf,
    status: stat.status,
    version: stat.version || LONG_HISTORY_VERSION,
    provider,
    bar_interval: interval,
    bar_count: stat.barCount ?? null,
    first_bar_date: stat.firstBarDate ?? null,
    last_bar_date: stat.lastBarDate ?? null,
    history_years: stat.historyYears ?? null,
    ath_value: stat.athValue ?? null,
    ath_date: stat.athDate ?? null,
    ath_distance_pct: stat.athDistancePct ?? null,
    ath_years_ago: stat.athYearsAgo ?? null,
    ret_1y: stat.ret1y ?? null,
    ret_3y: stat.ret3y ?? null,
    ret_5y: stat.ret5y ?? null,
    ret_10y: stat.ret10y ?? null,
    ret_since_ipo: stat.retSinceIpo ?? null,
    max_drawdown_5y: stat.maxDrawdown5y ?? null,
    down_years_10: stat.downYears10 ?? null,
    covered_years_10: stat.coveredYears10 ?? null,
    sma200w_pos_pct: stat.sma200wPosPct ?? null,
    sma200w_slope_pct: stat.sma200wSlopePct ?? null,
    trend_slope_ann_pct_5y: stat.trendSlopeAnnPct5y ?? null,
    trend_r2_5y: stat.trendR2_5y ?? null,
    detail: stat.status === LONG_HISTORY_STATUS.ok || stat.status === LONG_HISTORY_STATUS.short
      ? { ...(stat.quality || {}) }
      : { staleDays: stat.staleDays ?? null, suspectJumps: stat.suspectJumps ?? null, truncatedAt: stat.truncatedAt ?? null },
  };
}

export function longHistoryFromDbRow(row = {}) {
  const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    version: row.version,
    status: row.status,
    asOf: typeof row.as_of === "string" ? row.as_of.slice(0, 10) : row.as_of,
    lastBarDate: row.last_bar_date,
    firstBarDate: row.first_bar_date,
    barCount: n(row.bar_count),
    historyYears: n(row.history_years),
    athValue: n(row.ath_value),
    athDate: row.ath_date,
    athDistancePct: n(row.ath_distance_pct),
    athYearsAgo: n(row.ath_years_ago),
    ret1y: n(row.ret_1y),
    ret3y: n(row.ret_3y),
    ret5y: n(row.ret_5y),
    ret10y: n(row.ret_10y),
    retSinceIpo: n(row.ret_since_ipo),
    maxDrawdown5y: n(row.max_drawdown_5y),
    downYears10: n(row.down_years_10),
    coveredYears10: n(row.covered_years_10),
    sma200wPosPct: n(row.sma200w_pos_pct),
    sma200wSlopePct: n(row.sma200w_slope_pct),
    trendSlopeAnnPct5y: n(row.trend_slope_ann_pct_5y),
    trendR2_5y: n(row.trend_r2_5y),
  };
}
