// GET /api/weekly-changes — «qué ha cambiado esta semana» sobre el universo
// del escaneo nocturno estadounidense.
//
// Diseño: docs/diseno-que-cambio-2026-08-16.md (línea en el screener + panel de
// detalle). Cálculo y elección de pareja: lib/weeklyChanges.js (puro). Esta
// ruta solo orquesta: lista los nocturnos retenidos, comprueba la cobertura de
// scan_symbol_history (la fuente preferida cuando esté poblada), trae las
// filas ligeras de los dos escaneos elegidos y devuelve los cambios con su
// ventana declarada.
//
// La respuesta nunca inventa un cero: si no hay dos escaneos comparables, el
// estado lo dice con su motivo (`state: "not-comparable"` + `reason`), y los
// conteos solo viajan cuando la comparación existe.

import { hydrateRowsWithWeeklyRs } from "@/lib/globalRs";
import { PUBLISHABLE_PARENT_STATUS, scanProgressStatus } from "@/lib/nightlyUsScan";
import { nightlyUsLocalIdPattern } from "@/lib/scanLocalId";
import { createTtlCache } from "@/lib/serverCache";
import { userFacingServiceError } from "@/lib/serviceErrors";
import {
  disabledPayload,
  requirePersistenceAuth,
  supabaseConfig,
  supabaseCount,
  supabaseRequest,
  supabaseRequestAll,
} from "@/lib/supabaseServer";
import {
  STAGE_CRITERIA_CUTOVER_SCAN_DATE,
  US_MIC_CODES,
  computeWeeklyChanges,
  dataAsOfFromRows,
  normalizeScanRows,
  pickComparisonPair,
  stageVocabularyIncompatible,
} from "@/lib/weeklyChanges";

const SUPABASE_TIMEOUT_MS = 8000;
// El nocturno escribe una vez al día; 10 minutos de caché absorben las
// visitas de una sesión sin retrasar de forma apreciable un dato diario.
const WEEKLY_CHANGES_TTL_MS = 10 * 60 * 1000;
// Filas por escaneo: ~3.300 hoy; margen para crecer sin releer a ciegas.
const MAX_SCAN_ROWS = 8000;
// Ventana del conteo de cobertura de scan_symbol_history: una semana de
// mercado más margen de fin de semana.
const HISTORY_COVERAGE_DAYS = 9;
// La historia «cubre» cuando su volumen US reciente alcanza al menos la mitad
// del universo del nocturno (hoy ~3.300): por debajo no puede responder la
// ventana semanal del universo completo.
const HISTORY_MIN_SHARE = 0.5;
const HISTORY_MIN_ROWS = 500;

const cacheKeyGlobal = "__statsedge_weekly_changes_cache__";
const existingCache = globalThis[cacheKeyGlobal];
const weeklyChangesCache =
  existingCache && typeof existingCache.get === "function"
    ? existingCache
    : (globalThis[cacheKeyGlobal] = createTtlCache({ maxEntries: 4, name: "weekly-changes" }));

const LIGHT_ROW_SELECT = "symbol,company_name,theme,metrics";

async function readScanRows(scanId) {
  const rows = await supabaseRequestAll(
    "scan_results",
    {
      query: [
        `scan_id=eq.${encodeURIComponent(scanId)}`,
        `select=${LIGHT_ROW_SELECT}`,
        // Orden estable: la paginación por offset sin orden puede duplicar o
        // saltarse filas entre páginas. symbol es único dentro de un escaneo.
        "order=symbol.asc",
      ].join("&"),
      timeoutMs: SUPABASE_TIMEOUT_MS,
    },
    { maxRows: MAX_SCAN_ROWS, pageSize: 1000 },
  );
  return normalizeScanRows(rows);
}

