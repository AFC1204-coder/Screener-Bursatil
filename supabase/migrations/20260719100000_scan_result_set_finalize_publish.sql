-- Hito 1B-2: DB-owned reconciliation, sealing, and atomic publication.
-- There is deliberately one terminal RPC. It never writes legacy scan_results.
set lock_timeout = '5s';
set statement_timeout = '5min';

create or replace function public.statsedge_result_set_mutability_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_execution public.scan_executions%rowtype;
begin
  if old.state in ('sealed', 'abandoned') then
    if to_jsonb(old) is distinct from to_jsonb(new) then
      raise exception using errcode = 'P0001', message = 'SE_RESULT_SET_IMMUTABLE';
    end if;
    return new;
  end if;
  if old.state is distinct from 'staging' then
    raise exception using errcode = 'P0001', message = 'SE_RESULT_SET_IMMUTABLE';
  end if;
  select * into v_execution from public.scan_executions
   where id = old.execution_id and owner_id = old.owner_id and scan_id = old.scan_id for key share;
  if not found or v_execution.result_set_id is distinct from old.id or v_execution.state is distinct from 'running'
    or new.owner_id is distinct from old.owner_id or new.scan_id is distinct from old.scan_id
    or new.execution_id is distinct from old.execution_id or new.integrity_class is distinct from 'verified'
    or new.state not in ('staging', 'sealed', 'abandoned') then
    raise exception using errcode = 'P0001', message = 'SE_RESULT_SET_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function public.statsedge_staging_child_mutability_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_result_set_id uuid; v_set public.scan_result_sets%rowtype; v_execution public.scan_executions%rowtype;
begin
  -- UPDATE must validate both endpoints. Checking only NEW lets a row escape
  -- a sealed/abandoned parent by moving it into a currently-staging set.
  for v_result_set_id in
    select distinct candidate.result_set_id
      from unnest(array[
        case when tg_op in ('UPDATE', 'DELETE') then old.result_set_id else null end,
        case when tg_op in ('UPDATE', 'INSERT') then new.result_set_id else null end
      ]) as candidate(result_set_id)
     where candidate.result_set_id is not null
  loop
    select * into v_set from public.scan_result_sets where id = v_result_set_id for key share;
    if not found then raise exception using errcode = 'P0001', message = 'SE_RESULT_SET_IMMUTABLE'; end if;
    select * into v_execution from public.scan_executions where id = v_set.execution_id for key share;
    if not found or v_set.state is distinct from 'staging' or v_execution.state is distinct from 'running'
      or v_execution.result_set_id is distinct from v_set.id then
      raise exception using errcode = 'P0001', message = 'SE_RESULT_SET_IMMUTABLE';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.statsedge_terminal_execution_immutable_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if old.state in ('published', 'failed', 'cancelled', 'abandoned')
    and to_jsonb(old) is distinct from to_jsonb(new) then
    raise exception using errcode = 'P0001', message = 'SE_EXECUTION_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists scan_result_sets_mutability_trg on public.scan_result_sets;
create trigger scan_result_sets_mutability_trg before update or delete on public.scan_result_sets
for each row execute function public.statsedge_result_set_mutability_v1();
drop trigger if exists scan_work_items_staging_mutability_trg on public.scan_work_items;
create trigger scan_work_items_staging_mutability_trg before insert or update or delete on public.scan_work_items
for each row execute function public.statsedge_staging_child_mutability_v1();
drop trigger if exists scan_result_set_rows_staging_mutability_trg on public.scan_result_set_rows;
create trigger scan_result_set_rows_staging_mutability_trg before insert or update or delete on public.scan_result_set_rows
for each row execute function public.statsedge_staging_child_mutability_v1();
drop trigger if exists scan_executions_terminal_immutable_trg on public.scan_executions;
create trigger scan_executions_terminal_immutable_trg before update on public.scan_executions
for each row execute function public.statsedge_terminal_execution_immutable_v1();

create or replace function public.statsedge_published_result_set_sealed_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_set public.scan_result_sets%rowtype; v_execution public.scan_executions%rowtype;
begin
  -- security definer: mismo motivo que la primera definición de esta función
  -- (Hito 1B-1) — ver ese comentario para el detalle completo.
  perform public.statsedge_lock_result_sets_v1(array[case when tg_op = 'UPDATE' then old.published_result_set_id else null end, new.published_result_set_id]);
  if new.published_result_set_id is null then return new; end if;
  select * into v_set from public.scan_result_sets where id = new.published_result_set_id for key share;
  select * into v_execution from public.scan_executions where id = v_set.execution_id for key share;
  if not found or v_set.owner_id is distinct from new.owner_id or v_set.scan_id is distinct from new.id
    or v_set.integrity_class is distinct from 'verified' or v_set.state is distinct from 'sealed'
    or v_set.set_hash is null or v_set.expected_count <> v_set.ledger_count or v_set.row_count < 0
    or v_set.sealed_at is null or v_execution.owner_id is distinct from v_set.owner_id
    or v_execution.scan_id is distinct from v_set.scan_id or v_execution.result_set_id is distinct from v_set.id
    or v_execution.state is distinct from 'published' or v_execution.finished_at is null
    or v_execution.persisted_count <> v_set.row_count
    or (v_execution.checkpoint ->> 'finalization_state') is null
    or (v_execution.checkpoint ->> 'finalization_state') not in ('complete', 'partial')
    or new.published_state is distinct from 'published' or new.row_count is distinct from v_set.row_count
    or new.published_at is null or new.published_updated_at is null then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_PUBLISHED_POINTER';
  end if;
  return new;
