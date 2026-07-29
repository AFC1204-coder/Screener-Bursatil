import assert from "node:assert/strict";
import test from "node:test";
import { provisionEphemeralRoles, requireEphemeralPostgresUrl } from "./_ephemeralPostgresHarness.mjs";

test("real PostgreSQL: global ephemeral API-role provisioning serializes two databases and validates exact attributes", async () => {
  const firstDatabase = requireEphemeralPostgresUrl("ephemeral-roles-a");
  const secondDatabase = requireEphemeralPostgresUrl("ephemeral-roles-b");
  const [firstRoles, secondRoles] = await Promise.all([
    provisionEphemeralRoles(firstDatabase),
    provisionEphemeralRoles(secondDatabase),
  ]);

  const expected = ["anon", "authenticated", "service_role"].map((name) => ({
    name,
    can_login: false,
    superuser: false,
    inherit: true,
    bypass_rls: false,
    create_role: false,
    create_db: false,
    replication: false,
  }));
  assert.deepEqual(firstRoles, expected);
  assert.deepEqual(secondRoles, expected);
});
