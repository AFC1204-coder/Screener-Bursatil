import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFoundation,
  foundationCatalog,
  requireEphemeralPostgresUrl,
} from "./_ephemeralPostgresHarness.mjs";

test("real PostgreSQL: snapshot source provenance and head membership are encoded in catalog FKs", () => {
  const url = requireEphemeralPostgresUrl("derived-snapshot-publication");
  applyFoundation(url);
  const catalog = foundationCatalog(url);
  const constraints = new Map(catalog.constraints.map((constraint) => [constraint.name, constraint]));
  const source = constraints.get("derived_snapshots_source_result_set_fk");
  const head = constraints.get("derived_snapshot_heads_snapshot_fk");

  assert.ok(source, "Missing derived snapshot source FK.");
  assert.match(
    source.definition,
    /FOREIGN KEY \(owner_id, source_scan_id, source_execution_id, source_result_set_id, source_set_hash, source_hash_version\).*scan_result_sets\(owner_id, scan_id, execution_id, id, set_hash, hash_version\)/i,
  );
  assert.match(source.definition, /ON DELETE SET NULL \(source_result_set_id\)/i);
  assert.ok(head, "Missing derived snapshot head FK.");
  assert.match(
    head.definition,
    /FOREIGN KEY \(owner_id, snapshot_kind, snapshot_key, snapshot_id\).*derived_snapshots\(owner_id, snapshot_kind, snapshot_key, id\)/i,
  );

  const sourceColumns = new Set(
    catalog.columns
      .filter((column) => column.table === "derived_snapshots")
      .map((column) => column.name),
  );
  for (const name of [
    "source_result_set_id",
    "source_kind",
    "source_scan_id",
    "source_execution_id",
    "source_set_hash",
    "source_hash_version",
  ]) assert.ok(sourceColumns.has(name), `Missing copied source provenance ${name}`);
  assert.match(
    constraints.get("derived_snapshots_source_contract_check").definition,
    /source_kind/i,
  );
});

// Hito 1B: in one transaction seal the snapshot and move its head; inject a
// failure after sealing and assert rollback leaves both snapshot and old head
// unchanged. A concurrent reader must observe either the old sealed snapshot
// or the new sealed snapshot, never staging or a half-published pair.
test.todo("Hito 1C: atomic snapshot publication, rollback and staging invisibility");
