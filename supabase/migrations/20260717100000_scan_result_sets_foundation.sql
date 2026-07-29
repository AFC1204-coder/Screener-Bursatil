-- Hito 1A: additive foundation only. Verified rows live outside the legacy
-- scan_results surface so staging can never be observed by existing readers.
-- This migration does not publish, seal, backfill, grant DML, or create RPCs.
-- STATS_EDGE_HITO_1A_FOUNDATION_BEGIN
--
-- This migration must run only in a human-authorized maintenance window with
-- scans and jobs paused. It is transactional, so CREATE INDEX CONCURRENTLY is
-- deliberately unavailable. These session limits make lock acquisition fail
-- closed rather than waiting behind live writers.
set lock_timeout = '5s';
set statement_timeout = '5min';

create extension if not exists pgcrypto;

alter table public.scans add column if not exists active_execution_id uuid;
alter table public.scans add column if not exists active_result_set_id uuid;
alter table public.scans add column if not exists published_result_set_id uuid;
alter table public.scans add column if not exists lease_epoch bigint not null default 0;
alter table public.scans add column if not exists lease_until timestamptz;
alter table public.scans add column if not exists published_state text default 'legacy_unknown';
alter table public.scans add column if not exists published_at timestamptz;
alter table public.scans add column if not exists published_updated_at timestamptz;

-- Required by every owner-scoped composite FK below. The primary key already
-- makes id unique; this index additionally makes ownership part of the key.
create unique index if not exists scans_owner_id_id_key
  on public.scans(owner_id, id);

create table if not exists public.scan_executions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  scan_id uuid not null,
  result_set_id uuid,
  lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  state text not null default 'running'
    check (state in ('running', 'finalizing', 'ready_to_publish', 'published', 'failed', 'cancelled', 'abandoned', 'legacy_unknown')),
  policy_version text not null default 'statsedge-scan-execution-v1',
  hash_version text not null default 'statsedge-pg-jsonb-sha256-v1',
  expected_count integer not null default 0 check (expected_count >= 0),
  registered_count integer not null default 0 check (registered_count >= 0),
  persisted_count integer not null default 0 check (persisted_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  cancelled_count integer not null default 0 check (cancelled_count >= 0),
  checkpoint jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalizing_at timestamptz,
  finished_at timestamptz,
  constraint scan_executions_scan_fk
    foreign key (owner_id, scan_id)
    references public.scans(owner_id, id)
    on delete cascade,
  constraint scan_executions_owner_scan_id_key unique (owner_id, scan_id, id)
);

create table if not exists public.scan_result_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  scan_id uuid not null,
  execution_id uuid not null,
  integrity_class text not null default 'verified'
    check (integrity_class in ('verified', 'legacy_unknown')),
  state text not null default 'staging'
    check (state in ('staging', 'sealed', 'abandoned', 'legacy_unknown')),
  hash_version text not null default 'statsedge-pg-jsonb-sha256-v1',
  expected_count integer not null default 0 check (expected_count >= 0),
  row_count integer not null default 0 check (row_count >= 0),
  ledger_count integer not null default 0 check (ledger_count >= 0),
  set_hash text,
  created_at timestamptz not null default now(),
  sealed_at timestamptz,
  abandoned_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint scan_result_sets_scan_fk
    foreign key (owner_id, scan_id)
    references public.scans(owner_id, id)
    on delete cascade,
  constraint scan_result_sets_execution_fk
    foreign key (owner_id, scan_id, execution_id)
    references public.scan_executions(owner_id, scan_id, id)
    on delete no action
    deferrable initially deferred,
  constraint scan_result_sets_owner_scan_id_key unique (owner_id, scan_id, id),
  constraint scan_result_sets_owner_scan_execution_key unique (owner_id, scan_id, execution_id),
  constraint scan_result_sets_execution_identity_key unique (owner_id, scan_id, execution_id, id),
  constraint scan_result_sets_snapshot_source_key
    unique (owner_id, scan_id, execution_id, id, set_hash, hash_version)
);

