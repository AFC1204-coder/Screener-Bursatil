import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import test from "node:test";
import {
  BASELINE_SCHEMA_REPAIR_V1,
  assertBootstrapLexicalSafety,
  assertCurrentBootstrapSourceDigest,
  assertOnlyInventoriedBootstrapSubstitutions,
  bootstrapLexicalSafetyInventory,
  createPersistentPsqlSession,
  controlledBootstrapSqlForSource,
  EPHEMERAL_DATABASE_INVENTORY,
  foundationBaseFixtureStages,
  repairBaselineSchemaV1,
} from "./_ephemeralPostgresHarness.mjs";

const schemaPath = new URL("../../supabase/schema.sql", import.meta.url);
const upsertSignature = "create or replace function public.upsert_scan_newer_wins(";

function simulatedPersistentPsqlChild(outputs) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  stdout.setEncoding = () => {};
  stderr.setEncoding = () => {};
  let writes = 0;
  return {
    exitCode: null,
    stdout,
    stderr,
    stdin: {
      write(command) {
        const startMarker = /\\echo\s+([^\s]+_BEGIN)/u.exec(command)?.[1];
        const endMarker = startMarker?.replace(/_BEGIN$/u, "_END");
        const output = outputs[writes];
        writes += 1;
        queueMicrotask(() => stdout.emit("data", `${startMarker}\n${output}\n${endMarker} false 00000\n`));
        return true;
      },
      end() {},
    },
  };
}

test("pure persistent-session stream preserves a non-empty envelope across consecutive queries", async () => {
  const session = createPersistentPsqlSession(
    simulatedPersistentPsqlChild(["BEGIN", "second-result"]),
    "unit",
    { pollIntervalMs: 1, timeoutMs: 50 },
  );
  const begin = await session.query("begin");
  const select = await session.query("select 'second-result'");
  assert.deepEqual(begin, {
    stdout: "BEGIN",
    stderr: "",
    exitCode: null,
    marker: "__STATSEDGE_unit_1__",
    session: { label: "unit", sequence: 1 },
    error: false,
    sqlstate: "00000",
  });
  assert.deepEqual(select, {
    stdout: "second-result",
    stderr: "",
    exitCode: null,
    marker: "__STATSEDGE_unit_2__",
    session: { label: "unit", sequence: 2 },
    error: false,
    sqlstate: "00000",
  });
});