end;
$$;

create or replace function public.statsedge_published_result_set_state_lock_v1()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_execution public.scan_executions%rowtype; v_pointer record;
begin
  perform public.statsedge_lock_result_set_v1(old.id);
  select * into v_execution from public.scan_executions where id = old.execution_id for key share;
  select s.id, s.owner_id into v_pointer from public.scans s where s.published_result_set_id = old.id;
  if found and (new.state is distinct from 'sealed' or new.integrity_class is distinct from 'verified'
    or new.set_hash is null or new.sealed_at is null or new.expected_count <> new.ledger_count
    or v_execution.state is distinct from 'published' or v_execution.finished_at is null
    or (v_execution.checkpoint ->> 'finalization_state') is null
    or (v_execution.checkpoint ->> 'finalization_state') not in ('complete', 'partial')) then
    raise exception using errcode = 'P0001', message = 'SE_PUBLISHED_RESULT_SET_STATE_LOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists scans_published_result_set_sealed_trg on public.scans;
create trigger scans_published_result_set_sealed_trg
before insert or update of published_result_set_id, owner_id, published_state, row_count, published_at, published_updated_at on public.scans
for each row execute function public.statsedge_published_result_set_sealed_v1();
drop trigger if exists scan_result_sets_published_state_lock_trg on public.scan_result_sets;
create trigger scan_result_sets_published_state_lock_trg
before update of state, integrity_class, set_hash, expected_count, ledger_count, row_count, sealed_at, owner_id, scan_id on public.scan_result_sets
for each row execute function public.statsedge_published_result_set_state_lock_v1();

create or replace function public.abandon_scan_execution(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_reason jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_tuple record; v_id uuid; v_count integer;
begin
  if p_reason is null or jsonb_typeof(p_reason) is distinct from 'object' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select * into v_tuple from public.statsedge_assert_execution_lease_v1(p_owner_id, p_scan_id, p_execution_id, p_result_set_id, p_lease_epoch);
  update public.scan_result_sets set state = 'abandoned', abandoned_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = v_tuple.result_set_id and state = 'staging' returning id into v_id;
  get diagnostics v_count = row_count; if v_count <> 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scan_executions set state = 'abandoned', checkpoint = checkpoint || jsonb_build_object('abandon_reason', p_reason), finished_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = v_tuple.execution_id and state = 'running' returning id into v_id;
  get diagnostics v_count = row_count; if v_count <> 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scans set active_execution_id = null, active_result_set_id = null, lease_until = null
   where id = v_tuple.scan_id and active_execution_id is not distinct from v_tuple.execution_id and active_result_set_id is not distinct from v_tuple.result_set_id and lease_epoch is not distinct from v_tuple.lease_epoch
   returning id into v_id;
  get diagnostics v_count = row_count; if v_count <> 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('execution_id', p_execution_id, 'result_set_id', p_result_set_id, 'state', 'abandoned');
end;
$$;

create or replace function public.statsedge_finalization_manifest_v1(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid,
  p_policy_version text, p_hash_version text, p_expected_count bigint,
  p_ledger_count bigint, p_work_items jsonb, p_rows jsonb
)
returns jsonb language sql immutable strict security invoker set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'manifest_version', 'statsedge-finalize-manifest-v1',
    'owner_id', p_owner_id, 'scan_id', p_scan_id, 'execution_id', p_execution_id,
    'result_set_id', p_result_set_id, 'policy_version', p_policy_version,
    'hash_version', p_hash_version, 'row_schema_version', 'statsedge-scan-result-row-v1',
    'expected_count', p_expected_count, 'ledger_count', p_ledger_count,
    'work_items', p_work_items, 'rows', p_rows
  );
$$;

create or replace function public.statsedge_finalization_set_hash_v1(p_manifest jsonb)
returns text language sql immutable strict security invoker set search_path = pg_catalog, public
as $$ select public.statsedge_pg_jsonb_sha256_v1(p_manifest); $$;

create or replace function public.statsedge_assert_terminal_replay_evidence_v1(
  p_owner_id text, p_scan_id uuid, p_result_set_id uuid
)
returns void language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_execution public.scan_executions%rowtype; v_set public.scan_result_sets%rowtype;
  v_ledger bigint; v_min integer; v_max integer; v_p bigint; v_f bigint; v_c bigint; v_rows bigint;
  v_state text; v_hash text; v_manifest jsonb; v_receipt jsonb;