create table if not exists public.scan_work_items (
  result_set_id uuid not null,
  scan_id uuid not null,
  owner_id text not null default 'personal',
  work_index integer not null check (work_index >= 0),
  identity_key text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  outcome text check (outcome is null or outcome in ('registered', 'persisted', 'completed', 'failed', 'cancelled')),
  row_hash text,
  error jsonb,
  written_lease_epoch bigint check (written_lease_epoch is null or written_lease_epoch >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scan_work_items_pkey primary key (result_set_id, work_index),
  constraint scan_work_items_result_set_identity_key unique (result_set_id, identity_key),
  constraint scan_work_items_result_set_fk
    foreign key (owner_id, scan_id, result_set_id)
    references public.scan_result_sets(owner_id, scan_id, id)
    on delete cascade,
  -- Referenced by scan_result_set_rows so identity and row hash must agree
  -- with the exact ledger item, rather than merely sharing a result_set_id.
  constraint scan_work_items_exact_row_key
    unique (owner_id, scan_id, result_set_id, work_index, identity_key, row_hash)
);

create table if not exists public.scan_result_set_rows (
  result_set_id uuid not null,
  scan_id uuid not null,
  owner_id text not null default 'personal',
  work_index integer not null check (work_index >= 0),
  identity_key text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  row_hash text not null,
  hash_version text not null default 'statsedge-pg-jsonb-sha256-v1',
  row_schema_version text not null default 'statsedge-scan-result-row-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scan_result_set_rows_pkey primary key (result_set_id, work_index),
  constraint scan_result_set_rows_result_set_identity_key unique (result_set_id, identity_key),
  constraint scan_result_set_rows_result_set_fk
    foreign key (owner_id, scan_id, result_set_id)
    references public.scan_result_sets(owner_id, scan_id, id)
    on delete cascade,
  constraint scan_result_set_rows_work_item_fk
    foreign key (owner_id, scan_id, result_set_id, work_index, identity_key, row_hash)
    references public.scan_work_items(owner_id, scan_id, result_set_id, work_index, identity_key, row_hash)
    on delete cascade
    deferrable initially deferred
);

-- Legacy storage remains readable and writable only through its existing
-- paths. These nullable columns are lineage hooks for the future cutover; no
-- Hito 1A writer stores verified staging rows in public.scan_results.
alter table public.scan_results add column if not exists result_set_id uuid;
alter table public.scan_results add column if not exists work_index integer;
alter table public.scan_results add column if not exists identity_key text;
alter table public.scan_results add column if not exists payload_hash text;
alter table public.scan_results add column if not exists row_hash text;
alter table public.scan_results add column if not exists integrity_class text default 'legacy_unknown';

create table if not exists public.derived_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_kind text not null,
  snapshot_key text not null,
  -- `none` is an explicitly source-less snapshot. `result_set` preserves the
  -- copied source contract even after ON DELETE detaches only its live ID.
  source_kind text not null default 'none'
    check (source_kind in ('none', 'result_set')),
  source_result_set_id uuid,
  source_scan_id uuid,
  source_execution_id uuid,
  source_set_hash text,
  source_hash_version text,
  integrity_class text not null default 'verified'
    check (integrity_class in ('verified', 'legacy_unknown')),
  state text not null default 'staging'
    check (state in ('staging', 'sealed', 'abandoned', 'legacy_unknown')),
  hash_version text not null default 'statsedge-pg-jsonb-sha256-v1',
  expected_count integer not null default 0 check (expected_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  snapshot_hash text,
  created_at timestamptz not null default now(),
  sealed_at timestamptz,
  abandoned_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint derived_snapshots_source_contract_check
    check (
      (source_kind = 'none'
        and source_result_set_id is null
        and source_scan_id is null
        and source_execution_id is null
        and source_set_hash is null
        and source_hash_version is null)
      or
      (source_kind = 'result_set'
        and source_scan_id is not null
        and source_execution_id is not null
        and source_set_hash is not null
        and source_hash_version is not null)
    ),
  -- PostgreSQL 15+ column-list SET NULL keeps copied owner/scan provenance
  -- while clearing only the deleted result-set identifier.
  constraint derived_snapshots_source_result_set_fk
    foreign key (owner_id, source_scan_id, source_execution_id, source_result_set_id, source_set_hash, source_hash_version)
    references public.scan_result_sets(owner_id, scan_id, execution_id, id, set_hash, hash_version)
    on delete set null (source_result_set_id),
  constraint derived_snapshots_owner_kind_key_id_key
    unique (owner_id, snapshot_kind, snapshot_key, id)
);

create table if not exists public.derived_snapshot_items (
  snapshot_id uuid not null references public.derived_snapshots(id) on delete cascade,
  item_index integer not null check (item_index >= 0),
  identity_key text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  item_hash text,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, item_index),
  unique (snapshot_id, identity_key)
);

