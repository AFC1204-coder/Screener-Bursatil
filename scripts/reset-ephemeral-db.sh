#!/usr/bin/env bash
# Recreates the 11 ephemeral PostgreSQL databases used by
# tests/integration/_ephemeralPostgresHarness.mjs, empty and ready for a run.
#
# The harness itself never provisions or cleans up databases (by design —
# see EPHEMERAL_DATABASE_INVENTORY in _ephemeralPostgresHarness.mjs) and
# aborts with SAFETY ABORT if a target database is not empty. Since the
# harness never drops its own databases, a second consecutive run always
# fails unless the databases are recreated first. This script does that.
set -euo pipefail

# Kept in sync by hand with EPHEMERAL_DATABASE_INVENTORY in
# tests/integration/_ephemeralPostgresHarness.mjs. There is no script-level
# way to import that list from the .mjs module without invoking Node, so it
# is duplicated here; the harness's own inventory-shape test
# (tests/integration/bootstrap-control.contract.test.mjs) is what catches
# drift between the two if the inventory ever changes.
EPHEMERAL_DATABASES=(
  "statsedge_ephemeral_derived_snapshot_publication"
  "statsedge_ephemeral_ephemeral_roles_a"
  "statsedge_ephemeral_ephemeral_roles_b"
  "statsedge_ephemeral_scan_execution_lifecycle"
  "statsedge_ephemeral_scan_result_set_concurrency"
  "statsedge_ephemeral_scan_result_set_finalization_publication"
  "statsedge_ephemeral_scan_result_set_integrity"
  "statsedge_ephemeral_scan_result_set_published_read"
  "statsedge_ephemeral_schema_parity_migrations"
  "statsedge_ephemeral_schema_parity_bootstrap"
  "statsedge_ephemeral_schema_parity_base_catalog"
)

REQUIRED_PREFIX="statsedge_ephemeral_"

if ! pg_isready >/dev/null 2>&1; then
  echo "ERROR: PostgreSQL is not accepting connections (pg_isready failed)." >&2
  echo "Start PostgreSQL 16.x locally before running this script." >&2
  exit 1
fi

for db in "${EPHEMERAL_DATABASES[@]}"; do
  case "$db" in
    "${REQUIRED_PREFIX}"*) ;;
    *)
      echo "ABORT: refusing to touch database '$db' — it does not start with '${REQUIRED_PREFIX}'." >&2
      exit 1
      ;;
  esac
done

for db in "${EPHEMERAL_DATABASES[@]}"; do
  echo "Resetting ${db}..."
  dropdb --if-exists "$db"
  createdb "$db"
done

echo "Done. ${#EPHEMERAL_DATABASES[@]} ephemeral databases recreated empty."
