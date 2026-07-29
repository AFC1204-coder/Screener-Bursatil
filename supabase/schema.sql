-- StatsEdge V1 cloud persistence.
-- Run this in the Supabase SQL editor before setting the env vars in Vercel/local.

create extension if not exists pgcrypto;

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  local_id text not null,
  name text not null,
  preset text,
  settings jsonb not null default '{}'::jsonb,
  market_score numeric,
  market_regime text,
  row_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, local_id)
);

alter table scans add column if not exists deleted_at timestamptz;

create table if not exists scan_results (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  scan_id uuid not null references scans(id) on delete cascade,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  rank_index integer,
  total_score numeric,
  weinstein_score numeric,
  minervini_score numeric,
  risk_score numeric,
  rs_rating numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- STATS_EDGE_HITO_1A_FOUNDATION_BEGIN
-- Hito 1A: additive foundation only. Verified rows live outside the legacy
-- scan_results surface so staging can never be observed by existing readers.
-- The same catalog is preserved in the upgrade migration.
--
-- Apply only in a human-authorized maintenance window with scans and jobs
-- paused. This script is transactional, so CREATE INDEX CONCURRENTLY is not
-- available; the limits below fail closed if live writers hold a lock.
set lock_timeout = '5s';
set statement_timeout = '5min';

alter table public.scans add column if not exists active_execution_id uuid;
alter table public.scans add column if not exists active_result_set_id uuid;
alter table public.scans add column if not exists published_result_set_id uuid;
alter table public.scans add column if not exists lease_epoch bigint not null default 0;
alter table public.scans add column if not exists lease_until timestamptz;
alter table public.scans add column if not exists published_state text default 'legacy_unknown';
alter table public.scans add column if not exists published_at timestamptz;
alter table public.scans add column if not exists published_updated_at timestamptz;

create unique index if not exists scans_owner_id_id_key
  on public.scans(owner_id, id);

-- Nullable lineage only. Verified staging rows live in scan_result_set_rows;
-- existing scan_results writers and readers remain unchanged in Hito 1A.
alter table public.scan_results add column if not exists result_set_id uuid;
alter table public.scan_results add column if not exists work_index integer;
alter table public.scan_results add column if not exists identity_key text;
alter table public.scan_results add column if not exists payload_hash text;
alter table public.scan_results add column if not exists row_hash text;
alter table public.scan_results add column if not exists integrity_class text default 'legacy_unknown';

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

create table if not exists public.derived_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_kind text not null,
  snapshot_key text not null,
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

  -- Cutover must explicitly replace this named barrier in the same transaction
  -- as the reader swap. Until then no new staging/verified row can occupy the
  -- legacy scan_results surface.
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

create index if not exists scan_executions_owner_scan_created_idx on public.scan_executions(owner_id, scan_id, created_at desc);
create index if not exists scan_executions_scan_state_idx on public.scan_executions(scan_id, state, updated_at desc);
create index if not exists scan_result_sets_owner_scan_state_idx on public.scan_result_sets(owner_id, scan_id, state, created_at desc);
create index if not exists scan_result_sets_execution_idx on public.scan_result_sets(execution_id);
create index if not exists scan_work_items_result_set_outcome_idx on public.scan_work_items(result_set_id, outcome, work_index);
create index if not exists scan_executions_result_set_id_idx on public.scan_executions(result_set_id) where result_set_id is not null;
create index if not exists scan_results_result_set_work_item_idx on public.scan_results(result_set_id, work_index, identity_key, row_hash) where result_set_id is not null;
create index if not exists scans_active_execution_id_idx on public.scans(active_execution_id) where active_execution_id is not null;
create index if not exists scans_active_result_set_id_idx on public.scans(active_result_set_id) where active_result_set_id is not null;
create index if not exists scans_published_result_set_idx on public.scans(owner_id, published_result_set_id) where published_result_set_id is not null;
create index if not exists scans_published_result_set_id_idx on public.scans(published_result_set_id) where published_result_set_id is not null;
create index if not exists derived_snapshots_owner_kind_key_created_idx on public.derived_snapshots(owner_id, snapshot_kind, snapshot_key, created_at desc);
create index if not exists derived_snapshots_source_result_set_id_idx on public.derived_snapshots(source_result_set_id) where source_result_set_id is not null;
create index if not exists derived_snapshot_heads_snapshot_idx on public.derived_snapshot_heads(snapshot_id) where snapshot_id is not null;

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

drop trigger if exists derived_snapshots_source_immutable_trg on public.derived_snapshots;
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

-- STATS_EDGE_HITO_1B_1_BEGIN
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
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_set public.scan_result_sets%rowtype; v_execution public.scan_executions%rowtype;
begin
  -- `scans` is already locked by this trigger. The advisory attempt must be
  -- fail-closed, not a wait that can cycle with an inverse trigger/writer.
  --
  -- SECURITY DEFINER (not invoker): this trigger fires on every insert/update
  -- of owner_id on public.scans, including the ordinary legacy upsert that
  -- writeMaterializedScan performs over PostgREST as service_role. The
  -- internal helper below has EXECUTE revoked from service_role as part of
  -- the Hito 1B-1 contract (see the nearby revoke block and the ACL
  -- assertions in tests/integration/scan-execution-lifecycle.real.test.mjs).
  -- As `security invoker` this function inherited that restriction and broke
  -- every legacy write the instant this schema reached production. DEFINER
  -- runs it as its owner (postgres), who the revoke never touched — the
  -- service_role revocation itself stays completely intact; only the
  -- trigger's own internal call is exempted.
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
-- STATS_EDGE_HITO_1B_1_END

-- STATS_EDGE_HITO_1B_2_BEGIN
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
-- STATS_EDGE_HITO_1B_2_END
-- Hito 1B-3: canonical DB-owned reader for an atomically published result set.
-- This reader deliberately has no legacy scan_results fallback.
--
-- RECONSTRUCCION AUDITADA (2026-07-22): esta es una reconstruccion razonada de
-- la version final auditada, perdida en una limpieza de /tmp. Se parte de la
-- version pre-correccion recuperada y se aplican las 5 correcciones de la
-- auditoria estatica. Las piezas de Hito 1B-2 referenciadas (manifiesto,
-- set-hash, CASE de estado derivado, estructura del receipt) se copiaron
-- VERBATIM del commit 3ab49df (rama codex/scan-integrity-result-sets,
-- supabase/migrations/20260719100000_scan_result_set_finalize_publish.sql),
-- no se asumieron.
--
-- DECISION DE DISENO (2026-07-23): el lector pasa de SECURITY INVOKER a
-- SECURITY DEFINER — el primero y unico de la base de codigo. Motivo: el
-- contrato absoluto de 1B-1/1B-2 (verificado por test) exige que los helpers
-- internos (canonical/sha256/identity_key/manifiesto/set-hash) NUNCA sean
-- ejecutables por service_role, y a la vez la aplicacion viva invoca este
-- lector con SUPABASE_SERVICE_ROLE_KEY. Con SECURITY INVOKER ambas cosas son
-- incompatibles: la ACL transitiva del lector exigiria EXECUTE de
-- service_role sobre los helpers. Con SECURITY DEFINER el cuerpo corre como
-- el owner de la funcion y service_role solo necesita EXECUTE sobre el lector
-- mismo. Esto ademas elimina el punto "-- AMBIGUO:" de la reconstruccion
-- (grants de tabla + politicas RLS para service_role): ya no aplica, ver el
-- bloque final de ACL.

create or replace function public.statsedge_published_result_read_fail_v1(p_code text)
returns boolean
language plpgsql
volatile
strict
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end;
$$;

create or replace function public.read_published_scan_result_set_v1(
  p_owner_id text,
  p_scan_id uuid,
  p_expected_result_set_id uuid,
  p_expected_set_hash text,
  p_after_work_index integer,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with input as materialized (
    select nullif(btrim(p_owner_id), '') as owner_id,
           p_after_work_index as after_work_index,
           p_limit as page_limit
  ), input_guard as materialized (
    select case
      when input.owner_id is null
        or p_scan_id is null
        or p_after_work_index is null
        or p_after_work_index < -1
        or p_limit is null
        or p_limit < 1
        or p_limit > 500
        or (p_expected_result_set_id is null) is distinct from (p_expected_set_hash is null)
        or (p_expected_result_set_id is null and p_after_work_index <> -1)
      then public.statsedge_published_result_read_fail_v1('SE_INVALID_PUBLISHED_RESULT_READ_INPUT')
      else true
    end as ok
    from input
  ), scan_snapshot as materialized (
    select s.*
      from public.scans s
      cross join input_guard guard
      cross join input
     where guard.ok
       and s.id = p_scan_id
       and s.owner_id = input.owner_id
  ), publication_snapshot as materialized (
    select s.id as scan_id,
           s.owner_id,
           s.published_result_set_id,
           s.published_state,
           s.row_count as scan_row_count,
           s.published_at,
           s.published_updated_at,
           rs.id as result_set_id,
           rs.execution_id,
           rs.integrity_class,
           rs.state as result_set_state,
           rs.hash_version as result_set_hash_version,
           rs.expected_count,
           rs.ledger_count,
           rs.row_count as result_set_row_count,
           rs.set_hash,
           rs.sealed_at,
           rs.abandoned_at,
           e.state as execution_state,
           e.hash_version as execution_hash_version,
           e.policy_version as execution_policy_version,
           e.expected_count as execution_expected_count,
           e.lease_epoch as execution_lease_epoch,
           e.issued_lease_epoch,
           e.issued_lease_until,
           e.registered_count,
           e.persisted_count,
           e.completed_count,
           e.failed_count,
           e.cancelled_count,
           e.finalizing_at,
           e.finished_at,
           e.checkpoint
      from scan_snapshot s
      left join public.scan_result_sets rs
        on rs.id = s.published_result_set_id
       and rs.owner_id = s.owner_id
       and rs.scan_id = s.id
      left join public.scan_executions e
        on e.id = rs.execution_id
       and e.owner_id = rs.owner_id
       and e.scan_id = rs.scan_id
       and e.result_set_id = rs.id
  ), row_integrity as materialized (
    select publication.*,
           coalesce((
             select count(*)
               from public.scan_result_set_rows r
              where r.result_set_id = publication.result_set_id
           ), 0)::bigint as persisted_row_count,
           exists (
             select 1
               from public.scan_result_set_rows r
               left join public.scan_work_items w
                 on w.result_set_id = r.result_set_id
                and w.work_index = r.work_index
              where r.result_set_id = publication.result_set_id
                and (
                  r.owner_id is distinct from publication.owner_id
                  or r.scan_id is distinct from publication.scan_id
                  or r.hash_version is distinct from 'statsedge-pg-jsonb-sha256-v1'
                  or r.row_schema_version is distinct from 'statsedge-scan-result-row-v1'
                  or r.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload)
                  or r.row_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(r.payload)
                  or r.identity_key is distinct from public.statsedge_execution_identity_key_v1(r.payload)
                  or w.result_set_id is null
                  or w.owner_id is distinct from r.owner_id
                  or w.scan_id is distinct from r.scan_id
                  or w.outcome is distinct from 'persisted'
                  or w.identity_key is distinct from r.identity_key
                  or w.row_hash is distinct from r.row_hash
                )
           ) as has_invalid_row
      from publication_snapshot publication
  ), ledger_integrity as materialized (
    -- Correccion 1: reconciliacion del ledger real dentro del mismo snapshot.
    -- Espejo de la reconciliacion fisica de finalize_scan_execution /
    -- statsedge_assert_terminal_replay_evidence_v1 (Hito 1B-2, commit 3ab49df).
    select ri.*,
           physical.physical_ledger_count,
           physical.physical_min_work_index,
           physical.physical_max_work_index,
           physical.physical_persisted_count,
           physical.physical_failed_count,
           physical.physical_cancelled_count,
           exists (
             select 1
               from public.scan_work_items w
               left join public.scan_result_set_rows r
                 on r.result_set_id = w.result_set_id
                and r.work_index = w.work_index
              where w.result_set_id = ri.result_set_id
                and (
                  w.owner_id is distinct from ri.owner_id
                  or w.scan_id is distinct from ri.scan_id
                  or w.outcome is null
                  or w.outcome not in ('persisted', 'excluded', 'failed', 'cancelled')
                  or w.written_lease_epoch is null
                  or w.written_lease_epoch < ri.issued_lease_epoch
                  or w.written_lease_epoch > ri.execution_lease_epoch
                  or w.payload_hash is distinct from public.statsedge_pg_jsonb_sha256_v1(w.payload)
                  or w.identity_key is distinct from public.statsedge_execution_identity_key_v1(w.payload)
                  or (w.outcome = 'persisted' and r.result_set_id is null)
                  or (w.outcome is distinct from 'persisted' and r.result_set_id is not null)
                )
           ) as has_invalid_work_item
      from row_integrity ri
      cross join lateral (
        select count(*)::bigint as physical_ledger_count,
               min(w.work_index) as physical_min_work_index,
               max(w.work_index) as physical_max_work_index,
               (count(*) filter (where w.outcome = 'persisted'))::bigint as physical_persisted_count,
               (count(*) filter (where w.outcome = 'failed'))::bigint as physical_failed_count,
               (count(*) filter (where w.outcome = 'cancelled'))::bigint as physical_cancelled_count
          from public.scan_work_items w
         where w.result_set_id = ri.result_set_id
      ) physical
  ), manifest_reconstruction as materialized (
    -- Correccion 1: el manifiesto canonico se reconstruye desde ledger y filas
    -- fisicas y se recalcula el hash canonico de Hito 1B-2. Las formas
    -- jsonb_build_object y el orden por work_index son copia verbatim de
    -- finalize_scan_execution (commit 3ab49df); statsedge_finalization_manifest_v1
    -- y statsedge_finalization_set_hash_v1 son las funciones reales de 1B-2 y
    -- son strict, asi que cualquier linaje roto (columna null) produce hash
    -- null, que nunca iguala a set_hash: fail-closed.
    select li.*,
           case
             when li.result_set_id is not null then
               public.statsedge_finalization_set_hash_v1(
                 public.statsedge_finalization_manifest_v1(
                   li.owner_id,
                   li.scan_id,
                   li.execution_id,
                   li.result_set_id,
                   li.execution_policy_version,
                   li.execution_hash_version,
                   li.execution_expected_count::bigint,
                   li.physical_ledger_count,
                   coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'work_index', w.work_index,
                       'identity_key', w.identity_key,
                       'payload', w.payload,
                       'payload_hash', w.payload_hash,
                       'outcome', w.outcome,
                       'row_hash', w.row_hash,
                       'error', w.error,
                       'written_lease_epoch', w.written_lease_epoch
                     ) order by w.work_index)
                       from public.scan_work_items w
                      where w.result_set_id = li.result_set_id
                   ), '[]'::jsonb),
                   coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'work_index', r.work_index,
                       'identity_key', r.identity_key,
                       'payload', r.payload,
                       'payload_hash', r.payload_hash,
                       'row_hash', r.row_hash,
                       'hash_version', r.hash_version,
                       'row_schema_version', r.row_schema_version,
                       'owner_id', r.owner_id,
                       'scan_id', r.scan_id,
                       'result_set_id', r.result_set_id
                     ) order by r.work_index)
                       from public.scan_result_set_rows r
                      where r.result_set_id = li.result_set_id
                   ), '[]'::jsonb)
                 )
               )
             else null
           end as recomputed_set_hash
      from ledger_integrity li
  ), validated_publication as materialized (
    select mr.*,
           derived.derived_finalization_state,
           receipt_source.receipt,
           -- coalesce(..., false): cualquier condicion NULL (columna ausente,
           -- receipt no-objeto, caches rotas) degrada a invalido, nunca a un
           -- estado que "parece" valido ni a un salto silencioso de la rama
           -- de rechazo. Fail-closed.
           coalesce((
             mr.published_state is not distinct from 'published'
             and mr.result_set_id is not null
             and mr.integrity_class is not distinct from 'verified'
             and mr.result_set_state is not distinct from 'sealed'
             and mr.result_set_hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'
             and mr.set_hash is not null
             and mr.sealed_at is not null
             and mr.abandoned_at is null
             and mr.execution_id is not null
             and mr.execution_state is not distinct from 'published'
             and mr.execution_hash_version is not distinct from 'statsedge-pg-jsonb-sha256-v1'
             -- Correccion 1: policy y linaje de lease del contrato 1B-2.
             and mr.execution_policy_version is not distinct from 'statsedge-scan-execution-v1'
             and mr.issued_lease_epoch is not null
             and mr.issued_lease_until is not null
             and mr.issued_lease_epoch >= 0
             and mr.execution_lease_epoch is not null
             and mr.issued_lease_epoch <= mr.execution_lease_epoch
             and mr.execution_expected_count is not distinct from mr.expected_count
             and mr.expected_count is not distinct from mr.ledger_count
             -- Correccion 1: el ledger fisico debe reconciliar con las caches.
             and mr.physical_ledger_count is not distinct from mr.expected_count
             and (mr.physical_ledger_count > 0 or mr.expected_count = 0)
             and (mr.physical_ledger_count = 0
               or (mr.physical_min_work_index = 0
                 and mr.physical_max_work_index = mr.expected_count - 1))
             and not mr.has_invalid_work_item
             -- Correccion 1: contadores cacheados contra contadores fisicos.
             and mr.registered_count is not distinct from mr.physical_ledger_count
             and mr.persisted_count is not distinct from mr.physical_persisted_count
             and mr.failed_count is not distinct from mr.physical_failed_count
             and mr.cancelled_count is not distinct from mr.physical_cancelled_count
             and mr.completed_count is not distinct from mr.physical_ledger_count - mr.physical_persisted_count
             and mr.persisted_row_count is not distinct from mr.physical_persisted_count
             and mr.result_set_row_count is not distinct from mr.persisted_count
             and mr.result_set_row_count is not distinct from mr.persisted_row_count
             and mr.scan_row_count is not distinct from mr.result_set_row_count
             -- Correccion 1: validacion criptografica del set_hash publicado
             -- contra el manifiesto reconstruido en este mismo snapshot.
             and mr.recomputed_set_hash is not null
             and mr.set_hash is not distinct from mr.recomputed_set_hash
             and mr.finalizing_at is not null
             and mr.finished_at is not null
             and mr.finalizing_at is not distinct from mr.finished_at
             and mr.sealed_at is not distinct from mr.finalizing_at
             and mr.published_at is not null
             and mr.published_updated_at is not null
             and mr.published_at is not distinct from mr.finalizing_at
             and mr.published_updated_at is not distinct from mr.finalizing_at
             -- Correccion 3: el estado no se acepta desde la cache; se deriva
             -- de los contadores fisicos y tanto finalization_state como
             -- receipt.state deben ser identicos al valor derivado.
             and derived.derived_finalization_state in ('complete', 'partial')
             and (mr.checkpoint ->> 'finalization_state') is not distinct from derived.derived_finalization_state
             and jsonb_typeof(receipt_source.receipt) is not distinct from 'object'
             and receipt_source.receipt ?& array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[]
             and not exists (
               select 1
                 from jsonb_object_keys(
                   case when jsonb_typeof(receipt_source.receipt) = 'object'
                     then receipt_source.receipt else '{}'::jsonb end
                 ) as receipt_key(key)
                where receipt_key.key <> all (array['owner_id','scan_id','execution_id','result_set_id','lease_epoch','state','set_hash','expected_count','ledger_count','persisted_count','failed_count','cancelled_count','row_count','replayed']::text[])
             )
             and receipt_source.receipt -> 'owner_id' is not distinct from to_jsonb(mr.owner_id)
             and receipt_source.receipt -> 'scan_id' is not distinct from to_jsonb(mr.scan_id)
             and receipt_source.receipt -> 'execution_id' is not distinct from to_jsonb(mr.execution_id)
             and receipt_source.receipt -> 'result_set_id' is not distinct from to_jsonb(mr.result_set_id)
             and receipt_source.receipt -> 'lease_epoch' is not distinct from to_jsonb(mr.execution_lease_epoch)
             and receipt_source.receipt -> 'state' is not distinct from to_jsonb(derived.derived_finalization_state)
             and receipt_source.receipt -> 'set_hash' is not distinct from to_jsonb(mr.recomputed_set_hash)
             and receipt_source.receipt -> 'expected_count' is not distinct from to_jsonb(mr.expected_count)
             and receipt_source.receipt -> 'ledger_count' is not distinct from to_jsonb(mr.physical_ledger_count)
             and receipt_source.receipt -> 'persisted_count' is not distinct from to_jsonb(mr.physical_persisted_count)
             and receipt_source.receipt -> 'failed_count' is not distinct from to_jsonb(mr.physical_failed_count)
             and receipt_source.receipt -> 'cancelled_count' is not distinct from to_jsonb(mr.physical_cancelled_count)
             and receipt_source.receipt -> 'row_count' is not distinct from to_jsonb(mr.persisted_row_count)
             and receipt_source.receipt -> 'replayed' is not distinct from 'false'::jsonb
             and not mr.has_invalid_row
           ), false) as is_valid
      from manifest_reconstruction mr
      cross join lateral (
        -- Correccion 3: CASE de estado derivado copiado VERBATIM de
        -- finalize_scan_execution y statsedge_assert_terminal_replay_evidence_v1
        -- (Hito 1B-2, commit 3ab49df). La secuencia citada por la auditoria
        -- ("cancelled, failed, complete, partial, failed") es literalmente
        -- correcta: "failed" aparece dos veces (ledger sin resultados y
        -- mayoria de fallos).
        select case
          when mr.physical_cancelled_count > 0 then 'cancelled'
          when mr.physical_persisted_count + mr.physical_failed_count = 0 then 'failed'
          when mr.physical_persisted_count > 0 and mr.physical_failed_count = 0 then 'complete'
          when mr.physical_failed_count > 0 and mr.physical_persisted_count >= mr.physical_failed_count then 'partial'
          else 'failed'
        end as derived_finalization_state
      ) derived
      cross join lateral (
        select mr.checkpoint -> 'finalization_receipt' as receipt
      ) receipt_source
  ), page_rows as materialized (
    select r.work_index,
           r.identity_key,
           r.row_hash,
           r.payload,
           row_number() over (order by r.work_index asc) as page_position
      from validated_publication publication
      cross join input
      join public.scan_result_set_rows r
        on r.result_set_id = publication.result_set_id
     where publication.is_valid
       and r.work_index > input.after_work_index
     order by r.work_index asc
     limit (select page_limit + 1 from input)
  )
  select case
    when exists (
      select 1
        from publication_snapshot publication
       where p_expected_result_set_id is not null
         and (
           publication.published_result_set_id is distinct from p_expected_result_set_id
           or (publication.published_result_set_id is not null
             and publication.result_set_id is not null
             and publication.set_hash is distinct from p_expected_set_hash)
         )
    ) then to_jsonb(public.statsedge_published_result_read_fail_v1('SE_PUBLICATION_CHANGED'))
    when exists (
      select 1
        from validated_publication publication
       where publication.published_result_set_id is not null
         and not publication.is_valid
    ) then to_jsonb(public.statsedge_published_result_read_fail_v1('SE_PUBLISHED_RESULT_INVALID'))
    when exists (select 1 from scan_snapshot where published_result_set_id is null) then
      jsonb_build_object(
        'contract_version', 'statsedge-published-scan-result-read-v1',
        'state', 'unpublished',
        'scan_id', p_scan_id,
        'result_set_id', null,
        'execution_id', null,
        'set_hash', null,
        'hash_version', null,
        'row_schema_version', null,
        'published_at', null,
        'published_updated_at', null,
        'row_count', 0,
        'rows', '[]'::jsonb,
        'has_more', false,
        'next_cursor', null
      )
    when exists (select 1 from validated_publication where is_valid) then (
      select jsonb_build_object(
        'contract_version', 'statsedge-published-scan-result-read-v1',
        'state', 'published',
        'scan_id', publication.scan_id,
        'result_set_id', publication.result_set_id,
        'execution_id', publication.execution_id,
        'set_hash', publication.set_hash,
        'hash_version', publication.result_set_hash_version,
        'row_schema_version', 'statsedge-scan-result-row-v1',
        'published_at', publication.published_at,
        'published_updated_at', publication.published_updated_at,
        'row_count', publication.result_set_row_count,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'work_index', page.work_index,
            'rank_index', page.work_index + 1,
            'identity_key', page.identity_key,
            'row_hash', page.row_hash,
            'payload', page.payload
          ) order by page.work_index asc)
          from page_rows page
          cross join input
         where page.page_position <= input.page_limit
        ), '[]'::jsonb),
        'has_more', exists (select 1 from page_rows page cross join input where page.page_position > input.page_limit),
        'next_cursor', case when exists (select 1 from page_rows page cross join input where page.page_position > input.page_limit) then jsonb_build_object(
          'result_set_id', publication.result_set_id,
          'set_hash', publication.set_hash,
          'after_work_index', (select max(page.work_index) from page_rows page cross join input where page.page_position <= input.page_limit)
        ) else null end
      )
      from validated_publication publication
      where publication.is_valid
    )
    else jsonb_build_object(
      'contract_version', 'statsedge-published-scan-result-read-v1',
      'state', 'not_found',
      'scan_id', p_scan_id,
      'result_set_id', null,
      'execution_id', null,
      'set_hash', null,
      'hash_version', null,
      'row_schema_version', null,
      'published_at', null,
      'published_updated_at', null,
      'row_count', 0,
      'rows', '[]'::jsonb,
      'has_more', false,
      'next_cursor', null
    )
  end
  from input_guard;
