const TABLE_RE = /^[a-z_][a-z0-9_]*$/i;
const COLUMN_RE = /^[a-z_][a-z0-9_]*$/i;
const OPERATORS = ["neq", "gte", "lte", "not", "eq", "gt", "lt", "like", "ilike", "in", "is", "cs"];
const QUERY_META_KEYS = new Set(["select", "order", "limit", "offset", "on_conflict"]);

let sharedPool = null;
let pgModulePromise = null;

async function loadPg() {
  if (!pgModulePromise) {
    pgModulePromise = import("pg").then((mod) => mod.default ?? mod);
  }
  return pgModulePromise;
}

function assertTableName(table = "") {
  const name = String(table || "").trim();
  if (!TABLE_RE.test(name)) {
    throw new Error(`Nombre de tabla no permitido: ${table}`);
  }
  return name;
}

function assertColumnName(column = "") {
  const name = String(column || "").trim();
  if (!COLUMN_RE.test(name)) {
    throw new Error(`Nombre de columna no permitido: ${column}`);
  }
  return name;
}

function quoteColumn(column = "") {
  const trimmed = String(column || "").trim();
  if (!trimmed || trimmed === "*") return "*";
  if (trimmed.includes("->")) {
    const parts = trimmed.split("->");
    const base = `"${parts[0].trim().replace(/"/g, '""')}"`;
    const accessors = parts.slice(1).map((part) => `'${part.trim().replace(/'/g, "''")}'`);
    return [base, ...accessors].join("->");
  }
  return `"${trimmed.replace(/"/g, '""')}"`;
}

function parseSelectList(select = "*") {
  const raw = String(select || "*").trim() || "*";
  if (raw === "*") return "*";
  if (raw.includes("(")) {
    throw new Error(`select embebido PostgREST no soportado en modo pg: ${raw}`);
  }
  return raw
    .split(",")
    .map((part) => quoteColumn(part.trim()))
    .join(", ");
}

function splitOperator(raw = "") {
  const value = String(raw || "");
  for (const op of OPERATORS) {
    const prefix = `${op}.`;
    if (value.startsWith(prefix)) {
      return { op, value: value.slice(prefix.length) };
    }
  }
  return null;
}

function parseInList(raw = "") {
  const text = String(raw || "").trim();
  if (!text.startsWith("(") || !text.endsWith(")")) {
    throw new Error(`Sintaxis in.(...) inválida: ${raw}`);
  }
  const inner = text.slice(1, -1);
  if (!inner) return [];
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current.trim());
  return values.filter(Boolean);
}

