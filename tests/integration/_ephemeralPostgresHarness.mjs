import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const FOUNDATION_BASE_COMMIT = "9d8eb553ffbc096f98d6ce74239fe896bb963001";
export const EPHEMERAL_POSTGRES_URL_ENV = "STATSEDGE_EPHEMERAL_POSTGRES_URL";
export const EPHEMERAL_POSTGRES_CONFIRM_ENV = "STATSEDGE_EPHEMERAL_POSTGRES";
export const EPHEMERAL_DATABASE_PREFIX = "statsedge_ephemeral_";
export const EPHEMERAL_SUITE_TOKEN = "{suite}";

// Required, physically separate databases for the Hito 1B-1 ephemeral suite.
// This is an inventory only: the harness neither creates databases nor permits
// one suite to borrow another suite's database.
export const EPHEMERAL_DATABASE_INVENTORY = Object.freeze([
  "statsedge_ephemeral_derived_snapshot_publication",
  "statsedge_ephemeral_ephemeral_roles_a",
  "statsedge_ephemeral_ephemeral_roles_b",
  "statsedge_ephemeral_scan_result_set_integrity",
  "statsedge_ephemeral_scan_result_set_concurrency",
  "statsedge_ephemeral_scan_execution_lifecycle",
  "statsedge_ephemeral_schema_parity_migrations",
  "statsedge_ephemeral_schema_parity_bootstrap",
  "statsedge_ephemeral_schema_parity_base_catalog",
]);

const FOUNDATION_MARKER_BEGIN = "-- STATS_EDGE_HITO_1A_FOUNDATION_BEGIN";
const FOUNDATION_MARKER_END = "-- STATS_EDGE_HITO_1A_FOUNDATION_END";
const EXECUTION_MARKER_BEGIN = "-- STATS_EDGE_HITO_1B_1_BEGIN";
const EXECUTION_MARKER_END = "-- STATS_EDGE_HITO_1B_1_END";

const HITO_TABLES = Object.freeze([
  "derived_snapshot_heads",
  "derived_snapshot_items",
  "derived_snapshots",
  "scan_executions",
  "scan_result_set_rows",
  "scan_result_sets",
  "scan_work_items",
]);

const PROJECTED_TABLES = Object.freeze(["scans", "scan_results", ...HITO_TABLES]);

// Bootstrap safety has two independent controls: a byte-exact reviewed source
// plus a lexical inventory of executable references. The digest alone is not
// evidence that comments/strings were classified correctly.
const REVIEWED_BOOTSTRAP_SOURCE_DIGEST = "d7bdb7e58100609ad3793209669982d0f874c3397b5594a2b9662c250b66da6c";
const REVIEWED_FOUNDATION_BASE_SOURCE_DIGEST = "dcf499b681c3fabc8fdd42b2481494e98aa87c8711235b5e3fb40057fcab2a56";
const REPAIRED_FOUNDATION_BASE_SOURCE_DIGEST = "31c96fc15b795abec6393c4c2a4549f5daf0f98a4ab16d827f245d4c049b7145";
const PG_CRON_EXTENSION_SQL = "create extension if not exists pg_cron;";
const LOCAL_CRON_STUB_SQL = `-- Hito 1B-1 controlled-bootstrap local cron stubs: no scheduler exists here.
create schema if not exists cron;
create or replace function cron.unschedule(p_job_name text)
returns boolean language sql immutable strict
as 'select false';
create or replace function cron.schedule(p_job_name text, p_schedule text, p_command text)
returns bigint language sql immutable strict
as 'select 0::bigint';`;
const LOCAL_STUBBED_EXECUTABLES = new Set(["cron.schedule", "cron.unschedule"]);

function skipQuoted(source, start, quote, eString = false) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === quote) {
      if (source[index + 1] === quote) { index += 2; continue; }
      return index + 1;
    }
    if (source[index] === "\\" && quote === "'" && eString) index += 2;
    else index += 1;
  }
  throw new Error("Unterminated SQL quoted literal in controlled bootstrap source.");
}

function skipBlockComment(source, start) {
  let index = start + 2;
  let depth = 1;
  while (index < source.length && depth > 0) {
    if (source.startsWith("/*", index)) { depth += 1; index += 2; }
    else if (source.startsWith("*/", index)) { depth -= 1; index += 2; }
    else index += 1;
  }
  if (depth !== 0) throw new Error("Unterminated SQL block comment in controlled bootstrap source.");
  return index;
}

function isDollarQuoteAt(source, index) {
  const match = source.slice(index).match(/^\$([A-Za-z_][A-Za-z0-9_]*|)\$/u);
  return match?.[0] || null;
}