begin
  select * into v_set from public.scan_result_sets where id = p_result_set_id for key share;
  select * into v_execution from public.scan_executions where id = v_set.execution_id for key share;
  if not found or v_execution.owner_id is distinct from p_owner_id or v_set.owner_id is distinct from p_owner_id
    or v_execution.scan_id is distinct from p_scan_id or v_set.scan_id is distinct from p_scan_id
    or v_execution.result_set_id is distinct from p_result_set_id or v_set.execution_id is distinct from v_execution.id
    or v_set.integrity_class is distinct from 'verified'
    or v_execution.state not in ('published','failed','cancelled') or jsonb_typeof(v_execution.checkpoint) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  if v_execution.policy_version is distinct from 'statsedge-scan-execution-v1'
    or v_execution.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1'
    or v_set.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1'
    or v_execution.issued_lease_epoch is null or v_execution.issued_lease_until is null
    or v_execution.issued_lease_epoch < 0 or v_execution.issued_lease_epoch > v_execution.lease_epoch then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  select count(*), min(work_index), max(work_index), count(*) filter(where outcome = 'persisted'), count(*) filter(where outcome = 'failed'), count(*) filter(where outcome = 'cancelled')
    into v_ledger, v_min, v_max, v_p, v_f, v_c from public.scan_work_items where result_set_id = p_result_set_id;
  select count(*) into v_rows from public.scan_result_set_rows where result_set_id = p_result_set_id;
  if v_ledger is distinct from v_execution.expected_count or (v_ledger > 0 and (v_min <> 0 or v_max <> v_execution.expected_count - 1))
    or exists (select 1 from public.scan_work_items w where w.result_set_id=p_result_set_id and (w.outcome is null or w.outcome not in ('persisted','excluded','failed','cancelled') or w.written_lease_epoch is null or w.written_lease_epoch < v_execution.issued_lease_epoch or w.written_lease_epoch > v_execution.lease_epoch))
    or exists (select 1 from public.scan_work_items w where w.result_set_id=p_result_set_id and (w.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(w.payload) or w.identity_key is distinct from public.statsedge_execution_identity_key_v1(w.payload)))
    or exists (select 1 from public.scan_result_set_rows r where r.result_set_id=p_result_set_id and (r.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload) or r.row_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload) or r.identity_key is distinct from public.statsedge_execution_identity_key_v1(r.payload)))
    or exists (select 1 from public.scan_work_items w left join public.scan_result_set_rows r on r.result_set_id=w.result_set_id and r.work_index=w.work_index where w.result_set_id=p_result_set_id and w.outcome='persisted' and (r.result_set_id is null or w.identity_key is distinct from r.identity_key or w.row_hash is distinct from r.row_hash or r.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1' or r.row_schema_version is distinct from 'statsedge-scan-result-row-v1' or w.owner_id is distinct from r.owner_id or w.scan_id is distinct from r.scan_id))
    or exists (select 1 from public.scan_work_items w join public.scan_result_set_rows r on r.result_set_id=w.result_set_id and r.work_index=w.work_index where w.result_set_id=p_result_set_id and w.outcome <> 'persisted')
    or exists (select 1 from public.scan_result_set_rows r left join public.scan_work_items w on w.result_set_id=r.result_set_id and w.work_index=r.work_index where r.result_set_id=p_result_set_id and w.result_set_id is null) then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  v_manifest := public.statsedge_finalization_manifest_v1(p_owner_id,p_scan_id,v_execution.id,p_result_set_id,v_execution.policy_version,v_execution.hash_version,v_execution.expected_count,v_ledger,coalesce((select jsonb_agg(jsonb_build_object('work_index',w.work_index,'identity_key',w.identity_key,'payload',w.payload,'payload_hash',w.payload_hash,'outcome',w.outcome,'row_hash',w.row_hash,'error',w.error,'written_lease_epoch',w.written_lease_epoch) order by w.work_index) from public.scan_work_items w where w.result_set_id=p_result_set_id),'[]'::jsonb),coalesce((select jsonb_agg(jsonb_build_object('work_index',r.work_index,'identity_key',r.identity_key,'payload',r.payload,'payload_hash',r.payload_hash,'row_hash',r.row_hash,'hash_version',r.hash_version,'row_schema_version',r.row_schema_version,'owner_id',r.owner_id,'scan_id',r.scan_id,'result_set_id',r.result_set_id) order by r.work_index) from public.scan_result_set_rows r where r.result_set_id=p_result_set_id),'[]'::jsonb));
  v_hash := public.statsedge_finalization_set_hash_v1(v_manifest);
  if v_c > 0 then v_state := 'cancelled'; elsif v_p + v_f = 0 then v_state := 'failed'; elsif v_p > 0 and v_f = 0 then v_state := 'complete'; elsif v_f > 0 and v_p >= v_f then v_state := 'partial'; else v_state := 'failed'; end if;
  v_receipt := v_execution.checkpoint -> 'finalization_receipt';
  if jsonb_typeof(v_receipt) is distinct from 'object'
    or not (v_receipt ?& array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[])
    or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(v_receipt)='object' then v_receipt else '{}'::jsonb end) as k(key) where k.key <> all (array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[]))
    or v_receipt -> 'owner_id' is distinct from to_jsonb(p_owner_id) or v_receipt -> 'scan_id' is distinct from to_jsonb(p_scan_id)
    or v_receipt -> 'execution_id' is distinct from to_jsonb(v_execution.id) or v_receipt -> 'result_set_id' is distinct from to_jsonb(p_result_set_id)
    or v_receipt -> 'lease_epoch' is distinct from to_jsonb(v_execution.lease_epoch) or v_receipt -> 'state' is distinct from to_jsonb(v_state)
    or v_receipt -> 'set_hash' is distinct from to_jsonb(v_hash) or v_receipt -> 'expected_count' is distinct from to_jsonb(v_execution.expected_count)
    or v_receipt -> 'ledger_count' is distinct from to_jsonb(v_ledger) or v_receipt -> 'persisted_count' is distinct from to_jsonb(v_p)
    or v_receipt -> 'failed_count' is distinct from to_jsonb(v_f) or v_receipt -> 'cancelled_count' is distinct from to_jsonb(v_c)
    or v_receipt -> 'row_count' is distinct from to_jsonb(v_rows) or v_receipt -> 'replayed' is distinct from 'false'::jsonb
    or v_set.expected_count is distinct from v_ledger or v_set.ledger_count is distinct from v_ledger or v_set.row_count is distinct from v_rows
    or v_set.set_hash is distinct from v_hash or v_execution.registered_count is distinct from v_ledger or v_execution.persisted_count is distinct from v_p
    or v_execution.failed_count is distinct from v_f or v_execution.cancelled_count is distinct from v_c or v_execution.completed_count is distinct from v_ledger-v_p
    or (v_execution.checkpoint -> 'finalization_state') is distinct from v_receipt -> 'state'
    or v_execution.finalizing_at is null or v_execution.finished_at is null or v_execution.finalizing_at is distinct from v_execution.finished_at
    or (v_execution.state='published' and (v_set.state is distinct from 'sealed' or v_set.sealed_at is null or v_set.abandoned_at is not null or v_set.sealed_at is distinct from v_execution.finalizing_at or v_state not in ('complete','partial')))
    or (v_execution.state in ('failed','cancelled') and (v_set.state is distinct from 'abandoned' or v_set.abandoned_at is null or v_set.sealed_at is not null or v_set.abandoned_at is distinct from v_execution.finalizing_at or v_state is distinct from v_execution.state)) then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
