import { buildDiscoverySnapshot } from "@/lib/discovery";
import { readScanRows } from "@/lib/leaderboards";
import { nightlyBoundaryBefore, nightlyDataFreshness } from "@/lib/nightlyBoundary";
import { disabledPayload, supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

const SNAPSHOT_KIND = "discovery";
const SOURCE = "discovery_snapshots";
const DEFAULT_CACHE_SCAN_ROWS = Number(process.env.DISCOVERY_CACHE_SCAN_ROWS || 300);
const DEFAULT_CACHE_SINCE_DAYS = Number(process.env.DISCOVERY_CACHE_SINCE_DAYS || 14);
const DEFAULT_CACHE_READ_TIMEOUT_MS = Number(process.env.DISCOVERY_CACHE_READ_TIMEOUT_MS || 3500);

// ─── Caducidad de la caché ────────────────────────────────────────────────
//
// Hasta 2026-08-13 esta caché no caducaba: leía la fila más reciente de
// leaderboard_snapshots y la servía, sin comparar nunca con la fecha actual.
// Como el trabajo que la escribe (/api/jobs/discovery-refresh) no está en
// vercel.json ni en ningún workflow —solo corre a mano, y la última vez fue
// el 20 de junio—, Listas y Sectores llevaban 54 días sirviendo un payload
// congelado de seis valores. Ver docs/migracion-listas-2026-08-13.md §2.
//
// La regla —la frontera de las 04:00 UTC, no un TTL en horas— nació aquí y
// el 25-08 se movió a lib/nightlyBoundary.js (módulo sin dependencias) para
// que la sesión del screener, que vive en el navegador, pudiera aplicar la
// misma caducidad. El porqué completo está en la cabecera de ese módulo.
export { nightlyBoundaryBefore };

// Alias histórico: los consumidores de discovery hablan de "snapshot
// generado"; la regla es la genérica de nightlyBoundary.
export function discoverySnapshotFreshness(generatedAt, now = new Date()) {
  return nightlyDataFreshness(generatedAt, now);
}

export const DISCOVERY_CACHE_SPECS = [
  {
    key: "discovery:interactive:v1",
    title: "Discovery interactivo",
    params: { limit: "20", groupItemLimit: "8", groupsLimit: "12", minGroupSize: "1" },
    read: { maxRows: DEFAULT_CACHE_SCAN_ROWS, sinceDays: DEFAULT_CACHE_SINCE_DAYS, timeoutMs: DEFAULT_CACHE_READ_TIMEOUT_MS },
  },
  {
    key: "discovery:review:v1",
    title: "Discovery revisión",
    params: { limit: "80", groupItemLimit: "8", groupsLimit: "16", minGroupSize: "1" },
    read: { maxRows: DEFAULT_CACHE_SCAN_ROWS, sinceDays: DEFAULT_CACHE_SINCE_DAYS, timeoutMs: DEFAULT_CACHE_READ_TIMEOUT_MS },
  },
];

function cleanText(value = "") {
  return String(value || "").trim();
}

function intValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function scopeKey(params = {}) {
  const type = cleanText(params.scopeType || params.groupType || "global") || "global";
  const value = cleanText(params.scopeValue || params.group || "");
  return value && type !== "global" ? `${type}:${value}` : "global";
}

function matchesSpec(params = {}, spec = {}) {
  if (scopeKey(params) !== "global") return false;
  // El snapshot se materializa desde la fuente por defecto. Una petición que
  // pide explícitamente otra fuente no puede recibirlo: serviría filas de un
  // origen distinto del que pidió, sin decirlo.
  if (params.source && params.source !== "nightly-us") return false;
  const specParams = spec.params || {};
  return intValue(params.limit, 25) === intValue(specParams.limit, 25)
    && intValue(params.groupItemLimit, 12) === intValue(specParams.groupItemLimit, 12)
    && intValue(params.groupsLimit, 50) === intValue(specParams.groupsLimit, 50)
    && intValue(params.minGroupSize, 2) === intValue(specParams.minGroupSize, 2);
}

export function discoveryCacheKeyForParams(params = {}) {
  if (params.cache === false || params.cache === "0") return "";
  return DISCOVERY_CACHE_SPECS.find((spec) => matchesSpec(params, spec))?.key || "";
}

export async function readMaterializedDiscoverySnapshot(key = "", { now = new Date() } = {}) {
  const config = supabaseConfig();
  if (!config.configured || !key) return null;
  const snapshots = await supabaseRequest("leaderboard_snapshots", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&leaderboard_key=eq.${encodeURIComponent(key)}&select=*&order=generated_at.desc&limit=1`,
    timeoutMs: 1500,
  });
  const row = snapshots?.[0];
  if (!row) return null;
  const criteria = row.criteria && typeof row.criteria === "object" ? row.criteria : {};
  if (criteria.snapshotKind !== SNAPSHOT_KIND || !criteria.payload) return null;
  // Un snapshot anterior a la última corrida del nocturno describe datos que
  // ya no son los vigentes: se descarta y quien llama hace la lectura viva.
  const freshness = discoverySnapshotFreshness(row.generated_at, now);
  if (!freshness.fresh) {
    return { expired: true, key: row.leaderboard_key, generatedAt: row.generated_at, freshness };
  }
  return {
    key: row.leaderboard_key,
    title: row.title,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    itemCount: Number(row.item_count || 0),
    params: criteria.params || {},
    read: criteria.read || null,
    payload: criteria.payload,
    freshness,
    cache: { hit: true, status: "supabase", key: row.leaderboard_key, source: SOURCE, ageHours: freshness.ageHours },
  };
}

export async function writeMaterializedDiscoverySnapshots(entries = []) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: 0, ...disabledPayload() };
  const saved = [];
  for (const entry of entries) {
    const snapshot = entry.snapshot || {};
    const [row] = await supabaseRequest("leaderboard_snapshots", {
      method: "POST",
      query: "on_conflict=owner_id,leaderboard_key",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [{
        owner_id: config.ownerId,
        leaderboard_key: entry.key,
        scope_type: "global",
        scope_value: null,
        strategy: SNAPSHOT_KIND,
        title: entry.title || entry.key,
        criteria: {
          snapshotKind: SNAPSHOT_KIND,
          params: entry.params || {},
          read: entry.read || null,
          payload: snapshot,
        },
        item_count: snapshot.rows?.length || 0,
        source: SOURCE,
        generated_at: snapshot.generatedAt || new Date().toISOString(),
      }],
    });
    saved.push({ key: entry.key, count: snapshot.rows?.length || 0, snapshotId: row?.id || null });
  }
  return { configured: true, ok: true, saved: saved.length, snapshots: saved };
}

export async function buildDiscoveryCacheEntries(specs = DISCOVERY_CACHE_SPECS) {
  const rowsByRead = new Map();
  const entries = [];
  for (const spec of specs) {
    const read = spec.read || {};
    const readKey = `${read.maxRows || ""}:${read.sinceDays || ""}`;
    let scanData = rowsByRead.get(readKey);
    if (!scanData) {
      scanData = await readScanRows(read);
      rowsByRead.set(readKey, scanData);
    }
    if (!scanData.configured) return { configured: false, entries: [], scanData };
    const snapshot = buildDiscoverySnapshot(scanData.rows || [], spec.params || {});
    entries.push({
      key: spec.key,
      title: spec.title,
      params: spec.params || {},
      read,
      inputRows: scanData.rows?.length || 0,
      snapshot,
    });
  }
  return { configured: true, entries };
}