$$;

comment on function public.read_published_scan_result_set_v1(text, uuid, uuid, text, integer, integer)
  is 'Hito 1B-3 canonical DB-owned read of exactly one published scan result set.';

-- ACL del diseno SECURITY DEFINER (2026-07-23):
--
-- Owner del definer: no se fija con ALTER FUNCTION ... OWNER TO. El owner por
-- defecto es el rol que aplica esta migracion (postgres en Supabase, el
-- superusuario local en el harness efimero), que es el mismo rol que creo los
-- helpers y las tablas en 1A/1B-1/1B-2. Como owner de esos objetos conserva
-- EXECUTE y SELECT implicitos sobre ellos, asi que no hace falta ningun grant
-- adicional para que el cuerpo del lector funcione.
--
-- Contrato de roles: service_role recibe EXECUTE unicamente sobre las dos
-- funciones propias de 1B-3 (el lector y su helper de error). Los cinco
-- helpers heredados de 1A/1B-1/1B-2 vuelven al contrato absoluto de sus
-- migraciones de origen: revocados para public/anon/authenticated y TAMBIEN
-- para service_role. Esto deshace explicitamente los grants transitorios que
-- una version anterior de esta migracion concedio a service_role sobre esos
-- helpers (necesarios solo mientras el lector fue SECURITY INVOKER).
revoke all on function public.statsedge_published_result_read_fail_v1(text) from public;
revoke all on function public.read_published_scan_result_set_v1(text, uuid, uuid, text, integer, integer) from public;
do $$
declare function_name text; role_name text;
begin
  foreach function_name in array array[
    'statsedge_pg_jsonb_canonical_v1(jsonb)',
    'statsedge_pg_jsonb_sha256_v1(jsonb)',
    'statsedge_execution_identity_key_v1(jsonb)',
    'statsedge_finalization_manifest_v1(text,uuid,uuid,uuid,text,text,bigint,bigint,jsonb,jsonb)',
    'statsedge_finalization_set_hash_v1(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public', function_name);
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on function public.%s from %I', function_name, role_name);
      end if;
    end loop;
  end loop;
  foreach function_name in array array[
    'statsedge_published_result_read_fail_v1(text)',
    'read_published_scan_result_set_v1(text,uuid,uuid,text,integer,integer)'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on function public.%s from %I', function_name, role_name);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', function_name);
    end if;
  end loop;