end;
$$;

create or replace function public.finalize_scan_execution(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_scan public.scans%rowtype; v_execution public.scan_executions%rowtype; v_set public.scan_result_sets%rowtype;
  v_ledger bigint; v_min integer; v_max integer; v_p bigint; v_f bigint; v_c bigint; v_rows bigint;
  v_state text; v_hash text; v_manifest jsonb; v_receipt jsonb; v_id uuid; v_count integer; v_now timestamptz;
begin
  if p_owner_id is null or p_scan_id is null or p_execution_id is null or p_result_set_id is null or p_lease_epoch is null then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  perform public.statsedge_lock_result_set_v1(p_result_set_id);
  select * into v_scan from public.scans where id = p_scan_id for update;
  select * into v_execution from public.scan_executions where id = p_execution_id for update;
  select * into v_set from public.scan_result_sets where id = p_result_set_id for update;
  if not found or v_scan.owner_id is distinct from p_owner_id or v_execution.owner_id is distinct from p_owner_id
    or v_set.owner_id is distinct from p_owner_id or v_execution.scan_id is distinct from p_scan_id or v_set.scan_id is distinct from p_scan_id
    or v_execution.result_set_id is distinct from p_result_set_id or v_set.execution_id is distinct from p_execution_id
    or p_lease_epoch is distinct from v_execution.lease_epoch then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if jsonb_typeof(v_execution.checkpoint) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  if v_execution.policy_version is distinct from 'statsedge-scan-execution-v1' then raise exception using errcode = 'P0001', message = 'SE_UNSUPPORTED_POLICY_VERSION'; end if;
  if v_execution.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1' or v_set.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1' then raise exception using errcode = 'P0001', message = 'SE_UNSUPPORTED_HASH_VERSION'; end if;
  -- This is the one physical reconciliation used for both a live finalization
  -- and a terminal replay. Terminal records are immutable, so a divergence
  -- must fence the replay rather than repair a cache or receipt.
  select count(*), min(work_index), max(work_index), count(*) filter(where outcome = 'persisted'), count(*) filter(where outcome = 'failed'), count(*) filter(where outcome = 'cancelled')
    into v_ledger, v_min, v_max, v_p, v_f, v_c from public.scan_work_items where result_set_id = p_result_set_id;
  if v_execution.issued_lease_epoch is null or v_execution.issued_lease_until is null
    or v_execution.issued_lease_epoch < 0 or v_execution.issued_lease_epoch > v_execution.lease_epoch
    or v_set.expected_count <> v_execution.expected_count or v_ledger <> v_execution.expected_count
    or (v_ledger = 0 and v_execution.expected_count <> 0) or (v_ledger > 0 and (v_min <> 0 or v_max <> v_execution.expected_count - 1))
    or exists (select 1 from public.scan_work_items w where w.result_set_id = p_result_set_id and (w.outcome is null or w.outcome not in ('persisted','excluded','failed','cancelled') or w.written_lease_epoch is null or w.written_lease_epoch < v_execution.issued_lease_epoch or w.written_lease_epoch > v_execution.lease_epoch)) then
    if v_execution.state in ('published','failed','cancelled') then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
    raise exception using errcode = 'P0001', message = 'SE_LEDGER_ROW_MISMATCH';
  end if;
  select count(*) into v_rows from public.scan_result_set_rows r where r.result_set_id = p_result_set_id;
  if exists (select 1 from public.scan_work_items w where w.result_set_id = p_result_set_id and (w.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(w.payload) or w.identity_key is distinct from public.statsedge_execution_identity_key_v1(w.payload)))
    or exists (select 1 from public.scan_result_set_rows r where r.result_set_id = p_result_set_id and (r.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload) or r.row_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload) or r.identity_key is distinct from public.statsedge_execution_identity_key_v1(r.payload))) then
    if v_execution.state in ('published','failed','cancelled') then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
    raise exception using errcode = 'P0001', message = 'SE_HASH_MISMATCH';
  end if;
  if exists (
    select 1 from public.scan_work_items w
      left join public.scan_result_set_rows r on r.result_set_id = w.result_set_id and r.work_index = w.work_index
     where w.result_set_id = p_result_set_id and w.outcome = 'persisted' and (
       r.result_set_id is null or w.identity_key is distinct from r.identity_key or w.row_hash is distinct from r.row_hash
       or r.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1' or r.row_schema_version is distinct from 'statsedge-scan-result-row-v1'
       or w.owner_id is distinct from r.owner_id or w.scan_id is distinct from r.scan_id)
  ) or exists (
    select 1 from public.scan_work_items w
      join public.scan_result_set_rows r on r.result_set_id = w.result_set_id and r.work_index = w.work_index
     where w.result_set_id = p_result_set_id and w.outcome <> 'persisted'
  ) or exists (
    select 1 from public.scan_result_set_rows r
      left join public.scan_work_items w on w.result_set_id = r.result_set_id and w.work_index = r.work_index
     where r.result_set_id = p_result_set_id and w.result_set_id is null
  ) then
    if v_execution.state in ('published','failed','cancelled') then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
    raise exception using errcode = 'P0001', message = 'SE_LEDGER_ROW_MISMATCH';
  end if;
  v_manifest := public.statsedge_finalization_manifest_v1(p_owner_id,p_scan_id,p_execution_id,p_result_set_id,v_execution.policy_version,v_execution.hash_version,v_execution.expected_count,v_ledger,coalesce((select jsonb_agg(jsonb_build_object('work_index',w.work_index,'identity_key',w.identity_key,'payload',w.payload,'payload_hash',w.payload_hash,'outcome',w.outcome,'row_hash',w.row_hash,'error',w.error,'written_lease_epoch',w.written_lease_epoch) order by w.work_index) from public.scan_work_items w where w.result_set_id=p_result_set_id),'[]'::jsonb),coalesce((select jsonb_agg(jsonb_build_object('work_index',r.work_index,'identity_key',r.identity_key,'payload',r.payload,'payload_hash',r.payload_hash,'row_hash',r.row_hash,'hash_version',r.hash_version,'row_schema_version',r.row_schema_version,'owner_id',r.owner_id,'scan_id',r.scan_id,'result_set_id',r.result_set_id) order by r.work_index) from public.scan_result_set_rows r where r.result_set_id=p_result_set_id),'[]'::jsonb));
  v_hash := public.statsedge_finalization_set_hash_v1(v_manifest);
  if v_c > 0 then v_state := 'cancelled'; elsif v_p + v_f = 0 then v_state := 'failed'; elsif v_p > 0 and v_f = 0 then v_state := 'complete'; elsif v_f > 0 and v_p >= v_f then v_state := 'partial'; else v_state := 'failed'; end if;
  if v_execution.state in ('published', 'failed', 'cancelled') then
    perform public.statsedge_assert_terminal_replay_evidence_v1(p_owner_id, p_scan_id, p_result_set_id);
    if v_scan.published_result_set_id is not null and v_scan.published_result_set_id is distinct from p_result_set_id then
      perform public.statsedge_assert_terminal_replay_evidence_v1(p_owner_id, p_scan_id, v_scan.published_result_set_id);
    end if;
    v_receipt := v_execution.checkpoint -> 'finalization_receipt';
    if jsonb_typeof(v_execution.checkpoint) is distinct from 'object'
      or jsonb_typeof(v_receipt) is distinct from 'object'
      or not (v_receipt ?& array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[])
      or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(v_receipt) = 'object' then v_receipt else '{}'::jsonb end) as receipt_key(key) where receipt_key.key <> all (array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[]))
      or v_receipt -> 'owner_id' is distinct from to_jsonb(p_owner_id)
      or v_receipt -> 'scan_id' is distinct from to_jsonb(p_scan_id)
      or v_receipt -> 'execution_id' is distinct from to_jsonb(p_execution_id)
      or v_receipt -> 'result_set_id' is distinct from to_jsonb(p_result_set_id)
      or v_receipt -> 'state' is distinct from to_jsonb(v_state)
      or v_set.set_hash is null
      or v_set.set_hash is distinct from v_hash
      or v_receipt -> 'lease_epoch' is distinct from to_jsonb(p_lease_epoch)
      or v_receipt -> 'set_hash' is distinct from to_jsonb(v_hash)
      or v_receipt -> 'expected_count' is distinct from to_jsonb(v_execution.expected_count)
      or v_receipt -> 'ledger_count' is distinct from to_jsonb(v_set.ledger_count)
      or v_execution.registered_count is distinct from v_set.ledger_count
      or v_receipt -> 'persisted_count' is distinct from to_jsonb(v_execution.persisted_count)
      or v_receipt -> 'failed_count' is distinct from to_jsonb(v_execution.failed_count)
      or v_receipt -> 'cancelled_count' is distinct from to_jsonb(v_execution.cancelled_count)
      or v_receipt -> 'row_count' is distinct from to_jsonb(v_set.row_count)
      or v_receipt -> 'replayed' is distinct from 'false'::jsonb
      or v_set.expected_count is distinct from v_set.ledger_count
      or v_set.ledger_count is distinct from v_execution.expected_count
      or v_execution.expected_count is distinct from v_execution.registered_count
      or v_set.ledger_count is distinct from v_ledger
      or v_set.row_count is distinct from v_rows
      or v_execution.persisted_count is distinct from v_p
      or v_execution.failed_count is distinct from v_f
      or v_execution.cancelled_count is distinct from v_c
      or v_execution.persisted_count is distinct from v_set.row_count
      or v_execution.completed_count is distinct from v_set.ledger_count - v_execution.persisted_count
      or v_execution.persisted_count < 0 or v_execution.failed_count < 0 or v_execution.cancelled_count < 0
      or v_execution.persisted_count + v_execution.failed_count + v_execution.cancelled_count > v_set.ledger_count
      or (v_execution.cancelled_count > 0 and v_receipt -> 'state' is distinct from '"cancelled"'::jsonb)
      or (v_execution.cancelled_count = 0 and v_execution.persisted_count + v_execution.failed_count = 0 and v_receipt -> 'state' is distinct from '"failed"'::jsonb)
      or (v_execution.cancelled_count = 0 and v_execution.persisted_count > 0 and v_execution.failed_count = 0 and v_receipt -> 'state' is distinct from '"complete"'::jsonb)
      or (v_execution.cancelled_count = 0 and v_execution.failed_count > 0 and v_execution.persisted_count >= v_execution.failed_count and v_receipt -> 'state' is distinct from '"partial"'::jsonb)
      or (v_execution.cancelled_count = 0 and v_execution.failed_count > v_execution.persisted_count and v_receipt -> 'state' is distinct from '"failed"'::jsonb)
      or (v_execution.checkpoint -> 'finalization_state') is null
      or (v_execution.checkpoint -> 'finalization_state') is distinct from (v_receipt -> 'state')
      or v_scan.lease_epoch is null or v_execution.lease_epoch is null
      or v_scan.lease_epoch < v_execution.lease_epoch
      or not (
        (v_scan.active_execution_id is null and v_scan.active_result_set_id is null and v_scan.lease_until is null)
        or exists (
          select 1 from public.scan_executions active_execution
            join public.scan_result_sets active_set on active_set.id = active_execution.result_set_id
           where active_execution.id = v_scan.active_execution_id
             and active_set.id = v_scan.active_result_set_id
             and active_execution.owner_id is not distinct from p_owner_id
             and active_set.owner_id is not distinct from p_owner_id
             and active_execution.scan_id is not distinct from p_scan_id
             and active_set.scan_id is not distinct from p_scan_id
             and active_set.execution_id is not distinct from active_execution.id
             and active_execution.state is not distinct from 'running'
             and active_set.state is not distinct from 'staging'
             and active_set.integrity_class is not distinct from 'verified'
             and active_execution.policy_version is not distinct from 'statsedge-scan-execution-v1'
             and active_execution.hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'
             and active_set.hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'
             and active_execution.issued_lease_epoch is not null and active_execution.issued_lease_until is not null
             and active_execution.issued_lease_epoch >= 0 and active_execution.issued_lease_epoch <= active_execution.lease_epoch
             and v_scan.lease_epoch > v_execution.lease_epoch
             and active_execution.lease_epoch is not distinct from v_scan.lease_epoch
             and v_scan.lease_until is not null
             and active_execution.lease_until is not distinct from v_scan.lease_until
        )
      )
      or v_execution.finalizing_at is null or v_execution.finished_at is null
      or v_execution.finalizing_at is distinct from v_execution.finished_at
      or (v_execution.state = 'published' and (v_set.sealed_at is null or v_set.abandoned_at is not null or v_set.sealed_at is distinct from v_execution.finalizing_at))
      or (v_execution.state in ('failed', 'cancelled') and (v_set.abandoned_at is null or v_set.sealed_at is not null or v_set.abandoned_at is distinct from v_execution.finalizing_at))
      or (v_execution.state = 'published' and (v_set.state is distinct from 'sealed' or v_receipt -> 'state' not in ('"complete"'::jsonb, '"partial"'::jsonb)))
      or (v_execution.state = 'published' and not (
        (v_scan.published_result_set_id is not distinct from p_result_set_id
          and v_scan.published_state is not distinct from 'published'
          and v_scan.row_count is not distinct from v_set.row_count
          and v_scan.published_at is not null and v_scan.published_updated_at is not null
          and v_scan.published_at is not distinct from v_execution.finalizing_at
          and v_scan.published_updated_at is not distinct from v_execution.finalizing_at)
        or exists (
          select 1
            from public.scan_result_sets pointer_set
            join public.scan_executions pointer_execution on pointer_execution.id = pointer_set.execution_id
           where pointer_set.id = v_scan.published_result_set_id
             and pointer_set.owner_id is not distinct from p_owner_id
             and pointer_set.scan_id is not distinct from p_scan_id
             and pointer_set.integrity_class is not distinct from 'verified'
             and pointer_set.state is not distinct from 'sealed'
             and pointer_set.set_hash is not null
             and pointer_set.sealed_at is not null
             and pointer_set.abandoned_at is null
             and pointer_execution.owner_id is not distinct from p_owner_id
             and pointer_execution.scan_id is not distinct from p_scan_id
             and pointer_execution.result_set_id is not distinct from pointer_set.id
             and pointer_execution.state is not distinct from 'published'
             and pointer_execution.finalizing_at is not null
             and pointer_execution.finished_at is not null
             and pointer_execution.finalizing_at is not distinct from pointer_execution.finished_at
             and pointer_set.sealed_at is not distinct from pointer_execution.finalizing_at
             and pointer_execution.lease_epoch > v_execution.lease_epoch
             and v_scan.lease_epoch is not null and pointer_execution.lease_epoch is not null
             and v_scan.lease_epoch >= pointer_execution.lease_epoch
             and (pointer_execution.checkpoint -> 'finalization_state') in ('"complete"'::jsonb, '"partial"'::jsonb)
             and v_scan.published_state is not distinct from 'published'
             and v_scan.row_count is not distinct from pointer_set.row_count
             and v_scan.published_at is not null and v_scan.published_updated_at is not null
             and v_scan.published_at is not distinct from pointer_execution.finalizing_at
             and v_scan.published_updated_at is not distinct from pointer_execution.finalizing_at
        )
      ))
      or (v_execution.state in ('failed', 'cancelled') and v_scan.published_result_set_id is not null and (
        v_scan.published_result_set_id is not distinct from p_result_set_id
        or not exists (
          select 1
            from public.scan_result_sets pointer_set
            join public.scan_executions pointer_execution on pointer_execution.id = pointer_set.execution_id
           where pointer_set.id = v_scan.published_result_set_id
             and pointer_set.owner_id is not distinct from p_owner_id
             and pointer_set.scan_id is not distinct from p_scan_id
             and pointer_set.integrity_class is not distinct from 'verified'
             and pointer_set.state is not distinct from 'sealed'
             and pointer_set.sealed_at is not null and pointer_set.abandoned_at is null
             and pointer_execution.owner_id is not distinct from p_owner_id
             and pointer_execution.scan_id is not distinct from p_scan_id
             and pointer_execution.result_set_id is not distinct from pointer_set.id
             and pointer_execution.state is not distinct from 'published'
             and pointer_execution.lease_epoch is not null
             and pointer_execution.lease_epoch is distinct from v_execution.lease_epoch
             and v_scan.lease_epoch >= pointer_execution.lease_epoch
             and pointer_execution.finalizing_at is not null and pointer_execution.finished_at is not null
             and pointer_execution.finalizing_at is not distinct from pointer_execution.finished_at
             and pointer_set.sealed_at is not distinct from pointer_execution.finalizing_at
             and v_scan.published_state is not distinct from 'published'
             and v_scan.row_count is not distinct from pointer_set.row_count
             and v_scan.published_at is not null and v_scan.published_updated_at is not null
             and v_scan.published_at is not distinct from pointer_execution.finalizing_at
             and v_scan.published_updated_at is not distinct from pointer_execution.finalizing_at
        )
      ))
      or (v_execution.state in ('failed', 'cancelled') and (v_set.state is distinct from 'abandoned' or v_receipt -> 'state' is distinct from to_jsonb(v_execution.state))) then
      raise exception using errcode = 'P0001', message = 'SE_FENCED';
    end if;
    return v_receipt || jsonb_build_object('replayed', true);
  end if;
  -- All advisory and row locks are held and linked records were re-read. Take
  -- the lease clock only now, immediately before comparing lease validity.
  v_now := clock_timestamp();
  if v_scan.active_execution_id is distinct from p_execution_id or v_scan.active_result_set_id is distinct from p_result_set_id
    or v_scan.lease_epoch is distinct from p_lease_epoch or v_scan.lease_until is null or v_scan.lease_until <= v_now
    or v_execution.lease_until is distinct from v_scan.lease_until or v_execution.state is distinct from 'running'
    or v_set.state is distinct from 'staging' or v_set.integrity_class is distinct from 'verified' then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  v_receipt := jsonb_build_object('owner_id',p_owner_id,'scan_id',p_scan_id,'execution_id',p_execution_id,'result_set_id',p_result_set_id,'lease_epoch',p_lease_epoch,'state',v_state,'set_hash',v_hash,'expected_count',v_execution.expected_count,'ledger_count',v_ledger,'persisted_count',v_p,'failed_count',v_f,'cancelled_count',v_c,'row_count',v_rows,'replayed',false);
  update public.scan_result_sets set expected_count=v_execution.expected_count, ledger_count=v_ledger, row_count=v_rows, set_hash=v_hash, state=case when v_state in ('complete','partial') then 'sealed' else 'abandoned' end, sealed_at=case when v_state in ('complete','partial') then v_now else null end, abandoned_at=case when v_state in ('failed','cancelled') then v_now else null end, updated_at=v_now where id=p_result_set_id returning id into v_id;
  get diagnostics v_count = row_count; if v_count <> 1 then raise exception using errcode='P0001', message='SE_FENCED'; end if;
  update public.scan_executions set state=case when v_state in ('complete','partial') then 'published' else v_state end, registered_count=v_ledger, persisted_count=v_p, completed_count=(v_ledger-v_p), failed_count=v_f, cancelled_count=v_c, checkpoint=checkpoint || jsonb_build_object('finalization_state',v_state,'finalization_receipt',v_receipt), finalizing_at=v_now, finished_at=v_now, updated_at=v_now where id=p_execution_id returning id into v_id;
  get diagnostics v_count = row_count; if v_count <> 1 then raise exception using errcode='P0001', message='SE_FENCED'; end if;
  if v_state in ('complete','partial') then
    update public.scans set published_result_set_id=p_result_set_id, published_state='published', row_count=v_rows, published_at=v_now, published_updated_at=v_now, active_execution_id=null, active_result_set_id=null, lease_until=null
      where id=p_scan_id and active_execution_id is not distinct from p_execution_id and active_result_set_id is not distinct from p_result_set_id and lease_epoch is not distinct from p_lease_epoch returning id into v_id;
  else
    update public.scans set active_execution_id=null, active_result_set_id=null, lease_until=null
      where id=p_scan_id and active_execution_id is not distinct from p_execution_id and active_result_set_id is not distinct from p_result_set_id and lease_epoch is not distinct from p_lease_epoch returning id into v_id;
  end if;
  get diagnostics v_count = row_count; if v_count <> 1 then raise exception using errcode='P0001', message='SE_FENCED'; end if;
  return v_receipt;
