import { SCORING_ENGINE_VERSION } from "@/lib/scoringEngine";
import { normalizeMicCode } from "@/lib/micCodes";
import { finiteOrNull, supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";

export const SCAN_HISTORY_PROVIDER_YAHOO = "yahoo";
export const SCAN_HISTORY_SOURCE_PIPELINE = "materialized_scan";

// Tamaño de tanda del POST de historia — ver el comentario en
// writeScanSymbolHistory. Mismo valor que WRITE_BATCH_ROWS de
// lib/materializedScanner.js, y por el mismo muro (statement_timeout 8s).
const HISTORY_WRITE_BATCH_ROWS = 300;

const RS_FIELDS = [
  ["rs_global", "rs_global_moved"],
  ["rs_benchmark", "rs_benchmark_moved"],
  ["rs_country", "rs_country_moved"],
  ["rs_sector", "rs_sector_moved"],
];

function clean(value = "") {
  return String(value || "").trim();
}

function cleanUpper(value = "") {
  return clean(value).toUpperCase();
}

function dateOnly(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function observedWeekUtc(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`scan history observed_at inválido: ${value}`);
  const date = new Date(parsed);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

export function scanHistoryKey(row = {}) {
  return `${cleanUpper(row.mic_code)}\u0000${cleanUpper(row.symbol)}`;
}

function hasComparableData(row = {}) {
  return row.absence_reason === null || row.absence_reason === undefined || row.absence_reason === "filtered_out";
}

// `Number(null)` es 0 y `Number("")` también, y `Math.max(1, 0)` es 1: la
// versión anterior convertía TODO stage_week ausente en 1. Consecuencia
// doble: el 100% de las filas llevaba stage_week "con valor" aunque el
// escáner no lo hubiera medido, y las filas de salida de universo (que por
// contrato llevan stage_week null) violaban el check
// scan_symbol_history_out_of_universe_shape — 6 de 6 corridas EU del cron
// fallaron la escritura entera por esto desde el estreno de la tabla.
function toStageWeek(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : null;
}

export function scanHistoryChangeReasons(previous, current) {
  if (!previous) return ["first_appearance"];

  const reasons = [];
  if (Boolean(previous.passed_screen) !== Boolean(current.passed_screen)) reasons.push("screening_changed");
  if ((previous.absence_reason || null) !== (current.absence_reason || null)) reasons.push("absence_reason_changed");

  if (hasComparableData(previous) && hasComparableData(current)) {
    if ((previous.stage || null) !== (current.stage || null)) reasons.push("stage_changed");
    if ((previous.stage_week ?? null) !== (current.stage_week ?? null)) reasons.push("stage_week_changed");
    for (const [field, reason] of RS_FIELDS) {
      const before = finiteOrNull(previous[field]);
      const after = finiteOrNull(current[field]);
      if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) > 5) {
        reasons.push(reason);
      }
    }
  }

  // Excepción aprobada: una salida del universo se registra una vez al cambiar
  // de estado, pero no produce anclas semanales indefinidas.
  if (
    current.absence_reason !== "not_in_universe"
    && previous.observed_week !== current.observed_week
  ) {
    reasons.push("weekly_anchor");
  }

  return reasons;
}