end
$$;

-- Sin grants de tabla ni politicas RLS para service_role: con SECURITY
-- DEFINER las lecturas de tabla del cuerpo corren como el owner de la
-- funcion, que es tambien el owner de las tablas. Las cuatro tablas de 1B
-- tienen "enable row level security" pero NO "force row level security", asi
-- que el owner las lee sin necesitar politica alguna, y service_role no
-- necesita (ni recibe aqui) SELECT directo sobre ninguna tabla del lector.
-- (La version transitoria anterior anadia GRANT SELECT sobre 5 tablas mas
-- politicas using(true) para service_role; nunca se aplico fuera de bases
-- efimeras de test, por lo que basta con eliminar ese bloque sin revocaciones
-- compensatorias.)
create or replace function public.upsert_scan_newer_wins(
  p_owner_id text,
  p_scan jsonb,
  p_results jsonb
)
returns setof public.scans
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_scan_id uuid;
  v_accepted boolean := false;
begin
  if nullif(trim(coalesce(p_scan->>'local_id', '')), '') is null then
    return;
  end if;

  with incoming as (
    select
      coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
      nullif(trim(item.local_id), '') as local_id,
      coalesce(nullif(trim(item.name), ''), 'Snapshot') as name,
      nullif(trim(item.preset), '') as preset,
      coalesce(item.settings, '{}'::jsonb) as settings,
      item.market_score,
      nullif(trim(item.market_regime), '') as market_regime,
      coalesce(item.row_count, 0) as row_count,
      coalesce(item.created_at, item.updated_at, now()) as created_at,
      coalesce(item.updated_at, item.created_at, now()) as updated_at
    from jsonb_to_record(coalesce(p_scan, '{}'::jsonb)) as item(
      local_id text,
      name text,
      preset text,
      settings jsonb,
      market_score numeric,
      market_regime text,
      row_count integer,
      created_at timestamptz,
      updated_at timestamptz
    )
  ),
  upserted as (
    insert into public.scans (
      owner_id,
      local_id,
      name,
      preset,
      settings,
      market_score,
      market_regime,
      row_count,
      created_at,
      updated_at,
      deleted_at
    )
    select
      owner_id,
      local_id,
      name,
      preset,
      settings,
      market_score,
      market_regime,
      row_count,
      created_at,
      updated_at,
      null::timestamptz
    from incoming
    on conflict (owner_id, local_id) do update set
      name = excluded.name,
      preset = excluded.preset,
      settings = excluded.settings,
      market_score = excluded.market_score,
      market_regime = excluded.market_regime,
      row_count = excluded.row_count,
      created_at = least(public.scans.created_at, excluded.created_at),
      updated_at = excluded.updated_at,
      deleted_at = null
    where excluded.updated_at >= public.scans.updated_at
    returning public.scans.id
  )
  select id into v_scan_id from upserted;

  if v_scan_id is not null then
    v_accepted := true;
  else
    select s.id into v_scan_id
    from public.scans s
    where s.owner_id = coalesce(nullif(trim(p_owner_id), ''), 'personal')
      and s.local_id = coalesce(nullif(trim(p_scan->>'local_id'), ''), '')
    limit 1;
  end if;

  if v_accepted and v_scan_id is not null then
    delete from public.scan_results where scan_id = v_scan_id;

    insert into public.scan_results (
      owner_id,
      scan_id,
      symbol,
      company_name,
      country,
      sector,
      industry,
      theme,
      rank_index,
      total_score,
      weinstein_score,
      minervini_score,
      risk_score,
      rs_rating,
      metrics,
      raw
    )
    select
      coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
      v_scan_id,
      coalesce(nullif(trim(item.symbol), ''), '-') as symbol,
      nullif(trim(item.company_name), '') as company_name,
      nullif(trim(item.country), '') as country,
      nullif(trim(item.sector), '') as sector,
      nullif(trim(item.industry), '') as industry,
      nullif(trim(item.theme), '') as theme,
      item.rank_index,
      item.total_score,
      item.weinstein_score,
      item.minervini_score,
      item.risk_score,
      item.rs_rating,
      coalesce(item.metrics, '{}'::jsonb) as metrics,
      coalesce(item.raw, '{}'::jsonb) as raw
    from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as item(
      symbol text,
      company_name text,
      country text,
      sector text,
      industry text,
      theme text,
      rank_index integer,
      total_score numeric,
      weinstein_score numeric,
      minervini_score numeric,
      risk_score numeric,
      rs_rating numeric,
      metrics jsonb,
      raw jsonb
    )
    where nullif(trim(item.symbol), '') is not null;
  end if;

  -- ────────────────────────────────────────────────────────────────────────
  -- PURGA OPORTUNISTA (política de retención "últimos N scans por owner").
  --
  -- Política decidida por Fable (no rediseñar):
  --   1. Retención: conservar los N=3 scans MÁS RECIENTES por owner_id
  --      (ordenados por updated_at desc). Todo scan del mismo owner fuera de
  --      ese top-3 se elimina.
  --   2. Tombstones: cualquier scan con deleted_at no nulo Y anterior a 7 días
  --      desde now() se elimina, independientemente de si está en el top-3
  --      (un soft-delete de más de una semana ya no tiene valor de undo).
  --
  -- Ejecución: ocurre DENTRO de la misma transacción que el upsert exitoso
  -- (v_accepted=true), así la atomicidad cubre (a) el upsert, (b) el insert
  -- de scan_results, y (c) la purga. Si la purga falla, el upsert completo se
  -- revierte — no hay estado intermedio con "scan guardado pero sin purga".
  -- Si el upsert fue rechazado por stale (v_accepted=false), NO se purga: la
  -- spec exige atomicidad con el upsert exitoso, y un upsert rechazado no es
  -- "exitoso" — el caller retiene el derecho de reintentar y la purga no debe
  -- tener efectos colaterales sobre un write que no se aplicó.
  --
  -- Cascade: scan_results.scan_id references scans(id) ON DELETE CASCADE
  -- (ver DDL de scan_results arriba), así borrar de scans limpia
  -- automáticamente scan_results. NO se toca favorites ni favorite_snapshots
  -- (desacopladas: copy-on-favorite, sin FK hacia scans/scan_results).
  --
  -- Opportunity, no cron: la purga corre en cada upsert exitoso del owner.
  -- Como el upsert es la operación más frecuente de escritura, esto mantiene
  -- la tabla acotada sin necesidad de pg_cron (backstop de cron sería trabajo
  -- aparte — no implementado aquí).
  --
  -- N=3 es constante hardcodeada (dato decidido, no parámetro). Si en el
  -- futuro se quiere configurable, exponerlo como parámetro de la función
  -- requeriría migrar callers; fuera de scope de este cambio.
  -- ────────────────────────────────────────────────────────────────────────
  if v_accepted then
    declare
      v_owner text := coalesce(nullif(trim(p_owner_id), ''), 'personal');
      v_retention_count int := 3;
      v_tombstone_days int := 7;
    begin
      -- Paso 1: tombstones antiguos (>7 días). Soft-deletes del owner que ya
      -- no sirven ni para undo. Se eliminan antes que la retención por recencia
      -- por claridad de orden. (Tras el fix del paso 2, los tombstones nunca
      -- entran al ranking de retención, así que este paso ya no compite con
      -- la retención — simplemente limpia tombstones que cumplieron su plazo
      -- mínimo de undo. La política de 7 días es la ÚNICA regla que gobierna
      -- la desaparición de un tombstone.)
      delete from public.scans
      where owner_id = v_owner
        and deleted_at is not null
        and deleted_at < (now() - (v_tombstone_days || ' days')::interval);

      -- Paso 2: retención top-N. row_number() ordena por updated_at desc sobre
      -- los scans ACTIVOS (deleted_at is null) del owner. Los tombstones se
      -- excluyen explícitamente del ranking: aunque la purga de tombstones del
      -- paso 1 solo borra los >7 días, los tombstones recientes (<7d) tampoco
      -- deben competir por las N plazas — un tombstone reciente con updated_at
      -- alta podría desplazar a un scan activo real. La regla de 7 días gobierna
      -- la desaparición definitiva del tombstone; el ranking de retención solo
      -- opera sobre scans vivos. El cascade limpia scan_results automáticamente.
      delete from public.scans
      where id in (
        select id from (
          select
            s.id,
            row_number() over (
              partition by s.owner_id
              order by s.updated_at desc, s.created_at desc
            ) as rn
          from public.scans s
          where s.owner_id = v_owner
            and s.deleted_at is null
        ) ranked
        where ranked.rn > v_retention_count
      );
    end;
  end if;

  return query
  select *
  from public.scans
  where id = v_scan_id;
