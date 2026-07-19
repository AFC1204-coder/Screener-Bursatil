import assert from "node:assert/strict";
import test from "node:test";
import { applyExecutionLifecycle, callRpc, openPersistentPsqlSession, requireEphemeralPostgresUrl } from "./_ephemeralPostgresHarness.mjs";

const owner = "hito-1b-owner";
const scan = "00000000-0000-0000-0000-000000001b01";
const execution = "00000000-0000-0000-0000-000000001b02";
const resultSet = "00000000-0000-0000-0000-000000001b03";
const previousExecution = "00000000-0000-0000-0000-000000001b04";
const previousResultSet = "00000000-0000-0000-0000-000000001b05";

async function rpc(session, name, args) {
  return JSON.parse((await callRpc(session, name, args)).stdout).result;
}

async function integritySnapshot(session) {
  return JSON.parse((await session.query(`
    select jsonb_build_object(
      'scan', (select to_jsonb(s) from public.scans s where s.id='${scan}'),
      'execution', (select to_jsonb(e) from public.scan_executions e where e.id='${execution}'),
      'result_set', (select to_jsonb(rs) from public.scan_result_sets rs where rs.id='${resultSet}'),
      'ledger', coalesce((select jsonb_agg(to_jsonb(w) order by w.work_index) from public.scan_work_items w where w.result_set_id='${resultSet}'), '[]'::jsonb),
      'result_rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.work_index) from public.scan_result_set_rows r where r.result_set_id='${resultSet}'), '[]'::jsonb),
      'legacy_result_rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.scan_results r where r.scan_id='${scan}'), '[]'::jsonb)
    )::text;
  `)).stdout);
}

async function expectRejectedWithoutMutation(session, action, pattern) {
  const before = await integritySnapshot(session);
  await assert.rejects(action, pattern);
  assert.deepEqual(await integritySnapshot(session), before, "Injected failure changed checkpoint, counters, ledger, rows, lease, or pointers.");
}

async function assertPending(promise, label) {
  const outcome = await Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 30)),
  ]);
  assert.equal(outcome, "pending", `${label} must remain blocked while the competing session owns the scan lock.`);
}

async function holdScanLock(session) {
  await session.query("begin");
  await session.query(`select id from public.scans where id='${scan}' for update`);
}

const aclFunctions = Object.freeze([
  "statsedge_execution_identity_key_v1(jsonb)",
  "statsedge_assert_execution_lease_v1(text,uuid,uuid,uuid,bigint)",
  "begin_scan_execution(text,uuid,uuid,uuid,bigint,text,jsonb,jsonb,integer)",
  "resume_scan_execution(text,uuid,uuid,uuid,bigint,integer)",
  "takeover_scan_execution(text,uuid,uuid,uuid,bigint,integer)",
  "register_scan_work_item(text,uuid,uuid,uuid,bigint,integer,jsonb)",
  "persist_scan_result(text,uuid,uuid,uuid,bigint,integer,jsonb)",
  "complete_scan_work_item(text,uuid,uuid,uuid,bigint,integer,text,jsonb)",
  "checkpoint_scan_execution(text,uuid,uuid,uuid,bigint,jsonb)",
  "abandon_scan_execution(text,uuid,uuid,uuid,bigint,jsonb)",
]);

