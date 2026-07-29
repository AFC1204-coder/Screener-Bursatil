-- Hito 0: append-only repair for the pre-1A/1B base bootstrap defect.
-- Existing deployed catalogs require a forward migration; the historical base
-- is separately repaired by baseline-schema-repair-v1 before 1A/1B are applied.
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