function normalizedHistoryRow(row = {}, defaults = {}) {
  const symbol = cleanUpper(row.symbol);
  const micCode = normalizeMicCode(row.mic_code);
  const observedAt = new Date(row.observed_at || defaults.observedAt).toISOString();
  const absenceReason = row.absence_reason || null;
  if (!symbol) throw new Error("scan history symbol vacío");
  if (!micCode) throw new Error(`scan history mic_code no resoluble para ${symbol}`);

  const normalized = {
    owner_id: clean(row.owner_id || defaults.ownerId),
    symbol,
    mic_code: micCode,
    observed_at: observedAt,
    observed_week: observedWeekUtc(observedAt),
    data_as_of: dateOnly(row.data_as_of),
    source_scan_id: clean(row.source_scan_id || defaults.sourceScanId),
    source_pipeline: clean(row.source_pipeline || defaults.sourcePipeline || SCAN_HISTORY_SOURCE_PIPELINE),
    stage: clean(row.stage) || null,
    stage_week: toStageWeek(row.stage_week),
    rs_global: finiteOrNull(row.rs_global),
    rs_benchmark: finiteOrNull(row.rs_benchmark),
    rs_country: finiteOrNull(row.rs_country),
    rs_sector: finiteOrNull(row.rs_sector),
    composite_score: finiteOrNull(row.composite_score),
    // Distancia al máximo de 52 semanas (≤ 0, en %). Sin ella el histórico no
    // puede responder "estaba a 8% del máximo, ahora a 1%" — el único de los
    // tres candidatos a delta del diseño 2026-08-16 que la tabla no cubría.
    // NO alimenta ninguna change reason: la métrica incluye la barra de hoy
    // en el máximo (highDist, lib/materializedScanner.js), así que "marcó
    // máximo nuevo" no es derivable de forma exacta desde este campo y un
    // umbral inventado escribiría filas con aspecto de medición (B.8.3 del
    // diseño: los umbrales de salto son ruido o inestables).
    distance_52w: finiteOrNull(row.distance_52w),
    composite_coverage: finiteOrNull(row.composite_coverage) ?? 0,
    composite_partial: row.composite_partial !== false,
    scoring_engine_version: clean(row.scoring_engine_version || defaults.scoringEngineVersion || SCORING_ENGINE_VERSION),
    data_provider: clean(row.data_provider || defaults.dataProvider || SCAN_HISTORY_PROVIDER_YAHOO),
    passed_screen: row.passed_screen === true,
    absence_reason: absenceReason,
    absence_detail: clean(row.absence_detail) || null,
  };

  if (!normalized.owner_id) throw new Error("scan history owner_id vacío");
  if (!normalized.source_scan_id) throw new Error(`scan history source_scan_id vacío para ${symbol}`);
  if (!normalized.scoring_engine_version) throw new Error(`scan history scoring_engine_version vacío para ${symbol}`);
  if (!normalized.data_provider) throw new Error(`scan history data_provider vacío para ${symbol}`);
  if (normalized.passed_screen === (absenceReason !== null)) {
    throw new Error(`scan history estado de cribado incoherente para ${symbol}`);
  }
  return normalized;
}

export function selectScanHistoryInserts({ observations = [], latestRows = [], defaults = {} } = {}) {
  const latest = new Map((latestRows || []).map((row) => [scanHistoryKey(row), row]));
  const inserts = [];
  for (const raw of observations || []) {
    const current = normalizedHistoryRow(raw, defaults);
    const previous = latest.get(scanHistoryKey(current)) || null;
    const changeReasons = scanHistoryChangeReasons(previous, current);
    if (!changeReasons.length) continue;
    const inserted = { ...current, change_reasons: changeReasons };
    inserts.push(inserted);
    latest.set(scanHistoryKey(current), inserted);
  }
  return inserts;
}

export function notInUniverseHistoryObservations({ latestRows = [], universeSymbols = [], defaults = {} } = {}) {
  const present = new Set((universeSymbols || []).map(cleanUpper).filter(Boolean));
  return (latestRows || [])
    .filter((previous) => previous.absence_reason !== "not_in_universe")
    .filter((previous) => !present.has(cleanUpper(previous.symbol)))
    .map((previous) => ({
      symbol: previous.symbol,
      mic_code: previous.mic_code,
      observed_at: defaults.observedAt,
      data_as_of: null,
      stage: null,
      stage_week: null,
      rs_global: null,
      rs_benchmark: null,
      rs_country: null,
      rs_sector: null,
      composite_score: null,
      distance_52w: null,
      composite_coverage: 0,
      composite_partial: true,
      passed_screen: false,
      absence_reason: "not_in_universe",
      absence_detail: "símbolo ausente del snapshot autoritativo del universo",
    }));
}