function isExecutableDollarBody(prefix) {
  return /\bdo\s*(?:language\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/iu.test(prefix)
    || /\bas\s*$/iu.test(prefix);
}

export function bootstrapLexicalSafetyInventory(source) {
  const references = [];
  const ignored = { comments: 0, strings: 0, e_strings: 0, quoted_identifiers: 0, dollar_quotes: 0 };
  const scan = (sql, context = "sql") => {
    let executable = "";
    for (let index = 0; index < sql.length;) {
      if (sql.startsWith("--", index)) {
        ignored.comments += 1;
        index = sql.indexOf("\n", index + 2); if (index === -1) break;
        executable += "\n"; index += 1; continue;
      }
      if (sql.startsWith("/*", index)) {
        ignored.comments += 1; index = skipBlockComment(sql, index); executable += " "; continue;
      }
      if (sql[index] === "'") {
        ignored.strings += 1;
        const eString = index > 0 && /[eE]/u.test(sql[index - 1]) && !/[A-Za-z0-9_]/u.test(sql[index - 2] || "");
        if (eString) ignored.e_strings += 1;
        index = skipQuoted(sql, index, "'", eString); executable += " "; continue;
      }
      if (sql[index] === '"') {
        ignored.quoted_identifiers += 1; index = skipQuoted(sql, index, '"'); executable += " "; continue;
      }
      const tag = sql[index] === "$" ? isDollarQuoteAt(sql, index) : null;
      if (tag) {
        const bodyStart = index + tag.length;
        const bodyEnd = sql.indexOf(tag, bodyStart);
        if (bodyEnd === -1) throw new Error("Unterminated SQL dollar quote in controlled bootstrap source.");
        ignored.dollar_quotes += 1;
        if (isExecutableDollarBody(executable)) scan(sql.slice(bodyStart, bodyEnd), "plpgsql");
        executable += " "; index = bodyEnd + tag.length; continue;
      }
      executable += sql[index]; index += 1;
    }
    const executableReference = /\b(cron|net)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b|\b(https?_[A-Za-z_][A-Za-z0-9_]*)\b/giu;
    for (const match of executable.matchAll(executableReference)) {
      references.push({ reference: match[3] ? match[3].toLowerCase() : `${match[1].toLowerCase()}.${match[2].toLowerCase()}`, context });
    }
  };
  scan(source);
  return { references, ignored };
}

export function assertBootstrapLexicalSafety(sql, label = "bootstrap SQL") {
  const lexical = bootstrapLexicalSafetyInventory(sql);
  const uncovered = lexical.references.filter(({ reference }) => !LOCAL_STUBBED_EXECUTABLES.has(reference));
  if (uncovered.length) {
    throw new Error(`${label} contains executable operational references not covered by an exact transformation/stub: ${uncovered.map(({ reference }) => reference).join(", ")}`);
  }
  return lexical;
}

function suiteSlug(suiteName) {
  const slug = String(suiteName || "")
    .toLowerCase()
    .replace(/\.real\.test\.mjs$/u, "")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  assert.ok(slug, "Ephemeral PostgreSQL suite name must produce a non-empty database suffix.");
  return slug;
}

export function requireEphemeralPostgresUrl(suiteName) {
  const template = String(process.env[EPHEMERAL_POSTGRES_URL_ENV] || "").trim();
  const confirmed = String(process.env[EPHEMERAL_POSTGRES_CONFIRM_ENV] || "").trim();
  if (!template || confirmed !== "1") {
    throw new Error(
      `${suiteName} requires ${EPHEMERAL_POSTGRES_URL_ENV} and ${EPHEMERAL_POSTGRES_CONFIRM_ENV}=1; `
      + "mocks and non-ephemeral databases are forbidden.",
    );
  }
  if (!template.includes(EPHEMERAL_SUITE_TOKEN)) {
    throw new Error(
      `${EPHEMERAL_POSTGRES_URL_ENV} must contain ${EPHEMERAL_SUITE_TOKEN} in the database name. `
      + "Provision one distinct database per test suite; this harness never shares or creates databases.",
    );
  }

  const slug = suiteSlug(suiteName);
  const expectedDatabase = `${EPHEMERAL_DATABASE_PREFIX}${slug}`;
  let templateUrl;
  try {
    templateUrl = new URL(template);
  } catch (error) {
    throw new Error(`${EPHEMERAL_POSTGRES_URL_ENV} is not a valid PostgreSQL URL template: ${error.message}`);
  }
  if (!new Set(["postgres:", "postgresql:"]).has(templateUrl.protocol)) {
    throw new Error(`${EPHEMERAL_POSTGRES_URL_ENV} must use postgres:// or postgresql://.`);
  }
  const templateDatabase = decodeURIComponent(templateUrl.pathname.replace(/^\/+/, ""));
  if (templateDatabase !== `${EPHEMERAL_DATABASE_PREFIX}${EPHEMERAL_SUITE_TOKEN}`) {
    throw new Error(
      `SAFETY ABORT: ${EPHEMERAL_POSTGRES_URL_ENV} database must be exactly ${EPHEMERAL_DATABASE_PREFIX}${EPHEMERAL_SUITE_TOKEN}.`,
    );
  }
  const hostname = decodeURIComponent(templateUrl.hostname || "").toLowerCase();
  const socketHost = decodeURIComponent(templateUrl.searchParams.get("host") || "");
  const loopback = hostname === "127.0.0.1" || hostname === "::1";
  const explicitLocalSocket = socketHost.startsWith("/") || hostname.startsWith("/");
  if (!loopback && !explicitLocalSocket) {
    throw new Error("SAFETY ABORT: ephemeral PostgreSQL host must be 127.0.0.1, ::1, or an explicit local socket.");
  }
  const resolved = template.replaceAll(EPHEMERAL_SUITE_TOKEN, slug);
  let parsed;
  try {
    parsed = new URL(resolved);
  } catch (error) {
    throw new Error(`${EPHEMERAL_POSTGRES_URL_ENV} is not a valid PostgreSQL URL template: ${error.message}`);
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (databaseName !== expectedDatabase) {
    throw new Error(
      `SAFETY ABORT: resolved database must be exactly ${expectedDatabase}; received ${databaseName || "<empty>"}.`,
    );
  }
  return parsed.toString();
}

function psqlArgs(url, tail) {
  return [
    "--no-psqlrc",
    "--set", "ON_ERROR_STOP=1",
    "--single-transaction",
    "--dbname", url,
    ...tail,
  ];
}

function safeSqlInvocation(sql) {
  return String(sql)
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/giu, "$1[REDACTED]@")
    .replace(/\b(password|secret|token)\s*(=>|:=|=)\s*'[^']*'/giu, "$1$2'[REDACTED]'")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1200);
}

function postgresErrorFields(stderr) {
  const text = String(stderr || "").trim();
  const errorLine = text.match(/(?:ERROR|FATAL):\s+(?:([0-9A-Z]{5}):\s+)?([^\n]+)/u);
  const field = (name) => text.match(new RegExp(`(?:^|\\n)${name}:\\s*([^\\n]+)`, "u"))?.[1]?.trim() || null;
  return {
    sqlstate: errorLine?.[1] || field("SQLSTATE"),
    message: errorLine?.[2]?.trim() || field("MESSAGE") || text || "PostgreSQL command failed without an error message.",
    detail: field("DETAIL"),
    context: field("CONTEXT"),
  };
}

function postgresIntegrationError({ label, sql, sqlstate, exitCode, stdout, stderr, cause }) {
  const fields = postgresErrorFields(stderr);
  const invocation = safeSqlInvocation(sql);
  const error = new Error(
    `[${label}] SQLSTATE=${sqlstate || fields.sqlstate || "unknown"} message=${fields.message}`
      + ` detail=${fields.detail || "<none>"} context=${fields.context || "<none>"}`
      + ` exit_code=${exitCode ?? "unknown"} invocation=${invocation || "<empty>"}`,
    cause ? { cause } : undefined,
  );
  error.name = "PostgresIntegrationError";
  error.sqlstate = sqlstate || fields.sqlstate;
  error.postgresMessage = fields.message;
  error.detail = fields.detail;
  error.context = fields.context;
  error.exitCode = exitCode ?? null;
  error.stdout = String(stdout || "");
  error.stderr = String(stderr || "");
  error.invocation = invocation;
  return error;
}

function parseJsonStdout(stdout, invocation) {
  const text = String(stdout || "").trim();
  if (!text) {
    throw postgresIntegrationError({
      label: "PostgreSQL RPC returned empty stdout",
      sql: invocation,
      exitCode: 0,
      stdout,
      stderr: "",
    });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw postgresIntegrationError({
      label: "PostgreSQL RPC returned invalid JSON",
      sql: invocation,
      exitCode: 0,
      stdout: text,
      stderr: "",
      cause,
    });
  }
}

function rpcContractError({ label, invocation, sql, stdout, code, cause }) {
  const error = new Error(
    `[${label}] code=${code} invocation=${safeSqlInvocation(invocation) || "<empty>"}`
      + ` sql=${safeSqlInvocation(sql) || "<empty>"}`
      + ` stdout=${JSON.stringify(String(stdout || "").trim())}`,
    cause ? { cause } : undefined,
  );
  error.name = "PostgresIntegrationContractError";
  error.code = code;
  error.exitCode = 0;
  error.stdout = String(stdout || "");
  error.stderr = "";
  error.invocation = safeSqlInvocation(invocation);
  error.sql = safeSqlInvocation(sql);
  return error;
}

function rpcFormatError({ invocation, sql, stdout, cause }) {
  const error = new Error(
    `[PostgreSQL RPC returned invalid JSON] code=SE_RPC_RESULT_INVALID_JSON`
      + ` invocation=${safeSqlInvocation(invocation) || "<empty>"}`
      + ` sql=${safeSqlInvocation(sql) || "<empty>"}`,
    cause ? { cause } : undefined,
  );
  error.name = "PostgresIntegrationFormatError";
  error.code = "SE_RPC_RESULT_INVALID_JSON";
  error.exitCode = 0;
  error.stdout = String(stdout || "");
  error.stderr = "";
  error.invocation = safeSqlInvocation(invocation);
  error.sql = safeSqlInvocation(sql);
  return error;
}

function parseRpcJsonStdout(stdout, { invocation, sql }) {
  const text = String(stdout || "").trim();
  if (!text) {
    throw rpcContractError({
      label: "PostgreSQL RPC returned empty stdout with exit code 0",
      invocation,
      sql,
      stdout,
      code: "SE_RPC_CONTRACT_EMPTY_STDOUT",
    });
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (cause) {
    throw rpcFormatError({ invocation, sql, stdout: text, cause });
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || Object.keys(envelope).length !== 1 || !("result" in envelope)) {
    throw rpcContractError({
      label: "PostgreSQL RPC returned an invalid JSON envelope",
      invocation,
      sql,
      stdout: text,
      code: "SE_RPC_CONTRACT_INVALID_ENVELOPE",
    });
  }
  if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) {
    throw rpcContractError({
      label: "PostgreSQL RPC returned a non-object JSON result",
      invocation,
      sql,
      stdout: text,
      code: "SE_RPC_CONTRACT_INVALID_RESULT",
    });
  }
  return envelope.result;
}

export function psql(url, sql) {
  const result = spawnSync("psql", psqlArgs(url, ["-At", "-c", sql]), { encoding: "utf8" });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.error || result.status !== 0) {
    throw postgresIntegrationError({
      label: "PostgreSQL command failed",
      sql,
      exitCode: result.status,
      stdout,
      stderr: `${stderr}${result.error ? `\n${result.error.message}` : ""}`,
      cause: result.error,
    });
  }
  return stdout.trim();
}