end;
$$;

revoke all on function public.statsedge_result_set_mutability_v1() from public;
revoke all on function public.statsedge_staging_child_mutability_v1() from public;
revoke all on function public.statsedge_terminal_execution_immutable_v1() from public;
revoke all on function public.statsedge_finalization_manifest_v1(text,uuid,uuid,uuid,text,text,bigint,bigint,jsonb,jsonb) from public;
revoke all on function public.statsedge_finalization_set_hash_v1(jsonb) from public;
revoke all on function public.statsedge_assert_terminal_replay_evidence_v1(text,uuid,uuid) from public;
revoke all on function public.finalize_scan_execution(text,uuid,uuid,uuid,bigint) from public;
do $$ declare r text; f text; begin foreach f in array array['statsedge_result_set_mutability_v1()','statsedge_staging_child_mutability_v1()','statsedge_terminal_execution_immutable_v1()','statsedge_finalization_manifest_v1(text,uuid,uuid,uuid,text,text,bigint,bigint,jsonb,jsonb)','statsedge_finalization_set_hash_v1(jsonb)','statsedge_assert_terminal_replay_evidence_v1(text,uuid,uuid)','finalize_scan_execution(text,uuid,uuid,uuid,bigint)'] loop foreach r in array array['anon','authenticated','service_role'] loop if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function public.%s from %I',f,r); end if; end loop; end loop; end $$;

reset statement_timeout;
reset lock_timeout;