end;
$$;

revoke all on function public.upsert_scan_newer_wins(text, jsonb, jsonb) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.upsert_scan_newer_wins(text, jsonb, jsonb) to service_role;
  end if;
end $$;

-- finalize_scan_results: aplicador ATÓMICO de la finalización de percentiles RS.
-- Recibe un array JSONB de {id, metrics_patch} (uno por fila del scan) y hace un
-- único UPDATE masivo en una sola sentencia (Postgres la envuelve en su propia
-- transacción → todo o nada). Si la función revierte, ninguna fila queda tocada.
--
-- Por qué PL/pgSQL en vez de N PATCHes REST: el patrón anterior (PATCH por fila
-- con concurrencia 5) dejaba filas en estado mixto "final"/"batch" si el PATCH
-- k de N fallaba. Esta función garantiza atomicidad real: o las N filas reciben
-- sus nuevos percentiles + percentileScope="final", o ninguna lo hace.
--
-- Convención de la casa: SECURITY INVOKER + set search_path + revoke/grant a
-- service_role (la API usa SUPABASE_SERVICE_ROLE_KEY que bypasea RLS, ver
-- comentario al final del archivo). Igual que upsert_scan_newer_wins.
create or replace function public.finalize_scan_results(
  p_owner_id text,
  p_scan_id uuid,
  p_patches jsonb
)
returns table(updated_count integer)
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Sanity: el owner debe coincidir con el de la fila del scan. Esto evita que
  -- un payload malicioso o erróneo cruce fronteras de owner.
  if not exists (
    select 1 from public.scans
    where id = p_scan_id and owner_id = p_owner_id
  ) then
    raise exception 'scan % no pertenece al owner %', p_scan_id, p_owner_id
      using errcode = '21000';
  end if;

  -- UPDATE masivo desde el array JSONB. Cada item lleva el id de la fila y el
  -- blob metrics_patch completo (ya con los 3 percentiles nuevos +
  -- percentileScope: "final"). Usamos `||` para mergear sobre el metrics actual
  -- (conserva cualquier key no mencionada; el patch sobreescribe las que toca).
  -- El filtro scan_id/owner_id en el JOIN es defensa en profundidad, aunque el
  -- id ya es PK global.
  return query
  with source as (
    select *
    from jsonb_to_recordset(coalesce(p_patches, '[]'::jsonb)) as item(
      id uuid,
      metrics_patch jsonb
    )
  ),
  touched as (
    update public.scan_results as sr
    set metrics = sr.metrics || src.metrics_patch
    from source as src
    where sr.id = src.id
      and sr.scan_id = p_scan_id
      and sr.owner_id = p_owner_id
    returning 1
  )
  select count(*)::integer from touched;
end;
$$;

revoke all on function public.finalize_scan_results(text, uuid, jsonb) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.finalize_scan_results(text, uuid, jsonb) to service_role;
  end if;
end $$;

create or replace function public.delete_scan_newer_wins(
  p_owner_id text,
  p_local_id text,
  p_deleted_at timestamptz default now()
)
returns setof public.scans
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_scan_id uuid;
  v_accepted boolean := false;
begin
  with incoming as (
    select
      coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
      nullif(trim(p_local_id), '') as local_id,
      coalesce(p_deleted_at, now()) as deleted_at
  ),
  upserted as (
    insert into public.scans (
      owner_id,
      local_id,
      name,
      settings,
      row_count,
      created_at,
      updated_at,
      deleted_at
    )
    select
      owner_id,
      local_id,
      coalesce(local_id, 'Snapshot eliminado'),
      '{}'::jsonb,
      0,
      deleted_at,
      deleted_at,
      deleted_at
    from incoming
    where local_id is not null
    on conflict (owner_id, local_id) do update set
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
    where excluded.updated_at >= public.scans.updated_at
    returning public.scans.id
  )
  select id into v_scan_id from upserted;

  if v_scan_id is not null then
    v_accepted := true;
  else
    select s.id into v_scan_id
    from public.scans s
    where s.owner_id = coalesce(nullif(trim(p_owner_id), ''), 'personal')
      and s.local_id = nullif(trim(p_local_id), '')
    limit 1;
  end if;

  if v_accepted and v_scan_id is not null then
    delete from public.scan_results where scan_id = v_scan_id;
  end if;

  return query
  select *
  from public.scans
  where id = v_scan_id;
end;
$$;

revoke all on function public.delete_scan_newer_wins(text, text, timestamptz) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.delete_scan_newer_wins(text, text, timestamptz) to service_role;
  end if;
end $$;

create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  local_id text not null,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  added_at timestamptz not null default now(),
  entry_price numeric,
  last_price numeric,
  last_date date,
  source text,
  notes text not null default '',
  market_score numeric,
  market_regime text,
  snapshot jsonb not null default '{}'::jsonb,
  benchmark_symbol text,
  performance jsonb not null default '{}'::jsonb,
  current_state text,
  error text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, symbol)
);

alter table favorites add column if not exists deleted_at timestamptz;