test("takeover matrix requires synchronized expired leases, rejects live or divergent leases, and advances one epoch", () => {
  const schema = fs.readFileSync(schemaPath, "utf8");
  const migration = fs.readFileSync(new URL("../../supabase/migrations/20260717110000_scan_execution_lease_ledger.sql", import.meta.url), "utf8");
  const fixtures = [
    new URL("./scan-execution-lifecycle.real.test.mjs", import.meta.url),
    new URL("./scan-result-set-concurrency.real.test.mjs", import.meta.url),
  ].map((path) => fs.readFileSync(path, "utf8"));
  const synchronizedExpiredLease = /with expired as \(select clock_timestamp\(\) - interval '1 second' as lease_until\),\s*scan as \(\s*update public\.scans s set lease_until = expired\.lease_until\s*from expired[\s\S]*?returning expired\.lease_until\s*\)\s*update public\.scan_executions e set lease_until = scan\.lease_until\s*from scan/iu;
  const takeoverGuards = [schema, migration];

  for (const source of takeoverGuards) {
    const takeover = /create or replace function public\.takeover_scan_execution\([\s\S]*?\n\$\$;/iu.exec(source)?.[0];
    assert.ok(takeover, "takeover_scan_execution must be present for semantic epoch checks.");
    assert.match(source, /p_lease_epoch is distinct from v_scan\.lease_epoch[\s\S]*?p_lease_epoch is distinct from v_execution\.lease_epoch[\s\S]*?SE_LEASE_CONFLICT/iu, "Epoch divergence must fail closed.");
    const increment = /\b([a-z_][a-z0-9_]*)\s*:=\s*v_scan\.lease_epoch\s*\+\s*1\s*;/iu.exec(takeover);
    assert.ok(increment, "Takeover must derive its new epoch from the validated scan epoch plus one.");
    const nextEpoch = increment[1];
    assert.match(takeover, new RegExp(`update public\\.scans set lease_epoch = ${nextEpoch}[\\s\\S]*?lease_epoch is not distinct from p_lease_epoch`, "iu"), "Takeover must persist the derived epoch to scan under the validated epoch fence.");
    assert.match(takeover, new RegExp(`update public\\.scan_executions set lease_epoch = ${nextEpoch}[\\s\\S]*?lease_epoch is not distinct from p_lease_epoch`, "iu"), "Takeover must persist the same derived epoch to execution under the validated epoch fence.");
    assert.match(takeover, new RegExp(`'lease_epoch', ${nextEpoch}`, "iu"), "Takeover must report the same persisted epoch.");
    assert.match(source, /v_scan\.lease_until is null[\s\S]*?v_scan\.lease_until is distinct from v_execution\.lease_until[\s\S]*?SE_LEASE_CONFLICT/iu, "Lease divergence must fail closed.");
    assert.match(source, /if v_scan\.lease_until > clock_timestamp\(\) then raise exception using errcode = 'P0001', message = 'SE_LEASE_CONFLICT'; end if;/iu, "A live lease must remain non-takeoverable.");
  }
  for (const fixture of fixtures) assert.match(fixture, synchronizedExpiredLease, "Expired takeover fixtures must assign one identical timestamp to scan and execution.");
});

function upsertFunctionDefinition(source, label) {
  const start = source.indexOf(upsertSignature);
  assert.notEqual(start, -1, `${label} is missing ${upsertSignature}`);
  assert.equal(source.indexOf(upsertSignature, start + upsertSignature.length), -1, `${label} must contain exactly one upsert_scan_newer_wins definition.`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${label} upsert_scan_newer_wins definition is missing its dollar-quoted terminator.`);
  return source.slice(start, end + "\n$$;".length);
}

function assertByteEquivalentFunction(expected, actual, expectedLabel, actualLabel) {
  if (expected === actual) return;
  let offset = 0;
  while (offset < expected.length && offset < actual.length && expected[offset] === actual[offset]) offset += 1;
  const context = (value) => value.slice(Math.max(0, offset - 80), Math.min(value.length, offset + 80)).replaceAll("\n", "\\n");
  assert.fail(
    `${actualLabel} diverges from ${expectedLabel} at byte ${offset}; `
    + `${expectedLabel}="${context(expected)}" ${actualLabel}="${context(actual)}"`,
  );
}

test("declared bootstrap digest is the exact SHA-256 of the current schema bytes", () => {
  const source = fs.readFileSync(schemaPath, "utf8");
  assert.equal(assertCurrentBootstrapSourceDigest(), createHash("sha256").update(source).digest("hex"));
});

test("ephemeral harness inventory declares exactly ten isolated databases", () => {
  assert.equal(EPHEMERAL_DATABASE_INVENTORY.length, 10);
  assert.equal(new Set(EPHEMERAL_DATABASE_INVENTORY).size, 10);
});

test("controlled bootstrap preserves the current complete SQL bytes except its single inventoried pg_cron replacement", () => {
  const source = fs.readFileSync(schemaPath, "utf8");
  const controlled = controlledBootstrapSqlForSource(source, "current complete bootstrap source");
  assert.equal(controlled.inventory.length, 1);
  assert.match(controlled.sql, /create schema if not exists cron;/i);
  assert.match(controlled.sql, /create or replace function cron\.schedule/i);
  assert.equal(controlled.sql.includes("create extension if not exists pg_cron;"), false);
  assert.equal(controlled.sql.includes("perform cron.unschedule('statsedge-backstop-purge-weekly');"), true);
});

test("baseline-schema-repair-v1 repairs the one malformed historical literal before controlled bootstrap", () => {
  const stages = foundationBaseFixtureStages();
  const repair = BASELINE_SCHEMA_REPAIR_V1;
  assert.equal(createHash("sha256").update(stages.original).digest("hex"), repair.original_sha256);
  assert.equal(createHash("sha256").update(stages.after_baseline_schema_repair).digest("hex"), repair.repaired_sha256);
  const offset = stages.original.indexOf(repair.original_literal);
  assert.notEqual(offset, -1, "Historical git-show schema must contain the defect.");
  assert.equal(stages.original.indexOf(repair.original_literal, offset + repair.original_literal.length), -1, "Historical git-show schema must contain the defect exactly once.");
  assert.equal(stages.baseline_repair.offset, offset);
  assert.equal(stages.after_baseline_schema_repair.slice(offset, offset + repair.replacement_literal.length), repair.replacement_literal);
  assert.equal(stages.after_baseline_schema_repair.slice(0, offset), stages.original.slice(0, offset));
  assert.equal(
    stages.after_baseline_schema_repair.slice(offset + repair.replacement_literal.length),
    stages.original.slice(offset + repair.original_literal.length),
    "Baseline repair may differ only in its one audited replacement.",
  );
});

test("Hito 1B-1 lifecycle and concurrency fixtures never write verified or lineage data to scan_results", () => {
  const fixtures = [
    new URL("./scan-execution-lifecycle.real.test.mjs", import.meta.url),
    new URL("./scan-result-set-concurrency.real.test.mjs", import.meta.url),
    new URL("./_ephemeralPostgresHarness.mjs", import.meta.url),
  ];
  const scanResultsWrite = /\b(?:insert|upsert|merge)\s+into\s+(?:public\.)?scan_results\b/iu;
  for (const fixture of fixtures) {
    const source = fs.readFileSync(fixture, "utf8");
    assert.doesNotMatch(
      source,
      scanResultsWrite,
      `${fixture.pathname} must stage Hito 1B-1 data in scan_result_set_rows and may not write verified or lineage fields to scan_results.`,
    );
  }
});

test("legacy scan writer stays behind the Hito 1A scan_results barrier", () => {
  const hitoZeroMigration = fs.readFileSync(new URL("../../supabase/migrations/20260717120000_upsert_scan_newer_wins_baseline_repair.sql", import.meta.url), "utf8");
  const hitoOneFoundation = fs.readFileSync(new URL("../../supabase/migrations/20260717100000_scan_result_sets_foundation.sql", import.meta.url), "utf8");
  const legacyWriter = upsertFunctionDefinition(hitoZeroMigration, "Hito 0 legacy upsert");
  assert.doesNotMatch(legacyWriter, /\b(?:integrity_class|result_set_id|work_index|identity_key|payload_hash|row_hash)\b/iu);
  assert.match(hitoOneFoundation, /alter table public\.scan_results add column if not exists integrity_class text default 'legacy_unknown';/i);
  assert.match(
    hitoOneFoundation,
    /integrity_class = 'legacy_unknown'[\s\S]*result_set_id is null[\s\S]*work_index is null[\s\S]*identity_key is null[\s\S]*payload_hash is null[\s\S]*row_hash is null/i,
  );
});

test("baseline-schema-repair-v1 rejects line-ending-normalized bytes before locating or repairing the literal", () => {
  const stages = foundationBaseFixtureStages();
  const crlf = stages.original.replaceAll("\n", "\r\n");
  const lf = crlf.replaceAll("\r\n", "\n");
  assert.equal(lf, stages.original, "The normalization fixture must prove the original bytes are LF.");
  assert.notEqual(createHash("sha256").update(crlf).digest("hex"), BASELINE_SCHEMA_REPAIR_V1.original_sha256);
  assert.throws(
    () => repairBaselineSchemaV1(crlf),
    /exact reviewed git-show base schema bytes/,
    "The repair must reject transformed bytes before deriving an occurrence offset.",
  );
});

test("baseline repair range checks permit other legitimate corrected literals", () => {
  const defective = BASELINE_SCHEMA_REPAIR_V1.original_literal;
  const corrected = BASELINE_SCHEMA_REPAIR_V1.replacement_literal;
  const original = `before ${corrected} middle ${defective} after ${corrected}`;
  const offset = original.indexOf(defective);
  const repaired = `${original.slice(0, offset)}${corrected}${original.slice(offset + defective.length)}`;
  assert.equal(original.split(defective).length - 1, 1);
  assert.equal(repaired.slice(offset, offset + defective.length), corrected.slice(0, defective.length));
  assert.equal(repaired.slice(offset, offset + corrected.length), corrected);
  assert.equal(repaired.slice(0, offset), original.slice(0, offset));
  assert.equal(repaired.slice(offset + corrected.length), original.slice(offset + defective.length));
  assert.equal(repaired.split(corrected).length - 1, 3, "Other corrected literals must remain legal outside the repaired range.");
});

test("base fixture applies the registered baseline repair before the one top-level pg_cron replacement", () => {
  const stages = foundationBaseFixtureStages();
  assert.equal(stages.inventory.length, 1);
  assertOnlyInventoriedBootstrapSubstitutions(
    stages.after_baseline_schema_repair,
    stages.after_pg_cron_substitution,
    stages.inventory,
    "base fixture static byte comparison",
  );
  assert.equal(stages.final_psql, stages.after_pg_cron_substitution, "psql must receive the sole transformed intermediate unchanged.");
  assert.ok(stages.baseline_repair, "No harness route may apply the base fixture without its registered baseline repair.");
  assert.equal(stages.final_psql.includes(BASELINE_SCHEMA_REPAIR_V1.original_literal), false);
  assert.equal(stages.final_psql.includes(BASELINE_SCHEMA_REPAIR_V1.replacement_literal), true);

  const changedOutsideTheInventory = `X${stages.final_psql.slice(1)}`;
  assert.throws(
    () => assertOnlyInventoriedBootstrapSubstitutions(
      stages.original,
      changedOutsideTheInventory,
      stages.inventory,
      "adversarial base fixture byte comparison",
    ),
    /source offset 0.*context=/,
  );
});

test("append-only repair migration carries the complete corrected function and bootstrap schema is corrected", () => {
  const migrationPath = new URL("../../supabase/migrations/20260717120000_upsert_scan_newer_wins_baseline_repair.sql", import.meta.url);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const correctExpression = "v_owner text := coalesce(nullif(trim(p_owner_id), ''), 'personal');";
  const defectiveExpression = "v_owner text := coalesce(nullif(trim(p_owner_id)), 'personal');";
  assert.match(migration, /create or replace function public\.upsert_scan_newer_wins\(\s*p_owner_id text,\s*p_scan jsonb,\s*p_results jsonb\s*\)/i);
  assert.match(migration, /returns setof public\.scans\s+language plpgsql\s+security invoker\s+set search_path = public\s+as \$\$/i);
  assert.match(migration, /with incoming as \(/i);
  assert.match(migration, /insert into public\.scan_results \(/i);
  assert.match(migration, /if v_accepted then\s+declare\s+v_owner text :=/i);
  assert.match(migration, /return query\s+select \*\s+from public\.scans\s+where id = v_scan_id;\s+end;\s+\$\$;/i);
  assert.match(migration, new RegExp(correctExpression.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.equal(migration.includes(defectiveExpression), false);
  assert.equal(schema.includes(correctExpression), true);
  assert.equal(schema.includes(defectiveExpression), false);
});

test("baseline-repaired, Hito 0 migration, and current bootstrap carry byte-identical upsert_scan_newer_wins definitions", () => {
  const stages = foundationBaseFixtureStages();
  const migrationPath = new URL("../../supabase/migrations/20260717120000_upsert_scan_newer_wins_baseline_repair.sql", import.meta.url);
  const baselineDefinition = upsertFunctionDefinition(stages.after_baseline_schema_repair, "baseline repaired schema");
  const migrationDefinition = upsertFunctionDefinition(fs.readFileSync(migrationPath, "utf8"), "Hito 0 migration");
  const bootstrapDefinition = upsertFunctionDefinition(fs.readFileSync(schemaPath, "utf8"), "current bootstrap schema");
  assertByteEquivalentFunction(baselineDefinition, migrationDefinition, "baseline repaired schema", "Hito 0 migration");
  assertByteEquivalentFunction(baselineDefinition, bootstrapDefinition, "baseline repaired schema", "current bootstrap schema");
});

test("lexical bootstrap inventory classifies comments, strings, E strings, quoted identifiers and non-executable dollar quotes as innocent", () => {
  const innocent = `/* outer /* cron.schedule('not executable') */ */
-- net.http_post and http_get are comments
select E'cron.unschedule(\\'not executable\\')';
select 'net.http_get';
select $$ cron.schedule('not executable'); $$;
select "cron.schedule" from (values (1)) as x("cron.schedule");`;
  const lexical = bootstrapLexicalSafetyInventory(innocent);
  assert.deepEqual(lexical.references, []);
  assert.ok(lexical.ignored.comments >= 2);
  assert.equal(lexical.ignored.e_strings, 1);
  assert.equal(lexical.ignored.quoted_identifiers, 2);
  assert.equal(lexical.ignored.dollar_quotes, 1);
  assert.doesNotThrow(() => assertBootstrapLexicalSafety(innocent));
});

test("lexical bootstrap inventory inspects executable DO and PL/pgSQL bodies and rejects uncovered net/HTTP calls", () => {
  const permittedDo = "do $$ begin perform cron.unschedule('inert-stub'); end $$;";
  assert.deepEqual(bootstrapLexicalSafetyInventory(permittedDo).references, [{ reference: "cron.unschedule", context: "plpgsql" }]);
  assert.doesNotThrow(() => assertBootstrapLexicalSafety(permittedDo));
  assert.throws(
    () => assertBootstrapLexicalSafety("do $$ begin perform net.http_post(url := 'https://example.test'); end $$;"),
    /net\.http_post/,
  );
  assert.throws(
    () => assertBootstrapLexicalSafety("create function public.bad() returns void language plpgsql as $body$ begin perform http_get('https://example.test'); end $body$;"),
    /http_get/,
  );
});

test("controlled bootstrap rejects an adversarial fixture by digest before any transformation", () => {
  const source = fs.readFileSync(schemaPath, "utf8");
  const adversarial = `${source}\n/* harmless comment with cron */`;
  assert.notEqual(createHash("sha256").update(adversarial).digest("hex"), createHash("sha256").update(source).digest("hex"));
  assert.throws(() => controlledBootstrapSqlForSource(adversarial, "adversarial bootstrap fixture"), /not a reviewed complete SQL source/);
});
