import assert from "node:assert/strict";
import test from "node:test";
import {
  applyExecutionLifecycle,
  callRpc,
  openPersistentPsqlSession,
  requireEphemeralPostgresUrl,
} from "./_ephemeralPostgresHarness.mjs";

const owner = "hito-1b2-finalize-owner";

async function rpc(session, name, args) {
  return JSON.parse((await callRpc(session, name, args)).stdout).result;
}

function ids(n) {
  const suffix = String(n).padStart(10, "0");
  return {
    scan: `00000000-0000-0000-0000-f1${suffix}`,
    execution: `00000000-0000-0000-0000-f2${suffix}`,
    resultSet: `00000000-0000-0000-0000-f3${suffix}`,
  };
}

async function projection(session, id) {
  return JSON.parse((await session.query(`
    select jsonb_build_object(
      'scan', (select to_jsonb(s) from public.scans s where s.id='${id.scan}'),
      'execution', (select to_jsonb(e) from public.scan_executions e where e.id='${id.execution}'),
      'result_set', (select to_jsonb(rs) from public.scan_result_sets rs where rs.id='${id.resultSet}'),
      'ledger', coalesce((select jsonb_agg(to_jsonb(w) order by work_index) from public.scan_work_items w where w.result_set_id='${id.resultSet}'), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(to_jsonb(r) order by work_index) from public.scan_result_set_rows r where r.result_set_id='${id.resultSet}'), '[]'::jsonb)
    )::text;
  `)).stdout);
}

async function begin(session, id, expectedCount, epoch = 0, ownerId = owner) {
  await session.query(`insert into public.scans(id,owner_id,local_id,name) values('${id.scan}','${ownerId}','final-${id.scan.slice(-4)}','Finalization') on conflict (id) do nothing`);
  return rpc(session, "begin_scan_execution", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${epoch},'idem-${id.execution}','{"expectedCount":${expectedCount}}'::jsonb,'{}'::jsonb,60`);
}

async function seed(session, id, epoch, outcomes, ownerId = owner) {
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    const symbol = `S${index}`;
    await rpc(session, "register_scan_work_item", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${epoch},${index},'{"symbol":"${symbol}","input":${index}}'::jsonb`);
    if (outcome === "persisted") {
      // The result payload legitimately differs from the registered input;
      // only its own hash and shared identity/row hash are reconciled.
      await rpc(session, "persist_scan_result", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${epoch},${index},'{"symbol":"${symbol}","result":${index}}'::jsonb`);
    } else {
      await rpc(session, "complete_scan_work_item", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${epoch},${index},'${outcome}','{"reason":"fixture"}'::jsonb`);
    }
  }
}

async function seedOutOfOrder(session, id, epoch) {
  for (const index of [1, 0]) {
    const symbol = `O${index}`;
    await rpc(session, "register_scan_work_item", `'${owner}','${id.scan}','${id.execution}','${id.resultSet}',${epoch},${index},'{"symbol":"${symbol}","input":${index}}'::jsonb`);
    await rpc(session, "persist_scan_result", `'${owner}','${id.scan}','${id.execution}','${id.resultSet}',${epoch},${index},'{"symbol":"${symbol}","result":${index}}'::jsonb`);
  }
}

function manifestV1FromPhysicalProjection(value) {
  const execution = value.execution;
  return {
    manifest_version: "statsedge-finalize-manifest-v1",
    owner_id: execution.owner_id,
    scan_id: execution.scan_id,
    execution_id: execution.id,
    result_set_id: execution.result_set_id,
    policy_version: execution.policy_version,
    hash_version: execution.hash_version,
    row_schema_version: "statsedge-scan-result-row-v1",
    expected_count: execution.expected_count,
    ledger_count: value.ledger.length,
    work_items: value.ledger.map((w) => ({ work_index: w.work_index, identity_key: w.identity_key, payload: w.payload, payload_hash: w.payload_hash, outcome: w.outcome, row_hash: w.row_hash, error: w.error, written_lease_epoch: w.written_lease_epoch })),
    rows: value.rows.map((r) => ({ work_index: r.work_index, identity_key: r.identity_key, payload: r.payload, payload_hash: r.payload_hash, row_hash: r.row_hash, hash_version: r.hash_version, row_schema_version: r.row_schema_version, owner_id: r.owner_id, scan_id: r.scan_id, result_set_id: r.result_set_id })),
  };
}

async function canonicalBaseHash(session, manifest) {
  const literal = JSON.stringify(manifest).replaceAll("'", "''");
  return (await session.query(`select public.statsedge_pg_jsonb_sha256_v1('${literal}'::jsonb)`)).stdout;
}