function decodeFilterValue(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function postgrestLikeToSql(pattern = "") {
  return String(pattern || "").replace(/\*/g, "%");
}

function buildFilterClause(column, rawFilter, params, paramIndex) {
  const parsed = splitOperator(rawFilter);
  if (!parsed) {
    throw new Error(`Filtro PostgREST no reconocido en ${column}: ${rawFilter}`);
  }
  const col = quoteColumn(column);
  const value = decodeFilterValue(parsed.value);

  if (parsed.op === "not") {
    const nested = splitOperator(value);
    if (!nested) throw new Error(`Filtro not.* inválido en ${column}: ${rawFilter}`);
    if (nested.op === "eq" && nested.value === "null") {
      return { sql: `${col} IS NOT NULL`, values: [], nextIndex: paramIndex };
    }
    if (nested.op === "is" && nested.value === "null") {
      return { sql: `${col} IS NOT NULL`, values: [], nextIndex: paramIndex };
    }
    throw new Error(`Filtro not.* no soportado en ${column}: ${rawFilter}`);
  }

  if (parsed.op === "is") {
    if (value === "null") return { sql: `${col} IS NULL`, values: [], nextIndex: paramIndex };
    if (value === "not.null") return { sql: `${col} IS NOT NULL`, values: [], nextIndex: paramIndex };
    throw new Error(`Filtro is.* no soportado en ${column}: ${rawFilter}`);
  }

  if (parsed.op === "in") {
    const items = parseInList(value);
    if (!items.length) return { sql: "FALSE", values: [], nextIndex: paramIndex };
    const placeholders = items.map((_, idx) => `$${paramIndex + idx}`);
    return {
      sql: `${col} IN (${placeholders.join(", ")})`,
      values: items,
      nextIndex: paramIndex + items.length,
    };
  }

  if (parsed.op === "cs") {
    return {
      sql: `${col} @> $${paramIndex}::jsonb`,
      values: [value],
      nextIndex: paramIndex + 1,
    };
  }

  const operators = {
    eq: "=",
    neq: "<>",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    like: "LIKE",
    ilike: "ILIKE",
  };
  const sqlOp = operators[parsed.op];
  if (!sqlOp) throw new Error(`Operador no soportado en ${column}: ${parsed.op}`);

  const paramValue = parsed.op === "like" || parsed.op === "ilike"
    ? postgrestLikeToSql(value)
    : value;

  return {
    sql: `${col} ${sqlOp} $${paramIndex}`,
    values: [paramValue],
    nextIndex: paramIndex + 1,
  };
}

export function normalizePostgrestQuery(query = {}) {
  if (typeof query === "string") {
    const params = new URLSearchParams(query.replace(/^\?/, ""));
    return Object.fromEntries(params.entries());
  }
  if (query && typeof query === "object") {
    return { ...query };
  }
  return {};
}

export function parsePreferHeader(prefer = "") {
  const parts = String(prefer || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    mergeDuplicates: parts.includes("resolution=merge-duplicates"),
    ignoreDuplicates: parts.includes("resolution=ignore-duplicates"),
    returnRepresentation: parts.includes("return=representation"),
    returnMinimal: parts.includes("return=minimal"),
  };
}

export function parseOnConflict(query = {}) {
  const params = normalizePostgrestQuery(query);
  const raw = String(params.on_conflict || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => assertColumnName(part.trim()))
    .filter(Boolean);
}

function buildWhereClause(query = {}, paramIndexStart = 1) {
  const params = normalizePostgrestQuery(query);
  const whereParts = [];
  const values = [];
  let paramIndex = paramIndexStart;

  for (const [key, rawValue] of Object.entries(params)) {
    if (QUERY_META_KEYS.has(key)) continue;
    const clause = buildFilterClause(key, rawValue, values, paramIndex);
    whereParts.push(clause.sql);
    values.push(...clause.values);
    paramIndex = clause.nextIndex;
  }

  return { whereParts, values, paramIndex };
}

function serializeSqlValue(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

function sqlPlaceholderForValue(value, paramIndex) {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) return `$${paramIndex}`;
    return `$${paramIndex}::jsonb`;
  }
  return `$${paramIndex}`;
}

function normalizeInsertRows(body) {
  if (Array.isArray(body)) return body.filter((row) => row && typeof row === "object");
  if (body && typeof body === "object") return [body];
  return [];
}

export function buildPostgrestSelectSql(table, query = {}) {
  const tableName = assertTableName(table);
  const params = normalizePostgrestQuery(query);
  const select = parseSelectList(params.select || "*");
  const { whereParts, values, paramIndex: nextIndex } = buildWhereClause(query);

  const orderClauses = String(params.order || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [column, direction = "asc"] = part.split(".");
      const dir = String(direction || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
      return `${quoteColumn(column)} ${dir}`;
    });

  const sqlParts = [`SELECT ${select} FROM "${tableName}"`];
  if (whereParts.length) sqlParts.push(`WHERE ${whereParts.join(" AND ")}`);

  let paramIndex = nextIndex;
  if (orderClauses.length) sqlParts.push(`ORDER BY ${orderClauses.join(", ")}`);

  const limit = Number(params.limit);
  if (Number.isFinite(limit) && limit >= 0) {
    sqlParts.push(`LIMIT $${paramIndex}`);
    values.push(limit);
    paramIndex += 1;
  }

  const offset = Number(params.offset);
  if (Number.isFinite(offset) && offset >= 0) {
    sqlParts.push(`OFFSET $${paramIndex}`);
    values.push(offset);
  }

  return { sql: sqlParts.join(" "), values };
}

