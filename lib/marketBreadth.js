// lib/marketBreadth.js — amplitud del universo calculada sobre el escaneo
// nocturno del servidor, no sobre lo que cada navegador tenga en localStorage.
//
// Motivo (docs/analisis-salud-mercado-2026-08-16.md, A.3 y C.1): la pantalla de
// salud de mercado calculaba la amplitud sobre las filas del último snapshot
// guardado en el navegador — dos usuarios veían dos mercados distintos y el
// mismo usuario veía otro al cambiar de vista. Aquí la población es SIEMPRE el
// último escaneo nocturno completo (preset "materialized-cache"), la misma
// cifra para todos, con su fecha declarada.
//
// Este módulo NO calcula ninguna señal nueva: agrega campos que el pipeline
// nocturno ya persiste por fila (weeklyStageState, extSma50, sma200Slope,
// distance52w, upDownVolRatio) y series que el motor RS semanal ya escribe
// (rs_raw por símbolo y semana). Solo cambia qué población se agrega.
import { finiteOrNull, supabaseConfig, supabaseCount, supabaseRequest, supabaseRequestAll, toDate } from "@/lib/supabaseServer";

export const NIGHTLY_SCAN_PRESET = "materialized-cache";
// Un indicador medido sobre menos del 60% de la población no mide el mercado:
// se declara ausente en vez de servirse parcial (principio 3).
export const BREADTH_MIN_COVERAGE_PCT = 60;
export const BREADTH_INDEX_SYMBOL = "SPY";
// La serie del motor RS vigente arranca en 2026-W07; con margen.
const SERIES_MAX_SNAPSHOTS = 40;
const SERIES_TIMEOUT_MS = 8000;
const ROWS_TIMEOUT_MS = 15000;

function pctOf(count, total) {
  return total > 0 ? (count / total) * 100 : null;
}

// Los estados los emite lib/weeklyStage.js (stageLabel): stage2 y base implican
// precio sobre la media de 30 semanas; mixed e insufficient_history no.
const STAGE_BUCKETS = [
  { key: "stage2", label: "Etapa 2" },
  { key: "base", label: "Base / transición" },
  { key: "mixed", label: "Mixta / débil" },
  { key: "stage4", label: "Etapa 4" },
];
const ABOVE_30W_STAGES = new Set(["stage2", "base"]);

function indicator({ key, label, count, measured, population }) {
  const coveragePct = pctOf(measured, population);
  const available = Number.isFinite(coveragePct) && coveragePct >= BREADTH_MIN_COVERAGE_PCT;
  return {
    key,
    label,
    count: available ? count : null,
    measured,
    population,
    pct: available ? pctOf(count, measured) : null,
    coveragePct,
    available,
    reason: available ? null : `Solo ${measured} de ${population} valores del escaneo traen este dato (cobertura ${Math.round(coveragePct ?? 0)}%, mínimo ${BREADTH_MIN_COVERAGE_PCT}%).`,
  };
}

