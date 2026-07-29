import assert from "node:assert/strict";
import test from "node:test";
import { applyExecutionLifecycle, callRpc, openPersistentPsqlSession, requireEphemeralPostgresUrl } from "./_ephemeralPostgresHarness.mjs";

const owner = "concurrency-owner";
const scan = "00000000-0000-0000-0000-00000000c101";
const execution = "00000000-0000-0000-0000-00000000c102";
const resultSet = "00000000-0000-0000-0000-00000000c103";
const pointerExecutionA = "00000000-0000-0000-0000-00000000c104";
const pointerResultSetA = "00000000-0000-0000-0000-00000000c105";
const pointerExecutionB = "00000000-0000-0000-0000-00000000c106";
const pointerResultSetB = "00000000-0000-0000-0000-00000000c107";
const RESULT_SET_BUSY_SQLSTATE = "P0001";
const RESULT_SET_BUSY_CODE = "SE_RESULT_SET_BUSY";
const POINTER_STATE_INVARIANT_CODES = new Set([
  "SE_INVALID_PUBLISHED_POINTER",
  "SE_PUBLISHED_RESULT_SET_STATE_LOCKED",
]);

async function rpc(session, name, args) {
  return JSON.parse((await callRpc(session, name, args)).stdout).result;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableResultSetBusy(error) {
  const envelope = error?.envelope;
  const sqlstates = [error?.sqlstate, envelope?.sqlstate];
  const messages = [error?.message, envelope?.stdout, envelope?.stderr];
  return sqlstates.includes(RESULT_SET_BUSY_SQLSTATE)
    && messages.some((message) => typeof message === "string" && new RegExp(`\\b${RESULT_SET_BUSY_CODE}\\b`, "u").test(message));
}

function contractualPointerStateCode(error) {
  const envelope = error?.envelope;
  const sqlstates = [error?.sqlstate, envelope?.sqlstate];
  if (!sqlstates.includes(RESULT_SET_BUSY_SQLSTATE)) return null;
  const messages = [error?.postgresMessage, error?.message, envelope?.stdout, envelope?.stderr];
  const codes = new Set(messages.flatMap((message) => (
    typeof message === "string" ? [...message.matchAll(/\b(SE_[A-Z_]+)\b/gu)].map((match) => match[1]) : []
  )));
  if (codes.size !== 1) return null;
  return [...codes][0];
}

function classifyPointerStateOutcome(outcome) {
  if (outcome?.status === "fulfilled") return { kind: "success", retryable: false };
  const code = contractualPointerStateCode(outcome?.reason);
  if (code === RESULT_SET_BUSY_CODE) return { kind: code, retryable: true };
  if (POINTER_STATE_INVARIANT_CODES.has(code)) return { kind: code, retryable: false };
  return null;
}

function assertPointerStateOutcome(outcome, label) {
  const classification = classifyPointerStateOutcome(outcome);
  assert.ok(classification, `${label} must be success, SE_RESULT_SET_BUSY, or a contractual pointer/state invariant error.`);
  return classification;
}

function assertPointerStateProjection(projection, resultSetId, label) {
  assert.ok(["sealed", "staging", "abandoned"].includes(projection.target_state), `${label} must retain a valid target state.`);
  assert.ok(projection.pointer === null || projection.pointer_state === "sealed", `${label} must not leave any pointer to staging or abandoned.`);
  assert.ok(projection.pointer !== resultSetId || projection.target_state === "sealed", `${label} must not leave a partial pointer/state mutation for the raced result set.`);
}

async function pointerStateProjection(session, resultSetId) {
  return JSON.parse((await session.query(`
    select jsonb_build_object(
      'pointer', (select published_result_set_id from public.scans where id='${scan}'),
      'pointer_state', (select state from public.scan_result_sets where id=(select published_result_set_id from public.scans where id='${scan}')),
      'target_state', (select state from public.scan_result_sets where id='${resultSetId}')
    )::text
  `)).stdout);
}

function observeWriter(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
}

test("pure pointer/state race classifier admits only contractual structured outcomes", () => {
  const rejected = (code) => ({
    status: "rejected",
    reason: { sqlstate: "P0001", envelope: { sqlstate: "P0001", stderr: `ERROR: P0001: ${code}` } },
  });
  assert.deepEqual(classifyPointerStateOutcome({ status: "fulfilled", value: {} }), { kind: "success", retryable: false });
  assert.deepEqual(classifyPointerStateOutcome(rejected("SE_RESULT_SET_BUSY")), { kind: "SE_RESULT_SET_BUSY", retryable: true });
  assert.deepEqual(classifyPointerStateOutcome(rejected("SE_INVALID_PUBLISHED_POINTER")), { kind: "SE_INVALID_PUBLISHED_POINTER", retryable: false });
  assert.deepEqual(classifyPointerStateOutcome(rejected("SE_PUBLISHED_RESULT_SET_STATE_LOCKED")), { kind: "SE_PUBLISHED_RESULT_SET_STATE_LOCKED", retryable: false });
  assert.equal(classifyPointerStateOutcome({ status: "rejected", reason: new Error("generic failure") }), null);
  assert.equal(classifyPointerStateOutcome({ status: "rejected", reason: { sqlstate: "23505", message: "SE_RESULT_SET_BUSY" } }), null);
  assert.equal(classifyPointerStateOutcome(rejected("SE_RPC_RESULT_INVALID_JSON")), null);
});

async function settleWithoutDeadlock(promise, label) {
  return Promise.race([
    promise,
    wait(1000).then(() => { throw new Error(`${label} deadlocked instead of succeeding or returning SE_RESULT_SET_BUSY.`); }),
  ]);
}

function assertAllowedOverlapOutcome(outcome, label, allowIdempotencyConflict = false) {
  if (outcome.status === "fulfilled") return;
  if (isRetryableResultSetBusy(outcome.reason)) return;
  const expected = allowIdempotencyConflict ? /SE_IDEMPOTENCY_CONFLICT/ : /$^/u;
  assert.match(outcome.reason?.message || "", expected, `${label} may fail only closed for contention${allowIdempotencyConflict ? " or the expected conflicting replay" : ""}.`);
}

function taggedOutcomes(outcomes) {
  return outcomes.map((outcome, index) => ({ ...outcome, index }));
}

function soleNonIdempotentWinner(outcomes, label) {
  const winners = outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value.idempotent === false);
  assert.equal(winners.length, 1, `${label} must leave exactly one non-idempotent winner.`);
  return winners[0];
}

