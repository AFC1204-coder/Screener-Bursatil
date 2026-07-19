-- Hito 1B-1: execution lease fencing and idempotent staging ledger only.
-- No function in this migration seals, publishes, mutates scan_results, or
-- changes any published pointer.
set lock_timeout = '5s';
set statement_timeout = '5min';

alter table public.scan_executions add column if not exists idempotency_key text;
alter table public.scan_executions add column if not exists idempotency_hash text;
alter table public.scan_executions add column if not exists input_hash text;
alter table public.scan_executions add column if not exists methodology_hash text;
alter table public.scan_executions add column if not exists lease_until timestamptz;
alter table public.scan_executions add column if not exists issued_lease_epoch bigint;
alter table public.scan_executions add column if not exists issued_lease_until timestamptz;
alter table public.scan_work_items drop constraint if exists scan_work_items_outcome_check;
alter table public.scan_work_items add constraint scan_work_items_outcome_check
  check (outcome is null or outcome in ('registered', 'persisted', 'completed', 'excluded', 'failed', 'cancelled'));
create unique index if not exists scan_executions_owner_scan_idempotency_key
  on public.scan_executions(owner_id, scan_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.statsedge_execution_identity_key_v1(p_payload jsonb)
returns text language sql immutable strict security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(nullif(btrim(p_payload ->> 'identityKey'), ''), nullif(btrim(p_payload ->> 'symbol'), ''), public.statsedge_pg_jsonb_sha256_v1(p_payload));
$$;

-- Every 1B-1 writer and both published-pointer barriers serialize on this
-- transaction-scoped key before trusting any result-set state. Collisions are
-- harmless (they only serialize unrelated sets); equal UUIDs always map to
-- the same lock.
create or replace function public.statsedge_result_set_lock_key_v1(p_result_set_id uuid)
returns bigint language sql immutable strict security invoker
set search_path = pg_catalog, public
as $$
  select pg_catalog.hashtextextended(p_result_set_id::text, 846231947);
$$;

-- This deliberately never waits. A trigger can already own a row lock before
-- it runs, so taking a blocking advisory lock here could close a lock cycle
-- with a writer. Contention is an explicit, retryable failure instead.
create or replace function public.statsedge_lock_result_sets_v1(p_result_set_ids uuid[])
returns void language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_result_set_id uuid;
begin
  if p_result_set_ids is null or cardinality(p_result_set_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end if;
  for v_result_set_id in
    select result_set_id
      from (
        select distinct result_set_id
          from unnest(p_result_set_ids) as locked(result_set_id)
         where result_set_id is not null
      ) as distinct_sets
     order by public.statsedge_result_set_lock_key_v1(result_set_id), result_set_id
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(public.statsedge_result_set_lock_key_v1(v_result_set_id)) then
      raise exception using errcode = 'P0001', message = 'SE_RESULT_SET_BUSY';
    end if;
  end loop;
end;
$$;

create or replace function public.statsedge_lock_result_set_v1(p_result_set_id uuid)
returns void language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_result_set_id is null then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end if;
  perform public.statsedge_lock_result_sets_v1(array[p_result_set_id]);
end;
$$;

create or replace function public.statsedge_assert_execution_lease_v1(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint
)
returns table(owner_id text, scan_id uuid, execution_id uuid, result_set_id uuid, lease_epoch bigint)
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_scan public.scans%rowtype; v_execution public.scan_executions%rowtype; v_set public.scan_result_sets%rowtype;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  perform public.statsedge_lock_result_set_v1(p_result_set_id);
  -- The advisory key is held before these row locks. Re-read every linked
  -- record after acquiring it; callers must never trust pre-lock state.
  select * into v_scan from public.scans where id = p_scan_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_SCAN_NOT_FOUND'; end if;
  if v_scan.owner_id is distinct from p_owner_id then raise exception using errcode = 'P0001', message = 'SE_OWNER_MISMATCH'; end if;
  if v_scan.active_execution_id is distinct from p_execution_id or v_scan.active_result_set_id is distinct from p_result_set_id then
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  select * into v_execution from public.scan_executions where id = p_execution_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if v_execution.owner_id is distinct from v_scan.owner_id or v_execution.scan_id is distinct from v_scan.id or v_execution.result_set_id is distinct from p_result_set_id then
    raise exception using errcode = 'P0001', message = 'SE_OWNER_MISMATCH';
  end if;
  select * into v_set from public.scan_result_sets where id = p_result_set_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if v_set.owner_id is distinct from v_scan.owner_id or v_set.scan_id is distinct from v_scan.id or v_set.execution_id is distinct from v_execution.id then
    raise exception using errcode = 'P0001', message = 'SE_OWNER_MISMATCH';
  end if;
  if v_set.state is distinct from 'staging' or v_scan.published_result_set_id is not distinct from v_set.id then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end if;
  if v_execution.state is distinct from 'running' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if v_execution.lease_epoch is distinct from v_scan.lease_epoch or v_execution.lease_until is distinct from v_scan.lease_until then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_lease_epoch < v_scan.lease_epoch then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_lease_epoch is distinct from v_scan.lease_epoch or p_lease_epoch is distinct from v_execution.lease_epoch then raise exception using errcode = 'P0001', message = 'SE_LEASE_CONFLICT'; end if;
  if v_scan.lease_until is null or v_execution.lease_until is null or v_scan.lease_until <= clock_timestamp() then raise exception using errcode = 'P0001', message = 'SE_LEASE_EXPIRED'; end if;
  return query select v_scan.owner_id, v_scan.id, v_execution.id, v_execution.result_set_id, v_scan.lease_epoch;
end;
$$;

create or replace function public.begin_scan_execution(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint,
  p_idempotency_key text, p_input jsonb, p_methodology jsonb, p_lease_seconds integer default 60
)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_scan public.scans%rowtype;
  v_existing public.scan_executions%rowtype;
  v_existing_set public.scan_result_sets%rowtype;
  v_epoch bigint;
  v_input_hash text;
  v_methodology_hash text;
  v_hash text;
  v_until timestamptz;
  v_expected_text text;
  v_expected_count integer;
  v_count integer;
  v_id uuid;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if nullif(btrim(p_idempotency_key), '') is null or p_execution_id is null or p_result_set_id is null
    or p_lease_seconds is null or p_lease_seconds < 1
    or p_input is null or p_methodology is null
    or jsonb_typeof(p_input) is distinct from 'object'
    or jsonb_typeof(p_methodology) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end if;
  v_expected_text := p_input ->> 'expectedCount';
  if v_expected_text is null or v_expected_text !~ '^[1-9][0-9]*$' then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end if;
  begin
    v_expected_count := v_expected_text::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end;
  if v_expected_count < 1 then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;

  perform public.statsedge_lock_result_set_v1(p_result_set_id);
  select * into v_scan from public.scans where id = p_scan_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_SCAN_NOT_FOUND'; end if;
  if v_scan.owner_id is distinct from p_owner_id then raise exception using errcode = 'P0001', message = 'SE_OWNER_MISMATCH'; end if;
  -- A fresh execution must never recycle an identifier already named by the
  -- public pointer. Re-check this only after the common result-set lock.
  if v_scan.published_result_set_id is not distinct from p_result_set_id then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end if;
  v_input_hash := public.statsedge_pg_jsonb_sha256_v1(p_input);
  v_methodology_hash := public.statsedge_pg_jsonb_sha256_v1(p_methodology);
  v_hash := public.statsedge_pg_jsonb_sha256_v1(jsonb_build_object('input', p_input, 'methodology', p_methodology));
  select * into v_existing from public.scan_executions where owner_id = v_scan.owner_id and scan_id = v_scan.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.idempotency_hash is distinct from v_hash
      or v_existing.input_hash is distinct from v_input_hash
      or v_existing.methodology_hash is distinct from v_methodology_hash
      or v_existing.id is distinct from p_execution_id
      or v_existing.result_set_id is distinct from p_result_set_id
      or v_existing.issued_lease_epoch is null
      or v_existing.issued_lease_until is null then
      raise exception using errcode = 'P0001', message = 'SE_IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_existing_set from public.scan_result_sets where id = p_result_set_id for key share;
    if not found
      or v_existing_set.owner_id is distinct from v_scan.owner_id
      or v_existing_set.scan_id is distinct from v_scan.id
      or v_existing_set.execution_id is distinct from v_existing.id
      or v_existing_set.state is distinct from 'staging'
      or v_scan.published_result_set_id is not distinct from v_existing_set.id then
      raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
    end if;
    -- A begin replay returns the original issuance, not the current lease
    -- after a possible takeover. `replayed` makes that distinction explicit
    -- for callers and keeps this RPC's JSON shape stable.
    return jsonb_build_object(
      'execution_id', v_existing.id,
      'result_set_id', v_existing.result_set_id,
      'lease_epoch', v_existing.issued_lease_epoch,
      'lease_until', v_existing.issued_lease_until,
      'replayed', true
    );
  end if;
  -- The idempotency path above is the only legal way to reuse a result-set
  -- identifier. Do not wait for a uniqueness failure after taking other
  -- writes: the advisory key is held and this is the final pre-write read.
  select * into v_existing_set from public.scan_result_sets where id = p_result_set_id for key share;
  if found then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if p_lease_epoch is distinct from v_scan.lease_epoch then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if v_scan.active_execution_id is null and v_scan.active_result_set_id is null and v_scan.lease_until is null then
    null;
  elsif v_scan.active_execution_id is not null and v_scan.active_result_set_id is not null and v_scan.lease_until is not null then
    raise exception using errcode = 'P0001', message = 'SE_LEASE_CONFLICT';
  else
    raise exception using errcode = 'P0001', message = 'SE_FENCED';
  end if;
  v_epoch := v_scan.lease_epoch + 1;
  v_until := clock_timestamp() + make_interval(secs => p_lease_seconds);
  insert into public.scan_executions (id, owner_id, scan_id, lease_epoch, lease_until, issued_lease_epoch, issued_lease_until, idempotency_key, idempotency_hash, input_hash, methodology_hash, expected_count, checkpoint)
  values (p_execution_id, v_scan.owner_id, v_scan.id, v_epoch, v_until, v_epoch, v_until, p_idempotency_key, v_hash, v_input_hash, v_methodology_hash, v_expected_count, jsonb_build_object('cursor', 0))
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 or v_id is distinct from p_execution_id then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  insert into public.scan_result_sets (id, owner_id, scan_id, execution_id, expected_count)
  values (p_result_set_id, v_scan.owner_id, v_scan.id, p_execution_id, v_expected_count)
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 or v_id is distinct from p_result_set_id then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scan_executions set result_set_id = p_result_set_id, updated_at = clock_timestamp()
    where id = p_execution_id and owner_id = v_scan.owner_id and scan_id = v_scan.id and result_set_id is null
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scans set active_execution_id = p_execution_id, active_result_set_id = p_result_set_id, lease_epoch = v_epoch, lease_until = v_until
    where id = v_scan.id and lease_epoch is not distinct from p_lease_epoch
      and active_execution_id is null and active_result_set_id is null and lease_until is null
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object(
    'execution_id', p_execution_id,
    'result_set_id', p_result_set_id,
    'lease_epoch', v_epoch,
    'lease_until', v_until,
    'replayed', false
  );
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'SE_IDEMPOTENCY_CONFLICT';
end;
$$;

create or replace function public.resume_scan_execution(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_lease_seconds integer default 60
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$ declare v_tuple record; v_until timestamptz; v_count integer; v_id uuid;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_lease_seconds is null or p_lease_seconds < 1 then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select * into v_tuple from public.statsedge_assert_execution_lease_v1(p_owner_id, p_scan_id, p_execution_id, p_result_set_id, p_lease_epoch);
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  v_until := clock_timestamp() + make_interval(secs => p_lease_seconds);
  update public.scans set lease_until = v_until
    where id = v_tuple.scan_id and active_execution_id is not distinct from v_tuple.execution_id
      and active_result_set_id is not distinct from v_tuple.result_set_id and lease_epoch is not distinct from v_tuple.lease_epoch
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scan_executions set lease_until = v_until, updated_at = clock_timestamp()
    where id = v_tuple.execution_id and scan_id = v_tuple.scan_id and owner_id = v_tuple.owner_id
      and result_set_id is not distinct from v_tuple.result_set_id and lease_epoch is not distinct from v_tuple.lease_epoch
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('execution_id', v_tuple.execution_id, 'result_set_id', v_tuple.result_set_id, 'lease_epoch', v_tuple.lease_epoch, 'lease_until', v_until);
end;
$$;

create or replace function public.takeover_scan_execution(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_lease_seconds integer default 60
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$ declare v_scan public.scans%rowtype; v_execution public.scan_executions%rowtype; v_set public.scan_result_sets%rowtype; v_epoch bigint; v_until timestamptz; v_count integer; v_id uuid;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_lease_seconds is null or p_lease_seconds < 1 then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  perform public.statsedge_lock_result_set_v1(p_result_set_id);
  select * into v_scan from public.scans where id = p_scan_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_SCAN_NOT_FOUND'; end if;
  if v_scan.owner_id is distinct from p_owner_id then raise exception using errcode = 'P0001', message = 'SE_OWNER_MISMATCH'; end if;
  if v_scan.active_execution_id is distinct from p_execution_id or v_scan.active_result_set_id is distinct from p_result_set_id then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  select * into v_execution from public.scan_executions where id = p_execution_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if v_execution.owner_id is distinct from v_scan.owner_id or v_execution.scan_id is distinct from v_scan.id or v_execution.result_set_id is distinct from p_result_set_id then raise exception using errcode = 'P0001', message = 'SE_OWNER_MISMATCH'; end if;
  select * into v_set from public.scan_result_sets where id = p_result_set_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if v_set.owner_id is distinct from v_scan.owner_id or v_set.scan_id is distinct from v_scan.id or v_set.execution_id is distinct from v_execution.id then raise exception using errcode = 'P0001', message = 'SE_OWNER_MISMATCH'; end if;
  if v_set.state is distinct from 'staging' or v_scan.published_result_set_id is not distinct from v_set.id then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if v_execution.state is distinct from 'running' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if p_lease_epoch < v_scan.lease_epoch then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_lease_epoch is distinct from v_scan.lease_epoch or p_lease_epoch is distinct from v_execution.lease_epoch then raise exception using errcode = 'P0001', message = 'SE_LEASE_CONFLICT'; end if;
  if v_scan.lease_until is null or v_execution.lease_until is null or v_scan.lease_until is distinct from v_execution.lease_until then raise exception using errcode = 'P0001', message = 'SE_LEASE_CONFLICT'; end if;
  if v_scan.lease_until > clock_timestamp() then raise exception using errcode = 'P0001', message = 'SE_LEASE_CONFLICT'; end if;
  v_epoch := v_scan.lease_epoch + 1;
  v_until := clock_timestamp() + make_interval(secs => p_lease_seconds);
  update public.scans set lease_epoch = v_epoch, lease_until = v_until
    where id = v_scan.id and active_execution_id is not distinct from p_execution_id
      and active_result_set_id is not distinct from p_result_set_id and lease_epoch is not distinct from p_lease_epoch
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scan_executions set lease_epoch = v_epoch, lease_until = v_until, updated_at = clock_timestamp()
    where id = v_execution.id and owner_id = v_scan.owner_id and scan_id = v_scan.id
      and result_set_id is not distinct from p_result_set_id and lease_epoch is not distinct from p_lease_epoch
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('execution_id', v_execution.id, 'result_set_id', p_result_set_id, 'lease_epoch', v_epoch, 'lease_until', v_until);
end;
$$;

create or replace function public.register_scan_work_item(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_work_index integer, p_payload jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$ declare v_tuple record; v_hash text; v_identity text; v_item public.scan_work_items%rowtype; v_count integer; v_index integer;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_work_index is null or p_work_index < 0 or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select * into v_tuple from public.statsedge_assert_execution_lease_v1(p_owner_id, p_scan_id, p_execution_id, p_result_set_id, p_lease_epoch);
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  v_hash := public.statsedge_pg_jsonb_sha256_v1(p_payload);
  v_identity := public.statsedge_execution_identity_key_v1(p_payload);
  select * into v_item from public.scan_work_items where result_set_id = p_result_set_id and (work_index = p_work_index or identity_key = v_identity) for update;
  if found then
    if v_item.work_index is distinct from p_work_index or v_item.identity_key is distinct from v_identity or v_item.payload_hash is distinct from v_hash or v_item.payload is distinct from p_payload then raise exception using errcode = 'P0001', message = 'SE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('work_index', v_item.work_index, 'identity_key', v_item.identity_key, 'payload_hash', v_item.payload_hash, 'idempotent', true);
  end if;
  insert into public.scan_work_items(result_set_id, scan_id, owner_id, work_index, identity_key, payload, payload_hash, outcome, written_lease_epoch)
  values(p_result_set_id, v_tuple.scan_id, v_tuple.owner_id, p_work_index, v_identity, p_payload, v_hash, 'registered', p_lease_epoch)
  returning work_index into v_index;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 or v_index is distinct from p_work_index then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('work_index', p_work_index, 'identity_key', v_identity, 'payload_hash', v_hash, 'idempotent', false);
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'SE_IDEMPOTENCY_CONFLICT';
end;
$$;

create or replace function public.persist_scan_result(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_work_index integer, p_row jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$ declare v_tuple record; v_item public.scan_work_items%rowtype; v_existing public.scan_result_set_rows%rowtype; v_hash text; v_identity text; v_count integer; v_index integer;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_work_index is null or p_work_index < 0 or p_row is null or jsonb_typeof(p_row) is distinct from 'object' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select * into v_tuple from public.statsedge_assert_execution_lease_v1(p_owner_id, p_scan_id, p_execution_id, p_result_set_id, p_lease_epoch);
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  select * into v_item from public.scan_work_items where result_set_id = p_result_set_id and work_index = p_work_index for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if v_item.owner_id is distinct from v_tuple.owner_id or v_item.scan_id is distinct from v_tuple.scan_id then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  v_hash := public.statsedge_pg_jsonb_sha256_v1(p_row);
  v_identity := public.statsedge_execution_identity_key_v1(p_row);
  if v_identity is distinct from v_item.identity_key then raise exception using errcode = 'P0001', message = 'SE_IDEMPOTENCY_CONFLICT'; end if;
  select * into v_existing from public.scan_result_set_rows where result_set_id = p_result_set_id and work_index = p_work_index for update;
  if found then
    if v_existing.identity_key is distinct from v_identity or v_existing.payload is distinct from p_row or v_existing.payload_hash is distinct from v_hash or v_existing.row_hash is distinct from v_hash then raise exception using errcode = 'P0001', message = 'SE_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('work_index', p_work_index, 'row_hash', v_hash, 'idempotent', true);
  end if;
  if v_item.outcome is distinct from 'registered' or v_item.row_hash is not null then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  update public.scan_work_items set outcome = 'persisted', row_hash = v_hash, written_lease_epoch = p_lease_epoch, updated_at = clock_timestamp()
    where result_set_id = p_result_set_id and work_index = p_work_index and outcome is not distinct from 'registered' and row_hash is null
  returning work_index into v_index;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  insert into public.scan_result_set_rows(result_set_id, scan_id, owner_id, work_index, identity_key, payload, payload_hash, row_hash)
  values(p_result_set_id, v_tuple.scan_id, v_tuple.owner_id, p_work_index, v_identity, p_row, v_hash, v_hash)
  returning work_index into v_index;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 or v_index is distinct from p_work_index then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('work_index', p_work_index, 'row_hash', v_hash, 'idempotent', false);
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'SE_IDEMPOTENCY_CONFLICT';
end;
$$;

create or replace function public.complete_scan_work_item(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_work_index integer, p_outcome text, p_reason jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$ declare v_tuple record; v_item public.scan_work_items%rowtype; v_count integer; v_index integer;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_work_index is null or p_work_index < 0 or p_outcome is null or p_outcome not in ('excluded', 'failed', 'cancelled') or p_reason is null or jsonb_typeof(p_reason) is distinct from 'object' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select * into v_tuple from public.statsedge_assert_execution_lease_v1(p_owner_id, p_scan_id, p_execution_id, p_result_set_id, p_lease_epoch);
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  select * into v_item from public.scan_work_items where result_set_id = p_result_set_id and work_index = p_work_index for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if v_item.owner_id is distinct from v_tuple.owner_id or v_item.scan_id is distinct from v_tuple.scan_id then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if v_item.outcome is not distinct from p_outcome and v_item.error is not distinct from p_reason then return jsonb_build_object('work_index', p_work_index, 'outcome', p_outcome, 'idempotent', true); end if;
  if v_item.outcome is distinct from 'registered' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  update public.scan_work_items set outcome = p_outcome, error = p_reason, written_lease_epoch = p_lease_epoch, updated_at = clock_timestamp()
    where result_set_id = p_result_set_id and work_index = p_work_index and outcome is not distinct from 'registered'
  returning work_index into v_index;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('work_index', p_work_index, 'outcome', p_outcome, 'idempotent', false);
end;
$$;

create or replace function public.checkpoint_scan_execution(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_checkpoint jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_tuple record;
  v_execution public.scan_executions%rowtype;
  v_cursor_text text;
  v_old_cursor_text text;
  v_cursor bigint;
  v_old bigint;
  v_registered bigint;
  v_persisted bigint;
  v_completed bigint;
  v_failed bigint;
  v_cancelled bigint;
  v_rows bigint;
  v_count integer;
  v_id uuid;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_checkpoint is null or jsonb_typeof(p_checkpoint) is distinct from 'object' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  v_cursor_text := p_checkpoint ->> 'cursor';
  if v_cursor_text is null or v_cursor_text !~ '^[0-9]+$' or coalesce(p_checkpoint ->> 'requireComplete', 'false') not in ('true', 'false') then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  begin
    v_cursor := v_cursor_text::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end;
  select * into v_tuple from public.statsedge_assert_execution_lease_v1(p_owner_id, p_scan_id, p_execution_id, p_result_set_id, p_lease_epoch);
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  select * into v_execution from public.scan_executions where id = p_execution_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if jsonb_typeof(v_execution.checkpoint) is distinct from 'object' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  v_old_cursor_text := coalesce(v_execution.checkpoint ->> 'cursor', '0');
  if v_old_cursor_text !~ '^[0-9]+$' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  begin
    v_old := v_old_cursor_text::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE';
  end;
  if v_cursor < v_old then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select count(*), count(*) filter(where outcome = 'persisted'), count(*) filter(where outcome in ('excluded', 'failed', 'cancelled')), count(*) filter(where outcome = 'failed'), count(*) filter(where outcome = 'cancelled')
    into v_registered, v_persisted, v_completed, v_failed, v_cancelled
    from public.scan_work_items where result_set_id = p_result_set_id;
  select count(*) into v_rows from public.scan_result_set_rows where result_set_id = p_result_set_id;
  if v_registered > 2147483647 or v_persisted > 2147483647 or v_completed > 2147483647 or v_failed > 2147483647 or v_cancelled > 2147483647 then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if coalesce((p_checkpoint ->> 'requireComplete')::boolean, false) and (v_persisted + v_completed) < v_execution.expected_count then raise exception using errcode = 'P0001', message = 'SE_PENDING_WORK'; end if;
  update public.scan_executions
    set checkpoint = jsonb_build_object('cursor', v_cursor), registered_count = v_registered, persisted_count = v_persisted, completed_count = v_completed, failed_count = v_failed, cancelled_count = v_cancelled, updated_at = clock_timestamp()
    where id = v_tuple.execution_id and owner_id = v_tuple.owner_id and scan_id = v_tuple.scan_id
      and result_set_id is not distinct from v_tuple.result_set_id and lease_epoch is not distinct from v_tuple.lease_epoch
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scan_result_sets set ledger_count = v_registered, updated_at = clock_timestamp()
    where id = v_tuple.result_set_id and owner_id = v_tuple.owner_id and scan_id = v_tuple.scan_id and execution_id = v_tuple.execution_id
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('cursor', v_cursor, 'registered_count', v_registered, 'persisted_count', v_persisted, 'completed_count', v_completed, 'failed_count', v_failed, 'cancelled_count', v_cancelled, 'row_count', v_rows);
end;
$$;

create or replace function public.abandon_scan_execution(
  p_owner_id text, p_scan_id uuid, p_execution_id uuid, p_result_set_id uuid, p_lease_epoch bigint, p_reason jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$ declare v_tuple record; v_set public.scan_result_sets%rowtype; v_count integer; v_id uuid;
begin
  if p_lease_epoch is null then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  if p_reason is null or jsonb_typeof(p_reason) is distinct from 'object' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select * into v_tuple from public.statsedge_assert_execution_lease_v1(p_owner_id, p_scan_id, p_execution_id, p_result_set_id, p_lease_epoch);
  if not found then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  select * into v_set from public.scan_result_sets where id = p_result_set_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  if v_set.owner_id is distinct from v_tuple.owner_id or v_set.scan_id is distinct from v_tuple.scan_id or v_set.execution_id is distinct from v_tuple.execution_id or v_set.state is distinct from 'staging' then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  update public.scan_executions set state = 'abandoned', checkpoint = checkpoint || jsonb_build_object('abandon_reason', p_reason), finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_tuple.execution_id and owner_id = v_tuple.owner_id and scan_id = v_tuple.scan_id
      and result_set_id is not distinct from v_tuple.result_set_id and lease_epoch is not distinct from v_tuple.lease_epoch and state is not distinct from 'running'
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scan_result_sets set state = 'abandoned', abandoned_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_tuple.result_set_id and owner_id = v_tuple.owner_id and scan_id = v_tuple.scan_id and execution_id = v_tuple.execution_id and state is not distinct from 'staging'
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  update public.scans set active_execution_id = null, active_result_set_id = null, lease_until = null
    where id = v_tuple.scan_id and active_execution_id is not distinct from v_tuple.execution_id
      and active_result_set_id is not distinct from v_tuple.result_set_id and lease_epoch is not distinct from v_tuple.lease_epoch
  returning id into v_id;
  get diagnostics v_count = row_count;
  if v_count is distinct from 1 then raise exception using errcode = 'P0001', message = 'SE_FENCED'; end if;
  return jsonb_build_object('execution_id', p_execution_id, 'result_set_id', p_result_set_id, 'state', 'abandoned');
end;
$$;

create or replace function public.statsedge_published_result_set_sealed_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_set public.scan_result_sets%rowtype; v_execution public.scan_executions%rowtype;
begin
  -- `scans` is already locked by this trigger. The advisory attempt must be
  -- fail-closed, not a wait that can cycle with an inverse trigger/writer.
  perform public.statsedge_lock_result_sets_v1(array[
    case when tg_op = 'UPDATE' then old.published_result_set_id else null end,
    new.published_result_set_id
  ]);
  if new.published_result_set_id is null then return new; end if;
  select * into v_set from public.scan_result_sets where id = new.published_result_set_id for key share;
  if not found then raise exception using errcode = 'P0001', message = 'SE_INVALID_PUBLISHED_POINTER'; end if;
  select * into v_execution from public.scan_executions where id = v_set.execution_id for key share;
  if not found
    or v_set.owner_id is distinct from new.owner_id
    or v_set.scan_id is distinct from new.id
    or v_set.state is distinct from 'sealed'
    or v_execution.owner_id is distinct from v_set.owner_id
    or v_execution.scan_id is distinct from v_set.scan_id
    or v_execution.result_set_id is distinct from v_set.id then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_PUBLISHED_POINTER';
  end if;
  return new;
end;
$$;

drop trigger if exists scans_published_result_set_sealed_trg on public.scans;
create trigger scans_published_result_set_sealed_trg
before insert or update of published_result_set_id, owner_id on public.scans
for each row execute function public.statsedge_published_result_set_sealed_v1();

-- A published pointer is a permanent reference to a sealed artifact. The
-- forward trigger above protects pointer assignment; this inverse trigger
-- protects later state changes on the referenced result set.
create or replace function public.statsedge_published_result_set_state_lock_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_set public.scan_result_sets%rowtype; v_execution public.scan_executions%rowtype; v_pointer record;
begin
  -- `old` is already row-locked by UPDATE. On contention the common key
  -- rejects immediately, releasing that implicit lock with the statement.
  perform public.statsedge_lock_result_set_v1(old.id);
  select * into v_set from public.scan_result_sets where id = old.id for key share;
  if not found then raise exception using errcode = 'P0001', message = 'SE_INVALID_STATE'; end if;
  select * into v_execution from public.scan_executions where id = v_set.execution_id for key share;
  if not found
    or v_set.owner_id is distinct from old.owner_id
    or v_set.scan_id is distinct from old.scan_id
    or v_execution.owner_id is distinct from new.owner_id
    or v_execution.scan_id is distinct from new.scan_id
    or v_execution.result_set_id is distinct from old.id then
    raise exception using errcode = 'P0001', message = 'SE_INVALID_PUBLISHED_POINTER';
  end if;
  if new.state is not distinct from 'sealed' then return new; end if;

  select s.id, s.owner_id, s.published_result_set_id
    into v_pointer
    from public.scans s
   where s.published_result_set_id = old.id
   ;

  if found then
    if v_pointer.owner_id is distinct from old.owner_id or old.scan_id is distinct from v_pointer.id then
      raise exception using errcode = 'P0001', message = 'SE_INVALID_PUBLISHED_POINTER';
    end if;
    raise exception using errcode = 'P0001', message = 'SE_PUBLISHED_RESULT_SET_STATE_LOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists scan_result_sets_published_state_lock_trg on public.scan_result_sets;
create trigger scan_result_sets_published_state_lock_trg
before update of state, owner_id, scan_id on public.scan_result_sets
for each row execute function public.statsedge_published_result_set_state_lock_v1();

revoke all on function public.statsedge_execution_identity_key_v1(jsonb) from public;
revoke all on function public.statsedge_result_set_lock_key_v1(uuid) from public;
revoke all on function public.statsedge_lock_result_sets_v1(uuid[]) from public;
revoke all on function public.statsedge_lock_result_set_v1(uuid) from public;
revoke all on function public.statsedge_assert_execution_lease_v1(text,uuid,uuid,uuid,bigint) from public;
revoke all on function public.begin_scan_execution(text,uuid,uuid,uuid,bigint,text,jsonb,jsonb,integer) from public;
revoke all on function public.resume_scan_execution(text,uuid,uuid,uuid,bigint,integer) from public;
revoke all on function public.takeover_scan_execution(text,uuid,uuid,uuid,bigint,integer) from public;
revoke all on function public.register_scan_work_item(text,uuid,uuid,uuid,bigint,integer,jsonb) from public;
revoke all on function public.persist_scan_result(text,uuid,uuid,uuid,bigint,integer,jsonb) from public;
revoke all on function public.complete_scan_work_item(text,uuid,uuid,uuid,bigint,integer,text,jsonb) from public;
revoke all on function public.checkpoint_scan_execution(text,uuid,uuid,uuid,bigint,jsonb) from public;
revoke all on function public.abandon_scan_execution(text,uuid,uuid,uuid,bigint,jsonb) from public;
revoke all on function public.statsedge_published_result_set_sealed_v1() from public;
revoke all on function public.statsedge_published_result_set_state_lock_v1() from public;
do $$ declare r text; f text; begin
  foreach f in array array[
    'statsedge_execution_identity_key_v1(jsonb)',
    'statsedge_result_set_lock_key_v1(uuid)',
    'statsedge_lock_result_sets_v1(uuid[])',
    'statsedge_lock_result_set_v1(uuid)',
    'statsedge_assert_execution_lease_v1(text,uuid,uuid,uuid,bigint)',
    'begin_scan_execution(text,uuid,uuid,uuid,bigint,text,jsonb,jsonb,integer)',
    'resume_scan_execution(text,uuid,uuid,uuid,bigint,integer)',
    'takeover_scan_execution(text,uuid,uuid,uuid,bigint,integer)',
    'register_scan_work_item(text,uuid,uuid,uuid,bigint,integer,jsonb)',
    'persist_scan_result(text,uuid,uuid,uuid,bigint,integer,jsonb)',
    'complete_scan_work_item(text,uuid,uuid,uuid,bigint,integer,text,jsonb)',
    'checkpoint_scan_execution(text,uuid,uuid,uuid,bigint,jsonb)',
    'abandon_scan_execution(text,uuid,uuid,uuid,bigint,jsonb)',
    'statsedge_published_result_set_sealed_v1()',
    'statsedge_published_result_set_state_lock_v1()'
  ] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists(select 1 from pg_roles where rolname = r) then execute format('revoke all on function public.%s from %I', f, r); end if;
    end loop;
  end loop;
end $$;

reset statement_timeout;
reset lock_timeout;