// La fuente preferida por diseño es scan_symbol_history (memoria larga con el
// porqué de cada cambio), pero hoy solo la alimentan los crones rotatorios no
// estadounidenses. Este conteo mide en cada corrida si eso cambió; mientras no
// cubra, la fuente es el par de nocturnos y la respuesta lo declara.
async function historyCoverage(ownerId, currentUniverseSize) {
  const since = new Date(Date.now() - HISTORY_COVERAGE_DAYS * 86400000).toISOString();
  const needed = Math.max(HISTORY_MIN_ROWS, Math.round(currentUniverseSize * HISTORY_MIN_SHARE));
  try {
    const usRows = await supabaseCount("scan_symbol_history", {
      query: [
        `owner_id=eq.${encodeURIComponent(ownerId)}`,
        `mic_code=in.(${US_MIC_CODES.join(",")})`,
        `observed_at=gte.${encodeURIComponent(since)}`,
      ].join("&"),
      timeoutMs: SUPABASE_TIMEOUT_MS,
    });
    return { usRowsRecent: usRows, sinceDays: HISTORY_COVERAGE_DAYS, needed, sufficient: usRows >= needed };
  } catch (error) {
    console.error("[weekly-changes] cobertura de scan_symbol_history no medible:", error?.message || error);
    return { usRowsRecent: null, sinceDays: HISTORY_COVERAGE_DAYS, needed, sufficient: false, error: true };
  }
}

function listRow(row) {
  return {
    symbol: row.symbol,
    name: row.name,
    theme: row.theme,
    stageFrom: row.stageFrom,
    stageTo: row.stageTo,
    d52Now: row.d52Now,
    d52Anchor: row.d52Anchor,
    rs: null,
  };
}

// Orden por defecto de las listas del detalle: RS descendente (el criterio se
// muestra y es elegible en el panel), sin RS al final, empate por ticker.
function sortByRs(rows) {
  return [...rows].sort((a, b) => {
    const rsA = Number.isFinite(a.rs) ? a.rs : -1;
    const rsB = Number.isFinite(b.rs) ? b.rs : -1;
    if (rsB !== rsA) return rsB - rsA;
    return a.symbol.localeCompare(b.symbol);
  });
}

async function attachCanonicalRs(sections) {
  const allRows = sections.flat();
  if (!allRows.length) return;
  const hydrated = await hydrateRowsWithWeeklyRs(allRows);
  const bySymbol = new Map(hydrated.map((row) => [row.symbol, row]));
  for (const row of allRows) {
    const entry = bySymbol.get(row.symbol);
    row.rs = entry?.weeklyRsAvailable && Number.isFinite(entry.weeklyRsRating) ? entry.weeklyRsRating : null;
  }
}

function scanSummary(meta, dataAsOf) {
  return { localId: meta.localId, scanDate: meta.scanDate, dataAsOf };
}