async function snapshot(session) {
  const raw = JSON.parse((await session.query(`
    select jsonb_build_object(
      'scan', (select to_jsonb(s) from public.scans s where s.id='${scan}'),
      'execution', (select to_jsonb(e) from public.scan_executions e where e.id='${execution}'),
      'result_set', (select to_jsonb(rs) from public.scan_result_sets rs where rs.id='${resultSet}'),
      'work_items', coalesce((select jsonb_agg(to_jsonb(w) order by w.work_index) from public.scan_work_items w where w.result_set_id='${resultSet}'), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.work_index) from public.scan_result_set_rows r where r.result_set_id='${resultSet}'), '[]'::jsonb)
    )::text;
  `)).stdout);
  const fields = (record, names) => Object.fromEntries(names.map((name) => [name, record?.[name] ?? null]));
  return {
    scan: fields(raw.scan, ["id", "owner_id", "local_id", "name", "active_execution_id", "active_result_set_id", "published_result_set_id", "lease_epoch", "lease_until", "published_state", "published_at", "published_updated_at"]),
    execution: fields(raw.execution, ["id", "owner_id", "scan_id", "result_set_id", "state", "lease_epoch", "lease_until", "issued_lease_epoch", "issued_lease_until", "idempotency_key", "idempotency_hash", "input_hash", "methodology_hash", "expected_count", "registered_count", "persisted_count", "completed_count", "failed_count", "cancelled_count", "checkpoint"]),
    result_set: fields(raw.result_set, ["id", "owner_id", "scan_id", "execution_id", "integrity_class", "state", "hash_version", "expected_count", "row_count", "ledger_count", "set_hash", "sealed_at", "abandoned_at"]),
    work_items: raw.work_items.map((item) => fields(item, ["result_set_id", "scan_id", "owner_id", "work_index", "identity_key", "payload", "payload_hash", "outcome", "row_hash", "error", "written_lease_epoch"])),
    rows: raw.rows.map((row) => fields(row, ["result_set_id", "scan_id", "owner_id", "work_index", "identity_key", "payload", "payload_hash", "row_hash"])),
  };
}

async function expectRejectedWithoutMutation(session, action, pattern) {
  const before = await snapshot(session);
  await assert.rejects(action, pattern);
  assert.deepEqual(await snapshot(session), before, "Rejected concurrent write left partial state behind.");
}

async function installDelayTrigger(session, table, triggerName, operation) {
  await session.query(`create function public.${triggerName}_fn() returns trigger language plpgsql as $$ begin perform pg_sleep(0.12); return new; end $$`);
  await session.query(`create trigger ${triggerName} before ${operation} on public.${table} for each row execute function public.${triggerName}_fn()`);
}

