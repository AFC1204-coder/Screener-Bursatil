import { buildDiscoverySnapshot, dataAsOfFrom, rsAsOfFrom } from "@/lib/discovery";
import { discoveryCacheKeyForParams, readMaterializedDiscoverySnapshot } from "@/lib/discoveryCache";
import { compressedJsonResponse } from "@/lib/compressedJsonResponse";
import { attachWeeklyRs, readGlobalRsForSymbols } from "@/lib/globalRs";
import { NIGHTLY_SCAN_COLUMNS_WITH_COUNT, readNightlyUsScan, readNightlyUsScanRows, readScanRows } from "@/lib/leaderboards";

const DEFAULT_DISCOVERY_SCAN_ROWS = 900;
const DEFAULT_DISCOVERY_SINCE_DAYS = 21;
const MAX_DISCOVERY_SCAN_ROWS = Number(process.env.DISCOVERY_MAX_SCAN_ROWS || DEFAULT_DISCOVERY_SCAN_ROWS);
const MAX_DISCOVERY_SINCE_DAYS = Number(process.env.DISCOVERY_MAX_SINCE_DAYS || DEFAULT_DISCOVERY_SINCE_DAYS);
const FALLBACK_DISCOVERY_SCAN_ROWS = 900;
const FALLBACK_DISCOVERY_SINCE_DAYS = 14;
const DISCOVERY_READ_TIMEOUT_MS = Number(process.env.DISCOVERY_READ_TIMEOUT_MS || 3500);
const DISCOVERY_FALLBACK_TIMEOUT_MS = Number(process.env.DISCOVERY_FALLBACK_TIMEOUT_MS || 2500);
// El nocturno se lee COMPLETO (row_count filas, auditoría de producto 2026-11,
// D6): antes Listas pedía 80 de 3.287 y calculaba las nueve listas sobre esa
// cabeza del ranking sin decirlo. Cada página de 1.000 filas tiene su propio
// tiempo límite.
const DISCOVERY_NIGHTLY_PAGE_TIMEOUT_MS = Number(process.env.DISCOVERY_NIGHTLY_PAGE_TIMEOUT_MS || 8000);

// El nocturno no cambia hasta la noche siguiente: el snapshot derivado (listas
// y grupos, sin el RS semanal, que se rehidrata en cada respuesta) se guarda
// en memoria por escaneo, parámetros y día (la frescura se cuenta en días).
// Así solo la primera petición paga la lectura completa.
const NIGHTLY_SNAPSHOT_MEMO_MAX = 8;
const nightlySnapshotMemo = new Map();

function nightlyMemoKey(scanId, params = {}) {
  const { cache: _cache, maxRows: _maxRows, sinceDays: _sinceDays, ...rest } = params;
  return `${scanId}|${JSON.stringify(rest)}|${new Date().toISOString().slice(0, 10)}`;
}

function rememberNightlySnapshot(key, value) {
  if (!key) return;
  nightlySnapshotMemo.delete(key);
  nightlySnapshotMemo.set(key, value);
  while (nightlySnapshotMemo.size > NIGHTLY_SNAPSHOT_MEMO_MAX) nightlySnapshotMemo.delete(nightlySnapshotMemo.keys().next().value);
}

// Ausencia explícita, en lenguaje de producto y distinguiendo los casos: no
// es lo mismo que el nocturno no haya corrido, que haya corrido y fallado, o
// que haya corrido y no encontrado nada. Los tres acaban en "no hay listas",
// pero se arreglan de forma distinta.
const NIGHTLY_ABSENCE_MESSAGE = {
  "no-nightly-scan": "No hay ningún escaneo nocturno del mercado estadounidense guardado. Las listas se construyen solo con esa fuente.",
  "nightly-not-publishable": "El último escaneo nocturno no terminó correctamente, así que no publica listas.",
  "nightly-read-failed": "No se ha podido leer el escaneo nocturno ahora mismo.",
  empty: "El último escaneo nocturno no guardó ningún valor.",
  default: "El escaneo nocturno del mercado estadounidense no está disponible.",
};