test("real PostgreSQL: Hito 1B-1 races use two persistent sessions and leave one fenced winner with exact rollback", async () => {
  const url = requireEphemeralPostgresUrl("scan-execution-lifecycle");
  applyExecutionLifecycle(url);
  const connectionA = openPersistentPsqlSession(url, "lease_A");
  const connectionB = openPersistentPsqlSession(url, "lease_B");
  try {
    assert.deepEqual(await connectionA.query("begin"), {
      stdout: "",
      stderr: "",
      exitCode: null,
      marker: "__STATSEDGE_lease_A_1__",
      session: { label: "lease_A", sequence: 1 },
      error: false,
      sqlstate: "00000",
    }, "BEGIN must return the complete persistent-session result envelope.");
    assert.deepEqual(await connectionA.query("select 'persistent-session'"), {
      stdout: "persistent-session",
      stderr: "",
      exitCode: null,
      marker: "__STATSEDGE_lease_A_2__",
      session: { label: "lease_A", sequence: 2 },
      error: false,
      sqlstate: "00000",
    }, "SELECT must return the complete persistent-session result envelope.");
    assert.deepEqual(await connectionA.query("rollback"), {
      stdout: "",
      stderr: "",
      exitCode: null,
      marker: "__STATSEDGE_lease_A_3__",
      session: { label: "lease_A", sequence: 3 },
      error: false,
      sqlstate: "00000",
    }, "ROLLBACK must return the complete persistent-session result envelope.");

    await connectionA.query(`insert into public.scans(id,owner_id,local_id,name) values('${scan}','${owner}','hito-1b','Hito 1B')`);
    const started = await rpc(connectionA, "begin_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',0,'idem-1','{"expectedCount":3}'::jsonb,'{}'::jsonb,60`);
    assert.equal(started.lease_epoch, 1);
    assert.equal(started.replayed, false);

    // Takeover race: A holds the scan lock, B begins the takeover, then A is
    // deliberately released. B alone may advance the fencing epoch.
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
    await holdScanLock(connectionA);
    const takeover = rpc(connectionB, "takeover_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',1,60`);
    await assertPending(takeover, "takeover");
    await connectionA.query("commit");
    assert.equal((await takeover).lease_epoch, 2);
    assert.deepEqual(
      JSON.parse((await connectionA.query(`select jsonb_build_object('scan_epoch', s.lease_epoch, 'execution_epoch', e.lease_epoch, 'active_execution_id', s.active_execution_id, 'active_result_set_id', s.active_result_set_id)::text from public.scans s join public.scan_executions e on e.id='${execution}' where s.id='${scan}'`)).stdout),
      { scan_epoch: 2, execution_epoch: 2, active_execution_id: execution, active_result_set_id: resultSet },
    );

    const replayBefore = await integritySnapshot(connectionA);
    const replay = await rpc(connectionB, "begin_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',0,'idem-1','{"expectedCount":3}'::jsonb,'{}'::jsonb,60`);
    assert.deepEqual(replay, {
      execution_id: execution,
      result_set_id: resultSet,
      lease_epoch: 1,
      lease_until: replayBefore.execution.issued_lease_until,
      replayed: true,
    });
    assert.deepEqual(await integritySnapshot(connectionA), replayBefore, "Exact begin replay after takeover must not issue a fresh epoch or mutate state.");

    await expectRejectedWithoutMutation(
      connectionA,
      () => rpc(connectionA, "begin_scan_execution", `'${owner}','${scan}','00000000-0000-0000-0000-000000001b06','00000000-0000-0000-0000-000000001b07',0,'idem-1','{"expectedCount":3}'::jsonb,'{}'::jsonb,60`),
      /SE_IDEMPOTENCY_CONFLICT/,
    );

    // Registration race with an exact replay and a payload conflict after the
    // blocked session becomes the sole winner.
    await holdScanLock(connectionA);
    const registered = rpc(connectionB, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":1}'::jsonb`);
    await assertPending(registered, "work-item registration");
    await connectionA.query("commit");
    assert.equal((await registered).idempotent, false);
    assert.equal((await rpc(connectionA, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":1}'::jsonb`)).idempotent, true);
    await expectRejectedWithoutMutation(
      connectionB,
      () => rpc(connectionB, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":2}'::jsonb`),
      /SE_IDEMPOTENCY_CONFLICT/,
    );

    // Persistence has the same overlapping-session contract: one write, an
    // exact replay, and a rejected conflicting replay with no partial row.
    await holdScanLock(connectionA);
    const persisted = rpc(connectionB, "persist_scan_result", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":1}'::jsonb`);
    await assertPending(persisted, "result persistence");
    await connectionA.query("commit");
    assert.equal((await persisted).idempotent, false);
    assert.equal((await rpc(connectionA, "persist_scan_result", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":1}'::jsonb`)).idempotent, true);
    await expectRejectedWithoutMutation(
      connectionB,
      () => rpc(connectionB, "persist_scan_result", `'${owner}','${scan}','${execution}','${resultSet}',2,0,'{"symbol":"AAA","input":9}'::jsonb`),
      /SE_IDEMPOTENCY_CONFLICT/,
    );

    await rpc(connectionA, "register_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,1,'{"symbol":"BBB"}'::jsonb`);
    await expectRejectedWithoutMutation(
      connectionB,
      () => rpc(connectionB, "complete_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,1,NULL,'{"reason":"provider"}'::jsonb`),
      /SE_INVALID_STATE/,
    );
    await rpc(connectionA, "complete_scan_work_item", `'${owner}','${scan}','${execution}','${resultSet}',2,1,'failed','{"reason":"provider"}'::jsonb`);
    const checkpoint = await rpc(connectionB, "checkpoint_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',2,'{"cursor":2}'::jsonb`);
    assert.deepEqual([checkpoint.registered_count, checkpoint.persisted_count, checkpoint.failed_count, checkpoint.row_count], [2, 1, 1, 1]);
    assert.equal(
      JSON.parse((await connectionA.query(`select row_count::text from public.scan_result_sets where id='${resultSet}'`)).stdout),
      0,
      "Checkpoint returns the derived row count but must not persist scan_result_sets.row_count.",
    );

    await expectRejectedWithoutMutation(
      connectionA,
      () => connectionA.query(`update public.scans set published_result_set_id='${resultSet}' where id='${scan}'`),
      /SE_INVALID_PUBLISHED_POINTER/,
    );

    await connectionB.query("begin");
    await connectionB.query(`insert into public.scan_executions(id,owner_id,scan_id,expected_count,checkpoint) values('${previousExecution}','${owner}','${scan}',1,'{"cursor":0}'::jsonb)`);
    await connectionB.query(`insert into public.scan_result_sets(id,owner_id,scan_id,execution_id,expected_count,state) values('${previousResultSet}','${owner}','${scan}','${previousExecution}',1,'sealed')`);
    await connectionB.query(`update public.scan_executions set result_set_id='${previousResultSet}' where id='${previousExecution}'`);
    await connectionB.query(`update public.scans set published_result_set_id='${previousResultSet}' where id='${scan}'`);
    await connectionB.query("commit");

    // The inverse barrier makes the pointer invariant permanent, including
    // both transitions that would make a published artifact non-sealed.
    const pointerSnapshot = await integritySnapshot(connectionA);
    await assert.rejects(() => connectionA.query(`update public.scan_result_sets set state='staging' where id='${previousResultSet}'`), /SE_PUBLISHED_RESULT_SET_STATE_LOCKED/);
    assert.deepEqual(await integritySnapshot(connectionA), pointerSnapshot);
    await assert.rejects(() => connectionA.query(`update public.scan_result_sets set state='abandoned' where id='${previousResultSet}'`), /SE_PUBLISHED_RESULT_SET_STATE_LOCKED/);
    assert.deepEqual(await integritySnapshot(connectionA), pointerSnapshot);

    await connectionA.query(`create function public.hito_1b_zero_update() returns trigger language plpgsql as $$ begin return null; end $$`);
    await connectionA.query(`create trigger hito_1b_zero_update_trg before update on public.scan_result_sets for each row execute function public.hito_1b_zero_update()`);
    await expectRejectedWithoutMutation(
      connectionB,
      () => rpc(connectionB, "checkpoint_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',2,'{"cursor":2}'::jsonb`),
      /SE_FENCED/,
    );
    await connectionA.query(`drop trigger hito_1b_zero_update_trg on public.scan_result_sets`);
    await connectionA.query(`drop function public.hito_1b_zero_update()`);

    await rpc(connectionB, "abandon_scan_execution", `'${owner}','${scan}','${execution}','${resultSet}',2,'{"reason":"operator"}'::jsonb`);
    assert.deepEqual(
      JSON.parse((await connectionA.query(`select jsonb_build_object('scan', jsonb_build_object('active_execution_id', s.active_execution_id, 'active_result_set_id', s.active_result_set_id, 'published_result_set_id', s.published_result_set_id, 'lease_epoch', s.lease_epoch), 'execution', jsonb_build_object('state', e.state, 'lease_epoch', e.lease_epoch, 'registered_count', e.registered_count, 'persisted_count', e.persisted_count, 'failed_count', e.failed_count), 'result_set', jsonb_build_object('state', rs.state, 'ledger_count', rs.ledger_count, 'row_count', rs.row_count), 'ledger_count', (select count(*) from public.scan_work_items where result_set_id='${resultSet}'), 'result_row_count', (select count(*) from public.scan_result_set_rows where result_set_id='${resultSet}'), 'legacy_result_row_count', (select count(*) from public.scan_results where scan_id='${scan}'))::text from public.scans s join public.scan_executions e on e.id='${execution}' join public.scan_result_sets rs on rs.id='${resultSet}' where s.id='${scan}'`)).stdout),
      { scan: { active_execution_id: null, active_result_set_id: null, published_result_set_id: previousResultSet, lease_epoch: 2 }, execution: { state: "abandoned", lease_epoch: 2, registered_count: 2, persisted_count: 1, failed_count: 1 }, result_set: { state: "abandoned", ledger_count: 2, row_count: 0 }, ledger_count: 2, result_row_count: 1, legacy_result_row_count: 0 },
    );

    const acl = JSON.parse((await connectionA.query(`
      select jsonb_agg(jsonb_build_object(
        'identity', p.oid::regprocedure::text,
        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
        'public_execute_acl', exists(
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
      ) order by p.oid::regprocedure::text)::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.oid::regprocedure::text = any(array[${aclFunctions.map((identity) => `'${identity}'`).join(",")}]);
    `)).stdout);
    assert.equal(acl.length, aclFunctions.length, "ACL matrix must contain the ten exact Hito 1B-1 function identities.");
    assert.deepEqual(acl.map((row) => row.identity), [...aclFunctions].sort());
    for (const row of acl) {
      assert.equal(row.anon, false, `${row.identity}: anon must not have EXECUTE.`);
      assert.equal(row.authenticated, false, `${row.identity}: authenticated must not have EXECUTE.`);
      assert.equal(row.service_role, false, `${row.identity}: service_role must not have EXECUTE.`);
      assert.equal(row.public_execute_acl, false, `${row.identity}: PUBLIC must not have EXECUTE in proacl.`);
    }
  } finally {
    connectionA.close();
    connectionB.close();
  }
});