create table if not exists public.derived_snapshot_heads (
  owner_id text not null default 'personal',
  snapshot_kind text not null,
  snapshot_key text not null,
  snapshot_id uuid,
  published_at timestamptz,
  published_updated_at timestamptz,
  primary key (owner_id, snapshot_kind, snapshot_key),
  constraint derived_snapshot_heads_snapshot_fk
    foreign key (owner_id, snapshot_kind, snapshot_key, snapshot_id)
    references public.derived_snapshots(owner_id, snapshot_kind, snapshot_key, id)
    on delete no action
    deferrable initially deferred
);

-- Constraints added to pre-existing tables are NOT VALID so legacy rows are
-- not scanned. Each idempotency guard is scoped to schema, relation and name.
do $$
begin
  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scans'::regclass and c.conname = 'scans_active_execution_fk'
  ) then
    alter table public.scans add constraint scans_active_execution_fk
      foreign key (owner_id, id, active_execution_id)
      references public.scan_executions(owner_id, scan_id, id)
      on delete no action deferrable initially deferred not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scans'::regclass and c.conname = 'scans_active_result_set_fk'
  ) then
    alter table public.scans add constraint scans_active_result_set_fk
      foreign key (owner_id, id, active_result_set_id)
      references public.scan_result_sets(owner_id, scan_id, id)
      on delete no action deferrable initially deferred not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scans'::regclass and c.conname = 'scans_published_result_set_fk'
  ) then
    alter table public.scans add constraint scans_published_result_set_fk
      foreign key (owner_id, id, published_result_set_id)
      references public.scan_result_sets(owner_id, scan_id, id)
      on delete no action deferrable initially deferred not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scan_executions'::regclass and c.conname = 'scan_executions_result_set_fk'
  ) then
    alter table public.scan_executions add constraint scan_executions_result_set_fk
      foreign key (owner_id, scan_id, id, result_set_id)
      references public.scan_result_sets(owner_id, scan_id, execution_id, id)
      on delete no action deferrable initially deferred not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scan_results'::regclass and c.conname = 'scan_results_result_set_fk'
  ) then
    alter table public.scan_results add constraint scan_results_result_set_fk
      foreign key (owner_id, scan_id, result_set_id)
      references public.scan_result_sets(owner_id, scan_id, id)
      on delete no action deferrable initially deferred not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scan_results'::regclass and c.conname = 'scan_results_work_item_fk'
  ) then
    alter table public.scan_results add constraint scan_results_work_item_fk
      foreign key (owner_id, scan_id, result_set_id, work_index, identity_key, row_hash)
      references public.scan_work_items(owner_id, scan_id, result_set_id, work_index, identity_key, row_hash)
      on delete no action deferrable initially deferred not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scans'::regclass and c.conname = 'scans_lease_epoch_check'
  ) then
    alter table public.scans add constraint scans_lease_epoch_check
      check (lease_epoch >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scans'::regclass and c.conname = 'scans_published_state_check'
  ) then
    alter table public.scans add constraint scans_published_state_check
      check (published_state is null or published_state in ('unpublished', 'published', 'legacy_unknown')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scan_results'::regclass and c.conname = 'scan_results_integrity_class_check'
  ) then
    alter table public.scan_results add constraint scan_results_integrity_class_check
      check (integrity_class is null or integrity_class in ('verified', 'legacy_unknown')) not valid;
  end if;

  -- Transitional physical barrier. It is intentionally stricter than the
  -- lineage hooks above: no Hito 1A writer can make a verified/staging row
  -- visible through legacy scan_results. The future cutover must explicitly
  -- replace this named constraint in the same transaction as its reader swap.
  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scan_results'::regclass and c.conname = 'scan_results_hito_1a_legacy_barrier_check'
  ) then
    alter table public.scan_results add constraint scan_results_hito_1a_legacy_barrier_check
      check (
        integrity_class = 'legacy_unknown'
        and result_set_id is null
        and work_index is null
        and identity_key is null
        and payload_hash is null
        and row_hash is null
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.conrelid = 'public.scan_results'::regclass and c.conname = 'scan_results_work_index_check'
  ) then
    alter table public.scan_results add constraint scan_results_work_index_check
      check (work_index is null or work_index >= 0) not valid;
  end if;