async function finalize(session, id, epoch, ownerId = owner) {
  return rpc(session, "finalize_scan_execution", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${epoch}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertBusy(outcome, label) {
  assert.equal(outcome.status, "rejected", `${label} must lose during the advisory-lock pause.`);
  assert.equal(outcome.reason?.sqlstate || outcome.reason?.envelope?.sqlstate, "P0001", `${label} must preserve SQLSTATE P0001.`);
  assert.match(outcome.reason?.message || "", /SE_RESULT_SET_BUSY/, `${label} must fail closed with the retryable lock token.`);
}

function publicationProjection(scan) {
  return {
    published_result_set_id: scan.published_result_set_id,
    published_state: scan.published_state,
    row_count: scan.row_count,
    published_at: scan.published_at,
    published_updated_at: scan.published_updated_at,
  };
}

function assertTerminalProjection(value, receipt, terminalState, publicationBefore = null) {
  assert.equal(value.scan.active_execution_id, null);
  assert.equal(value.scan.active_result_set_id, null);
  assert.equal(value.scan.owner_id, receipt.owner_id);
  assert.equal(value.execution.id, receipt.execution_id);
  assert.equal(value.execution.owner_id, receipt.owner_id);
  assert.equal(value.execution.scan_id, receipt.scan_id);
  assert.equal(value.execution.result_set_id, receipt.result_set_id);
  assert.equal(value.result_set.id, receipt.result_set_id);
  assert.equal(value.result_set.owner_id, receipt.owner_id);
  assert.equal(value.result_set.scan_id, receipt.scan_id);
  assert.equal(value.result_set.execution_id, receipt.execution_id);
  assert.equal(value.execution.state, terminalState === "partial" ? "published" : terminalState);
  assert.equal(value.execution.registered_count, receipt.ledger_count);
  assert.equal(value.execution.persisted_count, receipt.persisted_count);
  assert.equal(value.execution.completed_count, receipt.ledger_count - receipt.persisted_count);
  assert.equal(value.execution.failed_count, receipt.failed_count);
  assert.equal(value.execution.cancelled_count, receipt.cancelled_count);
  assert.equal(value.result_set.ledger_count, receipt.ledger_count);
  assert.equal(value.result_set.row_count, receipt.row_count);
  assert.equal(value.result_set.expected_count, receipt.expected_count);
  assert.equal(value.result_set.set_hash, receipt.set_hash);
  assert.deepEqual(value.execution.checkpoint.finalization_receipt, receipt);
  assert.equal(value.execution.checkpoint.finalization_state, receipt.state);
  assert.ok(value.execution.finished_at, "Terminal execution must have a finish timestamp.");
  assert.equal(value.ledger.length, receipt.ledger_count);
  assert.equal(value.rows.length, receipt.row_count);
  assert.deepEqual(value.ledger.map((w) => w.work_index), Array.from({ length: receipt.ledger_count }, (_, index) => index));
  for (const workItem of value.ledger) {
    assert.equal(workItem.owner_id, receipt.owner_id);
    assert.equal(workItem.scan_id, receipt.scan_id);
    assert.equal(workItem.result_set_id, receipt.result_set_id);
  }
  for (const row of value.rows) {
    assert.equal(row.owner_id, receipt.owner_id);
    assert.equal(row.scan_id, receipt.scan_id);
    assert.equal(row.result_set_id, receipt.result_set_id);
  }
  if (terminalState === "partial") {
    assert.equal(value.scan.published_result_set_id, receipt.result_set_id);
    assert.equal(value.scan.published_state, "published");
    assert.equal(value.scan.row_count, receipt.row_count);
    assert.equal(value.result_set.state, "sealed");
  } else {
    assert.ok(publicationBefore, "Non-publishable terminal states must compare the complete prior publication projection.");
    assert.deepEqual(publicationProjection(value.scan), publicationBefore);
    assert.equal(value.result_set.state, "abandoned");
  }
}

async function corruptRunningCheckpoint(session, id, outcome, checkpoint) {
  const lease = await begin(session, id, 1);
  await seed(session, id, lease.lease_epoch, [outcome]);
  await session.query(`update public.scan_executions set checkpoint=${checkpoint} where id='${id.execution}'`);
  const before = await projection(session, id);
  await assert.rejects(() => finalize(session, id, lease.lease_epoch), /SE_FENCED/);
  assert.deepEqual(await projection(session, id), before, "Corrupt running checkpoint must fail before any terminal mutation.");
}

async function corruptTerminalFixture(session, id, terminalState, outcome, checkpoint) {
  const lease = await begin(session, id, 1);
  await seed(session, id, lease.lease_epoch, [outcome]);
  const physical = await projection(session, id);
  const setHash = await canonicalBaseHash(session, manifestV1FromPhysicalProjection(physical));
  // Both transitions originate from OLD running/staging, so this fixture
  // proves replay rejects persisted terminal corruption rather than allowing it.
  await session.query(`update public.scans set active_execution_id=null, active_result_set_id=null, lease_until=null where id='${id.scan}'`);
  await session.query(`update public.scan_result_sets set state='abandoned', set_hash='${setHash}', ledger_count=1, row_count=${outcome === "persisted" ? 1 : 0}, abandoned_at=clock_timestamp() where id='${id.resultSet}'`);
  await session.query(`update public.scan_executions set state='${terminalState}', registered_count=1, persisted_count=${outcome === "persisted" ? 1 : 0}, completed_count=1, failed_count=${outcome === "failed" ? 1 : 0}, cancelled_count=${outcome === "cancelled" ? 1 : 0}, checkpoint=${checkpoint}, finalizing_at=(select abandoned_at from public.scan_result_sets where id='${id.resultSet}'), finished_at=(select abandoned_at from public.scan_result_sets where id='${id.resultSet}') where id='${id.execution}'`);
  const before = await projection(session, id);
  await assert.rejects(() => finalize(session, id, lease.lease_epoch), /SE_FENCED/);
  assert.deepEqual(await projection(session, id), before, "Corrupt terminal receipt must not be replayed or repaired.");
}

async function corruptTerminalReplayFixture(session, id, {
  executionState = "failed",
  receiptState = null,
  setState = null,
  receiptPatch = {},
  setValues = {},
  executionValues = {},
  seedOutcome = "failed",
  physicalMutation = null,
  ownerId = owner,
  residualActive = null,
  omitFinalizingAt = false,
  omitSetTimestamp = false,
  publishedPointer = true,
  beginEpoch = 0,
  replayTarget = null,
  scanLeaseEpoch = null,
  terminalLeaseEpoch = null,
  terminalIssuedLeaseEpoch = null,
} = {}) {
  const lease = await begin(session, id, 1, beginEpoch, ownerId);
  const effectiveLeaseEpoch = terminalLeaseEpoch ?? lease.lease_epoch;
  const effectiveIssuedLeaseEpoch = terminalIssuedLeaseEpoch ?? effectiveLeaseEpoch;
  await seed(session, id, lease.lease_epoch, [seedOutcome], ownerId);
  if (physicalMutation) await physicalMutation(session, id, lease, effectiveLeaseEpoch);
  const physical = await projection(session, id);
  const setHash = await canonicalBaseHash(session, manifestV1FromPhysicalProjection(physical));
  const effectiveReceiptState = receiptState || executionState;
  const effectiveSetState = setState || (effectiveReceiptState === "complete" || effectiveReceiptState === "partial" ? "sealed" : "abandoned");
  const set = { expected_count: 1, ledger_count: 1, row_count: 0, ...setValues };
  const execution = {
    registered_count: 1,
    persisted_count: 0,
    completed_count: 1,
    failed_count: 1,
    cancelled_count: 0,
    ...executionValues,
  };
  const receipt = {
    owner_id: ownerId,
    scan_id: id.scan,
    execution_id: id.execution,
    result_set_id: id.resultSet,
    lease_epoch: effectiveLeaseEpoch,
    state: effectiveReceiptState,
    set_hash: setHash,
    expected_count: 1,
    ledger_count: 1,
    persisted_count: 0,
    failed_count: 1,
    cancelled_count: 0,
    row_count: 0,
    replayed: false,
    ...receiptPatch,
  };
  const checkpoint = JSON.stringify({ finalization_state: effectiveReceiptState, finalization_receipt: receipt }).replaceAll("'", "''");
  // Both parent transitions start from OLD running/staging. The final call is
  // therefore starts from a complete terminal projection before introducing
  // the one corruption selected by the fixture options.
  await session.query(`update public.scans set active_execution_id=null, active_result_set_id=null, lease_until=null where id='${id.scan}'`);
  await session.query(`update public.scan_result_sets set state='${effectiveSetState}', set_hash='${setHash}', expected_count=${set.expected_count}, ledger_count=${set.ledger_count}, row_count=${set.row_count}, sealed_at=${effectiveSetState === "sealed" && !omitSetTimestamp ? "clock_timestamp()" : "null"}, abandoned_at=${effectiveSetState === "abandoned" && !omitSetTimestamp ? "clock_timestamp()" : "null"} where id='${id.resultSet}'`);
  const structuralTimestamp = omitSetTimestamp ? "created_at" : `(select coalesce(sealed_at, abandoned_at) from public.scan_result_sets where id='${id.resultSet}')`;
  await session.query(`update public.scan_executions set lease_epoch=${effectiveLeaseEpoch}, issued_lease_epoch=${effectiveIssuedLeaseEpoch}, state='${executionState}', registered_count=${execution.registered_count}, persisted_count=${execution.persisted_count}, completed_count=${execution.completed_count}, failed_count=${execution.failed_count}, cancelled_count=${execution.cancelled_count}, checkpoint='${checkpoint}'::jsonb, finalizing_at=${omitFinalizingAt ? "null" : structuralTimestamp}, finished_at=${structuralTimestamp} where id='${id.execution}'`);
  if (executionState === "published" && publishedPointer) {
    await session.query(`update public.scans set published_result_set_id='${id.resultSet}', published_state='published', row_count=${set.row_count}, published_at=(select finalizing_at from public.scan_executions where id='${id.execution}'), published_updated_at=(select finalizing_at from public.scan_executions where id='${id.execution}') where id='${id.scan}'`);
  }
  if (residualActive === "execution") {
    await session.query(`update public.scans set active_execution_id='${id.execution}', active_result_set_id=null, lease_until=null where id='${id.scan}'`);
  } else if (residualActive === "result_set") {
    await session.query(`update public.scans set active_execution_id=null, active_result_set_id='${id.resultSet}', lease_until=null where id='${id.scan}'`);
  }
  if (scanLeaseEpoch !== null) {
    await session.query(`update public.scans set lease_epoch=${scanLeaseEpoch} where id='${id.scan}'`);
  }
  const before = await projection(session, id);
  const replayBefore = replayTarget ? await projection(session, replayTarget.id) : null;
  const target = replayTarget || { id, epoch: effectiveLeaseEpoch, ownerId };
  await assert.rejects(() => finalize(session, target.id, target.epoch, target.ownerId || ownerId), /SE_FENCED/);
  assert.deepEqual(await projection(session, id), before, "Malformed terminal replay metadata must fail closed without repair.");
  if (replayTarget) assert.deepEqual(await projection(session, replayTarget.id), replayBefore, "The replay target must also remain byte-for-byte unchanged.");
  return { issuedLeaseEpoch: effectiveIssuedLeaseEpoch, durableLeaseEpoch: before.scan.lease_epoch };
}

async function assertActiveSuccessorReplayFenced(session, successor, replayTarget, corrupt, label) {
  await corrupt();
  const beforeA = await projection(session, replayTarget.id);
  const beforeB = await projection(session, successor);
  await assert.rejects(() => finalize(session, replayTarget.id, replayTarget.epoch, replayTarget.ownerId), /SE_FENCED/, label);
  assert.deepEqual(await projection(session, replayTarget.id), beforeA, `${label}: A must remain byte-for-byte unchanged.`);
  assert.deepEqual(await projection(session, successor), beforeB, `${label}: active B must remain byte-for-byte unchanged.`);
}

async function assertNonPublishableReplayFencedWithCorruptPointer(session, pointer, candidate, priorLeaseEpoch, outcome) {
  const lease = await begin(session, candidate, 1, priorLeaseEpoch);
  await seed(session, candidate, lease.lease_epoch, [outcome]);
  const receipt = await finalize(session, candidate, lease.lease_epoch);
  assert.equal(receipt.state, outcome === "cancelled" ? "cancelled" : "failed");
  const pointerBefore = await projection(session, pointer);
  const candidateBefore = await projection(session, candidate);
  await assert.rejects(() => finalize(session, candidate, lease.lease_epoch), /SE_FENCED/);
  assert.deepEqual(await projection(session, pointer), pointerBefore, `${outcome}: corrupt sealed pointer must remain byte-for-byte unchanged.`);
  assert.deepEqual(await projection(session, candidate), candidateBefore, `${outcome}: non-publishable terminal must remain byte-for-byte unchanged.`);
  return lease;
}

async function corruptLegacyUnknownTerminalFixture(session, id) {
  const terminalAt = new Date().toISOString();
  const issuedUntil = new Date(Date.now() + 60_000).toISOString();
  const manifest = {
    manifest_version: "statsedge-finalize-manifest-v1",
    owner_id: owner,
    scan_id: id.scan,
    execution_id: id.execution,
    result_set_id: id.resultSet,
    policy_version: "statsedge-scan-execution-v1",
    hash_version: "statsedge-pg-jsonb-sha256-v1",
    row_schema_version: "statsedge-scan-result-row-v1",
    expected_count: 0,
    ledger_count: 0,
    work_items: [],
    rows: [],
  };
  const setHash = await canonicalBaseHash(session, manifest);
  const receipt = {
    owner_id: owner,
    scan_id: id.scan,
    execution_id: id.execution,
    result_set_id: id.resultSet,
    lease_epoch: 1,
    state: "failed",
    set_hash: setHash,
    expected_count: 0,
    ledger_count: 0,
    persisted_count: 0,
    failed_count: 0,
    cancelled_count: 0,
    row_count: 0,
    replayed: false,
  };
  const checkpoint = JSON.stringify({ finalization_state: "failed", finalization_receipt: receipt }).replaceAll("'", "''");
  await session.query(`insert into public.scans(id,owner_id,local_id,name,lease_epoch) values('${id.scan}','${owner}','legacy-${id.scan.slice(-4)}','Legacy terminal',1)`);
  await session.query(`
    begin;
    insert into public.scan_executions(id,owner_id,scan_id,result_set_id,lease_epoch,issued_lease_epoch,issued_lease_until,state,registered_count,persisted_count,completed_count,failed_count,cancelled_count,checkpoint,finalizing_at,finished_at)
    values('${id.execution}','${owner}','${id.scan}','${id.resultSet}',1,1,'${issuedUntil}'::timestamptz,'failed',0,0,0,0,0,'${checkpoint}'::jsonb,'${terminalAt}'::timestamptz,'${terminalAt}'::timestamptz);
    insert into public.scan_result_sets(id,owner_id,scan_id,execution_id,integrity_class,state,set_hash,expected_count,ledger_count,row_count,abandoned_at)
    values('${id.resultSet}','${owner}','${id.scan}','${id.execution}','legacy_unknown','abandoned','${setHash}',0,0,0,'${terminalAt}'::timestamptz);
    commit;
  `);
  const before = await projection(session, id);
  await assert.rejects(() => finalize(session, id, receipt.lease_epoch), /SE_FENCED/);
  assert.deepEqual(await projection(session, id), before, "legacy_unknown must remain invisible and cannot be replayed or published.");
}

async function assertLiveWrittenLeaseEpochFence(session, id, writtenLeaseEpoch, label) {
  const lease = await begin(session, id, 1);
  await seed(session, id, lease.lease_epoch, ["persisted"]);
  const epoch = writtenLeaseEpoch(lease);
  await session.query(`update public.scan_work_items set written_lease_epoch=${epoch === null ? "null" : epoch} where result_set_id='${id.resultSet}' and work_index=0`);
  const before = await projection(session, id);
  await assert.rejects(() => finalize(session, id, lease.lease_epoch), /SE_LEDGER_ROW_MISMATCH/);
  assert.deepEqual(await projection(session, id), before, `${label}: live finalization must not repair an invalid written lease epoch.`);
}

async function createLegacyUnknownActiveSuccessor(session, id, priorLeaseEpoch) {
  const leaseEpoch = priorLeaseEpoch + 1;
  const leaseUntil = new Date(Date.now() + 60_000).toISOString();
  await session.query(`
    begin;
    insert into public.scan_executions(id,owner_id,scan_id,result_set_id,lease_epoch,lease_until,issued_lease_epoch,issued_lease_until,state,expected_count,checkpoint)
    values('${id.execution}','${owner}','${id.scan}','${id.resultSet}',${leaseEpoch},'${leaseUntil}'::timestamptz,${leaseEpoch},'${leaseUntil}'::timestamptz,'running',0,'{"cursor":0}'::jsonb);
    insert into public.scan_result_sets(id,owner_id,scan_id,execution_id,integrity_class,state,expected_count,ledger_count,row_count)
    values('${id.resultSet}','${owner}','${id.scan}','${id.execution}','legacy_unknown','staging',0,0,0);
    update public.scans set active_execution_id='${id.execution}', active_result_set_id='${id.resultSet}', lease_epoch=${leaseEpoch}, lease_until='${leaseUntil}'::timestamptz where id='${id.scan}';
    commit;
  `);
  return { leaseEpoch };
}

async function waitForFinalizeBarrier(observer, winnerPid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const observed = JSON.parse((await observer.query(`
      select jsonb_build_object(
        'pid', ${winnerPid},
        'advisory_lock', exists(select 1 from pg_locks where pid=${winnerPid} and locktype='advisory' and granted),
        'active_finalize', exists(select 1 from pg_stat_activity where pid=${winnerPid} and state='active' and query like '%finalize_scan_execution%'),
        'gate_waiting', exists(select 1 from pg_locks where pid=${winnerPid} and locktype='advisory' and classid=9187001 and objid=12001 and not granted)
      )::text
    `)).stdout);
    if (observed.advisory_lock && observed.active_finalize && observed.gate_waiting) return observed;
    await wait(5);
  }
  assert.fail(`Finalize winner PID ${winnerPid} never reached the advisory-lock barrier.`);
}

test("real PostgreSQL: finalize_scan_execution matrix reconciles, seals, publishes, and preserves old visibility", async () => {
  const url = requireEphemeralPostgresUrl("scan-result-set-finalization-publication");
  applyExecutionLifecycle(url);
  const a = openPersistentPsqlSession(url, "finalize_A");
  const finalizeLoser = openPersistentPsqlSession(url, "finalize_loser");
  const persistLoser = openPersistentPsqlSession(url, "persist_loser");
  const completeLoser = openPersistentPsqlSession(url, "complete_loser");
  const abandonLoser = openPersistentPsqlSession(url, "abandon_loser");
  const reader = openPersistentPsqlSession(url, "finalize_reader");
  try {
    const complete = ids(1);
    const completeLease = await begin(a, complete, 2);
    await seed(a, complete, completeLease.lease_epoch, ["persisted", "persisted"]);
    const completeReceipt = await finalize(a, complete, completeLease.lease_epoch);
    assert.equal(completeReceipt.state, "complete");
    assert.equal((await projection(a, complete)).scan.published_result_set_id, complete.resultSet);
    const replayProjection = await projection(a, complete);
    assert.deepEqual(await finalize(finalizeLoser, complete, completeLease.lease_epoch), { ...completeReceipt, replayed: true });
    assert.deepEqual(await projection(a, complete), replayProjection, "Terminal replay must not touch timestamps or republish.");
    for (const corruptCheckpoint of ["checkpoint - 'finalization_receipt'", "'null'::jsonb", "'[]'::jsonb", "'17'::jsonb", "'{}'::jsonb"]) {
      await assert.rejects(
        () => a.query(`update public.scan_executions set checkpoint=${corruptCheckpoint} where id='${complete.execution}'`),
        /SE_EXECUTION_IMMUTABLE/,
        "Terminal execution corruption must be rejected before an invalid replay can exist.",
      );
    }

    const outOfOrder = ids(18);
    const outOfOrderLease = await begin(a, outOfOrder, 2);
    await seedOutOfOrder(a, outOfOrder, outOfOrderLease.lease_epoch);
    const outOfOrderReceipt = await finalize(a, outOfOrder, outOfOrderLease.lease_epoch);
    const outOfOrderProjection = await projection(a, outOfOrder);
    const expectedManifest = manifestV1FromPhysicalProjection(outOfOrderProjection);
    assert.deepEqual(expectedManifest.work_items.map((item) => item.work_index), [0, 1], "The independent manifest must sort physical work items canonically.");
    assert.deepEqual(expectedManifest.rows.map((row) => row.work_index), [0, 1], "The independent manifest must sort physical rows canonically.");
    assert.equal(await canonicalBaseHash(a, expectedManifest), outOfOrderReceipt.set_hash, "Explicit v1 manifest plus the base canonical SHA-256 primitive must reproduce the sealed set hash.");

    const partial = ids(2);
    const partialLease = await begin(a, partial, 2);
    await seed(a, partial, partialLease.lease_epoch, ["persisted", "failed"]);
    const partialReceipt = await finalize(a, partial, partialLease.lease_epoch);
    assert.equal(partialReceipt.state, "partial", "P=F is the inclusive 0.5 threshold.");
    assertTerminalProjection(await projection(a, partial), partialReceipt, "partial");

    const failed = ids(3);
    const failedLease = await begin(a, failed, 2);
    await seed(a, failed, failedLease.lease_epoch, ["persisted", "failed"]);
    await a.query(`delete from public.scan_result_set_rows where result_set_id='${failed.resultSet}' and work_index=0`);
    await a.query(`update public.scan_work_items set outcome='failed', row_hash=null where result_set_id='${failed.resultSet}' and work_index=0`);
    const failedPublicationBefore = publicationProjection((await projection(a, failed)).scan);
    const failedReceipt = await finalize(a, failed, failedLease.lease_epoch);
    assert.equal(failedReceipt.state, "failed");
    assertTerminalProjection(await projection(a, failed), failedReceipt, "failed", failedPublicationBefore);
    const failedReplayBefore = await projection(a, failed);
    assert.deepEqual(await finalize(a, failed, failedLease.lease_epoch), { ...failedReceipt, replayed: true }, "A failed terminal without a published pointer must replay exactly.");
    assert.deepEqual(await projection(a, failed), failedReplayBefore, "Pointer-null failed replay must not mutate its terminal projection.");
    await assert.rejects(() => a.query(`update public.scan_result_sets set state='staging' where id='${failed.resultSet}'`), /SE_RESULT_SET_IMMUTABLE/);
    await assert.rejects(() => a.query(`update public.scan_work_items set error='{"tamper":true}'::jsonb where result_set_id='${failed.resultSet}' and work_index=1`), /SE_RESULT_SET_IMMUTABLE/);

    const rowMismatch = ids(14);
    const rowMismatchLease = await begin(a, rowMismatch, 1);
    await seed(a, rowMismatch, rowMismatchLease.lease_epoch, ["persisted"]);
    await a.query(`delete from public.scan_result_set_rows where result_set_id='${rowMismatch.resultSet}' and work_index=0`);
    await assert.rejects(() => finalize(a, rowMismatch, rowMismatchLease.lease_epoch), /SE_LEDGER_ROW_MISMATCH/);

    const cancelled = ids(4);
    const cancelledLease = await begin(a, cancelled, 2);
    await seed(a, cancelled, cancelledLease.lease_epoch, ["persisted", "cancelled"]);
    const cancelledPublicationBefore = publicationProjection((await projection(a, cancelled)).scan);
    const cancelledReceipt = await finalize(a, cancelled, cancelledLease.lease_epoch);
    assert.equal(cancelledReceipt.state, "cancelled");
    assertTerminalProjection(await projection(a, cancelled), cancelledReceipt, "cancelled", cancelledPublicationBefore);

    const excluded = ids(5);
    const excludedLease = await begin(a, excluded, 2);
    await seed(a, excluded, excludedLease.lease_epoch, ["excluded", "excluded"]);
    const excludedPublicationBefore = publicationProjection((await projection(a, excluded)).scan);
    const excludedReceipt = await finalize(a, excluded, excludedLease.lease_epoch);
    assert.equal(excludedReceipt.state, "failed", "All-excluded has no completion denominator.");
    assertTerminalProjection(await projection(a, excluded), excludedReceipt, "failed", excludedPublicationBefore);

    await corruptRunningCheckpoint(a, ids(19), "failed", "'[]'::jsonb");
    await corruptRunningCheckpoint(a, ids(20), "cancelled", "'17'::jsonb");
    await corruptTerminalFixture(a, ids(21), "failed", "failed", "'{}'::jsonb");
    await corruptTerminalFixture(a, ids(22), "cancelled", "cancelled", "'null'::jsonb");
    await corruptTerminalReplayFixture(a, ids(23), { receiptPatch: { unexpected: true } });
    await corruptTerminalReplayFixture(a, ids(25), { executionValues: { completed_count: 0 } });
    await corruptTerminalReplayFixture(a, ids(26), { executionState: "cancelled" });
    await corruptTerminalReplayFixture(a, ids(27), {
      executionState: "published",
      receiptState: "complete",
      setState: "sealed",
      seedOutcome: "persisted",
      setValues: { row_count: 1 },
      executionValues: { persisted_count: 1, completed_count: 0, failed_count: 0 },
      receiptPatch: { persisted_count: 1, failed_count: 0, row_count: 1 },
      physicalMutation: (session, id) => session.query(`delete from public.scan_result_set_rows where result_set_id='${id.resultSet}' and work_index=0`),
    });
    await corruptTerminalReplayFixture(a, ids(28), {
      ownerId: "42",
      receiptPatch: { owner_id: 42 },
    });
    await corruptTerminalReplayFixture(a, ids(29), { residualActive: "execution" });
    await corruptTerminalReplayFixture(a, ids(30), { residualActive: "result_set" });
    await corruptTerminalReplayFixture(a, ids(31), {
      executionState: "published",
      receiptState: "complete",
      setState: "sealed",
      publishedPointer: false,
      seedOutcome: "persisted",
      setValues: { row_count: 1 },
      executionValues: { persisted_count: 1, completed_count: 0, failed_count: 0 },
      receiptPatch: { persisted_count: 1, failed_count: 0, row_count: 1 },
    });
    await corruptTerminalReplayFixture(a, ids(32), { omitFinalizingAt: true });
    await corruptTerminalReplayFixture(a, ids(34), { omitSetTimestamp: true });
    await corruptTerminalReplayFixture(a, ids(36), { scanLeaseEpoch: 0 });
    await corruptLegacyUnknownTerminalFixture(a, ids(37));
    await corruptTerminalReplayFixture(a, ids(43), {
      physicalMutation: (session, id) => session.query(`update public.scan_work_items set written_lease_epoch=null where result_set_id='${id.resultSet}' and work_index=0`),
    });
    await corruptTerminalReplayFixture(a, ids(44), {
      physicalMutation: (session, id, lease) => session.query(`update public.scan_work_items set written_lease_epoch=${lease.lease_epoch - 1} where result_set_id='${id.resultSet}' and work_index=0`),
    });
    await corruptTerminalReplayFixture(a, ids(45), {
      physicalMutation: (session, id, lease) => session.query(`update public.scan_work_items set written_lease_epoch=${lease.lease_epoch + 1} where result_set_id='${id.resultSet}' and work_index=0`),
    });

    const sameEpochPointer = ids(46);
    const sameEpochPointerLease = await begin(a, sameEpochPointer, 1);
    await seed(a, sameEpochPointer, sameEpochPointerLease.lease_epoch, ["persisted"]);
    await finalize(a, sameEpochPointer, sameEpochPointerLease.lease_epoch);
    const sameEpochFailed = { scan: sameEpochPointer.scan, execution: ids(47).execution, resultSet: ids(47).resultSet };
    await corruptTerminalReplayFixture(a, sameEpochFailed, {
      beginEpoch: sameEpochPointerLease.lease_epoch,
      terminalLeaseEpoch: sameEpochPointerLease.lease_epoch,
      terminalIssuedLeaseEpoch: sameEpochPointerLease.lease_epoch,
      scanLeaseEpoch: sameEpochPointerLease.lease_epoch,
      physicalMutation: (session, id, lease, effectiveLeaseEpoch) => session.query(`update public.scan_work_items set written_lease_epoch=${effectiveLeaseEpoch} where result_set_id='${id.resultSet}' and work_index=0`),
    });

    const lowerEpochFailed = ids(48);
    const lowerEpochLease = await begin(a, lowerEpochFailed, 1);
    await seed(a, lowerEpochFailed, lowerEpochLease.lease_epoch, ["failed"]);
    await finalize(a, lowerEpochFailed, lowerEpochLease.lease_epoch);
    const higherEpochPointer = { scan: lowerEpochFailed.scan, execution: ids(49).execution, resultSet: ids(49).resultSet };
    const higherEpochLease = await begin(a, higherEpochPointer, 1, lowerEpochLease.lease_epoch);
    await seed(a, higherEpochPointer, higherEpochLease.lease_epoch, ["persisted"]);
    await finalize(a, higherEpochPointer, higherEpochLease.lease_epoch);
    await a.query(`update public.scans set lease_epoch=${lowerEpochLease.lease_epoch} where id='${lowerEpochFailed.scan}'`);
    const lowerEpochBefore = await projection(a, lowerEpochFailed);
    const higherEpochBefore = await projection(a, higherEpochPointer);
    await assert.rejects(() => finalize(a, lowerEpochFailed, lowerEpochLease.lease_epoch), /SE_FENCED/);
    assert.deepEqual(await projection(a, lowerEpochFailed), lowerEpochBefore, "A pointer epoch above the durable scan epoch must fence the failed replay without mutation.");
    assert.deepEqual(await projection(a, higherEpochPointer), higherEpochBefore, "The higher-epoch published pointer must remain byte-for-byte unchanged.");

    const corruptSealedPointer = ids(50);
    const corruptSealedPointerEpoch = await corruptTerminalReplayFixture(a, corruptSealedPointer, {
      executionState: "published",
      receiptState: "complete",
      setState: "sealed",
      seedOutcome: "persisted",
      setValues: { row_count: 1 },
      executionValues: { persisted_count: 1, completed_count: 0, failed_count: 0 },
      receiptPatch: { persisted_count: 1, failed_count: 0, row_count: 1 },
      physicalMutation: (session, id) => session.query(`delete from public.scan_result_set_rows where result_set_id='${id.resultSet}' and work_index=0`),
    });
    const failedAgainstCorruptPointer = { scan: corruptSealedPointer.scan, execution: ids(51).execution, resultSet: ids(51).resultSet };
    const failedAgainstCorruptLease = await assertNonPublishableReplayFencedWithCorruptPointer(a, corruptSealedPointer, failedAgainstCorruptPointer, corruptSealedPointerEpoch.durableLeaseEpoch, "failed");
    const cancelledAgainstCorruptPointer = { scan: corruptSealedPointer.scan, execution: ids(52).execution, resultSet: ids(52).resultSet };
    await assertNonPublishableReplayFencedWithCorruptPointer(a, corruptSealedPointer, cancelledAgainstCorruptPointer, failedAgainstCorruptLease.lease_epoch, "cancelled");

    // A stale cache is repaired from physical ledger data, rather than being
    // treated as a finalization precondition.
    const mismatch = ids(6);
    const mismatchLease = await begin(a, mismatch, 1);
    await seed(a, mismatch, mismatchLease.lease_epoch, ["persisted"]);
    await a.query(`update public.scan_result_sets set ledger_count=0 where id='${mismatch.resultSet}'`);
    const repairedReceipt = await finalize(a, mismatch, mismatchLease.lease_epoch);
    assert.equal(repairedReceipt.ledger_count, 1);
    assert.equal((await projection(a, mismatch)).result_set.ledger_count, 1, "Finalization must repair stale cached ledger_count from physical rows.");
    const physicalMismatch = ids(16);
    const physicalMismatchLease = await begin(a, physicalMismatch, 2);
    await seed(a, physicalMismatch, physicalMismatchLease.lease_epoch, ["persisted", "failed"]);
    await a.query(`delete from public.scan_work_items where result_set_id='${physicalMismatch.resultSet}' and work_index=1`);
    const physicalBefore = await projection(a, physicalMismatch);
    await assert.rejects(() => finalize(a, physicalMismatch, physicalMismatchLease.lease_epoch), /SE_LEDGER_ROW_MISMATCH/);
    assert.deepEqual(await projection(a, physicalMismatch), physicalBefore, "A physical missing item/gap must fail closed without a partial finalization.");
    await assertLiveWrittenLeaseEpochFence(a, ids(40), () => null, "Null written epoch");
    await assertLiveWrittenLeaseEpochFence(a, ids(41), (lease) => lease.lease_epoch - 1, "Written epoch before issuance");
    await assertLiveWrittenLeaseEpochFence(a, ids(42), (lease) => lease.lease_epoch + 1, "Written epoch after execution epoch");

    const hashMismatch = ids(7);
    const hashLease = await begin(a, hashMismatch, 1);
    await seed(a, hashMismatch, hashLease.lease_epoch, ["persisted"]);
    await a.query(`update public.scan_work_items set payload_hash='bad' where result_set_id='${hashMismatch.resultSet}'`);
    await assert.rejects(() => finalize(a, hashMismatch, hashLease.lease_epoch), /SE_HASH_MISMATCH/);

    // A prior published pointer is physical old-or-new state. A later failed
    // or cancelled candidate cannot modify any of its publication fields.
    const replacement = { scan: complete.scan, execution: ids(9).execution, resultSet: ids(9).resultSet };
    const replacementLease = await begin(a, replacement, 1, completeLease.lease_epoch);
    await seed(a, replacement, replacementLease.lease_epoch, ["failed"]);
    const oldPointer = await projection(a, complete);
    const replacementReceipt = await finalize(a, replacement, replacementLease.lease_epoch);
    const publication = (value) => Object.fromEntries(["published_result_set_id", "published_state", "row_count", "published_at", "published_updated_at"].map((key) => [key, value.scan[key]]));
    assert.deepEqual(publication(await projection(a, complete)), publication(oldPointer), "Failed candidate must leave the previous publication byte-for-byte unchanged.");
    const replacementReplayBefore = await projection(a, replacement);
    assert.deepEqual(await finalize(a, replacement, replacementLease.lease_epoch), { ...replacementReceipt, replayed: true }, "A failed terminal with a retained pointer must replay exactly.");
    assert.deepEqual(await projection(a, replacement), replacementReplayBefore, "Retained publication replay must not mutate the failed terminal projection.");
    const cancelledReplacement = { scan: complete.scan, execution: ids(13).execution, resultSet: ids(13).resultSet };
    const cancelledReplacementLease = await begin(a, cancelledReplacement, 1, replacementLease.lease_epoch);
    await seed(a, cancelledReplacement, cancelledReplacementLease.lease_epoch, ["cancelled"]);
    const cancelledReplacementReceipt = await finalize(a, cancelledReplacement, cancelledReplacementLease.lease_epoch);
    assert.deepEqual(publication(await projection(a, complete)), publication(oldPointer), "Cancelled candidate must also preserve the previous publication byte-for-byte.");
    const cancelledReplayBefore = await projection(a, cancelledReplacement);
    assert.deepEqual(await finalize(a, cancelledReplacement, cancelledReplacementLease.lease_epoch), { ...cancelledReplacementReceipt, replayed: true }, "A cancelled terminal with a retained pointer must replay exactly.");
    assert.deepEqual(await projection(a, cancelledReplacement), cancelledReplayBefore, "Retained publication replay must not mutate the cancelled terminal projection.");

    // A terminal replay must tolerate a later active execution without
    // touching its fenced tuple, epoch, lease, publication pointer, or times.
    const replayTarget = { id: complete, epoch: completeLease.lease_epoch, ownerId: owner };
    const legacyActiveSuccessor = { scan: complete.scan, execution: ids(39).execution, resultSet: ids(39).resultSet };
    const legacyActiveLease = await createLegacyUnknownActiveSuccessor(a, legacyActiveSuccessor, cancelledReplacementLease.lease_epoch);
    await assertActiveSuccessorReplayFenced(
      a,
      legacyActiveSuccessor,
      replayTarget,
      async () => {},
      "A replay must fence an active successor whose integrity class is legacy_unknown",
    );
    await a.query(`update public.scans set active_execution_id=null, active_result_set_id=null, lease_until=null where id='${complete.scan}'`);
    const successor = { scan: complete.scan, execution: ids(33).execution, resultSet: ids(33).resultSet };
    const successorLease = await begin(a, successor, 1, legacyActiveLease.leaseEpoch);
    const restoreActiveSuccessor = () => a.query(`update public.scans set active_execution_id='${successor.execution}', active_result_set_id='${successor.resultSet}', lease_epoch=${successorLease.lease_epoch}, lease_until=(select lease_until from public.scan_executions where id='${successor.execution}') where id='${successor.scan}'`);
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scan_executions set policy_version='unsupported-policy-v0' where id='${successor.execution}'`),
      "A replay must fence an active successor with an unsupported policy version",
    );
    await a.query(`update public.scan_executions set policy_version='statsedge-scan-execution-v1' where id='${successor.execution}'`);
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scan_executions set hash_version='unsupported-hash-v0' where id='${successor.execution}'`),
      "A replay must fence an active successor with an unsupported execution hash version",
    );
    await a.query(`update public.scan_executions set hash_version='statsedge-pg-jsonb-sha256-v1' where id='${successor.execution}'`);
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scan_result_sets set hash_version='unsupported-hash-v0' where id='${successor.resultSet}'`),
      "A replay must fence an active successor with an unsupported result-set hash version",
    );
    await a.query(`update public.scan_result_sets set hash_version='statsedge-pg-jsonb-sha256-v1' where id='${successor.resultSet}'`);
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scan_executions set issued_lease_epoch=null where id='${successor.execution}'`),
      "A replay must fence an active successor with no issued lease epoch",
    );
    await a.query(`update public.scan_executions set issued_lease_epoch=lease_epoch where id='${successor.execution}'`);
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scan_executions set issued_lease_until=null where id='${successor.execution}'`),
      "A replay must fence an active successor with no issued lease deadline",
    );
    await a.query(`update public.scan_executions set issued_lease_until=lease_until where id='${successor.execution}'`);
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scan_executions set issued_lease_epoch=lease_epoch + 1 where id='${successor.execution}'`),
      "A replay must fence an active successor whose issued epoch exceeds its lease epoch",
    );
    await a.query(`update public.scan_executions set issued_lease_epoch=lease_epoch where id='${successor.execution}'`);
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scans set active_result_set_id=null where id='${successor.scan}'`),
      "A replay must fence an active successor with an unlinked result-set ID",
    );
    await restoreActiveSuccessor();
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scans set lease_until=lease_until + interval '1 millisecond' where id='${successor.scan}'`),
      "A replay must fence an active successor with a divergent lease",
    );
    await restoreActiveSuccessor();
    await assertActiveSuccessorReplayFenced(
      a,
      successor,
      replayTarget,
      () => a.query(`update public.scans set lease_epoch=${completeLease.lease_epoch} where id='${successor.scan}'`),
      "A replay must fence an active successor whose durable epoch regresses",
    );
    await restoreActiveSuccessor();
    const completeBeforeActiveReplay = await projection(a, complete);
    const successorActiveBefore = await projection(a, successor);
    assert.deepEqual(await finalize(a, complete, completeLease.lease_epoch), { ...completeReceipt, replayed: true });
    assert.deepEqual(await projection(a, complete), completeBeforeActiveReplay, "Replaying A cannot mutate A while B is active.");
    assert.deepEqual(await projection(a, successor), successorActiveBefore, "Replaying A cannot mutate the active B projection.");
    await seed(a, successor, successorLease.lease_epoch, ["persisted"]);
    await finalize(a, successor, successorLease.lease_epoch);
    const completeBeforePublishedReplay = await projection(a, complete);
    const successorPublishedBefore = await projection(a, successor);
    assert.deepEqual(await finalize(a, complete, completeLease.lease_epoch), { ...completeReceipt, replayed: true });
    assert.deepEqual(await projection(a, complete), completeBeforePublishedReplay, "Replaying A cannot mutate A after B publishes.");
    assert.deepEqual(await projection(a, successor), successorPublishedBefore, "Replaying A must also preserve a demonstrably later published B projection.");
    const corruptSuccessor = { scan: complete.scan, execution: ids(35).execution, resultSet: ids(35).resultSet };
    const corruptSuccessorEpoch = await corruptTerminalReplayFixture(a, corruptSuccessor, {
      beginEpoch: successorLease.lease_epoch,
      replayTarget: { id: complete, epoch: completeLease.lease_epoch, ownerId: owner },
      executionState: "published",
      receiptState: "complete",
      setState: "sealed",
      seedOutcome: "persisted",
      setValues: { row_count: 1 },
      executionValues: { persisted_count: 1, completed_count: 0, failed_count: 0 },
      receiptPatch: { persisted_count: 1, failed_count: 0, row_count: 1 },
      physicalMutation: (session, id) => session.query(`delete from public.scan_result_set_rows where result_set_id='${id.resultSet}' and work_index=0`),
    });
    const durableEpochBeforeRegressedPointer = (await projection(a, complete)).scan.lease_epoch;
    assert.equal(durableEpochBeforeRegressedPointer, corruptSuccessorEpoch.durableLeaseEpoch, "The next terminal fixture must start from the persisted successor epoch.");
    const regressedPointer = { scan: complete.scan, execution: ids(38).execution, resultSet: ids(38).resultSet };
    await corruptTerminalReplayFixture(a, regressedPointer, {
      beginEpoch: corruptSuccessorEpoch.durableLeaseEpoch,
      replayTarget,
      executionState: "published",
      receiptState: "complete",
      setState: "sealed",
      seedOutcome: "persisted",
      setValues: { row_count: 1 },
      executionValues: { persisted_count: 1, completed_count: 0, failed_count: 0 },
      receiptPatch: { persisted_count: 1, failed_count: 0, row_count: 1 },
      scanLeaseEpoch: completeLease.lease_epoch,
    });

    const immutable = ids(10);
    const immutableLease = await begin(a, immutable, 1);
    await seed(a, immutable, immutableLease.lease_epoch, ["persisted"]);
    await finalize(a, immutable, immutableLease.lease_epoch);
    await assert.rejects(() => a.query(`update public.scan_result_sets set row_count=0 where id='${immutable.resultSet}'`), /SE_RESULT_SET_IMMUTABLE|SE_PUBLISHED_RESULT_SET_STATE_LOCKED/);
    await assert.rejects(() => a.query(`update public.scan_result_sets set state='abandoned' where id='${immutable.resultSet}'`), /SE_RESULT_SET_IMMUTABLE|SE_PUBLISHED_RESULT_SET_STATE_LOCKED/);
    const moveTarget = ids(15);
    await begin(a, moveTarget, 1);
    await assert.rejects(
      () => a.query(`update public.scan_result_set_rows set result_set_id='${moveTarget.resultSet}', scan_id='${moveTarget.scan}' where result_set_id='${immutable.resultSet}' and work_index=0`),
      /SE_RESULT_SET_IMMUTABLE/,
      "A child cannot escape a sealed parent by moving to staging.",
    );

    const fault = ids(11);
    const faultLease = await begin(a, fault, 1);
    await seed(a, fault, faultLease.lease_epoch, ["persisted"]);
    const faultBefore = await projection(a, fault);
    await a.query("create function public.hito_1b2_finalize_fault() returns trigger language plpgsql as $$ begin return null; end $$");
    await a.query("create trigger hito_1b2_finalize_fault_trg before update on public.scans for each row execute function public.hito_1b2_finalize_fault()");
    await assert.rejects(() => finalize(a, fault, faultLease.lease_epoch), /SE_FENCED/);
    await a.query("drop trigger hito_1b2_finalize_fault_trg on public.scans");
    await a.query("drop function public.hito_1b2_finalize_fault()");
    assert.deepEqual(await projection(a, fault), faultBefore, "A technical fault cannot commit finalizing or partial publication state.");

    const race = ids(12);
    const raceLease = await begin(a, race, 1);
    await seed(a, race, raceLease.lease_epoch, ["persisted"]);
    const readerBefore = await projection(a, race);
    // This trigger runs after finalize has acquired the result-set advisory
    // lock and before the terminal writes. It creates a real overlap window.
    // The observer holds this gate before starting the winner. The trigger
    // blocks on the same advisory key, so release is an explicit observed
    // handshake rather than a duration-based server-side sleep.
    await reader.query("select pg_advisory_lock(9187001, 12001)");
    await a.query("create function public.hito_1b2_finalize_pause() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(9187001, 12001); return new; end $$");
    await a.query("create trigger hito_1b2_finalize_pause_trg before update on public.scan_result_sets for each row execute function public.hito_1b2_finalize_pause()");
    const winnerPid = Number((await a.query("select pg_backend_pid()")).stdout);
    const finalizeA = finalize(a, race, raceLease.lease_epoch);
    const barrier = await waitForFinalizeBarrier(reader, winnerPid);
    assert.deepEqual(barrier, { pid: winnerPid, advisory_lock: true, active_finalize: true, gate_waiting: true });
    const readerDuringPause = await projection(reader, race);
    const [finalizeB, persistDuringPause, completeDuringPause, abandonDuringPause] = await Promise.allSettled([
      finalize(finalizeLoser, race, raceLease.lease_epoch),
      rpc(persistLoser, "persist_scan_result", `'${owner}','${race.scan}','${race.execution}','${race.resultSet}',${raceLease.lease_epoch},0,'{"symbol":"S0","result":0}'::jsonb`),
      rpc(completeLoser, "complete_scan_work_item", `'${owner}','${race.scan}','${race.execution}','${race.resultSet}',${raceLease.lease_epoch},0,'failed','{"reason":"race"}'::jsonb`),
      rpc(abandonLoser, "abandon_scan_execution", `'${owner}','${race.scan}','${race.execution}','${race.resultSet}',${raceLease.lease_epoch},'{"reason":"race"}'::jsonb`),
    ]);
    assertBusy(finalizeB, "concurrent finalize");
    assertBusy(persistDuringPause, "persist during finalize");
    assertBusy(completeDuringPause, "complete during finalize");
    assertBusy(abandonDuringPause, "abandon during finalize");
    await reader.query("select pg_advisory_unlock(9187001, 12001)");
    const raceA = await finalizeA;
    await a.query("drop trigger hito_1b2_finalize_pause_trg on public.scan_result_sets");
    await a.query("drop function public.hito_1b2_finalize_pause()");
    const raceB = await finalize(finalizeLoser, race, raceLease.lease_epoch);
    assert.deepEqual(new Set([raceA.replayed, raceB.replayed]), new Set([false, true]), "Retry after release must return the immutable terminal receipt.");
    const winnerProjection = await projection(a, race);
    const readerAfter = await projection(reader, race);
    assert.deepEqual(readerDuringPause, readerBefore, "Independent reader must see the complete old committed projection during the pause.");
    assert.deepEqual(readerAfter, winnerProjection, "After commit, the independent reader must observe the complete exclusive-winner projection.");
    assert.ok(readerBefore.scan.published_result_set_id === null && readerAfter.scan.published_result_set_id === race.resultSet, "Reader observes either the old null pointer or the fully sealed new pointer.");
    assert.deepEqual(readerAfter.execution.checkpoint.finalization_receipt, raceA, "Winner receipt must be stored verbatim in the terminal checkpoint.");
    assert.deepEqual({ state: readerAfter.result_set.state, set_hash: readerAfter.result_set.set_hash, ledger_count: readerAfter.result_set.ledger_count, row_count: readerAfter.result_set.row_count }, { state: "sealed", set_hash: raceA.set_hash, ledger_count: raceA.ledger_count, row_count: raceA.row_count }, "Winner projection must agree with the immutable receipt.");

    const catalog = JSON.parse((await a.query(`select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'),'prosecdef',p.prosecdef,'search_path',coalesce(array_to_string(p.proconfig,','),'')) order by p.oid::regprocedure::text)::text from pg_proc p where p.oid::regprocedure::text = any(array['finalize_scan_execution(text,uuid,uuid,uuid,bigint)','statsedge_finalization_manifest_v1(text,uuid,uuid,uuid,text,text,bigint,bigint,jsonb,jsonb)','statsedge_finalization_set_hash_v1(jsonb)','statsedge_assert_terminal_replay_evidence_v1(text,uuid,uuid)'])`)).stdout);
    assert.equal(catalog.length, 4);
    for (const fn of catalog) {
      assert.deepEqual({ anon: fn.anon, authenticated: fn.authenticated, service_role: fn.service_role, prosecdef: fn.prosecdef }, { anon: false, authenticated: false, service_role: false, prosecdef: false });
      assert.match(fn.search_path, /search_path=pg_catalog, public/);
    }
  } finally {
    a.close();
    finalizeLoser.close();
    persistLoser.close();
    completeLoser.close();
    abandonLoser.close();
    reader.close();
  }
});