// Explicit persistent sessions for lease-race tests. They never share a
// connection and do not fall back to one-shot calls or mocks.
export function createPersistentPsqlSession(child, label, { pollIntervalMs = 5, timeoutMs = 30_000 } = {}) {
  let sequence = 0;
  let buffer = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { buffer += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  return {
    async query(sql) {
      const marker = `__STATSEDGE_${label}_${sequence += 1}__`;
      const startMarker = `${marker}_BEGIN`;
      const endMarker = `${marker}_END`;
      const errorStart = errors.length;
      const session = { label, sequence };
      const envelope = ({ stdout = "", stderr = "", exitCode = child.exitCode, error = false, sqlstate = null }) => ({
        stdout,
        stderr,
        exitCode,
        marker,
        session,
        error,
        sqlstate,
      });
      return new Promise((resolve, reject) => {
        let settled = false;
        let interval = null;
        let timeout = null;
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          if (interval) clearInterval(interval);
          if (timeout) clearTimeout(timeout);
          callback(value);
        };
        const rejectEnvelope = (result, cause) => {
          const error = postgresIntegrationError({
            label: "Persistent PostgreSQL command failed",
            sql,
            sqlstate: result.sqlstate === "00000" ? null : result.sqlstate,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            cause,
          });
          error.envelope = result;
          settle(reject, error);
        };
        const timer = setInterval(() => {
          const startMatch = new RegExp(`${startMarker}\\r?\\n`, "u").exec(buffer);
          if (startMatch) {
            const outputStart = startMatch.index + startMatch[0].length;
            const endMatch = new RegExp(`${endMarker}\\s+(true|false)\\s+([^\\s]+)`, "u").exec(buffer.slice(outputStart));
            if (endMatch) {
              const endIndex = outputStart + endMatch.index;
              const output = buffer.slice(outputStart, endIndex).trim();
              buffer = buffer.slice(endIndex + endMatch[0].length).replace(/^\r?\n/u, "");
              const stderr = errors.slice(errorStart).trim();
              const result = envelope({
                stdout: output,
                stderr,
                error: endMatch[1] === "true" || endMatch[2] !== "00000" || Boolean(stderr),
                sqlstate: endMatch[2],
              });
              if (result.error) rejectEnvelope(result);
              else settle(resolve, result);
            }
          }
          if (child.exitCode !== null) {
            const result = envelope({ stdout: buffer, stderr: errors.slice(errorStart), error: true });
            rejectEnvelope(result);
          }
        }, pollIntervalMs);
        interval = timer;
        timeout = setTimeout(() => {
          const result = envelope({ stdout: buffer, stderr: errors.slice(errorStart), error: true });
          rejectEnvelope(result);
        }, timeoutMs);
        try {
          child.stdin.write(`\\echo ${startMarker}\n${sql};\n\\echo ${endMarker} :ERROR :SQLSTATE\n`);
        } catch (cause) {
          const result = envelope({ stdout: buffer, stderr: `${errors.slice(errorStart)}${cause?.message ? `\n${cause.message}` : ""}`.trim(), error: true });
          rejectEnvelope(result, cause);
        }
      });
    },
    close() { child.stdin.end("\\q\n"); },
  };
}