export function buildPostgrestCountSql(table, query = {}) {
  const tableName = assertTableName(table);
  const { whereParts, values } = buildWhereClause(query);
  const sqlParts = [`SELECT COUNT(*)::int AS count FROM "${tableName}"`];
  if (whereParts.length) sqlParts.push(`WHERE ${whereParts.join(" AND ")}`);
  return { sql: sqlParts.join(" "), values };
}

export function buildPostgrestDeleteSql(table, query = {}) {
  const tableName = assertTableName(table);
  const { whereParts, values } = buildWhereClause(query);
  if (!whereParts.length) {
    throw new Error(`DELETE sin filtros no permitido en modo pg: ${table}`);
  }
  return { sql: `DELETE FROM "${tableName}" WHERE ${whereParts.join(" AND ")}`, values };
}

export function buildPostgrestInsertSql(table, body = [], options = {}) {
  const tableName = assertTableName(table);
  const rows = normalizeInsertRows(body);
  if (!rows.length) return { sql: "", values: [], returning: false };

  const columns = Object.keys(rows[0]).map(assertColumnName);
  if (!columns.length) throw new Error(`INSERT sin columnas en ${table}`);

  const conflictColumns = parseOnConflict(options.query || {});
  const prefer = parsePreferHeader(options.prefer || "");
  const values = [];
  let paramIndex = 1;
  const valueGroups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      const original = row[column];
      const serialized = serializeSqlValue(original);
      const placeholder = sqlPlaceholderForValue(original, paramIndex);
      values.push(serialized);
      paramIndex += 1;
      return placeholder;
    });
    return `(${placeholders.join(", ")})`;
  });

  const quotedColumns = columns.map((column) => quoteColumn(column)).join(", ");
  const sqlParts = [
    `INSERT INTO "${tableName}" (${quotedColumns}) VALUES ${valueGroups.join(", ")}`,
  ];

  if (conflictColumns.length) {
    const conflict = conflictColumns.map((column) => quoteColumn(column)).join(", ");
    if (prefer.ignoreDuplicates) {
      sqlParts.push(`ON CONFLICT (${conflict}) DO NOTHING`);
    } else if (prefer.mergeDuplicates) {
      const conflictSet = new Set(conflictColumns);
      const updateColumns = columns.filter((column) => column !== "id" && !conflictSet.has(column));
      if (updateColumns.length) {
        const assignments = updateColumns
          .map((column) => `${quoteColumn(column)} = EXCLUDED.${quoteColumn(column)}`)
          .join(", ");
        sqlParts.push(`ON CONFLICT (${conflict}) DO UPDATE SET ${assignments}`);
      } else {
        sqlParts.push(`ON CONFLICT (${conflict}) DO NOTHING`);
      }
    } else {
      throw new Error(`on_conflict requiere resolution=merge-duplicates o resolution=ignore-duplicates en ${table}`);
    }
  }

  const returning = prefer.returnRepresentation;
  if (returning) sqlParts.push("RETURNING *");

  return { sql: sqlParts.join(" "), values, returning };
}

export function buildPostgrestPatchSql(table, body = {}, query = {}) {
  const tableName = assertTableName(table);
  const patch = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const columns = Object.keys(patch).map(assertColumnName);
  if (!columns.length) return { sql: "", values: [], returning: false };

  const values = [];
  let paramIndex = 1;
  const assignments = columns.map((column) => {
    const original = patch[column];
    const serialized = serializeSqlValue(original);
    const placeholder = sqlPlaceholderForValue(original, paramIndex);
    values.push(serialized);
    paramIndex += 1;
    return `${quoteColumn(column)} = ${placeholder}`;
  });

  const { whereParts, values: whereValues } = buildWhereClause(query, paramIndex);
  if (!whereParts.length) {
    throw new Error(`PATCH sin filtros no permitido en modo pg: ${table}`);
  }

  const sql = `UPDATE "${tableName}" SET ${assignments.join(", ")} WHERE ${whereParts.join(" AND ")} RETURNING *`;
  return { sql, values: [...values, ...whereValues], returning: true };
}

export async function getPgPool(databaseUrl, { forceNew = false } = {}) {
  const pg = await loadPg();
  if (forceNew) return new pg.Pool({ connectionString: databaseUrl, max: 10 });
  if (!sharedPool) {
    sharedPool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  }
  return sharedPool;
}