create or replace function public.upsert_favorites_newer_wins(
  p_owner_id text,
  p_favorites jsonb
)
returns setof public.favorites
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with parsed as (
    select
      coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
      coalesce(nullif(trim(item.local_id), ''), gen_random_uuid()::text) as local_id,
      upper(nullif(trim(item.symbol), '')) as symbol,
      nullif(trim(item.company_name), '') as company_name,
      nullif(trim(item.country), '') as country,
      nullif(trim(item.sector), '') as sector,
      nullif(trim(item.industry), '') as industry,
      coalesce(item.added_at, item.updated_at, now()) as added_at,
      item.entry_price,
      item.last_price,
      item.last_date,
      coalesce(nullif(trim(item.source), ''), 'manual') as source,
      coalesce(item.notes, '') as notes,
      item.market_score,
      nullif(trim(item.market_regime), '') as market_regime,
      coalesce(item.snapshot, '{}'::jsonb) as snapshot,
      nullif(trim(item.benchmark_symbol), '') as benchmark_symbol,
      coalesce(item.performance, '{}'::jsonb) as performance,
      nullif(trim(item.current_state), '') as current_state,
      nullif(trim(item.error), '') as error,
      coalesce(item.updated_at, item.added_at, now()) as updated_at,
      null::timestamptz as deleted_at
    from jsonb_to_recordset(coalesce(p_favorites, '[]'::jsonb)) as item(
      local_id text,
      symbol text,
      company_name text,
      country text,
      sector text,
      industry text,
      added_at timestamptz,
      entry_price numeric,
      last_price numeric,
      last_date date,
      source text,
      notes text,
      market_score numeric,
      market_regime text,
      snapshot jsonb,
      benchmark_symbol text,
      performance jsonb,
      current_state text,
      error text,
      updated_at timestamptz
    )
    where nullif(trim(item.symbol), '') is not null
  ),
  incoming as (
    select distinct on (parsed.owner_id, parsed.symbol)
      parsed.*
    from parsed
    order by parsed.owner_id, parsed.symbol, parsed.updated_at desc, parsed.added_at desc
  ),
  upserted as (
    insert into public.favorites (
      owner_id,
      local_id,
      symbol,
      company_name,
      country,
      sector,
      industry,
      added_at,
      entry_price,
      last_price,
      last_date,
      source,
      notes,
      market_score,
      market_regime,
      snapshot,
      benchmark_symbol,
      performance,
      current_state,
      error,
      updated_at,
      deleted_at
    )
    select
      owner_id,
      local_id,
      symbol,
      company_name,
      country,
      sector,
      industry,
      added_at,
      entry_price,
      last_price,
      last_date,
      source,
      notes,
      market_score,
      market_regime,
      snapshot,
      benchmark_symbol,
      performance,
      current_state,
      error,
      updated_at,
      deleted_at
    from incoming
    on conflict (owner_id, symbol) do update set
      local_id = excluded.local_id,
      company_name = excluded.company_name,
      country = excluded.country,
      sector = excluded.sector,
      industry = excluded.industry,
      added_at = least(public.favorites.added_at, excluded.added_at),
      entry_price = excluded.entry_price,
      last_price = excluded.last_price,
      last_date = excluded.last_date,
      source = excluded.source,
      notes = excluded.notes,
      market_score = excluded.market_score,
      market_regime = excluded.market_regime,
      snapshot = excluded.snapshot,
      benchmark_symbol = excluded.benchmark_symbol,
      performance = excluded.performance,
      current_state = excluded.current_state,
      error = excluded.error,
      updated_at = excluded.updated_at,
      deleted_at = null
    where excluded.updated_at >= public.favorites.updated_at
    returning public.favorites.*
  ),
  returned as (
    select upserted.*
    from upserted
    union all
    select f.*
    from public.favorites f
    join incoming i on i.owner_id = f.owner_id and i.symbol = f.symbol
    where not exists (
      select 1
      from upserted u
      where u.owner_id = i.owner_id and u.symbol = i.symbol
    )
  )
  select returned.*
  from returned
  order by returned.added_at desc;
end;
$$;

revoke all on function public.upsert_favorites_newer_wins(text, jsonb) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.upsert_favorites_newer_wins(text, jsonb) to service_role;
  end if;
end $$;

create or replace function public.delete_favorite_newer_wins(
  p_owner_id text,
  p_symbol text default null,
  p_local_id text default null,
  p_deleted_at timestamptz default now()
)
returns setof public.favorites
language plpgsql
security invoker
set search_path = public
as $$
begin
  if nullif(trim(coalesce(p_symbol, '')), '') is not null then
    return query
    with incoming as (
      select
        coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
        coalesce(nullif(trim(p_local_id), ''), gen_random_uuid()::text) as local_id,
        upper(nullif(trim(p_symbol), '')) as symbol,
        coalesce(p_deleted_at, now()) as deleted_at
    ),
    upserted as (
      insert into public.favorites (
        owner_id,
        local_id,
        symbol,
        company_name,
        added_at,
        source,
        notes,
        snapshot,
        performance,
        updated_at,
        deleted_at
      )
      select
        owner_id,
        local_id,
        symbol,
        symbol,
        deleted_at,
        'deleted',
        '',
        '{}'::jsonb,
        '{}'::jsonb,
        deleted_at,
        deleted_at
      from incoming
      on conflict (owner_id, symbol) do update set
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
      where excluded.updated_at >= public.favorites.updated_at
      returning public.favorites.*
    ),
    returned as (
      select upserted.*
      from upserted
      union all
      select f.*
      from public.favorites f
      join incoming i on i.owner_id = f.owner_id and i.symbol = f.symbol
      where not exists (
        select 1
        from upserted u
        where u.owner_id = i.owner_id and u.symbol = i.symbol
      )
    )
    select returned.*
    from returned;
  elsif nullif(trim(coalesce(p_local_id, '')), '') is not null then
    return query
    with incoming as (
      select
        coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
        nullif(trim(p_local_id), '') as local_id,
        coalesce(p_deleted_at, now()) as deleted_at
    ),
    updated as (
      update public.favorites f
      set updated_at = incoming.deleted_at,
        deleted_at = incoming.deleted_at
      from incoming
      where f.owner_id = incoming.owner_id
        and f.local_id = incoming.local_id
        and incoming.deleted_at >= f.updated_at
      returning f.*
    ),
    returned as (
      select updated.*
      from updated
      union all
      select f.*
      from public.favorites f
      join incoming i on i.owner_id = f.owner_id and i.local_id = f.local_id
      where not exists (
        select 1
        from updated u
        where u.owner_id = i.owner_id and u.local_id = i.local_id
      )
    )
    select returned.*
    from returned;
  end if;
end;
$$;

revoke all on function public.delete_favorite_newer_wins(text, text, text, timestamptz) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.delete_favorite_newer_wins(text, text, text, timestamptz) to service_role;
  end if;
end $$;

create table if not exists favorite_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  favorite_id uuid references favorites(id) on delete cascade,
  symbol text not null,
  captured_at timestamptz not null default now(),
  price numeric,
  benchmark_symbol text,
  benchmark_price numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text,
  favorite_id uuid references favorites(id) on delete set null,
  title text,
  body text not null default '',
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  local_id text not null,
  symbol text not null,
  alert_type text not null,
  operator text,
  threshold numeric,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  triggered_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint alerts_owner_local_id_key unique (owner_id, local_id)
);

alter table alerts add column if not exists local_id text;
alter table alerts add column if not exists updated_at timestamptz;
update alerts set local_id = payload->>'localId' where local_id is null and payload ? 'localId';
update alerts set local_id = id::text where local_id is null;
update alerts set updated_at = coalesce(triggered_at, created_at, now()) where updated_at is null;
with ranked_alerts as (
  select id, local_id, row_number() over(partition by owner_id, local_id order by created_at desc, id desc) as duplicate_rank
  from alerts
  where local_id is not null
)
update alerts
set local_id = ranked_alerts.local_id || ':' || alerts.id::text
from ranked_alerts
where alerts.id = ranked_alerts.id and ranked_alerts.duplicate_rank > 1;
alter table alerts alter column local_id set not null;
alter table alerts alter column updated_at set default now();
alter table alerts alter column updated_at set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alerts_owner_local_id_key') then
    alter table alerts add constraint alerts_owner_local_id_key unique (owner_id, local_id);
  end if;
end $$;

create or replace function public.upsert_alerts_newer_wins(
  p_owner_id text,
  p_alerts jsonb
)
returns setof public.alerts
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with parsed as (
    select
      coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
      coalesce(nullif(trim(item.local_id), ''), gen_random_uuid()::text) as local_id,
      upper(coalesce(nullif(trim(item.symbol), ''), '-')) as symbol,
      coalesce(nullif(trim(item.alert_type), ''), 'methodology_event') as alert_type,
      nullif(trim(item.operator), '') as operator,
      item.threshold,
      coalesce(item.payload, '{}'::jsonb) as payload,
      coalesce(nullif(trim(item.status), ''), 'active') as status,
      coalesce(item.created_at, item.updated_at, now()) as created_at,
      item.triggered_at,
      coalesce(item.updated_at, item.triggered_at, item.created_at, now()) as updated_at
    from jsonb_to_recordset(coalesce(p_alerts, '[]'::jsonb)) as item(
      local_id text,
      symbol text,
      alert_type text,
      operator text,
      threshold numeric,
      payload jsonb,
      status text,
      created_at timestamptz,
      triggered_at timestamptz,
      updated_at timestamptz
    )
    where nullif(trim(item.symbol), '') is not null
  ),
  incoming as (
    select distinct on (parsed.owner_id, parsed.local_id)
      parsed.*
    from parsed
    order by parsed.owner_id, parsed.local_id, parsed.updated_at desc, parsed.created_at desc
  ),
  upserted as (
    insert into public.alerts (
      owner_id,
      local_id,
      symbol,
      alert_type,
      operator,
      threshold,
      payload,
      status,
      created_at,
      triggered_at,
      updated_at
    )
    select
      owner_id,
      local_id,
      symbol,
      alert_type,
      operator,
      threshold,
      payload,
      status,
      created_at,
      triggered_at,
      updated_at
    from incoming
    on conflict (owner_id, local_id) do update set
      symbol = excluded.symbol,
      alert_type = excluded.alert_type,
      operator = excluded.operator,
      threshold = excluded.threshold,
      payload = excluded.payload,
      status = excluded.status,
      created_at = least(public.alerts.created_at, excluded.created_at),
      triggered_at = excluded.triggered_at,
      updated_at = excluded.updated_at
    where excluded.updated_at >= public.alerts.updated_at
    returning public.alerts.*
  ),
  returned as (
    select upserted.*
    from upserted
    union all
    select a.*
    from public.alerts a
    join incoming i on i.owner_id = a.owner_id and i.local_id = a.local_id
    where not exists (
      select 1
      from upserted u
      where u.owner_id = i.owner_id and u.local_id = i.local_id
    )
  )
  select returned.*
  from returned
  order by returned.updated_at desc;