// Pura y testeable: filas del escaneo nocturno → indicadores de amplitud con
// cobertura por campo y ausencia explícita bajo el umbral.
export function aggregateUniverseBreadth(rows = []) {
  const population = rows.length;
  const measured = { stage: [], extSma50: [], sma200Slope: [], distance52w: [], upDownVolRatio: [] };
  const countries = new Map();
  const dates = new Map();
  for (const row of rows) {
    const stage = String(row.stage || "");
    if (stage && stage !== "insufficient_history") measured.stage.push(stage);
    const extSma50 = finiteOrNull(row.extSma50);
    if (extSma50 !== null) measured.extSma50.push(extSma50);
    const sma200Slope = finiteOrNull(row.sma200Slope);
    if (sma200Slope !== null) measured.sma200Slope.push(sma200Slope);
    const distance52w = finiteOrNull(row.distance52w);
    if (distance52w !== null) measured.distance52w.push(distance52w);
    const upDownVolRatio = finiteOrNull(row.upDownVolRatio);
    if (upDownVolRatio !== null) measured.upDownVolRatio.push(upDownVolRatio);

    const country = String(row.country || "").trim().toUpperCase() || "US";
    const bucket = countries.get(country) || { total: 0, sma50Measured: 0, sma50Above: 0 };
    bucket.total += 1;
    if (extSma50 !== null) {
      bucket.sma50Measured += 1;
      if (extSma50 >= 0) bucket.sma50Above += 1;
    }
    countries.set(country, bucket);

    const lastDate = toDate(row.lastDate);
    if (lastDate) dates.set(lastDate, (dates.get(lastDate) || 0) + 1);
  }

  // La fecha del dato es la más reciente entre las filas; las filas con
  // precio más viejo se cuentan y se declaran, no se esconden en la media.
  const sortedDates = [...dates.keys()].sort();
  const dataAsOf = sortedDates.at(-1) || null;
  const staleRows = dataAsOf
    ? population - (dates.get(dataAsOf) || 0)
    : population;

  const stageCounts = {};
  for (const bucket of STAGE_BUCKETS) stageCounts[bucket.key] = 0;
  for (const stage of measured.stage) {
    if (stage in stageCounts) stageCounts[stage] += 1;
  }
  const stageMeasured = measured.stage.length;
  const stageCoveragePct = pctOf(stageMeasured, population);
  const stagesAvailable = Number.isFinite(stageCoveragePct) && stageCoveragePct >= BREADTH_MIN_COVERAGE_PCT;

  const indicators = [
    indicator({
      key: "above30w",
      label: "Sobre su media de 30 semanas",
      count: measured.stage.filter((stage) => ABOVE_30W_STAGES.has(stage)).length,
      measured: stageMeasured,
      population,
    }),
    indicator({
      key: "aboveSma50",
      label: "Sobre su SMA50",
      count: measured.extSma50.filter((value) => value >= 0).length,
      measured: measured.extSma50.length,
      population,
    }),
    indicator({
      key: "sma200Up",
      label: "SMA200 ascendente",
      count: measured.sma200Slope.filter((value) => value > 0).length,
      measured: measured.sma200Slope.length,
      population,
    }),
    indicator({
      key: "nearHigh52w",
      label: "A ≤1% del máximo 52s",
      count: measured.distance52w.filter((value) => value >= -1).length,
      measured: measured.distance52w.length,
      population,
    }),
    indicator({
      key: "deepBelowHigh52w",
      label: "A ≥30% del máximo 52s",
      count: measured.distance52w.filter((value) => value <= -30).length,
      measured: measured.distance52w.length,
      population,
    }),
    indicator({
      key: "upVolume",
      label: "Más volumen en subidas",
      count: measured.upDownVolRatio.filter((value) => value >= 1).length,
      measured: measured.upDownVolRatio.length,
      population,
    }),
  ];

  return {
    population,
    dataAsOf,
    staleRows,
    minCoveragePct: BREADTH_MIN_COVERAGE_PCT,
    indicators,
    stages: {
      available: stagesAvailable,
      measured: stageMeasured,
      population,
      coveragePct: stageCoveragePct,
      unclassified: population - stageMeasured,
      reason: stagesAvailable ? null : `Solo ${stageMeasured} de ${population} valores traen etapa semanal (cobertura ${Math.round(stageCoveragePct ?? 0)}%, mínimo ${BREADTH_MIN_COVERAGE_PCT}%).`,
      buckets: STAGE_BUCKETS.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: stagesAvailable ? stageCounts[bucket.key] : null,
        pct: stagesAvailable ? pctOf(stageCounts[bucket.key], stageMeasured) : null,
      })),
    },
    countries: Object.fromEntries(countries),
  };
}