export async function closePgPool() {
  if (!sharedPool) return;
  await sharedPool.end();
  sharedPool = null;
}

export async function pgRequest(pool, table, options = {}) {
  const method = String(options.method || "GET").toUpperCase();

  if (method === "GET") {
    const { sql, values } = buildPostgrestSelectSql(table, options.query || {});
    const result = await pool.query(sql, values);
    return result.rows;
  }

  if (method === "DELETE") {
    const { sql, values } = buildPostgrestDeleteSql(table, options.query || {});
    await pool.query(sql, values);
    return null;
  }

  if (method === "POST") {
    const { sql, values, returning } = buildPostgrestInsertSql(table, options.body, options);
    if (!sql) return [];
    const result = await pool.query(sql, values);
    return returning ? result.rows : null;
  }

  if (method === "PATCH") {
    const { sql, values, returning } = buildPostgrestPatchSql(table, options.body, options.query || {});
    if (!sql) return [];
    const result = await pool.query(sql, values);
    return returning ? result.rows : null;
  }

  const error = new Error(`Operación ${method} no disponible en modo pg local`);
  error.code = "PG_WRITE_UNSUPPORTED";
  throw error;
}

export async function pgCount(pool, table, options = {}) {
  const { sql, values } = buildPostgrestCountSql(table, options.query || {});
  const result = await pool.query(sql, values);
  return Number(result.rows?.[0]?.count || 0);
}

const PG_RPC_SUPPORTED = new Set([
  "scan_symbol_history_latest_v1",
  "leaderboard_publishable_rows",
  "scan_finalize_inputs",
  "finalize_scan_results",
]);

export function isPgRpcSupported(functionName = "") {
  return PG_RPC_SUPPORTED.has(String(functionName || "").trim());
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(base, max));
}

export function buildLeaderboardPublishableRowsSql(ownerId, maxRows = 5000, sinceDays = 45) {
  const owner = String(ownerId || "").trim();
  if (!owner) {
    throw new Error("leaderboard_publishable_rows requiere p_owner_id");
  }
  const limit = clampInt(maxRows, 5000, 1, 10000);
  const since = clampInt(sinceDays, 45, 1, Number.MAX_SAFE_INTEGER);
  // Equivalente a 20260814150000_leaderboard_publishable_rows_filter_before_limit.sql:
  // filtra por parent_status ANTES del LIMIT para que escaneos fallidos no monopolicen el cupo.
  const sql = `
    WITH scoped AS (
      SELECT
        sr.id,
        sr.owner_id,
        sr.scan_id,
        sr.symbol,
        sr.company_name,
        sr.country,
        sr.sector,
        sr.industry,
        sr.theme,
        sr.rank_index,
        sr.total_score,
        sr.weinstein_score,
        sr.minervini_score,
        sr.risk_score,
        sr.rs_rating,
        sr.metrics,
        sr.raw,
        sr.created_at,
        s.settings -> 'progress' ->> 'status' AS parent_status
      FROM "scan_results" AS sr
      JOIN "scans" AS s ON s.id = sr.scan_id
      WHERE sr.owner_id = $1
        AND sr.created_at >= (now() - make_interval(days => $3))
    ),
    publishable AS (
      SELECT *
      FROM scoped
      WHERE parent_status IN ('complete', 'partial', 'done')
      ORDER BY created_at DESC
      LIMIT $2
    )
    SELECT jsonb_build_object(
      'rows',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', x.id,
          'owner_id', x.owner_id,
          'scan_id', x.scan_id,
          'symbol', x.symbol,
          'company_name', x.company_name,
          'country', x.country,
          'sector', x.sector,
          'industry', x.industry,
          'theme', x.theme,
          'rank_index', x.rank_index,
          'total_score', x.total_score,
          'weinstein_score', x.weinstein_score,
          'minervini_score', x.minervini_score,
          'risk_score', x.risk_score,
          'rs_rating', x.rs_rating,
          'metrics', x.metrics,
          'raw', x.raw,
          'created_at', x.created_at,
          'parent_status', x.parent_status
        ) ORDER BY x.created_at DESC)
        FROM publishable AS x
      ), '[]'::jsonb),
      'rowsRead',
      (SELECT count(*)::integer FROM scoped),
      'rowsPublished',
      (SELECT count(*)::integer FROM publishable),
      'rowsExcluded',
      (SELECT count(*)::integer FROM scoped WHERE parent_status NOT IN ('complete', 'partial', 'done') OR parent_status IS NULL)
    ) AS result
  `.trim();
  return { sql, values: [owner, limit, since] };
}