async function removeDelayTrigger(session, table, triggerName) {
  await session.query(`drop trigger ${triggerName} on public.${table}`);
  await session.query(`drop function public.${triggerName}_fn()`);
}

test("PostgresIntegrationError classifies only the exact retryable result-set busy contract", () => {
  const directBusy = new Error("[Persistent PostgreSQL command failed] SQLSTATE=P0001 message=SE_RESULT_SET_BUSY detail=<none>");
  directBusy.name = "PostgresIntegrationError";
  directBusy.sqlstate = "P0001";
  directBusy.envelope = { sqlstate: "P0001", stdout: "", stderr: "ERROR:  P0001: SE_RESULT_SET_BUSY" };
  assert.equal(isRetryableResultSetBusy(directBusy), true);

  const envelopeBusy = new Error("[Persistent PostgreSQL command failed] SQLSTATE=unknown message=PostgreSQL command failed");
  envelopeBusy.name = "PostgresIntegrationError";
  envelopeBusy.sqlstate = null;
  envelopeBusy.envelope = { sqlstate: "P0001", stdout: "", stderr: "ERROR:  P0001: SE_RESULT_SET_BUSY" };
  assert.equal(isRetryableResultSetBusy(envelopeBusy), true);

  const unrelatedRaiseException = new Error("[Persistent PostgreSQL command failed] SQLSTATE=P0001 message=SE_OTHER_FAILURE");
  unrelatedRaiseException.name = "PostgresIntegrationError";
  unrelatedRaiseException.sqlstate = "P0001";
  unrelatedRaiseException.envelope = { sqlstate: "P0001", stdout: "", stderr: "ERROR:  P0001: SE_OTHER_FAILURE" };
  assert.equal(isRetryableResultSetBusy(unrelatedRaiseException), false);
});

