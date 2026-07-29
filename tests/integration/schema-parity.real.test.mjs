import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBaseCatalogFixture,
  applyBootstrapProjection,
  applyExecutionLifecycle,
  bootstrapStatementInventory,
  catalogObjectNames,
  foundationCatalog,
  reapplyBootstrapProjection,
  requireEphemeralPostgresUrl,
} from "./_ephemeralPostgresHarness.mjs";

function assertFunctionParity(migrationCatalog, bootstrapCatalog) {
  const migrationFunctions = new Map(
    migrationCatalog.functions.map((fn) => [fn.identity, fn]),
  );
  const bootstrapFunctions = new Map(
    bootstrapCatalog.functions.map((fn) => [fn.identity, fn]),
  );

  assert.deepEqual(
    [...bootstrapFunctions.keys()].sort(),
    [...migrationFunctions.keys()].sort(),
    "Function identity set differs between migration and bootstrap.",
  );

  for (const [identity, migrationFunction] of migrationFunctions) {
    const bootstrapFunction = bootstrapFunctions.get(identity);
    assert.equal(
      bootstrapFunction.definition_normalized,
      migrationFunction.definition_normalized,
      `Function definition differs between migration and bootstrap: ${identity}`,
    );
    assert.deepEqual(
      bootstrapFunction.effective_acl,
      migrationFunction.effective_acl,
      `Effective function ACL differs between migration and bootstrap: ${identity}`,
    );
    assert.equal(
      bootstrapFunction.comment,
      migrationFunction.comment,
      `Function comment differs between migration and bootstrap: ${identity}`,
    );
  }
}

test("real PostgreSQL: bootstrap schema and base-plus-migrations 1A/1B-1/1B-2/Hito-0 catalogs are identical", () => {
  const migrationUrl = requireEphemeralPostgresUrl("schema-parity-migrations");
  const bootstrapUrl = requireEphemeralPostgresUrl("schema-parity-bootstrap");
  const baseUrl = requireEphemeralPostgresUrl("schema-parity-base-catalog");

  applyExecutionLifecycle(migrationUrl);
  applyBootstrapProjection(bootstrapUrl);
  applyBaseCatalogFixture(baseUrl);

  const migrationCatalog = foundationCatalog(migrationUrl);
  const bootstrapCatalog = foundationCatalog(bootstrapUrl);

  assert.deepEqual(migrationCatalog.roles.map((role) => role.name), ["anon", "authenticated", "service_role"]);
  assert.deepEqual(bootstrapCatalog.roles, migrationCatalog.roles, "Both bootstrap paths must start with the identical API-role catalog.");
  assertFunctionParity(migrationCatalog, bootstrapCatalog);
  assert.deepEqual(bootstrapCatalog, migrationCatalog);

  const inventory = bootstrapStatementInventory();
  assert.deepEqual(inventory.map((entry) => entry.type), ["replace_extension_pg_cron_with_local_stubs"]);
  for (const entry of inventory) {
    assert.ok(/^[a-f0-9]{64}$/u.test(entry.source_hash), "The exact substituted construction must be SHA-256 inventoried.");
    assert.ok(/^[a-f0-9]{64}$/u.test(entry.replacement_hash), "The inert replacement must be SHA-256 inventoried.");
    assert.ok(/^[a-f0-9]{64}$/u.test(entry.source_sha256), "The complete reviewed source must be SHA-256 inventoried.");
    assert.ok(entry.reason, "Every controlled substitution must state its operational reason.");
  }

  const baseObjects = catalogObjectNames(baseUrl);
  const bootstrapObjects = catalogObjectNames(bootstrapUrl);
  assert.ok(baseObjects.functions.includes("upsert_scan_newer_wins(text,jsonb,jsonb)"), "Base catalog inventory must include upsert_scan_newer_wins.");
  for (const type of ["tables", "functions", "triggers", "policies"]) {
    for (const objectName of baseObjects[type]) {
      assert.ok(
        bootstrapObjects[type].includes(objectName),
        `Bootstrap lost base ${type.slice(0, -1)} ${objectName}; only exact allowlisted operational statements may be omitted.`,
      );
    }
  }
});

// Regresión del 29 de julio de 2026: `npm run supabase:schema` (que reaplica
// TODO supabase/schema.sql, no una migración puntual) falló en producción con
// "trigger \"derived_snapshots_source_immutable_trg\" already exists" — el
// único `create trigger` del archivo sin su `drop trigger if exists`. La suite
// efímera no lo cazó porque cada test parte de `prepareEmptyPostgres` /
// `assertEmptyDatabase`: nunca se ejercita un segundo pase sobre una base ya
// migrada, que es exactamente lo que hace un redeploy real. Este test reutiliza
// la base `schema-parity-bootstrap` ya poblada por el test anterior (mismo
// nombre de suite → misma base física; node:test corre los tests de un archivo
// en el orden en que se declaran) y la reaplica encima de sí misma.
test("real PostgreSQL: supabase/schema.sql se puede reaplicar sobre una base ya migrada sin romper ni duplicar nada", () => {
  const bootstrapUrl = requireEphemeralPostgresUrl("schema-parity-bootstrap");
  const before = foundationCatalog(bootstrapUrl);
  reapplyBootstrapProjection(bootstrapUrl);
  const after = foundationCatalog(bootstrapUrl);
  assert.deepEqual(after, before, "Reaplicar supabase/schema.sql sobre una base ya migrada no debe fallar ni cambiar el catálogo resultante.");
});