export function buildScanFinalizeInputsSql(ownerId, scanId, maxRows = 50000, offset = 0) {
  const owner = String(ownerId || "").trim();
  const scan = String(scanId || "").trim();
  if (!owner) throw new Error("scan_finalize_inputs requiere p_owner_id");
  if (!scan) throw new Error("scan_finalize_inputs requiere p_scan_id");
  const limit = clampInt(maxRows, 50000, 1, 50000);
  const pageOffset = Math.max(0, Number(offset) || 0);
  // Delega a la función PL/pgSQL (20260811150000) que proyecta thin-raw con
  // statsedge_coverage_finite_number — no replicar esa lógica en JS.
  const sql = `SELECT public.scan_finalize_inputs($1, $2::uuid, $3, $4) AS result`;
  return { sql, values: [owner, scan, limit, pageOffset] };
}

export function buildFinalizeScanResultsSql(ownerId, scanId, patches = []) {
  const owner = String(ownerId || "").trim();
  const scan = String(scanId || "").trim();
  if (!owner) throw new Error("finalize_scan_results requiere p_owner_id");
  if (!scan) throw new Error("finalize_scan_results requiere p_scan_id");
  const patchArray = Array.isArray(patches) ? patches : [];
  // Equivalente a schema.sql finalize_scan_results: merge atómico metrics || patch.
  const sql = `SELECT * FROM public.finalize_scan_results($1, $2::uuid, $3::jsonb)`;
  return { sql, values: [owner, scan, JSON.stringify(patchArray)] };
}

export function buildScanSymbolHistoryLatestSql(ownerId, micCodes = null) {
  const owner = String(ownerId || "").trim();
  if (!owner) {
    throw new Error("scan_symbol_history_latest_v1 requiere p_owner_id");
  }
  const sql = `
    SELECT DISTINCT ON (h.owner_id, h.mic_code, h.symbol)
      h.*
    FROM "scan_symbol_history" AS h
    WHERE h.owner_id = $1
      AND (
        $2::text[] IS NULL
        OR cardinality($2::text[]) = 0
        OR h.mic_code = ANY($2::text[])
      )
    ORDER BY
      h.owner_id,
      h.mic_code,
      h.symbol,
      h.observed_at DESC,
      h.id DESC
  `.trim();
  return { sql, values: [owner, micCodes] };
}

export async function pgRpc(pool, functionName, payload = {}) {
  const name = String(functionName || "").trim();
  if (name === "scan_symbol_history_latest_v1") {
    const { sql, values } = buildScanSymbolHistoryLatestSql(
      payload.p_owner_id,
      payload.p_mic_codes ?? null,
    );
    const result = await pool.query(sql, values);
    return result.rows;
  }
  if (name === "leaderboard_publishable_rows") {
    const { sql, values } = buildLeaderboardPublishableRowsSql(
      payload.p_owner_id,
      payload.p_max_rows,
      payload.p_since_days,
    );
    const result = await pool.query(sql, values);
    return result.rows?.[0]?.result ?? {};
  }
  if (name === "scan_finalize_inputs") {
    const { sql, values } = buildScanFinalizeInputsSql(
      payload.p_owner_id,
      payload.p_scan_id,
      payload.p_max_rows,
      payload.p_offset ?? 0,
    );
    const result = await pool.query(sql, values);
    return result.rows?.[0]?.result ?? {};
  }
  if (name === "finalize_scan_results") {
    const { sql, values } = buildFinalizeScanResultsSql(
      payload.p_owner_id,
      payload.p_scan_id,
      payload.p_patches,
    );
    const result = await pool.query(sql, values);
    return result.rows;
  }
  const error = new Error(`RPC ${name} no disponible en modo pg local`);
  error.code = "PG_RPC_UNSUPPORTED";
  throw error;
}