function paramsFromRequest(request) {
  const { searchParams } = new URL(request.url);
  return {
    limit: searchParams.get("limit") || "",
    groupItemLimit: searchParams.get("groupItemLimit") || "",
    groupsLimit: searchParams.get("groupsLimit") || "",
    minGroupSize: searchParams.get("minGroupSize") || "",
    minCoverageScore: searchParams.get("minCoverageScore") || "",
    maxPriceFreshnessDays: searchParams.get("maxPriceFreshnessDays") || "",
    maxRows: searchParams.get("maxRows") || "",
    sinceDays: searchParams.get("sinceDays") || "",
    scopeType: searchParams.get("scopeType") || searchParams.get("groupType") || "",
    scopeValue: searchParams.get("scopeValue") || searchParams.get("group") || "",
    cache: searchParams.get("cache") !== "0",
    // Por defecto, el último escaneo nocturno estadounidense. "recent"
    // recupera el comportamiento anterior —las N filas más recientes de
    // cualquier origen— para poder comparar los dos al depurar; no lo usa
    // ninguna pantalla.
    source: searchParams.get("source") === "recent" ? "recent" : "nightly-us",
  };
}

// Discovery es la QUINTA ruta que produce filas, y no hidrataba el ranking
// semanal: sus filas salen de scan_results, que solo lleva rsGlobalPct —el
// percentil dentro del lote del escaneo—, y lib/rsCanonical.js prohíbe
// enseñar eso bajo la etiqueta RS. Resultado: la columna RS de Listas salía
// ausente con el motivo "esta fila no lo trae cargado", que era cierto pero
// evitable. Mismo bug y mismo arreglo que las cuatro rutas de 1f20345.
//
// A diferencia de withWeeklyRsItems en /api/leaderboards, que hidrata una
// lista, aquí hay nueve listas más tres dimensiones de grupos sobre el mismo
// conjunto de símbolos: se lee rs_weekly_items UNA vez para todos y se
// reparte, en vez de una lectura por lista.
async function withWeeklyRsSnapshot(snapshot = {}) {
  const symbols = new Set();
  const collect = (items = []) => { for (const item of items || []) if (item?.symbol) symbols.add(item.symbol); };
  collect(snapshot.rows);
  for (const list of snapshot.lists || []) collect(list.items);
  for (const dimension of Object.values(snapshot.groups || {})) {
    for (const group of dimension || []) { collect(group.items); collect(group.top); }
  }
  if (!symbols.size) return snapshot;
  const weekly = await readGlobalRsForSymbols([...symbols]).catch(() => ({ configured: false, bySymbol: new Map() }));
  const attach = (items = []) => (items || []).map((item) => attachWeeklyRs(item, weekly.bySymbol));
  return {
    ...snapshot,
    rows: attach(snapshot.rows),
    lists: (snapshot.lists || []).map((list) => ({ ...list, items: attach(list.items) })),
    groups: Object.fromEntries(Object.entries(snapshot.groups || {}).map(([dimension, groups]) => [
      dimension,
      (groups || []).map((group) => ({ ...group, items: attach(group.items), top: attach(group.top) })),
    ])),
  };
}