end $$;

create index if not exists scan_executions_owner_scan_created_idx
  on public.scan_executions(owner_id, scan_id, created_at desc);
create index if not exists scan_executions_scan_state_idx
  on public.scan_executions(scan_id, state, updated_at desc);
create index if not exists scan_result_sets_owner_scan_state_idx
  on public.scan_result_sets(owner_id, scan_id, state, created_at desc);
create index if not exists scan_result_sets_execution_idx
  on public.scan_result_sets(execution_id);
create index if not exists scan_work_items_result_set_outcome_idx
  on public.scan_work_items(result_set_id, outcome, work_index);
create index if not exists scan_executions_result_set_id_idx
  on public.scan_executions(result_set_id)
  where result_set_id is not null;
create index if not exists scan_results_result_set_work_item_idx
  on public.scan_results(result_set_id, work_index, identity_key, row_hash)
  where result_set_id is not null;
create index if not exists scans_active_execution_id_idx
  on public.scans(active_execution_id)
  where active_execution_id is not null;
create index if not exists scans_active_result_set_id_idx
  on public.scans(active_result_set_id)
  where active_result_set_id is not null;
create index if not exists scans_published_result_set_idx
  on public.scans(owner_id, published_result_set_id)
  where published_result_set_id is not null;
create index if not exists scans_published_result_set_id_idx
  on public.scans(published_result_set_id)
  where published_result_set_id is not null;
create index if not exists derived_snapshots_owner_kind_key_created_idx
  on public.derived_snapshots(owner_id, snapshot_kind, snapshot_key, created_at desc);
create index if not exists derived_snapshots_source_result_set_id_idx
  on public.derived_snapshots(source_result_set_id)
  where source_result_set_id is not null;
create index if not exists derived_snapshot_heads_snapshot_idx
  on public.derived_snapshot_heads(snapshot_id)
  where snapshot_id is not null;

alter table public.scan_executions enable row level security;
alter table public.scan_result_sets enable row level security;
alter table public.scan_work_items enable row level security;
alter table public.scan_result_set_rows enable row level security;
alter table public.derived_snapshots enable row level security;
alter table public.derived_snapshot_items enable row level security;
alter table public.derived_snapshot_heads enable row level security;

comment on column public.scan_executions.state is
  'Execution lifecycle. legacy_unknown represents imported history only and must not transition to running, finalizing, ready_to_publish, or published.';

create or replace function public.statsedge_derived_snapshot_source_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- FK ON DELETE SET NULL is the only permitted source-pointer transition.
  -- The copied provenance never changes, including after that detachment.
  if old.source_kind is distinct from new.source_kind
    or old.source_scan_id is distinct from new.source_scan_id
    or old.source_execution_id is distinct from new.source_execution_id
    or old.source_set_hash is distinct from new.source_set_hash
    or old.source_hash_version is distinct from new.source_hash_version
    or not (old.source_result_set_id is not distinct from new.source_result_set_id
      or (old.source_result_set_id is not null and new.source_result_set_id is null)) then
    raise exception 'derived snapshot source provenance is immutable in Hito 1A';
  end if;
  return new;
end;
$$;

create trigger derived_snapshots_source_immutable_trg
before update of source_kind, source_result_set_id, source_scan_id, source_execution_id, source_set_hash, source_hash_version
on public.derived_snapshots
for each row execute function public.statsedge_derived_snapshot_source_immutable_v1();