end;
$$;

revoke all on function public.upsert_alerts_newer_wins(text, jsonb) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.upsert_alerts_newer_wins(text, jsonb) to service_role;
  end if;
end $$;

create or replace function public.update_alert_status_newer_wins(
  p_owner_id text,
  p_cloud_id uuid default null,
  p_local_id text default null,
  p_status text default 'resolved',
  p_payload jsonb default '{}'::jsonb,
  p_updated_at timestamptz default now()
)
returns setof public.alerts
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with incoming as (
    select
      coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
      p_cloud_id as cloud_id,
      nullif(trim(p_local_id), '') as local_id,
      coalesce(nullif(trim(p_status), ''), 'resolved') as status,
      coalesce(p_payload, '{}'::jsonb) as payload,
      coalesce(p_updated_at, now()) as updated_at
  ),
  updated as (
    update public.alerts a
    set status = incoming.status,
      payload = coalesce(a.payload, '{}'::jsonb) || incoming.payload,
      updated_at = incoming.updated_at,
      triggered_at = case
        when incoming.status = 'active' then a.triggered_at
        else coalesce(a.triggered_at, incoming.updated_at)
      end
    from incoming
    where a.owner_id = incoming.owner_id
      and (
        (incoming.cloud_id is not null and a.id = incoming.cloud_id)
        or (incoming.cloud_id is null and incoming.local_id is not null and a.local_id = incoming.local_id)
      )
      and incoming.updated_at >= a.updated_at
    returning a.*
  ),
  returned as (
    select updated.*
    from updated
    union all
    select a.*
    from public.alerts a
    join incoming i on i.owner_id = a.owner_id
      and (
        (i.cloud_id is not null and a.id = i.cloud_id)
        or (i.cloud_id is null and i.local_id is not null and a.local_id = i.local_id)
      )
    where not exists (
      select 1
      from updated u
      where u.id = a.id
    )
  )
  select returned.*
  from returned;
end;
$$;

revoke all on function public.update_alert_status_newer_wins(text, uuid, text, text, jsonb, timestamptz) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.update_alert_status_newer_wins(text, uuid, text, text, jsonb, timestamptz) to service_role;
  end if;
end $$;

create table if not exists company_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text not null,
  name text,
  sector text,
  industry text,
  country text,
  currency text,
  market_cap numeric,
  market_cap_usd numeric,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol)
);

create table if not exists universe_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  cache_key text not null,
  markets text[] not null default '{}'::text[],
  source text,
  total_count integer not null default 0,
  passed_count integer not null default 0,
  excluded_count integer not null default 0,
  quality_gate jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, cache_key)
);

create table if not exists universe_snapshot_symbols (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_id uuid not null references universe_snapshots(id) on delete cascade,
  symbol text not null,
  name text,
  country text,
  market text,
  source text,
  instrument_type text,
  passed boolean not null default true,
  quality_gate jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol)
);

create table if not exists daily_bars (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text not null,
  trade_date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  adj_close numeric,
  volume numeric,
  currency text,
  provider text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol, trade_date, provider)
);

create table if not exists fundamental_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  symbol text not null,
  period_end date,
  period_type text,
  provider text,
  currency text,
  market_cap numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, symbol, period_end, period_type, provider)
);

create table if not exists shadow_instruments (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  provider text not null,
  market text not null,
  isin text not null,
  name text,
  short_name text,
  currency text,
  cfi_code text,
  issuer_lei text,
  trading_venue text,
  relevant_venue text,
  relevant_authority text,
  first_trade_date date,
  termination_date date,
  status text not null default 'reference',
  quality_gate jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider, market, isin)
);

create table if not exists symbol_resolutions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  provider text not null,
  market text not null,
  isin text not null,
  symbol text not null,
  name text,
  exchange text,
  exchange_code text,
  figi text,
  composite_figi text,
  share_class_figi text,
  confidence_score numeric,
  status text not null default 'resolved',
  data_freshness jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, provider, isin, symbol)
);

create table if not exists provider_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  provider text not null,
  run_type text not null,
  market text,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  setting_type text not null default 'general',
  setting_key text not null default 'default',
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (owner_id, setting_type, setting_key)
);

create or replace function public.upsert_app_setting_newer_wins(
  p_owner_id text,
  p_setting_type text,
  p_setting_key text,
  p_value jsonb,
  p_updated_at timestamptz default now()
)
returns setof public.app_settings
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_value is null then
    return;
  end if;

  return query
  with incoming as (
    select
      coalesce(nullif(trim(p_owner_id), ''), 'personal') as owner_id,
      coalesce(nullif(trim(p_setting_type), ''), 'general') as setting_type,
      coalesce(nullif(trim(p_setting_key), ''), 'default') as setting_key,
      coalesce(p_value, '{}'::jsonb) as value,
      coalesce(p_updated_at, now()) as updated_at
  ),
  upserted as (
    insert into public.app_settings (
      owner_id,
      setting_type,
      setting_key,
      value,
      updated_at
    )
    select
      owner_id,
      setting_type,
      setting_key,
      value,
      updated_at
    from incoming
    on conflict (owner_id, setting_type, setting_key) do update set
      value = excluded.value,
      updated_at = excluded.updated_at
    where excluded.updated_at >= public.app_settings.updated_at
    returning public.app_settings.*
  ),
  returned as (
    select upserted.*
    from upserted
    union all
    select s.*
    from public.app_settings s
    join incoming i on i.owner_id = s.owner_id
      and i.setting_type = s.setting_type
      and i.setting_key = s.setting_key
    where not exists (
      select 1
      from upserted u
      where u.owner_id = i.owner_id
        and u.setting_type = i.setting_type
        and u.setting_key = i.setting_key
    )
  )
  select returned.*
  from returned;
end;
$$;

revoke all on function public.upsert_app_setting_newer_wins(text, text, text, jsonb, timestamptz) from public;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.upsert_app_setting_newer_wins(text, text, text, jsonb, timestamptz) to service_role;
  end if;
end $$;

create table if not exists leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  leaderboard_key text not null,
  scope_type text not null default 'global',
  scope_value text,
  strategy text not null default 'momentum',
  title text not null,
  criteria jsonb not null default '{}'::jsonb,
  item_count integer not null default 0,
  source text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, leaderboard_key)
);

create table if not exists leaderboard_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_id uuid not null references leaderboard_snapshots(id) on delete cascade,
  rank_index integer not null,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  score numeric,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol)
);

create table if not exists rs_weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_date date not null,
  week_key text not null,
  engine_version text not null,
  base_currency text not null default 'USD',
  lookback_weeks integer[] not null default '{13,26,39,52}'::integer[],
  weights jsonb not null default '{}'::jsonb,
  min_sample integer not null default 20,
  symbol_count integer not null default 0,
  source text,
  stats jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (owner_id, snapshot_date, engine_version, base_currency)
);

create table if not exists rs_weekly_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'personal',
  snapshot_id uuid not null references rs_weekly_snapshots(id) on delete cascade,
  snapshot_date date not null,
  week_key text not null,
  engine_version text not null,
  base_currency text not null default 'USD',
  rank_index integer not null,
  symbol text not null,
  company_name text,
  country text,
  sector text,
  industry text,
  theme text,
  currency text,
  normalized_currency text,
  rs_rating numeric,
  rs_raw numeric,
  usd_close numeric,
  local_close numeric,
  fx_rate numeric,
  fx_date date,
  sample_size integer,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol)
);

-- Histórico change-only de escaneos por símbolo.
--
-- Aditiva: no altera ni referencia con FK a scans, scan_results o daily_bars.
-- source_scan_id se conserva como procedencia lógica, pero deliberadamente no
-- tiene FK porque scans aplica una retención destructiva de los últimos N scans.
create table if not exists public.scan_symbol_history (
  id bigint generated always as identity primary key,

  owner_id text not null,
  symbol text not null,
  mic_code text not null,

  observed_at timestamptz not null,
  observed_week date not null,
  data_as_of date,

  source_scan_id uuid not null,
  source_pipeline text not null,

  stage text,
  stage_week integer,

  rs_global numeric,
  rs_benchmark numeric,
  rs_country numeric,
  rs_sector numeric,

  composite_score numeric,
  composite_coverage numeric not null,
  composite_partial boolean not null,

  scoring_engine_version text not null,
  data_provider text not null,

  passed_screen boolean not null,
  absence_reason text,
  absence_detail text,

  change_reasons text[] not null,
  created_at timestamptz not null default now(),

  constraint scan_symbol_history_owner_nonempty
    check (btrim(owner_id) <> ''),

  constraint scan_symbol_history_symbol_nonempty
    check (btrim(symbol) <> ''),

  constraint scan_symbol_history_mic_nonempty
    check (btrim(mic_code) <> ''),

  constraint scan_symbol_history_pipeline_nonempty
    check (btrim(source_pipeline) <> ''),

  constraint scan_symbol_history_engine_version_nonempty
    check (btrim(scoring_engine_version) <> ''),

  constraint scan_symbol_history_provider_nonempty
    check (btrim(data_provider) <> ''),

  constraint scan_symbol_history_week_matches_observation
    check (
      observed_week =
      date_trunc('week', observed_at at time zone 'UTC')::date
    ),

  constraint scan_symbol_history_stage_week_positive
    check (stage_week is null or stage_week >= 1),

  constraint scan_symbol_history_rs_global_range
    check (rs_global is null or rs_global between 0 and 100),

  constraint scan_symbol_history_rs_benchmark_range
    check (rs_benchmark is null or rs_benchmark between 0 and 100),

  constraint scan_symbol_history_rs_country_range
    check (rs_country is null or rs_country between 0 and 100),

  constraint scan_symbol_history_rs_sector_range
    check (rs_sector is null or rs_sector between 0 and 100),

  constraint scan_symbol_history_composite_range
    check (composite_score is null or composite_score between 0 and 100),

  constraint scan_symbol_history_coverage_range
    check (composite_coverage between 0 and 1),

  constraint scan_symbol_history_absence_reason
    check (
      absence_reason is null
      or absence_reason in (
        'not_in_universe',
        'insufficient_data',
        'filtered_out'
      )
    ),

  constraint scan_symbol_history_screening_shape
    check (
      (passed_screen = true and absence_reason is null)
      or
      (passed_screen = false and absence_reason is not null)
    ),

  -- No se arrastran métricas antiguas cuando el símbolo deja el universo.
  -- La fila representa ausencia, no un estado técnico actual.
  constraint scan_symbol_history_out_of_universe_shape
    check (
      absence_reason <> 'not_in_universe'
      or (
        data_as_of is null
        and stage is null
        and stage_week is null
        and rs_global is null
        and rs_benchmark is null
        and rs_country is null
        and rs_sector is null
        and composite_score is null
        and composite_coverage = 0
        and composite_partial = true
      )
    ),

  constraint scan_symbol_history_has_change_reason
    check (cardinality(change_reasons) > 0),

  -- Idempotencia ante el reintento del mismo escaneo.
  constraint scan_symbol_history_scan_symbol_unique
    unique (owner_id, source_scan_id, mic_code, symbol)
);

