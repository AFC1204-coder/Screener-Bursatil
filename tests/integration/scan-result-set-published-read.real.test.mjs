import assert from "node:assert/strict"; import test from "node:test"; import {
  applyExecutionLifecycle,
  callRpc,
  openPersistentPsqlSession,
  requireEphemeralPostgresUrl,
} from "./_ephemeralPostgresHarness.mjs";

// AMBIGUO: applyExecutionLifecycle (harness en commit 3ab49df) solo aplica las
// migraciones hasta Hito 1B-2. La version auditada perdida tuvo que extender el
// harness para aplicar tambien 20260720100000_published_scan_result_read.sql;
// ese cambio de harness no es visible desde el material recuperado y debe
// reconstruirse aparte, o este test fallara al no existir el lector.

const owner = "hito-1b3-published-read-owner";

function ids(n) {
  const suffix = String(n).padStart(10, "0");
  return {
    scan: `00000000-0000-0000-0000-e1${suffix}`,
    execution: `00000000-0000-0000-0000-e2${suffix}`,
    resultSet: `00000000-0000-0000-0000-e3${suffix}`,
  };
}

async function rpc(session, name, args) {
  return JSON.parse((await callRpc(session, name, args)).stdout).result;
}

// Desviacion documentada respecto a la version recuperada: "on conflict do
// nothing" en el insert de scans. La version recuperada re-insertaba el mismo
// scan al publicar un reemplazo (fixture `replacement`), lo que viola la PK en
// una ejecucion real; la auditoria fue estatica y no lo detecto. Sin esta
// correccion ni el fixture de reemplazo ni la carrera A/B (Correccion 4)
// pueden ejecutarse. `symbolPrefix` se anade para que las filas de dos
// publicaciones sucesivas del mismo scan sean distinguibles y una mezcla A/B
// sea detectable por contenido, no solo por cardinalidad.
async function seedPublished(session, id, outcomes, { ownerId = owner, idempotencySuffix = id.execution, symbolPrefix = "READ" } = {}) {
  await session.query(`insert into public.scans(id,owner_id,local_id,name) values('${id.scan}','${ownerId}','read-${id.scan.slice(-4)}','Published reader') on conflict do nothing`);
  const currentEpoch = JSON.parse((await session.query(`select jsonb_build_object('lease_epoch', lease_epoch)::text from public.scans where id='${id.scan}';`)).stdout).lease_epoch;
  const lease = await rpc(session, "begin_scan_execution", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${currentEpoch},'reader-${idempotencySuffix}','{"expectedCount":${outcomes.length}}'::jsonb,'{}'::jsonb,60`);
  for (let index = 0; index < outcomes.length; index += 1) {
    const symbol = `${symbolPrefix}${index}`;
    await rpc(session, "register_scan_work_item", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${lease.lease_epoch},${index},'{"symbol":"${symbol}","input":${index}}'::jsonb`);
    if (outcomes[index] === "persisted") {
      await rpc(session, "persist_scan_result", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${lease.lease_epoch},${index},'{"symbol":"${symbol}","result":${index}}'::jsonb`);
    } else {
      await rpc(session, "complete_scan_work_item", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${lease.lease_epoch},${index},'${outcomes[index]}','{"reason":"fixture"}'::jsonb`);
    }
  }
  await rpc(session, "finalize_scan_execution", `'${ownerId}','${id.scan}','${id.execution}','${id.resultSet}',${lease.lease_epoch}`);
  return lease;
}

async function beginStaging(session, id, expectedCount = 1) {
  const currentEpoch = JSON.parse((await session.query(`select jsonb_build_object('lease_epoch', lease_epoch)::text from public.scans where id='${id.scan}';`)).stdout).lease_epoch;
  return rpc(session, "begin_scan_execution", `'${owner}','${id.scan}','${id.execution}','${id.resultSet}',${currentEpoch},'reader-staging-${id.execution}','{"expectedCount":${expectedCount}}'::jsonb,'{}'::jsonb,60`);
}

async function read(session, scanId, { expectedResultSetId = null, expectedSetHash = null, afterWorkIndex = -1, limit = 50, ownerId = owner } = {}) {
  return rpc(session, "read_published_scan_result_set_v1", `'${ownerId}','${scanId}',${expectedResultSetId ? `'${expectedResultSetId}'` : "null"},${expectedSetHash ? `'${expectedSetHash}'` : "null"},${afterWorkIndex},${limit}`);
}