create or replace function public.statsedge_pg_jsonb_canonical_v1(p_value jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = pg_catalog, public
as $$
  select p_value::text;
$$;

do $statsedge_hash$
declare
  v_pgcrypto_schema text;
begin
  select n.nspname
    into v_pgcrypto_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';
  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto extension schema not found';
  end if;

  execute format($function$
    create or replace function public.statsedge_pg_jsonb_sha256_v1(p_value jsonb)
    returns text
    language sql
    immutable
    strict
    security invoker
    set search_path = pg_catalog, public
    as $body$
      select pg_catalog.encode(
        %I.digest(
          pg_catalog.convert_to(public.statsedge_pg_jsonb_canonical_v1(p_value), 'UTF8'),
          'sha256'
        ),
        'hex'
      );
    $body$;
  $function$, v_pgcrypto_schema);
end
$statsedge_hash$;

comment on function public.statsedge_pg_jsonb_canonical_v1(jsonb) is
  'Canonical JSONB text for statsedge-pg-jsonb-sha256-v1; JSONB key ordering is supplied by PostgreSQL.';
comment on function public.statsedge_pg_jsonb_sha256_v1(jsonb) is
  'SHA-256 text hash for statsedge-pg-jsonb-sha256-v1 using digest(convert_to(..., UTF8), sha256).';
comment on function public.statsedge_derived_snapshot_source_immutable_v1() is
  'Hito 1A: copied derived-snapshot source provenance is immutable; only the live result-set ID may detach on source deletion.';

revoke all on function public.statsedge_pg_jsonb_canonical_v1(jsonb) from public;
revoke all on function public.statsedge_pg_jsonb_sha256_v1(jsonb) from public;
revoke all on function public.statsedge_derived_snapshot_source_immutable_v1() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.statsedge_pg_jsonb_canonical_v1(jsonb) from anon';
    execute 'revoke all on function public.statsedge_pg_jsonb_sha256_v1(jsonb) from anon';
    execute 'revoke all on function public.statsedge_derived_snapshot_source_immutable_v1() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.statsedge_pg_jsonb_canonical_v1(jsonb) from authenticated';
    execute 'revoke all on function public.statsedge_pg_jsonb_sha256_v1(jsonb) from authenticated';
    execute 'revoke all on function public.statsedge_derived_snapshot_source_immutable_v1() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.statsedge_pg_jsonb_canonical_v1(jsonb) from service_role';
    execute 'revoke all on function public.statsedge_pg_jsonb_sha256_v1(jsonb) from service_role';
    execute 'revoke all on function public.statsedge_derived_snapshot_source_immutable_v1() from service_role';
  end if;
end $$;

-- Future RPC interfaces -- deliberately NOT created or connected in Hito 1A.
-- begin_scan_execution(owner_id text, scan_id uuid, execution_id uuid, policy_version text, expected_count integer)
-- resume_scan_execution(owner_id text, scan_id uuid, execution_id uuid, lease_epoch bigint)
-- register_scan_work_item(owner_id text, execution_id uuid, work_index integer, identity_key text, payload jsonb, payload_hash text)
-- persist_scan_result(owner_id text, execution_id uuid, work_index integer, row jsonb, row_hash text, lease_epoch bigint)
-- complete_scan_work_item(owner_id text, execution_id uuid, work_index integer, outcome text, error jsonb, lease_epoch bigint)
-- checkpoint_scan_execution(owner_id text, execution_id uuid, checkpoint jsonb, lease_epoch bigint)
-- finalize_scan_execution(owner_id text, execution_id uuid, set_hash text, lease_epoch bigint)
-- abandon_scan_execution(owner_id text, execution_id uuid, reason jsonb, lease_epoch bigint)
-- takeover_scan_execution(owner_id text, scan_id uuid, previous_execution_id uuid, lease_epoch bigint)
-- publish_scan_result_set(owner_id text, scan_id uuid, result_set_id uuid, lease_epoch bigint)
-- begin_derived_snapshot(owner_id text, snapshot_kind text, snapshot_key text, source_result_set_id uuid, expected_count integer)
-- persist_derived_snapshot_items(owner_id text, snapshot_id uuid, items jsonb)
-- publish_derived_snapshot(owner_id text, snapshot_id uuid)

reset statement_timeout;
reset lock_timeout;
-- STATS_EDGE_HITO_1A_FOUNDATION_END