export async function GET(req) {
  const authError = requirePersistenceAuth(req);
  if (authError) return authError;
  const config = supabaseConfig();
  if (!config.configured) {
    return Response.json({ ok: false, state: "cloud-off", message: disabledPayload().message });
  }
  const { searchParams } = new URL(req.url);
  const bypassCache = searchParams.get("refresh") === "1";
  const cacheKey = `weekly-changes:${config.ownerId}`;
  if (!bypassCache) {
    const cached = weeklyChangesCache.get(cacheKey);
    if (cached) return Response.json(cached);
  }

  try {
    const scans = await supabaseRequest("scans", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `local_id=like.${encodeURIComponent(nightlyUsLocalIdPattern())}`,
        "deleted_at=is.null",
        "select=id,local_id,created_at,row_count,settings",
        "order=created_at.desc",
        "limit=12",
      ].join("&"),
      timeoutMs: SUPABASE_TIMEOUT_MS,
    });

    const publishable = (Array.isArray(scans) ? scans : [])
      .filter((scan) => PUBLISHABLE_PARENT_STATUS.includes(scanProgressStatus(scan)))
      .map((scan) => ({ id: scan.id, localId: scan.local_id, createdAt: scan.created_at, rowCount: scan.row_count }));

    const pair = pickComparisonPair(publishable);

    if (!pair.current) {
      const payload = { ok: true, state: "no-scan", reason: pair.reason || "no-nightly-scans", computedAt: new Date().toISOString() };
      return Response.json(payload);
    }

    if (!pair.anchor) {
      const payload = {
        ok: true,
        state: "not-comparable",
        reason: pair.reason,
        cutover: STAGE_CRITERIA_CUTOVER_SCAN_DATE,
        window: { toScan: scanSummary(pair.current, null) },
        computedAt: new Date().toISOString(),
      };
      return Response.json(payload);
    }

    const [anchorBySymbol, currentBySymbol, history] = await Promise.all([
      readScanRows(pair.anchor.id),
      readScanRows(pair.current.id),
      historyCoverage(config.ownerId, pair.current.rowCount || 0),
    ]);

    const anchorAsOf = dataAsOfFromRows(anchorBySymbol);
    const currentAsOf = dataAsOfFromRows(currentBySymbol);

    if (!anchorAsOf || !currentAsOf || anchorAsOf >= currentAsOf) {
      const payload = {
        ok: true,
        state: "not-comparable",
        reason: "no-sessions-between-scans",
        cutover: STAGE_CRITERIA_CUTOVER_SCAN_DATE,
        window: { fromScan: scanSummary(pair.anchor, anchorAsOf), toScan: scanSummary(pair.current, currentAsOf) },
        computedAt: new Date().toISOString(),
      };
      return Response.json(payload);
    }

    if (stageVocabularyIncompatible(anchorBySymbol, currentBySymbol)) {
      const payload = {
        ok: true,
        state: "not-comparable",
        reason: "stage-criteria-changed",
        cutover: STAGE_CRITERIA_CUTOVER_SCAN_DATE,
        window: { fromScan: scanSummary(pair.anchor, anchorAsOf), toScan: scanSummary(pair.current, currentAsOf) },
        computedAt: new Date().toISOString(),
      };
      return Response.json(payload);
    }

    const changes = computeWeeklyChanges(anchorBySymbol, currentBySymbol);

    const entries = changes.stage2.entries.map(listRow);
    const exits = changes.stage2.exits.map(listRow);
    const newHighs = changes.highs.newThisWindow.map(listRow);
    const alreadyNear = changes.highs.alreadyNear.map(listRow);
    await attachCanonicalRs([entries, exits, newHighs, alreadyNear]);

    const payload = {
      ok: true,
      state: "ok",
      computedAt: new Date().toISOString(),
      window: {
        from: anchorAsOf,
        to: currentAsOf,
        fromScan: scanSummary(pair.anchor, anchorAsOf),
        toScan: scanSummary(pair.current, currentAsOf),
        partialWeek: Boolean(pair.partialWeek),
        partialReason: pair.partialReason || null,
        cutover: STAGE_CRITERIA_CUTOVER_SCAN_DATE,
      },
      population: changes.population,
      stage2: {
        entries: { count: entries.length, rows: sortByRs(entries) },
        exits: { count: exits.length, rows: sortByRs(exits) },
      },
      highs: {
        atHighNow: changes.highs.atHighNow,
        thresholds: changes.highs.thresholds,
        newThisWindow: { count: newHighs.length, rows: sortByRs(newHighs) },
        alreadyNear: { count: alreadyNear.length, rows: sortByRs(alreadyNear) },
        noAnchor: { count: changes.highs.noAnchor.length },
      },
      source: {
        kind: "nightly-scan-pair",
        history,
      },
    };

    weeklyChangesCache.set(cacheKey, payload, WEEKLY_CHANGES_TTL_MS);
    return Response.json(payload);
  } catch (error) {
    console.error("[weekly-changes] error:", error?.message || error);
    return Response.json(
      { error: userFacingServiceError(error?.message, "Los cambios de la semana no están disponibles ahora mismo.") },
      { status: 502 },
    );
  }
}