export function openPersistentPsqlSession(url, label) {
  const child = spawn("psql", ["--no-psqlrc", "--quiet", "--tuples-only", "--set", "ON_ERROR_STOP=off", "--set", "VERBOSITY=verbose", "--dbname", url], { stdio: ["pipe", "pipe", "pipe"] });
  return createPersistentPsqlSession(child, label);
}

export function rpcJsonSelectSql(name, args) {
  assert.match(name, /^[a-z][a-z0-9_]*$/u, "RPC name must be a public SQL identifier.");
  const invocation = `public.${name}(${args})`;
  // The envelope forces a single JSON-valued SELECT row for every RPC. A
  // function returning void/record/null cannot masquerade as a successful,
  // empty psql response.
  return { invocation, sql: `select jsonb_build_object('result', ${invocation})::text` };
}

export async function callRpc(session, name, args) {
  const { invocation, sql } = rpcJsonSelectSql(name, args);
  const result = await session.query(sql);
  assert.ok(result && typeof result === "object", `Persistent RPC ${invocation} returned no structured session result.`);
  assert.equal(typeof result.stdout, "string", `Persistent RPC ${invocation} returned a session result without stdout.`);
  parseRpcJsonStdout(result.stdout, { invocation, sql });
  return result;
}

function applySql(url, sql, label) {
  assert.ok(String(sql || "").trim(), `${label} SQL is empty.`);
  execFileSync("psql", psqlArgs(url, ["-f", "-"]), {
    encoding: "utf8",
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function assertEmptyDatabase(url) {
  const tableCount = psql(
    url,
    "select count(*) from information_schema.tables where table_schema = 'public'",
  );
  if (tableCount !== "0") {
    throw new Error(`SAFETY ABORT: ephemeral database is not empty (${tableCount} user tables found).`);
  }
}

function assertPostgres16(url) {
  const versionNum = Number.parseInt(psql(url, "show server_version_num"), 10);
  if (!Number.isInteger(versionNum) || versionNum < 160000 || versionNum >= 170000) {
    throw new Error(
      `SAFETY ABORT: PostgreSQL 16.x is required; received ${Number.isFinite(versionNum) ? versionNum : "an unreadable version"}.`,
    );
  }
}

function baseSchemaSql() {
  return execFileSync(
    "git",
    ["show", `${FOUNDATION_BASE_COMMIT}:supabase/schema.sql`],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export const BASELINE_SCHEMA_REPAIR_V1 = Object.freeze({
  id: "baseline-schema-repair-v1",
  original_sha256: REVIEWED_FOUNDATION_BASE_SOURCE_DIGEST,
  repaired_sha256: REPAIRED_FOUNDATION_BASE_SOURCE_DIGEST,
  original_literal: "coalesce(nullif(trim(p_owner_id)), 'personal')",
  replacement_literal: "coalesce(nullif(trim(p_owner_id), ''), 'personal')",
  reason: "The historical base schema calls nullif with one argument in the retention-owner declaration; PostgreSQL requires the explicit empty-string second argument.",
});

function exactLiteralOffsets(source, literal) {
  const offsets = [];
  for (let offset = source.indexOf(literal); offset !== -1; offset = source.indexOf(literal, offset + literal.length)) {
    offsets.push(offset);
  }
  return offsets;
}

// This is deliberately a named, byte-audited baseline repair. It is not part
// of the operational-statement sanitizer below: the historical source is
// malformed SQL, while pg_cron is a valid statement replaced only for local use.
export function repairBaselineSchemaV1(source) {
  const repair = BASELINE_SCHEMA_REPAIR_V1;
  assert.equal(sha256(source), repair.original_sha256, `${repair.id} requires the exact reviewed git-show base schema bytes.`);
  const occurrences = exactLiteralOffsets(source, repair.original_literal);
  assert.equal(occurrences.length, 1, `${repair.id} must find exactly one defective literal; found ${occurrences.length}.`);
  // The offset is derived only after hashing this exact git-show string. It is
  // audit data, never an independently maintained constant that could drift
  // with a line-ending conversion or another representation change.
  const offset = occurrences[0];

  const repaired = `${source.slice(0, offset)}${repair.replacement_literal}${source.slice(offset + repair.original_literal.length)}`;
  assert.equal(sha256(repaired), repair.repaired_sha256, `${repair.id} produced an unexpected repaired baseline digest.`);
  assert.notEqual(repaired.slice(offset, offset + repair.original_literal.length), repair.original_literal, `${repair.id} left the defective literal at the audited offset.`);
  assert.equal(repaired.slice(offset, offset + repair.replacement_literal.length), repair.replacement_literal, `${repair.id} did not place the corrected literal at the audited offset.`);
  assert.equal(
    repaired,
    `${source.slice(0, offset)}${repair.replacement_literal}${source.slice(offset + repair.original_literal.length)}`,
    `${repair.id} may differ from the historical source only at its audited replacement.`,
  );
  assert.equal(repaired.slice(0, offset), source.slice(0, offset), `${repair.id} differs before its audited replacement.`);
  assert.equal(repaired.slice(offset + repair.replacement_literal.length), source.slice(offset + repair.original_literal.length), `${repair.id} differs after its audited replacement.`);

  return {
    sql: repaired,
    audit: Object.freeze({
      ...repair,
      offset,
      original_occurrences: occurrences.length,
      consumed_occurrences: 1,
    }),
  };
}

function byteContext(sql, offset) {
  const start = Math.max(0, offset - 48);
  const end = Math.min(sql.length, offset + 48);
  return sql.slice(start, end).replaceAll("\n", "\\n");
}

function firstDifferingOffset(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

function assertEqualOutsideReplacement(sourcePart, transformedPart, sourceOffset, transformedOffset, label) {
  const difference = firstDifferingOffset(sourcePart, transformedPart);
  if (difference === -1) return;
  const sourceAt = sourceOffset + difference;
  const transformedAt = transformedOffset + difference;
  throw new Error(
    `${label} differs outside its inventoried pg_cron substitution at source offset ${sourceAt} `
    + `(transformed offset ${transformedAt}); source context="${byteContext(sourcePart, difference)}" `
    + `transformed context="${byteContext(transformedPart, difference)}".`,
  );
}

// The comparison is deliberately positional. It does not reconstruct the
// source with String#replace (which would silently replace any matching stub
// text elsewhere in a PL/pgSQL body).
export function assertOnlyInventoriedBootstrapSubstitutions(source, transformed, inventory, label = "controlled bootstrap") {
  assert.ok(Array.isArray(inventory) && inventory.length > 0, `${label} must declare at least one substitution.`);
  let sourceCursor = 0;
  let transformedCursor = 0;
  for (const entry of inventory) {
    const sourceSql = entry.source_sql;
    const replacementSql = entry.replacement_sql;
    assert.equal(typeof sourceSql, "string", `${label} inventory source SQL must be a string.`);
    assert.equal(typeof replacementSql, "string", `${label} inventory replacement SQL must be a string.`);
    assert.ok(Number.isInteger(entry.source_offset) && entry.source_offset >= sourceCursor, `${label} inventory source offset is invalid.`);
    const unchangedLength = entry.source_offset - sourceCursor;
    assertEqualOutsideReplacement(
      source.slice(sourceCursor, entry.source_offset),
      transformed.slice(transformedCursor, transformedCursor + unchangedLength),
      sourceCursor,
      transformedCursor,
      label,
    );
    assert.equal(
      source.slice(entry.source_offset, entry.source_offset + sourceSql.length),
      sourceSql,
      `${label} inventory source segment does not match the original at offset ${entry.source_offset}.`,
    );
    assert.equal(
      transformed.slice(transformedCursor + unchangedLength, transformedCursor + unchangedLength + replacementSql.length),
      replacementSql,
      `${label} replacement differs from the inventoried local cron stubs at transformed offset ${transformedCursor + unchangedLength}.`,
    );
    sourceCursor = entry.source_offset + sourceSql.length;
    transformedCursor += unchangedLength + replacementSql.length;
  }
  assertEqualOutsideReplacement(
    source.slice(sourceCursor),
    transformed.slice(transformedCursor),
    sourceCursor,
    transformedCursor,
    label,
  );
}

function exactTopLevelStatementOffset(source, expectedSql, label) {
  let statementStart = -1;
  const offsets = [];
  for (let index = 0; index < source.length;) {
    if (source.startsWith("--", index)) {
      index = source.indexOf("\n", index + 2); if (index === -1) break;
      index += 1; continue;
    }
    if (source.startsWith("/*", index)) { index = skipBlockComment(source, index); continue; }
    if (source[index] === "'") {
      const eString = index > 0 && /[eE]/u.test(source[index - 1]) && !/[A-Za-z0-9_]/u.test(source[index - 2] || "");
      index = skipQuoted(source, index, "'", eString); continue;
    }
    if (source[index] === '"') { index = skipQuoted(source, index, '"'); continue; }
    const tag = source[index] === "$" ? isDollarQuoteAt(source, index) : null;
    if (tag) {
      const bodyEnd = source.indexOf(tag, index + tag.length);
      if (bodyEnd === -1) throw new Error(`Unterminated SQL dollar quote in ${label}.`);
      index = bodyEnd + tag.length; continue;
    }
    if (statementStart === -1 && !/\s/u.test(source[index])) statementStart = index;
    if (source[index] === ";") {
      if (statementStart !== -1 && source.slice(statementStart, index + 1) === expectedSql) offsets.push(statementStart);
      statementStart = -1;
    }
    index += 1;
  }
  if (offsets.length !== 1) {
    throw new Error(`${label} must contain exactly one top-level exact pg_cron extension statement; found ${offsets.length}.`);
  }
  return offsets[0];
}

function controlledBootstrapSqlFromReviewedSource(source, expectedDigest, label) {
  const sourceHash = sha256(source);
  if (sourceHash !== expectedDigest) {
    throw new Error(`${label} is not a reviewed complete SQL source; refusing controlled transformations.`);
  }
  const sourceOffset = exactTopLevelStatementOffset(source, PG_CRON_EXTENSION_SQL, label);
  const sql = `${source.slice(0, sourceOffset)}${LOCAL_CRON_STUB_SQL}${source.slice(sourceOffset + PG_CRON_EXTENSION_SQL.length)}`;
  const inventory = [{
    ordinal: 1,
    type: "replace_extension_pg_cron_with_local_stubs",
    excluded: false,
    reason: "operational_pg_cron_extension_replaced_by_inert_local_stubs",
    source_offset: sourceOffset,
    source_sql: PG_CRON_EXTENSION_SQL,
    replacement_sql: LOCAL_CRON_STUB_SQL,
    source_hash: sha256(PG_CRON_EXTENSION_SQL),
    replacement_hash: sha256(LOCAL_CRON_STUB_SQL),
    source_sha256: sourceHash,
    source_occurrences: 1,
    consumed_occurrences: 1,
  }];
  assertOnlyInventoriedBootstrapSubstitutions(source, sql, inventory, label);
  const lexical = assertBootstrapLexicalSafety(sql, label);
  assert.ok(sql.includes("create table if not exists scans"), `${label} lost the scans table during controlled bootstrap.`);
  assert.ok(sql.includes("create table if not exists scan_results"), `${label} lost the scan_results table during controlled bootstrap.`);
  return { sql, inventory, lexical };
}

export function assertCurrentBootstrapSourceDigest() {
  const schemaPath = path.resolve(process.cwd(), "supabase/schema.sql");
  assert.ok(fs.existsSync(schemaPath), `Missing bootstrap schema: ${schemaPath}`);
  const actual = sha256(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(
    actual,
    REVIEWED_BOOTSTRAP_SOURCE_DIGEST,
    "Reviewed bootstrap digest must exactly match the current supabase/schema.sql bytes.",
  );
  return actual;
}

export function controlledBootstrapSqlForSource(source, label = "bootstrap schema.sql") {
  return controlledBootstrapSqlFromReviewedSource(source, REVIEWED_BOOTSTRAP_SOURCE_DIGEST, label);
}

export function foundationBaseFixtureStages() {
  const source = baseSchemaSql();
  const baselineRepair = repairBaselineSchemaV1(source);
  const controlled = controlledBootstrapSqlFromReviewedSource(
    baselineRepair.sql,
    REPAIRED_FOUNDATION_BASE_SOURCE_DIGEST,
    `base ${FOUNDATION_BASE_COMMIT}`,
  );
  return {
    original: source,
    after_baseline_schema_repair: baselineRepair.sql,
    after_pg_cron_substitution: controlled.sql,
    final_psql: controlled.sql,
    baseline_repair: baselineRepair.audit,
    inventory: controlled.inventory,
  };
}

function foundationBaseFixtureSql() {
  return foundationBaseFixtureStages().final_psql;
}

function bootstrapSchemaSql() {
  assertCurrentBootstrapSourceDigest();
  const schemaPath = path.resolve(process.cwd(), "supabase/schema.sql");
  return controlledBootstrapSqlForSource(fs.readFileSync(schemaPath, "utf8"), "bootstrap schema.sql").sql;
}

export function bootstrapStatementInventory() {
  assertCurrentBootstrapSourceDigest();
  const schemaPath = path.resolve(process.cwd(), "supabase/schema.sql");
  return controlledBootstrapSqlForSource(fs.readFileSync(schemaPath, "utf8"), "bootstrap schema.sql").inventory;
}

export function assertFoundationBaseFixtureSource() {
  foundationBaseFixtureSql();
}

function foundationMigrationSql() {
  const migration = path.resolve(process.cwd(), "supabase/migrations/20260717100000_scan_result_sets_foundation.sql");
  assert.ok(fs.existsSync(migration), `Missing foundation migration: ${migration}`);
  return fs.readFileSync(migration, "utf8");
}

function executionLifecycleMigrationSql() {
  const migration = path.resolve(process.cwd(), "supabase/migrations/20260717110000_scan_execution_lease_ledger.sql");
  assert.ok(fs.existsSync(migration), `Missing Hito 1B-1 migration: ${migration}`);
  return fs.readFileSync(migration, "utf8");
}

function baselineRepairMigrationSql() {
  const migration = path.resolve(process.cwd(), "supabase/migrations/20260717120000_upsert_scan_newer_wins_baseline_repair.sql");
  assert.ok(fs.existsSync(migration), `Missing append-only baseline repair migration: ${migration}`);
  return fs.readFileSync(migration, "utf8");
}

function markedFoundationProjectionSql() {
  const schema = fs.readFileSync(path.resolve(process.cwd(), "supabase/schema.sql"), "utf8");
  const start = schema.indexOf(FOUNDATION_MARKER_BEGIN);
  const end = schema.indexOf(FOUNDATION_MARKER_END);
  assert.notEqual(start, -1, `Missing ${FOUNDATION_MARKER_BEGIN} in bootstrap schema.`);
  assert.notEqual(end, -1, `Missing ${FOUNDATION_MARKER_END} in bootstrap schema.`);
  assert.equal(schema.indexOf(FOUNDATION_MARKER_BEGIN, start + FOUNDATION_MARKER_BEGIN.length), -1, "Foundation begin marker must be unique.");
  assert.equal(schema.indexOf(FOUNDATION_MARKER_END, end + FOUNDATION_MARKER_END.length), -1, "Foundation end marker must be unique.");
  assert.ok(end > start, "Foundation end marker must follow its begin marker.");
  const projection = schema.slice(start + FOUNDATION_MARKER_BEGIN.length, end).trim();
  assert.ok(projection, "Marked bootstrap foundation projection is empty.");
  return `${projection}\n`;
}

function markedExecutionProjectionSql() {
  const schema = fs.readFileSync(path.resolve(process.cwd(), "supabase/schema.sql"), "utf8");
  const start = schema.indexOf(EXECUTION_MARKER_BEGIN);
  const end = schema.indexOf(EXECUTION_MARKER_END);
  assert.notEqual(start, -1, `Missing ${EXECUTION_MARKER_BEGIN} in bootstrap schema.`);
  assert.notEqual(end, -1, `Missing ${EXECUTION_MARKER_END} in bootstrap schema.`);
  assert.ok(end > start, "Hito 1B-1 end marker must follow its begin marker.");
  return `${schema.slice(start + EXECUTION_MARKER_BEGIN.length, end).trim()}\n`;
}

export function assertMarkedFoundationProjection() {
  markedFoundationProjectionSql();
}

function assertBaseFixtureApplied(url) {
  const catalog = parseJsonStdout(psql(url, String.raw`
    select jsonb_build_object(
      'tables', coalesce((
        select jsonb_agg(c.relname order by c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      ), '[]'::jsonb),
      'extensions', coalesce((
        select jsonb_agg(e.extname order by e.extname)
        from pg_extension e
      ), '[]'::jsonb),
      'cron_schema', exists(select 1 from pg_namespace where nspname = 'cron'),
      'cron_stubs', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='cron' and p.proname='schedule')
    )::text;
  `), "base fixture catalog query");
  assert.ok(catalog.tables.includes("scan_results") && catalog.tables.includes("scans"), "Controlled base bootstrap must retain scans and scan_results.");
  assert.ok(catalog.extensions.includes("pgcrypto"), "Controlled base bootstrap must provide pgcrypto for UUID/hash defaults.");
  assert.equal(catalog.extensions.includes("pg_cron"), false, "Foundation fixture must not install pg_cron.");
  assert.equal(catalog.cron_schema, true, "Controlled bootstrap must provide a local inert cron schema.");
  assert.equal(catalog.cron_stubs, true, "Controlled bootstrap must provide local inert cron stubs.");
}

function prepareEmptyPostgres(url) {
  assertPostgres16(url);
  assertEmptyDatabase(url);
}

function applyBaseFixture(url) {
  applySql(url, foundationBaseFixtureSql(), `explicit foundation base fixture at ${FOUNDATION_BASE_COMMIT}`);
  assertBaseFixtureApplied(url);
}

const EPHEMERAL_ROLE_PROVISION_SQL = String.raw`
do $$
declare role_name text; actual record;
begin
  -- Roles live at cluster scope, not database scope. This fixed global key
  -- serializes every ephemeral database bootstrap in this cluster.
  perform pg_catalog.pg_advisory_xact_lock(1843789901, 77413021);
  foreach role_name in array array['anon','authenticated','service_role'] loop
    begin
      execute format('create role %I nologin nosuperuser inherit nobypassrls nocreaterole nocreatedb noreplication', role_name);
    exception when duplicate_object or unique_violation then
      null;
    end;
    select rolname, rolcanlogin, rolsuper, rolinherit, rolbypassrls,
           rolcreaterole, rolcreatedb, rolreplication
      into actual
      from pg_catalog.pg_roles
     where rolname = role_name;
    if not found
      or actual.rolcanlogin or actual.rolsuper or not actual.rolinherit
      or actual.rolbypassrls or actual.rolcreaterole or actual.rolcreatedb
      or actual.rolreplication then
      raise exception 'ephemeral role % is missing or has unsafe attributes', role_name;
    end if;
  end loop;
end
$$;`;

function ensureEphemeralRoles(url) {
  psql(url, EPHEMERAL_ROLE_PROVISION_SQL);
}

export async function provisionEphemeralRoles(url) {
  await new Promise((resolve, reject) => {
    const child = spawn("psql", psqlArgs(url, ["-f", "-"]), { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(); else reject(new Error(stderr || `psql exited ${code}`));
    });
    child.stdin.end(EPHEMERAL_ROLE_PROVISION_SQL);
  });
  return parseJsonStdout(psql(url, String.raw`
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', rolname, 'can_login', rolcanlogin, 'superuser', rolsuper,
      'inherit', rolinherit, 'bypass_rls', rolbypassrls,
      'create_role', rolcreaterole, 'create_db', rolcreatedb, 'replication', rolreplication
    ) order by rolname), '[]'::jsonb)::text
    from pg_catalog.pg_roles
    where rolname = any(array['anon','authenticated','service_role']);
  `), "ephemeral role catalog query");
}

export function applyFoundation(url) {
  prepareEmptyPostgres(url);
  ensureEphemeralRoles(url);
  applyBaseFixture(url);
  applySql(url, foundationMigrationSql(), "Hito 1A foundation migration");
}

export function applyBaseCatalogFixture(url) {
  prepareEmptyPostgres(url);
  ensureEphemeralRoles(url);
  applyBaseFixture(url);
}

export function applyExecutionLifecycle(url) {
  applyFoundation(url);
  applySql(url, executionLifecycleMigrationSql(), "Hito 1B-1 execution lifecycle migration");
  applySql(url, baselineRepairMigrationSql(), "Hito 0 append-only baseline repair migration");
}

export function applyBootstrapProjection(url) {
  prepareEmptyPostgres(url);
  ensureEphemeralRoles(url);
  applySql(url, bootstrapSchemaSql(), "controlled full bootstrap schema.sql");
}

const FOUNDATION_CATALOG_SQL = String.raw`
with tracked_tables(table_name) as (
  select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
), tracked_functions(function_name) as (
  select distinct p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
), required_schemas(schema_name) as (
  select 'public'
  union
  select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
)
select jsonb_build_object(
  'roles', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', rolname,
      'can_login', rolcanlogin,
      'superuser', rolsuper,
      'inherit', rolinherit,
      'bypass_rls', rolbypassrls
    ) order by rolname)
    from pg_roles
    where rolname = any(array['anon', 'authenticated', 'service_role'])
  ), '[]'::jsonb),
  'schemas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', n.nspname,
      'owner', pg_get_userbyid(n.nspowner),
      'acl', coalesce(n.nspacl::text, ''),
      'comment', obj_description(n.oid, 'pg_namespace')
    ) order by n.nspname)
    from pg_namespace n join required_schemas r on r.schema_name = n.nspname
  ), '[]'::jsonb),
  'extensions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', e.extname,
      'schema', n.nspname,
      'version', e.extversion,
      'relocatable', e.extrelocatable
    ) order by e.extname)
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
  ), '[]'::jsonb),
  'tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'rls', c.relrowsecurity,
      'force_rls', c.relforcerowsecurity,
      'acl', coalesce(c.relacl::text, ''),
      'comment', obj_description(c.oid, 'pg_class')
    ) order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join tracked_tables t on t.table_name = c.relname
    where n.nspname = 'public' and c.relkind = 'r'
  ), '[]'::jsonb),
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'name', a.attname,
      'position', a.attnum,
      'type', format_type(a.atttypid, a.atttypmod),
      'nullable', not a.attnotnull,
      'default', pg_get_expr(ad.adbin, ad.adrelid),
      'comment', col_description(c.oid, a.attnum)
    ) order by c.relname, a.attnum)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join tracked_tables t on t.table_name = c.relname
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'types', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', typ.typname,
      'kind', typ.typtype,
      'category', typ.typcategory,
      'definition', pg_catalog.format_type(typ.oid, null),
      'comment', obj_description(typ.oid, 'pg_type')
    ) order by typ.typname)
    from pg_type typ
    join pg_namespace n on n.oid = typ.typnamespace
    left join pg_class c on c.oid = typ.typrelid
    where n.nspname = 'public'
      and (c.relname is null or exists (select 1 from tracked_tables t where t.table_name = c.relname))
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', cls.relname,
      'name', con.conname,
      'type', con.contype,
      'definition', pg_get_constraintdef(con.oid, true),
      'validated', con.convalidated,
      'deferrable', con.condeferrable,
      'deferred', con.condeferred
    ) order by cls.relname, con.conname)
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = con.connamespace
    join tracked_tables t on t.table_name = cls.relname
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'name', idx.relname,
      'definition', pg_get_indexdef(idx.oid),
      'comment', obj_description(idx.oid, 'pg_class')
    ) order by c.relname, idx.relname)
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_class idx on idx.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    join tracked_tables t on t.table_name = c.relname
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'name', trg.tgname,
      'definition', pg_get_triggerdef(trg.oid, true)
    ) order by c.relname, trg.tgname)
    from pg_trigger trg
    join pg_class c on c.oid = trg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join tracked_tables t on t.table_name = c.relname
    where n.nspname = 'public' and not trg.tgisinternal
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'name', pol.polname,
      'command', pol.polcmd,
      'roles', pol.polroles,
      'using', pg_get_expr(pol.polqual, pol.polrelid),
      'with_check', pg_get_expr(pol.polwithcheck, pol.polrelid)
    ) order by c.relname, pol.polname)
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    join tracked_tables t on t.table_name = c.relname
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'sequences', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'acl', coalesce(c.relacl::text, ''),
      'comment', obj_description(c.oid, 'pg_class')
    ) order by c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'identity', p.oid::regprocedure::text,
      'name', p.proname,
      'definition', pg_get_functiondef(p.oid),
      'definition_normalized', regexp_replace(
        regexp_replace(pg_get_functiondef(p.oid), E'\\r\\n?', E'\\n', 'g'),
        E'[ \\t]+\\n', E'\\n', 'g'
      ),
      'config', coalesce(to_jsonb(p.proconfig), '[]'::jsonb),
      'acl', coalesce(p.proacl::text, ''),
      'effective_acl', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantee', coalesce(grantee.rolname, 'PUBLIC'),
          'grantor', grantor.rolname,
          'privilege', privilege.privilege_type,
          'grantable', privilege.is_grantable
        ) order by coalesce(grantee.rolname, 'PUBLIC'), privilege.privilege_type, privilege.is_grantable)
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
        left join pg_roles grantee on grantee.oid = privilege.grantee
        left join pg_roles grantor on grantor.oid = privilege.grantor
      ), '[]'::jsonb),
      'comment', obj_description(p.oid, 'pg_proc')
    ) order by p.oid::regprocedure::text)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join tracked_functions f on f.function_name = p.proname
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'grants', jsonb_build_object(
    'schemas', coalesce((
      select jsonb_agg(jsonb_build_object('name', n.nspname, 'acl', coalesce(n.nspacl::text, '')) order by n.nspname)
      from pg_namespace n join required_schemas r on r.schema_name = n.nspname
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.relname, 'acl', coalesce(c.relacl::text, '')) order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace join tracked_tables t on t.table_name = c.relname
      where n.nspname = 'public' and c.relkind = 'r'
    ), '[]'::jsonb),
    'sequences', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.relname, 'acl', coalesce(c.relacl::text, '')) order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
    ), '[]'::jsonb),
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object('identity', p.oid::regprocedure::text, 'acl', coalesce(p.proacl::text, '')) order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join tracked_functions f on f.function_name = p.proname
      where n.nspname = 'public'
    ), '[]'::jsonb)
  )
)::text;
`;

export function foundationCatalog(url) {
  return parseJsonStdout(psql(url, FOUNDATION_CATALOG_SQL), "foundation catalog query");
}

export function assertFoundationTables(catalog) {
  const hitoTables = catalog.tables.filter((table) => HITO_TABLES.includes(table.name));
  assert.deepEqual(hitoTables.map((table) => table.name), HITO_TABLES);
  assert.ok(hitoTables.every((table) => table.rls === true), "Every Hito 1A table must have RLS enabled.");
}

export function catalogObjectNames(url) {
  return parseJsonStdout(psql(url, String.raw`
    select jsonb_build_object(
      'tables', coalesce((
        select jsonb_agg(c.relname order by c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      ), '[]'::jsonb),
      'functions', coalesce((
        select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
      ), '[]'::jsonb),
      'triggers', coalesce((
        select jsonb_agg(c.relname || '.' || t.tgname order by c.relname, t.tgname)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal
      ), '[]'::jsonb),
      'policies', coalesce((
        select jsonb_agg(c.relname || '.' || pol.polname order by c.relname, pol.polname)
        from pg_policy pol join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
      ), '[]'::jsonb)
    )::text;
  `), "catalog object names query");
}
