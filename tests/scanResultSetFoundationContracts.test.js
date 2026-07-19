import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXECUTION_STATES,
  SCAN_RESULT_SET_RPC_CONTRACTS,
  SCAN_RESULT_SET_RPC_RETURN_CONTRACTS,
  INTEGRITY_CLASSES,
  PG_JSONB_SHA256_VERSION,
  RESULT_SET_STATES,
  SCAN_RESULT_ROW_SCHEMA_VERSION,
} from "@/lib/scanResultSetIntegrityContracts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hitoRpcNames = Object.freeze([
  "begin_scan_execution", "resume_scan_execution", "takeover_scan_execution",
  "register_scan_work_item", "persist_scan_result", "complete_scan_work_item",
  "checkpoint_scan_execution", "abandon_scan_execution",
]);

function functionBody(source, name) {
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  expect(start, `${name} must be declared`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("create or replace function public.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("scan result-set JavaScript contracts", () => {
  it("keeps version identifiers explicit", () => {
    expect(PG_JSONB_SHA256_VERSION).toBe("statsedge-pg-jsonb-sha256-v1");
    expect(SCAN_RESULT_ROW_SCHEMA_VERSION).toBe("statsedge-scan-result-row-v1");
  });

  it("keeps approved states explicit, including legacy_unknown", () => {
    expect(RESULT_SET_STATES).toEqual(["staging", "sealed", "abandoned", "legacy_unknown"]);
    expect(EXECUTION_STATES).toEqual([
      "running",
      "finalizing",
      "ready_to_publish",
      "published",
      "failed",
      "cancelled",
      "abandoned",
      "legacy_unknown",
    ]);
    expect(INTEGRITY_CLASSES).toEqual(["verified", "legacy_unknown"]);
  });

  it("names all eight Hito 1B-1 RPCs with the exact fencing tuple", () => {
    for (const name of hitoRpcNames) {
      expect(SCAN_RESULT_SET_RPC_CONTRACTS[name]).toEqual(expect.arrayContaining([
        "owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch",
      ]));
    }
    expect(Object.keys(SCAN_RESULT_SET_RPC_CONTRACTS).sort()).toEqual([...hitoRpcNames].sort());
    for (const futureContract of [
      "finalize_scan_execution",
      "publish_scan_result_set",
      "begin_derived_snapshot",
      "persist_derived_snapshot_items",
      "publish_derived_snapshot",
    ]) expect(SCAN_RESULT_SET_RPC_CONTRACTS).not.toHaveProperty(futureContract);
  });

  it("declares JSON object return contracts for every Hito 1B-1 writer", () => {
    expect(Object.keys(SCAN_RESULT_SET_RPC_RETURN_CONTRACTS).sort()).toEqual([...hitoRpcNames].sort());
    for (const fields of Object.values(SCAN_RESULT_SET_RPC_RETURN_CONTRACTS)) {
      expect(fields.length).toBeGreaterThan(0);
    }
    expect(SCAN_RESULT_SET_RPC_RETURN_CONTRACTS.begin_scan_execution).toEqual([
      "execution_id", "result_set_id", "lease_epoch", "lease_until", "replayed",
    ]);
  });

  it("keeps the migration and bootstrap RPC signatures JSONB with their declared payload fields", () => {
    const sources = [
      "supabase/migrations/20260717110000_scan_execution_lease_ledger.sql",
      "supabase/schema.sql",
    ].map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
    for (const source of sources) {
      for (const name of hitoRpcNames) {
        const body = functionBody(source, name);
        expect(body).toMatch(/\)\s*returns\s+jsonb\s+language\s+plpgsql/iu);
        for (const field of SCAN_RESULT_SET_RPC_RETURN_CONTRACTS[name]) {
          expect(body).toContain(`'${field}'`);
        }
      }
      const begin = functionBody(source, "begin_scan_execution");
      expect(begin).toMatch(/'replayed',\s*true/iu);
      expect(begin).toMatch(/'replayed',\s*false/iu);
      expect(begin).not.toContain("'issued_lease_epoch'");
      expect(begin).not.toContain("'issued_lease_until'");
    }
  });

  it("makes the integration helper request exactly one JSON envelope row", () => {
    const helper = fs.readFileSync(path.join(projectRoot, "tests/integration/_ephemeralPostgresHarness.mjs"), "utf8");
    expect(helper).toContain("select jsonb_build_object('result', ${invocation})::text");
    expect(helper).toContain('"SE_RPC_CONTRACT_EMPTY_STDOUT"');
    expect(helper).toContain('"SE_RPC_RESULT_INVALID_JSON"');
    expect(helper).toContain('result.status !== 0');
    expect(helper).toContain('"--no-psqlrc"');
    expect(helper).toContain('"--set", "ON_ERROR_STOP=1"');
    expect(helper).toContain('"--single-transaction"');
    expect(helper).toContain('psqlArgs(url, ["-At", "-c", sql])');
  });
});