test("real PostgreSQL: Hito 1B-3 published reader matrix is DB-owned, fail-closed, and page-stable", async (t) => {
  const url = requireEphemeralPostgresUrl("scan-result-set-published-read");
  applyExecutionLifecycle(url);
  const session = openPersistentPsqlSession(url, "published-reader");
  t.after(() => session.close());

  const catalog = JSON.parse((await session.query(`
    select jsonb_build_object(
      'definition', pg_get_functiondef('public.read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)'::regprocedure),
      'comment', obj_description('public.read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)'::regprocedure, 'pg_proc'),
      'public_execute', has_function_privilege('public', 'public.read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)', 'execute'),
      'anon_execute', has_function_privilege('anon', 'public.read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)', 'execute'),
      'authenticated_execute', has_function_privilege('authenticated', 'public.read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)', 'execute'),
      'service_role_execute', has_function_privilege('service_role', 'public.read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)', 'execute')
    )::text;
  `)).stdout);
  assert.match(catalog.definition, /stable\s+security definer\s+set search_path to 'pg_catalog', 'public'/iu);
  assert.match(catalog.comment, /canonical DB-owned read/iu);
  assert.equal(catalog.public_execute, false);
  assert.equal(catalog.anon_execute, false);
  assert.equal(catalog.authenticated_execute, false);
  assert.equal(catalog.service_role_execute, true);

  // Diseno SECURITY DEFINER (2026-07-23): el contrato absoluto de 1B-1/1B-2
  // se mantiene — los helpers internos (canonical/sha256/identity, manifiesto
  // y set-hash de 1B-2) no son ejecutables por NINGUN rol de API,
  // service_role incluido. El cuerpo del lector corre como su owner, asi que
  // service_role solo tiene EXECUTE sobre las dos funciones propias de 1B-3
  // (lector y helper de error).
  const transitiveAcl = JSON.parse((await session.query(`
    select jsonb_object_agg(fn.name, jsonb_build_object(
      'public', has_function_privilege('public', fn.identity, 'execute'),
      'anon', has_function_privilege('anon', fn.identity, 'execute'),
      'authenticated', has_function_privilege('authenticated', fn.identity, 'execute'),
      'service_role', has_function_privilege('service_role', fn.identity, 'execute')
    ))::text
    from (values
      ('canonical', 'public.statsedge_pg_jsonb_canonical_v1(jsonb)'),
      ('sha256', 'public.statsedge_pg_jsonb_sha256_v1(jsonb)'),
      ('identity_key', 'public.statsedge_execution_identity_key_v1(jsonb)'),
      ('manifest', 'public.statsedge_finalization_manifest_v1(text,uuid,uuid,uuid,text,text,bigint,bigint,jsonb,jsonb)'),
      ('set_hash', 'public.statsedge_finalization_set_hash_v1(jsonb)'),
      ('read_fail', 'public.statsedge_published_result_read_fail_v1(text)'),
      ('reader', 'public.read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)')
    ) as fn(name, identity);
  `)).stdout);
  const serviceRoleExecutable = new Set(["read_fail", "reader"]);
  for (const [helperName, acl] of Object.entries(transitiveAcl)) {
    assert.deepEqual(
      acl,
      { public: false, anon: false, authenticated: false, service_role: serviceRoleExecutable.has(helperName) },
      `transitive ACL for ${helperName}`,
    );
  }

  const unknown = await read(session, ids(1).scan);
  assert.deepEqual({ state: unknown.state, rows: unknown.rows }, { state: "not_found", rows: [] });
  const unpublished = ids(2);
  await session.query(`insert into public.scans(id,owner_id,local_id,name) values('${unpublished.scan}','${owner}','read-unpublished','Unpublished')`);
  assert.deepEqual((await read(session, unpublished.scan)).state, "unpublished");
  assert.deepEqual((await read(session, unpublished.scan, { ownerId: "other-owner" })).state, "not_found");

  const complete = ids(3);
  await seedPublished(session, complete, ["persisted", "persisted", "persisted"]);
  const completeFirst = await read(session, complete.scan, { limit: 2 });
  assert.equal(completeFirst.state, "published");
  assert.deepEqual(completeFirst.rows.map((row) => row.work_index), [0, 1]);
  assert.deepEqual(completeFirst.rows.map((row) => row.rank_index), [1, 2]);
  assert.equal(completeFirst.has_more, true);
  assert.deepEqual(Object.keys(completeFirst.next_cursor).sort(), ["after_work_index", "result_set_id", "set_hash"]);
  assert.deepEqual(completeFirst.rows.map((row) => row.payload.symbol), ["READ0", "READ1"]);

  const pageTwo = await read(session, complete.scan, {
    expectedResultSetId: completeFirst.result_set_id,
    expectedSetHash: completeFirst.set_hash,
    afterWorkIndex: completeFirst.next_cursor.after_work_index,
    limit: 2,
  });
  assert.deepEqual(pageTwo.rows.map((row) => row.work_index), [2]);
  assert.equal(pageTwo.has_more, false);

  // Correccion 2: llamada REAL como service_role (no solo catalogo). Debe
  // atravesar toda la cadena transitiva (canonical/sha256/identity/manifiesto/
  // set-hash) y devolver el mismo envelope que el superusuario. anon y
  // authenticated quedan rechazados de verdad al invocar.
  await session.query("set role service_role");
  const serviceRoleRead = await read(session, complete.scan, { limit: 2 });
  await session.query("reset role");
  assert.deepEqual(serviceRoleRead, completeFirst);
  for (const deniedRole of ["anon", "authenticated"]) {
    await session.query(`set role ${deniedRole}`);
    await assert.rejects(() => read(session, complete.scan), /permission denied/iu);
    await session.query("reset role");
  }

  const partial = ids(4);
  await seedPublished(session, partial, ["persisted", "failed"]);
  const partialRead = await read(session, partial.scan);
  assert.equal(partialRead.state, "published");
  assert.equal(partialRead.row_count, 1);
  assert.deepEqual(partialRead.rows.map((row) => row.work_index), [0]);

  const staging = ids(5);
  staging.scan = complete.scan;
  const stagingLease = await beginStaging(session, staging);
  assert.equal((await read(session, complete.scan)).result_set_id, complete.resultSet);
  await rpc(session, "abandon_scan_execution", `'${owner}','${staging.scan}','${staging.execution}','${staging.resultSet}',${stagingLease.lease_epoch},'{"reason":"rollback fixture"}'::jsonb`);
  assert.equal((await read(session, complete.scan)).result_set_id, complete.resultSet);

  const secondScan = ids(6);
  await seedPublished(session, secondScan, ["persisted"]);
  assert.equal((await read(session, secondScan.scan)).result_set_id, secondScan.resultSet);
  assert.equal((await read(session, complete.scan)).result_set_id, complete.resultSet);

  const legacy = ids(7);
  await session.query(`insert into public.scans(id,owner_id,local_id,name) values('${legacy.scan}','${owner}','read-legacy','Legacy')`);
  await session.query(`insert into public.scan_executions(id,owner_id,scan_id,result_set_id,state) values('${legacy.execution}','${owner}','${legacy.scan}',null,'legacy_unknown')`);
  await session.query(`insert into public.scan_result_sets(id,owner_id,scan_id,execution_id,integrity_class,state) values('${legacy.resultSet}','${owner}','${legacy.scan}','${legacy.execution}','legacy_unknown','legacy_unknown')`);
  await session.query(`update public.scan_executions set result_set_id='${legacy.resultSet}' where id='${legacy.execution}' and owner_id='${owner}' and scan_id='${legacy.scan}' and result_set_id is null`);
  assert.equal((await read(session, legacy.scan)).state, "unpublished");
  await assert.rejects(
    () => session.query(`update public.scans set published_result_set_id='${legacy.resultSet}', published_state='published' where id='${legacy.scan}'`),
    /SE_INVALID_PUBLISHED_POINTER/,
  );

  const replacement = ids(8);
  replacement.scan = complete.scan;
  await seedPublished(session, replacement, ["persisted"], { idempotencySuffix: "replacement" });
  await assert.rejects(
    () => read(session, complete.scan, {
      expectedResultSetId: completeFirst.result_set_id,
      expectedSetHash: completeFirst.set_hash,
      afterWorkIndex: completeFirst.next_cursor.after_work_index,
      limit: 2,
    }),
    /SE_PUBLICATION_CHANGED/,
  );
  assert.equal((await read(session, complete.scan)).result_set_id, replacement.resultSet);

  await assert.rejects(() => read(session, complete.scan, { afterWorkIndex: -2 }), /SE_INVALID_PUBLISHED_RESULT_READ_INPUT/);
  await assert.rejects(() => read(session, complete.scan, { limit: 0 }), /SE_INVALID_PUBLISHED_RESULT_READ_INPUT/);
  await assert.rejects(() => read(session, complete.scan, { expectedResultSetId: replacement.resultSet }), /SE_INVALID_PUBLISHED_RESULT_READ_INPUT/);

  await session.query("set session_replication_role = replica");
  await session.query(`update public.scan_result_sets set ledger_count = ledger_count + 1 where id='${replacement.resultSet}'`);
  await session.query("set session_replication_role = origin");
  await assert.rejects(() => read(session, complete.scan), /SE_PUBLISHED_RESULT_INVALID/);

  // Correccion 3: corrupcion conjunta. finalization_state y receipt.state se
  // mueven juntos de 'complete' a 'partial' sin tocar contadores fisicos ni
  // manifiesto ni set_hash. El estado derivado de los contadores fisicos sigue
  // siendo 'complete', asi que el lector debe rechazar con
  // SE_PUBLISHED_RESULT_INVALID en vez de aceptar la cache autoconsistente.
  const jointCorruption = ids(9);
  await seedPublished(session, jointCorruption, ["persisted", "persisted"]);
  assert.equal((await read(session, jointCorruption.scan)).state, "published");
  await session.query("set session_replication_role = replica");
  await session.query(`update public.scan_executions set checkpoint = jsonb_set(jsonb_set(checkpoint, '{finalization_state}', '"partial"'), '{finalization_receipt,state}', '"partial"') where id='${jointCorruption.execution}'`);
  await session.query("set session_replication_role = origin");
  await assert.rejects(() => read(session, jointCorruption.scan), /SE_PUBLISHED_RESULT_INVALID/);

  // Correccion 4: carrera A/B sincronizada por sesiones explicitas. La sesion
  // lectora fija un snapshot REPEATABLE READ sobre A; una segunda sesion
  // publica B para el mismo scan; el lector debe devolver exactamente el
  // envelope A (mismo set_hash, mismas filas) mientras el snapshot siga
  // abierto, y exactamente el envelope B en una lectura fresca tras el commit.
  // En ningun punto intermedio puede aparecer una mezcla de filas de A y B;
  // los payloads de B usan el prefijo RACE para que una mezcla sea detectable
  // por contenido.
  const raceA = ids(10);
  await seedPublished(session, raceA, ["persisted", "persisted"]);
  const publisherSession = openPersistentPsqlSession(url, "published-reader-race-publisher");
  t.after(() => publisherSession.close());

  const envelopeA = await read(session, raceA.scan);
  assert.equal(envelopeA.state, "published");
  assert.equal(envelopeA.result_set_id, raceA.resultSet);
  assert.deepEqual(envelopeA.rows.map((row) => row.payload.symbol), ["READ0", "READ1"]);

  await session.query("begin; set transaction isolation level repeatable read");
  const envelopeAInsideSnapshot = await read(session, raceA.scan);
  assert.deepEqual(envelopeAInsideSnapshot, envelopeA);

  const raceB = ids(11);
  raceB.scan = raceA.scan;
  await seedPublished(publisherSession, raceB, ["persisted"], { idempotencySuffix: "race-b", symbolPrefix: "RACE" });

  const envelopeAAfterPublishB = await read(session, raceA.scan);
  assert.deepEqual(envelopeAAfterPublishB, envelopeA);
  assert.ok(envelopeAAfterPublishB.rows.every((row) => row.payload.symbol.startsWith("READ")));
  const envelopeAPinned = await read(session, raceA.scan, {
    expectedResultSetId: envelopeA.result_set_id,
    expectedSetHash: envelopeA.set_hash,
  });
  assert.deepEqual(envelopeAPinned, envelopeA);
  await session.query("commit");

  const envelopeB = await read(session, raceA.scan);
  assert.equal(envelopeB.state, "published");
  assert.equal(envelopeB.result_set_id, raceB.resultSet);
  assert.equal(envelopeB.row_count, 1);
  assert.notEqual(envelopeB.set_hash, envelopeA.set_hash);
  assert.deepEqual(envelopeB.rows.map((row) => row.payload.symbol), ["RACE0"]);
  assert.ok(envelopeB.rows.every((row) => row.payload.symbol.startsWith("RACE")));
  const envelopeBFromPublisherSession = await read(publisherSession, raceA.scan);
  assert.deepEqual(envelopeBFromPublisherSession, envelopeB);
  await assert.rejects(
    () => read(session, raceA.scan, {
      expectedResultSetId: envelopeA.result_set_id,
      expectedSetHash: envelopeA.set_hash,
    }),
    /SE_PUBLICATION_CHANGED/,
  );
});