test("an immediately rejected busy writer is observed and normalized", async () => {
  const busy = new Error("SE_RESULT_SET_BUSY");
  busy.sqlstate = RESULT_SET_BUSY_SQLSTATE;
  busy.envelope = { sqlstate: RESULT_SET_BUSY_SQLSTATE, stdout: "", stderr: RESULT_SET_BUSY_CODE };
  let unhandledReason;
  const onUnhandledRejection = (reason) => { unhandledReason = reason; };
  process.once("unhandledRejection", onUnhandledRejection);
  try {
    const outcome = await observeWriter(Promise.reject(busy));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(outcome, { status: "rejected", reason: busy });
    assert.equal(isRetryableResultSetBusy(outcome.reason), true);
    assert.equal(unhandledReason, undefined);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

test("real PostgreSQL: two persistent writers race through takeover, register and persist with no partial state", async () => {
  const url = requireEphemeralPostgresUrl("scan-result-set-concurrency");
  applyExecutionLifecycle(url);
  const connectionA = openPersistentPsqlSession(url, "writer_A");
  const connectionB = openPersistentPsqlSession(url, "writer_B");
  try {
    await connectionA.query(`insert into public.scans(id,owner_id,local_id,name) values('${scan}','${owner}','concurrency','Concurrency')`);
    const started = await rpc(connectionA, "begin_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',0,'race-1','{"expectedCount":2}'::jsonb,'{}'::jsonb,60`);
    assert.equal(started.lease_epoch, 1);
    await connectionA.query(`
      with expired as (select clock_timestamp() - interval '1 second' as lease_until),
      scan as (
        update public.scans s set lease_until = expired.lease_until
        from expired where s.id='${scan}'
        returning expired.lease_until
      )
      update public.scan_executions e set lease_until = scan.lease_until
      from scan where e.id='${execution}'
    `);

    const beforeTakeover = await snapshot(connectionA);
    await installDelayTrigger(connectionA, "scans", "hito_1b_takeover_delay", "update");
    const takeoverA = observeWriter(rpc(connectionA, "takeover_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',1,60`));
    await wait(10);
    const takeoverB = observeWriter(rpc(connectionB, "takeover_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',1,60`));
    const takeoverOutcomes = await Promise.all([settleWithoutDeadlock(takeoverA, "first takeover RPC"), settleWithoutDeadlock(takeoverB, "second takeover RPC")]);
    await removeDelayTrigger(connectionA, "scans", "hito_1b_takeover_delay");
    assert.equal(takeoverOutcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(takeoverOutcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    assert.equal(isRetryableResultSetBusy(takeoverOutcomes.find((outcome) => outcome.status === "rejected").reason), true);
    assert.equal(takeoverOutcomes.find((outcome) => outcome.status === "fulfilled").value.lease_epoch, 2);
    const afterTakeover = await snapshot(connectionA);
    assert.equal(afterTakeover.scan.lease_epoch, 2);
    assert.equal(afterTakeover.execution.lease_epoch, 2);
    assert.equal(afterTakeover.work_items.length, beforeTakeover.work_items.length);
    assert.equal(afterTakeover.rows.length, beforeTakeover.rows.length);
    assert.deepEqual(
      JSON.parse((await connectionA.query(`select jsonb_build_object(
        'scan', jsonb_build_object('active_execution_id', s.active_execution_id, 'active_result_set_id', s.active_result_set_id, 'lease_epoch', s.lease_epoch, 'lease_live', s.lease_until > clock_timestamp()),
        'execution', jsonb_build_object('id', e.id, 'result_set_id', e.result_set_id, 'lease_epoch', e.lease_epoch, 'lease_matches_scan', e.lease_until is not distinct from s.lease_until),
        'result_set', jsonb_build_object('id', rs.id, 'state', rs.state, 'scan_id', rs.scan_id, 'execution_id', rs.execution_id),
        'ledger', (select count(*) from public.scan_work_items where result_set_id='${resultSet}'),
        'rows', (select count(*) from public.scan_result_set_rows where result_set_id='${resultSet}')
      )::text from public.scans s join public.scan_executions e on e.id='${execution}' join public.scan_result_sets rs on rs.id='${resultSet}' where s.id='${scan}'`)).stdout),
      { scan: { active_execution_id: execution, active_result_set_id: resultSet, lease_epoch: 2, lease_live: true }, execution: { id: execution, result_set_id: resultSet, lease_epoch: 2, lease_matches_scan: true }, result_set: { id: resultSet, state: "staging", scan_id: scan, execution_id: execution }, ledger: 0, rows: 0 },
      "Takeover race final scan/execution/set/lease/ledger/rows projection must equal a single successful takeover.",
    );

    await installDelayTrigger(connectionA, "scan_work_items", "hito_1b_register_delay", "insert");
    const beforeRegister = await snapshot(connectionA);
    const registerInputs = [1, 2];
    const registerA = observeWriter(rpc(connectionA, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${registerInputs[0]}}'::jsonb`));
    await wait(10);
    const registerB = observeWriter(rpc(connectionB, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${registerInputs[1]}}'::jsonb`));
    const registerOutcomes = taggedOutcomes(await Promise.all([settleWithoutDeadlock(registerA, "first conflicting register"), settleWithoutDeadlock(registerB, "second conflicting register")]));
    for (const outcome of registerOutcomes) assertAllowedOverlapOutcome(outcome, "Initial register overlap");
    if (registerOutcomes.every((outcome) => outcome.status === "rejected")) {
      assert.deepEqual(await snapshot(connectionA), beforeRegister, "An initial SE_RESULT_SET_BUSY must not leave a partial register mutation.");
    }
    await removeDelayTrigger(connectionA, "scan_work_items", "hito_1b_register_delay");
    const registerSettled = [...registerOutcomes];
    for (const outcome of registerOutcomes.filter((outcome) => outcome.status === "rejected" && isRetryableResultSetBusy(outcome.reason))) {
      const retry = await settleWithoutDeadlock(
        observeWriter(rpc(connectionB, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${registerInputs[outcome.index]}}'::jsonb`)),
        `register retry ${outcome.index}`,
      );
      assertAllowedOverlapOutcome(retry, "Register retry", true);
      registerSettled.push({ ...retry, index: outcome.index });
    }
    const registeredWinnerOutcome = soleNonIdempotentWinner(registerSettled, "Register overlap and retries");
    const registeredWinner = registeredWinnerOutcome.value;
    const winningInput = registerInputs[registeredWinnerOutcome.index];
    assert.equal(registeredWinner.idempotent, false);
    assert.deepEqual(await snapshot(connectionA), {
      ...beforeRegister,
      work_items: [{ result_set_id: resultSet, scan_id: scan, owner_id: owner, work_index: 0, identity_key: "AAA", payload: { input: winningInput, symbol: "AAA" }, payload_hash: registeredWinner.payload_hash, outcome: "registered", row_hash: null, error: null, written_lease_epoch: 2 }],
    }, "Register race must leave the complete scan/execution/set/lease/checkpoint/counter/ledger/row projection identical to its sole winner.");
    assert.equal((await rpc(connectionB, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${winningInput}}'::jsonb`)).idempotent, true, "Retry after SE_RESULT_SET_BUSY must return the documented idempotent result.");

    await installDelayTrigger(connectionA, "scan_result_set_rows", "hito_1b_persist_delay", "insert");
    const beforePersist = await snapshot(connectionA);
    const persistA = observeWriter(rpc(connectionA, "persist_scan_result", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${winningInput}}'::jsonb`));
    await wait(10);
    const persistB = observeWriter(rpc(connectionB, "persist_scan_result", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${winningInput + 100}}'::jsonb`));
    const persistInputs = [winningInput, winningInput + 100];
    const persistOutcomes = taggedOutcomes(await Promise.all([settleWithoutDeadlock(persistA, "first conflicting persist"), settleWithoutDeadlock(persistB, "second conflicting persist")]));
    for (const outcome of persistOutcomes) assertAllowedOverlapOutcome(outcome, "Initial persist overlap");
    if (persistOutcomes.every((outcome) => outcome.status === "rejected")) {
      assert.deepEqual(await snapshot(connectionA), beforePersist, "An initial SE_RESULT_SET_BUSY must not leave a partial persist mutation.");
    }
    await removeDelayTrigger(connectionA, "scan_result_set_rows", "hito_1b_persist_delay");
    const persistSettled = [...persistOutcomes];
    for (const outcome of persistOutcomes.filter((outcome) => outcome.status === "rejected" && isRetryableResultSetBusy(outcome.reason))) {
      const retry = await settleWithoutDeadlock(
        observeWriter(rpc(connectionB, "persist_scan_result", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${persistInputs[outcome.index]}}'::jsonb`)),
        `persist retry ${outcome.index}`,
      );
      assertAllowedOverlapOutcome(retry, "Persist retry", true);
      persistSettled.push({ ...retry, index: outcome.index });
    }
    const persistedWinnerOutcome = soleNonIdempotentWinner(persistSettled, "Persist overlap and retries");
    const persistedWinner = persistedWinnerOutcome.value;
    const persistedWinningInput = persistInputs[persistedWinnerOutcome.index];
    assert.equal(persistedWinner.idempotent, false);
    assert.deepEqual(await snapshot(connectionA), {
      ...beforePersist,
      work_items: [{ result_set_id: resultSet, scan_id: scan, owner_id: owner, work_index: 0, identity_key: "AAA", payload: { input: winningInput, symbol: "AAA" }, payload_hash: registeredWinner.payload_hash, outcome: "persisted", row_hash: persistedWinner.row_hash, error: null, written_lease_epoch: 2 }],
      rows: [{ result_set_id: resultSet, scan_id: scan, owner_id: owner, work_index: 0, identity_key: "AAA", payload: { input: persistedWinningInput, symbol: "AAA" }, payload_hash: persistedWinner.row_hash, row_hash: persistedWinner.row_hash }],
    }, "Persist race must leave the complete scan/execution/set/lease/checkpoint/counter/ledger/row projection identical to its sole winner.");
    assert.equal((await rpc(connectionB, "persist_scan_result", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":${persistedWinningInput}}'::jsonb`)).idempotent, true, "Retry after SE_RESULT_SET_BUSY must return the documented idempotent result.");

    // A direct state UPDATE acquires its row lock before the inverse trigger;
    // the trigger owns the common advisory key and the writer must reject
    // immediately rather than wait behind a lock cycle. Once the harmless
    // staging->staging state update commits, retrying the writer succeeds.
    await installDelayTrigger(connectionA, "scan_result_sets", "zzz_writer_state_delay", "update");
    const stateWriter = observeWriter(connectionA.query(`update public.scan_result_sets set state='staging' where id='${resultSet}'`));
    await wait(10);
    const writerDuringState = observeWriter(rpc(connectionB, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,1,'{"symbol":"CCC"}'::jsonb`));
    assert.equal((await settleWithoutDeadlock(stateWriter, "state writer race")).status, "fulfilled");
    const writerDuringStateOutcome = await settleWithoutDeadlock(writerDuringState, "writer state race");
    assert.equal(writerDuringStateOutcome.status, "rejected");
    assert.equal(isRetryableResultSetBusy(writerDuringStateOutcome.reason), true);
    await removeDelayTrigger(connectionA, "scan_result_sets", "zzz_writer_state_delay");
    assert.equal((await rpc(connectionB, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,1,'{"symbol":"CCC"}'::jsonb`)).idempotent, false, "Writer retry after a state race must revalidate staging and complete.");

    // Direct synthetic pointer/state races are intentionally retired. 1B-2
    // permits publication only through finalize_scan_execution, and its real
    // pointer/race matrix is exercised in the finalization suite.
  } finally {
    connectionA.close();
    connectionB.close();
  }
});