create index if not exists scan_symbol_history_latest_idx
  on public.scan_symbol_history (
    owner_id,
    mic_code,
    symbol,
    observed_at desc,
    id desc
  );

create index if not exists scan_symbol_history_week_idx
  on public.scan_symbol_history (
    owner_id,
    observed_week desc,
    mic_code,
    symbol
  );

create index if not exists scan_symbol_history_mic_latest_idx
  on public.scan_symbol_history (
    owner_id,
    mic_code,
    observed_at desc
  );

alter table public.scan_symbol_history enable row level security;

revoke all on table public.scan_symbol_history from public;

do $$
begin
  if to_regrole('anon') is not null then
    revoke all on table public.scan_symbol_history from anon;
  end if;

  if to_regrole('authenticated') is not null then
    revoke all on table public.scan_symbol_history from authenticated;
  end if;

  if to_regrole('service_role') is not null then
    grant select, insert on table public.scan_symbol_history to service_role;
    grant usage, select
      on sequence public.scan_symbol_history_id_seq
      to service_role;
  end if;
end
$$;

-- Lectura acotada al último estado por (owner, MIC, símbolo). El escritor usa
-- esta proyección para decidir cambios y para detectar salidas de un snapshot
-- autoritativo sin transferir todo el histórico semanal.
create or replace function public.scan_symbol_history_latest_v1(
  p_owner_id text,
  p_mic_codes text[] default null
)
returns setof public.scan_symbol_history
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (h.owner_id, h.mic_code, h.symbol)
    h.*
  from public.scan_symbol_history as h
  where h.owner_id = p_owner_id
    and (
      p_mic_codes is null
      or cardinality(p_mic_codes) = 0
      or h.mic_code = any(p_mic_codes)
    )
  order by
    h.owner_id,
    h.mic_code,
    h.symbol,
    h.observed_at desc,
    h.id desc;
$$;

revoke all
  on function public.scan_symbol_history_latest_v1(text, text[])
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute
      on function public.scan_symbol_history_latest_v1(text, text[])
      to service_role;
  end if;
end
$$;

create index if not exists scan_results_scan_id_idx on scan_results(scan_id);
create index if not exists scan_results_owner_scan_rank_idx on scan_results(owner_id, scan_id, rank_index);
create index if not exists scan_results_symbol_idx on scan_results(owner_id, symbol);
create index if not exists scan_results_owner_created_idx on scan_results(owner_id, created_at desc);
create index if not exists scan_results_owner_sector_created_idx on scan_results(owner_id, sector, created_at desc);
create index if not exists scan_results_owner_industry_created_idx on scan_results(owner_id, industry, created_at desc);
create index if not exists scan_results_owner_theme_created_idx on scan_results(owner_id, theme, created_at desc);
create index if not exists scan_results_owner_country_created_idx on scan_results(owner_id, country, created_at desc);
create index if not exists scans_active_idx on scans(owner_id, deleted_at, updated_at desc);
create index if not exists favorites_symbol_idx on favorites(owner_id, symbol);
create index if not exists favorites_active_idx on favorites(owner_id, deleted_at, updated_at desc);
create index if not exists notes_symbol_idx on notes(owner_id, symbol);
create index if not exists alerts_symbol_idx on alerts(owner_id, symbol);
create index if not exists alerts_local_id_idx on alerts(owner_id, local_id);
create index if not exists alerts_updated_idx on alerts(owner_id, updated_at desc);
create index if not exists universe_snapshots_cache_idx on universe_snapshots(owner_id, cache_key, updated_at desc);
create index if not exists universe_snapshot_symbols_snapshot_idx on universe_snapshot_symbols(snapshot_id, passed);
create index if not exists universe_snapshot_symbols_symbol_idx on universe_snapshot_symbols(owner_id, symbol);
create index if not exists daily_bars_symbol_date_idx on daily_bars(owner_id, symbol, trade_date desc);
create index if not exists daily_bars_date_idx on daily_bars(owner_id, trade_date desc);
create index if not exists fundamental_snapshots_symbol_idx on fundamental_snapshots(owner_id, symbol, period_end desc);
create index if not exists shadow_instruments_market_idx on shadow_instruments(owner_id, provider, market, updated_at desc);
create index if not exists shadow_instruments_isin_idx on shadow_instruments(owner_id, isin);
create index if not exists symbol_resolutions_market_idx on symbol_resolutions(owner_id, provider, market, updated_at desc);
create index if not exists symbol_resolutions_symbol_idx on symbol_resolutions(owner_id, symbol);
create index if not exists symbol_resolutions_isin_idx on symbol_resolutions(owner_id, isin);
create index if not exists provider_runs_idx on provider_runs(owner_id, provider, run_type, started_at desc);
create index if not exists app_settings_key_idx on app_settings(owner_id, setting_type, setting_key, updated_at desc);
create index if not exists leaderboard_snapshots_key_idx on leaderboard_snapshots(owner_id, leaderboard_key, generated_at desc);
create index if not exists leaderboard_items_snapshot_idx on leaderboard_items(snapshot_id, rank_index);
create index if not exists leaderboard_items_symbol_idx on leaderboard_items(owner_id, symbol);
create index if not exists rs_weekly_snapshots_date_idx on rs_weekly_snapshots(owner_id, snapshot_date desc);
create index if not exists rs_weekly_items_snapshot_idx on rs_weekly_items(snapshot_id, rank_index);
create index if not exists rs_weekly_items_symbol_idx on rs_weekly_items(owner_id, symbol, snapshot_date desc);
alter table scans enable row level security;
alter table scan_results enable row level security;
alter table favorites enable row level security;
alter table favorite_snapshots enable row level security;
alter table notes enable row level security;
alter table alerts enable row level security;
alter table company_profiles enable row level security;
alter table universe_snapshots enable row level security;
alter table universe_snapshot_symbols enable row level security;
alter table daily_bars enable row level security;
alter table fundamental_snapshots enable row level security;
alter table shadow_instruments enable row level security;
alter table symbol_resolutions enable row level security;
alter table provider_runs enable row level security;
alter table app_settings enable row level security;
alter table leaderboard_snapshots enable row level security;
alter table leaderboard_items enable row level security;
alter table rs_weekly_snapshots enable row level security;
alter table rs_weekly_items enable row level security;
-- The Next.js API uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Do not expose the service role key in browser code.

-- ──────────────────────────────────────────────────────────────────────────
-- pg_cron: backstop semanal para huérfanos que la purga oportunista NO cubre.
-- ──────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE ESTE JOB — backstop, NO mecanismo principal:
-- La purga oportunista dentro de `upsert_scan_newer_wins` (ver arriba) cubre
-- el caso normal: cada upsert exitoso retiene los 3 scans activos más
-- recientes del owner y limpia tombstones >7 días. Eso mantiene la tabla
-- acotada MIENTRAS el usuario siga escaneando.
--
-- Pero ese flujo nunca dispara para el caso huérfano: un owner que creó scans
-- y dejó de escanear. Sin un upsert nuevo, la purga oportunista nunca corre,
-- y sus ≤3 scans activos + cualquier tombstone se quedan indefinidamente.
-- Este job semanal es el respaldo que cubre ESE único caso — no reemplaza la
-- purga oportunista, no la duplica, solo atrapa lo que ella no toca.
--
-- POR QUÉ EL UMBRAL ES 30 DÍAS (más laxo que la purga oportunista):
-- La purga oportunista gobierna el rango 0–7 días (tombstones) y retiene solo
-- 3 scans activos por owner. Este backstop solo debe activarse para huérfanos
-- que la purga oportunista nunca tocó — es decir, scans cuyo owner lleva meses
-- sin actividad. 30 días es 4.3× el umbral de tombstones (7 días), lo que
-- garantiza que el backstop NUNCA compita con la purga oportunista en el rango
-- 0–29 días: si el usuario vuelve a escanear antes de 30 días, la purga
-- oportunista retoma el control y este job no hace nada relevante. El backstop
-- es estrictamente de "última oportunidad" para datos que ya nadie quiere.
--
-- CAMPO APLICADO: opera sobre `updated_at` (activos huérfanos) y `deleted_at`
-- (tombstones que sobrevivieron >30 días pese a la purga oportunista de 7 días
-- — señal de que ningún upsert disparó la limpieza normal, pero igual hay que
-- limpiarlos). El cascade ON DELETE CASCADE en scan_results.scan_id (ver DDL)
-- limpia automáticamente las filas hijas al borrar de scans.
--
-- NO TOCA favorites NI favorite_snapshots — desacopladas (copy-on-favorite,
-- sin FK hacia scans/scan_results). Solo opera sobre public.scans.
--
-- SINTAXIS PENDIENTE DE VALIDACIÓN EN RUNTIME: este bloque usa pg_cron, que
-- requiere (a) que la extensión esté habilitada a nivel de proyecto en
-- Supabase (Dashboard → Database → Extensions → pg_cron), y (b) que el rol
-- que ejecuta `cron.schedule` tenga permisos sobre el schema `cron`.
-- pg_cron crea sus objetos internos (incluidas las funciones
-- schedule/unschedule) en un schema llamado literalmente "cron",
-- independientemente del schema donde se cargue la extensión con
-- `with schema`. Por eso las llamadas se hacen sin prefijo
-- (`cron.schedule(...)`, no `extensions.cron.schedule(...)`): el prefijo
-- apuntaba al schema equivocado. Convención confirmada contra docs
-- oficiales de Supabase y ejemplos reales. No se puede verificar aquí porque
-- el proyecto está restringido (sin acceso a Postgres real); seguimos el
-- mismo patrón que `finalize_scan_results` (inspección estática, validación
-- runtime pendiente).
--
-- create extension sin `with schema` para seguir la convención del proyecto
-- (la única otra create extension existente, pgcrypto, tampoco especifica
-- schema — ver línea 4).
create extension if not exists pg_cron;

