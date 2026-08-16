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
  -- Distancia al máximo de 52 semanas (%, ≤ 0) — migración 20260816140000.
  distance_52w numeric,
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
        and distance_52w is null
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
create index if not exists universe_snapshot_symbols_owner_market_created_idx on universe_snapshot_symbols(owner_id, market, created_at desc);
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
