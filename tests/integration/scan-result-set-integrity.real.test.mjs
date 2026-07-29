import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFoundation,
  assertFoundationTables,
  foundationCatalog,
  psql,
  requireEphemeralPostgresUrl,
} from "./_ephemeralPostgresHarness.mjs";

test("real PostgreSQL: Hito 1A catalog contains isolated rows, constraints, indexes, functions and comments", () => {
  const url = requireEphemeralPostgresUrl("scan-result-set-integrity");
  applyFoundation(url);
  const catalog = foundationCatalog(url);
  assertFoundationTables(catalog);

  const rowColumns = catalog.columns
    .filter((column) => column.table === "scan_result_set_rows")
    .map((column) => column.name);
  assert.deepEqual(rowColumns, [
    "result_set_id",
    "scan_id",
    "owner_id",
    "work_index",
    "identity_key",
    "payload",
    "payload_hash",
    "row_hash",
    "hash_version",
    "row_schema_version",
    "created_at",
    "updated_at",
  ]);

  const constraints = new Map(catalog.constraints.map((constraint) => [constraint.name, constraint]));
  for (const name of [
    "scan_result_set_rows_pkey",
    "scan_result_set_rows_result_set_identity_key",
    "scan_result_set_rows_result_set_fk",
    "scan_result_set_rows_work_item_fk",
    "scan_work_items_exact_row_key",
    "scans_lease_epoch_check",
    "scan_results_hito_1a_legacy_barrier_check",
    "scan_executions_lease_epoch_check",
    "scan_work_items_written_lease_epoch_check",
  ]) assert.ok(constraints.has(name), `Missing catalog constraint ${name}`);

  assert.match(
    constraints.get("scan_result_set_rows_work_item_fk").definition,
    /FOREIGN KEY \(owner_id, scan_id, result_set_id, work_index, identity_key, row_hash\)/i,
  );
  assert.match(constraints.get("scans_lease_epoch_check").definition, /lease_epoch >= 0/i);
  assert.match(constraints.get("scan_executions_lease_epoch_check").definition, /lease_epoch >= 0/i);
  assert.match(constraints.get("scan_work_items_written_lease_epoch_check").definition, /written_lease_epoch >= 0/i);

  const indexes = new Set(catalog.indexes.map((index) => index.name));
  for (const name of [
    "scans_owner_id_id_key",
    "scan_result_set_rows_pkey",
    "scan_result_set_rows_result_set_identity_key",
    "scan_work_items_result_set_outcome_idx",
    "scan_executions_result_set_id_idx",
    "scan_results_result_set_work_item_idx",
    "scans_active_execution_id_idx",
    "scans_active_result_set_id_idx",
    "scans_published_result_set_id_idx",
    "derived_snapshots_source_result_set_id_idx",
    "derived_snapshots_owner_kind_key_created_idx",
    "derived_snapshot_heads_snapshot_idx",
  ]) assert.ok(indexes.has(name), `Missing catalog index ${name}`);
  assert.equal(indexes.has("derived_snapshot_items_snapshot_idx"), false, "Do not duplicate the snapshot-items primary-key index.");

  const foundationFunctions = catalog.functions.filter((fn) => [
    "statsedge_pg_jsonb_canonical_v1",
    "statsedge_pg_jsonb_sha256_v1",
    "statsedge_derived_snapshot_source_immutable_v1",
  ].includes(fn.name));
  assert.equal(foundationFunctions.length, 3);
  for (const fn of foundationFunctions) {
    assert.ok(fn.comment, `${fn.name} must retain its COMMENT metadata.`);
    assert.ok(fn.config.some((entry) => entry.replace(/\s+/gu, "") === "search_path=pg_catalog,public"));
    assert.equal(
      fn.effective_acl.some((entry) => (
        entry.privilege === "EXECUTE"
        && ["PUBLIC", "anon", "authenticated", "service_role"].includes(entry.grantee)
      )),
      false,
      `${fn.name} must not grant EXECUTE to PUBLIC or Supabase API roles.`,
    );
  }
  const sha = foundationFunctions.find((fn) => fn.name === "statsedge_pg_jsonb_sha256_v1");
  const pgcrypto = catalog.extensions.find((extension) => extension.name === "pgcrypto");
  assert.ok(pgcrypto, "The fixture must expose the pgcrypto extension catalog entry.");
  const escapedPgcryptoSchema = pgcrypto.schema.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  assert.match(sha.definition, new RegExp(`${escapedPgcryptoSchema}\\.digest\\s*\\(`, "i"));
  assert.match(sha.definition, /pg_catalog\.convert_to\s*\(/i);

  assert.ok(
    catalog.triggers.some((trigger) => trigger.name === "derived_snapshots_source_immutable_trg"),
    "Copied derived-snapshot provenance must be protected by its immutability trigger.",
  );

  const knownHash = psql(url, "select public.statsedge_pg_jsonb_sha256_v1('{}'::jsonb)");
  assert.equal(knownHash, "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");

  psql(url, "insert into public.scans (id, owner_id, local_id, name) values ('00000000-0000-0000-0000-000000000101', 'personal', 'hito-1a-barrier', 'Hito 1A barrier')");
  assert.throws(
    () => psql(
      url,
      "insert into public.scan_results (owner_id, scan_id, symbol, integrity_class) values ('personal', '00000000-0000-0000-0000-000000000101', 'NOLEAK', 'verified')",
    ),
    /scan_results_hito_1a_legacy_barrier_check/i,
  );
});

// Hito 1B-1 ledger idempotency and conflict coverage is exercised by
// scan-execution-lifecycle.real.test.mjs; finalization remains deliberately
// unimplemented for a later milestone.