-- Idempotencia: si el job ya existe (re-ejecución de la migración), se quita
-- antes de re-programarlo. cron.unschedule devuelve NULL si no existe — no
-- levanta error.
do $$
begin
  perform cron.unschedule('statsedge-backstop-purge-weekly');
exception
  when others then null;
end $$;

select cron.schedule(
  'statsedge-backstop-purge-weekly',
  '0 3 * * 0',  -- domingos 03:00 UTC (fuera de horas pico, semanal)
  $cron$
    delete from public.scans
    where deleted_at is null
      and updated_at < now() - interval '30 days';
    delete from public.scans
    where deleted_at is not null
      and deleted_at < now() - interval '30 days';
  $cron$
);

-- ──────────────────────────────────────────────────────────────────────────
-- pg_cron: backstop semanal para daily_bars (huérfanos + trim de excedentes).
-- ──────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE ESTE JOB — backstop complementario al cap de escritura:
-- writeDailyBarsCache (lib/dailyBarsCache.js) ya aplica un cap de profundidad
-- por símbolo en cada escritura: 400 barras por defecto, 1260 si el símbolo
-- está referenciado (favorito/nota/alerta activa). Ese cap cubre el caso
-- normal — cada nueva escritura trunca el payload y purga lo viejo para ese
-- símbolo.
--
-- Pero igual que con scans, ese flujo nunca dispara para el caso huérfano:
-- un símbolo que se fetcheó una vez (p.ej. un /review puntual hace meses) y
-- cuyo owner nunca volvió a tocar. Sin una nueva escritura, el cap de
-- writeDailyBarsCache nunca corre, y sus filas se quedan indefinidamente.
-- Este job semanal es el respaldo que cubre ESE caso — no reemplaza el cap
-- de escritura, no lo duplica, solo atrapa lo que él no toca.
--
-- DOS FASES, una sola función:
--
-- FASE 1 — Huérfanos: borra TODAS las filas de cualquier (owner_id, symbol)
--   cuyo max(updated_at) agrupado por symbol sea anterior a 90 días. 90 días
--   es deliberadamente más laxo que el cap de escritura (que actúa en cada
--   write): cubre el caso "el usuario fetcheó esto en algún momento de los
--   últimos 3 meses pero no volvió". Si volvió a tocarlo en los últimos 90
--   días, el símbolo NO es huérfano y sobrevive (su trim lo maneja la fase 2).
--   EXCEPCIÓN: si el símbolo está referenciado (favorito/nota/alerta activa),
--   NO se borra aunque sea huérfano — el usuario sigue siguiéndolo, así que
--   retener su histórico tiene valor (distanceATH/listingDate).
--
-- FASE 2 — Trim de excedentes: para los símbolos supervivientes, row_number()
--   over (partition by owner_id, symbol order by trade_date desc) y borrar
--   rn > 400 (no referenciados) o rn > 1260 (referenciados). Esto atrapa el
--   caso "el símbolo se fetcheó con range=MAX antes de que existiera el cap
--   de escritura" — filas viejas pre-cap que writeDailyBarsCache no había
--   podido purgar porque todavía no existía la lógica.
--
-- CRITERIO DE "REFERENCIADO" — réplica exacta de isSymbolReferenced en
-- lib/dailyBarsCache.js. Mismas 3 tablas, mismas condiciones:
--   • favorites: owner_id + symbol + deleted_at is null (excluye tombstones)
--   • notes: owner_id + symbol (symbol es nullable; el eq implícito filtra)
--   • alerts: owner_id + symbol + status='active' (excluye disparadas/pausadas)
-- Si una sola de las 3 tiene una fila para ese (owner_id, symbol), el símbolo
-- cuenta como referenciado. Cualquier diferencia con el JS sería un bug —
-- mantener ambos en sincronía es un contrato explícito.
--
-- VACUUM SEPARADO: VACUUM (ANALYZE) no puede correr dentro de un bloque de
-- transacción ni dentro de una función plpgsql. Por eso se programa como un
-- cron.schedule APARTE (ver abajo) con el comando VACUUM directo, no envuelto
-- en esta función. VACUUM normal (no FULL) — recupera espacio de tuplas muertas
-- sin bloquear la tabla exclusivamente, suficiente para un backstop semanal.
--
-- NO TOCA favorites/favorite_snapshots/notes/alerts — solo lee las 3 tablas
-- para el EXISTS de "referenciado", nunca escribe en ellas. Solo opera sobre
-- public.daily_bars.
--
-- SINTAXIS PENDIENTE DE VALIDACIÓN EN RUNTIME: misma situación que el backstop
-- de scan_results — pg_cron debe estar habilitado, el rol que ejecuta debe
-- tener permisos sobre el schema `cron`, y la función debe ser executable por
-- ese rol (security invoker + grant a service_role, ver convención abajo). No
-- verificable aquí (proyecto restringido); inspección estática, validación
-- runtime pendiente cuando se confirme el desbloqueo.

create or replace function public.purge_daily_bars_backstop()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_orphans integer := 0;
  v_trimmed integer := 0;
begin
  -- FASE 1 — Huérfanos: borra todos los símbolos cuyo último updated_at es
  -- anterior a 90 días Y no están referenciados por el owner. Se ejecuta
  -- antes del trim para reducir el universo que la fase 2 tiene que procesar.
  --
  -- El `ctid in (...)` evita el anti-pattern de borrar de la misma tabla que
  -- se está escaneando; pre-computamos los ctids a borrar en una subquery.
  delete from public.daily_bars
  where ctid in (
    select d.ctid
    from public.daily_bars d
    join (
      -- Último updated_at por (owner_id, symbol) — agrupa todas las filas
      -- del símbolo para decidir si el conjunto es huérfano.
      select owner_id, symbol, max(updated_at) as last_seen
      from public.daily_bars
      group by owner_id, symbol
    ) latest
      on latest.owner_id = d.owner_id
     and latest.symbol = d.symbol
    where latest.last_seen < now() - interval '90 days'
      -- EXCEPCIÓN: el símbolo está referenciado (favorito/nota/alerta activa
      -- para ese mismo owner_id). Réplica exacta de isSymbolReferenced (JS).
      and not exists (
        select 1 from public.favorites f
        where f.owner_id = d.owner_id
          and f.symbol = d.symbol
          and f.deleted_at is null
      )
      and not exists (
        select 1 from public.notes n
        where n.owner_id = d.owner_id
          and n.symbol = d.symbol
      )
      and not exists (
        select 1 from public.alerts a
        where a.owner_id = d.owner_id
          and a.symbol = d.symbol
          and a.status = 'active'
      )
  );

  get diagnostics v_orphans = row_count;

  -- FASE 2 — Trim de excedentes: para los símbolos supervivientes, retiene las
  -- 400 más recientes (no referenciados) o 1260 (referenciados) por
  -- (owner_id, symbol). row_number() ordena desc por trade_date, así que rn=1
  -- es la barra más reciente y rn > cap son las viejas a borrar.
  --
  -- El cap se decide por símbolo según si está referenciado o no. La subquery
  -- referenciados pre-computa el set de (owner_id, symbol) referenciados para
  -- evitar re-ejecutar los 3 EXISTS por cada fila.
  with ranked as (
    select
      d.ctid,
      d.owner_id,
      d.symbol,
      row_number() over (
        partition by d.owner_id, d.symbol
        order by d.trade_date desc
      ) as rn
    from public.daily_bars d
  ),
  referenciados as (
    -- Set de (owner_id, symbol) con al menos una referencia activa.
    -- UNION (no UNION ALL) deduplica — mismo (owner_id, symbol) en varias
    -- tablas cuenta como una sola referencia. Misma lógica que
    -- isSymbolReferenced (JS): cualquiera de las 3 basta.
    select owner_id, symbol from public.favorites
      where deleted_at is null and symbol is not null
    union
    select owner_id, symbol from public.notes
      where symbol is not null
    union
    select owner_id, symbol from public.alerts
      where status = 'active' and symbol is not null
  )
  delete from public.daily_bars
  where ctid in (
    select r.ctid
    from ranked r
    left join referenciados ref
      on ref.owner_id = r.owner_id
     and ref.symbol = r.symbol
    where r.rn > case
      when ref.owner_id is not null then 1260
      else 400
    end
  );

  get diagnostics v_trimmed = row_count;

  -- Retorna el total (huérfanos + trim) para observabilidad en cron.job_run_details.
  return v_orphans + v_trimmed;
end $$;

revoke all on function public.purge_daily_bars_backstop() from public;
do $$
begin
  -- grant execute a service_role solo si el rol existe (idempotente ante
  -- entornos donde el rol no está creado todavía).
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purge_daily_bars_backstop() to service_role;
  end if;
end $$;

-- Idempotencia: si los jobs ya existen (re-ejecución de la migración), se
-- quitan antes de re-programarlos. cron.unschedule devuelve NULL si no
-- existe — no levanta error.
do $$
begin
  perform cron.unschedule('statsedge-daily-bars-purge-weekly');
  perform cron.unschedule('statsedge-daily-bars-vacuum-weekly');
exception
  when others then null;
end $$;

-- Job 1: DELETE (huérfanos + trim). Misma ventana que el backstop de scans.
select cron.schedule(
  'statsedge-daily-bars-purge-weekly',
  '0 3 * * 0',  -- domingos 03:00 UTC (fuera de horas pico, semanal)
  $cron$
    select public.purge_daily_bars_backstop();
  $cron$
);

-- Job 2: VACUUM (ANALYZE) — separado porque VACUUM no puede correr dentro de
-- una transacción ni dentro de una función plpgsql. VACUUM normal (no FULL):
-- recupera espacio de tuplas muertas tras los DELETEs del job 1 sin bloqueo
-- exclusivo de la tabla. Corre 15 minutos después del DELETE (03:15 UTC) para
-- dejar margen a que la transacción de purga termine.
select cron.schedule(
  'statsedge-daily-bars-vacuum-weekly',
  '15 3 * * 0',  -- domingos 03:15 UTC (15 min después del DELETE)
  $cron$
    vacuum (analyze) public.daily_bars;
  $cron$
);