function apiPayload(payload = {}) {
  return {
    ok: true,
    legalMode: "derived-signals-only",
    note: "Discovery expone listas y grupos derivados desde scans guardados; no publica universos completos ni OHLCV crudo.",
    ...payload,
  };
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boundedInt(value, fallback, max) {
  const n = numberOrNull(value);
  const normalized = Number.isFinite(n) ? n : fallback;
  return Math.min(Math.max(Math.round(normalized), 1), Math.max(Math.round(max || fallback), 1));
}

function isStatementTimeout(error = {}) {
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return text.includes("statement timeout") || text.includes("canceling statement") || text.includes("timeout");
}

function isRecoverableReadError(error = {}) {
  const status = Number(error.status || 0);
  const text = `${error.message || ""} ${JSON.stringify(error.details || "")}`.toLowerCase();
  return isStatementTimeout(error)
    || status >= 500
    || text.includes("fetch failed")
    || text.includes("cloudflare")
    || text.includes("web server is down")
    || text.includes("error code 521");
}

function readOptions(params = {}, fallback = {}) {
  const requestedMaxRows = numberOrNull(fallback.maxRows ?? params.maxRows);
  const requestedSinceDays = numberOrNull(fallback.sinceDays ?? params.sinceDays);
  const maxRows = boundedInt(fallback.maxRows || params.maxRows, DEFAULT_DISCOVERY_SCAN_ROWS, MAX_DISCOVERY_SCAN_ROWS);
  const sinceDays = boundedInt(fallback.sinceDays || params.sinceDays, DEFAULT_DISCOVERY_SINCE_DAYS, MAX_DISCOVERY_SINCE_DAYS);
  return {
    maxRows,
    sinceDays,
    timeoutMs: fallback.timeoutMs || DISCOVERY_READ_TIMEOUT_MS,
    bounded: (Number.isFinite(requestedMaxRows) && requestedMaxRows > maxRows)
      || (Number.isFinite(requestedSinceDays) && requestedSinceDays > sinceDays),
  };
}

async function readDiscoveryScanRows(params = {}) {
  const options = readOptions(params);
  if (params.source !== "recent") {
    // Anclado: un escaneo concreto, no una ventana temporal, y COMPLETO.
    // sinceDays y maxRows del cliente no aplican aquí: el nocturno es el que es.
    const anchoredRead = { maxRows: null, sinceDays: null, timeoutMs: DISCOVERY_NIGHTLY_PAGE_TIMEOUT_MS, bounded: false, anchored: true };
    try {
      const found = await readNightlyUsScan({ timeoutMs: options.timeoutMs, columns: NIGHTLY_SCAN_COLUMNS_WITH_COUNT });
      const memoKey = found?.scan?.id ? nightlyMemoKey(found.scan.id, params) : "";
      const memo = memoKey ? nightlySnapshotMemo.get(memoKey) : null;
      if (memo) return { scanData: memo.scanData, snapshot: memo.snapshot, degraded: false, fallback: null, read: { ...anchoredRead, memo: true } };
      const scanData = await readNightlyUsScanRows({ maxRows: "all", timeoutMs: DISCOVERY_NIGHTLY_PAGE_TIMEOUT_MS, found });
      return { scanData, memoKey, degraded: false, fallback: null, read: anchoredRead };
    } catch (error) {
      if (!isRecoverableReadError(error)) throw error;
      // Un timeout no puede convertirse en "aquí tienes otro mercado": se
      // devuelve la ausencia con su motivo y la pantalla decide.
      return {
        scanData: { configured: true, rows: [], nightly: { found: false, reason: "nightly-read-failed", error: error.message || "" } },
        degraded: true,
        fallback: { reason: error.message || "lectura del nocturno no disponible", anchored: true },
        read: { ...options, anchored: true },
      };
    }
  }
  try {
    return { scanData: await readScanRows(options), degraded: false, fallback: null, read: options };
  } catch (error) {
    if (!isRecoverableReadError(error)) throw error;
    const requestedMaxRows = numberOrNull(params.maxRows);
    const requestedSinceDays = numberOrNull(params.sinceDays);
    const fallback = {
      maxRows: Math.min(Math.max(requestedMaxRows || FALLBACK_DISCOVERY_SCAN_ROWS, 1), FALLBACK_DISCOVERY_SCAN_ROWS),
      sinceDays: Math.min(Math.max(requestedSinceDays || FALLBACK_DISCOVERY_SINCE_DAYS, 1), FALLBACK_DISCOVERY_SINCE_DAYS),
      timeoutMs: DISCOVERY_FALLBACK_TIMEOUT_MS,
      reason: error.message || "statement timeout",
    };
    const fallbackOptions = readOptions(params, fallback);
    try {
      return {
        scanData: await readScanRows(fallbackOptions),
        degraded: true,
        fallback,
        read: fallbackOptions,
      };
    } catch (fallbackError) {
      if (!isRecoverableReadError(fallbackError)) throw fallbackError;
      return {
        scanData: { configured: true, rows: [], ownerId: "" },
        degraded: true,
        fallback: {
          ...fallback,
          empty: true,
          fallbackReason: fallbackError.message || "No hay resultados de escaneo disponibles",
        },
        read: fallbackOptions,
      };
    }
  }
}

export async function GET(request) {
  const params = paramsFromRequest(request);
  try {
    const cacheKey = discoveryCacheKeyForParams(params);
    // Por qué importa distinguir "no había" de "estaba caducada": mientras el
    // trabajo que rellena la caché no esté programado, TODA lectura entra por
    // el camino vivo, y eso tiene que poder verse desde fuera sin adivinarlo.
    let cacheState = cacheKey ? { hit: false, status: "miss", key: cacheKey } : { hit: false, status: "bypass" };
    if (cacheKey) {
      const cached = await readMaterializedDiscoverySnapshot(cacheKey).catch(() => null);
      if (cached?.payload) {
        // El snapshot cacheado congela el RS del día en que se materializó,
        // y el ranking es semanal: se rehidrata al servir, igual que hace
        // /api/leaderboards con su caché.
        return compressedJsonResponse(request, apiPayload({
          configured: true,
          ...(await withWeeklyRsSnapshot(cached.payload)),
          dataAsOf: dataAsOfFrom(cached.payload),
          source: "discovery_snapshots",
          cache: cached.cache,
          effectiveRead: cached.read,
        }));
      }
      if (cached?.expired) {
        cacheState = {
          hit: false,
          status: "expired",
          key: cacheKey,
          generatedAt: cached.generatedAt,
          ageHours: cached.freshness?.ageHours ?? null,
          boundary: cached.freshness?.boundary ?? null,
        };
      }
    }

    const startedAt = Date.now();
    const { scanData, snapshot: memoSnapshot, memoKey, degraded, fallback, read } = await readDiscoveryScanRows(params);
    const readMs = Date.now() - startedAt;
    if (!scanData.configured) {
      return compressedJsonResponse(request, apiPayload({
        configured: false,
        source: "local_snapshot_fallback_required",
        message: scanData.message || "Sin ranking en vivo: Sectores y Listas usan la copia local.",
        cache: cacheState,
        inputRows: 0,
        lists: [],
        rows: [],
        groups: { theme: [], sector: [], industry: [] },
        health: {
          state: "empty",
          rows: 0,
          listItemCount: 0,
          groupCount: 0,
          staleRows: 0,
          lowCoverageRows: 0,
          dataLimitedRows: 0,
          missingTaxonomyRows: 0,
          planClaims: 0,
          watchRows: 0,
          sourceLabel: "Fallback local requerido",
          note: "Sin scans persistidos disponibles para discovery derivado.",
        },
      }));
    }

    // Sin nocturno no hay listas. Se dice por qué, y NO se busca sustituto:
    // servir otro escaneo sería exactamente lo que este anclaje evita.
    const nightly = scanData.nightly;
    if (nightly && (!nightly.found || nightly.empty)) {
      return compressedJsonResponse(request, apiPayload({
        configured: true,
        source: "nightly_us_unavailable",
        message: NIGHTLY_ABSENCE_MESSAGE[nightly.reason] || (nightly.empty ? NIGHTLY_ABSENCE_MESSAGE.empty : NIGHTLY_ABSENCE_MESSAGE.default),
        nightly,
        cache: cacheState,
        inputRows: 0,
        lists: [],
        rows: [],
        groups: { theme: [], sector: [], industry: [] },
        health: {
          state: "empty",
          rows: 0,
          listItemCount: 0,
          groupCount: 0,
          staleRows: 0,
          lowCoverageRows: 0,
          dataLimitedRows: 0,
          missingTaxonomyRows: 0,
          planClaims: 0,
          watchRows: 0,
          sourceLabel: "Sin escaneo nocturno",
          note: NIGHTLY_ABSENCE_MESSAGE[nightly.reason] || (nightly.empty ? NIGHTLY_ABSENCE_MESSAGE.empty : NIGHTLY_ABSENCE_MESSAGE.default),
        },
      }));
    }

    let baseSnapshot = memoSnapshot;
    if (!baseSnapshot) {
      baseSnapshot = buildDiscoverySnapshot(scanData.rows, params);
      // Solo se recuerda una lectura completa y sin degradar.
      if (memoKey && !degraded) rememberNightlySnapshot(memoKey, { snapshot: baseSnapshot, scanData: { ...scanData, rows: [] } });
    }
    const buildMs = Date.now() - startedAt - readMs;
    const snapshot = await withWeeklyRsSnapshot(baseSnapshot);
    const rsMs = Date.now() - startedAt - readMs - buildMs;
    // «Calculado sobre N de M filas»: si la lectura no trajo el nocturno
    // entero, se dice en la respuesta y en la pantalla, no se calla.
    const nightlyRowCount = Number(scanData.nightly?.rowCount);
    const inputRows = Number(snapshot.inputRows) || 0;
    const coverage = Number.isFinite(nightlyRowCount) && nightlyRowCount > 0
      ? { inputRows, nightlyRows: nightlyRowCount, complete: inputRows >= nightlyRowCount, label: inputRows >= nightlyRowCount ? "" : `calculado sobre ${inputRows.toLocaleString("es-ES")} de ${nightlyRowCount.toLocaleString("es-ES")} filas` }
      : null;
    let health = degraded ? {
      ...snapshot.health,
      state: snapshot.health?.state === "pass" ? "warn" : snapshot.health?.state,
      note: `${snapshot.health?.note || ""} Lectura limitada por timeout: ${fallback.maxRows} filas max, ${fallback.sinceDays} dias.`,
    } : snapshot.health;
    if (coverage && !coverage.complete) {
      health = {
        ...health,
        state: health?.state === "pass" ? "watch" : health?.state,
        note: `${health?.note || ""} Listas ${coverage.label} del escaneo nocturno.`.trim(),
      };
    }
    if (read?.bounded) {
      health = {
        ...health,
        state: health?.state === "pass" ? "watch" : health?.state,
        note: `${health?.note || ""} Lectura acotada para mantener la respuesta interactiva: ${read.maxRows} filas max, ${read.sinceDays} dias.`,
      };
    }
    return compressedJsonResponse(request, apiPayload({
      configured: true,
      ownerId: scanData.ownerId,
      ...snapshot,
      health,
      degraded,
      fallback,
      cache: cacheState,
      nightly: scanData.nightly || null,
      coverage,
      dataAsOf: dataAsOfFrom(snapshot),
      rsAsOf: rsAsOfFrom(snapshot),
      effectiveRead: read ? {
        maxRows: read.maxRows,
        sinceDays: read.sinceDays,
        timeoutMs: read.timeoutMs,
        bounded: read.bounded,
        anchored: Boolean(read.anchored),
        complete: coverage ? coverage.complete : null,
        memo: Boolean(read.memo),
        timingsMs: { read: readMs, build: buildMs, rs: rsMs },
      } : null,
    }));
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Discovery unavailable", details: error.details || null }, { status: 500 });
  }
}
