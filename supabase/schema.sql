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
