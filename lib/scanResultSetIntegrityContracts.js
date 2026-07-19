export const PG_JSONB_SHA256_VERSION = "statsedge-pg-jsonb-sha256-v1";
export const SCAN_RESULT_ROW_SCHEMA_VERSION = "statsedge-scan-result-row-v1";

export const RESULT_SET_STATES = Object.freeze(["staging", "sealed", "abandoned", "legacy_unknown"]);
// legacy_unknown represents imported history only; Hito 1B must never
// transition it into running/finalizing/published lifecycle states.
export const EXECUTION_STATES = Object.freeze(["running", "finalizing", "ready_to_publish", "published", "failed", "cancelled", "abandoned", "legacy_unknown"]);
export const INTEGRITY_CLASSES = Object.freeze(["verified", "legacy_unknown"]);

// Hito 1B-1 exposes only the lease/ledger interfaces. Every writer accepts
// the exact owner/scan/execution/result-set/epoch tuple. Publication,
// finalization and derived snapshots intentionally have no JS contract yet.
export const SCAN_RESULT_SET_RPC_CONTRACTS = Object.freeze({
  begin_scan_execution: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch", "idempotency_key", "input", "methodology"],
  resume_scan_execution: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch"],
  takeover_scan_execution: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch"],
  register_scan_work_item: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch", "work_index", "payload"],
  persist_scan_result: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch", "work_index", "row"],
  complete_scan_work_item: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch", "work_index", "outcome", "reason"],
  checkpoint_scan_execution: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch", "checkpoint"],
  abandon_scan_execution: ["owner_id", "scan_id", "execution_id", "result_set_id", "lease_epoch", "reason"],
});

// Hito 1B-1 writers are RPCs, not fire-and-forget procedures. Every call must
// return a JSON object; this inventory makes the output shape reviewable
// without invoking PostgreSQL. `begin_scan_execution` always reports the
// original lease issuance and says whether it was an idempotent replay.
export const SCAN_RESULT_SET_RPC_RETURN_CONTRACTS = Object.freeze({
  begin_scan_execution: ["execution_id", "result_set_id", "lease_epoch", "lease_until", "replayed"],
  resume_scan_execution: ["execution_id", "result_set_id", "lease_epoch", "lease_until"],
  takeover_scan_execution: ["execution_id", "result_set_id", "lease_epoch", "lease_until"],
  register_scan_work_item: ["work_index", "identity_key", "payload_hash", "idempotent"],
  persist_scan_result: ["work_index", "row_hash", "idempotent"],
  complete_scan_work_item: ["work_index", "outcome", "idempotent"],
  checkpoint_scan_execution: ["cursor", "registered_count", "persisted_count", "completed_count", "failed_count", "cancelled_count", "row_count"],
  abandon_scan_execution: ["execution_id", "result_set_id", "state"],
});