function observationsWithPriorMic(observations = [], latestRows = []) {
  const micsBySymbol = new Map();
  for (const row of latestRows || []) {
    const symbol = cleanUpper(row.symbol);
    const mic = normalizeMicCode(row.mic_code);
    if (!symbol || !mic) continue;
    const values = micsBySymbol.get(symbol) || new Set();
    values.add(mic);
    micsBySymbol.set(symbol, values);
  }
  return (observations || []).map((row) => {
    if (normalizeMicCode(row.mic_code)) return row;
    const priorMics = micsBySymbol.get(cleanUpper(row.symbol));
    return priorMics?.size === 1 ? { ...row, mic_code: [...priorMics][0] } : row;
  });
}

export async function writeScanSymbolHistory({
  ownerId,
  sourceScanId,
  observations = [],
  observedAt = new Date().toISOString(),
  scopeMicCodes = [],
  authoritativeUniverse = false,
  universeSymbols = [],
  dataProvider = SCAN_HISTORY_PROVIDER_YAHOO,
} = {}) {
  const observationMics = observations.map((row) => normalizeMicCode(row.mic_code)).filter(Boolean);
  const micCodes = [...new Set([...scopeMicCodes.map(normalizeMicCode), ...observationMics].filter(Boolean))];
  const latestRows = await supabaseRpc("scan_symbol_history_latest_v1", {
    p_owner_id: ownerId,
    p_mic_codes: micCodes.length ? micCodes : null,
  });
  const defaults = {
    ownerId,
    sourceScanId,
    observedAt,
    sourcePipeline: SCAN_HISTORY_SOURCE_PIPELINE,
    scoringEngineVersion: SCORING_ENGINE_VERSION,
    dataProvider,
  };
  const absenceObservations = authoritativeUniverse
    ? notInUniverseHistoryObservations({ latestRows, universeSymbols, defaults })
    : [];
  const resolvedObservations = observationsWithPriorMic(observations, latestRows);
  const inserts = selectScanHistoryInserts({
    observations: [...resolvedObservations, ...absenceObservations],
    latestRows,
    defaults,
  });
  if (!inserts.length) return { saved: 0, candidates: observations.length, notInUniverse: absenceObservations.length, batches: 0 };

  // Troceado en tandas: la primera corrida del nocturno completo inserta una
  // fila first_appearance por símbolo analizado (~5.600) y un solo POST de ese
  // tamaño compite con el statement_timeout de 8s del rol PostgREST — el mismo
  // muro por el que writeMaterializedScan trocea a WRITE_BATCH_ROWS = 300
  // (lib/materializedScanner.js). Misma cifra aquí: la fila de historia pesa
  // ~0,4 KB, así que 300 filas ≈ 120 KB por petición, con margen de sobra.
  // Un fallo a mitad no corrompe: la unique (owner, source_scan_id, mic,
  // symbol) + ignore-duplicates hace idempotente el reintento del mismo scan.
  let savedCount = 0;
  let batches = 0;
  for (let i = 0; i < inserts.length; i += HISTORY_WRITE_BATCH_ROWS) {
    const batch = inserts.slice(i, i + HISTORY_WRITE_BATCH_ROWS);
    const saved = await supabaseRequest("scan_symbol_history", {
      method: "POST",
      query: "on_conflict=owner_id,source_scan_id,mic_code,symbol",
      prefer: "resolution=ignore-duplicates,return=representation",
      body: batch,
    });
    savedCount += Array.isArray(saved) ? saved.length : batch.length;
    batches += 1;
  }
  return {
    saved: savedCount,
    candidates: observations.length,
    notInUniverse: absenceObservations.length,
    batches,
  };
}
