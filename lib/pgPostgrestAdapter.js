const TABLE_RE = /^[a-z_][a-z0-9_]*$/i;
const OPERATORS = ["neq", "gte", "lte", "not", "eq", "gt", "lt", "like", "ilike", "in", "is", "cs"];

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

export function buildPostgrestSelectSql(table, query = {}) {
  const tableName = assertTableName(table);
  const params = normalizePostgrestQuery(query);
  const select = parseSelectList(params.select || "*");
  const whereParts = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, rawValue] of Object.entries(params)) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const clause = buildFilterClause(key, rawValue, values, paramIndex);
    whereParts.push(clause.sql);
    values.push(...clause.values);
    paramIndex = clause.nextIndex;
  }

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
  const params = normalizePostgrestQuery(query);
  const whereParts = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, rawValue] of Object.entries(params)) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const clause = buildFilterClause(key, rawValue, values, paramIndex);
    whereParts.push(clause.sql);
    values.push(...clause.values);
    paramIndex = clause.nextIndex;
  }

  const sqlParts = [`SELECT COUNT(*)::int AS count FROM "${tableName}"`];
  if (whereParts.length) sqlParts.push(`WHERE ${whereParts.join(" AND ")}`);
  return { sql: sqlParts.join(" "), values };
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
  if (method !== "GET") {
    const error = new Error(`Operación ${method} no disponible en modo pg local (solo lecturas GET)`);
    error.code = "PG_WRITE_UNSUPPORTED";
    throw error;
  }
  const { sql, values } = buildPostgrestSelectSql(table, options.query || {});
  const result = await pool.query(sql, values);
  return result.rows;
}

export async function pgCount(pool, table, options = {}) {
  const { sql, values } = buildPostgrestCountSql(table, options.query || {});
  const result = await pool.query(sql, values);
  return Number(result.rows?.[0]?.count || 0);
}
