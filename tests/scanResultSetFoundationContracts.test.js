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
  "checkpoint_scan_execution", "abandon_scan_execution", "finalize_scan_execution",
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

  it("names all Hito 1B writers with the exact fencing tuple", () => {
    for (const name of hitoRpcNames) {
      expect(SCAN_RESULT_SET_RPC_CONTRACTS[name]).toEqual(expect.arrayContaining([
        "owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch",
      ]));
    }
    expect(Object.keys(SCAN_RESULT_SET_RPC_CONTRACTS).sort()).toEqual([...hitoRpcNames].sort());
    for (const futureContract of [
      "publish_scan_result_set",
      "begin_derived_snapshot",
      "persist_derived_snapshot_items",
      "publish_derived_snapshot",
    ]) expect(SCAN_RESULT_SET_RPC_CONTRACTS).not.toHaveProperty(futureContract);
  });

  it("declares JSON object return contracts for every Hito 1B writer", () => {
    expect(Object.keys(SCAN_RESULT_SET_RPC_RETURN_CONTRACTS).sort()).toEqual([...hitoRpcNames].sort());
    for (const fields of Object.values(SCAN_RESULT_SET_RPC_RETURN_CONTRACTS)) {
      expect(fields.length).toBeGreaterThan(0);
    }
    expect(SCAN_RESULT_SET_RPC_RETURN_CONTRACTS.begin_scan_execution).toEqual([
      "execution_id", "result_set_id", "lease_epoch", "lease_until", "replayed",
    ]);
    expect(SCAN_RESULT_SET_RPC_RETURN_CONTRACTS.finalize_scan_execution).toEqual([
      "owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch", "state", "set_hash", "expected_count", "ledger_count", "persisted_count", "failed_count", "cancelled_count", "row_count", "replayed",
    ]);
  });

  it("keeps migration RPC signatures JSONB with their declared payload fields", () => {
    const lifecycleSource = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20260717110000_scan_execution_lease_ledger.sql"), "utf8");
    const finalizationSource = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20260719100000_scan_result_set_finalize_publish.sql"), "utf8");
    for (const [source, names] of [[lifecycleSource, hitoRpcNames.filter((name) => name !== "finalize_scan_execution")], [finalizationSource, ["finalize_scan_execution"]]]) {
      for (const name of names) {
        const body = functionBody(source, name);
        expect(body).toMatch(/\)\s*returns\s+jsonb\s+language\s+plpgsql/iu);
        for (const field of SCAN_RESULT_SET_RPC_RETURN_CONTRACTS[name]) {
          expect(body).toContain(`'${field}'`);
        }
      }
      if (!names.includes("begin_scan_execution")) continue;
      const begin = functionBody(source, "begin_scan_execution");
      expect(begin).toMatch(/'replayed',\s*true/iu);
      expect(begin).toMatch(/'replayed',\s*false/iu);
      expect(begin).not.toContain("'issued_lease_epoch'");
      expect(begin).not.toContain("'issued_lease_until'");
    }
    const finalize = functionBody(finalizationSource, "finalize_scan_execution");
    expect(finalize).toContain("SE_LEDGER_ROW_MISMATCH");
    expect(finalize).toContain("SE_HASH_MISMATCH");
    expect(finalize).toContain("public.statsedge_finalization_manifest_v1(");
    expect(finalize).toContain("public.statsedge_finalization_set_hash_v1(v_manifest)");
    expect(finalize).toContain("jsonb_typeof(v_receipt) is distinct from 'object'");
    expect(finalize).toContain("v_receipt -> 'owner_id' is distinct from to_jsonb(p_owner_id)");
    expect(finalize).toContain("v_receipt -> 'scan_id' is distinct from to_jsonb(p_scan_id)");
    expect(finalize).not.toContain("v_receipt ->> 'owner_id'");
    expect(finalize).toContain("v_receipt -> 'ledger_count' is distinct from to_jsonb(v_set.ledger_count)");
    expect(finalize).toContain("v_receipt -> 'replayed' is distinct from 'false'::jsonb");
    expect(finalize).toContain("v_receipt ?& array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[]");
    expect(finalize).toContain("jsonb_object_keys(case when jsonb_typeof(v_receipt) = 'object' then v_receipt else '{}'::jsonb end) as receipt_key(key)");
    expect(finalize).toContain("receipt_key.key <> all (array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[])");
    expect(finalize).toContain("v_set.expected_count is distinct from v_set.ledger_count");
    expect(finalize).toContain("v_execution.persisted_count is distinct from v_set.row_count");
    expect(finalize).toContain("v_execution.completed_count is distinct from v_set.ledger_count - v_execution.persisted_count");
    expect(finalize).toContain("v_execution.cancelled_count > 0 and v_receipt -> 'state' is distinct from '\"cancelled\"'::jsonb");
    expect(finalize).toContain("active_execution.id = v_scan.active_execution_id");
    expect(finalize).toContain("active_set.id = v_scan.active_result_set_id");
    expect(finalize).toContain("active_execution.state is not distinct from 'running'");
    expect(finalize).toContain("active_set.integrity_class is not distinct from 'verified'");
    expect(finalize).toContain("active_execution.policy_version is not distinct from 'statsedge-scan-execution-v1'");
    expect(finalize).toContain("active_execution.hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'");
    expect(finalize).toContain("active_set.hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'");
    expect(finalize).toContain("active_execution.issued_lease_epoch is not null and active_execution.issued_lease_until is not null");
    expect(finalize).toContain("active_execution.issued_lease_epoch >= 0 and active_execution.issued_lease_epoch <= active_execution.lease_epoch");
    expect(finalize).toContain("w.written_lease_epoch is null");
    expect(finalize).toContain("w.written_lease_epoch < v_execution.issued_lease_epoch");
    expect(finalize).toContain("w.written_lease_epoch > v_execution.lease_epoch");
    expect(finalize).toContain("v_execution.finalizing_at is null or v_execution.finished_at is null");
    expect(finalize).toContain("v_execution.finalizing_at is distinct from v_execution.finished_at");
    expect(finalize).toContain("v_scan.published_result_set_id is not distinct from p_result_set_id");
    expect(finalize).toContain("if v_scan.published_result_set_id is not null and v_scan.published_result_set_id is distinct from p_result_set_id then");
    expect(finalize).toContain("v_execution.state in ('failed', 'cancelled') and v_scan.published_result_set_id is not null");
    expect(finalize).toContain("v_scan.published_result_set_id is not distinct from p_result_set_id");
    expect(finalize).toContain("pointer_execution.lease_epoch is not null");
    expect(finalize).toContain("pointer_execution.lease_epoch is distinct from v_execution.lease_epoch");
    expect(finalize).toContain("pointer_execution.lease_epoch > v_execution.lease_epoch");
    expect(finalize).toContain("v_scan.lease_epoch < v_execution.lease_epoch");
    expect(finalize).toContain("v_scan.lease_epoch >= pointer_execution.lease_epoch");
    expect(finalize).not.toContain("pointer_execution.finished_at > v_execution.finished_at");
    expect(finalize).toContain("active_execution.lease_epoch is not distinct from v_scan.lease_epoch");
    expect(finalize).toContain("active_set.state is not distinct from 'staging'");
    expect(finalize).toContain("public.statsedge_assert_terminal_replay_evidence_v1(p_owner_id, p_scan_id, p_result_set_id)");
    expect(finalize).toContain("v_set.set_hash is distinct from v_hash");
    expect(finalize).toContain("v_set.ledger_count is distinct from v_ledger");
    expect(finalize).toMatch(/statsedge_finalization_set_hash_v1\(v_manifest\);[\s\S]*?if v_execution\.state in \('published', 'failed', 'cancelled'\)/iu);
    expect(finalize).toContain("jsonb_typeof(v_execution.checkpoint) is distinct from 'object'");
    expect(finalize).toMatch(/v_now\s*:=\s*clock_timestamp\(\);[\s\S]*?v_scan\.lease_until\s*<=\s*v_now/iu);
    expect(finalize).not.toContain("statsedge-finalize-manifest-v1");
    const manifest = functionBody(finalizationSource, "statsedge_finalization_manifest_v1");
    expect(manifest).toContain("statsedge-finalize-manifest-v1");
    expect(manifest).toMatch(/returns\s+jsonb\s+language\s+sql\s+immutable\s+strict\s+security\s+invoker/iu);
    const terminalExecution = functionBody(finalizationSource, "statsedge_terminal_execution_immutable_v1");
    expect(terminalExecution).toContain("old.state in ('published', 'failed', 'cancelled', 'abandoned')");
    expect(terminalExecution).toContain("SE_EXECUTION_IMMUTABLE");
    for (const source of [finalizationSource, fs.readFileSync(path.join(projectRoot, "supabase/schema.sql"), "utf8")]) {
      expect(source).toMatch(/\(v_execution\.checkpoint\s*->>\s*'finalization_state'\)\s+is\s+null[\s\S]*?\(v_execution\.checkpoint\s*->>\s*'finalization_state'\)\s+not\s+in\s*\('complete',\s*'partial'\)/iu);
    }
    expect(finalize).not.toContain("publish_scan_result_set");
    const finalizationMatrix = fs.readFileSync(path.join(projectRoot, "tests/integration/scan-result-set-finalization-publication.real.test.mjs"), "utf8");
    expect(finalizationMatrix).toContain('ownerId: "42"');
    expect(finalizationMatrix).toContain("receiptPatch: { owner_id: 42 }");
    expect(finalizationMatrix).toContain('residualActive: "execution"');
    expect(finalizationMatrix).toContain('residualActive: "result_set"');
    expect(finalizationMatrix).toContain("publishedPointer: false");
    expect(finalizationMatrix).toContain("omitFinalizingAt: true");
    expect(finalizationMatrix).toContain("successorActiveBefore");
    expect(finalizationMatrix).toContain("omitSetTimestamp: true");
    expect(finalizationMatrix).toContain("corruptSuccessor");
    expect(finalizationMatrix).toContain("assertActiveSuccessorReplayFenced");
    expect(finalizationMatrix).toContain("corruptLegacyUnknownTerminalFixture");
    expect(finalizationMatrix).toContain("scanLeaseEpoch: completeLease.lease_epoch");
    expect(finalizationMatrix).toContain("assertLiveWrittenLeaseEpochFence");
    expect(finalizationMatrix).toContain("createLegacyUnknownActiveSuccessor");
    expect(finalizationMatrix).toContain("corruptSuccessorEpoch.durableLeaseEpoch");
    expect(finalizationMatrix).toContain("finalize(session, id, receipt.lease_epoch)");
    expect(finalizationMatrix).toContain("replacementReceipt");
    expect(finalizationMatrix).toContain("cancelledReplacementReceipt");
    expect(finalizationMatrix).toContain("sameEpochFailed");
    expect(finalizationMatrix).toContain("higherEpochPointer");
    expect(finalizationMatrix).toContain("assertNonPublishableReplayFencedWithCorruptPointer");
    expect(finalizationMatrix).toContain("issued_lease_epoch=null");
    expect(finalizationMatrix).toContain("issued_lease_until=null");
    const terminalEvidence = functionBody(finalizationSource, "statsedge_assert_terminal_replay_evidence_v1");
    expect(terminalEvidence).toContain("public.statsedge_finalization_manifest_v1(");
    expect(terminalEvidence).toContain("public.statsedge_finalization_set_hash_v1(v_manifest)");
    expect(terminalEvidence).toContain("v_execution.checkpoint -> 'finalization_receipt'");
    expect(terminalEvidence).toContain("v_set.integrity_class is distinct from 'verified'");
    expect(terminalEvidence).toContain("v_execution.issued_lease_epoch is null");
    expect(terminalEvidence).toContain("w.written_lease_epoch < v_execution.issued_lease_epoch");
    expect(terminalEvidence).toContain("SE_FENCED");
    expect(terminalEvidence).toMatch(/returns\s+void\s+language\s+plpgsql\s+security\s+invoker/iu);
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