// Pura: de todos los snapshots semanales, el último por week_key. Dos corridas
// del motor en la misma semana (pasó en 2026-W32) no son dos puntos de la
// serie: son la misma semana recalculada, y vale la más reciente.
export function dedupeWeeklySnapshots(snapshots = []) {
  const byWeek = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot?.weekKey || !snapshot?.date) continue;
    const previous = byWeek.get(snapshot.weekKey);
    if (!previous || snapshot.date > previous.date) byWeek.set(snapshot.weekKey, snapshot);
  }
  return [...byWeek.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Pura: cierre del índice en la fecha del snapshot o el último cierre anterior
// (los snapshots caen en viernes; si fue festivo, vale el cierre previo).
export function attachIndexCloses(weeks = [], bars = []) {
  const sorted = [...bars]
    .map((bar) => ({ date: toDate(bar.trade_date || bar.date), close: finiteOrNull(bar.close) }))
    .filter((bar) => bar.date && bar.close !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return weeks.map((week) => {
    let indexClose = null;
    for (const bar of sorted) {
      if (bar.date > week.date) break;
      indexClose = bar.close;
    }
    return { ...week, indexClose };
  });
}

// Pura: el hecho de la divergencia sobre la ventana de las últimas N semanas.
// Describe — no predice: variación del índice y de la participación, y un
// booleano de divergencia (índice sube, participación baja) que la interfaz
// enuncia como hecho.
export function participationSummary(weeks = [], windowWeeks = 12) {
  const usable = weeks.filter((week) => Number.isFinite(week.pct) && Number.isFinite(week.indexClose));
  if (usable.length < 2) return null;
  const window = usable.slice(-Math.max(2, windowWeeks));
  const first = window[0];
  const last = window.at(-1);
  const indexChangePct = ((last.indexClose / first.indexClose) - 1) * 100;
  const participationDeltaPp = last.pct - first.pct;
  return {
    weeks: window.length,
    fromDate: first.date,
    toDate: last.date,
    indexChangePct,
    participationStartPct: first.pct,
    participationEndPct: last.pct,
    participationDeltaPp,
    divergence: indexChangePct > 0 && participationDeltaPp < 0,
  };
}

async function readLatestNightlyScan(config) {
  const rows = await supabaseRequest("scans", {
    query: {
      owner_id: `eq.${config.ownerId}`,
      preset: `eq.${NIGHTLY_SCAN_PRESET}`,
      deleted_at: "is.null",
      select: "id,created_at,row_count",
      order: "created_at.desc",
      limit: "1",
    },
    timeoutMs: SERIES_TIMEOUT_MS,
  });
  return rows?.[0] || null;
}

async function readLatestRsSnapshot(config) {
  const rows = await supabaseRequest("rs_weekly_items", {
    query: {
      owner_id: `eq.${config.ownerId}`,
      select: "snapshot_date,week_key,engine_version,sample_size",
      order: "snapshot_date.desc",
      limit: "1",
    },
    timeoutMs: SERIES_TIMEOUT_MS,
  });
  return rows?.[0] || null;
}

async function readNightlyRows(config, scanId) {
  // Solo los campos que la agregación necesita: el resto del `metrics` (200+
  // claves por fila) se queda en la base.
  const select = [
    "symbol",
    "country",
    "stage:metrics->>weeklyStageState",
    "extSma50:metrics->extSma50",
    "sma200Slope:metrics->sma200Slope",
    "distance52w:metrics->distance52w",
    "upDownVolRatio:metrics->upDownVolRatio",
    "lastDate:metrics->>lastDate",
  ].join(",");
  return supabaseRequestAll("scan_results", {
    query: {
      owner_id: `eq.${config.ownerId}`,
      scan_id: `eq.${scanId}`,
      select,
    },
    timeoutMs: ROWS_TIMEOUT_MS,
  }, { maxRows: 20000 });
}

// Enumera los snapshots del motor vigente por keyset (snapshot_date
// descendente). PostgREST no agrega ni hace DISTINCT, así que la lista se
// recorre snapshot a snapshot; el memo de módulo evita repetirlo por request.
async function enumerateRsSnapshots(config, engineVersion) {
  const snapshots = [];
  let before = null;
  for (let i = 0; i < SERIES_MAX_SNAPSHOTS; i += 1) {
    const query = {
      owner_id: `eq.${config.ownerId}`,
      engine_version: `eq.${engineVersion}`,
      select: "snapshot_date,week_key,sample_size",
      order: "snapshot_date.desc",
      limit: "1",
    };
    if (before) query.snapshot_date = `lt.${before}`;
    const rows = await supabaseRequest("rs_weekly_items", { query, timeoutMs: SERIES_TIMEOUT_MS });
    const row = rows?.[0];
    if (!row?.snapshot_date) break;
    snapshots.push({
      date: toDate(row.snapshot_date),
      weekKey: row.week_key || "",
      sampleSize: Number(row.sample_size) || null,
    });
    before = row.snapshot_date;
  }
  return snapshots;
}

async function countPositiveRsRaw(config, engineVersion, snapshotDate) {
  return supabaseCount("rs_weekly_items", {
    query: {
      owner_id: `eq.${config.ownerId}`,
      engine_version: `eq.${engineVersion}`,
      snapshot_date: `eq.${snapshotDate}`,
      rs_raw: "gt.0",
      select: "id",
    },
    timeoutMs: SERIES_TIMEOUT_MS,
  });
}

async function readIndexBars(config, fromDate) {
  return supabaseRequestAll("daily_bars", {
    query: {
      owner_id: `eq.${config.ownerId}`,
      symbol: `eq.${BREADTH_INDEX_SYMBOL}`,
      trade_date: `gte.${fromDate}`,
      select: "trade_date,close",
      order: "trade_date.asc",
    },
    timeoutMs: SERIES_TIMEOUT_MS,
  }, { maxRows: 1000 });
}

async function computeParticipationSeries(config, latestSnapshot) {
  const engineVersion = latestSnapshot?.engine_version || "";
  if (!engineVersion) {
    return { available: false, reason: "No hay snapshots del motor RS semanal en la base.", weeks: [] };
  }
  const snapshots = dedupeWeeklySnapshots(await enumerateRsSnapshots(config, engineVersion));
  if (snapshots.length < 2) {
    return { available: false, reason: "El motor RS vigente aún no acumula dos semanas comparables.", weeks: [] };
  }
  const positives = await Promise.all(
    snapshots.map((snapshot) => countPositiveRsRaw(config, engineVersion, snapshot.date)),
  );
  let weeks = snapshots.map((snapshot, index) => ({
    ...snapshot,
    positive: positives[index],
    pct: pctOf(positives[index], snapshot.sampleSize),
  }));
  let index = null;
  try {
    const bars = await readIndexBars(config, weeks[0].date);
    weeks = attachIndexCloses(weeks, bars);
    const withClose = weeks.filter((week) => Number.isFinite(week.indexClose));
    index = withClose.length
      ? {
        symbol: BREADTH_INDEX_SYMBOL,
        fromDate: withClose[0].date,
        toDate: withClose.at(-1).date,
        fromClose: withClose[0].indexClose,
        toClose: withClose.at(-1).indexClose,
      }
      : null;
  } catch {
    // Sin barras del índice la serie de participación sigue siendo válida;
    // la comparación con el índice se declara ausente.
    weeks = weeks.map((week) => ({ ...week, indexClose: null }));
  }
  return {
    available: true,
    engineVersion,
    weeks,
    index,
    indexReason: index ? null : `Sin histórico de ${BREADTH_INDEX_SYMBOL} en daily_bars para el rango de la serie.`,
    summary: participationSummary(weeks),
  };
}

// Memo de módulo: los números solo cambian cuando entra un escaneo nocturno o
// un snapshot RS nuevo, así que la clave es ese par. `refresh=1` lo salta.
// No se escribe nada en Supabase: este módulo es de solo lectura.
let memo = null;

export async function readMarketBreadth(options = {}) {
  const config = supabaseConfig();
  if (!config.configured) {
    return { configured: false, error: "La copia en la nube no está activada. La amplitud del universo se calcula en el servidor y necesita la base de datos." };
  }
  const [scan, latestSnapshot] = await Promise.all([
    readLatestNightlyScan(config),
    readLatestRsSnapshot(config),
  ]);
  if (!scan?.id) {
    return { configured: true, error: "No hay ningún escaneo nocturno en la base sobre el que medir la amplitud." };
  }
  const memoKey = `${scan.id}|${latestSnapshot?.snapshot_date || ""}`;
  if (!options.refresh && memo?.key === memoKey) {
    return { ...memo.payload, servedAt: new Date().toISOString(), memoHit: true };
  }
  const rows = await readNightlyRows(config, scan.id);
  const breadth = aggregateUniverseBreadth(rows);
  const participation = await computeParticipationSeries(config, latestSnapshot).catch((error) => ({
    available: false,
    reason: error?.message || "No se pudo leer la serie semanal de participación.",
    weeks: [],
  }));
  const payload = {
    configured: true,
    generatedAt: new Date().toISOString(),
    scan: { id: scan.id, createdAt: scan.created_at },
    ...breadth,
    participation,
  };
  memo = { key: memoKey, payload };
  return { ...payload, servedAt: payload.generatedAt, memoHit: false };
}
